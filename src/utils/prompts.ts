import type { Language } from '../types/vision';

export const HAZARD_WORDS_EN = [
  'stairs',
  'stair',
  'obstacle',
  'obstacles',
  'car',
  'cars',
  'bike',
  'bicycle',
  'person',
  'people',
  'step',
  'steps',
  'drop',
  'curb',
  'vehicle',
];

export const HAZARD_WORDS_FR = [
  'escalier',
  'escaliers',
  'obstacle',
  'obstacles',
  'voiture',
  'voitures',
  'vélo',
  'vélos',
  'personne',
  'personnes',
  'marche',
  'marches',
  'chute',
  'trou',
  'véhicule',
  'bordure',
];

const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from',
  'and', 'or', 'there', 'here', 'it', 'its', 'this', 'that',
  'your', 'you', 'ahead', 'front',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l',
  'est', 'sont', 'et', 'ou', 'en', 'dans', 'sur', 'à', 'au', 'aux',
  'avec', 'par', 'pour', 'il', 'elle', 'ce', 'cette', 'ces', 'y', 'a',
]);

function tokenize(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return new Set(cleaned);
}

export function containsHazardWord(text: string): boolean {
  const lower = text.toLowerCase();
  const allHazards = [...HAZARD_WORDS_EN, ...HAZARD_WORDS_FR];
  return allHazards.some((hazard) => {
    const regex = new RegExp(`\\b${hazard}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Determines whether an Auto-mode description should be spoken aloud.
 * Speaks if:
 * 1) No prior spoken description exists, OR
 * 2) A hazard word appears in the new description, OR
 * 3) Meaningful content tokens differ sufficiently (Jaccard similarity < 0.62)
 *    or spatial direction changed (left/center/right).
 */
export function shouldSpeakAutoDescription(
  newDescription: string,
  lastSpokenDescription: string
): boolean {
  const trimmedNew = newDescription.trim();
  if (!trimmedNew) return false;

  const trimmedLast = lastSpokenDescription.trim();
  if (!trimmedLast) return true;

  if (containsHazardWord(trimmedNew)) {
    return true;
  }

  const tokensNew = tokenize(trimmedNew);
  const tokensLast = tokenize(trimmedLast);

  if (tokensNew.size === 0 || tokensLast.size === 0) {
    return trimmedNew.toLowerCase() !== trimmedLast.toLowerCase();
  }

  // Check spatial direction change explicitly
  const dirs = ['left', 'center', 'right', 'gauche', 'centre', 'droite'];
  for (const dir of dirs) {
    const inNew = tokensNew.has(dir);
    const inLast = tokensLast.has(dir);
    if (inNew !== inLast) {
      return true;
    }
  }

  let intersectionCount = 0;
  for (const token of tokensNew) {
    if (tokensLast.has(token)) {
      intersectionCount += 1;
    }
  }

  const unionSize = new Set([...tokensNew, ...tokensLast]).size;
  const similarity = unionSize === 0 ? 1 : intersectionCount / unionSize;

  return similarity < 0.62;
}

export interface LocalizedCopy {
  welcome: string;
  tapHint: string;
  statusIdle: string;
  statusThinking: string;
  statusSpeaking: string;
  modeDescribe: string;
  modeRead: string;
  modeFind: string;
  modeAuto: string;
  autoStarted: string;
  autoStopped: string;
  stopped: string;
  errorVision: string;
  errorCamera: string;
  errorCameraButton: string;
  settingsLabel: string;
  settingsTitle: string;
  languageLabel: string;
  voiceLabel: string;
  voiceOn: string;
  voiceOff: string;
  voiceUnsupported: string;
  micListening: string;
  micOff: string;
  gesturesHeading: string;
  gestureSingle: string;
  gestureDouble: string;
  gestureTriple: string;
  gestureHold: string;
  voiceCommandsHeading: string;
  voiceCmdDescribe: string;
  voiceCmdRead: string;
  voiceCmdFind: string;
  voiceCmdRotate: string;
  voiceCmdStop: string;
  closeSettings: string;
  lookingForPrefix: string;
  batteryLow: string;
  cameraFront: string;
  cameraRear: string;
}

export const COPY: Record<Language, LocalizedCopy> = {
  en: {
    welcome: 'Tap anywhere to describe what is in front of you.',
    tapHint: 'Tap: Describe · Double: Read · Triple: Flip camera · Hold: Auto',
    statusIdle: 'Idle',
    statusThinking: 'Thinking',
    statusSpeaking: 'Speaking',
    modeDescribe: 'Describe',
    modeRead: 'Read',
    modeFind: 'Find',
    modeAuto: 'Auto',
    autoStarted: 'Auto mode started.',
    autoStopped: 'Auto mode stopped.',
    stopped: 'Stopped.',
    errorVision: "I can't see right now, try again.",
    errorCamera: 'Camera unavailable. Tap anywhere to allow camera access.',
    errorCameraButton: 'Enable camera',
    settingsLabel: 'Settings',
    settingsTitle: 'Settings',
    languageLabel: 'Spoken language',
    voiceLabel: 'Voice commands',
    voiceOn: 'Listening',
    voiceOff: 'Off',
    voiceUnsupported: 'Voice commands are not supported in this browser.',
    micListening: 'Mic on',
    micOff: 'Mic off',
    gesturesHeading: 'Touch gestures',
    gestureSingle: 'Single tap — Describe scene',
    gestureDouble: 'Double tap — Read visible text',
    gestureTriple: 'Triple tap — Rotate camera (front / rear)',
    gestureHold: 'Long press — Start or stop Auto mode',
    voiceCommandsHeading: 'Voice commands',
    voiceCmdDescribe: '"Describe"',
    voiceCmdRead: '"Read this"',
    voiceCmdFind: '"Find [object]"',
    voiceCmdRotate: '"Flip camera"',
    voiceCmdStop: '"Stop"',
    closeSettings: 'Done',
    lookingForPrefix: 'Looking for',
    batteryLow: 'Battery low, please connect to power',
    cameraFront: 'Front camera',
    cameraRear: 'Rear camera',
  },
  fr: {
    welcome: 'Touchez l’écran pour décrire ce qui est devant vous.',
    tapHint: 'Toucher : Décrire · Double : Lire · Triple : Caméra · Maintenir : Auto',
    statusIdle: 'Prêt',
    statusThinking: 'Analyse',
    statusSpeaking: 'Parole',
    modeDescribe: 'Décrire',
    modeRead: 'Lire',
    modeFind: 'Chercher',
    modeAuto: 'Auto',
    autoStarted: 'Mode automatique activé.',
    autoStopped: 'Mode automatique arrêté.',
    stopped: 'Arrêté.',
    errorVision: 'Je ne vois pas pour le moment, réessayez.',
    errorCamera: 'Caméra indisponible. Touchez l’écran pour autoriser la caméra.',
    errorCameraButton: 'Activer la caméra',
    settingsLabel: 'Paramètres',
    settingsTitle: 'Paramètres',
    languageLabel: 'Langue parlée',
    voiceLabel: 'Commandes vocales',
    voiceOn: 'Actives',
    voiceOff: 'Désactivées',
    voiceUnsupported: 'Commandes vocales non prises en charge sur ce navigateur.',
    micListening: 'Micro actif',
    micOff: 'Micro coupé',
    gesturesHeading: 'Gestes tactiles',
    gestureSingle: 'Appui simple — Décrire la scène',
    gestureDouble: 'Double appui — Lire le texte visible',
    gestureTriple: 'Triple appui — Tourner la caméra (avant / arrière)',
    gestureHold: 'Appui long — Activer ou arrêter le mode Auto',
    voiceCommandsHeading: 'Commandes vocales',
    voiceCmdDescribe: '« Décris »',
    voiceCmdRead: '« Lis ça »',
    voiceCmdFind: '« Trouve [objet] »',
    voiceCmdRotate: '« Caméra »',
    voiceCmdStop: '« Stop »',
    closeSettings: 'Fermer',
    lookingForPrefix: 'Recherche',
    batteryLow: 'Batterie faible, veuillez brancher le chargeur',
    cameraFront: 'Caméra avant',
    cameraRear: 'Caméra arrière',
  },
};
