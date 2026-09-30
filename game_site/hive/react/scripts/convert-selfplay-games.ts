// One-off/dev conversion tool: turns a hive-bot self-play games file
// (`selfplay_games.jsonl` -- one JSON object per line, `history` recorded
// in hivegame.com's UHP-style notation) into a flat JSON array of
// MoveLogEntry[] games. Mostly superseded by AnalysisBoard's own
// "paste a game" loader (which parses a pasted jsonl line the same way, in
// the browser, via ../src/uhpNotation.ts) -- kept around for bulk
// conversion of a whole file at once.
//
// Usage: node scripts/convert-selfplay-games.ts <input.jsonl> <output.json>
// Requires Node >= 22.6 (runs this .ts file directly via type-stripping --
// no enums/namespaces/decorators are used here, so no extra flag needed).

import { readFileSync, writeFileSync } from "node:fs";
import { BASE_PIECE_TYPES } from "hive-core";
import { toMoveLogEntry, type MoveLogEntry } from "../src/moveLog.ts";
import { parseUhpHistory, winnerFromGameStatus, type GameStatus } from "../src/uhpNotation.ts";
import { GameState as HiveGameStateClass, applyMove } from "hive-core";

interface ConvertedGame {
  moves: MoveLogEntry[];
  winner: "white" | "black" | "draw" | null;
}

function convertHistory(history: [string, string][]): MoveLogEntry[] {
  const moves = parseUhpHistory(history, BASE_PIECE_TYPES);
  const state = HiveGameStateClass.newGame(BASE_PIECE_TYPES);
  const entries: MoveLogEntry[] = [];
  for (const move of moves) {
    entries.push(toMoveLogEntry(state, move));
    applyMove(state, move);
  }
  return entries;
}

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("usage: node scripts/convert-selfplay-games.ts <input.jsonl> <output.json>");
    process.exit(1);
  }

  const lines = readFileSync(inputPath, "utf-8").split("\n").filter((l) => l.trim());
  const games: ConvertedGame[] = [];
  let skipped = 0;

  lines.forEach((line, i) => {
    let raw: { history: [string, string][]; game_status?: GameStatus; game_type?: string };
    try {
      raw = JSON.parse(line);
    } catch (err) {
      console.warn(`line ${i}: invalid JSON, skipping (${(err as Error).message})`);
      skipped++;
      return;
    }
    if (raw.game_type !== "Base") {
      // The analysis board's model was only trained on base-piece games
      // (see hiveBotAdapter.ts) -- an expansion-piece game can't be
      // replayed onto its base-only GameState.
      console.warn(`line ${i}: game_type ${JSON.stringify(raw.game_type)} is not "Base", skipping`);
      skipped++;
      return;
    }
    try {
      const moves = convertHistory(raw.history);
      games.push({ moves, winner: winnerFromGameStatus(raw.game_status) });
    } catch (err) {
      console.warn(`line ${i}: ${(err as Error).message}, skipping`);
      skipped++;
    }
  });

  writeFileSync(outputPath, JSON.stringify(games));
  console.log(`wrote ${games.length} game(s) to ${outputPath}${skipped ? ` (skipped ${skipped})` : ""}`);
}

main();
