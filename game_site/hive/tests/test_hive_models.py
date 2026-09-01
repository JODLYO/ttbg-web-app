# mypy: disable-error-code="attr-defined,union-attr"

from unittest.mock import patch

from django.test import TestCase
from django.contrib.auth.models import User
from hive.models import Lobby, LobbyPlayer, Piece, GameState
from hive.helpers import hive_is_connected, is_queen_surrounded
from hive.game_state import (
    HivePosition,
    HivePieceType,
    HiveGameState,
    HivePieceState,
    HivePlayerState,
    HiveBoardCell,
    HiveBoardState,
)
from django.core.management import call_command

TOTAL_PLAYER_PIECES = 11


class PieceModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        """Runs once for the test class"""
        if not Piece.objects.exists():
            call_command("seed_hive_pieces")
        cls.pieces = Piece.objects.all()

    def test_piece_fields(self):
        white_queen: Piece = Piece.objects.get(piece_type="queen", colour="white")
        self.assertEqual(str(white_queen), "White Queen Bee")
        self.assertIn("Moves one adjacent space", white_queen.short_description())
        self.assertEqual(white_queen.colour, "white")
        self.assertEqual(white_queen.piece_type, "queen")


class LobbyModelTest(TestCase):
    def setUp(self):
        self.user1 = User.objects.create(username="player1")
        self.user2 = User.objects.create(username="player2")
        self.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user1)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user2)

    def test_lobby_is_full(self):
        self.assertTrue(self.lobby.is_full())

    def test_lobby_all_ready(self):
        # Initially not all ready
        self.assertFalse(self.lobby.all_ready())

        # Set both players ready
        for player in self.lobby.lobbyplayer_set.all():
            player.ready = True
            player.save()

        self.assertTrue(self.lobby.all_ready())


class GameStateModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        """Create a lobby with two players and all pieces."""
        if not Piece.objects.exists():
            call_command("seed_hive_pieces")
        cls.pieces = Piece.objects.all()

        cls.user1 = User.objects.create(username="player1")
        cls.user2 = User.objects.create(username="player2")

        cls.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.user1, ready=True)
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.user2, ready=True)

        cls.game_state = GameState.objects.create(lobby=cls.lobby)
        cls.game_state.initialize_game_state([cls.user1, cls.user2])

    def test_game_state_creation(self):
        self.assertEqual(str(self.game_state), f"Hive Game State {self.game_state.id}")
        self.assertIsInstance(self.game_state.state_data, dict)
        self.assertIsInstance(self.game_state.state_obj, HiveGameState)
        self.assertEqual(self.game_state.lobby, self.lobby)

    def test_initialize_creates_pieces(self):
        state = self.game_state.state_obj
        p1 = state.player1_state
        p2 = state.player2_state

        self.assertEqual(p1.username, "player1")
        self.assertEqual(p2.username, "player2")
        self.assertEqual(len(p1.pieces_in_hand), TOTAL_PLAYER_PIECES)
        self.assertEqual(len(p2.pieces_in_hand), TOTAL_PLAYER_PIECES)

    def test_play_piece_from_hand_valid(self):
        state = self.game_state.state_obj
        player = state.player1_state
        piece = player.pieces_in_hand[0]
        pos = HivePosition(q=0, r=0, s=0)
        result, _ = self.game_state.play_piece(piece, pos, username="player1")
        self.assertTrue(result is None or result is True)
        self.assertTrue(piece.placed)
        self.assertEqual(piece.position, pos)
        self.assertFalse(
            piece in self.game_state.state_obj.player1_state.pieces_in_hand
        )

    def test_play_piece_invalid_move(self):
        """Queen tries to move two hexes away — should be invalid."""
        state = self.game_state.state_obj
        player = state.player1_state
        queen = next(
            p for p in player.pieces_in_hand if p.piece_type == HivePieceType.QUEEN
        )

        # Place the queen correctly first
        start_pos = HivePosition(q=0, r=0, s=0)
        self.game_state.play_piece(queen, start_pos, username="player1")

        # Try to move the queen two hexes away (illegal)
        invalid_target = HivePosition(q=2, r=-1, s=-1)

        valid, msg = self.game_state.play_piece(
            queen, invalid_target, username="player2"
        )

        self.assertFalse(valid)
        self.assertIn("illegal piece move", msg.lower())

    def test_non_queen_placement_allowed_before_fourth_turn(self):
        """Regression: the Queen used to be force-placed on turn 3 instead of
        turn 4 (official rule: 'You must place your Queen Bee on your fourth
        turn if you have not placed it before')."""
        state = self.game_state.state_obj
        self.move_test_helper(
            state, True, HivePosition(q=0, r=0, s=0), HivePieceType.SPIDER, True
        )
        self.move_test_helper(
            state, False, HivePosition(q=1, r=-1, s=0), HivePieceType.SPIDER, True
        )
        self.move_test_helper(
            state, True, HivePosition(q=-1, r=1, s=0), HivePieceType.ANT, True
        )
        self.move_test_helper(
            state, False, HivePosition(q=2, r=-2, s=0), HivePieceType.ANT, True
        )
        # Player1's own 3rd turn - this used to be wrongly forced to be the Queen.
        self.move_test_helper(
            state,
            True,
            HivePosition(q=-2, r=2, s=0),
            HivePieceType.GRASSHOPPER,
            True,
        )
        self.assertFalse(state.player1_state.has_placed_queen)

    def test_queen_still_forced_on_fourth_turn(self):
        state = self.game_state.state_obj
        self.move_test_helper(
            state, True, HivePosition(q=0, r=0, s=0), HivePieceType.SPIDER, True
        )
        self.move_test_helper(
            state, False, HivePosition(q=1, r=-1, s=0), HivePieceType.SPIDER, True
        )
        self.move_test_helper(
            state, True, HivePosition(q=-1, r=1, s=0), HivePieceType.ANT, True
        )
        self.move_test_helper(
            state, False, HivePosition(q=2, r=-2, s=0), HivePieceType.ANT, True
        )
        self.move_test_helper(
            state,
            True,
            HivePosition(q=-2, r=2, s=0),
            HivePieceType.GRASSHOPPER,
            True,
        )
        self.move_test_helper(
            state,
            False,
            HivePosition(q=3, r=-3, s=0),
            HivePieceType.GRASSHOPPER,
            True,
        )
        # Player1's own 4th turn: a non-queen placement must now be rejected.
        self.move_test_helper(
            state, True, HivePosition(q=-3, r=3, s=0), HivePieceType.BEETLE, False
        )
        # Placing the queen instead must succeed.
        self.move_test_helper(
            state, True, HivePosition(q=-3, r=3, s=0), HivePieceType.QUEEN, True
        )
        self.assertTrue(state.player1_state.has_placed_queen)

    def test_cannot_move_piece_before_own_queen_placed(self):
        """Official rule: 'Once your Queen Bee has been placed (but not
        before), you can decide whether to ... move one of the pieces that
        have already been placed.'"""
        state = self.game_state.state_obj
        self.move_test_helper(
            state, True, HivePosition(q=0, r=0, s=0), HivePieceType.SPIDER, True
        )
        self.move_test_helper(
            state, False, HivePosition(q=1, r=-1, s=0), HivePieceType.ANT, True
        )

        spider_on_board = state.board_state.cells[HivePosition(q=0, r=0, s=0)].pieces[
            -1
        ]
        valid, msg = self.game_state.play_piece(
            spider_on_board, HivePosition(q=-1, r=1, s=0), username="player1"
        )
        self.assertFalse(valid)
        self.assertIn("queen", msg.lower())
        # The piece must not have actually moved.
        self.assertEqual(spider_on_board.position, HivePosition(q=0, r=0, s=0))

    def test_cannot_place_from_hand_on_occupied_cell(self):
        """Official rule: a piece placed from hand can never land on top of
        another piece - only a Beetle can occupy a stack, and only by moving
        there, never by initial placement."""
        state = self.game_state.state_obj
        self.move_test_helper(
            state, True, HivePosition(q=0, r=0, s=0), HivePieceType.SPIDER, True
        )

        p2 = state.player2_state
        ant = next(p for p in p2.pieces_in_hand if p.piece_type == HivePieceType.ANT)
        valid, msg = self.game_state.play_piece(
            ant, HivePosition(q=0, r=0, s=0), username="player2"
        )
        self.assertFalse(valid)
        self.assertIn("top of another piece", msg.lower())
        origin_cell = state.board_state.cells[HivePosition(q=0, r=0, s=0)]
        self.assertEqual(len(origin_cell.pieces), 1)

    def test_save_updates_timestamp(self):
        before = self.game_state.created_at
        self.game_state.save()
        self.assertGreaterEqual(self.game_state.last_activity, before)

    def move_test_helper(
        self,
        state: HiveGameState,
        p1_turn: bool,
        pos: HivePosition,
        piece_type: HivePieceType,
        valid_move: bool,
        piece_to_play: HivePieceState | None = None,
    ):
        """Helper for playing a move and asserting validity."""
        player = state.player1_state if p1_turn else state.player2_state
        username = "player1" if p1_turn else "player2"

        if not piece_to_play:
            piece_to_play = next(
                (p for p in player.pieces_in_hand if p.piece_type == piece_type),
                None,
            )
            self.assertIsNotNone(
                piece_to_play, f"{username} should have a {piece_type} available"
            )

        result = self.game_state.play_piece(piece_to_play, pos, username=username)

        if valid_move:
            # Should be successfully placed
            self.assertTrue(
                piece_to_play.placed, f"{piece_type} should be marked as placed"
            )
            self.assertNotIn(piece_to_play, player.pieces_in_hand)
            self.assertIn(piece_to_play, player.pieces_on_board)
            self.assertIn(pos, self.game_state.state_obj.board_state.cells)
        else:
            # Expect tuple (False, "reason")
            self.assertIsInstance(result, tuple)
            valid, _ = result
            self.assertFalse(valid, f"{piece_type} placement should be invalid")

    def test_simulate_simple_game(self):
        state = self.game_state.state_obj

        # --- Turn 1: Player 1 places spider at origin ---
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=0, r=0, s=0),
            piece_type=HivePieceType.SPIDER,
            valid_move=True,
        )

        # --- Turn 1: Player 2 places beetle adjacent to spider ---
        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=1, r=-1, s=0),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
        )

        # --- Turn 2: Player 1 tries to place queen adjacent to both spider and beetle (invalid) ---
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=1, r=0, s=-1),
            piece_type=HivePieceType.QUEEN,
            valid_move=False,
        )

        # --- Turn 2: Player 1 correctly places queen adjacent to spider only ---
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=-1, r=1, s=0),
            piece_type=HivePieceType.QUEEN,
            valid_move=True,
        )

        # --- Turn 2: Player 2 places an ant adjacent to beetle ---
        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=2, r=-1, s=-1),
            piece_type=HivePieceType.ANT,
            valid_move=True,
        )

        # --- Turn 3: Player 1 places a grasshopper ---
        grasshopper_pos = HivePosition(q=-2, r=2, s=0)
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=grasshopper_pos,
            piece_type=HivePieceType.GRASSHOPPER,
            valid_move=True,
        )

        p2_ant = state.board_state.cells.get(HivePosition(q=2, r=-1, s=-1)).pieces[-1]
        ant_new_pos = HivePosition(q=0, r=1, s=-1)

        # p2 must place queen
        self.move_test_helper(
            state,
            p1_turn=False,
            pos=ant_new_pos,
            piece_type=HivePieceType.ANT,
            valid_move=False,
            piece_to_play=p2_ant,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=2, r=-2, s=0),
            piece_type=HivePieceType.QUEEN,
            valid_move=True,
        )

        # --- Turn 4: Player 1 moves the grasshopper in a valid jump ---
        grasshopper = state.board_state.cells[grasshopper_pos].pieces[-1]
        gh_jump_target = HivePosition(q=3, r=-3, s=0)  # valid landing spot
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=gh_jump_target,
            piece_type=HivePieceType.GRASSHOPPER,
            valid_move=True,
            piece_to_play=grasshopper,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=0, r=2, s=-2),
            piece_type=HivePieceType.SPIDER,
            valid_move=False,  # cant move spider to an occupied hexagon
        )

        p2_ant = state.board_state.cells.get(HivePosition(q=2, r=-1, s=-1)).pieces[-1]
        ant_new_pos = HivePosition(q=0, r=1, s=-1)

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=ant_new_pos,
            piece_type=HivePieceType.ANT,
            valid_move=True,
            piece_to_play=p2_ant,
        )

        # --- Turn 5: Player 1 plays a beetle ---
        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=4, r=-4, s=0),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=0, r=2, s=-2),
            piece_type=HivePieceType.SPIDER,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=3, r=-3, s=0),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=4, r=-4, s=0)
            ).pieces[-1],
        )
        self.assertEqual(
            state.board_state.cells.get(HivePosition(q=3, r=-3, s=0))
            .pieces[-1]
            .stack_height,
            1,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=-1, r=0, s=1),  # invalid location for spider
            piece_type=HivePieceType.SPIDER,
            valid_move=False,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=0, r=2, s=-2)
            ).pieces[-1],
        )
        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=-2, r=1, s=1),  # valid location for spider
            piece_type=HivePieceType.SPIDER,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=0, r=2, s=-2)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=2, r=-2, s=0),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=3, r=-3, s=0)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=-2, r=0, s=2),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=2, r=-3, s=1),
            piece_type=HivePieceType.SPIDER,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=-1, r=0, s=1),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=-2, r=0, s=2)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=3, r=-2, s=-1),
            piece_type=HivePieceType.ANT,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=0, r=-1, s=1),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=-1, r=0, s=1)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=1, r=-2, s=1),
            piece_type=HivePieceType.ANT,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=3, r=-2, s=-1)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=1, r=-2, s=1),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=0, r=-1, s=1)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=3, r=-2, s=-1),
            piece_type=HivePieceType.ANT,
            valid_move=True,
        )

        self.move_test_helper(
            state,
            p1_turn=False,
            pos=HivePosition(q=0, r=-2, s=2),
            piece_type=HivePieceType.SPIDER,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=-2, r=1, s=1)
            ).pieces[-1],
        )

        self.move_test_helper(
            state,
            p1_turn=True,
            pos=HivePosition(q=2, r=-1, s=-1),
            piece_type=HivePieceType.BEETLE,
            valid_move=True,
            piece_to_play=state.board_state.cells.get(
                HivePosition(q=2, r=-2, s=0)
            ).pieces[-1],
        )

        self.assertTrue(
            all(cell.pieces for cell in state.board_state.cells.values()),
            "All cells should contain at least one piece",
        )
        self.assertTrue(
            hive_is_connected(state.board_state),
            "Hive should remain connected after all valid moves",
        )
        self.assertTrue(state.game_over)
        self.assertEqual(state.winner, "player1")


