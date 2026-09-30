import { useEffect, useState } from "react";
import type { SpaceTerminalView } from "../game/levels/spaceDirector";
import type { SpaceTarget } from "../game/levels/spaceLayout";
import { t } from "../i18n";

interface SpaceTerminalModalProps {
  /** The terminal's live page; polled, since sequences change it while it's open. null once the level is gone. */
  getView: () => SpaceTerminalView | null;
  onChoose: (target: SpaceTarget) => void;
  onExecute: () => void;
  onAbort: () => void;
  onClose: () => void;
}

const TONE: Record<SpaceTerminalView["tone"], { border: string; text: string; bar: string }> = {
  idle: { border: "border-cyan-700", text: "text-cyan-200", bar: "bg-cyan-700 text-[#03121a]" },
  ok: { border: "border-green-600", text: "text-green-300", bar: "bg-green-600 text-[#021407]" },
  warn: { border: "border-amber-600", text: "text-amber-200", bar: "bg-amber-600 text-[#171002]" },
  alert: { border: "border-red-600", text: "text-red-300", bar: "bg-red-600 text-[#1a0303]" },
  dim: { border: "border-slate-800", text: "text-slate-500", bar: "bg-slate-800 text-slate-400" },
};

/** Level 79's terminals: read-outs, the three navigation consoles, and the helm's EXECUTE. */
export function SpaceTerminalModal({ getView, onChoose, onExecute, onAbort, onClose }: SpaceTerminalModalProps) {
  const [view, setView] = useState<SpaceTerminalView | null>(() => getView());

  useEffect(() => {
    const id = setInterval(() => setView(getView()), 200);
    return () => clearInterval(id);
  }, [getView]);

  useEffect(() => {
    if (!view) onClose();
  }, [view, onClose]);

  const choose = (target: SpaceTarget) => {
    onChoose(target);
    setView(getView());
  };
  const execute = () => {
    onExecute();
    setView(getView());
  };
  const abort = () => {
    onAbort();
    setView(getView());
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (view?.options && n >= 1 && n <= view.options.length) choose(view.options[n - 1].target);
      else if (event.key === "Enter" && view?.canExecute) execute();
      else if (event.key === "Enter" && view?.canAbort) abort();
      else if (event.key === "Escape" || event.key.toLowerCase() === "e") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!view) return null;
  const tone = TONE[view.tone];
  const interactive = !!view.options || view.canExecute !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono">
      <div className={`w-full max-w-lg border-2 ${tone.border} bg-[#020a10]/95 shadow-[0_0_40px_rgba(56,189,248,0.15)]`}>
        <div className={`px-4 py-2 text-sm font-bold tracking-[0.25em] ${tone.bar}`}>{view.title}</div>
        <pre className={`max-h-[50vh] overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed ${tone.text}`}>{view.lines.join("\n")}</pre>
        {view.options && (
          <div className="grid gap-2 px-4 pb-3">
            {view.options.map((o, i) => (
              <button
                key={o.target}
                disabled={view.locked}
                onClick={() => choose(o.target)}
                className={`flex items-center justify-between border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                  o.selected ? "border-cyan-300 bg-cyan-900/50 text-white" : "border-cyan-900 bg-cyan-950/30 text-cyan-200 hover:border-cyan-400"
                }`}
              >
                <span>{i + 1}. {o.selected ? "▶ " : ""}{o.label}</span>
                {o.tag && <span className="text-[10px] tracking-widest text-cyan-400/80">{o.tag}</span>}
              </button>
            ))}
          </div>
        )}
        {view.canExecute !== undefined && (
          <div className="px-4 pb-3">
            {view.canAbort ? (
              <button
                onClick={abort}
                className="w-full animate-pulse border border-red-500 bg-red-950/50 px-3 py-2 text-sm font-bold tracking-[0.3em] text-red-200 hover:bg-red-900/60"
              >
                {t("space.term.abort")}
              </button>
            ) : (
              <button
                disabled={!view.canExecute}
                onClick={execute}
                className="w-full border border-amber-500 bg-amber-950/40 px-3 py-2 text-sm font-bold tracking-[0.3em] text-amber-200 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("space.term.execute")}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-cyan-950 px-4 py-2 text-[10px] uppercase tracking-widest text-slate-500">
          <span>{interactive ? t("space.term.hint") : t("space.term.hintRead")}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white">{t("space.term.close")}</button>
        </div>
      </div>
    </div>
  );
}
