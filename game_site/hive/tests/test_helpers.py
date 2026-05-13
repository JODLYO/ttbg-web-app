from hive.helpers import (
    to_tuple,
    _tuple_to_pos,
    _neighbors,
    _shared_neighbors,
    hive_is_connected,
    grasshopper_jump_valid,
    beetle_move_valid,
)
from hive.game_state import (
    HivePosition,
    HivePieceState,
    HiveBoardState,
    HiveGameState,
    HivePlayerState,
    HivePieceType,
    HiveBoardCell,
)


def make_simple_board(piece: HivePieceState) -> HiveBoardState:
    """Helper to quickly create a board with one piece at origin."""
    pos = piece.position
    assert pos is not None
    piece = HivePieceState(
        id=1, piece_type=HivePieceType.QUEEN, owner="player1", position=pos, placed=True
    )
    cell = HiveBoardCell(position=pos, pieces=[piece])
    return HiveBoardState(cells={pos: cell})


def make_simple_game_state() -> HiveGameState:
    """Quick game state for testing."""
    pos = HivePosition(q=0, r=0, s=0)
    p1_queen = HivePieceState(
        id=1, piece_type=HivePieceType.QUEEN, owner="player1", position=pos, placed=True
    )
    board = make_simple_board(p1_queen)
    p1 = HivePlayerState(
        username="player1", pieces_in_hand=[], pieces_on_board=[p1_queen]
    )
    p2 = HivePlayerState(username="player2", pieces_in_hand=[], pieces_on_board=[])
    return HiveGameState(
        player1_state=p1,
        player2_state=p2,
        player1_turn=True,
        board_state=board,
        turn_no=1,
    )


def test_to_tuple_and_back():
    pos = HivePosition(q=1, r=-1, s=0)
    t = to_tuple(pos)
    assert t == (1, -1, 0)
    pos2 = _tuple_to_pos(t)
    assert pos2 == pos


def test_neighbors_consistent():
    pos = (0, 0, 0)
    nbs = _neighbors(pos)
    expected = [(1, -1, 0), (1, 0, -1), (0, 1, -1), (-1, 1, 0), (-1, 0, 1), (0, -1, 1)]
    assert set(nbs) == set(expected)


def test_shared_neighbors():
    a = (0, 0, 0)
    b = (1, -1, 0)
    shared = _shared_neighbors(a, b)
    assert (0, -1, 1) in shared
    assert len(shared) == 2


def test_hive_is_connected_simple():
    state = make_simple_game_state()
    assert hive_is_connected(state.board_state)  # single piece is connected


def test_hive_is_connected_disconnected():
    board = HiveBoardState(
        cells={
            HivePosition(q=0, r=0, s=0): HiveBoardCell(
                position=HivePosition(q=0, r=0, s=0),
                pieces=[
                    HivePieceState(
                        id=1,
                        piece_type=HivePieceType.QUEEN,
                        owner="player1",
                        position=HivePosition(q=0, r=0, s=0),
                        placed=True,
                    )
                ],
            ),
            HivePosition(q=10, r=0, s=-10): HiveBoardCell(
                position=HivePosition(q=10, r=0, s=-10),
                pieces=[
                    HivePieceState(
                        id=2,
                        piece_type=HivePieceType.ANT,
                        owner="player2",
                        position=HivePosition(q=10, r=0, s=-10),
                        placed=True,
                    )
                ],
            ),
        }
    )
    assert not hive_is_connected(board)


def test_grasshopper_jump_valid_straight():
    state = make_simple_game_state()
    piece = state.player1_state.pieces_on_board[0]
    end = HivePosition(q=2, r=-2, s=0)
    state.board_state.cells[HivePosition(q=1, r=-1, s=0)] = [
        HivePieceState(
            id=2,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        )
    ]
    assert grasshopper_jump_valid(state, piece, end)


def test_grasshopper_jump_invalid_gap():
    state = make_simple_game_state()
    piece = state.player1_state.pieces_on_board[0]
    end = HivePosition(q=2, r=-2, s=0)
    assert not grasshopper_jump_valid(state, piece, end)


def test_beetle_move_valid_adjacent():
    state = make_simple_game_state()
    piece = HivePieceState(
        id=3,
        piece_type=HivePieceType.BEETLE,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    state.board_state.cells[piece.position] = HiveBoardCell(
        position=piece.position, pieces=[piece]
    )
    end = HivePosition(q=1, r=0, s=-1)
    assert beetle_move_valid(state, piece, end)
