/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import { t, localeTag } from "../i18n";
import { formatRunTime } from "../utils/runTime";

interface Entry {
  names: string[];
  ms: number;
  at: number;
  cheats: boolean;
}
type Board = "any" | "clean";

interface Props {
  onClose: () => void;
}

/** The server's speedrun boards: lobby -> Level 79's ending, any% and without cheats. */
export const LeaderboardModal: React.FC<Props> = ({ onClose }) => {
  const [board, setBoard] = useState<Board>("any");
  const [data, setData] = useState<Record<Board, Entry[]> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => { if (alive) setData({ any: json.any ?? [], clean: json.clean ?? [] }); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = data?.[board] ?? [];
  const tab = (id: Board, label: string) => (
    <button
      type="button"
      onClick={() => setBoard(id)}
      className={`flex-1 py-2 text-xs uppercase tracking-widest font-bold rounded transition-colors cursor-pointer ${board === id ? "bg-[#deb81d] text-black" : "border border-[#deb81d]/30 text-[#deb81d]/70 hover:text-[#deb81d]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/85 backdrop-blur-sm font-mono px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title"
        className="w-full max-w-lg bg-[#0c0b05] border border-[#a28e3b]/50 rounded-lg p-5 md:p-6 shadow-[0_0_50px_rgba(222,184,29,0.12)] relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label={t("board.close")} className="absolute top-3 right-3 text-[#a28e3b] hover:text-[#deb81d] cursor-pointer">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-1">
          <Trophy className="w-6 h-6 text-[#deb81d]" aria-hidden="true" />
          <h2 id="leaderboard-title" className="text-lg font-black tracking-[0.25em] text-[#deb81d] uppercase">{t("board.title")}</h2>
        </div>
        <p className="text-[11px] text-[#a28e3b]/80 uppercase tracking-wider mb-4">{t("board.subtitle")}</p>

        <div className="flex gap-2 mb-4">
          {tab("any", t("board.any"))}
          {tab("clean", t("board.clean"))}
        </div>

        <div className="min-h-[14rem]">
          {failed ? (
            <p className="text-center text-xs text-red-400 uppercase tracking-wider py-12">{t("board.error")}</p>
          ) : !data ? (
            <p className="text-center text-xs text-[#a28e3b] uppercase tracking-wider py-12">{t("board.loading")}</p>
          ) : list.length === 0 ? (
            <p className="text-center text-xs text-[#a28e3b] uppercase tracking-wider py-12">{t("board.empty")}</p>
          ) : (
            <ol className="space-y-1.5">
              {list.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`flex items-baseline gap-3 px-3 py-2 rounded ${i === 0 ? "bg-[#deb81d]/10 border border-[#deb81d]/30" : "bg-white/[0.03]"}`}>
                  <span className={`w-6 text-right text-xs font-bold ${i === 0 ? "text-[#deb81d]" : "text-[#a28e3b]"}`}>{i + 1}</span>
                  <span className="w-24 shrink-0 text-sm font-black text-[#f2e8cf] tabular-nums">{formatRunTime(e.ms)}</span>
                  <span className="flex-1 min-w-0 truncate text-xs text-[#f2e8cf]/80" title={e.names.join(", ")}>
                    {e.names.join(", ") || "—"}
                    {board === "any" && e.cheats && <span className="ml-2 text-[10px] text-red-400/80 uppercase">{t("board.cheatsTag")}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#a28e3b]/70">{e.at ? new Date(e.at).toLocaleDateString(localeTag()) : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};
