import json
from typing import Dict, Any, Tuple
from channels.generic.websocket import AsyncWebsocketConsumer  # type: ignore[import-untyped]
from channels.db import database_sync_to_async  # type: ignore[import-untyped]
from django.contrib.auth.models import User
from django.db import transaction
from asgiref.sync import sync_to_async

from common.consumers import GameConsumerManager
from .models import GameState, Lobby
from .game_state import HivePosition, HivePieceState


class HiveConsumer(AsyncWebsocketConsumer):
    room_group_name: str | None = None

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
        elif action == "get_game_state":
            await self.send_game_state()
        elif action == "play_piece":
            await self.handle_play_piece(data)
        elif action == "pillbug_throw":
            await self.handle_pillbug_throw(data)
        else:
            await self.manager.send_error(f"No handler for action {action}")

    async def start_game(self, data: Dict[str, Any]) -> None:
        lobby_id = data.get("lobby_id")
        if not lobby_id:
            return await self.manager.send_error("Lobby ID is required")

        lobby = await sync_to_async(Lobby.objects.get)(id=lobby_id)
        game_state = await self.get_or_create_game_state(lobby)

        if not game_state.state_data:
            players: list[User] = await sync_to_async(
                lambda: list(lobby.players.all())
            )()
            await sync_to_async(game_state.initialize_game_state)(players)

        await self.send_game_started(game_state.id, game_state.state_data)

    @database_sync_to_async
    @transaction.atomic
    def get_or_create_game_state(self, lobby: Lobby) -> GameState:
        """Serialized via lobby row lock to prevent duplicate GameState creation."""
        locked_lobby = Lobby.objects.select_for_update().get(pk=lobby.pk)
        game_state = GameState.objects.filter(lobby=locked_lobby).first()
        if not game_state:
            game_state = GameState.objects.create(lobby=locked_lobby)
        return game_state

    async def send_game_started(
        self, game_state_id: int, state_data: Dict[str, Any]
    ) -> None:
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game_state",
                    "game_state_id": game_state_id,
                    "game_state": state_data,
                }
            )
        )

    @database_sync_to_async
    def get_game_state(self) -> GameState:
        return GameState.objects.get(id=self.game_state_id)

    async def handle_play_piece(self, data: Dict[str, Any]) -> None:
        piece = HivePieceState(**data["piece"])
        position = HivePosition(**data["position"])
        user = self.scope["user"]

        game_state = await self.get_game_state()
        is_player = await sync_to_async(
            lambda: game_state.lobby.players.filter(id=user.id).exists()
        )()
        if not is_player:
            return await self.manager.send_error("You are not a player in this game")

        success, message = await self.play_piece(
            game_state, piece, position, user.username
        )
        if not success:
            return await self.manager.send_error(message)

        await self.manager.broadcast_group("send_game_state", {})

    @database_sync_to_async
    def play_piece(
        self,
        game_state: GameState,
        piece: HivePieceState,
        position: HivePosition,
        username: str,
    ) -> Tuple[bool, str]:
        return game_state.play_piece(piece, position, username)

    async def handle_pillbug_throw(self, data: Dict[str, Any]) -> None:
        pillbug = HivePieceState(**data["pillbug"])
        target_piece = HivePieceState(**data["target_piece"])
        target_pos = HivePosition(**data["target_position"])
        user = self.scope["user"]

        game_state = await self.get_game_state()
        is_player = await sync_to_async(
            lambda: game_state.lobby.players.filter(id=user.id).exists()
        )()
        if not is_player:
            return await self.manager.send_error("You are not a player in this game")

        success, message = await self.throw_piece(
            game_state, pillbug, target_piece, target_pos, user.username
        )
        if not success:
            return await self.manager.send_error(message)

        await self.manager.broadcast_group("send_game_state", {})

    @database_sync_to_async
    def throw_piece(
        self,
        game_state: GameState,
        pillbug: HivePieceState,
        target_piece: HivePieceState,
        target_pos: HivePosition,
        username: str,
    ) -> Tuple[bool, str]:
        return game_state.throw_piece(pillbug, target_piece, target_pos, username)

    async def send_game_state(self, event: Dict[str, Any] | None = None) -> None:
        game_state = await self.get_game_state()
        await self.manager.send_json(
            {"type": "game_state", "game_state": game_state.state_data}
        )
