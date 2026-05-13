// Hive enums
export enum HivePieceType {
    QUEEN = "queen",
    ANT = "ant",
    SPIDER = "spider",
    BEETLE = "beetle",
    GRASSHOPPER = "grasshopper",
    // MOSQUITO = "mosquito",
    // LADYBUG = "ladybug",
    // PILLBUG = "pillbug",
  }
  
  // Hex coordinate
  export interface HivePosition {
    q: number;
    r: number;
    s: number;
  }
  
  // A single piece
  export interface HivePieceState {
    id: number;
    piece_type: HivePieceType;
    owner: string;
    position?: HivePosition | null;
    stack_height: number;
    placed: boolean;
  }
  
  // A cell containing stacked pieces
  export interface HiveBoardCell {
    position: HivePosition;
    pieces: HivePieceState[];
  }
  
  // Full board state indexed by stringified hex position
  // (TS can't use object keys typed as objects, so we string-key it)
  export interface HiveBoardState {
    cells: Record<string, HiveBoardCell>;
  }
  
  // One player's state
  export interface HivePlayerState {
    username: string;
    has_placed_queen: boolean;
    pieces_in_hand: HivePieceState[];
    pieces_on_board: HivePieceState[];
  }
  
  // Full Hive game state
  export interface HiveGameState {
    player1_state: HivePlayerState;
    player2_state: HivePlayerState;
    player1_turn: boolean;
    turn_no: number;
  
    board_state: HiveBoardState;
  
    winner?: string | null;
    game_over: boolean;
  }
