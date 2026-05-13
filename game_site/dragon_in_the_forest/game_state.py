from pydantic import BaseModel
from typing import List, Dict, Optional


class CardContext(BaseModel):
    id: int
    value: int
    suit: str
    special_ability: Optional[str] = None


class CardState(BaseModel):
    card: CardContext
    player: str


class TrickState(BaseModel):
    cards: List[CardState] = []
    led_suit: Optional[str] = None
    trump_suit: Optional[str] = None
    leader: Optional[str] = None


class PlayerState(BaseModel):
    username: str
    cards: List[CardContext]
    tricks_won: int = 0
    score: int = 0


class DragonGameState(BaseModel):
    player1: PlayerState
    player2: PlayerState
    current_trick: TrickState
    previous_trick: TrickState
    trump_card: CardContext
    deck: List[CardContext]
    round_over: bool = False
    game_over: bool = False
    round_number: int = 1
    current_player: str
    last_trick_winner: Optional[str] = None
    waiting_for_trump_replacement: Optional[Dict] = None
    waiting_for_discard: Optional[Dict] = None
    winner: Optional[str] = None
    next_trick_leader: Optional[str] = None
