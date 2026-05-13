import json
from typing import Dict, Any, List
from channels.generic.websocket import AsyncWebsocketConsumer  # type: ignore
from asgiref.sync import sync_to_async
from .models import GameSession, Card, Lobby
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.db import transaction
from common.consumers import GameConsumerManager


class GameConsumer(AsyncWebsocketConsumer):
    room_group_name: str | None = None

    async def connect(self) -> None:
        self.manager = GameConsumerManager(self)
        self.game_state_id = self.scope["url_route"]["kwargs"]["game_state_id"]
        await self.manager.join_group(f"game_{self.game_state_id}")
        await self.accept()

    async def disconnect(self, close_code: int) -> None:
        if self.room_group_name:
            await self.manager.leave_group(self.room_group_name)

    async def receive(self, text_data: str) -> None:
        data = json.loads(text_data)
        if data["type"] == "start_game":
            await self.start_game(data)
        elif data["type"] == "make_move":
            await self.make_move(data)
        elif data["type"] == "request_rematch":
            await self.request_rematch(data)
        else:
            await self.manager.send_error(f"Unknown action: {data['type']}")

    async def start_game(self, data: Dict[str, Any]) -> None:
        """Handle game initialization."""
        lobby_id = data.get("lobby_id")
        if not lobby_id:
            await self.manager.send_error("Lobby ID is required")
            return

        try:
            lobby = await sync_to_async(Lobby.objects.get)(id=lobby_id)
        except Lobby.DoesNotExist:
            await self.manager.send_error("Lobby not found")
            return

        game_session = await self.get_or_create_game_session(lobby)
        player_ids = await sync_to_async(
            lambda: list(game_session.players.values_list("id", flat=True))
        )()

        await self.send_game_started(game_session.id, player_ids, game_session)

    async def get_or_create_game_session(self, lobby: Lobby) -> GameSession:
        """Get or create a GameSession for the given lobby."""
        return await sync_to_async(self._get_or_create_game_session_sync)(lobby)

    @transaction.atomic
    def _get_or_create_game_session_sync(self, lobby: Lobby) -> GameSession:
        """Serialized via lobby row lock to prevent duplicate session creation."""
        locked_lobby = Lobby.objects.select_for_update().get(pk=lobby.pk)
        prefix = f"Lobby-{locked_lobby.id}-"
        current_player_ids = set(locked_lobby.players.values_list("id", flat=True))

        game_session = GameSession.objects.filter(name__startswith=prefix).first()
        if game_session:
            session_player_ids = set(game_session.players.values_list("id", flat=True))
            if session_player_ids == current_player_ids:
                return game_session

        return self.create_game_session(locked_lobby)

    def create_game_session(self, lobby: Lobby) -> GameSession:
        """Create and initialize a new game session."""
        game_session = GameSession.objects.create(
            name=f"Lobby-{lobby.id}-{timezone.now().strftime('%H%M%S')}"
        )
        for lobby_player in lobby.lobbyplayer_set.all():
            game_session.players.add(lobby_player.player)

        game_session.initialize_game()
        game_session.state_obj.player_ids = [
            player.id for player in game_session.players.all()
        ]
        game_session.state_obj.scores = {
            str(player.username): 0 for player in game_session.players.all()
        }
        game_session.save()
        return game_session

    async def make_move(self, data: Dict[str, Any]) -> None:
        """Process a player's move"""
        try:
            result = await sync_to_async(self._process_move)(data)

            if result["success"]:
                await self.broadcast_game_state(result["game_session"])
                if result["game_session"].state.get("game_over", False):
                    await self.broadcast_game_over()
            else:
                await self.manager.send_error(result.get("error", "Unknown error"))

        except Exception as e:
            await self.manager.send_error(f"Error processing move: {str(e)}")

    @transaction.atomic
    def _process_move(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Synchronous method to process move"""
        try:
            game_session = GameSession.objects.select_for_update().get(
                pk=data["session_id"]
            )
            player = self.scope["user"]

            if not self.validate_card_ids(
                data["card_ids"], list(game_session.state_obj.board.values())
            ):
                return {"success": False, "error": "Cards not on board"}

            game_session.validate_and_process_move(player, data["card_ids"])
            game_session.save()

            return {"success": True, "game_session": game_session}

        except GameSession.DoesNotExist:
            return {"success": False, "error": "Game session not found"}
        except ValidationError as e:
            return {"success": False, "error": str(e)}

    async def game_state(self, event: Dict[str, Any]) -> None:
        """Send game state update to client."""
        await self.manager.send_json(
            {
                "type": "game_state",
                "state": event["state"],
            }
        )

    async def game_over(self, event: Dict[str, Any]) -> None:
        """Notify client that game has ended."""
        await self.manager.send_json(
            {
                "type": "game_over",
                "message": event["message"],
            }
        )

    async def request_rematch(self, data: Dict[str, Any]) -> None:
        """Handle a player's rematch request."""
        try:
            result = await sync_to_async(self._process_rematch_request)(data)
            if result["success"]:
                await self.broadcast_rematch_status(result["rematch_status"])
                if result["all_players_ready"]:
                    await self.start_new_game(result["game_session"])
            else:
                await self.manager.send_error(result.get("error", "Unknown error"))
        except Exception as e:
            await self.manager.send_error(f"Error processing rematch request: {str(e)}")

    @transaction.atomic
    def _process_rematch_request(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process a rematch request."""
        try:
            game_session = GameSession.objects.select_for_update().get(
                pk=data["session_id"]
            )
            player = self.scope["user"]

            if not game_session.state_obj.rematch_status:
                game_session.state_obj.rematch_status = {}

            game_session.state_obj.rematch_status[str(player.username)] = True
            game_session.save()

            all_players = list(game_session.players.all())

            all_players_ready = all(
                game_session.state_obj.rematch_status.get(str(p.username), False)
                for p in all_players
            ) and len(game_session.state_obj.rematch_status) == len(all_players)

            if all_players_ready:
                game_session.initialize_game()
                game_session.state_obj.rematch_status = {}
                game_session.save()

            return {
                "success": True,
                "rematch_status": game_session.state_obj.rematch_status,
                "all_players_ready": all_players_ready,
                "game_session": game_session,
            }

        except GameSession.DoesNotExist:
            return {"success": False, "error": "Game session not found"}

    async def broadcast_rematch_status(self, rematch_status: Dict[str, bool]) -> None:
        """Broadcast rematch status to all clients."""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "rematch_status",
                "rematch_status": rematch_status,
            },
        )

    async def rematch_status(self, event: Dict[str, Any]) -> None:
        """Send rematch status update to client."""
        await self.manager.send_json(
            {
                "type": "rematch_status",
                "rematch_status": event["rematch_status"],
            }
        )

    async def start_new_game(self, game_session: GameSession) -> None:
        """Start a new game with the same players."""
        await self.broadcast_game_state(game_session)

    async def send_game_started(
        self, session_id: int, player_ids: List[int], game_session: GameSession
    ) -> None:
        """Notify client that game has started."""
        await self.manager.send_json(
            {
                "type": "game_started",
                "session_id": session_id,
                "player_ids": player_ids,
                "state": await sync_to_async(self.serialize_game_state)(game_session),
            }
        )

    async def broadcast_game_state(self, game_session: GameSession) -> None:
        """Broadcast current game state to all clients."""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "game_state",
                "state": await sync_to_async(self.serialize_game_state)(game_session),
            },
        )

    def serialize_game_state(self, session: GameSession) -> Dict[str, Any]:
        """Prepare game state for serialization."""
        return {
            "session": session.name,
            "players": [player.username for player in session.players.all()],
            "board": session.state_obj.board,
            "scores": session.state_obj.scores,
            "cards": {
                str(card.id): {
                    "number": card.number,
                    "symbol": card.symbol,
                    "shading": card.shading,
                    "color": card.color,
                }
                for card in Card.objects.filter(id__in=session.state_obj.board.values())
            },
        }

    def validate_card_ids(self, card_ids: List[int], board_card_ids: List[int]) -> bool:
        """Verify all card IDs exist on the board."""
        return all(card_id in board_card_ids for card_id in card_ids)

    async def broadcast_game_over(self) -> None:
        """Notify all clients that game has ended."""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "game_over",
                "message": "Game over! No more sets are possible.",
            },
        )