class AutoPassTurnTest(TestCase):
    """Regression test for the 'Unable to move or place' rule: 'If a player
    can neither place a new piece or move an existing piece, the turn passes
    to their opponent who then takes their turn again.'"""

    @classmethod
    def setUpTestData(cls):
        if not Piece.objects.exists():
            call_command("seed_hive_pieces")

        cls.boxed_user = User.objects.create(username="boxed")
        cls.open_user = User.objects.create(username="open")
        cls.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.boxed_user, ready=True)
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.open_user, ready=True)

        cls.game_state = GameState.objects.create(lobby=cls.lobby)
        cls.game_state.initialize_game_state([cls.boxed_user, cls.open_user])

    def test_boxed_player_turn_is_auto_skipped(self):
        state = self.game_state.state_obj
        boxed, opn = state.player1_state, state.player2_state

        # "boxed" has a lone Queen at the origin, with 5 of its 6 neighbours
        # occupied by "opn" and the sixth gap gated shut (both flanking cells
        # occupied) - a real Hive position where the Queen is trapped but not
        # yet surrounded (not game over), and "boxed" has no other pieces at
        # all, so it has zero legal moves.
        origin = HivePosition(q=0, r=0, s=0)
        boxed_queen = next(
            p for p in boxed.pieces_in_hand if p.piece_type == HivePieceType.QUEEN
        )
        boxed_queen.position = origin
        boxed_queen.placed = True
        boxed.has_placed_queen = True
        boxed.pieces_in_hand = [
            p for p in boxed.pieces_in_hand if p is not boxed_queen
        ]
        boxed.pieces_on_board = [boxed_queen]

        ring = [
            (HivePosition(q=1, r=-1, s=0), HivePieceType.QUEEN),
            (HivePosition(q=1, r=0, s=-1), HivePieceType.ANT),
            (HivePosition(q=0, r=1, s=-1), HivePieceType.BEETLE),
            (HivePosition(q=-1, r=1, s=0), HivePieceType.ANT),
            (HivePosition(q=-1, r=0, s=1), HivePieceType.ANT),
        ]
        cells = {origin: HiveBoardCell(position=origin, pieces=[boxed_queen])}
        opn_board_pieces = []
        for pos, piece_type in ring:
            piece = next(
                p
                for p in opn.pieces_in_hand
                if p.piece_type == piece_type and p not in opn_board_pieces
            )
            piece.position = pos
            piece.placed = True
            cells[pos] = HiveBoardCell(position=pos, pieces=[piece])
            opn_board_pieces.append(piece)
        opn.pieces_in_hand = [
            p for p in opn.pieces_in_hand if p not in opn_board_pieces
        ]
        opn.pieces_on_board = opn_board_pieces
        opn.has_placed_queen = True

        state.board_state = HiveBoardState(cells=cells)
        state.player1_turn = False  # about to be "opn"'s turn
        self.game_state.state_obj = state
        self.game_state.save()

        # "opn" makes an ordinary legal move (a Beetle climb, which sidesteps
        # the sliding gate rule entirely) that doesn't change "boxed"'s
        # situation at all.
        beetle = next(
            p for p in opn.pieces_on_board if p.piece_type == HivePieceType.BEETLE
        )
        climb_target = HivePosition(q=1, r=0, s=-1)  # on top of the Ant there
        valid, msg = self.game_state.play_piece(beetle, climb_target, username="open")
        self.assertTrue(valid, msg)

        final = self.game_state.state_obj
        # It should be "opn"'s turn again immediately - "boxed" had nothing
        # legal to do, so their turn was automatically forfeited.
        self.assertFalse(final.player1_turn)
        self.assertFalse(final.game_over)


