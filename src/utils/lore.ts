/**
 * Procedural Lore Generator for the Backrooms.
 * Generates highly immersive, lore-heavy logs and warnings.
 */

import { t } from "../i18n";

/** Message-key lists; the text is looked up when a note is generated, so it follows the current language. */
const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}.${i}`);
const LOG_TYPES = keys("lore.type", 6);
const AUTHORS = keys("lore.author", 8);
const SECTORS_OR_LEVELS = keys("lore.loc", 5);
const INTROS = keys("lore.intro", 5);
const DETAILED_OBSERVATIONS = keys("lore.obs", 6);
const WARNINGS_OR_INSIGHTS = keys("lore.warn", 5);
const OUTROS = keys("lore.outro", 5);

export interface BackroomsLore {
  title: string;
  author: string;
  date: string;
  location: string;
  content: string;
}

export function generateProceduralLore(seed: number): BackroomsLore {
  // Simple seed-based random to ensure determinism or variety based on seed
  const rand = (s: number) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  let s = seed;
  const nextRand = () => {
    s += 45.729;
    return rand(s);
  };

  const getElement = <T>(arr: T[]): T => {
    const idx = Math.floor(nextRand() * arr.length);
    return arr[idx];
  };

  const type = t(getElement(LOG_TYPES));
  const author = t(getElement(AUTHORS));
  const location = t(getElement(SECTORS_OR_LEVELS));
  
  // Create a realistic date
  const year = 1990 + Math.floor(nextRand() * 37); // between 1990 and 2027
  const month = 1 + Math.floor(nextRand() * 12);
  const day = 1 + Math.floor(nextRand() * 28);
  const hour = Math.floor(nextRand() * 24);
  const min = Math.floor(nextRand() * 60);
  const dateStr = `${day.toString().padStart(2, "0")}/${month.toString().padStart(2, "0")}/${year} ${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;

  const title = `${type} #${Math.floor(nextRand() * 9000 + 1000)}`;

  // Assemble content
  const intro = t(getElement(INTROS));
  const observation = t(getElement(DETAILED_OBSERVATIONS));
  const warning = t(getElement(WARNINGS_OR_INSIGHTS));
  const outro = t(getElement(OUTROS));

  const content = `${intro}\n\n${observation}\n\n${warning}\n\n${outro}`;

  return {
    title,
    author,
    date: dateStr,
    location,
    content
  };
}
