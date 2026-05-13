# mypy: disable-error-code="attr-defined,union-attr"

from django.test import TestCase
from django.contrib.auth.models import User
from hive.models import Lobby, LobbyPlayer, Piece, GameState
from hive.helpers import hive_is_connected
from hive.game_state import HivePosition, HivePieceType, HiveGameState, HivePieceState
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
