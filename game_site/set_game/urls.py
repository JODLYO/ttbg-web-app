from django.urls import path
from . import views

app_name = "set-game"

urlpatterns = [
    path("lobby/", views.lobby, name="lobby"),
    path("game/<int:game_state_id>/", views.game_board, name="game_board"),
    path("api/lobby_status/<int:lobby_id>/", views.lobby_status, name="lobby_status"),
    path(
        "api/lobby_status/<int:lobby_id>/ready/", views.lobby_ready, name="lobby_ready"
    ),
    path(
        "api/single_player_state/<int:lobby_id>/",
        views.single_player_state,
        name="single_player_state",
    ),
    path(
        "single-player/<str:username>/",
        views.single_player_game_ws,
        name="single_player_game_ws",
    ),
]