def test_player_has_any_legal_move_true_with_open_hand():
    """A player with a piece still in hand and an empty board always has a
    legal move (placement at the origin)."""
    p1 = HivePlayerState(
        username="player1",
        has_placed_queen=False,
        pieces_in_hand=[
            HivePieceState(
                id=1, piece_type=HivePieceType.SPIDER, owner="player1", placed=False
            )
        ],
        pieces_on_board=[],
    )
    p2 = HivePlayerState(
        username="player2", has_placed_queen=False, pieces_in_hand=[], pieces_on_board=[]
    )
    state = HiveGameState(
        player1_state=p1,
        player2_state=p2,
        player1_turn=True,
        board_state=HiveBoardState(),
    )
    assert GameState()._player_has_any_legal_move(state, p1, p2)


def test_player_has_any_legal_move_false_when_queen_boxed_in():
    """Regression for the missing 'Unable to move or place' rule: a lone
    Queen with 5 of 6 neighbours occupied and the last gap gate-blocked (both
    flanking cells occupied) has zero legal moves - trapped, but not
    surrounded, so the game isn't over."""
    origin = HivePosition(q=0, r=0, s=0)
    boxed_queen = HivePieceState(
        id=1,
        piece_type=HivePieceType.QUEEN,
        owner="boxed",
        position=origin,
        placed=True,
    )
    cells = {origin: HiveBoardCell(position=origin, pieces=[boxed_queen])}
    ring = [
        HivePosition(q=1, r=-1, s=0),
        HivePosition(q=1, r=0, s=-1),
        HivePosition(q=0, r=1, s=-1),
        HivePosition(q=-1, r=1, s=0),
        HivePosition(q=-1, r=0, s=1),
    ]
    opn_pieces = []
    for i, pos in enumerate(ring, start=2):
        piece = HivePieceState(
            id=i, piece_type=HivePieceType.ANT, owner="opn", position=pos, placed=True
        )
        cells[pos] = HiveBoardCell(position=pos, pieces=[piece])
        opn_pieces.append(piece)

    board = HiveBoardState(cells=cells)
    boxed = HivePlayerState(
        username="boxed",
        has_placed_queen=True,
        pieces_in_hand=[],
        pieces_on_board=[boxed_queen],
    )
    opn = HivePlayerState(
        username="opn",
        has_placed_queen=True,
        pieces_in_hand=[],
        pieces_on_board=opn_pieces,
    )
    state = HiveGameState(
        player1_state=boxed, player2_state=opn, player1_turn=True, board_state=board
    )

    gs = GameState()
    assert not is_queen_surrounded(board, boxed_queen)  # 5/6, not game over
    assert not gs._player_has_any_legal_move(state, boxed, opn)
    assert gs._player_has_any_legal_move(state, opn, boxed)  # sanity: opn isn't stuck


