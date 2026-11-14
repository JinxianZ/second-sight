import { Mic, MicOff, X } from 'lucide-react';
import type { Language } from '../types/vision';
import { COPY } from '../utils/prompts';

interface SettingsDrawerProps {
  open: boolean;
  lang: Language;
  voiceEnabled: boolean;
  voiceSupported: boolean;
  onClose: () => void;
  onSelectLanguage: (lang: Language) => void;
  onToggleVoice: () => void;
}

export function SettingsDrawer({
  open,
  lang,
  voiceEnabled,
  voiceSupported,
  onClose,
  onSelectLanguage,
  onToggleVoice,
}: SettingsDrawerProps) {
  if (!open) return null;

  const t = COPY[lang];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t.settingsTitle}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full sm:max-w-md bg-[#0E1015] border-t sm:border border-white/15 rounded-t-3xl sm:rounded-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[#FAFAFA] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold tracking-tight">{t.settingsTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeSettings}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Language Toggle EN / FR */}
        <div className="mb-6">
          <div className="text-sm font-semibold text-neutral-300 mb-3">
            {t.languageLabel}
          </div>
          <div className="grid grid-cols-2 gap-3" role="group" aria-label={t.languageLabel}>
            <button
              type="button"
              onClick={() => onSelectLanguage('en')}
              aria-pressed={lang === 'en'}
              className={`min-h-[56px] rounded-2xl font-bold text-lg transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                lang === 'en'
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              English (EN)
            </button>
            <button
              type="button"
              onClick={() => onSelectLanguage('fr')}
              aria-pressed={lang === 'fr'}
              className={`min-h-[56px] rounded-2xl font-bold text-lg transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                lang === 'fr'
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              Français (FR)
            </button>
          </div>
        </div>

        {/* Voice Commands Toggle */}
        <div className="mb-6 pb-6 border-b border-white/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-neutral-200">{t.voiceLabel}</div>
              {!voiceSupported && (
                <p className="text-xs text-neutral-400 mt-1">{t.voiceUnsupported}</p>
              )}
            </div>
            <button
              type="button"
              disabled={!voiceSupported}
              onClick={onToggleVoice}
              aria-pressed={voiceEnabled && voiceSupported}
              className={`min-h-[48px] px-5 rounded-2xl font-semibold text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-40 ${
                voiceEnabled && voiceSupported
                  ? 'bg-amber-400 text-black'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              {voiceEnabled && voiceSupported ? (
                <>
                  <Mic className="w-4 h-4" />
                  <span>{t.voiceOn}</span>
                </>
              ) : (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>{t.voiceOff}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Gesture & Voice Guide */}
        <div className="space-y-4 text-sm text-neutral-300 mb-6">
          <div>
            <div className="font-semibold text-white mb-1.5">{t.gesturesHeading}</div>
            <ul className="space-y-1 text-neutral-300">
              <li>{t.gestureSingle}</li>
              <li>{t.gestureDouble}</li>
              <li>{t.gestureTriple}</li>
              <li>{t.gestureHold}</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-white mb-1.5">{t.voiceCommandsHeading}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-neutral-300">
              <span>{t.voiceCmdDescribe}</span>
              <span aria-hidden="true">·</span>
              <span>{t.voiceCmdRead}</span>
              <span aria-hidden="true">·</span>
              <span>{t.voiceCmdFind}</span>
              <span aria-hidden="true">·</span>
              <span>{t.voiceCmdRotate}</span>
              <span aria-hidden="true">·</span>
              <span>{t.voiceCmdStop}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[56px] rounded-2xl bg-white text-black font-bold text-base hover:bg-neutral-200 active:scale-[0.99] transition-transform focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          {t.closeSettings}
        </button>
      </div>
    </div>
  );
}
