from typing import Optional, Mapping
from pydantic import ValidationError as PydanticValidationError
from django.core.exceptions import ValidationError
from .game_state import SetGameState


def game_state_validator(value: Optional[dict]) -> None:
    if value is None:
        return

    if not isinstance(value, Mapping):
        raise ValidationError("Game state must be a dictionary")

    try:
        SetGameState(**value)
    except (TypeError, PydanticValidationError) as e:
        raise ValidationError(f"Invalid game state: {str(e)}")
