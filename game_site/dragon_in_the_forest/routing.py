from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(
        r"ws/ditf/game/(?P<game_state_id>\d+)/$",
        consumers.DragonForestConsumer.as_asgi(),
    ),
]
