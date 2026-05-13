import pytest
import pytest_asyncio
import asyncio
from channels.testing import WebsocketCommunicator
from dragon_in_the_forest.consumers import DragonForestConsumer
from dragon_in_the_forest.models import (
    GameState,
    Lobby,
    LobbyPlayer,
    Card,
    card_to_context,
)
from django.contrib.auth.models import User
from django.core.management import call_command
from asgiref.sync import sync_to_async
from typing import Dict, Any
from dragon_in_the_forest.game_state import CardContext, CardState, TrickState


@pytest.fixture
def event_loop():
    """Create an instance of the default event loop for each test case."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
    yield loop
    if not loop.is_closed():
        loop.close()


@pytest_asyncio.fixture
async def game_data() -> Dict[str, Any]:
    """Fixture to set up a test user, lobby, game state, and populate cards."""
    # Check if cards exist using sync_to_async
    cards_exist = await sync_to_async(Card.objects.exists)()
    if not cards_exist:
        await sync_to_async(call_command)("seed_ditf_cards")

    # Create users, lobby, and game state using sync_to_async
    player1 = await sync_to_async(User.objects.create_user)(username="player1")
    player2 = await sync_to_async(User.objects.create_user)(username="player2")
    lobby = await sync_to_async(Lobby.objects.create)()

    # Add players to lobby
    await sync_to_async(LobbyPlayer.objects.create)(
        lobby=lobby, player=player1, ready=True
    )
    await sync_to_async(LobbyPlayer.objects.create)(
        lobby=lobby, player=player2, ready=True
    )

    # Create and initialize game state
    game_state = await sync_to_async(GameState.objects.create)(lobby=lobby)
    await sync_to_async(game_state.initialize_game)()

    # Ensure game state has player data
    state_data = game_state.state_data
    state_data["player1"] = {
        "username": player1.username,
        "cards": state_data["player1"]["cards"],
        "tricks_won": 0,
        "score": 0,
    }
    state_data["player2"] = {
        "username": player2.username,
        "cards": state_data["player2"]["cards"],
        "tricks_won": 0,
        "score": 0,
    }
    game_state.state_data = state_data
    await sync_to_async(game_state.save)()

    return {
        "player1": player1,
        "player2": player2,
        "lobby": lobby,
        "game_state": game_state,
    }


@pytest_asyncio.fixture
async def websocket_communicator(game_data: Dict[str, Any]) -> WebsocketCommunicator:
    """Create a new WebSocket communicator for each test."""
    communicator = WebsocketCommunicator(
        DragonForestConsumer.as_asgi(), f"/ws/ditf/game/{game_data['game_state'].id}/"
    )
    # Add url_route to the scope
    communicator.scope["url_route"] = {
        "kwargs": {"game_state_id": str(game_data["game_state"].id)}
    }
    # Add user to the scope
    communicator.scope["user"] = game_data["player1"]
    connected, _ = await communicator.connect()
    assert connected
    yield communicator
    await communicator.disconnect()


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_connect(websocket_communicator: WebsocketCommunicator) -> None:
    """Test that a client can connect to the WebSocket."""
    assert websocket_communicator.scope["type"] == "websocket"


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_start_game(
    game_data: Dict[str, Any], websocket_communicator: WebsocketCommunicator
) -> None:
    """Test starting a game."""
    await websocket_communicator.send_json_to(
        {"action": "start_game", "lobby_id": game_data["lobby"].id}
    )

    response = await websocket_communicator.receive_json_from()
    assert response["type"] == "game_started"
    assert response["game_state_id"] == game_data["game_state"].id
    assert "game_state" in response


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_play_card(
    game_data: Dict[str, Any], websocket_communicator: WebsocketCommunicator
) -> None:
    """Test playing a card."""
    # Get a card from player1's hand
    card = game_data["game_state"].state_obj.player1.cards[0]

    await websocket_communicator.send_json_to(
        {
            "action": "play_card",
            "user_id": game_data["player1"].id,
            "card": card.model_dump(),
        }
    )

    response = await websocket_communicator.receive_json_from()
    assert response["type"] == "game_state_update"
    assert "game_state" in response


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_replace_trump_card(
    game_data: Dict[str, Any], websocket_communicator: WebsocketCommunicator
) -> None:
    """Test replacing a card with the trump card."""
    # Set up waiting for trump replacement state
    game_state = game_data["game_state"]
    state_obj = game_state.state_obj
    state_obj.waiting_for_trump_replacement = {
        "player": game_data["player1"].username,
        "is_first_card": True,
    }

    await sync_to_async(game_state.save)()

    # Get a card from player1's hand
    card = state_obj.player1.cards[0]
    await websocket_communicator.send_json_to(
        {
            "action": "replace_trump_card",
            "user_id": game_data["player1"].id,
            "card": card.model_dump(),
        }
    )

    response = await websocket_communicator.receive_json_from()
    assert response["type"] == "game_state_update"
    assert "game_state" in response


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_discard_card(
    game_data: Dict[str, Any], websocket_communicator: WebsocketCommunicator
) -> None:
    """Test discarding a card."""
    # Set up waiting for discard state
    game_state = game_data["game_state"]
    game_state.state_obj.waiting_for_discard = {
        "player": game_data["player1"].username,
        "is_first_card": True,
        "drawn_card": game_state.state_data["deck"][0],
    }
    await sync_to_async(game_state.save)()

    # Get a card from player1's hand
    card = game_state.state_obj.player1.cards[0]

    await websocket_communicator.send_json_to(
        {
            "action": "discard_card",
            "user_id": game_data["player1"].id,
            "card": card.model_dump(),
        }
    )

    response = await websocket_communicator.receive_json_from()
    assert response["type"] == "game_state_update"
    assert "game_state" in response


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_get_game_state(websocket_communicator: WebsocketCommunicator) -> None:
    """Test getting the current game state."""
    await websocket_communicator.send_json_to({"action": "get_game_state"})

    response = await websocket_communicator.receive_json_from()
    assert "game_state" in response


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True, reset_sequences=True)
async def test_draw_discard_last_card(
    game_data: Dict[str, Any], websocket_communicator: WebsocketCommunicator
) -> None:
    """Test playing the draw and discard special ability when it's the last card in the deck."""
    # Get a card with the draw and discard special ability (value 5)
    draw_card = await sync_to_async(Card.objects.get)(value=5, suit="fire")
    # Set up the game state with only one card in the deck
    game_state = game_data["game_state"]

    # Add the draw card to player1's hand and set player2's cards to empty
    game_state.state_obj.player1.cards = [card_to_context(draw_card)]
    game_state.state_obj.player2.cards = []

    # Set up first card in the trick
    first_card = await sync_to_async(Card.objects.get)(value=2, suit="fire")
    first_card_context = card_to_context(first_card)
    game_state.state_obj.current_trick = TrickState(
        cards=[
            CardState(
                card=CardContext(**first_card_context),
                player=game_data["player2"].username,
            )
        ],
        led_suit="fire",
    )
    game_state.state_obj.current_player = game_data["player1"].username

    # Set up some tricks won to test score calculation
    game_state.state_obj.player1.tricks_won = 7
    game_state.state_obj.player2.tricks_won = 6

    await sync_to_async(game_state.save)()
    # Play the draw card
    await websocket_communicator.send_json_to(
        {
            "action": "play_card",
            "user_id": game_data["player1"].id,
            "card": card_to_context(draw_card),
        }
    )

    # Should receive a game state update with the new round state
    response = await websocket_communicator.receive_json_from()
    assert response["type"] == "game_state_update"
    assert "game_state" in response
    # Verify we have a new round with new cards
    assert (
        response["game_state"]["round_number"] == 2
    )  # Round number should be incremented
    assert (
        response["game_state"]["current_player"] == game_data["player2"].username
    )  # Other player should start
