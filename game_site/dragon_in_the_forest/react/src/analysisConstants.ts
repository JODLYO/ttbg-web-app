import { LEVELS, type Level } from "dragon-forest-bot-web";

// How much thinking the analysis board asks of the bot. Unlike a move in a game (25 CFR
// iterations, the setting the value net was evaluated under), analysis keeps refining so
// the displayed strategy settles -- each iteration is roughly 60ms in the browser.
export const DEFAULT_ANALYSIS_ITERATIONS = 100;
export const ANALYSIS_ITERATIONS_INCREMENT = 100;

export const LEVEL_STORAGE_KEY = "dragon-in-the-forest.level";

/** The computer level last chosen in this browser (LevelPicker saves it). */
export function savedLevel(fallback: Level = "medium"): Level {
  try {
    const saved = localStorage.getItem(LEVEL_STORAGE_KEY);
    return LEVELS.includes(saved as Level) ? (saved as Level) : fallback;
  } catch {
    return fallback;
  }
}
