from django.db import models
from django.contrib.auth.models import User


class BaseLobby(models.Model):
    MAX_PLAYERS: int = 2
    created_at: models.DateTimeField = models.DateTimeField(auto_now_add=True)
    last_activity: models.DateTimeField = models.DateTimeField(auto_now=True)
    players: "models.ManyToManyField"  # type: ignore
    lobbyplayer_set: "models.ManyToManyField"  # type: ignore

    class Meta:
        abstract = True

    def is_full(self) -> bool:
        return self.players.count() >= self.MAX_PLAYERS

    def all_ready(self) -> bool:
        return all(lp.ready for lp in self.lobbyplayer_set.all())


class BaseLobbyPlayer(models.Model):
    player = models.ForeignKey(User, on_delete=models.CASCADE)
    last_activity = models.DateTimeField(auto_now=True)
    ready = models.BooleanField(default=False)

    class Meta:
        abstract = True


class BaseGameState(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
