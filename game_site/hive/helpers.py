# mypy: disable-error-code="union-attr"

from collections import deque
from typing import Optional, List, Tuple, Set, Dict, Union
from .game_state import (
    HiveGameState,
    HivePosition,
    HiveBoardState,
    HivePieceState,
    HivePlayerState,
    HiveBoardCell,
    HivePieceType,
    HEX_DIRS,
    TURN_NUMBER_QUEEN_MUST_BE_PLACED,
)

Pos = Tuple[int, int, int]
AnyPos = Union[Pos, HivePosition]


def to_tuple(pos: HivePosition) -> Pos:
    return (pos.q, pos.r, pos.s)


def _tuple_to_pos(t: Pos) -> HivePosition:
    q, r, s = t
    return HivePosition(q=q, r=r, s=s)


def _neighbors(p: AnyPos) -> List[AnyPos]:
    if isinstance(p, HivePosition):
        q, r, s = p.q, p.r, p.s
        return [HivePosition(q=q + dq, r=r + dr, s=s + ds) for dq, dr, ds in HEX_DIRS]
    else:
        q, r, s = p
        return [(q + dq, r + dr, s + ds) for dq, dr, ds in HEX_DIRS]


def _shared_neighbors(a: AnyPos, b: AnyPos) -> List[AnyPos]:
    na = set(_neighbors(a))
    nb = set(_neighbors(b))
    return list(na & nb)


def can_slide_path(
    state: HiveGameState,
    start: HivePosition,
    end: HivePosition,
    max_steps: Optional[int] = None,  # queen=1
    require_exact_steps: Optional[int] = None,  # spider=3
) -> Tuple[bool, Optional[List[HivePosition]]]:
    start_t = to_tuple(start)
    end_t = to_tuple(end)

    temp_board = HiveBoardState(
        cells={
            pos: HiveBoardCell(
                position=pos, pieces=list(state.board_state.cells[pos].pieces)
            )
            for pos in state.board_state.cells
            if pos != start
        }
    )

    # occupied positions EXCEPT the start (simulate lifting the piece)
    occupied: Set[Pos] = {to_tuple(p) for p in state.board_state.cells.keys()}
    occupied.discard(start_t)

    visited = {start_t}
    queue = deque([(start_t, [start_t])])  # (position, path)

    while queue:
        current, path = queue.popleft()
        steps = len(path) - 1

        if max_steps is not None and steps > max_steps:
            continue

        for nb in _neighbors(current):
            assert isinstance(nb, tuple)
            if nb in visited:
                continue
            visited.add(nb)

            nb_occupied = nb in occupied
            if nb_occupied:
                # cannot slide into occupied cells (beetles handled elsewhere)
                continue
            temp_board.cells[_tuple_to_pos(nb)] = HiveBoardCell(
                position=_tuple_to_pos(nb),
                pieces=[
                    HivePieceState(
                        id=-1,  # dummy id
                        piece_type=HivePieceType.QUEEN,  # type doesn't matter
                        owner="temp",
                        position=_tuple_to_pos(nb),
                        placed=True,
                    )
                ],
            )
            if not hive_is_connected(temp_board):
                del temp_board.cells[_tuple_to_pos(nb)]
                continue
            del temp_board.cells[_tuple_to_pos(nb)]

            # sliding rule: wedge neighbors not both occupied
            wedge = _shared_neighbors(current, nb)
            both_blocked = True
            for w in wedge:
                if w not in occupied:
                    both_blocked = False
                    break
            if both_blocked:
                continue

            new_path = path + [nb]
            new_steps = len(new_path) - 1

            # reached target?
            if nb == end_t:
                if require_exact_steps is not None:
                    if new_steps == require_exact_steps:
                        return True, [_tuple_to_pos(p) for p in new_path]
                else:
                    if max_steps is None or new_steps <= max_steps:
                        return True, [_tuple_to_pos(p) for p in new_path]

            # continue BFS if still allowed depth
            if max_steps is None or new_steps < max_steps:
                queue.append((nb, new_path))

    return False, None


