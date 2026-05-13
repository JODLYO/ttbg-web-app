from django.test import TestCase
from django.contrib.auth.models import User
from set_game.models import Card, GameSession, LobbyPlayer, Lobby

from django.core.management import call_command


class CardModelTest(TestCase):
    def test_card_creation(self):
        card = Card.objects.create(
            number=1, symbol="oval", shading="solid", color="red"
        )
        self.assertEqual(str(card), "1 solid red oval")


class GameSessionModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        if not Card.objects.exists():
            call_command("seed_set_cards")
        cls.cards = Card.objects.all()

        cls.player1 = User.objects.create_user(username="player1")
        cls.player2 = User.objects.create_user(username="player2")

        cls.session = GameSession.objects.create(name="Test Game")
        cls.session.players.set([cls.player1, cls.player2])
        cls.session.initialize_game()

    def test_initialize_game(self):
        self.session.initialize_game()
        board_length = len(self.session.state_obj.board)
        self.assertIn(board_length, [12, 15], "Board length must be either 12 or 15")
        self.assertGreater(len(self.session.state_obj.deck), 0)
        self.assertEqual(self.session.state_obj.scores[self.player1.username], 0)

    def test_initial_board_setup(self):
        session = GameSession.objects.create(name="Test Game Set")
        session.players.set([self.player1, self.player2])

        card_ids_containing_set = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 41, 81]
        deck_with_set = [
            Card.objects.get(id=card_id) for card_id in card_ids_containing_set
        ]
        additional_cards = [
            Card.objects.get(id=card_id) for card_id in [11, 12, 13, 14, 15]
        ]
        deck_with_set.extend(additional_cards)
        initial_board_cards, remaining_deck = session._get_initial_board_and_deck(
            deck_with_set
        )

        self.assertEqual(
            len(initial_board_cards),
            12,
            "Board should have 12 cards when set is available",
        )

        card_ids_without_set = [16, 36, 43, 45, 33, 58, 59, 27, 23, 73, 18, 34]
        deck_without_set = [
            Card.objects.get(id=card_id) for card_id in card_ids_without_set
        ]
        additional_cards = [
            Card.objects.get(id=card_id) for card_id in [11, 12, 13, 14, 15]
        ]
        deck_without_set.extend(additional_cards)
        initial_board_cards, remaining_deck = session._get_initial_board_and_deck(
            deck_without_set
        )

        self.assertEqual(
            len(initial_board_cards),
            15,
            "Board should have 15 cards when no set is available",
        )

    def test_validate_sets(self):
        """(1, diamond, solid, red) → ID 1
        (2, squiggle, striped, green) → ID 41
        (3, oval, open, purple) → ID 81"""
        all_different_set = [1, 41, 81]
        self.assertTrue(self.session.validate_set(all_different_set))

        """
        Same Symbol, Different Everything Else
            (1, squiggle, solid, red) → ID 10
            (2, squiggle, striped, green) → ID 41
            (3, squiggle, open, purple) → ID 72
        """
        same_symbol_else_different = [10, 41, 72]
        self.assertTrue(self.session.validate_set(same_symbol_else_different))

        """(1, diamond, solid, red) → ID 1
        (2, squiggle, striped, red) → ID 40
        (3, oval, open, red) → ID 79"""
        same_colour_else_different = [1, 40, 79]
        self.assertTrue(self.session.validate_set(same_colour_else_different))

        """(1, diamond, solid, red) → ID 1
        (1, squiggle, striped, green) → ID 14
        (1, oval, open, purple) → ID 27"""
        same_no_else_different = [1, 14, 27]
        self.assertTrue(self.session.validate_set(same_no_else_different))

        """(1, diamond, solid, red) → ID 1
        (2, squiggle, solid, green) → ID 38
        (3, oval, solid, purple) → ID 75"""
        same_shading_else_different = [1, 38, 75]
        self.assertTrue(self.session.validate_set(same_shading_else_different))

        """(1, diamond, solid, red) → ID 1
        (1, diamond, solid, green) → ID 2
        (1, diamond, striped, red) → ID 75"""
        not_set = [1, 2, 75]
        self.assertFalse(self.session.validate_set(not_set))

        two_cards = [1, 2]
        self.assertFalse(self.session.validate_set(two_cards))

        four_cards = [1, 38, 75, 76]
        self.assertFalse(self.session.validate_set(four_cards))

    def test_process_set(self):
        self.session.initialize_game()
        selected_cards = [card.id for card in self.cards[:3]]
        self.session.process_set(self.player1, selected_cards)

        self.assertIn(selected_cards, self.session.state_obj.selected_sets)
        self.assertEqual(self.session.state_obj.scores[self.player1.username], 1)

    def test_end_game(self):
        self.session.end_game()
        self.assertTrue(self.session.state_obj.game_over)


class LobbyModelTest(TestCase):
    def setUp(self):
        self.user1 = User.objects.create(username="player1")
        self.user2 = User.objects.create(username="player2")
        self.user3 = User.objects.create(username="player3")
        self.user4 = User.objects.create(username="player4")
        self.user5 = User.objects.create(username="player5")
        self.user6 = User.objects.create(username="player6")
        self.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user1, ready=True)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user2, ready=True)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user3, ready=True)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user4, ready=True)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user5, ready=True)
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user6, ready=True)

    def test_lobby_is_full(self):
        self.assertTrue(self.lobby.is_full())

    def test_lobby_all_ready(self):
        self.assertTrue(self.lobby.all_ready())


class GameEndTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        """Set up a game session with an empty deck and no valid sets"""
        call_command("seed_set_cards")
        cls.cards = list(Card.objects.all())

        cls.player1 = User.objects.create_user(username="player1")
        cls.player2 = User.objects.create_user(username="player2")

        cls.session = GameSession.objects.create(name="Test Game")
        cls.session.players.set([cls.player1, cls.player2])

    def test_end_game_no_sets_available(self):
        """Ensure the game ends when no sets are available and the deck is empty"""
        self.session.initialize_game()
        self.session.state_obj.deck = []
        self.session.state_obj.board = {"0": 1, "1": 2, "2": 4}
        self.assertFalse(self.session.is_set_available())
        self.session.handle_no_set_available()
        self.assertTrue(self.session.state_obj.game_over)
