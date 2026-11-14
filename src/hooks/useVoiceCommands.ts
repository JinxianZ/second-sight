import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../types/vision';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.webkitSpeechRecognition || win.SpeechRecognition || null;
}

export interface VoiceCommandHandlers {
  onDescribe: () => void;
  onRead: () => void;
  onFind: (targetObject: string) => void;
  onRotate: () => void;
  onStop: () => void;
}

interface UseVoiceCommandsOptions {
  enabled: boolean;
  lang: Language;
  isSpeaking: boolean;
  handlers: VoiceCommandHandlers;
}

export function parseVoiceCommand(
  rawTranscript: string
):
  | { type: 'describe' }
  | { type: 'read' }
  | { type: 'find'; target: string }
  | { type: 'rotate' }
  | { type: 'stop' }
  | null {
  const text = rawTranscript.trim().toLowerCase();
  if (!text) return null;

  // Stop commands
  if (
    text === 'stop' ||
    text.endsWith(' stop') ||
    text.startsWith('stop ') ||
    text === 'arrête' ||
    text === 'arrêter' ||
    text === 'arrete'
  ) {
    return { type: 'stop' };
  }

  // Find commands: "find [object]", "find the [object]", "trouve [objet]", "cherche [objet]"
  const findMatch = text.match(
    /(?:^|\b)(?:find|look for|trouve|trouver|cherche|chercher)\s+(?:the\s+|a\s+|an\s+|le\s+|la\s+|les\s+|l'|un\s+|une\s+|des\s+)?(.+)$/i
  );
  if (findMatch && findMatch[1]) {
    const target = findMatch[1].replace(/[.!?]+$/, '').trim();
    if (target.length >= 2) {
      return { type: 'find', target };
    }
  }

  // Read commands: "read this", "read", "lis", "lis ça", "lire"
  if (
    /\b(read this|read it|read|lis ça|lis ca|lis|lire)\b/i.test(text)
  ) {
    return { type: 'read' };
  }

  // Rotate / flip camera commands
  if (
    /\b(rotate camera|flip camera|switch camera|change camera|tourner la caméra|tourner la camera|changer de caméra|changer de camera|caméra|camera)\b/i.test(
      text
    )
  ) {
    return { type: 'rotate' };
  }

  // Describe commands: "describe", "décris", "décrire"
  if (
    /\b(describe|describe this|what do you see|décris|decris|décrire|decrire)\b/i.test(
      text
    )
  ) {
    return { type: 'describe' };
  }

  return null;
}

export function useVoiceCommands({
  enabled,
  lang,
  isSpeaking,
  handlers,
}: UseVoiceCommandsOptions) {
  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const handlersRef = useRef(handlers);
  const enabledRef = useRef(enabled);
  const isSpeakingRef = useRef(isSpeaking);
  const suppressUntilRef = useRef<number>(0);
  const restartTimeoutRef = useRef<number | null>(null);
  const lastDispatchedRef = useRef<{ text: string; time: number }>({
    text: '',
    time: 0,
  });

  handlersRef.current = handlers;
  enabledRef.current = enabled;

  useEffect(() => {
    if (isSpeakingRef.current && !isSpeaking) {
      // Short cooldown after TTS finishes so speaker echo isn't picked up
      suppressUntilRef.current = Date.now() + 450;
    }
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  const clearRestartTimer = () => {
    if (restartTimeoutRef.current !== null) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  };

  const stopRecognition = useCallback(() => {
    clearRestartTimer();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.stop();
      } catch {
        // Ignore stop errors
      }
    }
    setListening(false);
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !enabledRef.current) return;

    if (recognitionRef.current) return;

    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.lang = lang === 'fr' ? 'fr-FR' : 'en-US';

      rec.onstart = () => {
        setListening(true);
        setPermissionDenied(false);
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        if (isSpeakingRef.current || Date.now() < suppressUntilRef.current) {
          return;
        }

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result || !result.isFinal) continue;
          const transcript = result[0]?.transcript?.trim();
          if (!transcript) continue;

          const parsed = parseVoiceCommand(transcript);
          if (!parsed) continue;

          const now = Date.now();
          if (
            lastDispatchedRef.current.text === transcript.toLowerCase() &&
            now - lastDispatchedRef.current.time < 1500
          ) {
            continue;
          }
          lastDispatchedRef.current = { text: transcript.toLowerCase(), time: now };
          setLastCommand(transcript);

          if (parsed.type === 'describe') {
            handlersRef.current.onDescribe();
          } else if (parsed.type === 'read') {
            handlersRef.current.onRead();
          } else if (parsed.type === 'find') {
            handlersRef.current.onFind(parsed.target);
          } else if (parsed.type === 'rotate') {
            handlersRef.current.onRotate();
          } else if (parsed.type === 'stop') {
            handlersRef.current.onStop();
          }
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setPermissionDenied(true);
          setListening(false);
          recognitionRef.current = null;
        }
      };

      rec.onend = () => {
        recognitionRef.current = null;
        setListening(false);
        if (enabledRef.current && !permissionDenied) {
          clearRestartTimer();
          restartTimeoutRef.current = window.setTimeout(() => {
            if (enabledRef.current) {
              startRecognition();
            }
          }, 350);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [lang, permissionDenied]);

  useEffect(() => {
    stopRecognition();
    if (enabled && supported && !permissionDenied) {
      startRecognition();
    }
    return () => {
      stopRecognition();
    };
  }, [enabled, lang, supported, permissionDenied, startRecognition, stopRecognition]);

  const retryVoice = useCallback(() => {
    setPermissionDenied(false);
    stopRecognition();
    if (enabledRef.current) {
      window.setTimeout(() => startRecognition(), 100);
    }
  }, [startRecognition, stopRecognition]);

  return {
    supported,
    listening,
    permissionDenied,
    lastCommand,
    retryVoice,
  };
}
