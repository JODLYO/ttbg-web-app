// Standalone Hive analysis board (lichess/chess.com style): freely place
// and move pieces for both sides and get HiveBot's move suggestions,
// running entirely client-side (no server round trip per move -- the
// rules engine and the bot's search both run in the browser, see
// hive-bot-web and analysisWorker.ts). Not a live/multiplayer game.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState, Move, PieceType, PositionAnalysis, UndoInfo } from "hive-bot-web";
import { GameState as HiveGameStateClass, MoveKind, applyMove, serializeGameState, undoMove } from "hive-bot-web";
import { DEFAULT_NUM_SIMULATIONS, NUM_SIMULATIONS_INCREMENT } from "./analysisConstants";
import HiveBoardSVG from "./HiveBoardSVG";
import MiniBoard from "./MiniBoard";
import { PiecesStrip } from "./PiecesStrip";
import {
  ANALYSIS_ENABLED_TYPES,
  EXPANSION_ENABLED_TYPES,
  attemptMove,
  findThrowMove,
  previewAfterMove,
  toHiveGameState,
} from "./hiveBotAdapter";
import type { HiveGameState, HivePieceState, HivePosition } from "./types";
import type {
  AnalyzeErrorResponse,
  AnalyzeProgressResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  CancelMessage,
} from "./analysisWorker";
import {
  describeMoveLogEntry,
  describeMoveLogEntryWithDestinations,
  toMoveLogEntry,
  type MoveLogEntry,
} from "./moveLog";
import { parseUhpHistory, winnerFromGameStatus, type RawRecordedGame } from "./uhpNotation";

function newGame(enabledTypes: ReadonlySet<PieceType>): GameState {
  return HiveGameStateClass.newGame(enabledTypes);
}

/** Auto-detects whether a pasted/loaded game needs the expansion piece set
 * -- from its own `game_type` field when present (hive-bot's archive/
 * self-play games always say "Base" or "MLP", never a partial-expansion
 * mix -- see uhpNotation.ts's GameStatus), falling back to sniffing the
 * history's piece labels for a mosquito/ladybug/pillbug letter otherwise. */
function historyNeedsExpansion(raw: RawRecordedGame): boolean {
  if (raw.game_type === "MLP") return true;
  if (raw.game_type === "Base") return false;
  return raw.history.some(([label]) => label !== "pass" && /[MLP]/.test(label[1] ?? ""));
}

