/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { t } from "../i18n";
import { formatRunTime } from "../utils/runTime";

interface Props {
  /** Local time (performance.now) the run started at, derived from the server's elapsed time. */
  startedAt: number;
  cheats: boolean;
}

/** Speedrun clock while the expedition is timed (lobby -> Level 79's ending). */
export const RunTimer: React.FC<Props> = ({ startedAt, cheats }) => {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none font-mono flex items-center gap-2 bg-black/55 border border-[#deb81d]/25 rounded px-3 py-1">
      <span className="text-sm font-black text-[#f2e8cf] tabular-nums">{formatRunTime(now - startedAt)}</span>
      <span className={`text-[9px] uppercase tracking-widest ${cheats ? "text-red-400/80" : "text-[#deb81d]/80"}`}>
        {cheats ? t("board.any") : t("board.clean")}
      </span>
    </div>
  );
};
