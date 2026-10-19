import { useEffect, useRef, useState } from "react";
interface LevelSelectorModalProps {
  isHost: boolean;
  onStart: (level: number) => void;
  onClose: () => void;
}

/** The main route in order, then the secret levels. Labels are the levels' "Level N - Name". */
const LEVELS = [
  ...MAIN_LEVELS.map((level) => [level, false] as const),
  [LEVEL_G, true] as const,
  [OLD_TOWN_LEVEL, true] as const,
];

const COLUMNS = 2;

export function LevelSelectorModal({ isHost, onStart, onClose }: LevelSelectorModalProps) {
  const [selected, setSelected] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move the highlight across the grid, Enter starts the highlighted level, Escape closes.
  // Capture phase + stopImmediatePropagation so App's lobby shortcut (Enter starts Level 0) never sees these keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let next: number | null = null;
      if (e.key === "ArrowRight") next = selected + 1;
      else if (e.key === "ArrowLeft") next = selected - 1;
      else if (e.key === "ArrowDown") next = selected + COLUMNS;
      else if (e.key === "ArrowUp") next = selected - COLUMNS;
      else if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && isHost) onStart(LEVELS[selected][0]);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setSelected(Math.min(LEVELS.length - 1, Math.max(0, next)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected, isHost, onStart, onClose]);

  useEffect(() => {
    buttonRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 font-mono">
      <div className="w-full max-w-md border-2 border-cyan-700 bg-[#07131b] p-6 text-slate-100 shadow-[0_0_45px_rgba(14,165,233,0.2)]">
        <div className="text-xs tracking-[0.3em] text-cyan-300">ROOM // LEVEL SELECTOR</div>
        <h2 className="mt-2 text-2xl font-bold">Escolha o nível inicial</h2>
        <p className="mt-2 text-xs text-slate-400">A escolha do host será aplicada a toda a sala.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {LEVELS.map(([level, secret], i) => (
            <button
              key={level}
              ref={(el) => { buttonRefs.current[i] = el; }}
              disabled={!isHost}
              onClick={() => onStart(level)}
              onMouseEnter={() => setSelected(i)}
              className={`border px-3 py-3 text-left text-sm hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 ${
                i === selected ? "border-cyan-300 bg-cyan-800/60 shadow-[0_0_12px_rgba(103,232,249,0.35)]" : "border-cyan-800 bg-cyan-950/50"
              }`}
            >
              {t(`hud.loc.${level}`)}
              {secret && <span className="ml-1 text-[10px] text-cyan-400/70">· {t("selector.secret")}</span>}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-slate-500">← ↑ → ↓ para navegar · ENTER para confirmar · ESC para fechar</p>
        {!isHost && <p className="mt-4 text-xs text-amber-300">Somente o host pode iniciar a expedição.</p>}
        <button onClick={onClose} className="mt-5 w-full border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-white">FECHAR</button>
      </div>
    </div>
  );
}
import { LEVEL_G, MAIN_LEVELS, OLD_TOWN_LEVEL } from "../game/levels/constants";
import { t } from "../i18n";
