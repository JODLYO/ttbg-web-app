from django.test import TestCase
from django.urls import reverse
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractUser
from typing import Any

from set_game.models import Lobby, LobbyPlayer, GameState

User = get_user_model()


class HomeViewTest(TestCase):
    def test_home_get_request(self) -> None:
        """Test that home page loads successfully."""
        response: Any = self.client.get(reverse("home:home"))
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "home/home.html")

    def test_home_post_valid_username(self) -> None:
        """Test form submission with a valid username."""
        response: Any = self.client.post(reverse("home:home"), {"username": "testuser"})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.filter(username="testuser").exists())

    def test_home_post_missing_username(self) -> None:
        """Test form submission without a username."""
        response: Any = self.client.post(reverse("home:home"), {})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "This field is required.")


class LobbyViewTest(TestCase):
    def setUp(self) -> None:
        self.user: Any = User.objects.create_user(
            username="testuser", password="testpass"
        )
        self.client.login(username="testuser", password="testpass")

    def test_lobby_creation(self) -> None:
        """Test that a new user creates a new lobby and page is not cached."""
        response = self.client.get(reverse("set-game:lobby"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Lobby.objects.count(), 1)
        self.assertTrue(LobbyPlayer.objects.filter(player=self.user).exists())

    def test_lobby_join_existing(self) -> None:
        """Test that a second user joins an existing lobby if one is open."""
        Lobby.objects.create()
        _: AbstractUser = User.objects.create_user(username="testuser2")
        self.client.login(username="testuser2", password="testpass")
        response: Any = self.client.get(reverse("set-game:lobby"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Lobby.objects.count(), 1)

    def test_both_players_rejoin_after_finished_game(self) -> None:
        """When two users finish a match, the first one to return creates a new lobby,
        and the second joins that new lobby. The old lobby remains.
        """

        user2 = User.objects.create_user(username="testuser2", password="testpass")
        lobby1 = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=lobby1, player=self.user)
        LobbyPlayer.objects.create(lobby=lobby1, player=user2)
        GameState.objects.create(lobby=lobby1)

        # player1 visits and creates new lobby
        self.client.logout()
        self.client.login(username="testuser", password="testpass")
        resp1 = self.client.get(reverse("set-game:lobby"))
        self.assertEqual(resp1.status_code, 200)
        self.assertTrue(Lobby.objects.filter(id=lobby1.id).exists())
        self.assertEqual(Lobby.objects.count(), 2)
        fresh = Lobby.objects.exclude(id=lobby1.id).first()
        self.assertTrue(
            LobbyPlayer.objects.filter(lobby=fresh, player=self.user).exists()
        )
        self.assertFalse(LobbyPlayer.objects.filter(lobby=fresh, player=user2).exists())

        # player2 arrives later and should join the same new lobby
        self.client.logout()
        self.client.login(username="testuser2", password="testpass")
        resp2 = self.client.get(reverse("set-game:lobby"))
        self.assertEqual(resp2.status_code, 200)
        self.assertTrue(LobbyPlayer.objects.filter(lobby=fresh, player=user2).exists())


class LobbyStatusViewTest(TestCase):
    def setUp(self) -> None:
        self.user: AbstractUser = User.objects.create_user(username="testuser")
        self.client.force_login(self.user)

        self.lobby: Lobby = Lobby.objects.create()
        LobbyPlayer.objects.create(lobby=self.lobby, player=self.user)
        # also create a dummy game state so we can hit game board later
        self.game_state = GameState.objects.create(lobby=self.lobby)

    def test_lobby_status_success(self):
        """Test lobby status endpoint returns correct data."""
        url = reverse("set-game:lobby_status", args=[self.lobby.id])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["players"][0]["username"], "testuser")
        self.assertIn("is_full", data)
        self.assertIn("all_ready", data)
        self.assertIn("csrf_token", data)
        self.assertEqual(data["lobby_id"], self.lobby.id)
