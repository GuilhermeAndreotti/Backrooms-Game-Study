/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A per-level, authority-local record of which grid cells the explorers
 * have actually walked through, and how often — for O Ceifador to bias
 * where it appears/ambushes toward routes the group keeps re-using,
 * rather than a uniform-random spot. Not replicated: like the noise bus
 * and Finger King's aggression ramp, this only needs to exist wherever a
 * level's AI actually runs.
 */

export interface VisitedCell {
  gx: number;
  gz: number;
  count: number;
}

export class VisitTracker {
  private counts = new Map<string, number>();
  /** Last cell recorded per tracker id, so standing still doesn't rack up visits every frame. */
  private lastCellByTracker = new Map<string, string>();

  /** Records a visit to (gx, gz) by `trackerId` (e.g. a player id) — a no-op if they're still in the same cell as their last recorded visit. */
  visit(trackerId: string, gx: number, gz: number) {
    const cellKey = `${gx},${gz}`;
    if (this.lastCellByTracker.get(trackerId) === cellKey) return;
    this.lastCellByTracker.set(trackerId, cellKey);
    this.counts.set(cellKey, (this.counts.get(cellKey) ?? 0) + 1);
  }

  countAt(gx: number, gz: number): number {
    return this.counts.get(`${gx},${gz}`) ?? 0;
  }

  /**
   * The `n` most-visited cells, most-visited first. When `avoidGx`/`avoidGz`
   * are given, cells within `excludeRadiusCells` of that point are skipped —
   * e.g. the target's own current position, so an ambush doesn't spawn on
   * top of them.
   */
  mostVisited(n: number, avoidGx?: number, avoidGz?: number, excludeRadiusCells = 0): VisitedCell[] {
    const entries: VisitedCell[] = [];
    for (const [key, count] of this.counts) {
      const [gx, gz] = key.split(",").map(Number);
      if (avoidGx !== undefined && avoidGz !== undefined) {
        const dx = gx - avoidGx, dz = gz - avoidGz;
        if (dx * dx + dz * dz <= excludeRadiusCells * excludeRadiusCells) continue;
      }
      entries.push({ gx, gz, count });
    }
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, n);
  }

  clear() {
    this.counts.clear();
    this.lastCellByTracker.clear();
  }
}
