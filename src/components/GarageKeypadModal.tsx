import React, { useEffect, useRef, useState } from "react";
import { Monitor, X } from "lucide-react";
import { CAR_COLOR_HEX, type CarColor } from "../game/levels/garageLayout";
import { t, useLanguage } from "../i18n";

export interface GarageKeypadResult {
  /** Digits locked in so far (null = still open). */
  locked: (string | null)[];
  /** Every digit is right: the shutter is going up. */
  ok: boolean;
}

interface GarageKeypadModalProps {
  /** The colours in the order the code asks for them. */
  colors: string[];
  /** Digits already locked in from an earlier visit to the keypad. */
  initialLocked: (string | null)[];
  /** Checks the whole code; right digits stay locked from then on. */
  onSubmit: (entered: string[]) => GarageKeypadResult;
  onClose: () => void;
}

const hex = (c: string) => `#${(CAR_COLOR_HEX[c as CarColor] ?? 0x888888).toString(16).padStart(6, "0")}`;

/**
 * Level 1, floor 2's shutter keypad: one digit per car colour. A digit that is
 * right locks in (and stays, even if you close the panel); only the wrong ones
 * are wiped, so each colour can be recounted on its own.
 */
export const GarageKeypadModal: React.FC<GarageKeypadModalProps> = ({ colors, initialLocked, onSubmit, onClose }) => {
  useLanguage();
  const [locked, setLocked] = useState<(string | null)[]>(initialLocked);
  const [values, setValues] = useState<string[]>(() => colors.map(() => ""));
  const [status, setStatus] = useState<"idle" | "partial" | "denied" | "done">("idle");
  const [gained, setGained] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const firstOpen = (from = 0, l = locked) => {
    for (let i = from; i < colors.length; i++) if (l[i] === null) return i;
    return -1;
  };

  useEffect(() => {
    refs.current[firstOpen()]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const set = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    setValues((v) => v.map((x, k) => (k === i ? digit : x)));
    setStatus("idle");
    if (digit) {
      const next = firstOpen(i + 1);
      if (next >= 0) refs.current[next]?.focus();
    }
  };

  const ready = colors.every((_c, i) => locked[i] !== null || values[i] !== "");
  const lockedCount = locked.filter((d) => d !== null).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || status === "done") return;
    const result = onSubmit(colors.map((_c, i) => locked[i] ?? values[i]));
    const before = lockedCount;
    const now = result.locked.filter((d) => d !== null).length;
    setLocked(result.locked);
    setGained(now - before);
    if (result.ok) {
      setStatus("done");
      setTimeout(onClose, 900);
      return;
    }
    // Only the wrong ones are wiped.
    setValues(colors.map(() => ""));
    setStatus(now > before ? "partial" : "denied");
    setTimeout(() => refs.current[firstOpen(0, result.locked)]?.focus(), 0);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 font-mono px-4">
      <form
        onSubmit={submit}
        className={`w-full max-w-md bg-[#030a05] border-2 ${status === "done" ? "border-[#3cff7a]" : "border-[#1f7a3a]"} rounded p-6 shadow-[0_0_40px_rgba(60,255,122,0.18)] relative ${status === "denied" ? "animate-pulse" : ""}`}
      >
        <button type="button" onClick={onClose} aria-label={t("term.close")} className="absolute top-3 right-3 text-[#3cff7a]/60 hover:text-[#3cff7a] cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-[#3cff7a] border-b border-[#1f7a3a]/60 pb-2">
          <Monitor className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">{t("garage.keypad.title")}</span>
        </div>

        <p className="mt-4 text-[11px] text-[#3cff7a]/80 uppercase leading-relaxed">{t("garage.keypad.prompt")}</p>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {colors.map((c, i) => {
            const isLocked = locked[i] !== null;
            return (
              <div key={`${c}${i}`} className="flex flex-col items-center gap-1.5">
                <span className="h-3 w-full rounded-sm" style={{ backgroundColor: hex(c) }} />
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#3cff7a]/80">{t(`garage.color.${c}`)}</span>
                <input
                  ref={(el) => { refs.current[i] = el; }}
                  value={isLocked ? locked[i]! : values[i]}
                  disabled={isLocked}
                  onChange={(e) => set(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && values[i] === "") {
                      for (let k = i - 1; k >= 0; k--) if (locked[k] === null) { refs.current[k]?.focus(); break; }
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={t(`garage.color.${c}`)}
                  className={`w-full text-center text-3xl py-2 rounded outline-none border ${isLocked
                    ? "border-[#3cff7a] bg-[#0b2a14] text-[#3cff7a] font-bold"
                    : "border-[#1f7a3a] bg-black text-[#3cff7a] focus:border-[#3cff7a]"}`}
                  placeholder="_"
                />
                <span className={`h-3 text-[9px] font-bold uppercase tracking-widest ${isLocked ? "text-[#3cff7a]" : "text-transparent"}`}>
                  {isLocked ? `✓ ${t("garage.keypad.right")}` : "."}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 h-8 text-[11px] uppercase tracking-wider text-center leading-tight">
          {status === "done" && <span className="text-[#3cff7a] font-bold">{t("garage.keypad.done")}</span>}
          {status === "partial" && <span className="text-amber-400 font-bold">{t("garage.keypad.partial", { n: lockedCount, total: colors.length, gained })}</span>}
          {status === "denied" && <span className="text-red-500 font-bold">{t("garage.keypad.none")}</span>}
          {status === "idle" && <span className="text-[#3cff7a]/50">{lockedCount}/{colors.length}</span>}
        </div>

        <button
          type="submit"
          disabled={!ready || status === "done"}
          className="mt-2 w-full bg-[#1f7a3a] hover:bg-[#2a9b4b] disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold uppercase tracking-widest py-2.5 rounded text-xs cursor-pointer"
        >
          {t("term.authorize")}
        </button>
        <div className="mt-3 text-[9px] text-[#3cff7a]/40 uppercase text-center">{t("term.esc")}</div>
      </form>
    </div>
  );
};
