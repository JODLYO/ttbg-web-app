from django.db import models
from django.contrib.auth.models import User
from typing import Optional, List
from common.models import BaseLobby, BaseLobbyPlayer
from .game_state import (
    HiveGameState,
    HivePlayerState,
    HivePieceState,
    HiveBoardState,
    HivePosition,
    HivePieceType,
    HiveBoardCell,
)
from .helpers import (
    can_slide_path,
    hive_is_connected,
    beetle_move_valid,
    grasshopper_jump_valid,
    check_valid_piece_from_hand_move,
    hiveboard_from_json_dict,
    is_queen_surrounded,
    rebuild_pieces_on_board,
)

MAX_PLAYERS = 2
TURN_NUMBER_QUEEN_MUST_BE_PLACED = 3


class Lobby(BaseLobby):
    MAX_PLAYERS = MAX_PLAYERS
    players = models.ManyToManyField(
        User, through="LobbyPlayer", related_name="lobby_hive"
    )


class LobbyPlayer(BaseLobbyPlayer):
    lobby = models.ForeignKey(Lobby, on_delete=models.CASCADE)
    player = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="lobbyplayer_hive"
    )

    class Meta(BaseLobbyPlayer.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["lobby", "player"],
                name="unique_player_per_hive_lobby",
            )
        ]

    def __str__(self) -> str:
        return f"{self.player.username} in Lobby {self.lobby.id}"


class Piece(models.Model):
    """Represents a type of Hive piece, not a specific instance in a game."""

    PIECE_TYPE_CHOICES = [
        ("queen", "Queen Bee"),
        ("ant", "Soldier Ant"),
        ("spider", "Spider"),
        ("beetle", "Beetle"),
        ("grasshopper", "Grasshopper"),
        # expansions can be added later
        # ("mosquito", "Mosquito"),
        # ("ladybug", "Ladybug"),
        # ("pillbug", "Pillbug"),
    ]
    COLOUR_CHOICES = [
        ("white", "White"),
        ("black", "Black"),
    ]

    colour = models.CharField(max_length=5, choices=COLOUR_CHOICES)
    piece_type = models.CharField(max_length=20, choices=PIECE_TYPE_CHOICES)
    move_description = models.TextField()

    def __str__(self):
        return f"{self.get_colour_display()} {self.get_piece_type_display()}"

    def short_description(self) -> str:
        """A concise summary of how this piece moves."""
        return self.move_description


