from django.shortcuts import render
from .models import Lobby, GameState, LobbyPlayer, GameSessionSingle, Card
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import JsonResponse, HttpRequest, HttpResponse
from typing import cast
from common.views import lobby_view, game_board_view, LobbyService
import json

MAX_PLAYERS = 6
lobby_service = LobbyService(Lobby, LobbyPlayer, GameState)


def lobby(request):
    return lobby_view(
        request,
        Lobby,
        LobbyPlayer,
        GameState,
        "set_game/lobby.html",
        max_players=MAX_PLAYERS,
        extra_lobby_filters={"is_solo": False},
    )


def game_board(request, game_state_id):
    return game_board_view(
        request, game_state_id, GameState, "set_game/game_board.html"
    )


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

    return JsonResponse(
        {
            "players": lobby_service.get_players_data(lobby),
            "is_full": lobby.is_full(),
            "all_ready": lobby.all_ready(),
            "csrf_token": request.META.get("CSRF_COOKIE"),
            "game_state_id": lobby_service.get_game_state_id(lobby),
            "lobby_id": lobby.id,
        }
    )


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


@login_required
def single_player_state(request: HttpRequest, lobby_id: int) -> JsonResponse:
    try:
        lobby = Lobby.objects.get(id=lobby_id)
        if not lobby.players.filter(id=request.user.id).exists():
            return JsonResponse(
                {"error": "You are not authorized to view this game."}, status=403
            )

        user = cast(User, request.user)
        game_session = (
            GameSessionSingle.objects.filter(player=user)
            .order_by("-created_at")
            .first()
        )

        if not game_session:
            game_session = GameSessionSingle.objects.create(player=user, state={})
            game_session.initialize_game()

        return JsonResponse(
            {
                "state": {
                    "board": game_session.state["board"],
                    "scores": game_session.state["scores"],
                    "cards": {
                        str(card.id): {
                            "number": card.number,
                            "symbol": card.symbol,
                            "shading": card.shading,
                            "color": card.color,
                        }
                        for card in Card.objects.filter(
                            id__in=game_session.state["board"].values()
                        )
                    },
                    "game_over": game_session.state.get("game_over", False),
                    "sets_found": game_session.sets_found,
                    "target_sets": game_session.TARGET_SETS,
                    "elapsed_time": game_session.get_elapsed_time(),
                }
            }
        )
    except Lobby.DoesNotExist:
        return JsonResponse({"error": "Game not found."}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def single_player_game_ws(request, username):
    if request.user.username != username:
        return HttpResponse("Unauthorized", status=403)

    lobby = Lobby.objects.filter(players=request.user, is_solo=True).first()
    if not lobby:
        lobby = Lobby.objects.create(is_solo=True)
        LobbyPlayer.objects.create(lobby=lobby, player=request.user)

    return render(
        request,
        "set_game/single_player_game.html",
        {
            "lobby_id": lobby.id,
            "current_username": request.user.username,
        },
    )
