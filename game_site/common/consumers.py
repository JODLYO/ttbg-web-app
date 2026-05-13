import json
from typing import Dict, Any
from channels.generic.websocket import AsyncWebsocketConsumer  # type: ignore


class GameConsumerManager:
    """Handles common WebSocket operations for any game consumer."""

    consumer: AsyncWebsocketConsumer

    def __init__(self, consumer: AsyncWebsocketConsumer) -> None:
        self.consumer = consumer

    async def send_json(self, data: Dict[str, Any]) -> None:
        await self.consumer.send(text_data=json.dumps(data))

    async def send_error(self, message: str) -> None:
        await self.send_json({"type": "error", "message": message})

    async def broadcast_group(self, message_type: str, payload: Dict[str, Any]) -> None:
        await self.consumer.channel_layer.group_send(
            self.consumer.room_group_name,
            {"type": message_type, **payload},
        )

    async def broadcast_game_state_update(self, game_state: Dict[str, Any]) -> None:
        await self.broadcast_group("game_state_update", {"game_state": game_state})

    async def join_group(self, group_name: str) -> None:
        self.consumer.room_group_name = group_name
        await self.consumer.channel_layer.group_add(
            group_name, self.consumer.channel_name
        )

    async def leave_group(self, group_name: str) -> None:
        await self.consumer.channel_layer.group_discard(
            group_name, self.consumer.channel_name
        )
