from django.test import TestCase
from django.contrib.auth.models import User
from dragon_in_the_forest.models import Card, GameState, LobbyPlayer, Lobby
from django.core.management import call_command
from dragon_in_the_forest.game_state import CardState, CardContext


def get_card_context_from_model_card(model_card):
    return CardContext(
        id=model_card.id,
        value=model_card.value,
        suit=model_card.suit,
        special_ability=model_card.get_special_ability(),
    )


class CardModelTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        """Runs once for the test class"""
        if not Card.objects.exists():
            call_command("seed_ditf_cards")
        cls.cards = Card.objects.all()

    def test_special_abilities(self):
        # Test card 1 (Lead next hand)
        card1 = Card.objects.get(suit="fire", value=1)
        self.assertEqual(card1.get_special_ability(), "sp1")
        self.assertTrue(card1.is_special())

        # Test card 3 (Switch with trump)
        card3 = Card.objects.get(suit="fire", value=3)
        self.assertEqual(card3.get_special_ability(), "sp2")
        self.assertTrue(card3.is_special())

        # Test card 7 (Extra point)
        card7 = Card.objects.get(suit="fire", value=7)
        self.assertEqual(card7.get_special_ability(), "sp4")
        self.assertTrue(card7.is_special())

        # Test card 9 (Trump suit)
        card9 = Card.objects.get(suit="fire", value=9)
        self.assertEqual(card9.get_special_ability(), "sp5")
        self.assertTrue(card9.is_special())

        # Test card 11 (Force highest)
        card11 = Card.objects.get(suit="fire", value=11)
        self.assertEqual(card11.get_special_ability(), "sp6")
        self.assertTrue(card11.is_special())

        # Test non-special card
        card2 = Card.objects.get(suit="fire", value=2)
        self.assertIsNone(card2.get_special_ability())
        self.assertFalse(card2.is_special())


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
        """Runs once for the test class"""
        if not Card.objects.exists():
            call_command("seed_ditf_cards")
        cls.cards = Card.objects.all()

        cls.player1 = User.objects.create_user(username="player1")
        cls.player2 = User.objects.create_user(username="player2")

        cls.lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.player1, ready=True)
        LobbyPlayer.objects.create(lobby=cls.lobby, player=cls.player2, ready=True)

        cls.game_state = GameState.objects.create(lobby=cls.lobby)
        cls.game_state.initialize_game()

    def test_game_state_creation(self):
        self.assertEqual(
            str(self.game_state), f"Dragon Forest Game State {self.game_state.id}"
        )
        self.assertIsInstance(self.game_state.state_data, dict)
        self.assertIn("trump_card", self.game_state.state_data)
        self.assertIn("player1", self.game_state.state_data)
        self.assertIn("player2", self.game_state.state_data)

    def test_trump_suit_wins(self):
        """Test that trump suit wins over non-trump suits."""
        # Get trump suit
        trump_card = Card.objects.get(id=self.game_state.state_obj.trump_card.id)
        trump_suit = trump_card.suit

        # Get a trump card and a non-trump card
        trump_card = Card.objects.filter(suit=trump_suit).first()
        non_trump_card = Card.objects.exclude(suit=trump_suit).first()

        # Set up a trick with trump and non-trump cards
        self.game_state.state_obj.current_trick.cards = [
            CardState(
                card=CardContext(
                    id=trump_card.id,
                    value=trump_card.value,
                    suit=trump_card.suit,
                    special_ability=trump_card.get_special_ability(),
                ),
                player="player1",
            ),
            CardState(
                card=CardContext(
                    id=non_trump_card.id,
                    value=non_trump_card.value,
                    suit=non_trump_card.suit,
                    special_ability=non_trump_card.get_special_ability(),
                ),
                player="player2",
            ),
        ]
        self.game_state.save()

        # Trump should win regardless of value
        winner = self.game_state._determine_trick_winner()
        self.assertEqual(winner, "player1")

    def test_higher_trump_wins(self):
        """Test that higher value wins when both cards are trump."""
        # Get trump suit
        trump_card = Card.objects.get(id=self.game_state.state_obj.trump_card.id)
        trump_suit = trump_card.suit

        # Get two trump cards with different values
        trump_cards = Card.objects.filter(suit=trump_suit).order_by("-value")[:2]
        higher_trump = trump_cards[0]
        lower_trump = trump_cards[1]

        # Set up a trick with two trump cards
        self.game_state.state_obj.current_trick.cards = [
            CardState(
                card=CardContext(
                    id=higher_trump.id,
                    value=trump_card.value,
                    suit=trump_card.suit,
                    special_ability=trump_card.get_special_ability(),
                ),
                player="player1",
            ),
            CardState(
                card=CardContext(
                    id=lower_trump.id,
                    value=lower_trump.value,
                    suit=lower_trump.suit,
                    special_ability=lower_trump.get_special_ability(),
                ),
                player="player2",
            ),
        ]
        self.game_state.save()

        # Higher trump should win
        winner = self.game_state._determine_trick_winner()
        self.assertEqual(winner, "player1")

    def test_sp5_ability(self):
        """If only one of this ability is played, the card counts as the trump suit"""
        # Get trump suit
        trump_card = Card.objects.get(id=self.game_state.state_obj.trump_card.id)
        trump_suit = trump_card.suit
        if trump_suit == "fire":
            nine_suit = "water"
        else:
            nine_suit = "fire"

        # Get a 9 of a non-trump suit and a non-9 card
        nine_card = Card.objects.get(
            suit=nine_suit, value=9
        )  # Assuming fire isn't trump
        non_nine_card = (
            Card.objects.exclude(suit=trump_suit)
            .exclude(suit=nine_suit)
            .exclude(value=9)
            .first()
        )

        # Set up a trick with 9 and non-9 cards
        self.game_state.state_obj.current_trick.cards = [
            CardState(
                card=get_card_context_from_model_card(non_nine_card), player="player1"
            ),
            CardState(
                card=get_card_context_from_model_card(nine_card), player="player2"
            ),
        ]
        self.game_state.save()

        # 9 should win regardless of suit
        winner = self.game_state._determine_trick_winner()
        self.assertEqual(winner, "player2")

    def test_both_nines_no_special_ability(self):
        """Test that when both players play 9s, normal trump rules apply."""
        # Get trump suit
        trump_card = Card.objects.get(id=self.game_state.state_obj.trump_card.id)
        trump_suit = trump_card.suit

        # Get two 9s of different non-trump suits
        nine1 = Card.objects.filter(value=9).exclude(suit=trump_suit).first()
        nine2 = (
            Card.objects.filter(value=9)
            .exclude(suit=trump_suit)
            .exclude(suit=nine1.suit)
            .first()
        )

        self.game_state.state_obj.current_trick.cards = [
            CardState(card=get_card_context_from_model_card(nine1), player="player1"),
            CardState(card=get_card_context_from_model_card(nine2), player="player2"),
        ]

        # First card should win (since both are 9s, no special ability applies)
        winner = self.game_state._determine_trick_winner()
        self.assertEqual(winner, "player1")

    def test_eleven_special_ability_validation(self):
        """Test that when an 11 is played, the next player must play their highest card of that suit."""
        # Get an 11 and some cards of the same suit
        eleven_card = Card.objects.get(suit="fire", value=11)
        same_suit_cards = (
            Card.objects.filter(suit="fire").exclude(value=11).order_by("-value")[:2]
        )
        highest_card = same_suit_cards[0]
        lower_card = same_suit_cards[1]

        # Set up a trick with 11
        self.game_state.state_obj.current_trick.cards = [
            CardState(
                card=get_card_context_from_model_card(eleven_card), player="player1"
            )
        ]

        # Set current player to player2
        self.game_state.state_obj.current_player = "player2"

        # Add the cards to player2's hand
        self.game_state.state_obj.player2.cards = [
            get_card_context_from_model_card(lower_card),
            get_card_context_from_model_card(highest_card),
        ]

        # Try to play a lower card of the same suit
        result = self.game_state._validate_move(
            User.objects.get(username="player2"),
            lower_card.id,
            self.game_state.state_obj.current_trick,
            self.game_state.state_obj.player2,
        )

        # Should return error
        self.assertIsNotNone(result)
        self.assertIn("error", result)
        self.assertEqual(result["error"], "Must play highest card of this suit")

        # Try to play the highest card of the same suit
        result = self.game_state._validate_move(
            User.objects.get(username="player2"),
            highest_card.id,
            self.game_state.state_obj.current_trick,
            self.game_state.state_obj.player2,
        )

        # Should be valid
        self.assertIsNone(result)

    def test_eleven_special_ability_different_suit(self):
        """Test that when an 11 is played, player can play any card of a different suit."""
        # Get an 11 and a card of a different suit
        eleven_card = Card.objects.get(suit="fire", value=11)
        different_suit_card = Card.objects.exclude(suit="fire").first()

        # Set up a trick with 11
        self.game_state.state_obj.current_trick.cards = [
            CardState(
                card=get_card_context_from_model_card(eleven_card), player="player1"
            )
        ]
        self.game_state.save()

        # Set current player to player2
        self.game_state.state_obj.current_player = "player2"

        # Add the different suit card to player2's hand
        self.game_state.state_obj.player2.cards.append(
            get_card_context_from_model_card(different_suit_card)
        )

        # Try to play a card of a different suit
        result = self.game_state._validate_move(
            User.objects.get(username="player2"),
            different_suit_card.id,
            self.game_state.state_obj.current_trick,
            self.game_state.state_obj.player2,
        )

        # Should be valid
        self.assertIsNone(result)

    def test_make_move_basic(self):
        """Test that a normal card play updates trick and player hand correctly."""
        player1 = User.objects.get(username="player1")
        card_to_play = self.game_state.state_obj.player1.cards[0]

        # Confirm card in player's hand before move
        player_cards_before = [c.id for c in self.game_state.state_obj.player1.cards]
        self.assertIn(card_to_play.id, player_cards_before)

        # Perform move
        result = self.game_state.make_move(player1, card_to_play)

        # After move, the card should no longer be in player's hand
        player_cards_after = [c.id for c in self.game_state.state_obj.player1.cards]
        self.assertNotIn(card_to_play.id, player_cards_after)

        # The current trick should now contain that card
        trick_cards = [c.card.id for c in result.current_trick.cards]
        self.assertIn(card_to_play.id, trick_cards)

        # The led_suit should be set correctly
        self.assertEqual(result.current_trick.led_suit, card_to_play.suit)

    def test_sp3_new_round_starts_after_last_card(self):
        """Test that playing the 5 (sp3) as the final card triggers a new round and clears the current trick."""
        # Find the 5 with special ability sp3
        sp3_card = get_card_context_from_model_card(
            Card.objects.get(value=5, suit="fire")
        )

        # Give each player one card left in their hand (simulate end of round)
        self.game_state.state_obj.player1.cards = [sp3_card]
        # Any other card for player2
        other_card = get_card_context_from_model_card(
            Card.objects.get(value=2, suit="fire")
        )
        self.game_state.state_obj.player2.cards = [other_card]

        self.game_state.state_obj.current_trick.cards = []
        self.game_state.state_obj.current_trick.led_suit = None
        self.game_state.state_obj.current_player = "player2"

        # Player2 plays the other card
        player2 = User.objects.get(username="player2")
        self.game_state.make_move(player2, other_card)

        # Player1 plays their last card
        player1 = User.objects.get(username="player1")
        self.game_state.make_move(player1, sp3_card)
        # After both have played, the round should have resolved and a new one started
        new_state = self.game_state.state_obj
        # The trick should now be empty
        self.assertEqual(
            len(new_state.current_trick.cards), 0, "Trick should reset after round ends"
        )

        # Both players' hands should also be full
        self.assertEqual(len(new_state.player1.cards), 13)
        self.assertEqual(len(new_state.player2.cards), 13)

    def test_sp2_ability(self):
        """Test that when a 3 (sp2) is played, the player can swap a card with the trump card."""
        # Find a card with the sp2 ability
        sp2_card = get_card_context_from_model_card(
            Card.objects.get(value=3, suit="fire")
        )
        # Record initial trump
        initial_trump = self.game_state.state_obj.trump_card
        initial_trump_card = Card.objects.get(id=initial_trump.id)

        # Put the sp2 card in player1's hand and one other random card
        extra_card = get_card_context_from_model_card(
            Card.objects.exclude(id=sp2_card.id)
            .exclude(id=initial_trump_card.id)
            .first()
        )
        self.game_state.state_obj.player1.cards = [
            sp2_card,
            extra_card,
        ]

        # Ensure player2 has something in hand too
        self.game_state.state_obj.player2.cards = [
            get_card_context_from_model_card(
                Card.objects.exclude(
                    id__in=[sp2_card.id, extra_card.id, initial_trump_card.id]
                ).first()
            )
        ]

        # Start a new trick
        self.game_state.state_obj.current_trick.cards = []
        self.game_state.state_obj.current_player = "player1"

        player1 = User.objects.get(username="player1")

        # Simulate playing the sp2 card (should trigger waiting_for_trump_replacement)
        self.game_state.make_move(player1, sp2_card)
        # Verify the game is now waiting for a trump replacement
        waiting = self.game_state.state_obj.waiting_for_trump_replacement
        self.assertIsNotNone(waiting)
        self.assertEqual(waiting["player"], player1.username)
        self.assertTrue(
            waiting["is_first_card"]
        )  # assuming it's the first card in trick

        # Now, replace the trump card with the extra_card
        replaced_state = self.game_state.replace_trump_card(player1, extra_card.id)

        # The trump card should now be the extra_card
        self.assertEqual(
            replaced_state.trump_card.id,
            extra_card.id,
            "Trump card should have been replaced with the chosen card.",
        )

        # The player's hand should now contain the old trump
        player1_hand_ids = [c.id for c in replaced_state.player1.cards]
        self.assertIn(
            initial_trump_card.id,
            player1_hand_ids,
            "The old trump card should now be in player1's hand.",
        )

        # The waiting state should be cleared
        self.assertIsNone(
            replaced_state.waiting_for_trump_replacement,
            "waiting_for_trump_replacement should be cleared after swap.",
        )

        # The turn should now have switched to player2
        self.assertEqual(
            replaced_state.current_player,
            "player2",
            "After a first-card sp2 replacement, turn should switch to player2.",
        )
