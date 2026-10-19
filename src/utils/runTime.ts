/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** A speedrun time: "m:ss.cc", or "h:mm:ss.cc" past an hour. */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10)); // centiseconds
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}` : `${m}:${pad(s)}.${pad(cs)}`;
}
