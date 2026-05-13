from typing import List, Tuple, Optional
from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from random import shuffle
from itertools import combinations
from django.utils import timezone
from .game_state import SetGameState
from .validators import game_state_validator
from common.models import BaseLobby, BaseLobbyPlayer, BaseGameState


MAX_PLAYERS = 6
NO_CARDS_IN_SET = 3
DEFAULT_BOARD_SIZE = 12
EXTRA_CARDS_BOARD_SIZE = 15


class Lobby(BaseLobby):
    MAX_PLAYERS = MAX_PLAYERS
    players = models.ManyToManyField(
        User,
        through="LobbyPlayer",
    )
    is_solo = models.BooleanField(default=False)


class LobbyPlayer(BaseLobbyPlayer):
    lobby = models.ForeignKey(Lobby, on_delete=models.CASCADE)

    class Meta(BaseLobbyPlayer.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["lobby", "player"],
                name="unique_player_per_lobby",
            )
        ]

    def __str__(self) -> str:
        return f"{self.player.username} in Lobby {self.lobby.id}"


class GameState(BaseGameState):
    lobby = models.OneToOneField(
        Lobby, on_delete=models.CASCADE, related_name="game_state"
    )


class BaseGameSession(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField(auto_now=True)
    state = models.JSONField(
        default=dict,
        validators=[game_state_validator],
        help_text="Validated SetGame state",
    )
    _state_obj: SetGameState | None = None

    @property
    def state_obj(self) -> SetGameState:
        """Return the in-memory Pydantic object; instantiate if needed."""
        if self._state_obj is None:
            self._state_obj = SetGameState(**self.state)
        return self._state_obj

    @state_obj.setter
    def state_obj(self, value: SetGameState):
        """Assign a Pydantic object and sync to JSONField."""
        self._state_obj = value
        self.state = value.model_dump()

    def save(self, *args, **kwargs):
        if self._state_obj is not None:
            self.state = self._state_obj.model_dump()
        self.last_activity = timezone.now()
        super().save(*args, **kwargs)

    class Meta:
        abstract = True

    def initialize_game(self, players: List[User]) -> None:
        deck = list(Card.objects.all())
        shuffle(deck)
        initial_board_cards, remaining_deck = self._get_initial_board_and_deck(deck)
        scores = {str(player.username): 0 for player in players}

        self.state = {
            "deck": [card.id for card in remaining_deck],
            "board": {str(i): card.id for i, card in enumerate(initial_board_cards)},
            "selected_sets": [],
            "scores": scores,
        }
        self.save()

    def _get_initial_board_and_deck(
        self, deck: List["Card"]
    ) -> Tuple[List["Card"], List["Card"]]:
        initial_board_cards = deck[:DEFAULT_BOARD_SIZE]
        has_set = self.is_set_available([card.id for card in initial_board_cards])
        initial_no_cards = DEFAULT_BOARD_SIZE if has_set else EXTRA_CARDS_BOARD_SIZE
        return deck[:initial_no_cards], deck[initial_no_cards:]

    def validate_set(self, selected_cards: List[int]) -> bool:
        if len(selected_cards) != NO_CARDS_IN_SET:
            return False
        cards = Card.objects.filter(id__in=selected_cards)
        return self._check_set_attributes(cards)

    def _check_set_attributes(self, cards: models.QuerySet) -> bool:
        card_list = list(cards.values("number", "symbol", "shading", "color"))
        for attribute in ["number", "symbol", "shading", "color"]:
            values = {card[attribute] for card in card_list}
            if len(values) not in [
                1,
                NO_CARDS_IN_SET,
            ]:  # a set must all be the same or unique for each attribute
                return False
        return True

    def _remove_cards_from_board(self, card_ids: List[int]) -> None:
        self.state_obj.board = {
            pos: card_id
            for pos, card_id in self.state_obj.board.items()
            if card_id not in card_ids
        }

    def _check_game_end(self) -> None:
        if not self.state_obj.deck and not self.is_set_available():
            self.end_game()

    def add_cards_to_board(self) -> None:
        if len(self.state_obj.board) >= DEFAULT_BOARD_SIZE:
            empty_positions = sorted(
                set(str(i) for i in range(DEFAULT_BOARD_SIZE))
                - self.state_obj.board.keys(),
                key=int,
            )
            extra_positions = sorted(self.state_obj.board.keys(), key=int)[
                -len(empty_positions) :
            ]
            for empty_pos, extra_pos in zip(empty_positions, extra_positions):
                self.state_obj.board[empty_pos] = self.state_obj.board.pop(extra_pos)
        else:
            empty_positions = sorted(
                set(str(i) for i in range(DEFAULT_BOARD_SIZE))
                - self.state_obj.board.keys(),
                key=int,
            )
            self.add_cards_from_deck(NO_CARDS_IN_SET, list(empty_positions))

    def add_cards_from_deck(self, count: int, empty_positions: List[str]) -> None:
        new_cards = self.state_obj.deck[:count]
        self.state_obj.deck = self.state_obj.deck[count:]
        for pos, card_id in zip(empty_positions, new_cards):
            self.state_obj.board[pos] = card_id

    def is_set_available(self, card_ids: Optional[List[int]] = None) -> bool:
        if card_ids is None:
            card_ids = list(self.state_obj.board.values())
        if len(card_ids) < NO_CARDS_IN_SET:
            return False
        for combo in combinations(card_ids, NO_CARDS_IN_SET):
            if self.validate_set(list(combo)):
                return True
        return False

    def handle_no_set_available(self) -> None:
        if not self.is_set_available():
            if self.state_obj.deck:
                next_positions = [
                    str(i)
                    for i in range(
                        len(self.state_obj.board),
                        len(self.state_obj.board) + NO_CARDS_IN_SET,
                    )
                ]
                self.add_cards_from_deck(NO_CARDS_IN_SET, next_positions)
            else:
                self.end_game()

    def end_game(self) -> None:
        self.state_obj.game_over = True


class GameSession(BaseGameSession):
    name = models.CharField(max_length=100)
    players = models.ManyToManyField(User, related_name="game_sessions")

    def __str__(self):
        return self.name

    def initialize_game(self):
        super().initialize_game(list(self.players.all()))

    def validate_and_process_move(
        self, player: User, selected_cards: List[int]
    ) -> None:
        self.refresh_from_db()
        if not self.validate_set(selected_cards):
            raise ValidationError("Invalid set selection")
        self.process_set(player, selected_cards)

    def process_set(self, player: User, card_ids: List[int]) -> None:
        self.state_obj.selected_sets.append(card_ids)
        self.state_obj.scores[str(player.username)] += 1
        self._remove_cards_from_board(card_ids)
        self.add_cards_to_board()
        self.handle_no_set_available()
        self._check_game_end()
        self.save()


class GameSessionSingle(BaseGameSession):
    player = models.ForeignKey(User, on_delete=models.CASCADE)
    sets_found = models.IntegerField(default=0)
    start_time = models.DateTimeField(default=timezone.now)
    TARGET_SETS = 10

    def __str__(self):
        return f"Single Player Game - {self.player.username}"

    def initialize_game(self):
        super().initialize_game([self.player])
        self.sets_found = 0
        self.start_time = timezone.now()
        self.save()

    def validate_and_process_move(self, selected_cards: List[int]) -> None:
        self.refresh_from_db()
        if not self.validate_set(selected_cards):
            raise ValidationError("Invalid set selection")
        self.process_set(selected_cards)

    def process_set(self, card_ids: List[int]) -> None:
        self.state_obj.selected_sets.append(card_ids)
        self.state_obj.scores[str(self.player.username)] += 1
        self.sets_found += 1
        self._remove_cards_from_board(card_ids)
        self.add_cards_to_board()
        self.handle_no_set_available()

        if self.sets_found >= self.TARGET_SETS:
            self.end_game()
        else:
            self._check_game_end()
        self.save()

    def get_elapsed_time(self) -> float:
        return (timezone.now() - self.start_time).total_seconds()


class Card(models.Model):
    """Represents a Set game card with four attributes."""

    number = models.IntegerField()
    symbol = models.CharField(max_length=20)
    shading = models.CharField(max_length=20)
    color = models.CharField(max_length=20)

    def __str__(self) -> str:
        return f"{self.number} {self.shading} {self.color} {self.symbol}"

    class Meta:
        ordering = ["number", "symbol", "shading", "color"]


class GameMove(models.Model):
    session = models.ForeignKey(GameSession, on_delete=models.CASCADE)
    player = models.ForeignKey(User, on_delete=models.CASCADE)
    cards = models.ManyToManyField(Card, related_name="moves")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Move by {self.player} in {self.session}"
