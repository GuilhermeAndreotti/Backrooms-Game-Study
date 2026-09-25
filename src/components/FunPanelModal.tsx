import { useEffect, useState } from "react";
import { PANEL_BUTTONS } from "../game/levels/funLayout";
import { PARTY_COLORS, type PartySymbol } from "../game/LevelFunModels";
import { t } from "../i18n";

interface FunPanelModalProps {
  /** Presses a button; the engine says whether the sequence is still right, wrong, or done. */
  onPress: (index: number) => { result: "ok" | "wrong" | "solved"; progress: number };
  initialProgress: number;
  onClose: () => void;
}

const GLYPH: Partial<Record<PartySymbol, string>> = { heart: "♥", moon: "☾", star: "★", triangle: "▲", circle: "●", square: "■", smile: "=)" };

const css = (color: keyof typeof PARTY_COLORS) => `#${PARTY_COLORS[color].toString(16).padStart(6, "0")}`;

/** Level FUN's door lock: four big party-coloured buttons and a row of lamps. */
export function FunPanelModal({ onPress, initialProgress, onClose }: FunPanelModalProps) {
  const [progress, setProgress] = useState(initialProgress);
  const [message, setMessage] = useState<"none" | "wrong" | "solved">("none");
  const total = 4;

  const press = (index: number) => {
    if (message === "solved") return;
    const { result, progress: next } = onPress(index);
    setProgress(next);
    setMessage(result === "wrong" ? "wrong" : result === "solved" ? "solved" : "none");
    if (result === "solved") setTimeout(onClose, 1100);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (n >= 1 && n <= PANEL_BUTTONS.length) press(n - 1);
      else if (event.key === "Escape" || event.key.toLowerCase() === "e") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-2xl border-4 border-[#e23b3b] bg-[#f6e9c8] p-6 text-center text-[#2a2230] shadow-2xl">
        <div className="mb-1 text-xs font-bold tracking-[0.3em] text-[#a83a3a]">{t("fun.panel.title")}</div>
        <p className="mb-4 text-sm">{t("fun.panel.hint")}</p>
        <div className="mb-5 flex justify-center gap-3">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border-2 border-[#2a2230] ${message === "wrong" ? "bg-[#ff2a2a]" : i < progress ? "bg-[#ffd84a] shadow-[0_0_10px_#ffd84a]" : "bg-[#3a3a3a]"}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {PANEL_BUTTONS.map((b, i) => (
            <button
              key={i}
              onClick={() => press(i)}
              style={{ backgroundColor: css(b.color) }}
              className="flex h-24 items-center justify-center rounded-full border-4 border-white/70 text-5xl font-black text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              aria-label={`${b.symbol} (${i + 1})`}
            >
              {GLYPH[b.symbol] ?? b.symbol}
            </button>
          ))}
        </div>
        <div className="mt-4 h-5 text-sm font-bold">
          {message === "wrong" && <span className="text-[#c0392b]">{t("fun.panel.wrong")}</span>}
          {message === "solved" && <span className="text-[#1f8a3a]">{t("fun.panel.solved")}</span>}
        </div>
        <button onClick={onClose} className="mt-2 px-4 py-1 text-xs text-[#2a2230]/70 hover:text-[#2a2230]">{t("fun.panel.close")}</button>
      </div>
    </div>
  );
}
