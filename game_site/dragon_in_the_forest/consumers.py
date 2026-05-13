import json
from typing import Dict, Any, List
from channels.generic.websocket import AsyncWebsocketConsumer  # type: ignore
from channels.db import database_sync_to_async  # type: ignore
from django.contrib.auth.models import User
from django.db import transaction
from .models import GameState, Lobby
from asgiref.sync import sync_to_async
from common.consumers import GameConsumerManager
from .game_state import CardContext, DragonGameState


class DragonForestConsumer(AsyncWebsocketConsumer):
    room_group_name: str | None = None
    game_state_id: str
    manager: GameConsumerManager

    async def connect(self) -> None:
        self.game_state_id = self.scope["url_route"]["kwargs"]["game_state_id"]
        self.manager = GameConsumerManager(self)
        await self.manager.join_group(f"game_{self.game_state_id}")
        await self.accept()

    async def disconnect(self, close_code: int) -> None:
        if self.room_group_name:
            await self.manager.leave_group(self.room_group_name)

    async def receive(self, text_data: str) -> None:
        data = json.loads(text_data)
        action = data.get("action")

        if action == "start_game":
            await self.start_game(data)
        elif action == "play_card":
            await self.handle_play_card(data)
        elif action == "replace_trump_card":
            await self.handle_trump_replacement(data)
        elif action == "discard_card":
            await self.handle_card_discard(data)
        elif action == "get_game_state":
            await self.send_game_state()
        else:
            await self.manager.send_error(f"No handler for action {action}")

    async def start_game(self, data: Dict[str, Any]) -> None:
        """Handle game initialization."""
        lobby_id = data.get("lobby_id")
        if not lobby_id:
            return await self.manager.send_error("Lobby ID is required")

        lobby = await sync_to_async(Lobby.objects.get)(id=lobby_id)
        game_state = await self.get_or_create_game_state(lobby)
        if not game_state.state_data:
            await sync_to_async(game_state.initialize_game)()

        player_ids = await sync_to_async(
            lambda: list(lobby.players.values_list("id", flat=True))
        )()

        await self.send_game_started(game_state.id, player_ids, game_state)

    @database_sync_to_async
    @transaction.atomic
    def get_or_create_game_state(self, lobby: Lobby) -> GameState:
        """Get or create a GameState for the given lobby, serialized via lobby row lock."""
        locked_lobby = Lobby.objects.select_for_update().get(pk=lobby.pk)
        game_state = GameState.objects.filter(lobby=locked_lobby).first()
        if not game_state:
            game_state = GameState.objects.create(lobby=locked_lobby)
            game_state.initialize_game()
            game_state.save()
        return game_state

    async def send_game_started(
        self, game_state_id: int, player_ids: List[int], game_state: GameState
    ) -> None:
        """Notify client that game has started."""
        user = self.scope["user"]
        state_obj = DragonGameState(**game_state.state_data)
        filtered_state = self._get_game_state_for_player(state_obj, user)
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game_started",
                    "game_state_id": game_state_id,
                    "player_ids": player_ids,
                    "game_state": filtered_state.model_dump(),
                }
            )
        )

    @database_sync_to_async
    def get_game_state(self) -> GameState:
        return GameState.objects.get(id=self.game_state_id)

    @database_sync_to_async
    def get_user(self, user_id: int) -> User:
        return User.objects.get(id=user_id)

    async def handle_play_card(self, data: Dict[str, Any]) -> None:
        game_state = await self.get_game_state()
        user = self.scope["user"]
        card = CardContext(**data["card"])

        state_obj = await self.make_move_and_update_state(game_state, user, card)

        if state_obj.winner:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "game_over",
                    "winner": state_obj.winner,
                    "game_state": state_obj.model_dump(),
                },
            )
        else:
            await self.manager.broadcast_game_state_update(state_obj.model_dump())

    @database_sync_to_async
    def make_move_and_update_state(
        self, game_state: GameState, user: User, card: CardContext
    ) -> DragonGameState:
        """Process a move and save the updated state atomically."""
        result = game_state.make_move(user, card)
        game_state.state_data = result.model_dump()
        game_state.save()
        return result

    @database_sync_to_async
    def get_user_by_username(self, username: str) -> User:
        return User.objects.get(username=username)

    async def handle_trump_replacement(self, data: Dict[str, Any]) -> None:
        """Handle replacing a card with the trump card."""
        try:
            game_state = await self.get_game_state()
            user = self.scope["user"]
            card_to_replace_id = data["card"]["id"]

            result = await sync_to_async(game_state.replace_trump_card)(
                user, card_to_replace_id
            )

            if result.winner:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        "type": "game_over",
                        "winner": result.winner,
                        "game_state": result.model_dump(),
                    },
                )
            else:
                await self.manager.broadcast_game_state_update(result.model_dump())
        except Exception as e:
            await self.manager.send_error(f"Error replacing trump card: {e}")

    async def handle_card_discard(self, data: Dict[str, Any]) -> None:
        """Handle discarding a card after drawing."""
        try:
            game_state = await self.get_game_state()
            user = self.scope["user"]
            card_to_discard_id = data["card"]["id"]

            result = await sync_to_async(game_state.discard_card)(
                user, card_to_discard_id
            )

            if result.winner:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        "type": "game_over",
                        "winner": result.winner,
                        "game_state": result.model_dump(),
                    },
                )
            else:
                await self.manager.broadcast_game_state_update(result.model_dump())
        except Exception as e:
            await self.manager.send_error(f"Error discarding card: {e}")

    async def game_state_update(self, event: Dict[str, Any]) -> None:
        user = self.scope["user"]
        state_obj = DragonGameState(**event["game_state"])
        filtered_state = self._get_game_state_for_player(state_obj, user)

        await self.manager.send_json(
            {"type": "game_state_update", "game_state": filtered_state.model_dump()}
        )

    async def send_game_state(self) -> None:
        """Send current game state to WebSocket."""
        game_state = await self.get_game_state()
        user = self.scope["user"]

        filtered_state = self._get_game_state_for_player(game_state.state_obj, user)
        await self.send(
            text_data=json.dumps(
                {"type": "game_state", "game_state": filtered_state.model_dump()}
            )
        )

    def _get_game_state_for_player(
        self, state_obj: DragonGameState, user: User
    ) -> DragonGameState:
        """Filter game state to only include information visible to the current player."""
        filtered_state = state_obj.model_copy()

        if state_obj.player1:
            is_player1 = state_obj.player1.username == user.username
        else:
            return state_obj

        filtered_state.deck = []
        if is_player1:
            filtered_state.player2.cards = []
        else:
            filtered_state.player1.cards = []
        return filtered_state

    async def send_error(self, message: str) -> None:
        """Send error message to WebSocket."""
        await self.send(text_data=json.dumps({"type": "error", "message": message}))

    async def game_over(self, event: Dict[str, Any]) -> None:
        """Handle game over event."""
        user = self.scope["user"]
        state_obj = DragonGameState(**event["game_state"])
        filtered_state = self._get_game_state_for_player(state_obj, user)
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game_over",
                    "winner": event["winner"],
                    "game_state": filtered_state.model_dump(),
                }
            )
        )
