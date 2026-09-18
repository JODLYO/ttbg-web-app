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


def _stack_height_at(state: HiveGameState, pos: HivePosition) -> int:
    cell = state.board_state.cells.get(pos)
    return len(cell.pieces) if cell else 0


def _gated(state: HiveGameState, level: int, a: HivePosition, b: HivePosition) -> bool:
    """Whether passage between adjacent `a`/`b` is blocked at the given
    (1-indexed) elevation -- true when BOTH hexes shared between `a` and
    `b` have a stack at least that tall, wedging anything trying to pass
    between them at that height. Shared by beetle-style climbing, pillbug
    throws, and ladybug moves -- every "piece passes over/through a gap at
    some height" check in the game reduces to this (ported from hive-bot's
    engine, which verified this against hivegame.com's own Rust engine)."""
    n1, n2 = _shared_neighbors(a, b)
    assert isinstance(n1, HivePosition) and isinstance(n2, HivePosition)
    return _stack_height_at(state, n1) >= level and _stack_height_at(state, n2) >= level


def _slide_step_legal(occupied: Set[Pos], current: Pos, nb: Pos) -> bool:
    """A slide across the edge from `current` to the adjacent, empty `nb`
    stays in contact with the hive's outer surface only if *exactly one* of
    the two hexes shared by both is occupied: zero occupied means the piece
    would momentarily float free of the hive (illegal), and two occupied
    means it's wedged between them and can't fit through the gate (also
    illegal - the classic "gate" rule). This is a purely local check on the
    edge being crossed, unlike a global "is nb adjacent to the hive
    somewhere" connectivity check, which would wrongly accept a step whose
    own edge has zero contact just because nb happens to touch some
    unrelated piece elsewhere on the board."""
    n1, n2 = _shared_neighbors(current, nb)
    return (n1 in occupied) != (n2 in occupied)


def can_slide_path(
    state: HiveGameState,
    start: HivePosition,
    end: HivePosition,
    max_steps: Optional[int] = None,  # queen=1
    require_exact_steps: Optional[int] = None,  # spider=3
) -> Tuple[bool, Optional[List[HivePosition]]]:
    start_t = to_tuple(start)
    end_t = to_tuple(end)

    # occupied positions EXCEPT the start (simulate lifting the piece)
    occupied: Set[Pos] = {to_tuple(p) for p in state.board_state.cells.keys()}
    occupied.discard(start_t)

    if require_exact_steps is not None:
        # Exact-step search (Spider): "already visited" is a *per-path*
        # constraint (don't cross a hex you've already visited within this
        # same slide) - a hex one candidate path happens to pass through
        # doesn't make it off-limits for a completely different path that
        # reaches it another way, possibly at a different step count. So
        # this needs a fresh visited set threaded through each recursive
        # call, not one set shared across the whole search (unlike the
        # unbounded/max-step case below, where plain reachability - not
        # reachability-at-an-exact-step-count - is all that matters).
        def dfs(
            current: Pos, path: List[Pos], path_visited: Set[Pos]
        ) -> Optional[List[Pos]]:
            if len(path) - 1 == require_exact_steps:
                return path if current == end_t else None
            for nb in _neighbors(current):
                assert isinstance(nb, tuple)
                if nb in path_visited or nb in occupied:
                    continue
                if not _slide_step_legal(occupied, current, nb):
                    continue
                found = dfs(nb, path + [nb], path_visited | {nb})
                if found is not None:
                    return found
            return None

        result = dfs(start_t, [start_t], {start_t})
        if result is None:
            return False, None
        return True, [_tuple_to_pos(p) for p in result]

    # Unbounded / max-step search (Ant, Queen, Pillbug's own move): once a
    # hex is legally reachable within the step budget, it stays reachable
    # regardless of which path got there first, so a single shared visited
    # set is a safe (and much cheaper) guard against re-expanding a node -
    # only marked once a candidate step actually passes the legality check
    # above, so a hex rejected via one edge can still be tried via another.
    visited = {start_t}
    queue = deque([(start_t, [start_t])])  # (position, path)

    while queue:
        current, path = queue.popleft()
        steps = len(path) - 1
        if max_steps is not None and steps >= max_steps:
            continue

        for nb in _neighbors(current):
            assert isinstance(nb, tuple)
            if nb in visited or nb in occupied:
                continue
            if not _slide_step_legal(occupied, current, nb):
                continue
            visited.add(nb)

            new_path = path + [nb]
            if nb == end_t:
                return True, [_tuple_to_pos(p) for p in new_path]
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
    """A beetle needs a gate check on *every* move, not just ground-level
    lateral ones - climbing and descending between different stack heights
    can still be wedged shut by two tall-enough flanking neighbors, exactly
    like sliding on the ground can (ported from hive-bot's engine, which
    confirmed against hivegame.com's own Rust engine test fixtures that
    every real climb/descent needs this, not just the same-height lateral
    case this used to special-case as automatically legal). Gate-checks
    climbing at one above the destination's *current* height (the
    elevation the beetle would land at) and descending/lateral moves at
    the piece's own *current* elevation (the height it's departing from) -
    both fold into the single threshold picked below."""
    start = piece.position
    if start is None:
        return False

    # must move exactly one hex
    if not start.is_adjacent_to(end_pos):
        return False

    end_stack_height = 0
    if board_pos := state.board_state.cells.get(end_pos):
        end_stack_height = len(board_pos.pieces)

    source_level = piece.stack_height + 1  # 1-indexed own elevation
    threshold = (
        end_stack_height + 1 if end_stack_height >= source_level else source_level
    )
    return not _gated(state, threshold, start, end_pos)