def hive_is_connected(board_state: HiveBoardState):
    pieces = [cell.pieces[0] for cell in board_state.cells.values()]

    if not pieces:
        return True

    visited = set()
    stack = [pieces[0]]
    visited.add(pieces[0].id)

    while stack:
        cur = stack.pop()
        assert cur.position is not None
        for p in pieces:
            assert p.position is not None
            if p.id not in visited and cur.position.is_adjacent_to(p.position):
                visited.add(p.id)
                stack.append(p)

    return len(visited) == len(pieces)


def grasshopper_jump_valid(
    state: HiveGameState, piece: HivePieceState, end_pos: HivePosition
):
    start = piece.position
    if start is None:
        return False

    dq = end_pos.q - start.q
    dr = end_pos.r - start.r
    ds = end_pos.s - start.s

    # must be straight — one coord 0 Maybe no need to check dr == -ds as total = 0
    straight_line = (
        (dq == 0 and dr == -ds) or (dr == 0 and dq == -ds) or (ds == 0 and dq == -dr)
    )
    if not straight_line:
        return False

    # jump must be > 1 space
    non_zero = [v for v in (dq, dr, ds) if v != 0][0]
    if abs(non_zero) <= 1:
        return False

    # Determine direction unit step (normalize)
    step_q = 1 if dq > 0 else -1 if dq < 0 else 0
    step_r = 1 if dr > 0 else -1 if dr < 0 else 0
    step_s = 1 if ds > 0 else -1 if ds < 0 else 0

    occupied: set[HivePosition] = {t for t in state.board_state.cells.keys()}

    # landing hex must be empty
    if end_pos in occupied:
        return False

    # all intermediate hexes must be filled
    q, r, s = start.q, start.r, start.s

    while True:
        q += step_q
        r += step_r
        s += step_s
        cur = HivePosition(q=q, r=r, s=s)
        if cur == end_pos:
            break  # reached landing space
        if cur not in occupied:
            return False  # gap means invalid jump
    return True


def beetle_move_valid(
    state: HiveGameState,
    piece: HivePieceState,
    end_pos: HivePosition,
) -> bool:
    start = piece.position
    if start is None:
        return False

    # must move exactly one hex
    if not start.is_adjacent_to(end_pos):
        return False

    # if stack height different no sliding rule
    end_stack_height = 0
    if board_pos := state.board_state.cells.get(end_pos):
        end_stack_height = len(board_pos.pieces)
    if piece.stack_height != end_stack_height:
        return True

    # If beetle is on ground, must obey sliding rules
    return can_slide_beetle(state, start, end_pos, piece)


def can_slide_beetle(
    state: HiveGameState, start: HivePosition, end: HivePosition, piece: HivePieceState
) -> bool:
    pos_n1, pos_n2 = _shared_neighbors(
        start, end
    )  # always list of len 2 for adjacent tiles
    assert isinstance(pos_n1, HivePosition)
    assert isinstance(pos_n2, HivePosition)
    height_pos_n1 = (
        len(state.board_state.cells[pos_n1].pieces) - 1
        if state.board_state.cells.get(pos_n1)
        else -1
    )
    height_pos_n2 = (
        len(state.board_state.cells[pos_n2].pieces) - 1
        if state.board_state.cells.get(pos_n2)
        else -1
    )
    if height_pos_n1 >= piece.stack_height and height_pos_n2 >= piece.stack_height:
        return False
    return True


