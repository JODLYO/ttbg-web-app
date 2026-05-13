from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field
from enum import Enum

HEX_DIRS: List[Tuple[int, int, int]] = [
    (1, -1, 0),
    (1, 0, -1),
    (0, 1, -1),
    (-1, 1, 0),
    (-1, 0, 1),
    (0, -1, 1),
]


class HivePieceType(str, Enum):
    QUEEN = "queen"
    ANT = "ant"
    SPIDER = "spider"
    BEETLE = "beetle"
    GRASSHOPPER = "grasshopper"
    # Expansion pieces in future:
    # MOSQUITO = "mosquito"
    # LADYBUG = "ladybug"
    # PILLBUG = "pillbug"


class HivePosition(BaseModel):
    """Cube hex coordinate system: q + r + s == 0."""

    q: int
    r: int
    s: int

    def is_adjacent_to(self, other: "HivePosition") -> bool:
        return any(
            self.q + dq == other.q and self.r + dr == other.r and self.s + ds == other.s
            for dq, dr, ds in HEX_DIRS
        )

    def __hash__(self):
        return hash((self.q, self.r, self.s))

    def __eq__(self, other):
        return isinstance(other, HivePosition) and (self.q, self.r, self.s) == (
            other.q,
            other.r,
            other.s,
        )


class HivePieceState(BaseModel):
    id: int
    piece_type: HivePieceType
    owner: str
    position: Optional[HivePosition] = None
    stack_height: int = 1
    placed: bool = False


class HivePlayerState(BaseModel):
    username: str
    has_placed_queen: bool = False
    pieces_in_hand: List[HivePieceState] = Field(default_factory=list)
    pieces_on_board: List[HivePieceState] = Field(default_factory=list)


class HiveBoardCell(BaseModel):
    """One hex cell on the board with a stack of pieces."""

    position: HivePosition
    pieces: List[HivePieceState] = Field(default_factory=list)


class HiveBoardState(BaseModel):
    cells: Dict[HivePosition, HiveBoardCell] = Field(default_factory=dict)

    def to_json_dict(self) -> Dict[str, dict]:
        """Convert board to JSON-friendly dict with string keys."""
        return {
            f"{pos.q},{pos.r},{pos.s}": cell.model_dump()
            for pos, cell in self.cells.items()
        }


class HiveGameState(BaseModel):
    player1_state: HivePlayerState
    player2_state: HivePlayerState
    player1_turn: bool
    turn_no: int = 1

    board_state: HiveBoardState = Field(default_factory=HiveBoardState)

    winner: Optional[str] = None
    game_over: bool = False

    def to_json_data(self) -> dict:
        data = self.model_dump(exclude={"board_state"})
        data["board_state"] = {"cells": self.board_state.to_json_dict()}
        return data
