/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side speedrun leaderboard: lobby start (Level 0) to Level 79's
 * ending. Two boards — "any" (every finished run) and "clean" (runs whose
 * room never unlocked a cheat). Kept in memory and persisted to one small
 * JSON file (written atomically, debounced), so a restart keeps the times.
 */

import fs from "fs";
import path from "path";

export type Board = "any" | "clean";

export interface LeaderboardEntry {
  /** Explorers on the expedition when it finished. */
  names: string[];
  /** Run time in milliseconds. */
  ms: number;
  /** When it finished (epoch ms). */
  at: number;
  /** The room had cheats unlocked (always false on the clean board). */
  cheats: boolean;
}

/** Entries kept per board. */
const KEEP = 10;
const SAVE_DELAY_MS = 1000;

function sanitizeEntry(value: unknown): LeaderboardEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.ms !== "number" || !Number.isFinite(e.ms) || e.ms <= 0) return null;
  const names = Array.isArray(e.names) ? e.names.filter((n): n is string => typeof n === "string").slice(0, 8) : [];
  return { names, ms: e.ms, at: typeof e.at === "number" ? e.at : 0, cheats: e.cheats === true };
}

export class Leaderboard {
  private boards: Record<Board, LeaderboardEntry[]> = { any: [], clean: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      for (const board of ["any", "clean"] as Board[]) {
        const list = Array.isArray(raw[board]) ? raw[board] as unknown[] : [];
        this.boards[board] = list.map(sanitizeEntry).filter((e): e is LeaderboardEntry => !!e)
          .sort((a, b) => a.ms - b.ms).slice(0, KEEP);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`Leaderboard: could not read ${file}:`, err);
    }
  }

  /** Both boards, fastest first. */
  snapshot(): Record<Board, LeaderboardEntry[]> {
    return { any: [...this.boards.any], clean: [...this.boards.clean] };
  }

  /** Records a finished run on `board`; returns its place (1-based), or null if it didn't make the board. */
  add(board: Board, entry: LeaderboardEntry): number | null {
    const list = this.boards[board];
    list.push(entry);
    list.sort((a, b) => a.ms - b.ms);
    const place = list.indexOf(entry) + 1;
    list.length = Math.min(list.length, KEEP);
    this.scheduleSave();
    return place <= KEEP ? place : null;
  }

  /** Writes whatever is pending right now (shutdown). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY_MS);
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.boards));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`Leaderboard: could not write ${this.file}:`, err);
    }
  }
}
