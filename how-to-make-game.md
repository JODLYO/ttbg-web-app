# How to Make a New Game

## Step 1: Create a New Django App

The new game will be a Django app. From the `board_game_site/game_site` directory, run:

```bash
python manage.py startapp new_game
```

Replace `new_game` with your game's actual name (e.g., `chess`, `poker`, `checkers`).

## Step 2: Add App to settings.py

In `game_site/game_site/settings.py`, add your new app to the `INSTALLED_APPS` list:

```python
INSTALLED_APPS = [
    # ... existing apps ...
    'new_game',
]
```

## Step 3: Create Core Game Files

Create the following essential files in your app directory:

- **models.py** - Define your game's data models (GameRoom, Player, GameState, etc.)
- **views.py** - Create views to render game pages and handle HTTP requests
- **urls.py** - Define URL patterns for your game (create this file if it doesn't exist)
- **routing.py** - Define WebSocket routing for real-time game updates (optional, but recommended)
- **consumers.py** - Define WebSocket consumers for handling game logic (optional, but recommended)
- **game_state.py** - Create a class to manage game state and logic

Example view in `views.py`:

```python
from django.shortcuts import render
from django.contrib.auth.decorators import login_required

@login_required
def game_view(request):
    return render(request, 'new_game/game.html')
```

## Step 4: Add URL Routing

Create `new_game/urls.py`:

```python
from django.urls import path
from . import views

app_name = 'new_game'

urlpatterns = [
    path('', views.game_view, name='game'),
    path('api/move/', views.make_move, name='make_move'),
]
```

Then add your app's URLs to `game_site/game_site/urls.py`:

```python
from django.urls import path, include

urlpatterns = [
    # ... existing patterns ...
    path('new_game/', include('new_game.urls')),
]
```

## Step 5: Add WebSocket Routing (Recommended for Real-time Games)

Create `new_game/routing.py` for WebSocket support:

```python
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/new_game/(?P<room_id>\w+)/$', consumers.GameConsumer.as_asgi()),
]
```

Then update `game_site/game_site/routing.py` to include your app's routes:

```python
from django.urls import path, include

application = ProtocolTypeRouter({
    # ... existing patterns ...
    'websocket': AuthMiddlewareStack(
        URLRouter([
            path('new_game/', include('new_game.routing')),
        ])
    ),
})
```

Create `new_game/consumers.py` to handle WebSocket connections:

```python
from channels.generic.websocket import AsyncWebsocketConsumer
import json

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        await self.channel_layer.group_add(
            f'game_{self.room_id}',
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            f'game_{self.room_id}',
            self.channel_name
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        # Handle game logic here
```

## Step 6: Frontend - JavaScript or React (Optional)

### Option A: Plain JavaScript
Create `new_game/templates/new_game/game.html` for server-side rendered template with vanilla JavaScript.

### Option B: React
If you prefer a modern frontend:

1. Create `new_game/react/` directory with React setup
2. Copy the structure from `dragon_in_the_forest/react/` or `hive/react/`
3. Build your components and configure Vite
4. Update your template to include the React bundle

See the `dragon_in_the_forest` or `hive` apps for React integration examples.

## Step 7: Use Common App Utilities

The `common` app contains reusable classes and utilities you can leverage:

- **BaseGameModel** - Inherit from this for consistent game data modeling
- **GameConsumer** - Base consumer for WebSocket handling
- **Game-related views and mixins** - Reusable view logic
- **Utility functions** - Common helper functions for game logic

Example in `new_game/models.py`:

```python
from common.models import BaseGameModel  # or whatever base class is available
from django.contrib.auth.models import User
from django.db import models

class GameRoom(BaseGameModel):
    host = models.ForeignKey(User, on_delete=models.CASCADE)
    players = models.ManyToManyField(User, related_name='game_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
```

Check the `common` app for available base classes and utilities.

## Step 8: Update Home App to Display New Game

Edit the home app to add your game to the game list:

In `home/views.py`:

```python
def home_view(request):
    games = [
        {'name': 'Dragon in the Forest', 'url': 'dragon_in_the_forest:game'},
        {'name': 'Hive', 'url': 'hive:game'},
        {'name': 'Set Game', 'url': 'set_game:game'},
        {'name': 'New Game', 'url': 'new_game:game'},  # Add this line
    ]
    return render(request, 'home/index.html', {'games': games})
```

In `home/templates/home/index.html`, add a link to your game:

```html
<a href="{% url 'new_game:game' %}">New Game</a>
```

## Step 9: Create Templates

Create `new_game/templates/new_game/` directory with your HTML templates:

```
new_game/templates/new_game/
├── game.html
├── lobby.html
└── rules.html
```

Example `game.html`:

```html
{% extends "base.html" %}

{% block title %}New Game{% endblock %}

{% block content %}
<div id="game-container">
    <!-- Your game UI here -->
</div>

<script>
    // WebSocket connection for real-time updates
    const ws = new WebSocket(`ws://${window.location.host}/ws/new_game/${roomId}/`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        // Handle game updates
    };
</script>
{% endblock %}
```

## Step 10: Run Tests and Migrations

```bash
# Create migrations for your models
python manage.py makemigrations new_game

# Apply migrations
python manage.py migrate

# Run tests
pytest new_game/tests/
```

---

That's it! Follow these steps and your new game will be integrated into the site.
