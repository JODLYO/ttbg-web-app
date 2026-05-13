from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.views.decorators.cache import never_cache
from django.http import JsonResponse, HttpRequest, HttpResponse, Http404
from django.contrib.auth.models import User
from django.db import models
from django.db.models import Count
from django.utils import timezone
from datetime import timedelta
from typing import cast
from django.core.exceptions import ObjectDoesNotExist

MAX_PLAYERS_DEFAULT = 2


@login_required
@never_cache
def lobby_view(
    request: HttpRequest,
    Lobby: type[models.Model],
    LobbyPlayer: type[models.Model],
    GameState: type[models.Model],
    template_name: str,
    max_players: int = MAX_PLAYERS_DEFAULT,
    extra_lobby_filters: dict | None = None,
) -> HttpResponse:
    """Generic lobby view that can be reused across games."""
    extra = extra_lobby_filters or {}
    lobby = Lobby.objects.filter(
        players=cast(User, request.user), game_state__isnull=True, **extra
    ).first()
    if not lobby:
        open_lobby = (
            Lobby.objects.annotate(player_count=Count("players"))
            .filter(player_count__lt=max_players, game_state__isnull=True, **extra)
            .first()
        )
        if open_lobby:
            LobbyPlayer.objects.create(
                lobby=open_lobby, player=cast(User, request.user)
            )
            lobby = open_lobby
        else:
            lobby = Lobby.objects.create()
            LobbyPlayer.objects.create(lobby=lobby, player=cast(User, request.user))

    if request.method == "POST":
        lobby_player = LobbyPlayer.objects.get(
            lobby=lobby, player=cast(User, request.user)
        )
        lobby_player.ready = True
        lobby_player.save()

        if lobby.players.count() >= max_players and lobby.all_ready():
            game_state = GameState.objects.create(lobby=lobby)
            lobby.game_state = game_state
            lobby.save()

        return JsonResponse(
            {
                "is_full": lobby.is_full(),
                "all_ready": lobby.all_ready(),
                "players": [
                    {"username": lp.player.username, "ready": lp.ready}
                    for lp in lobby.lobbyplayer_set.all()
                ],
                "csrf_token": request.COOKIES.get("csrftoken"),
            }
        )

    return render(request, template_name, {"lobby": lobby})


@login_required
@never_cache
def game_board_view(
    request: HttpRequest,
    game_state_id: int,
    GameState: type[models.Model],
    template_name: str,
) -> HttpResponse:
    """Generic game board view."""
    try:
        game_state = GameState.objects.get(id=game_state_id)
        lobby = game_state.lobby

        if not lobby.players.filter(id=request.user.id).exists():
            raise Http404("You are not a player in this game")

        return render(
            request,
            template_name,
            {
                "game_state": game_state,
                "lobby_id": lobby.id,
                "current_username": request.user.username,
            },
        )
    except GameState.DoesNotExist:
        raise Http404("Game not found")


class LobbyService:
    """
    Common lobby logic.
    Each app passes its own models when creating the service.
    """

    def __init__(
        self,
        LobbyModel: type[models.Model],
        LobbyPlayerModel: type[models.Model],
        GameStateModel: type[models.Model],
    ) -> None:
        self.Lobby = LobbyModel
        self.LobbyPlayer = LobbyPlayerModel
        self.GameState = GameStateModel

    def get_lobby(self, lobby_id: int) -> models.Model:
        return self.Lobby.objects.get(pk=lobby_id)

    def remove_inactive_players(
        self, lobby: models.Model, cutoff_minutes: int = 5
    ) -> None:
        cutoff_time = timezone.now() - timedelta(minutes=cutoff_minutes)
        self.LobbyPlayer.objects.filter(
            lobby=lobby, last_activity__lt=cutoff_time
        ).delete()

    def update_last_activity(
        self, lobby: models.Model, user: User | None = None
    ) -> bool:
        lobby.last_activity = timezone.now()
        lobby.save()
        if user:
            try:
                player = self.LobbyPlayer.objects.get(lobby=lobby, player=user)
                player.last_activity = timezone.now()
                player.save()
            except self.LobbyPlayer.DoesNotExist:
                return False
        return True

    @staticmethod
    def get_players_data(lobby: models.Model) -> list[dict[str, str | bool]]:
        return [
            {
                "username": lp.player.username,
                "ready": lp.ready,
                "last_activity": lp.last_activity.isoformat(),
            }
            for lp in lobby.lobbyplayer_set.all()
        ]

    @staticmethod
    def get_game_state_id(lobby: models.Model) -> int | None:
        try:
            return lobby.game_state.id
        except ObjectDoesNotExist:
            return None

    def mark_ready(
        self, lobby: models.Model, user: User, ready: bool = True, min_players: int = 2
    ) -> bool:
        player = self.LobbyPlayer.objects.get(lobby=lobby, player=user)
        player.ready = ready
        player.last_activity = timezone.now()
        player.save()

        if lobby.players.count() >= min_players and lobby.all_ready():
            game_state, _ = self.GameState.objects.get_or_create(lobby=lobby)
            lobby.game_state = game_state
            lobby.save()

        return player.ready