class GameState(models.Model):
    lobby = models.OneToOneField(
        Lobby, on_delete=models.CASCADE, related_name="game_state"
    )
    state_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField(auto_now=True)
    _state_obj: Optional[HiveGameState] = None

    @property
    def state_obj(self) -> HiveGameState:
        if self._state_obj is None:
            data = self.state_data.copy()
            data["board_state"] = hiveboard_from_json_dict(data["board_state"]["cells"])
            _state_obj = HiveGameState(**data)
            p1_pieces, p2_pieces = rebuild_pieces_on_board(_state_obj)
            _state_obj.player1_state.pieces_on_board = p1_pieces
            _state_obj.player2_state.pieces_on_board = p2_pieces
            self._state_obj = _state_obj
        return self._state_obj

    @state_obj.setter
    def state_obj(self, value: HiveGameState) -> None:
        self._state_obj = value
        self.state_data = value.to_json_data()

    def __str__(self) -> str:
        return f"Hive Game State {self.id}"

    def save(self, *args, **kwargs):
        if self._state_obj is not None:
            self.state_data = self._state_obj.to_json_data()
        super().save(*args, **kwargs)

    def initialize_game_state(self, players: List[User], player1_turn: bool = True):
        hive_players: List[HivePlayerState] = []
        for user, colour in zip(players, ("white", "black")):
            pieces = Piece.objects.filter(colour=colour)
            pieces_in_hand: List[HivePieceState] = []
            for piece in pieces:
                pieces_in_hand.append(
                    HivePieceState(
                        id=piece.id,
                        owner=user.username,
                        piece_type=HivePieceType(piece.piece_type),
                        placed=False,
                        position=None,
                        stack_height=0,
                    )
                )
            hive_players.append(
                HivePlayerState(
                    username=user.username,
                    has_placed_queen=False,
                    pieces_in_hand=pieces_in_hand,
                    pieces_on_board=[],
                )
            )
        state = HiveGameState(
            player1_state=hive_players[0],
            player2_state=hive_players[1],
            player1_turn=player1_turn,
            turn_no=1,
            board_state=HiveBoardState(),
        )

        self.state_obj = state
        self.save()

    def play_piece(
        self, piece: HivePieceState, new_piece_pos: HivePosition, username: str
    ):
        state: HiveGameState = self.state_obj
        player, opponent = self._get_player_and_opponent_states(state, username)

        valid = False
        is_player1_turn = state.player1_turn
        is_player1 = player is state.player1_state
        if is_player1_turn != is_player1:
            return valid, "It is not your turn"

        if any(p for p in player.pieces_in_hand if p == piece):
            valid, message = check_valid_piece_from_hand_move(
                state, player, opponent, piece, new_piece_pos
            )
            if not valid:
                return valid, message
        elif any(
            p for p in player.pieces_on_board if p == piece
        ):  # piece played from board
            temp_board = state.board_state.model_copy(deep=True)
            assert piece.position is not None
            del temp_board.cells[piece.position]
            if not hive_is_connected(temp_board):
                return False, "Hive not connected during move"
            if (
                not player.has_placed_queen
                and state.turn_no == TURN_NUMBER_QUEEN_MUST_BE_PLACED
                and piece.piece_type != HivePieceType.QUEEN
            ):
                return False, "You must place your Queen by your 4th turn"
            if piece.piece_type == HivePieceType.ANT:
                valid, path = can_slide_path(state, piece.position, new_piece_pos)
            elif piece.piece_type == HivePieceType.QUEEN:
                valid, path = can_slide_path(
                    state, piece.position, new_piece_pos, max_steps=1
                )
            elif piece.piece_type == HivePieceType.SPIDER:
                valid, path = can_slide_path(
                    state,
                    piece.position,
                    new_piece_pos,
                    max_steps=3,
                    require_exact_steps=3,
                )
            elif piece.piece_type == HivePieceType.GRASSHOPPER:
                valid = grasshopper_jump_valid(state, piece, new_piece_pos)
            elif piece.piece_type == HivePieceType.BEETLE:
                valid = beetle_move_valid(state, piece, new_piece_pos)
        if not valid:
            return False, "illegal piece move"
        state = self._update_state_after_move(state, player, piece, new_piece_pos)
        if not hive_is_connected(state.board_state):
            return False, "Hive not connected after move"
        self.state_obj = state
        self.save()
        return True, ""

    def _get_player_and_opponent_states(self, state: HiveGameState, username: str):
        player = (
            state.player1_state
            if state.player1_state.username == username
            else state.player2_state
        )
        opponent = (
            state.player2_state
            if player is state.player1_state
            else state.player1_state
        )
        return player, opponent

    def _update_state_after_move(
        self,
        state: HiveGameState,
        player: HivePlayerState,
        piece: HivePieceState,
        placed_piece_pos: HivePosition,
    ):
        if piece.placed:
            old_pos = piece.position
            assert old_pos is not None
            old_cell = state.board_state.cells[old_pos]
            if old_cell:
                old_cell.pieces.remove(piece)
                if not old_cell.pieces:
                    del state.board_state.cells[old_pos]

        else:
            player.pieces_in_hand.remove(piece)
            player.pieces_on_board.append(piece)
            piece.placed = True
            if piece.piece_type == HivePieceType.QUEEN:
                player.has_placed_queen = True

        piece.position = placed_piece_pos

        if state.board_state.cells.get(placed_piece_pos):
            state.board_state.cells[placed_piece_pos].pieces.append(piece)
            piece.stack_height = (
                len(state.board_state.cells[placed_piece_pos].pieces) - 1
            )
        else:
            state.board_state.cells[placed_piece_pos] = HiveBoardCell(
                position=placed_piece_pos, pieces=[piece]
            )

        if not state.player1_turn:
            state.turn_no += 1
        state.player1_turn = not state.player1_turn
        self._check_game_over(state)

        return state

    def _check_game_over(self, state: HiveGameState):
        if state.board_state is None:
            return

        p1 = state.player1_state
        p2 = state.player2_state

        q1_surrounded = q2_surrounded = None
        if q1 := next(
            (p for p in p1.pieces_on_board if p.piece_type == HivePieceType.QUEEN), None
        ):
            q1_surrounded = is_queen_surrounded(state.board_state, q1)
        if q2 := next(
            (p for p in p2.pieces_on_board if p.piece_type == HivePieceType.QUEEN), None
        ):
            q2_surrounded = is_queen_surrounded(state.board_state, q2)

        if not q1_surrounded and not q2_surrounded:
            return

        if q1_surrounded and q2_surrounded:
            state.game_over = True
            state.winner = "draw"
        elif q1_surrounded:
            state.game_over = True
            state.winner = p2.username
        else:
            state.game_over = True
            state.winner = p1.username
