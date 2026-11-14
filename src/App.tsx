import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BatteryCharging,
  BatteryLow,
  CameraOff,
  Eye,
  Loader2,
  Mic,
  MicOff,
  Settings,
  Volume2,
} from 'lucide-react';
import { SettingsDrawer } from './components/SettingsDrawer';
import { useBatteryMonitor } from './hooks/useBatteryMonitor';
import { useVoiceCommands } from './hooks/useVoiceCommands';
import type {
  ApiVisionMode,
  AppStatus,
  Language,
  VisionMode,
  VisionResponse,
} from './types/vision';
import {
  captureDownscaledFrame,
  computeSceneSignature,
  hasSignificantSceneChange,
  openPreferredCameraStream,
  type SceneSignature,
} from './utils/camera';
import { COPY, shouldSpeakAutoDescription } from './utils/prompts';
import {
  playCameraRotateCue,
  playProcessingCue,
  speakText,
  stopSpeaking,
  unlockSpeech,
  vibratePulse,
} from './utils/speech';

const LONG_PRESS_MS = 550;
const TAP_SEQUENCE_WINDOW_MS = 215;
const AUTO_INTERVAL_MS = 3000;
const POINTER_MOVE_TOLERANCE_PX = 28;

export default function App() {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('second-sight-lang');
      return saved === 'fr' ? 'fr' : 'en';
    } catch {
      return 'en';
    }
  });

  const [status, setStatus] = useState<AppStatus>('idle');
  const [activeMode, setActiveMode] = useState<VisionMode>('describe');
  const [autoActive, setAutoActive] = useState(false);
  const [findTarget, setFindTarget] = useState<string | null>(null);
  const [spokenText, setSpokenText] = useState<string>(() => COPY[lang].welcome);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isUltraWide, setIsUltraWide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const facingModeRef = useRef<'environment' | 'user'>(facingMode);
  facingModeRef.current = facingMode;

  const isInFlightRef = useRef(false);
  const requestEpochRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastAutoSpokenRef = useRef('');
  const lastAutoSignatureRef = useRef<SceneSignature | null>(null);
  const autoCooldownUntilRef = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;

  // Gesture tracking refs
  const longPressTimerRef = useRef<number | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const tapCountRef = useRef(0);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const t = COPY[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('second-sight-lang', lang);
    } catch {
      // Ignore storage errors
    }
  }, [lang]);

  // Camera initialization (rear environment camera by default, rotatable to front user camera)
  const startCamera = useCallback(
    async (
      targetFacing: 'environment' | 'user' = facingModeRef.current,
      useExact = false
    ) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(true);
        setCameraReady(false);
        setIsUltraWide(false);
        return;
      }

      const previousDeviceId = streamRef.current
        ?.getVideoTracks()[0]
        ?.getSettings()?.deviceId;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      try {
        const { stream, isUltraWide: wide } = await openPreferredCameraStream(
          targetFacing,
          previousDeviceId,
          useExact
        );

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsUltraWide(wide);
        setCameraError(false);
        setCameraReady(true);
      } catch {
        setIsUltraWide(false);
        setCameraError(true);
        setCameraReady(false);
        const currentT = COPY[langRef.current];
        setSpokenText(currentT.errorCamera);
      }
    },
    []
  );

  useEffect(() => {
    void startCamera('environment', false);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      stopSpeaking();
    };
  }, [startCamera]);

  const speakAndShow = useCallback(
    (message: string, targetLang: Language = langRef.current) => {
      setSpokenText(message);
      speakText(message, {
        lang: targetLang,
        onStart: () => setStatus('speaking'),
        onEnd: () => setStatus('idle'),
      });
    },
    []
  );

  const executeVisionRequest = useCallback(
    async (
      mode: ApiVisionMode,
      options?: { targetObject?: string; isAutoTick?: boolean }
    ) => {
      const isAutoTick = Boolean(options?.isAutoTick);
      const currentLang = langRef.current;
      const currentT = COPY[currentLang];

      if (isAutoTick && (isInFlightRef.current || Date.now() < autoCooldownUntilRef.current)) {
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      let candidateSignature: SceneSignature | null = null;
      if (isAutoTick) {
        candidateSignature = computeSceneSignature(video);
        if (
          candidateSignature &&
          !hasSignificantSceneChange(
            lastAutoSignatureRef.current,
            candidateSignature
          )
        ) {
          return;
        }
      }

      const base64 = captureDownscaledFrame(video, canvas, mode);
      if (!base64) {
        if (!isAutoTick) {
          vibratePulse([40, 60, 40]);
          if (cameraError) {
            startCamera();
          }
          speakAndShow(currentT.errorCamera, currentLang);
        }
        return;
      }

      if (!isAutoTick) {
        requestEpochRef.current += 1;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        playProcessingCue();
        stopSpeaking();
      }
      const myEpoch = requestEpochRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      isInFlightRef.current = true;
      vibratePulse(40);
      setStatus('thinking');

      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            imageBase64: base64,
            mode,
            targetObject: options?.targetObject,
            lang: currentLang,
          }),
        });

        if (res.status === 429) {
          const errBody = (await res.json().catch(() => ({}))) as {
            retryAfterSeconds?: number;
          };
          const waitSec = Math.max(5, Math.min(60, errBody.retryAfterSeconds ?? 15));
          autoCooldownUntilRef.current = Date.now() + waitSec * 1000;
          throw new Error('HTTP 429');
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as VisionResponse;
        const resultText = (data.text || '').trim();

        if (myEpoch !== requestEpochRef.current) {
          return;
        }

        if (!resultText) {
          throw new Error('Empty vision response');
        }

        if (isAutoTick) {
          if (candidateSignature) {
            lastAutoSignatureRef.current = candidateSignature;
          }
          const shouldSpeak = shouldSpeakAutoDescription(
            resultText,
            lastAutoSpokenRef.current
          );
          if (shouldSpeak) {
            lastAutoSpokenRef.current = resultText;
            speakAndShow(resultText, currentLang);
          } else {
            setStatus((prev) => (prev === 'thinking' ? 'idle' : prev));
          }
        } else {
          if (mode === 'describe') {
            lastAutoSpokenRef.current = resultText;
          }
          speakAndShow(resultText, currentLang);
        }
      } catch {
        if (myEpoch !== requestEpochRef.current) {
          return;
        }
        vibratePulse([40, 60, 40]);
        if (!isAutoTick) {
          speakAndShow(currentT.errorVision, currentLang);
        } else {
          setStatus((prev) => (prev === 'thinking' ? 'idle' : prev));
        }
      } finally {
        isInFlightRef.current = false;
      }
    },
    [cameraError, speakAndShow, startCamera]
  );

  // Explicit mode actions
  const triggerDescribe = useCallback(() => {
    unlockSpeech();
    setAutoActive(false);
    setActiveMode('describe');
    setFindTarget(null);
    void executeVisionRequest('describe');
  }, [executeVisionRequest]);

  const triggerRead = useCallback(() => {
    unlockSpeech();
    setAutoActive(false);
    setActiveMode('read');
    setFindTarget(null);
    void executeVisionRequest('read');
  }, [executeVisionRequest]);

  const triggerFind = useCallback(
    (targetObject: string) => {
      unlockSpeech();
      setAutoActive(false);
      setActiveMode('find');
      setFindTarget(targetObject);
      void executeVisionRequest('find', { targetObject });
    },
    [executeVisionRequest]
  );

  const stopAll = useCallback(() => {
    unlockSpeech();
    requestEpochRef.current += 1;
    abortControllerRef.current?.abort();
    isInFlightRef.current = false;
    setAutoActive(false);
    setActiveMode('describe');
    setFindTarget(null);
    stopSpeaking();
    setStatus('idle');
    vibratePulse([30, 50, 30]);
    const currentT = COPY[langRef.current];
    speakAndShow(currentT.stopped, langRef.current);
  }, [speakAndShow]);

  const toggleAutoMode = useCallback(() => {
    unlockSpeech();
    setAutoActive((prev) => {
      const next = !prev;
      const currentLang = langRef.current;
      const currentT = COPY[currentLang];
      requestEpochRef.current += 1;
      isInFlightRef.current = false;
      lastAutoSignatureRef.current = null;

      if (next) {
        lastAutoSpokenRef.current = '';
        setActiveMode('auto');
        setFindTarget(null);
        vibratePulse([45, 50, 45]);
        speakAndShow(currentT.autoStarted, currentLang);
      } else {
        setActiveMode('describe');
        vibratePulse(60);
        speakAndShow(currentT.autoStopped, currentLang);
      }
      return next;
    });
  }, [speakAndShow]);

  // Auto mode 3-second interval
  useEffect(() => {
    if (!autoActive) return;

    // Initial scan shortly after "Auto mode started" finishes or begins
    const initialTimer = window.setTimeout(() => {
      void executeVisionRequest('describe', { isAutoTick: true });
    }, 1400);

    const intervalId = window.setInterval(() => {
      void executeVisionRequest('describe', { isAutoTick: true });
    }, AUTO_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [autoActive, executeVisionRequest]);

  const handleLowBattery = useCallback(() => {
    const currentLang = langRef.current;
    vibratePulse([60, 80, 60]);
    speakAndShow(COPY[currentLang].batteryLow, currentLang);
  }, [speakAndShow]);

  const battery = useBatteryMonitor({
    threshold: 0.15,
    onLowBattery: handleLowBattery,
  });

  const rotateCamera = useCallback(() => {
    unlockSpeech();
    const nextFacing: 'environment' | 'user' =
      facingModeRef.current === 'environment' ? 'user' : 'environment';
    facingModeRef.current = nextFacing;
    setFacingMode(nextFacing);
    lastAutoSignatureRef.current = null;
    requestEpochRef.current += 1;
    isInFlightRef.current = false;

    vibratePulse([35, 45, 35]);
    playCameraRotateCue(nextFacing);

    void startCamera(nextFacing, true);

    const currentLang = langRef.current;
    const label =
      nextFacing === 'user'
        ? COPY[currentLang].cameraFront
        : COPY[currentLang].cameraRear;
    setSpokenText(label);
    window.setTimeout(() => {
      speakAndShow(label, currentLang);
    }, 160);
  }, [speakAndShow, startCamera]);

  // Voice commands hook
  const voice = useVoiceCommands({
    enabled: voiceEnabled && !settingsOpen,
    lang,
    isSpeaking: status === 'speaking',
    handlers: {
      onDescribe: triggerDescribe,
      onRead: triggerRead,
      onFind: triggerFind,
      onRotate: rotateCamera,
      onStop: stopAll,
    },
  });

  // Full-screen unified gesture surface handlers
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settingsOpen) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    unlockSpeech();
    if (cameraError) {
      void startCamera();
    }
    if (voiceEnabled && voice.permissionDenied) {
      voice.retryVoice();
    }

    activePointerIdRef.current = e.pointerId;
    longPressTriggeredRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

    setRipple({ id: Date.now(), x: e.clientX, y: e.clientY });

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      tapCountRef.current = 0;
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      toggleAutoMode();
    }, LONG_PRESS_MS);
  };

  const handleSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    const start = pointerDownPosRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > POINTER_MOVE_TOLERANCE_PX) {
      clearLongPressTimer();
      pointerDownPosRef.current = null;
    }
  };

  const handleSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settingsOpen) return;
    if (activePointerIdRef.current !== e.pointerId) return;

    clearLongPressTimer();
    activePointerIdRef.current = null;
    pointerDownPosRef.current = null;

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    tapCountRef.current += 1;
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      rotateCamera();
      return;
    }

    tapTimerRef.current = window.setTimeout(() => {
      const count = tapCountRef.current;
      tapCountRef.current = 0;
      tapTimerRef.current = null;
      if (count === 2) {
        triggerRead();
      } else if (count === 1) {
        triggerDescribe();
      }
    }, TAP_SEQUENCE_WINDOW_MS);
  };

  const handleSurfacePointerCancel = () => {
    clearLongPressTimer();
    activePointerIdRef.current = null;
    pointerDownPosRef.current = null;
    longPressTriggeredRef.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (settingsOpen) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      triggerDescribe();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      triggerRead();
    } else if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      rotateCamera();
    } else if (e.key.toLowerCase() === 'a') {
      e.preventDefault();
      toggleAutoMode();
    } else if (e.key === 'Escape' || e.key.toLowerCase() === 's') {
      e.preventDefault();
      stopAll();
    }
  };

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    const nextCopy = COPY[newLang];
    if (spokenText === COPY[lang].welcome) {
      setSpokenText(nextCopy.welcome);
    }
    vibratePulse(25);
    speakText(newLang === 'fr' ? 'Langue française activée.' : 'English language selected.', {
      lang: newLang,
      onStart: () => setStatus('speaking'),
      onEnd: () => setStatus('idle'),
    });
  };

  const statusLabel =
    status === 'thinking'
      ? t.statusThinking
      : status === 'speaking'
      ? t.statusSpeaking
      : t.statusIdle;

  const modeLabel =
    activeMode === 'auto' || autoActive
      ? t.modeAuto
      : activeMode === 'read'
      ? t.modeRead
      : activeMode === 'find'
      ? `${t.modeFind}${findTarget ? ` · ${findTarget}` : ''}`
      : t.modeDescribe;

  return (
    <main
      tabIndex={0}
      aria-label={`Second Sight. ${t.tapHint}`}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handleSurfacePointerMove}
      onPointerUp={handleSurfacePointerUp}
      onPointerCancel={handleSurfacePointerCancel}
      onKeyDown={handleKeyDown}
      className="tap-surface relative w-full h-[100dvh] overflow-hidden bg-[#050507] text-[#FAFAFA] flex flex-col justify-between outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
    >
      {/* Full-screen camera preview (mirrored visually only when using front camera) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          facingMode === 'user' ? 'scale-x-[-1]' : ''
        } ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Offscreen downscale canvas (max 512px wide JPEG) */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {/* Measured contrast scrim for outdoor daylight and dark-mode legibility */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/95 via-black/45 to-black/80"
      />

      {/* Subtle tap feedback ripple */}
      {ripple && (
        <span
          key={ripple.id}
          aria-hidden="true"
          style={{ left: ripple.x - 44, top: ripple.y - 44 }}
          onAnimationEnd={() => setRipple(null)}
          className="animate-tap-ripple pointer-events-none fixed w-[88px] h-[88px] rounded-full border-2 border-amber-400/75 z-10"
        />
      )}

      {/* Top status & corner settings bar */}
      <header className="relative z-20 flex items-center justify-between gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-base font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
              Second Sight
            </span>
            <span className="text-neutral-500" aria-hidden="true">
              ·
            </span>
            {/* Explicit status indicator: idle / thinking / speaking */}
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap shrink-0 ${
                status === 'thinking'
                  ? 'text-amber-400'
                  : status === 'speaking'
                  ? 'text-sky-300'
                  : 'text-neutral-300'
              }`}
            >
              {status === 'thinking' ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : status === 'speaking' ? (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{statusLabel}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
            <span className={autoActive ? 'text-amber-400 font-bold' : ''}>
              {modeLabel}
            </span>
            {isUltraWide && facingMode === 'environment' && (
              <>
                <span className="text-neutral-500" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono-tabular text-sky-300 font-semibold">
                  0.5×
                </span>
              </>
            )}
            {voice.supported && (
              <>
                <span className="text-neutral-500" aria-hidden="true">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 text-neutral-300">
                  {voice.listening && voiceEnabled ? (
                    <>
                      <Mic className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      <span>{t.micListening}</span>
                    </>
                  ) : (
                    <>
                      <MicOff className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                      <span>{t.micOff}</span>
                    </>
                  )}
                </span>
              </>
            )}
            {battery.supported && battery.levelPercent !== null && (
              <>
                <span className="text-neutral-500" aria-hidden="true">
                  ·
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-mono-tabular ${
                    battery.isLow ? 'text-amber-400 font-bold' : 'text-neutral-300'
                  }`}
                >
                  {battery.charging ? (
                    <BatteryCharging className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                  ) : battery.isLow ? (
                    <BatteryLow className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  ) : null}
                  <span>{battery.levelPercent}%</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Single corner settings button (stops propagation so it never triggers screen tap) */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setSettingsOpen(true);
          }}
          aria-label={`${t.settingsLabel} (${lang.toUpperCase()})`}
          className="min-h-[48px] min-w-[48px] px-3.5 rounded-2xl bg-black/65 border border-white/25 backdrop-blur-md text-white font-bold text-sm flex items-center gap-2 hover:bg-black/85 active:scale-95 transition-transform shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span className="font-mono-tabular uppercase">{lang}</span>
        </button>
      </header>

      {/* Camera unavailable indicator (when permission denied or no camera) */}
      {cameraError && (
        <div className="relative z-20 mx-auto my-auto flex flex-col items-center text-center px-6 pointer-events-none">
          <CameraOff className="w-12 h-12 text-amber-400 mb-3" aria-hidden="true" />
          <p className="text-base font-semibold text-neutral-200 max-w-xs">
            {t.errorCamera}
          </p>
        </div>
      )}

      {/* High-contrast spoken output focal area */}
      <section
        aria-live="polite"
        aria-atomic="true"
        className="relative z-20 w-full max-w-3xl mx-auto px-5 sm:px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 pointer-events-none"
      >
        <p className="text-[clamp(1.85rem,6.5vw,3.5rem)] font-extrabold leading-[1.12] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] [text-wrap:balance]">
          {spokenText}
        </p>

        <p className="mt-4 text-sm sm:text-base font-medium text-neutral-300 tracking-wide">
          {t.tapHint}
        </p>
      </section>

      <SettingsDrawer
        open={settingsOpen}
        lang={lang}
        voiceEnabled={voiceEnabled}
        voiceSupported={voice.supported}
        onClose={() => setSettingsOpen(false)}
        onSelectLanguage={handleLanguageChange}
        onToggleVoice={() => {
          setVoiceEnabled((prev) => !prev);
          if (voice.permissionDenied) {
            voice.retryVoice();
          }
        }}
      />
    </main>
  );
}
