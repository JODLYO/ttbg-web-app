from pydantic import BaseModel, Field
from typing import Dict, List, Optional


class SetGameState(BaseModel):
    deck: List[int] = Field(default_factory=list)
    board: Dict[str, int] = Field(default_factory=dict)
    selected_sets: List[List[int]] = Field(default_factory=list)
    scores: Dict[str, int] = Field(default_factory=dict)
    game_over: Optional[bool] = None
    rematch_status: Optional[Dict[str, bool]] = None
    player_ids: Optional[List[int]] = None
