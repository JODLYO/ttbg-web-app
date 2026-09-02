import pytest
import pytest_asyncio
from typing import Any, Dict
from channels.testing import WebsocketCommunicator
from asgiref.sync import sync_to_async
from django.contrib.auth.models import User
from django.core.management import call_command

from hive.consumers import HiveConsumer
from hive.models import GameState, Lobby, LobbyPlayer, Piece
from hive.game_state import HivePieceType, HivePosition


@pytest_asyncio.fixture
async def game_data() -> Dict[str, Any]:
    """A ready two-player game with the Queens and a Pillbug already placed,
    so the Pillbug's throw ability can legally be used on player1's turn."""
    pieces_exist = await sync_to_async(Piece.objects.exists)()
    if not pieces_exist:
        await sync_to_async(call_command)("seed_hive_pieces")

    player1 = await sync_to_async(User.objects.create_user)(username="player1")
    player2 = await sync_to_async(User.objects.create_user)(username="player2")
    lobby = await sync_to_async(Lobby.objects.create)()
    await sync_to_async(LobbyPlayer.objects.create)(
        lobby=lobby, player=player1, ready=True
    )
    await sync_to_async(LobbyPlayer.objects.create)(
        lobby=lobby, player=player2, ready=True
    )

    game_state = await sync_to_async(GameState.objects.create)(lobby=lobby)
    await sync_to_async(game_state.initialize_game_state)([player1, player2])

    def _place_opening_pieces() -> Dict[str, Any]:
        state = game_state.state_obj

        pillbug = next(
            p
            for p in state.player1_state.pieces_in_hand
            if p.piece_type == HivePieceType.PILLBUG
        )
        game_state.play_piece(
            pillbug, HivePosition(q=0, r=0, s=0), username="player1"
        )

        opp_ant = next(
            p
            for p in state.player2_state.pieces_in_hand
            if p.piece_type == HivePieceType.ANT
        )
        game_state.play_piece(
            opp_ant, HivePosition(q=1, r=-1, s=0), username="player2"
        )

        own_queen = next(
            p
            for p in game_state.state_obj.player1_state.pieces_in_hand
            if p.piece_type == HivePieceType.QUEEN
        )
        game_state.play_piece(
            own_queen, HivePosition(q=-1, r=1, s=0), username="player1"
        )

        opp_queen = next(
            p
            for p in game_state.state_obj.player2_state.pieces_in_hand
            if p.piece_type == HivePieceType.QUEEN
        )
        game_state.play_piece(
            opp_queen, HivePosition(q=2, r=-1, s=-1), username="player2"
        )

        final_state = game_state.state_obj
        placed_pillbug = final_state.board_state.cells[
            HivePosition(q=0, r=0, s=0)
        ].pieces[-1]
        placed_queen = final_state.board_state.cells[
            HivePosition(q=-1, r=1, s=0)
        ].pieces[-1]
        return {"pillbug": placed_pillbug, "own_queen": placed_queen}

    placed = await sync_to_async(_place_opening_pieces)()

    return {
        "player1": player1,
        "player2": player2,
        "lobby": lobby,
        "game_state": game_state,
        "pillbug": placed["pillbug"],
        "own_queen": placed["own_queen"],
    }


async def make_communicator(
    game_state: GameState, user: User
) -> WebsocketCommunicator:
    communicator = WebsocketCommunicator(
        HiveConsumer.as_asgi(), f"/ws/hive/game/{game_state.id}/"
    )
    communicator.scope["url_route"] = {
        "kwargs": {"game_state_id": str(game_state.id)}
    }
    communicator.scope["user"] = user
    connected, _ = await communicator.connect()
    assert connected
    return communicator


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_pillbug_throw_valid(game_data: Dict[str, Any]) -> None:
    """A legal Pillbug throw is applied and broadcast as an updated game state."""
    game_state: GameState = game_data["game_state"]
    communicator = await make_communicator(game_state, game_data["player1"])

    dest = HivePosition(q=1, r=0, s=-1)
    await communicator.send_json_to(
        {
            "action": "pillbug_throw",
            "pillbug": game_data["pillbug"].model_dump(),
            "target_piece": game_data["own_queen"].model_dump(),
            "target_position": dest.model_dump(),
            "username": "player1",
        }
    )

    response = await communicator.receive_json_from()
    assert response["type"] == "game_state"

    final_gs = await sync_to_async(GameState.objects.get)(id=game_state.id)
    final_state = final_gs.state_obj
    assert final_state.player1_turn is False  # turn passed to player2
    assert dest in final_state.board_state.cells
    assert HivePosition(q=-1, r=1, s=0) not in final_state.board_state.cells

    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_pillbug_throw_wrong_turn_rejected(game_data: Dict[str, Any]) -> None:
    """Only the player whose turn it is can use their Pillbug's throw ability."""
    game_state: GameState = game_data["game_state"]
    communicator = await make_communicator(game_state, game_data["player2"])

    dest = HivePosition(q=1, r=0, s=-1)
    await communicator.send_json_to(
        {
            "action": "pillbug_throw",
            "pillbug": game_data["pillbug"].model_dump(),
            "target_piece": game_data["own_queen"].model_dump(),
            "target_position": dest.model_dump(),
            "username": "player2",
        }
    )

    response = await communicator.receive_json_from()
    assert response["type"] == "error"
    assert response["message"] == "It is not your turn"

    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_pillbug_throw_rejects_non_player(game_data: Dict[str, Any]) -> None:
    """A user who isn't a player in this game cannot issue a throw."""
    game_state: GameState = game_data["game_state"]
    outsider = await sync_to_async(User.objects.create_user)(username="outsider")
    communicator = await make_communicator(game_state, outsider)

    dest = HivePosition(q=1, r=0, s=-1)
    await communicator.send_json_to(
        {
            "action": "pillbug_throw",
            "pillbug": game_data["pillbug"].model_dump(),
            "target_piece": game_data["own_queen"].model_dump(),
            "target_position": dest.model_dump(),
            "username": "player1",
        }
    )

    response = await communicator.receive_json_from()
    assert response["type"] == "error"
    assert response["message"] == "You are not a player in this game"

    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_pillbug_throw_invalid_destination_rejected(
    game_data: Dict[str, Any],
) -> None:
    """A throw onto an occupied hex is rejected and the board is left unchanged."""
    game_state: GameState = game_data["game_state"]
    communicator = await make_communicator(game_state, game_data["player1"])

    occupied_dest = HivePosition(q=2, r=-1, s=-1)  # opponent's Queen is here
    await communicator.send_json_to(
        {
            "action": "pillbug_throw",
            "pillbug": game_data["pillbug"].model_dump(),
            "target_piece": game_data["own_queen"].model_dump(),
            "target_position": occupied_dest.model_dump(),
            "username": "player1",
        }
    )

    response = await communicator.receive_json_from()
    assert response["type"] == "error"

    final_gs = await sync_to_async(GameState.objects.get)(id=game_state.id)
    final_state = final_gs.state_obj
    assert final_state.player1_turn is True  # turn was not consumed
    assert HivePosition(q=-1, r=1, s=0) in final_state.board_state.cells

    await communicator.disconnect()
