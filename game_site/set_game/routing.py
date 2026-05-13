from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/set/game/(?P<game_state_id>\w+)/$", consumers.GameConsumer.as_asgi()),
]