def ladybug_move_valid(
    state: HiveGameState,
    piece: HivePieceState,
    end_pos: HivePosition,
) -> bool:
    """Ladybug: exactly 3 steps - climb onto an adjacent occupied hex, climb
    to another adjacent occupied hex, then drop onto an adjacent empty hex.
    Unlike can_slide_path this deliberately walks over occupied cells for the
    first two steps and requires the final cell to be empty, so it can't
    reuse the empty-only sliding BFS."""
    start = piece.position
    if start is None:
        return False

    occupied = set(state.board_state.cells.keys())
    occupied.discard(start)  # simulate lifting the ladybug itself

    for a in _neighbors(start):
        if a not in occupied:
            continue
        for b in _neighbors(a):
            if b == start or b not in occupied:
                continue
            for c in _neighbors(b):
                if c == start or c == a or c in occupied:
                    continue
                if c == end_pos:
                    return True
    return False


def mosquito_move_valid(
    state: HiveGameState,
    piece: HivePieceState,
    end_pos: HivePosition,
) -> bool:
    """Mosquito: copies the move of any one adjacent piece type (never
    another Mosquito, to avoid infinite regress). If it's sitting on top of
    the hive (having climbed there earlier by copying a Beetle), it can only
    move as a Beetle from then on."""
    start = piece.position
    if start is None:
        return False

    if piece.stack_height > 0:
        return beetle_move_valid(state, piece, end_pos)

    adjacent_types = {
        cell.pieces[-1].piece_type
        for nb in _neighbors(start)
        if (cell := state.board_state.cells.get(nb))
    }
    adjacent_types.discard(HivePieceType.MOSQUITO)

    for piece_type in adjacent_types:
        if piece_type == HivePieceType.ANT:
            valid, _ = can_slide_path(state, start, end_pos)
        elif piece_type in (HivePieceType.QUEEN, HivePieceType.PILLBUG):
            valid, _ = can_slide_path(state, start, end_pos, max_steps=1)
        elif piece_type == HivePieceType.SPIDER:
            valid, _ = can_slide_path(
                state, start, end_pos, max_steps=3, require_exact_steps=3
            )
        elif piece_type == HivePieceType.GRASSHOPPER:
            valid = grasshopper_jump_valid(state, piece, end_pos)
        elif piece_type == HivePieceType.BEETLE:
            valid = beetle_move_valid(state, piece, end_pos)
        elif piece_type == HivePieceType.LADYBUG:
            valid = ladybug_move_valid(state, piece, end_pos)
        else:
            valid = False
        if valid:
            return True
    return False


def pillbug_throw_valid(
    state: HiveGameState,
    pillbug: HivePieceState,
    target_piece: HivePieceState,
    target_pos: HivePosition,
) -> Tuple[bool, str]:
    """Pillbug special ability: lift an adjacent piece (friendly or enemy)
    and place it on another empty hex adjacent to the Pillbug. This is a
    lift, not a slide, so the sliding/gate rule does not apply."""
    if pillbug.position is None or target_piece.position is None:
        return False, "illegal throw"
    if target_piece.id == pillbug.id:
        return False, "Cannot throw the Pillbug itself"
    if not pillbug.position.is_adjacent_to(target_piece.position):
        return False, "Thrown piece must be adjacent to the Pillbug"
    if not pillbug.position.is_adjacent_to(target_pos):
        return False, "Destination must be adjacent to the Pillbug"
    if target_pos in state.board_state.cells:
        return False, "Destination must be empty"

    src_cell = state.board_state.cells.get(target_piece.position)
    if not src_cell or src_cell.pieces[-1].id != target_piece.id:
        return False, "Can only throw the top piece of a stack"
    if len(src_cell.pieces) > 1:
        return False, "Cannot throw a piece with something stacked on it"

    if (
        state.last_moved_piece_id == target_piece.id
        and state.last_moved_ply == state.ply - 1
    ):
        return False, "That piece moved last turn and cannot be thrown"

    temp_board = state.board_state.model_copy(deep=True)
    del temp_board.cells[target_piece.position]
    if not hive_is_connected(temp_board):
        return False, "Hive not connected during throw"
    temp_board.cells[target_pos] = HiveBoardCell(
        position=target_pos, pieces=[target_piece]
    )
    if not hive_is_connected(temp_board):
        return False, "Hive not connected after throw"

    return True, ""


