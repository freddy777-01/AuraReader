import React, { useEffect } from 'react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  appName?: string;
  version?: string;
  creatorName?: string;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  appName = 'AuraReader',
  version = 'v1.0.5',
  creatorName = 'FEMAG',
}) => {
  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      {/* Blurred Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-[#121214] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden z-10 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-32 bg-amber-500/20 blur-3xl pointer-events-none rounded-full" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-all z-20"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Modal Content */}
        <div className="p-6 sm:p-8 space-y-6 relative">
          {/* Header & Logo */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative group">
              <div className="absolute -inset-2 rounded-2xl bg-gradient-to-tr from-amber-500/30 to-amber-300/30 blur-lg animate-pulse" />
              <div className="relative w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center p-1">
                <img
                  src="/app-icon.png"
                  alt={`${appName} Icon`}
                  className="w-full h-full object-contain filter drop-shadow-md"
                />
              </div>
            </div>

            <div>
              {/* Version Pill */}
              <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-mono font-medium mb-1 border border-amber-500/20">
                <span>✨</span>
                <span>{version} • Native Experience</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900 dark:text-white tracking-tight">
                {appName.slice(0, 4)}<span className="text-amber-500">{appName.slice(4)}</span>
              </h2>
              <p className="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400 font-medium">
                Your Sanctuary for Written Stories
              </p>
            </div>
          </div>

          {/* Poetic Dedication Quote */}
          <div className="relative p-4 sm:p-5 rounded-2xl bg-amber-500/5 dark:bg-amber-500/[0.06] border border-amber-500/20 text-center">
            <p className="font-serif italic text-sm text-slate-700 dark:text-amber-100/90 leading-relaxed">
              &ldquo;A story read is a quiet voyage across imagination. In a world full of noise, {appName} was crafted to bring you calm, wonder, and focus for every chapter of your day.&rdquo;
            </p>
          </div>

          {/* Core App Values */}
          <div className="space-y-3">
            <div className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                  Built for Immersion
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal mt-0.5">
                  Thoughtfully refined to let what matters most take center stage without unnecessary clutter.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                  Completely Yours & Offline
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal mt-0.5">
                  Your data stays private on your local machine. No tracking, no accounts, and zero cloud dependencies.
                </p>
              </div>
            </div>
          </div>

          {/* Creators & Dedication Signature */}
          <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex flex-col items-center text-center space-y-1">
            <div className="flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
              <span>Crafted with</span>
              <span className="text-rose-500">❤️</span>
              <span>by</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{creatorName}</span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Dedicated to book lovers, curious minds, and lifelong readers everywhere.
            </p>
          </div>

          {/* Dismiss Button */}
          <div className="pt-1">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-medium text-xs tracking-wide shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

