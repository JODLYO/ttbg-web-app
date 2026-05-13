from django.urls import path
from . import views

app_name = "dragon-in-the-forest"

urlpatterns = [
    path("lobby/", views.lobby, name="lobby"),
    path("game/<int:game_state_id>/", views.game_board, name="game_board"),
    path("api/lobby_status/<int:lobby_id>/", views.lobby_status, name="lobby_status"),
    path(
        "api/lobby_status/<int:lobby_id>/ready/",
        views.lobby_ready,
        name="lobby_set_ready",
    ),
]
