// Parses hivegame.com/hive-bot-style recorded games (UHP-ish notation,
// e.g. "wS1"/"-wQ1"/"\\bG1" -- see hive-bot's `selfplay_games.jsonl`) into
// engine `Move`s. Framework-agnostic (no DOM/Node APIs) so it's shared by
// both AnalysisBoard's "paste a game" loader and
// scripts/convert-selfplay-games.ts.
//
// UHP notation encodes each move relative to the board as it stood *at
// that point in the game* (a reference piece's label plus a direction
// symbol, or nothing for climbing onto a stack), so resolving it requires
// replaying the whole game move by move against the engine -- this is a
// straight TS port of hive-bot's Python `data/hivegame_archive.py`
// (`_resolve_position`/`_find_legal_move`/`replay_uhp_game`); see that
// file's docstring for the full grammar and why the HEX_DIRS-derived
// direction assignment below has to match it exactly.

import type { GameState, Move, Owner, PieceType, Pos } from "hive-bot-web";
import { BASE_PIECE_TYPES, GameState as HiveGameStateClass, MoveKind, applyMove, generateLegalMoves } from "hive-bot-web";

export class UhpParseError extends Error {}

const BUG_LETTER_TO_TYPE: Record<string, PieceType> = {
  Q: 0,
  A: 1,
  S: 2,
  B: 3,
  G: 4,
  M: 5,
  L: 6,
  P: 7,
};

// Same NW/NE/E/SE/SW/W assignment over HEX_DIRS as hive-bot's
// hivegame_archive.py -- an internally-consistent labeling (not tied to
// any external standard), so it only has to agree with whatever produced
// this notation, not anything else.
const HEX_DIRS: readonly Pos[] = [
  [1, -1, 0],
  [1, 0, -1],
  [0, 1, -1],
  [-1, 1, 0],
  [-1, 0, 1],
  [0, -1, 1],
];
const [NW, NE, E, SE, SW, W] = HEX_DIRS;
const SUFFIX_TO_OFFSET: Record<string, Pos> = { "-": E, "/": NE, "\\": SE };
const PREFIX_TO_OFFSET: Record<string, Pos> = { "-": W, "/": SW, "\\": NW };
const DIR_SYMBOLS = new Set(["-", "/", "\\"]);

function parsePieceLabel(label: string): { owner: Owner; pieceType: PieceType } {
  const color = label[0];
  const bugLetter = label[1];
  if ((color !== "w" && color !== "b") || !(bugLetter in BUG_LETTER_TO_TYPE)) {
    throw new UhpParseError(`unrecognized piece label ${JSON.stringify(label)}`);
  }
  return { owner: color === "w" ? 0 : 1, pieceType: BUG_LETTER_TO_TYPE[bugLetter] };
}

function resolvePosition(posStr: string, uhpToId: Map<string, number>, state: GameState): Pos {
  if (posStr === "." || posStr === "") return [0, 0, 0];

  let refLabel: string;
  let offset: Pos | null;
  if (DIR_SYMBOLS.has(posStr[0])) {
    refLabel = posStr.slice(1);
    offset = PREFIX_TO_OFFSET[posStr[0]];
  } else if (DIR_SYMBOLS.has(posStr[posStr.length - 1])) {
    refLabel = posStr.slice(0, -1);
    offset = SUFFIX_TO_OFFSET[posStr[posStr.length - 1]];
  } else {
    refLabel = posStr;
    offset = null;
  }

  const refId = uhpToId.get(refLabel);
  const refPos = refId !== undefined ? state.position.get(refId) : undefined;
  if (refId === undefined || !refPos) {
    throw new UhpParseError(
      `position ${JSON.stringify(posStr)} references unplaced piece ${JSON.stringify(refLabel)}`,
    );
  }
  if (offset === null) return refPos; // climbing directly on top of refLabel
  return [refPos[0] + offset[0], refPos[1] + offset[1], refPos[2] + offset[2]];
}

function findLegalMove(
  state: GameState,
  moves: Move[],
  pieceId: number | null,
  pieceType: PieceType,
  dest: Pos,
): Move {
  const destKey = dest.join(",");
  for (const move of moves) {
    if (move.to.join(",") !== destKey) continue;
    if (move.kind === MoveKind.PLACE) {
      if (pieceId === null && state.pieces.get(move.pieceId)!.pieceType === pieceType) return move;
    } else if (move.kind === MoveKind.MOVE) {
      if (move.pieceId === pieceId) return move;
    } else if (move.thrownPieceId === pieceId) {
      return move;
    }
  }
  const kind = pieceId === null ? "PLACE" : "MOVE/THROW";
  throw new UhpParseError(`no legal ${kind} move to ${destKey} (pieceType=${pieceType})`);
}

/** Replays `history` (list of [pieceLabel, positionString] UHP entries,
 * "pass" pieceLabel for a forfeited turn) against a scratch
 * `GameState.newGame(enabledTypes)`, returning the matching sequence of
 * legal engine `Move`s. Throws `UhpParseError` on the first entry that
 * doesn't correspond to a legal move -- either a notation bug or a genuine
 * rules mismatch. `enabledTypes` defaults to base pieces only, matching the
 * analysis board's own `newGame()` (see hiveBotAdapter.ts). */
export function parseUhpHistory(
  history: readonly (readonly [string, string])[],
  enabledTypes: ReadonlySet<PieceType> = BASE_PIECE_TYPES,
): Move[] {
  const state = HiveGameStateClass.newGame(enabledTypes);
  const uhpToId = new Map<string, number>();
  const moves: Move[] = [];

  for (const [pieceLabel, posStr] of history) {
    if (pieceLabel === "pass") continue;
    const { owner, pieceType } = parsePieceLabel(pieceLabel);
    const isPlacement = !uhpToId.has(pieceLabel);
    // Only a *placement* is necessarily the mover's own piece. A move/throw
    // label can legitimately belong to either player: a pillbug (or a
    // mosquito copying one) can throw an allied piece just as legally as
    // an enemy one, so the UHP-visible "mover" for a throw is the thrown
    // piece, not whoever's turn it is -- see findLegalMove, which already
    // validates the move is actually legal for state.currentPlayer.
    if (isPlacement && owner !== state.currentPlayer) {
      throw new UhpParseError(
        `${pieceLabel} belongs to player ${owner}, but it's player ${state.currentPlayer}'s turn`,
      );
    }
    const dest = resolvePosition(posStr, uhpToId, state);
    const legal = generateLegalMoves(state);
    const pieceId = isPlacement ? null : uhpToId.get(pieceLabel)!;
    const move = findLegalMove(state, legal, pieceId, pieceType, dest);
    if (isPlacement) uhpToId.set(pieceLabel, move.pieceId);
    applyMove(state, move);
    moves.push(move);
  }
  return moves;
}

export type GameStatus = { Finished?: { Winner?: "White" | "Black" } | { Draw: null } };

export interface RawRecordedGame {
  history: [string, string][];
  game_status?: GameStatus;
  game_type?: string;
}

/** "white" | "black" | "draw" | null (still in progress, or a status shape
 * this doesn't recognize) -- mirrors hive-bot's `winner_from_game_status`. */
export function winnerFromGameStatus(status: GameStatus | undefined): "white" | "black" | "draw" | null {
  const finished = status?.Finished;
  if (!finished) return null;
  if ("Winner" in finished && finished.Winner) return finished.Winner === "White" ? "white" : "black";
  if ("Draw" in finished) return "draw";
  return null;
}
