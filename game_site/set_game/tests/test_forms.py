from django.contrib.auth import get_user_model
from django_webtest import WebTest
from django.urls import reverse

from set_game.models import Lobby

User = get_user_model()


class LobbyFormTest(WebTest):
    def setUp(self):
        self.user = User.objects.create_user(username="testuser")
        self.app.set_user(self.user)

    def test_lobby_creation(self):
        response = self.app.get(reverse("home:home"))
        form = response.form

        if "username" in form.fields:
            form["username"] = "Test Lobby"

        response = form.submit()
        self.assertEqual(response.status_code, 302)  # Adjust as needed

    def tearDown(self):
        # Clean up after each test
        self.user.delete()


class ExistingUserLoginTest(WebTest):
    def setUp(self):
        self.user = User.objects.create_user(username="existinguser")
        self.app.set_user(self.user)

    def test_existing_user_login(self):
        response = self.app.get(reverse("home:home"))
        form = response.form

        if "username" in form.fields:
            form["username"] = "existinguser"

        response = form.submit()

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/set-game/lobby/")

    def tearDown(self):
        self.user.delete()


class NewUserCreationTest(WebTest):
    def test_new_user_creation(self):
        response = self.app.get(reverse("home:home"))
        form = response.form
        self.assertIn("username", form.fields)
        form["username"] = "newuser"
        response = form.submit()
        self.assertEqual(response.status_code, 302)  # Should redirect to 'lobby'

        # Check that the user was created
        self.assertTrue(User.objects.filter(username="newuser").exists())

        # Cleanup
        User.objects.get(username="newuser").delete()


class MissingUsernameTest(WebTest):
    def test_missing_username(self):
        response = self.app.get(reverse("home:home"))
        form = response.form
        response = form.submit()
        self.assertNotEqual(response.status_code, 302)  # Should NOT redirect
        self.assertContains(response, "This field is required", status_code=200)


class LobbyJoiningTest(WebTest):
    def setUp(self):
        # Create test users
        self.user1 = User.objects.create_user(username="player1")
        self.user2 = User.objects.create_user(username="player2")

    def test_multiple_users_lobby(self):
        """Test that multiple users can create/join a lobby correctly via the view"""

        # Simulate Player 1 logging in and accessing the lobby
        self.app.set_user(self.user1)
        response1 = self.app.get(reverse("set-game:lobby"))

        self.assertEqual(response1.status_code, 200)

        # Simulate Player 2 logging in and accessing the lobby
        self.app.set_user(self.user2)
        response2 = self.app.get(reverse("set-game:lobby"))
        self.assertEqual(response2.status_code, 200)

        # Ensure the lobby was created
        lobby = Lobby.objects.first()
        self.assertIsNotNone(lobby, "Lobby should have been created")

        # Ensure both players are in the same lobby
        players = [lp.player.username for lp in lobby.lobbyplayer_set.all()]
        self.assertIn("player1", players)
        self.assertIn("player2", players)

    def tearDown(self):
        # Clean up test users
        self.user1.delete()
        self.user2.delete()