def check_valid_piece_from_hand_move(
    state: HiveGameState,
    player: HivePlayerState,
    opponent: HivePlayerState,
    piece: HivePieceState,
    placed_piece_pos: HivePosition,
) -> Tuple[bool, str]:
    if (player.username == state.player1_state.username) != state.player1_turn:
        return False, "Not your turn"
    if placed_piece_pos in state.board_state.cells:
        return False, "Cannot place a piece on top of another piece"
    if not state.board_state.cells:  # skip checks if no pieces on board
        return True, ""
    if (
        not player.has_placed_queen
        and state.turn_no == TURN_NUMBER_QUEEN_MUST_BE_PLACED
        and piece.piece_type != "queen"
    ):
        return False, "You must place your Queen by your 4th turn"
    if state.turn_no == 1:
        adjacent = [
            piece
            for piece in opponent.pieces_on_board
            if piece.position.is_adjacent_to(placed_piece_pos)
        ]
    else:
        adjacent = [
            piece
            for piece in player.pieces_on_board
            if piece.position.is_adjacent_to(placed_piece_pos)
        ]
    if not adjacent:
        return False, "Placement must touch the hive"
    if state.turn_no != 1 and any(
        state.board_state.cells[piece.position].pieces[-1].owner == opponent.username
        for piece in opponent.pieces_on_board
        if piece.position is not None
        and piece.position.is_adjacent_to(placed_piece_pos)
    ):
        return False, "You cannot place adjacent to opponent pieces until hive formed"
    return True, ""


def load_cells_from_json(cells_json):
    cells = {}
    for k, v in cells_json.items():
        q, r, s = map(int, k.split(","))
        cells[(q, r, s)] = HivePieceState(**v)
    return cells


def hiveboard_from_json_dict(d: Dict[str, dict]) -> HiveBoardState:
    cells: Dict[HivePosition, HiveBoardCell] = {}

    for key, value in d.items():
        q_str, r_str, s_str = key.split(",")
        pos = HivePosition(q=int(q_str), r=int(r_str), s=int(s_str))
        cell = HiveBoardCell(**value)
        cells[pos] = cell

    return HiveBoardState(cells=cells)


def is_queen_surrounded(board: HiveBoardState, queen: HivePieceState) -> bool:
    if not queen.placed:
        return False

    assert queen.position is not None
    for nb in _neighbors(queen.position):
        if nb not in board.cells:
            return False

    return True  # all 6 hexes occupied


def candidate_placement_positions(board_state: HiveBoardState) -> Set[Pos]:
    """Every empty hex touching the current hive (or just the origin, pre-game)."""
    if not board_state.cells:
        return {(0, 0, 0)}
    occupied = {to_tuple(p) for p in board_state.cells.keys()}
    candidates: Set[Pos] = set()
    for pos in occupied:
        for nb in _neighbors(pos):
            assert isinstance(nb, tuple)
            if nb not in occupied:
                candidates.add(nb)
    return candidates


def board_move_candidate_positions(board_state: HiveBoardState) -> Set[Pos]:
    """Every occupied cell plus every empty cell touching the hive - a safe
    superset of legal destinations for any on-board piece, including a
    Beetle's climb onto an already-occupied cell."""
    occupied = {to_tuple(p) for p in board_state.cells.keys()}
    candidates: Set[Pos] = set(occupied)
    for pos in occupied:
        for nb in _neighbors(pos):
            assert isinstance(nb, tuple)
            candidates.add(nb)
    return candidates


def rebuild_pieces_on_board(state: HiveGameState):
    p1_pieces = []
    p2_pieces = []

    for cell in state.board_state.cells.values():
        for piece in cell.pieces:
            if piece.owner == state.player1_state.username:
                p1_pieces.append(piece)
            else:
                p2_pieces.append(piece)

    return p1_pieces, p2_pieces
