import logging
from django.db import models
from django.contrib.auth.models import User
from typing import Optional, Dict, List, TypedDict
import random
from django.utils import timezone

from common.models import BaseLobby, BaseLobbyPlayer
from .game_state import DragonGameState, PlayerState, TrickState, CardContext, CardState

logger = logging.getLogger(__name__)

MAX_PLAYERS = 2
WINNING_SCORE = 10
LOWEST_CARD_VALUE = 1


class Lobby(BaseLobby):
    MAX_PLAYERS = MAX_PLAYERS
    players = models.ManyToManyField(
        User, through="LobbyPlayer", related_name="lobby_ditf"
    )


class LobbyPlayer(BaseLobbyPlayer):
    lobby = models.ForeignKey(Lobby, on_delete=models.CASCADE)
    player = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="lobbyplayer_ditf"
    )

    class Meta(BaseLobbyPlayer.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["lobby", "player"],
                name="unique_player_per_dragon_lobby",
            )
        ]

    def __str__(self) -> str:
        return f"{self.player.username} in Lobby {self.lobby.id}"


class Card(models.Model):
    SUIT_CHOICES = [
        ("fire", "Fire"),
        ("earth", "Earth"),
        ("water", "Water"),
    ]
    special_ability_mapping = {  # TODO: add random mappings for different game mode
        "sp1": "Lead the next hand",
        "sp2": "Replace a card in hand with trump card",
        "sp3": "Draw card from deck and discard a card",
        "sp4": "Extra point to whoever wins the trick",
        "sp5": "If only one of this ability is played, the card counts as the trump suit",
        "sp6": "Other player must play their highest card of this suit",
    }

    suit = models.CharField(max_length=10, choices=SUIT_CHOICES)
    value = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["suit", "value"]
        ordering = ["suit", "value"]

    def __str__(self) -> str:
        return f"{self.get_suit_display()} {self.value}"

    def get_special_ability(self) -> Optional[str]:
        """Returns the special ability of the card if it has one."""
        abilities = {1: "sp1", 3: "sp2", 5: "sp3", 7: "sp4", 9: "sp5", 11: "sp6"}
        return abilities.get(self.value)

    def is_special(self) -> bool:
        """Returns whether the card has a special ability."""
        return self.get_special_ability() is not None


