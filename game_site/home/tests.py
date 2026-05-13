from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse


class HomeViewTests(TestCase):
    def setUp(self):
        self.client = Client()
        # create a user we'll log in manually
        self.user = User.objects.create(username="existing")

    def test_anonymous_get_shows_form(self):
        response = self.client.get(reverse("home:home"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Your player name")

    def test_post_creates_user_and_redirects(self):
        data = {"username": "foo", "game_mode": "lobby"}
        response = self.client.post(reverse("home:home"), data)
        # should redirect to set-game lobby
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.filter(username__startswith="foo").exists())

    def test_authenticated_user_get_does_not_show_login_form(self):
        # log in the existing user
        self.client.force_login(self.user)
        response = self.client.get(reverse("home:home"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Welcome back, <strong>existing</strong>")
        # form should still exist (so game_mode can be posted) but not username field
        self.assertNotContains(response, 'name="username"')

    def test_authenticated_user_post_uses_existing_account(self):
        self.client.force_login(self.user)
        response = self.client.post(reverse("home:home"), {"game_mode": "hive"})
        self.assertEqual(response.status_code, 302)
        # redirect should point to hive lobby
        self.assertRedirects(response, reverse("hive:lobby"))
