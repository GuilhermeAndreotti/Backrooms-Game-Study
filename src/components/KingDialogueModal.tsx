import { useEffect, useState } from "react";
import type { TownDialogueChoice, TownDialogueView } from "../game/levels/townDirector";
import { t } from "../i18n";

interface KingDialogueModalProps {
  view: TownDialogueView;
  /** An answer: the King's reply comes back as a new view (or the panel closes). */
  onChoose: (choice: TownDialogueChoice) => void;
}

/** The King's face, drawn the way the old shorts drew him: pie eyes, a grin too wide, the crown. */
function KingPortrait() {
  return (
    <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0" aria-hidden>
      <rect width="120" height="120" fill="#120a08" />
      <circle cx="60" cy="68" r="40" fill="#121212" />
      <ellipse cx="60" cy="72" rx="30" ry="31" fill="#efe2c4" />
      <ellipse cx="48" cy="42" rx="13" ry="16" fill="#efe2c4" />
      <ellipse cx="72" cy="42" rx="13" ry="16" fill="#efe2c4" />
      <ellipse cx="50" cy="56" rx="5" ry="9" fill="#0b0b0b" />
      <ellipse cx="70" cy="56" rx="5" ry="9" fill="#0b0b0b" />
      <ellipse cx="60" cy="70" rx="5" ry="3.5" fill="#7a2a2a" />
      <path d="M34 76 Q60 108 86 76 Q60 90 34 76 Z" fill="#0b0b0b" />
      {[-2, -1, 0, 1, 2].map((i) => <rect key={i} x={57 + i * 7} y={79 + (2 - Math.abs(i)) * 1.5} width="4" height="5" fill="#f8f4e8" />)}
      <path d="M32 30 L38 14 L48 26 L60 10 L72 26 L82 14 L88 30 Z" fill="#d9a830" stroke="#7a5a10" strokeWidth="2" />
      <circle cx="60" cy="22" r="3" fill="#c81e3a" />
    </svg>
  );
}

/** Level 94: the King, still on his throne, makes you an offer. */
export function KingDialogueModal({ view, onChoose }: KingDialogueModalProps) {
  const text = view.lines.join("\n");
  const [shown, setShown] = useState(0);

  // His words come out a letter at a time, like a title card being lettered.
  useEffect(() => {
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= text.length ? n : n + 2)), 22);
    return () => clearInterval(id);
  }, [text]);

  const typing = shown < text.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-6 pb-14" onClick={() => typing && setShown(text.length)}>
      <div className="w-full max-w-2xl border-4 border-double border-[#c9962a] bg-[#0a0705]/95 p-5 shadow-[0_0_50px_rgba(201,150,42,0.25)]">
        <div className="flex gap-4">
          <KingPortrait />
          <div className="min-w-0 flex-1">
            <div className="mb-2 font-serif text-sm font-bold tracking-[0.35em] text-[#d9a830]">{t("town.king.title")}</div>
            <p className="min-h-[4.5rem] whitespace-pre-line font-serif text-lg leading-snug text-[#f4efe2]">
              {text.slice(0, shown)}
              {typing && <span className="animate-pulse">▌</span>}
            </p>
          </div>
        </div>
        <div className={`mt-4 grid gap-2 transition-opacity ${typing ? "pointer-events-none opacity-0" : "opacity-100"}`}>
          {view.options.map((o, i) => (
            <button
              key={o.id}
              onClick={(e) => { e.stopPropagation(); onChoose(o.id); }}
              className={`border px-3 py-2 text-left font-serif text-base transition-colors ${o.secret
                ? "border-[#d9a830] bg-[#2a1d06] text-[#f6d36a] shadow-[0_0_18px_rgba(217,168,48,0.35)] hover:bg-[#3a2a08]"
                : "border-stone-700 bg-black/40 text-stone-200 hover:border-[#c9962a] hover:text-white"}`}
            >
              <span className="mr-2 text-stone-500">{i + 1}.</span>{o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