class MutualDeadlockTest(TestCase):
    """Regression test: if BOTH players are simultaneously out of legal
    moves (a true mutual deadlock, distinct from either Queen being
    surrounded), the engine must declare the game over rather than silently
    flipping the turn back and forth forever.

    A real board reaching this exact state is hard to construct by hand, so
    this stubs `_player_has_any_legal_move` to isolate the pass-loop's own
    logic (the thing that was actually buggy) from board geometry."""

    @classmethod
    def setUpTestData(cls):
        if not Piece.objects.exists():
            call_command("seed_hive_pieces")
        cls.user1 = User.objects.create(username="player1")
        cls.user2 = User.objects.create(username="player2")
        cls.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.user1, ready=True)
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.user2, ready=True)
        cls.game_state = GameState.objects.create(lobby=cls.lobby)
        cls.game_state.initialize_game_state([cls.user1, cls.user2])

    def test_simultaneous_deadlock_ends_the_game_as_a_draw(self):
        state = self.game_state.state_obj
        player = state.player1_state
        piece = player.pieces_in_hand[0]

        with patch.object(
            GameState, "_player_has_any_legal_move", return_value=False
        ):
            result = self.game_state._update_state_after_move(
                state, player, piece, HivePosition(q=0, r=0, s=0)
            )

        self.assertTrue(result.game_over)
        self.assertEqual(result.winner, "draw")
