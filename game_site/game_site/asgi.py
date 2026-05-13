import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter  # type: ignore
from channels.auth import AuthMiddlewareStack  # type: ignore

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "game_site.settings")

django_asgi_app = get_asgi_application()
import set_game.routing  # noqa: E402
import dragon_in_the_forest.routing  # noqa: E402
import hive.routing  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(
            URLRouter(
                set_game.routing.websocket_urlpatterns
                + dragon_in_the_forest.routing.websocket_urlpatterns
                + hive.routing.websocket_urlpatterns
            )
        ),
    }
)
