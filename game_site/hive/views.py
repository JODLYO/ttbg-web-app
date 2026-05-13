import json
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from common.views import lobby_view, game_board_view, LobbyService

from .models import Lobby, GameState, LobbyPlayer

MAX_PLAYERS = 2
lobby_service = LobbyService(Lobby, LobbyPlayer, GameState)


def lobby(request):
    return lobby_view(
        request,
        Lobby,
        LobbyPlayer,
        GameState,
        "hive/lobby.html",
        max_players=MAX_PLAYERS,
    )


def game_board(request, game_state_id):
    return game_board_view(request, game_state_id, GameState, "hive/game_board.html")


@login_required
def lobby_status(request, lobby_id):
    """Return the current state of a lobby (read-only)."""
    try:
        lobby = lobby_service.get_lobby(lobby_id)
    except Lobby.DoesNotExist:
        return JsonResponse({"error": "Lobby not found"}, status=404)

    lobby_service.remove_inactive_players(lobby)
    if not lobby_service.update_last_activity(lobby, request.user):
        return JsonResponse(
            {"error": "You have been removed from the lobby due to inactivity"},
            status=404,
        )

    data = {
        "players": lobby_service.get_players_data(lobby),
        "is_full": lobby.is_full(),
        "all_ready": lobby.all_ready(),
        "csrf_token": request.META.get("CSRF_COOKIE"),
        "game_state_id": lobby_service.get_game_state_id(lobby),
        "lobby_id": lobby.id,
    }
    return JsonResponse(data)


@login_required
def lobby_ready(request, lobby_id):
    """Mark the current player as ready (or unready if passed)."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        lobby = lobby_service.get_lobby(lobby_id)
    except Lobby.DoesNotExist:
        return JsonResponse({"error": "Lobby not found"}, status=404)

    body = json.loads(request.body or "{}")
    ready = body.get("ready", True)

    try:
        is_ready = lobby_service.mark_ready(lobby, request.user, ready)
    except LobbyPlayer.DoesNotExist:
        return JsonResponse({"error": "Lobby player not found"}, status=404)

    return JsonResponse({"ready": is_ready})
