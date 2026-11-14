import type { Language } from '../types/vision';

let activeUtteranceId = 0;
let safetyTimer: number | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesListenerAttached = false;

function refreshVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoices = voices;
  }
  if (!voicesListenerAttached && 'onvoiceschanged' in window.speechSynthesis) {
    voicesListenerAttached = true;
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      const updated = window.speechSynthesis.getVoices();
      if (updated.length > 0) {
        cachedVoices = updated;
      }
    });
  }
  return cachedVoices.length > 0 ? cachedVoices : voices;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
}

function clearSafetyTimer() {
  if (safetyTimer !== null) {
    window.clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

export function stopSpeaking(): void {
  activeUtteranceId += 1;
  clearSafetyTimer();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore synthesis cancel errors
    }
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Unlocks speechSynthesis and Web Audio on mobile Safari/Chrome during an initial user gesture.
 */
export function unlockSpeech(): void {
  if (typeof window === 'undefined') return;
  getAudioContext();
  if ('speechSynthesis' in window) {
    try {
      refreshVoices();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Plays a crisp 2-tone audible chime when the camera rotates:
 * ascending chime for front ('user'), descending chime for rear ('environment').
 */
export function playCameraRotateCue(toFacing: 'user' | 'environment'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const freqs = toFacing === 'user' ? [523.25, 783.99] : [783.99, 523.25];

    freqs.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    // Ignore audio cue failures
  }
}

/**
 * Plays a brief, gentle acoustic click when a manual request starts so the user
 * gets immediate confirmation before the spoken response arrives.
 */
export function playProcessingCue(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // Ignore audio cue failures
  }
}

const NOVELTY_OR_ROBOTIC_PATTERNS = [
  'espeak',
  'festival',
  'mbrola',
  'compact',
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'hysterical',
  'pipe organ',
  'trinoids',
  'whisper',
  'zarvox',
  'fred',
  'junior',
  'kathy',
  'ralph',
];

const HIGH_QUALITY_VOICE_NAMES = [
  'samantha',
  'ava',
  'allison',
  'zoe',
  'evan',
  'nathan',
  'daniel',
  'karen',
  'moira',
  'tessa',
  'serena',
  'aria',
  'jenny',
  'guy',
  'andrew',
  'emma',
  'brian',
  'amelie',
  'amélie',
  'thomas',
  'audrey',
  'vivienne',
  'denise',
  'remy',
  'rémy',
  'henri',
  'eloise',
  'éloïse',
  'celeste',
  'céleste',
  'aurelie',
  'aurélie',
];

function scoreVoice(voice: SpeechSynthesisVoice, lang: Language): number {
  const vLang = voice.lang.toLowerCase();
  const vName = voice.name.toLowerCase();
  const prefix = lang === 'fr' ? 'fr' : 'en';
  const preferredLocale = lang === 'fr' ? 'fr-fr' : 'en-us';

  if (!vLang.startsWith(prefix)) return -1000;

  let score = 0;

  // Penalize robotic/novelty synthesizers heavily
  if (NOVELTY_OR_ROBOTIC_PATTERNS.some((p) => vName.includes(p))) {
    score -= 200;
  }

  // Strongly prefer neural / natural / enhanced / Siri / Google voices
  if (
    vName.includes('natural') ||
    vName.includes('neural') ||
    vName.includes('enhanced') ||
    vName.includes('premium') ||
    vName.includes('siri')
  ) {
    score += 120;
  }

  if (vName.includes('online')) {
    score += 90;
  }

  if (vName.includes('google')) {
    score += 80;
  }

  if (HIGH_QUALITY_VOICE_NAMES.some((n) => vName.includes(n))) {
    score += 55;
  }

  // Cloud-backed voices on Chrome/Edge are typically much more natural than old local SAPI/eSpeak voices
  if (!voice.localService) {
    score += 30;
  }

  // Locale precision
  if (vLang === preferredLocale) {
    score += 25;
  } else if (vLang.startsWith(preferredLocale)) {
    score += 20;
  } else if (lang === 'en' && (vLang === 'en-gb' || vLang === 'en-au' || vLang === 'en-ca')) {
    score += 15;
  } else if (lang === 'fr' && vLang === 'fr-ca') {
    score += 15;
  }

  return score;
}

function selectVoice(lang: Language): SpeechSynthesisVoice | null {
  const voices = refreshVoices();
  if (!voices.length) return null;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestScore > -500 ? bestVoice : null;
}

/**
 * Smooths punctuation so speech engines pause naturally instead of reading symbols literally.
 */
function formatForNaturalSpeech(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SpeakOptions {
  lang: Language;
  onStart?: () => void;
  onEnd?: () => void;
}

export function speakText(text: string, options: SpeakOptions): void {
  const cleaned = formatForNaturalSpeech(text);
  if (!cleaned) {
    options.onEnd?.();
    return;
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    options.onEnd?.();
    return;
  }

  // ALWAYS cancel current speech before speaking something new
  stopSpeaking();

  const currentId = ++activeUtteranceId;
  const utterance = new SpeechSynthesisUtterance(cleaned);
  const voice = selectVoice(options.lang);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = options.lang === 'fr' ? 'fr-FR' : 'en-US';
  }

  // Slightly calmer rate sounds noticeably warmer and less clipped/robotic
  utterance.rate = 0.97;
  utterance.pitch = 1.0;

  let finished = false;
  const finish = () => {
    if (finished || currentId !== activeUtteranceId) return;
    finished = true;
    clearSafetyTimer();
    options.onEnd?.();
  };

  utterance.onstart = () => {
    if (currentId !== activeUtteranceId) return;
    options.onStart?.();
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  // Estimate maximum speech duration + buffer as safety fallback if browser drops onend
  const estimatedMs = Math.max(4000, Math.min(20000, cleaned.length * 115));
  safetyTimer = window.setTimeout(finish, estimatedMs);

  try {
    options.onStart?.();
    window.speechSynthesis.speak(utterance);
  } catch {
    finish();
  }
}

export function vibratePulse(pattern: number | number[] = 40): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore vibration errors on unsupported browsers
    }
  }
}
