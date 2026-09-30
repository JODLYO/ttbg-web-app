// The computer's difficulty (see `Level` in the bot package): shared by the vs-computer game
// and the analysis board's computer opponent. The choice is remembered in this browser.

import { LEVELS, type Level } from "dragon-forest-bot-web";
import { LEVEL_STORAGE_KEY } from "./analysisConstants";

const DESCRIPTIONS: Record<Level, string> = {
  easy: "Plays on instinct and makes plenty of mistakes",
  medium: "Plays on instinct: quick, no lookahead",
  hard: "Searches ahead every move: the bot at full strength",
};

interface Props {
  level: Level;
  onChange: (level: Level) => void;
  /** Text before the dropdown; null for the bare dropdown (the caller labels it). */
  label?: string | null;
  id?: string;
}

export default function LevelPicker({
  level,
  onChange,
  label = "Computer",
  id,
}: Props) {
  const select = (
    <select
      id={id}
      className="level-select"
      title={DESCRIPTIONS[level]}
      value={level}
      onChange={(event) => {
        const next = event.target.value as Level;
        try {
          localStorage.setItem(LEVEL_STORAGE_KEY, next);
        } catch {
          // Storage unavailable (private window): the choice just isn't remembered.
        }
        onChange(next);
      }}
    >
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          {l.charAt(0).toUpperCase() + l.slice(1)}
        </option>
      ))}
    </select>
  );
  if (label === null) return select;
  return (
    <label className="level-picker" title={DESCRIPTIONS[level]}>
      {label}: {select}
    </label>
  );
}