export default function AnalysisBoard() {
  const gameRef = useRef<GameState>(newGame(ANALYSIS_ENABLED_TYPES));
  const historyRef = useRef<UndoInfo[]>([]);
  // Which piece set the board was (re)built with -- a ref (not just the
  // mirrored `expansionEnabled` state below) because handleLoadGame needs
  // to read the just-detected value synchronously, before React would have
  // re-rendered with the new state. Only changeable before a move is
  // played (see the expansion-toggle panel) or via loading a fresh game,
  // since piece ids are assigned in a fixed order over *enabled* types --
  // rebuilding with a different set the loaded moves weren't parsed
  // against would silently point pieceIds at the wrong pieces.
  const expansionEnabledRef = useRef(false);
  const [expansionEnabled, setExpansionEnabledState] = useState(false);
  const setExpansionEnabled = (enabled: boolean) => {
    expansionEnabledRef.current = enabled;
    setExpansionEnabledState(enabled);
  };
  const currentEnabledTypes = () => (expansionEnabledRef.current ? EXPANSION_ENABLED_TYPES : ANALYSIS_ENABLED_TYPES);
  const moveLogRef = useRef<MoveLogEntry[]>([]);
  // `tick` itself is never read directly -- it's a dependency for the
  // `gameState` useMemo below, so a search's progress ticks (which re-render
  // this component up to ~1000 times per position via setAnalysis/
  // setAnalysisProgress, see runAnalysis) don't each re-walk the whole
  // board converting it to HiveGameState/computing its hex grid, only an
  // actual move/undo/reset does.
  const [tick, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [copiedUpTo, setCopiedUpTo] = useState<number | null>(null);

  const [hoverHex, setHoverHex] = useState<HivePosition | null>(null);
  const [armedPillbug, setArmedPillbug] = useState<HivePieceState | null>(null);
  const [throwTarget, setThrowTarget] = useState<HivePieceState | null>(null);
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [showCoordinates, setShowCoordinates] = useState(true);

  // A game loaded via LoadGamePanel (pasted from selfplay_games.jsonl or
  // similar) -- `loadedMoves` is the full move sequence, replayed onto
  // gameRef/historyRef/moveLogRef move by move as the user steps through it
  // with Prev/Next, same underlying state a normal move commits into.
  const loadedMovesRef = useRef<Move[] | null>(null);
  const [loadedGameInfo, setLoadedGameInfo] = useState<{
    winner: "white" | "black" | "draw" | null;
    total: number;
  } | null>(null);
  const [loadGameError, setLoadGameError] = useState<string | null>(null);

  // Highlighted from/to squares for a move the user is hovering over --
  // either a candidate move in the analysis panel (looked up live against
  // gameRef.current, since those are moves *from the current position*) or
  // a past entry in the move history (using its own recorded from/to,
  // since the board may have moved on since that ply -- see moveLog.ts).
  const [hoveredHighlight, setHoveredHighlight] = useState<{
    from: HivePosition | null;
    to: HivePosition[];
  } | null>(null);

  // A small "here's the resulting position" board shown near the cursor
  // while hovering a candidate move in the analysis panel (lichess/
  // chess.com-style move preview) -- separate from hoveredHighlight, which
  // stays on the *current* board and isn't affected by this.
  const [movePreview, setMovePreview] = useState<{
    gameState: HiveGameState;
    x: number;
    y: number;
  } | null>(null);

  const MOVE_PREVIEW_SIZE = 200;

  const previewMove = (move: Move | null, clientPos: { x: number; y: number } | null) => {
    if (!move || !clientPos) {
      setMovePreview(null);
      return;
    }
    // The move list sits at the right edge of the screen, so anchor the
    // preview to the *left* of the cursor (toward the board, where there's
    // room) instead of the right; clamp vertically so it doesn't run off
    // the bottom of the viewport.
    const y = Math.min(clientPos.y, Math.max(0, window.innerHeight - MOVE_PREVIEW_SIZE - 20));
    setMovePreview({ gameState: previewAfterMove(gameRef.current, move), x: clientPos.x, y });
  };

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref (not just state) so runAnalysis -- called synchronously from
  // several handlers -- always sees the latest value rather than one
  // captured in a stale closure from the render that created the handler.
  const analysisPausedRef = useRef(false);
  const [analysisPaused, setAnalysisPausedState] = useState(false);
  // How many total simulations the current position is aiming for, and how
  // many it's actually accumulated so far -- both refs (not state) since
  // runAnalysis needs their latest values synchronously, including from
  // right after a setAnalysis(null) in the same tick (see afterStateChange).
  // Together these turn "run a search" into "top up to the target": a
  // fresh position starts at DEFAULT_NUM_SIMULATIONS with 0 visits so far
  // (runs the full default budget, same as before this existed); pausing
  // mid-search and resuming asks for only the remaining budget instead of
  // restarting (HiveBot's own tree reuse, see hive-bot-web's
  // HiveBot.findReusableRoot, means those extra simulations build on the
  // paused tree, not a fresh one); clicking "run more" raises the target
  // and the next call naturally asks for the difference.
  const targetSimulationsRef = useRef(DEFAULT_NUM_SIMULATIONS);
  const lastKnownVisitsRef = useRef(0);

  // First run pays for both fetching+compiling the WASM runtime and
  // loading the model, on top of the search itself -- generous, but this
  // is meant to catch "actually broken" (e.g. the model 404ing), not
  // "still legitimately thinking".
  const ANALYSIS_TIMEOUT_MS = 120_000;

  const runAnalysis = () => {
    const worker = workerRef.current;
    if (analysisPausedRef.current || !worker || gameRef.current.gameOver) {
      setAnalysis(null);
      return;
    }
    const numSimulations = Math.max(
      1,
      targetSimulationsRef.current - lastKnownVisitsRef.current,
    );
    const requestId = ++requestIdRef.current;
    pendingRequestRef.current = requestId;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisProgress(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (pendingRequestRef.current !== requestId) return;
      setAnalyzing(false);
      setAnalysisError(
        "Timed out waiting for the bot -- open the browser console for details " +
          "(likely the model or worker script failed to load; check the Network tab for a 404).",
      );
    }, ANALYSIS_TIMEOUT_MS);
    const request: AnalyzeRequest = {
      type: "analyze",
      requestId,
      state: serializeGameState(gameRef.current),
      numSimulations,
    };
    worker.postMessage(request);
  };

  const handleRunMore = () => {
    targetSimulationsRef.current += NUM_SIMULATIONS_INCREMENT;
    runAnalysis();
  };

  useEffect(() => {
    const worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (
      event: MessageEvent<AnalyzeResponse | AnalyzeProgressResponse | AnalyzeErrorResponse>,
    ) => {
      const data = event.data;
      if (data.requestId !== pendingRequestRef.current) return; // stale response
      if (data.type === "progress") {
        // A real, moving simulation count means the search is alive, not
        // stuck -- push the "actually broken" timeout back out rather than
        // letting it fire under a search that's just still going.
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          if (pendingRequestRef.current !== data.requestId) return;
          setAnalyzing(false);
          setAnalysisError(
            "Timed out waiting for the bot -- open the browser console for details " +
              "(likely the model or worker script failed to load; check the Network tab for a 404).",
          );
        }, ANALYSIS_TIMEOUT_MS);
        setAnalysisProgress({ completed: data.completed, total: data.total });
        // Lichess/chess.com-style live readout: update with what the
        // search has found so far rather than waiting for the full
        // simulation budget (which, at up to 1000 sims, the user will
        // often move on well before reaching anyway).
        setAnalysis(data.analysis);
        lastKnownVisitsRef.current = totalVisits(data.analysis);
        return;
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setAnalyzing(false);
      setAnalysisProgress(null);
      if (data.type === "analysis") {
        setAnalysis(data.analysis);
        lastKnownVisitsRef.current = totalVisits(data.analysis);
      } else {
        setAnalysisError(data.message);
        setAnalysis(null);
      }
    };
    // Fires if the worker script itself fails to load/parse (e.g. a 404 on
    // the worker's own JS chunk) -- different from an error the worker
    // catches and reports back via postMessage, since in this case the
    // worker never got far enough to do that.
    worker.onerror = (event) => {
      console.error("[hive analysis] worker failed to load:", event);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setAnalyzing(false);
      setAnalysisError("The analysis worker failed to load -- check the browser console.");
    };
    workerRef.current = worker;
    runAnalysis();
    return () => {
      worker.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const afterStateChange = () => {
    rerender();
    setAnalysis(null);
    // A hovered candidate move/history entry belongs to whatever position
    // was on screen before this change -- stale once the board moves on.
    setHoveredHighlight(null);
    setMovePreview(null);
    // A new position starts its own fresh simulation budget/tally -- the
    // old position's target (possibly raised by "run more") and visit
    // count don't carry over to a different position.
    targetSimulationsRef.current = DEFAULT_NUM_SIMULATIONS;
    lastKnownVisitsRef.current = 0;
    runAnalysis();
  };

  const setAnalysisPaused = (paused: boolean) => {
    analysisPausedRef.current = paused;
    setAnalysisPausedState(paused);
    if (paused) {
      // Tell the worker to actually abandon the in-flight search -- without
      // this it just keeps burning CPU on up to NUM_SIMULATIONS more
      // simulations in the background, "paused" only in the sense that the
      // UI stops listening for its result (see analysisWorker.ts's
      // CancelMessage doc).
      const cancel: CancelMessage = { type: "cancel" };
      workerRef.current?.postMessage(cancel);
      pendingRequestRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setAnalyzing(false);
      setAnalysisProgress(null);
    } else {
      runAnalysis();
    }
  };

  const commit = (move: Move) => {
    const logEntry = toMoveLogEntry(gameRef.current, move);
    const undo = applyMove(gameRef.current, move);
    historyRef.current.push(undo);
    moveLogRef.current.push(logEntry);
    // A manual move played from a loaded position is a divergence from that
    // game's actual continuation -- drop Prev/Next rather than have them
    // silently replay over/discard the manual move.
    loadedMovesRef.current = null;
    setLoadedGameInfo(null);
    afterStateChange();
  };

  // Replays `loadedMovesRef.current[0..count)` from scratch onto
  // gameRef/historyRef/moveLogRef -- used both to land on a specific ply
  // right after loading a game and by the Prev/Next/Start/End controls.
  const goToLoadedMove = (count: number) => {
    const moves = loadedMovesRef.current;
    if (!moves) return;
    const clamped = Math.max(0, Math.min(count, moves.length));
    gameRef.current = newGame(currentEnabledTypes());
    historyRef.current = [];
    moveLogRef.current = [];
    for (let i = 0; i < clamped; i++) {
      const move = moves[i];
      const logEntry = toMoveLogEntry(gameRef.current, move);
      const undo = applyMove(gameRef.current, move);
      historyRef.current.push(undo);
      moveLogRef.current.push(logEntry);
    }
    cancelThrow();
    afterStateChange();
  };

  const stepLoadedForward = () => goToLoadedMove(historyRef.current.length + 1);

  const handleLoadGame = (rawLine: string) => {
    setLoadGameError(null);
    try {
      const raw = JSON.parse(rawLine) as RawRecordedGame;
      if (!Array.isArray(raw.history)) throw new Error('missing "history" array');
      const needsExpansion = historyNeedsExpansion(raw);
      const moves = parseUhpHistory(raw.history, needsExpansion ? EXPANSION_ENABLED_TYPES : ANALYSIS_ENABLED_TYPES);
      loadedMovesRef.current = moves;
      setLoadedGameInfo({ winner: winnerFromGameStatus(raw.game_status), total: moves.length });
      // Only flip the toggle -- which rebuilds the board via
      // currentEnabledTypes() -- once parsing has actually succeeded, so a
      // bad paste doesn't leave the toggle saying one thing while the
      // board (never rebuilt) still reflects the old setting.
      setExpansionEnabled(needsExpansion);
      goToLoadedMove(0);
    } catch (err) {
      setLoadGameError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyMovesUpTo = (index: number) => {
    const slice = moveLogRef.current.slice(0, index + 1);
    void navigator.clipboard.writeText(JSON.stringify(slice, null, 2)).then(() => {
      setCopiedUpTo(index);
      setTimeout(() => setCopiedUpTo((current) => (current === index ? null : current)), 1500);
    });
  };

  const tryApplyMove = (piece: HivePieceState, pos: HivePosition) => {
    const move = attemptMove(gameRef.current, piece, pos);
    if (move) commit(move);
  };

  const cancelThrow = () => {
    setArmedPillbug(null);
    setThrowTarget(null);
  };

  const handleArmPillbug = (piece: HivePieceState | null) => {
    setArmedPillbug((current) => (current && piece && current.id === piece.id ? null : piece));
    setThrowTarget(null);
  };

  const handleCompleteThrow = (pos: HivePosition) => {
    if (armedPillbug && throwTarget) {
      const move = findThrowMove(gameRef.current, armedPillbug, throwTarget, pos);
      if (move) commit(move);
    }
    cancelThrow();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelThrow();
        return;
      }
      // Don't hijack arrow keys while the user is typing/editing text
      // (e.g. pasting a game into LoadGamePanel's textarea).
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target?.isContentEditable;
      if (isTextInput) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepLoadedForward();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // handleUndo/stepLoadedForward/cancelThrow only close over refs and
    // stable state setters, not stale render-scoped values, so mounting
    // this once is equivalent to (and much cheaper than) re-subscribing on
    // every render -- see GameBoard.tsx's equivalent effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHandDrop = (piece: HivePieceState) => {
    if (!hoverHex) return;
    tryApplyMove(piece, hoverHex);
    setHoverHex(null);
  };

  const handleUndo = () => {
    const undo = historyRef.current.pop();
    if (!undo) return;
    moveLogRef.current.pop();
    undoMove(gameRef.current, undo);
    afterStateChange();
  };

  const handleReset = () => {
    gameRef.current = newGame(currentEnabledTypes());
    historyRef.current = [];
    moveLogRef.current = [];
    loadedMovesRef.current = null;
    setLoadedGameInfo(null);
    setLoadGameError(null);
    cancelThrow();
    afterStateChange();
  };

  // Only meaningful before anything's actually been played -- rebuilding
  // mid-game with a different piece set would reassign every piece's id
  // (see expansionEnabledRef's doc), so the panel below disables this once
  // there's any move history or a loaded game to protect.
  const canChangePieceSet = historyRef.current.length === 0 && loadedGameInfo === null;

  const handleToggleExpansion = () => {
    if (!canChangePieceSet) return;
    const next = !expansionEnabledRef.current;
    setExpansionEnabled(next);
    gameRef.current = newGame(next ? EXPANSION_ENABLED_TYPES : ANALYSIS_ENABLED_TYPES);
    cancelThrow();
    afterStateChange();
  };

  // `tick` stands in for gameRef.current itself (a ref, not a dependency-
  // trackable value -- see its declaration above), so eslint can't see why
  // it's there since the callback body never reads it directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gameState = useMemo(() => toHiveGameState(gameRef.current), [tick]);
  const white = gameState.player1_state;
  const black = gameState.player2_state;
  const sideToMove = gameState.player1_turn ? "White" : "Black";
  const playerColors = { white: "white", black: "black" };

  const lastLoggedMove = moveLogRef.current[moveLogRef.current.length - 1] ?? null;
  const lastMoveHighlight = lastLoggedMove
    ? {
        from: lastLoggedMove.from
          ? { q: lastLoggedMove.from[0], r: lastLoggedMove.from[1], s: lastLoggedMove.from[2] }
          : null,
        to: { q: lastLoggedMove.to[0], r: lastLoggedMove.to[1], s: lastLoggedMove.to[2] },
      }
    : null;

  return (
    <>
    <div className="hive-root analysis-layout">
      <div className="analysis-board-column">
        <section className={`hive-section opponent compact ${!gameState.player1_turn ? "turn-active" : ""}`}>
          <h2>Black</h2>
          <PiecesStrip
            pieces={black.pieces_in_hand}
            colour="black"
            title="Black pieces in hand"
            onDrop={!gameState.player1_turn ? handleHandDrop : undefined}
          />
        </section>

        <section className="hive-section board">
          {armedPillbug && (
            <div className="pillbug-throw-hint">
              {throwTarget
                ? "Click an empty hex adjacent to the Pillbug to complete the throw (Esc to cancel)"
                : "Click a piece adjacent to the Pillbug to throw it (Esc to cancel)"}
            </div>
          )}
          <button
            className="ghost-button toggle-coordinates-button"
            onClick={() => setShowCoordinates((v) => !v)}
          >
            {showCoordinates ? "Hide" : "Show"} notation
          </button>
          <HiveBoardSVG
            gameState={gameState}
            hoverHex={hoverHex}
            onHoverHexChange={setHoverHex}
            onDropPiece={tryApplyMove}
            playerColors={playerColors}
            currentUsername={sideToMove.toLowerCase()}
            armedPillbug={armedPillbug}
            throwTarget={throwTarget}
            onArmPillbug={handleArmPillbug}
            onSelectThrowTarget={setThrowTarget}
            onCompleteThrow={handleCompleteThrow}
            highlightMove={hoveredHighlight}
            lastMove={lastMoveHighlight}
            hexSizeRatio={0.11}
            maxHexRadius={90}
            showCoordinates={showCoordinates}
          />
        </section>

        <section className={`hive-section you compact ${gameState.player1_turn ? "turn-active" : ""}`}>
          <h2>White</h2>
          <PiecesStrip
            pieces={white.pieces_in_hand}
            colour="white"
            title="White pieces in hand"
            onDrop={gameState.player1_turn ? handleHandDrop : undefined}
          />
        </section>
      </div>

      <aside className="analysis-sidebar">
        <GameSetupPanel
          expansionEnabled={expansionEnabled}
          onToggle={handleToggleExpansion}
          locked={!canChangePieceSet}
        />

        <AnalysisPanel
          state={gameRef.current}
          sideToMove={sideToMove}
          analyzing={analyzing}
          analysis={analysis}
          progress={analysisProgress}
          error={analysisError}
          onUndo={handleUndo}
          onReset={handleReset}
          canUndo={historyRef.current.length > 0}
          gameOver={gameState.game_over}
          winner={gameState.winner ?? null}
          paused={analysisPaused}
          onTogglePaused={() => setAnalysisPaused(!analysisPaused)}
          onHoverMove={setHoveredHighlight}
          onPlayMove={commit}
          onPreviewMove={previewMove}
          onRunMore={handleRunMore}
        />

        <LoadGamePanel
          onLoad={handleLoadGame}
          error={loadGameError}
          loadedGame={loadedGameInfo}
          currentPly={historyRef.current.length}
          onStart={() => goToLoadedMove(0)}
          onPrev={handleUndo}
          onNext={stepLoadedForward}
          onEnd={() => goToLoadedMove(loadedGameInfo?.total ?? 0)}
        />

        <MoveHistoryPanel
          moves={moveLogRef.current}
          copiedUpTo={copiedUpTo}
          onCopyUpTo={copyMovesUpTo}
          onHoverMove={setHoveredHighlight}
        />
      </aside>
    </div>
    {movePreview && (
      <div
        className="move-preview-tooltip"
        style={{ left: movePreview.x - MOVE_PREVIEW_SIZE - 16, top: movePreview.y }}
      >
        <MiniBoard gameState={movePreview.gameState} size={MOVE_PREVIEW_SIZE} />
      </div>
    )}
    </>
  );
}

/* ================= game setup ================= */

function GameSetupPanel({
  expansionEnabled,
  onToggle,
  locked,
}: {
  expansionEnabled: boolean;
  onToggle: () => void;
  locked: boolean;
}) {
  return (
    <section className="sidebar-card game-setup-panel">
      <div className="sidebar-card-header">
        <h2>Game setup</h2>
      </div>
      <label
        className="expansion-toggle"
        title={locked ? "Reset the board (or load a new game) to change this" : undefined}
      >
        <input type="checkbox" checked={expansionEnabled} disabled={locked} onChange={onToggle} />
        Include Mosquito, Ladybug, Pillbug
      </label>
    </section>
  );
}

/* ================= load game ================= */

function LoadGamePanel({
  onLoad,
  error,
  loadedGame,
  currentPly,
  onStart,
  onPrev,
  onNext,
  onEnd,
}: {
  onLoad: (rawLine: string) => void;
  error: string | null;
  loadedGame: { winner: "white" | "black" | "draw" | null; total: number } | null;
  currentPly: number;
  onStart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnd: () => void;
}) {
  const [text, setText] = useState("");

  const handleLoadClick = () => {
    const line = text.trim().split("\n")[0]?.trim();
    if (line) onLoad(line);
  };

  return (
    <section className="sidebar-card load-game-panel">
      <div className="sidebar-card-header">
        <h2>Load game</h2>
      </div>
      <p className="muted">
        Paste one line from a <code>selfplay_games.jsonl</code>-style file (a JSON object with a{" "}
        <code>history</code> field, UHP notation) to replay it here move by move.
      </p>
      <textarea
        className="load-game-textarea"
        rows={3}
        placeholder='{"history": [["wS1", "."], ...], "game_status": {...}, "game_type": "Base"}'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="ghost-button" onClick={handleLoadClick} disabled={!text.trim()}>
        Load
      </button>
      {error && <p className="analysis-error">{error}</p>}
      {loadedGame && (
        <div className="loaded-game-controls">
          <p className="muted">
            Loaded game --{" "}
            {loadedGame.winner === "draw"
              ? "draw"
              : loadedGame.winner
                ? `${loadedGame.winner === "white" ? "White" : "Black"} wins`
                : "unresolved"}
          </p>
          <div className="loaded-game-nav">
            <button className="ghost-button" onClick={onStart} disabled={currentPly === 0}>
              ⏮ Start
            </button>
            <button className="ghost-button" onClick={onPrev} disabled={currentPly === 0}>
              ◀ Prev
            </button>
            <span className="loaded-game-position">
              {currentPly} / {loadedGame.total}
            </span>
            <button className="ghost-button" onClick={onNext} disabled={currentPly >= loadedGame.total}>
              Next ▶
            </button>
            <button className="ghost-button" onClick={onEnd} disabled={currentPly >= loadedGame.total}>
              End ⏭
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================= move history ================= */

function MoveHistoryPanel({
  moves,
  copiedUpTo,
  onCopyUpTo,
  onHoverMove,
}: {
  moves: MoveLogEntry[];
  copiedUpTo: number | null;
  onCopyUpTo: (index: number) => void;
  onHoverMove: (highlight: { from: HivePosition | null; to: HivePosition[] } | null) => void;
}) {
  return (
    <section className="sidebar-card move-history">
      <div className="sidebar-card-header">
        <h2>Move history</h2>
        {moves.length > 0 && (
          <button
            className="ghost-button"
            onClick={() => onCopyUpTo(moves.length - 1)}
            title="Copy the full move list as JSON, to paste into a bug report"
          >
            {copiedUpTo === moves.length - 1 ? "Copied!" : "Copy all"}
          </button>
        )}
      </div>
      {moves.length === 0 ? (
        <p className="muted">No moves yet.</p>
      ) : (
        <ol className="move-history-list">
          {moves.map((entry, i) => {
            const from = entry.from ? { q: entry.from[0], r: entry.from[1], s: entry.from[2] } : null;
            const to = [{ q: entry.to[0], r: entry.to[1], s: entry.to[2] }];
            return (
              <li key={i}>
                <button
                  className="move-history-entry"
                  onClick={() => onCopyUpTo(i)}
                  onMouseEnter={() => onHoverMove({ from, to })}
                  onMouseLeave={() => onHoverMove(null)}
                  title="Copy moves 1..this one as JSON, to paste into a bug report"
                >
                  <span className="move-history-index">{i + 1}.</span> {describeMoveLogEntry(entry)}
                  {copiedUpTo === i && <span className="copied-badge">Copied!</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ================= analysis panel ================= */

// `analysis.winProbability` (and each MoveEvaluation.winProbability) is
// for whoever's actually choosing -- state.currentPlayer, i.e. sideToMove
// -- in [0, 1]. Evaluations should always read from White's point of view
// (like a chess engine's eval bar), so flip it when Black is the one
// they're computed for.
function toWhiteProbability(winProbability: number, whiteToMove: boolean): number {
  return whiteToMove ? winProbability : 1 - winProbability;
}

// Undoes the [0, 1] rescale back to the network's native [-1, 1]
// value-head scale (loss..win) for display.
function formatWinValue(winProbability: number): string {
  const value = winProbability * 2 - 1;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

// Total simulations backing this analysis -- *cumulative*, not the
// current call's own `progress.completed`. When HiveBot reuses a prior
// search's tree (the position just played was already a child it had
// explored -- see hive-bot-web's HiveBot.analyze), this starts well above
// 0 and keeps growing move over move; `progress.completed` always resets
// to 1 each call regardless, since it's just this call's own loop
// counter. Showing this instead is what actually makes tree reuse visible
// in the UI, rather than looking like search restarts from scratch on
// every move.
function totalVisits(analysis: PositionAnalysis): number {
  return analysis.moveEvaluations.reduce((sum, e) => sum + e.visitCount, 0);
}

/** Like moveLog.ts's `describeMoveLogEntry`, but for an analysis
 * suggestion that's really several symmetric-equivalent moves (see
 * hive-bot-web's MoveEvaluation.equivalentMoves) -- lists every
 * destination instead of just the one MCTS happened to search, e.g.
 * "Place Queen at (1, -1, 0), (1, 0, -1), ...". `equivalentMoves` always
 * includes `move` itself. */
function describeMoveWithEquivalents(
  state: GameState,
  move: Move,
  equivalentMoves: readonly Move[],
): string {
  return describeMoveLogEntryWithDestinations(
    toMoveLogEntry(state, move),
    equivalentMoves.map((m) => m.to),
  );
}

/** The from/to squares to highlight on the board for a candidate move
 * *from the current position* -- looks the source piece's position up
 * live against `state`, unlike a move-history entry which already has its
 * own recorded from/to (see moveLog.ts). `equivalentMoves` (see
 * hive-bot-web's MoveEvaluation.equivalentMoves) highlights every
 * symmetric-equivalent destination, not just `move`'s own -- defaults to
 * `[move]` for callers with no equivalents (e.g. a move-history entry has
 * its own separate highlight path, see MoveHistoryPanel above). */
function highlightForMove(
  state: GameState,
  move: Move,
  equivalentMoves: readonly Move[] = [move],
): { from: HivePosition | null; to: HivePosition[] } {
  const actorId = move.kind === MoveKind.THROW ? move.thrownPieceId! : move.pieceId;
  const fromPos = state.position.get(actorId);
  return {
    from: fromPos ? { q: fromPos[0], r: fromPos[1], s: fromPos[2] } : null,
    to: equivalentMoves.map((m) => ({ q: m.to[0], r: m.to[1], s: m.to[2] })),
  };
}

function AnalysisPanel({
  state,
  sideToMove,
  analyzing,
  analysis,
  progress,
  error,
  onUndo,
  onReset,
  canUndo,
  gameOver,
  winner,
  paused,
  onTogglePaused,
  onHoverMove,
  onPlayMove,
  onPreviewMove,
  onRunMore,
}: {
  state: GameState;
  sideToMove: string;
  analyzing: boolean;
  analysis: PositionAnalysis | null;
  progress: { completed: number; total: number } | null;
  error: string | null;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
  gameOver: boolean;
  winner: string | null;
  paused: boolean;
  onTogglePaused: () => void;
  onHoverMove: (highlight: { from: HivePosition | null; to: HivePosition[] } | null) => void;
  onPlayMove: (move: Move) => void;
  onPreviewMove: (move: Move | null, clientPos: { x: number; y: number } | null) => void;
  onRunMore: () => void;
}) {
  return (
    <section className="sidebar-card analysis-panel">
      <div className="sidebar-card-header">
        <h2>Analysis</h2>
        <div className="analysis-controls">
          <button
            className="ghost-button"
            onClick={onTogglePaused}
            title={paused ? "Resume the bot's analysis" : "Pause the bot's analysis"}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="ghost-button" onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
          <button className="ghost-button" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>

      {gameOver ? (
        <p>
          Game over --{" "}
          {winner === "draw" ? "draw" : winner ? `${winner === "white" ? "White" : "Black"} wins` : "unresolved"}
        </p>
      ) : error ? (
        <p className="analysis-error">Analysis failed: {error}</p>
      ) : paused && !analysis ? (
        <p className="muted">Analysis paused.</p>
      ) : analyzing && !analysis ? (
        <div className="analysis-progress">
          <p className="muted">
            Thinking…{" "}
            {progress && (
              <span className="analysis-progress-count">
                {progress.completed}/{progress.total}
              </span>
            )}
          </p>
          <div className="win-probability-bar">
            <div
              className="win-probability-fill"
              style={{ width: `${progress ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : analysis ? (
        <>
          {(() => {
            const whiteToMove = sideToMove === "White";
            const whiteWinProbability = toWhiteProbability(analysis.winProbability, whiteToMove);
            return (
              <div className="win-probability">
                <div className="win-probability-label">
                  <span>White</span>
                  <span>
                    {formatWinValue(whiteWinProbability)}
                    {analyzing && " (thinking…)"}
                  </span>
                </div>
                <div className="win-probability-bar">
                  <div
                    className="win-probability-fill"
                    style={{ width: `${(whiteWinProbability * 100).toFixed(0)}%` }}
                  />
                </div>
                <p className="muted side-to-move-note">
                  {sideToMove} to move · {totalVisits(analysis).toLocaleString()} visits
                  {paused && " · paused"}
                </p>
                {/* The search has used up its current target and is sitting
                    idle -- offer another batch on top rather than making the
                    user pause/resume (which continues toward the *existing*
                    target) just to think harder about this position. */}
                {!analyzing && !paused && (
                  <button
                    className="ghost-button run-more-button"
                    onClick={onRunMore}
                    title={`Run ${NUM_SIMULATIONS_INCREMENT.toLocaleString()} more simulations`}
                  >
                    + Analyze more
                  </button>
                )}
              </div>
            );
          })()}
          <p
            className="best-move hoverable-move"
            onMouseEnter={(e) => {
              // moveEvaluations[0] is always the same move as bestMove
              // (see bot.ts's analysisFromRoot) -- go through it instead of
              // bestMove directly so the highlight/description can include
              // its equivalentMoves too.
              const best = analysis.moveEvaluations[0];
              onHoverMove(highlightForMove(state, best.move, best.equivalentMoves));
              onPreviewMove(best.move, { x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => {
              onHoverMove(null);
              onPreviewMove(null, null);
            }}
            onClick={() => onPlayMove(analysis.bestMove)}
            title="Click to play this move"
          >
            <span>
              Best: {describeMoveWithEquivalents(state, analysis.moveEvaluations[0].move, analysis.moveEvaluations[0].equivalentMoves)}
            </span>
            <span className="move-eval-pct">
              {formatWinValue(
                toWhiteProbability(analysis.moveEvaluations[0].winProbability, sideToMove === "White"),
              )}
            </span>
          </p>
          {/* moveEvaluations[0] is the same move as bestMove, already shown
              (with its eval) above -- start the list at the next-best
              alternative instead of repeating it. */}
          <ol className="analysis-move-list">
            {analysis.moveEvaluations.slice(1, 6).map((e, i) => (
              <li
                key={i}
                className="hoverable-move"
                onMouseEnter={(ev) => {
                  onHoverMove(highlightForMove(state, e.move, e.equivalentMoves));
                  onPreviewMove(e.move, { x: ev.clientX, y: ev.clientY });
                }}
                onMouseLeave={() => {
                  onHoverMove(null);
                  onPreviewMove(null, null);
                }}
                onClick={() => onPlayMove(e.move)}
                title="Click to play this move"
              >
                <span>{describeMoveWithEquivalents(state, e.move, e.equivalentMoves)}</span>
                <span className="move-eval-pct">
                  {formatWinValue(toWhiteProbability(e.winProbability, sideToMove === "White"))}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="muted">No analysis yet.</p>
      )}
    </section>
  );
}

