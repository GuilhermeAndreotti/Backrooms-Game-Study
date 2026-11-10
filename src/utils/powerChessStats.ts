/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The player's own record at the lobby's power-chess table ("Xadrez Anômalo"),
 * kept in localStorage, plus the table's achievements. Fed every `pchess_state`
 * frame; each finished game counts once.
 */

import type { Color } from "../shared/chess";
import type { CardId, PowerChessNetState } from "../shared/powerChess";
import { unlockAchievement } from "./achievements";

const STORAGE_KEY = "backrooms_power_chess_stats";

export interface PowerChessStats {
  wins: number;
  losses: number;
  draws: number;
  /** Cards this player has played, by id. */
  cards: Partial<Record<CardId, number>>;
}

const EMPTY: PowerChessStats = { wins: 0, losses: 0, draws: 0, cards: {} };

export function loadPowerChessStats(): PowerChessStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, cards: {} };
    const v = JSON.parse(raw) as Partial<PowerChessStats>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { wins: n(v.wins), losses: n(v.losses), draws: n(v.draws), cards: typeof v.cards === "object" && v.cards ? v.cards : {} };
  } catch {
    return { ...EMPTY, cards: {} };
  }
}

/** The card this player has played the most, if any. */
export function favoriteCard(stats: PowerChessStats): CardId | null {
  let best: CardId | null = null, most = 0;
  for (const [id, count] of Object.entries(stats.cards) as [CardId, number][]) if (count > most) { best = id; most = count; }
  return best;
}

/** Games already counted, so a replayed frame never counts twice. */
const counted = new Set<string>();
/** The last card play already counted (game number : play sequence). */
let lastCardKey = "";

function save(stats: PowerChessStats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* private mode: the record just isn't kept */ }
}

/**
 * A frame arrived: if it ends a game this player sat in, record it and
 * unlock what it earned. Returns the updated stats when something changed.
 */
export function recordPowerChessFrame(state: PowerChessNetState, myId: string): PowerChessStats | null {
  const seat: Color | null = state.white === myId ? "w" : state.black === myId ? "b" : null;
  if (!seat) return null;
  let changed: PowerChessStats | null = null;
  const lc = state.lastCard;
  if (lc && lc.c === seat && `${state.game}:${lc.seq}` !== lastCardKey) {
    lastCardKey = `${state.game}:${lc.seq}`;
    changed = loadPowerChessStats();
    changed.cards[lc.card] = (changed.cards[lc.card] ?? 0) + 1;
    save(changed);
  }
  if (state.status !== "over" || !state.result) return changed;
  const key = `${state.game}:${seat}:${state.white}:${state.black}`;
  if (counted.has(key)) return changed;
  counted.add(key);
  const stats = loadPowerChessStats();
  const r = state.result;
  if (r.winner === seat) stats.wins++;
  else if (r.winner) stats.losses++;
  else stats.draws++;
  save(stats);
  if (r.winner === seat) {
    unlockAchievement("pchess_first_win");
    if (r.reason === "checkmate" && r.card === "noclip") unlockAchievement("pchess_noclip_mate");
    if (state.deficit[seat] >= 5) unlockAchievement("pchess_comeback");
    if (state.cardsPlayed[seat] === 0 && r.reason === "checkmate") unlockAchievement("pchess_pure");
  }
  return stats;
}
