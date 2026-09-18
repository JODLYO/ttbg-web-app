// A single committed move, in a shape that round-trips through JSON exactly
// (no relative/notation resolution needed to replay it -- just the engine's
// own kind/pieceId/to/thrownPieceId, plus pieceType/from for display). Used
// both by AnalysisBoard's "copy move log" bug-report feature and by
// scripts/convert-selfplay-games.ts, which produces files of these for the
// "load game" feature to replay directly.

import { MoveKind, type GameState, type Move, type PieceType } from "hive-bot-web";

export const PIECE_TYPE_LABELS = [
  "Queen",
  "Ant",
  "Spider",
  "Beetle",
  "Grasshopper",
  "Mosquito",
  "Ladybug",
  "Pillbug",
];

export interface MoveLogEntry {
  kind: MoveKind;
  pieceId: number;
  pieceType: PieceType;
  /** The acting piece's position immediately before this move, or null if
   * it was placed from hand. Placements don't need this to disambiguate
   * (any in-hand piece of a type is interchangeable -- see
   * hiveBotAdapter.ts's attemptMove), but a MOVE/THROW does: "Ant to
   * (0,1,2)" is ambiguous with 3 ants in play, while "Ant from (x,y,z) to
   * (0,1,2)" isn't, since two pieces can never share a hex. */
  from: readonly [number, number, number] | null;
  to: readonly [number, number, number];
  thrownPieceId?: number;
  /** THROW only: the thrower's own type -- a Pillbug always, but also a
   * Mosquito copying an adjacent Pillbug's throw ability (see
   * hive-bot-web's engine/moves.ts canThrow), so the description below
   * can't just hardcode "Pillbug throws...". */
  throwerPieceType?: PieceType;
}

/** `state` must be the position immediately *before* `move` is applied. */
export function toMoveLogEntry(state: GameState, move: Move): MoveLogEntry {
  // The human-visible mover for a THROW is the thrown piece, not whatever
  // is doing the throwing (move.pieceId) -- matches describeMoveLogEntry
  // and hive-bot's own move_to_uhp (see uhpNotation.ts).
  const actorId = move.kind === MoveKind.THROW ? move.thrownPieceId! : move.pieceId;
  const pieceType = state.pieces.get(actorId)!.pieceType;
  const from = state.position.get(actorId) ?? null;
  const entry: MoveLogEntry = { kind: move.kind, pieceId: move.pieceId, pieceType, from, to: move.to };
  if (move.thrownPieceId !== undefined) {
    entry.thrownPieceId = move.thrownPieceId;
    entry.throwerPieceType = state.pieces.get(move.pieceId)!.pieceType;
  }
  return entry;
}

/** Inverse of `toMoveLogEntry` -- drops the display-only `pieceType`/`from`. */
export function fromMoveLogEntry(entry: MoveLogEntry): Move {
  const move: Move = { kind: entry.kind, pieceId: entry.pieceId, to: entry.to };
  if (entry.thrownPieceId !== undefined) (move as { thrownPieceId?: number }).thrownPieceId = entry.thrownPieceId;
  return move;
}

/** Human-readable description, e.g. "Move Ant from (0, 1, -1) to (0, 1, 2)"
 * or "Place Queen at (0, 0, 0)". Shared by the move history list and the
 * analysis panel's move descriptions so both read the same way. */
export function describeMoveLogEntry(entry: MoveLogEntry): string {
  return describeMoveLogEntryWithDestinations(entry, [entry.to]);
}

/** Same as `describeMoveLogEntry`, but for an analysis suggestion that's
 * really several symmetric-equivalent moves (see hive-bot-web's
 * openingSymmetry.ts/MoveEvaluation.equivalentMoves) -- lists every
 * destination instead of just the one MCTS happened to search, e.g.
 * "Place Queen at (1, -1, 0), (1, 0, -1), (0, 1, -1), ...". `destinations`
 * must be non-empty; a single-element list reads exactly like
 * `describeMoveLogEntry`. */
export function describeMoveLogEntryWithDestinations(
  entry: MoveLogEntry,
  destinations: readonly (readonly [number, number, number])[],
): string {
  const pieceType = PIECE_TYPE_LABELS[entry.pieceType];
  const toStr = destinations.map((to) => `(${to.join(", ")})`).join(", ");
  if (entry.kind === MoveKind.PLACE) return `Place ${pieceType} at ${toStr}`;
  const fromStr = entry.from ? `(${entry.from.join(", ")})` : "?";
  if (entry.kind === MoveKind.THROW) {
    const throwerType = entry.throwerPieceType !== undefined ? PIECE_TYPE_LABELS[entry.throwerPieceType] : "Pillbug";
    return `${throwerType} throws ${pieceType} from ${fromStr} to ${toStr}`;
  }
  return `Move ${pieceType} from ${fromStr} to ${toStr}`;
}