def ladybug_move_valid(
    state: HiveGameState,
    piece: HivePieceState,
    end_pos: HivePosition,
) -> bool:
    """Ladybug: exactly 3 steps - climb onto an adjacent occupied hex, climb
    to another adjacent occupied hex, then drop onto an adjacent empty hex.
    Unlike can_slide_path this deliberately walks over occupied cells for the
    first two steps and requires the final cell to be empty, so it can't
    reuse the empty-only sliding BFS.

    Each of the 3 hops needs its own gate check (previously missing
    entirely - ported from hive-bot's engine, which confirmed this against
    hivegame.com's Rust engine), not just the occupied/empty membership
    tests below:
      - hop 1 (start -> a, climbing onto the hive from the ground):
        threshold = a's current height + 1 (the elevation landing there).
      - hop 2 (a -> b, walking across the top from one occupied cell to
        another): threshold = one more than the taller of the two, since
        the ladybug's effective elevation during this hop is whichever of
        "having just climbed to a" or "about to land on b" is higher.
      - hop 3 (b -> c, descending to an empty cell): threshold = the
        elevation it's descending *from* (b's height + 1)."""
    start = piece.position
    if start is None:
        return False

    occupied = set(state.board_state.cells.keys())
    occupied.discard(start)  # simulate lifting the ladybug itself

    for a in _neighbors(start):
        assert isinstance(a, HivePosition)
        if a not in occupied:
            continue
        if _gated(state, _stack_height_at(state, a) + 1, start, a):
            continue
        for b in _neighbors(a):
            assert isinstance(b, HivePosition)
            if b == start or b not in occupied:
                continue
            hop2_threshold = max(_stack_height_at(state, a), _stack_height_at(state, b)) + 1
            if _gated(state, hop2_threshold, a, b):
                continue
            for c in _neighbors(b):
                assert isinstance(c, HivePosition)
                if c == start or c == a or c in occupied:
                    continue
                if _gated(state, _stack_height_at(state, b) + 1, b, c):
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
        if isinstance(nb, HivePosition) and (cell := state.board_state.cells.get(nb))
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


def can_use_pillbug_throw(state: HiveGameState, piece: HivePieceState) -> bool:
    """Whether `piece` may use the Pillbug's throw ability this turn: a
    real Pillbug always can; a Mosquito copies the ability from *any*
    adjacent Pillbug (friend or enemy), same as it copies any other
    adjacent piece type's plain movement (see mosquito_move_valid) - but
    only while grounded, since a Mosquito that's climbed onto a stack only
    acts as a Beetle from then on (same restriction mosquito_move_valid
    already applies)."""
    if piece.piece_type == HivePieceType.PILLBUG:
        return True
    if piece.piece_type != HivePieceType.MOSQUITO or piece.stack_height > 0:
        return False
    if piece.position is None:
        return False
    return any(
        cell.pieces[-1].piece_type == HivePieceType.PILLBUG
        for nb in _neighbors(piece.position)
        if isinstance(nb, HivePosition) and (cell := state.board_state.cells.get(nb))
    )


def pillbug_throw_valid(
    state: HiveGameState,
    pillbug: HivePieceState,
    target_piece: HivePieceState,
    target_pos: HivePosition,
) -> Tuple[bool, str]:
    """Pillbug special ability: lift an adjacent piece (friendly or enemy)
    and place it on another empty hex adjacent to the Pillbug.

    The thrown piece still passes "over" the Pillbug at elevation 2 (both
    it and the Pillbug are always ground-level, height 1), and again over
    whatever's between the Pillbug and the destination - so it CAN be
    wedged shut exactly like a beetle climbing that high, on either leg of
    the throw. This was previously missing entirely (ported from
    hive-bot's engine, which confirmed the omission against hivegame.com's
    Rust engine's `can_throw_piece_to`), wrongly allowing throws through a
    blocked gate.

    `pillbug` may also be a Mosquito copying the ability - see
    `can_use_pillbug_throw`, which the caller (GameState.throw_piece) is
    responsible for checking; this function only validates the throw's own
    geometry/rules in terms of `pillbug.position`, which works unchanged
    either way."""
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
        and state.last_moved_ply == state.ply
    ):
        return False, "That piece moved last turn and cannot be thrown"

    if _gated(state, 2, target_piece.position, pillbug.position):
        return False, "Thrown piece is wedged and cannot lift off"
    if _gated(state, 2, pillbug.position, target_pos):
        return False, "Destination is wedged and cannot be thrown into"

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
