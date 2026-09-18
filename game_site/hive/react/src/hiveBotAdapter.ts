// Bridges hive-bot-web's engine state (Maps, numeric piece-type enum) and
// this app's existing HiveGameState shape (types.ts, string piece types,
// username-keyed players) so the analysis board can reuse HiveBoardSVG/
// HexCells unchanged -- see GameBoard.tsx for the shape those already
// expect.
//
// The analysis board defaults to base pieces only; AnalysisBoard.tsx's
// expansion toggle lets a user opt into the full ruleset (mosquito/ladybug/
// pillbug). The bot's model (public/models/hive_net_mlp.onnx, see
// analysisWorker.ts) is trained on the full expansion set and used
// regardless of this toggle -- board/movement/notation for either piece
// set are handled the same way either way, this only picks which pieces
// are in play.

import type { GameState, Move, PieceType, Pos } from "hive-bot-web";
import {
  ALL_PIECE_TYPES,
  BASE_PIECE_TYPES,
  DRAW,
  GameState as HiveGameStateClass,
  MoveKind,
  applyMove,
  generateLegalMoves,
} from "hive-bot-web";
import { HivePieceType } from "./types";
import type {
  HiveBoardCell,
  HiveGameState,
  HivePieceState,
  HivePlayerState,
  HivePosition,
} from "./types";

export const ANALYSIS_ENABLED_TYPES = BASE_PIECE_TYPES;
export const EXPANSION_ENABLED_TYPES: ReadonlySet<PieceType> = new Set(ALL_PIECE_TYPES);

// Index i <-> hive-bot-web's PieceType value i (see engine/constants.ts) --
// same ordinal order on both sides, this is just naming them.
const PIECE_TYPE_NAMES: HivePieceType[] = [
  HivePieceType.QUEEN,
  HivePieceType.ANT,
  HivePieceType.SPIDER,
  HivePieceType.BEETLE,
  HivePieceType.GRASSHOPPER,
  HivePieceType.MOSQUITO,
  HivePieceType.LADYBUG,
  HivePieceType.PILLBUG,
];

function pieceTypeFromName(name: HivePieceType): PieceType {
  return PIECE_TYPE_NAMES.indexOf(name) as PieceType;
}

// "owner" in this app's types is a username string (HexCell3D looks up its
// piece image as `${owner}_${piece_type}.svg`), so these need to literally
// be "white"/"black" -- not arbitrary display names.
export const OWNER_USERNAMES: [string, string] = ["white", "black"];

function posToHivePosition([q, r, s]: Pos): HivePosition {
  return { q, r, s };
}

function toHivePieceState(state: GameState, pieceId: number): HivePieceState {
  const piece = state.pieces.get(pieceId)!;
  const pos = state.position.get(pieceId) ?? null;
  return {
    id: piece.id,
    piece_type: PIECE_TYPE_NAMES[piece.pieceType],
    owner: OWNER_USERNAMES[piece.owner],
    position: pos ? posToHivePosition(pos) : null,
    stack_height: pos ? state.stackIndexOf(pieceId) : 0,
    placed: pos !== null,
  };
}

export function toHiveGameState(state: GameState): HiveGameState {
  const cells: Record<string, HiveBoardCell> = {};
  for (const [key, stack] of state.board) {
    const [q, r, s] = key.split(",").map(Number);
    cells[key] = {
      position: { q, r, s },
      pieces: stack.map((id) => toHivePieceState(state, id)),
    };
  }

  const players: [HivePlayerState, HivePlayerState] = [0, 1].map((owner) => ({
    username: OWNER_USERNAMES[owner as 0 | 1],
    has_placed_queen: state.queenPlaced[owner as 0 | 1],
    pieces_in_hand: state.hand[owner as 0 | 1].map((id) => toHivePieceState(state, id)),
    pieces_on_board: state
      .piecesOnBoard(owner as 0 | 1)
      .map((id) => toHivePieceState(state, id)),
  })) as [HivePlayerState, HivePlayerState];

  let winner: string | null = null;
  if (state.winner !== null) {
    winner = state.winner === DRAW ? "draw" : OWNER_USERNAMES[state.winner as 0 | 1];
  }

  return {
    player1_state: players[0],
    player2_state: players[1],
    player1_turn: state.currentPlayer === 0,
    turn_no: state.turnNo,
    board_state: { cells },
    winner,
    game_over: state.gameOver,
  };
}

/** Drag-and-drop of a piece already on the board or in hand -- resolves to
 * the matching legal Move, or undefined if the drop isn't actually legal.
 * In-hand pieces are matched by *type* (any piece of that type is
 * interchangeable -- see moves.ts), on-board pieces by exact identity. */
export function attemptMove(
  state: GameState,
  piece: HivePieceState,
  dest: HivePosition,
): Move | undefined {
  const destPos: Pos = [dest.q, dest.r, dest.s];
  const destKey = destPos.join(",");
  const legal = generateLegalMoves(state);

  if (!piece.placed) {
    const pieceType = pieceTypeFromName(piece.piece_type);
    return legal.find(
      (m) =>
        m.kind === MoveKind.PLACE &&
        state.pieces.get(m.pieceId)!.pieceType === pieceType &&
        m.to.join(",") === destKey,
    );
  }
  return legal.find(
    (m) => m.kind === MoveKind.MOVE && m.pieceId === piece.id && m.to.join(",") === destKey,
  );
}

/** A deep-enough copy of `state` to apply a move to without touching the
 * original -- for previewing "what would the position look like after
 * this move" (see AnalysisBoard's move-list hover preview) without
 * disturbing the live game (`applyMove` mutates in place). */
function cloneGameState(state: GameState): GameState {
  const clone = new HiveGameStateClass(
    new Map(state.pieces),
    new Map([...state.board].map(([key, stack]) => [key, [...stack]])),
    new Map(state.position),
    [[...state.hand[0]], [...state.hand[1]]],
    [...state.queenPlaced] as [boolean, boolean],
    state.currentPlayer,
    state.turnNo,
    state.ply,
  );
  clone.lastMovedPieceId = state.lastMovedPieceId;
  clone.lastMovedPly = state.lastMovedPly;
  clone.gameOver = state.gameOver;
  clone.winner = state.winner;
  clone.positionCounts = new Map(state.positionCounts);
  return clone;
}

/** The resulting `HiveGameState` after hypothetically playing `move` from
 * `state`, without mutating `state` itself. */
export function previewAfterMove(state: GameState, move: Move): HiveGameState {
  const clone = cloneGameState(state);
  applyMove(clone, move);
  return toHiveGameState(clone);
}

/** Completing a pillbug throw (a separate UI flow in HiveBoardSVG from
 * plain drag-and-drop -- see its armedPillbug/throwTarget props). */
export function findThrowMove(
  state: GameState,
  pillbug: HivePieceState,
  target: HivePieceState,
  dest: HivePosition,
): Move | undefined {
  const destKey = `${dest.q},${dest.r},${dest.s}`;
  return generateLegalMoves(state).find(
    (m) =>
      m.kind === MoveKind.THROW &&
      m.pieceId === pillbug.id &&
      m.thrownPieceId === target.id &&
      m.to.join(",") === destKey,
  );
}
