from hive.helpers import (
    to_tuple,
    _tuple_to_pos,
    _neighbors,
    _shared_neighbors,
    hive_is_connected,
    grasshopper_jump_valid,
    beetle_move_valid,
    ladybug_move_valid,
    mosquito_move_valid,
    pillbug_throw_valid,
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


def _place(state: HiveGameState, piece: HivePieceState) -> None:
    assert piece.position is not None
    state.board_state.cells[piece.position] = HiveBoardCell(
        position=piece.position, pieces=[piece]
    )


def test_ladybug_move_valid_climb_climb_drop():
    """Ladybug climbs over two occupied hexes then drops onto an empty one."""
    state = make_simple_game_state()  # queen already sits at origin
    ladybug = HivePieceState(
        id=2,
        piece_type=HivePieceType.LADYBUG,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    state.board_state.cells[ladybug.position] = HiveBoardCell(
        position=ladybug.position, pieces=[ladybug]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    _place(
        state,
        HivePieceState(
            id=4,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=2, r=-1, s=-1),
            placed=True,
        ),
    )
    end = HivePosition(q=3, r=-2, s=-1)  # empty, adjacent to (2,-1,-1)
    assert ladybug_move_valid(state, ladybug, end)


def test_ladybug_move_invalid_lands_occupied():
    state = make_simple_game_state()
    ladybug = HivePieceState(
        id=2,
        piece_type=HivePieceType.LADYBUG,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    state.board_state.cells[ladybug.position] = HiveBoardCell(
        position=ladybug.position, pieces=[ladybug]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    _place(
        state,
        HivePieceState(
            id=4,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=2, r=-1, s=-1),
            placed=True,
        ),
    )
    end = HivePosition(q=3, r=-2, s=-1)
    _place(
        state,
        HivePieceState(
            id=5,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=end,
            placed=True,
        ),
    )
    assert not ladybug_move_valid(state, ladybug, end)


def test_ladybug_move_invalid_middle_step_empty():
    state = make_simple_game_state()
    ladybug = HivePieceState(
        id=2,
        piece_type=HivePieceType.LADYBUG,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    state.board_state.cells[ladybug.position] = HiveBoardCell(
        position=ladybug.position, pieces=[ladybug]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    # second climb hex (2,-1,-1) left empty
    end = HivePosition(q=3, r=-2, s=-1)
    assert not ladybug_move_valid(state, ladybug, end)


def test_mosquito_copies_adjacent_ant():
    state = make_simple_game_state()
    mosquito = HivePieceState(
        id=2,
        piece_type=HivePieceType.MOSQUITO,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
        stack_height=0,
    )
    state.board_state.cells[mosquito.position] = HiveBoardCell(
        position=mosquito.position, pieces=[mosquito]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    # Not directly adjacent to the mosquito's own hex - only reachable by
    # borrowing the adjacent Ant's unlimited sliding ability (a Queen or
    # Beetle copy would be capped at one step and couldn't reach it).
    end = HivePosition(q=2, r=-1, s=-1)
    assert mosquito_move_valid(state, mosquito, end)


def test_mosquito_ignores_adjacent_mosquito():
    state = make_simple_game_state()
    mosquito = HivePieceState(
        id=2,
        piece_type=HivePieceType.MOSQUITO,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
        stack_height=0,
    )
    state.board_state.cells[mosquito.position] = HiveBoardCell(
        position=mosquito.position, pieces=[mosquito]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.MOSQUITO,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    end = HivePosition(q=2, r=-2, s=0)
    assert not mosquito_move_valid(state, mosquito, end)


def test_mosquito_on_top_of_hive_is_beetle_only():
    state = make_simple_game_state()
    base = HivePieceState(
        id=5,
        piece_type=HivePieceType.QUEEN,
        owner="player2",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    mosquito = HivePieceState(
        id=2,
        piece_type=HivePieceType.MOSQUITO,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
        stack_height=1,
    )
    state.board_state.cells[HivePosition(q=0, r=0, s=0)] = HiveBoardCell(
        position=HivePosition(q=0, r=0, s=0), pieces=[base, mosquito]
    )
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.GRASSHOPPER,
            owner="player2",
            position=HivePosition(q=1, r=-1, s=0),
            placed=True,
        ),
    )
    _place(
        state,
        HivePieceState(
            id=4,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=2, r=-2, s=0),
            placed=True,
        ),
    )
    # A valid Grasshopper-style jump over the two occupied hexes - must be
    # rejected, since a Mosquito on top of the hive can only move as a Beetle.
    jump_target = HivePosition(q=3, r=-3, s=0)
    assert not mosquito_move_valid(state, mosquito, jump_target)
    # But an ordinary Beetle-style descent to an adjacent empty hex is fine.
    beetle_target = HivePosition(q=-1, r=1, s=0)
    assert mosquito_move_valid(state, mosquito, beetle_target)


def make_pillbug_throw_state():
    pillbug = HivePieceState(
        id=1,
        piece_type=HivePieceType.PILLBUG,
        owner="player1",
        position=HivePosition(q=0, r=0, s=0),
        placed=True,
    )
    target = HivePieceState(
        id=2,
        piece_type=HivePieceType.ANT,
        owner="player2",
        position=HivePosition(q=1, r=-1, s=0),
        placed=True,
    )
    board = HiveBoardState(
        cells={
            pillbug.position: HiveBoardCell(position=pillbug.position, pieces=[pillbug]),
            target.position: HiveBoardCell(position=target.position, pieces=[target]),
        }
    )
    p1 = HivePlayerState(username="player1", pieces_in_hand=[], pieces_on_board=[pillbug])
    p2 = HivePlayerState(username="player2", pieces_in_hand=[], pieces_on_board=[target])
    state = HiveGameState(
        player1_state=p1,
        player2_state=p2,
        player1_turn=True,
        board_state=board,
        turn_no=2,
        ply=2,
    )
    return state, pillbug, target


def test_pillbug_throw_valid_basic():
    state, pillbug, target = make_pillbug_throw_state()
    dest = HivePosition(q=0, r=-1, s=1)  # empty, adjacent to the pillbug
    valid, _ = pillbug_throw_valid(state, pillbug, target, dest)
    assert valid


def test_pillbug_throw_invalid_destination_occupied():
    state, pillbug, target = make_pillbug_throw_state()
    dest = HivePosition(q=0, r=-1, s=1)
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player1",
            position=dest,
            placed=True,
        ),
    )
    valid, message = pillbug_throw_valid(state, pillbug, target, dest)
    assert not valid
    assert "empty" in message.lower()


def test_pillbug_throw_invalid_stacked_piece():
    state, pillbug, target = make_pillbug_throw_state()
    topper = HivePieceState(
        id=3,
        piece_type=HivePieceType.BEETLE,
        owner="player2",
        position=target.position,
        placed=True,
        stack_height=1,
    )
    state.board_state.cells[target.position].pieces.append(topper)
    dest = HivePosition(q=0, r=-1, s=1)
    valid, message = pillbug_throw_valid(state, pillbug, topper, dest)
    assert not valid
    assert "stacked" in message.lower()


def test_pillbug_throw_invalid_breaks_connectivity():
    state, pillbug, target = make_pillbug_throw_state()
    _place(
        state,
        HivePieceState(
            id=3,
            piece_type=HivePieceType.ANT,
            owner="player2",
            position=HivePosition(q=2, r=-2, s=0),  # only reachable via target
            placed=True,
        ),
    )
    dest = HivePosition(q=0, r=-1, s=1)
    valid, message = pillbug_throw_valid(state, pillbug, target, dest)
    assert not valid
    assert "connected" in message.lower()


def test_pillbug_throw_freeze_rule():
    state, pillbug, target = make_pillbug_throw_state()
    dest = HivePosition(q=0, r=-1, s=1)

    state.last_moved_piece_id = target.id
    state.last_moved_ply = state.ply - 1  # moved on the immediately preceding ply
    valid, message = pillbug_throw_valid(state, pillbug, target, dest)
    assert not valid
    assert "cannot be thrown" in message.lower()

    state.ply += 1  # another ply has since passed
    valid, _ = pillbug_throw_valid(state, pillbug, target, dest)
    assert valid