class GameState(models.Model):
    lobby = models.OneToOneField(
        Lobby, on_delete=models.CASCADE, related_name="game_state"
    )
    state_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    _state_obj: DragonGameState | None = None

    @property
    def state_obj(self) -> DragonGameState:
        if self._state_obj is None:
            self._state_obj = DragonGameState(**self.state_data)
        return self._state_obj

    @state_obj.setter
    def state_obj(self, value: DragonGameState) -> None:
        self._state_obj = value
        self.state_data = value.model_dump()

    def __str__(self) -> str:
        return f"Dragon Forest Game State {self.id}"

    def save(self, *args, **kwargs) -> None:
        if self._state_obj is not None:
            self.state_data = self._state_obj.model_dump()
        self.last_activity = timezone.now()
        super().save(*args, **kwargs)

    def _initialize_game_state(
        self,
        players: List[User],
        starting_player: str,
        round_number: int = 1,
        current_score: Optional[Dict[str, int]] = None,
    ) -> None:
        """Helper method to initialize or restart game state.

        Args:
            players: List of players in the game
            starting_player: Username of player who should start
            current_score: Optional dict of current score
        """
        all_cards = list(Card.objects.all())
        random.shuffle(all_cards)

        deck_pydantic = [card for card in all_cards]
        player1_cards_pydantic = [deck_pydantic.pop(0) for _ in range(13)]
        player2_cards_pydantic = [deck_pydantic.pop(0) for _ in range(13)]
        trump_card_pydantic = deck_pydantic.pop(0)

        self.state_obj = DragonGameState(
            player1=PlayerState(
                username=players[0].username,
                cards=[
                    CardContext(**card_to_context(p1_card))
                    for p1_card in player1_cards_pydantic
                ],
            ),
            player2=PlayerState(
                username=players[1].username,
                cards=[
                    CardContext(**card_to_context(p2_card))
                    for p2_card in player2_cards_pydantic
                ],
            ),
            trump_card=CardContext(**card_to_context(trump_card_pydantic)),
            deck=[CardContext(**card_to_context(c)) for c in deck_pydantic],
            current_trick=TrickState(),
            previous_trick=TrickState(),
            current_player=starting_player,
            round_number=round_number,
        )
        if current_score:
            self.state_obj.player1.score = current_score["player_1"]
            self.state_obj.player2.score = current_score["player_2"]
        self.save()

    def initialize_game(self) -> None:
        players = list(self.lobby.players.all())
        self._initialize_game_state(players, players[0].username)

    def restart_round(self) -> None:
        players = list(self.lobby.players.all())
        last_starter = self.state_obj.current_player
        new_starter = (
            self.state_obj.player2.username
            if last_starter == self.state_obj.player1.username
            else self.state_obj.player1.username
        )

        current_score = {
            "player_1": self.state_obj.player1.score,
            "player_2": self.state_obj.player2.score,
        }
        round_number = self.state_obj.round_number + 1

        self._initialize_game_state(players, new_starter, round_number, current_score)

    def _validate_move(
        self,
        player: User,
        card_id: int,
        current_trick: TrickState,
        current_player_data: PlayerState,
    ) -> Optional[Dict]:
        if self.state_obj.game_over:
            return {"error": "Game is over"}
        if player.username != self.state_obj.current_player:
            return {"error": "Not your turn"}
        if card_id not in [
            card_context.id for card_context in current_player_data.cards
        ]:
            return {"error": "Card not in hand"}
        if not self._validate_suit_following(
            current_trick, current_player_data, card_id
        ):
            return {"error": "Must follow suit"}
        if not self._validate_high_card_special_ability(
            current_trick, current_player_data, card_id
        ):
            return {"error": "Must play highest card of this suit"}

        return None

    def _handle_trick_completion(
        self, current_trick: TrickState, current_player_data: PlayerState
    ) -> None:
        winner = self._determine_trick_winner()

        extra_points = self._check_extra_point_special_ability(current_trick)
        if winner == self.state_obj.player1.username:
            self.state_obj.player1.tricks_won += 1
            self.state_obj.player1.score += extra_points
        else:
            self.state_obj.player2.tricks_won += 1
            self.state_obj.player2.score += extra_points

        self.state_obj.previous_trick = current_trick.model_copy()
        self.state_obj.last_trick_winner = winner

        if not current_player_data.cards:
            self._handle_round_over()
        else:
            current_trick.cards = []
            current_trick.led_suit = None
            if next_trick_leader := self.state_obj.next_trick_leader:
                self.state_obj.current_player = next_trick_leader
                self.state_obj.next_trick_leader = None
            else:
                self.state_obj.current_player = winner

    def _switch_current_player(self) -> None:
        self.state_obj.current_player = (
            self.state_obj.player2.username
            if self.state_obj.current_player == self.state_obj.player1.username
            else self.state_obj.player1.username
        )

    def make_move(
        self, player_model: User, card_context: CardContext
    ) -> DragonGameState:
        current_trick = self.state_obj.current_trick
        current_player_data = (
            self.state_obj.player1
            if player_model.username == self.state_obj.player1.username
            else self.state_obj.player2
        )

        if validation_error := self._validate_move(
            player_model, card_context.id, current_trick, current_player_data
        ):
            logger.warning("Move validation failed: %s", validation_error)
            return self.state_obj
        current_player_data.cards.remove(card_context)
        current_trick.cards.append(
            CardState(card=card_context, player=player_model.username)
        )
        if not current_trick.led_suit:
            current_trick.led_suit = card_context.suit
        if special_ability := card_context.special_ability:
            if special_ability == "sp1":
                self.state_obj.next_trick_leader = player_model.username
            elif special_ability == "sp2" and len(current_player_data.cards) >= 1:
                self.state_obj.waiting_for_trump_replacement = {
                    "player": player_model.username,
                    "is_first_card": len(current_trick.cards) == 1,
                }
                self.save()
                return self.state_obj
            elif special_ability == "sp3" and current_player_data.cards:
                drawn_card = self.state_obj.deck.pop(0)
                current_player_data.cards.append(drawn_card)
                self.state_obj.waiting_for_discard = {
                    "player": player_model.username,
                    "is_first_card": len(current_trick.cards) == 1,
                    "drawn_card": drawn_card,
                }
                self.save()
                return self.state_obj

        if len(current_trick.cards) == 2:
            self._handle_trick_completion(current_trick, current_player_data)
        else:
            self._switch_current_player()
        self.save()
        return self.state_obj

    def replace_trump_card(
        self, player: User, card_to_replace_id: int
    ) -> DragonGameState:
        if not self.state_obj.waiting_for_trump_replacement:
            logger.warning(
                "No trump replacement pending for player %s", player.username
            )
            return self.state_obj

        if (
            self.state_obj.waiting_for_trump_replacement.get("player")
            != player.username
        ):
            logger.warning("Not %s's turn to replace trump card", player.username)
            return self.state_obj

        p1_turn = self.state_obj.player1.username == player.username
        current_player_state = (
            self.state_obj.player1 if p1_turn else self.state_obj.player2
        )

        card_to_replace_index = None
        if not self.state_obj.trump_card.id == card_to_replace_id:
            for i, card in enumerate(current_player_state.cards):
                if card_to_replace_id == card.id:
                    # Replace the card in hand with the trump card
                    card_to_replace_index = i
                    current_player_state.cards.pop(card_to_replace_index)
                    current_player_state.cards.append(self.state_obj.trump_card)
                    self.state_obj.trump_card = card
                    break
            if card_to_replace_index is None:
                logger.warning(
                    "Card %s not in hand for player %s",
                    card_to_replace_id,
                    player.username,
                )
                return self.state_obj

        # Clear the waiting state
        is_first_card = self.state_obj.waiting_for_trump_replacement["is_first_card"]
        self.state_obj.waiting_for_trump_replacement = None

        # Handle turn management
        if is_first_card:
            self._switch_current_player()
        else:
            # If it was the second card, handle trick completion
            current_trick = self.state_obj.current_trick
            self._handle_trick_completion(current_trick, current_player_state)

        self.save()
        return self.state_obj

    def discard_card(self, player: User, card_to_discard_id: int) -> DragonGameState:
        current_state = self.state_obj
        current_trick = self.state_obj.current_trick
        waiting_state = self.state_obj.waiting_for_discard

        if not waiting_state or waiting_state["player"] != player.username:
            logger.warning("Invalid discard attempt by player %s", player.username)
            return self.state_obj

        p1_turn = current_state.player1.username == player.username
        current_player_state = (
            current_state.player1 if p1_turn else current_state.player2
        )

        card_to_discard_index = None
        for i, card in enumerate(current_player_state.cards):
            if card_to_discard_id == card.id:
                card_to_discard_index = i
                current_player_state.cards.pop(card_to_discard_index)
                break
        if card_to_discard_index is None:
            raise ValueError("Card not in player's hand")

        current_state.waiting_for_discard = None

        # Handle turn management
        if waiting_state["is_first_card"]:
            self._switch_current_player()
        else:
            self._handle_trick_completion(current_trick, current_player_state)
        self.state_obj = current_state
        self.save()
        return current_state

    def _determine_trick_winner(self) -> str:
        """Determine the winner of the current trick.

        Rules:
        1. Trump suit wins over non-trump suits
        2. If no trump suits, first suit played wins
        3. Within the winning suit, higher card value wins
        """
        current_trick = self.state_obj.current_trick
        card1 = Card.objects.get(id=current_trick.cards[0].card.id)
        card2 = Card.objects.get(id=current_trick.cards[1].card.id)
        trump_card = Card.objects.get(id=self.state_obj.trump_card.id)
        trump_suit = trump_card.suit

        # Check if either card is trump suit
        card1_is_trump = card1.suit == trump_suit
        card2_is_trump = card2.suit == trump_suit
        # Check if either card has the special ability to count as trump
        card1_special_trump = card1.get_special_ability() == "sp5"
        card2_special_trump = card2.get_special_ability() == "sp5"

        if card1_special_trump ^ card2_special_trump:
            if card1_special_trump:
                card1_is_trump = True
            else:
                card2_is_trump = True

        # If one card is trump and other isn't, trump wins
        if card1_is_trump and not card2_is_trump:
            return current_trick.cards[0].player
        if card2_is_trump and not card1_is_trump:
            return current_trick.cards[1].player

        # If both cards are trump, higher value wins
        if card1_is_trump and card2_is_trump:
            return (
                current_trick.cards[0].player
                if card1.value > card2.value
                else current_trick.cards[1].player
            )

        # If neither card is trump, first suit wins
        if card1.suit == card2.suit:
            # If same suit, higher value wins
            return (
                current_trick.cards[0].player
                if card1.value > card2.value
                else current_trick.cards[1].player
            )
        else:
            # Different suits, first card wins
            return current_trick.cards[0].player

    def _update_scores(self) -> None:
        scoring_map = {
            tricks: (
                6
                if tricks <= 3 or 7 <= tricks <= 9
                else 1
                if tricks == 4
                else 2
                if tricks == 5
                else 3
                if tricks == 6
                else 0
            )
            for tricks in range(14)
        }
        for player in [self.state_obj.player1, self.state_obj.player2]:
            player.score += scoring_map[player.tricks_won]

        self.save()

    def _validate_suit_following(
        self, current_trick: TrickState, current_player_data: PlayerState, card_id: int
    ) -> bool:
        if current_trick.led_suit is not None:
            card = Card.objects.get(id=card_id)
            if card.suit != current_trick.led_suit:
                # Check if player has any cards of the led suit
                led_suit_cards = [
                    c
                    for c in current_player_data.cards
                    if c.suit == current_trick.led_suit
                ]
                if led_suit_cards:
                    return False
        return True

    def _validate_high_card_special_ability(
        self, current_trick: TrickState, current_player_data: PlayerState, card_id: int
    ) -> bool:
        if len(current_trick.cards) == 1:
            first_card = current_trick.cards[0].card
            if first_card.special_ability == "sp6":
                # Get all cards of the required suit in player's hand
                suit_cards = [
                    c for c in current_player_data.cards if c.suit == first_card.suit
                ]

                # If they have any cards of this suit
                if suit_cards:
                    # Check if the card they're playing is their highest of this suit
                    card = Card.objects.get(id=card_id)
                    if card.suit == first_card.suit:
                        highest_value = max([c.value for c in suit_cards])
                        if (
                            card.value != highest_value
                            and card.value != LOWEST_CARD_VALUE
                        ):  # LOWEST_CARD_VALUE is the exception
                            return False
        return True

    def _check_extra_point_special_ability(self, current_trick: TrickState) -> int:
        extra_points = 0
        for card_data in current_trick.cards:
            if card_data.card.special_ability == "sp4":
                extra_points += 1
        return extra_points

    def _handle_round_over(self) -> None:
        self.state_obj.round_over = True
        self._update_scores()

        player1_score = self.state_obj.player1.score
        player2_score = self.state_obj.player2.score

        if player1_score >= WINNING_SCORE or player2_score >= WINNING_SCORE:
            self.state_obj.game_over = True
            if player1_score > player2_score:
                self.state_obj.winner = self.state_obj.player1.username
            elif player2_score > player1_score:
                self.state_obj.winner = self.state_obj.player2.username
            else:
                self.state_obj.winner = "tie"
        else:
            self.restart_round()


class CardContextDict(TypedDict):
    id: int
    value: int
    suit: str
    special_ability: Optional[str]


def card_to_context(card: Card) -> CardContextDict:
    return {
        "id": card.id,
        "value": card.value,
        "suit": card.suit,
        "special_ability": card.get_special_ability(),
    }
