// Analysis board: play a round with the bot's read on your moves -- a probability for each
// legal action plus the expected round margin. Two modes:
//  - one side (the default): you play one seat and the computer plays the other at a chosen
//    level (`LevelPicker`), like a real game but with the analysis alongside;
//  - both sides: you play every card for both seats, with the analysis always on the side
//    to move.
// Everything runs in the browser (see botWorker.ts).
//
// The board shows the mover's hand at the bottom, like the live game. Because you're
// playing both sides you can see the other hand too (outlined in the sidebar's belief
// grid, next to what the mover can deduce about it), but the bot
// can't: it's handed a state with that hand scrubbed out (`hideFrom`) and treats it as a
// belief over the unseen cards, exactly as it would in a real game.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MATH_RNG,
  applyDecision,
  cloneState,
  currentDecision,
  deal,
  isLegalPlay,
  startNextRound,
  suitOf,
  undoDecision,
  undoStartNextRound,
  type AnyUndo,
  type DecisionKind,
  type GameState as EngineState,
  type Level,
  type PositionAnalysis,
  type StartNextRoundUndo,
} from "dragon-forest-bot-web";
import {
  ANALYSIS_ITERATIONS_INCREMENT,
  DEFAULT_ANALYSIS_ITERATIONS,
  savedLevel,
} from "./analysisConstants";
import LevelPicker from "./LevelPicker";
import GameBoardView from "./GameBoardView";
import OpponentBelief from "./OpponentBelief";
import {
  type RoundDecision,
  cardContext,
  cardName,
  explainMove,
  formatSigned,
  hideFrom,
  roundHistory,
  verbFor,
  roundPoints,
  toUiGameState,
} from "./localGame";
import type { CardContext } from "./types";
import { useBotWorker, type BotMessage } from "./useBotWorker";

const NAMES: [string, string] = ["Player 1", "Player 2"];

type Mode = "one-side" | "both";

/** The shortest wait before the computer's move lands, so you can follow what happened. */
const MIN_COMPUTER_DELAY_MS = 700;

type HistoryEntry =
  | { type: "decision"; undo: AnyUndo; decision: RoundDecision }
  | { type: "next_round"; undo: StartNextRoundUndo };

function describeAction(kind: DecisionKind, action: number, state: EngineState): string {
  switch (kind) {
    case "play":
      return `Play ${cardName(action)}`;
    case "replace_trump":
      return action === state.trumpCard
        ? "Keep the trump card"
        : `Swap ${cardName(action)} with the trump`;
    case "discard":
      return `Discard ${cardName(action)}`;
  }
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Colour class for a signed margin: ahead, behind, or level (within a tenth). */
const signClass = (value: number | null) =>
  value === null || Math.abs(value) < 0.05 ? "sign-level" : value > 0 ? "sign-ahead" : "sign-behind";

export default function AnalysisBoard() {
  const gameRef = useRef<EngineState>(deal(MATH_RNG));
  const historyRef = useRef<HistoryEntry[]>([]);
  const [tick, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPausedState] = useState(false);
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);

  // Refs alongside the state: runAnalysis and the worker handler read the current values.
  const [mode, setModeState] = useState<Mode>("one-side");
  const modeRef = useRef<Mode>("one-side");
  const [humanSeat, setHumanSeatState] = useState(0);
  const humanSeatRef = useRef(0);
  const [level, setLevelState] = useState<Level>(() => savedLevel());
  const levelRef = useRef(level);
  const [revealOpponent, setRevealOpponent] = useState(false);
  const [computerThinking, setComputerThinking] = useState(false);
  const computerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestStartRef = useRef(0);

  // Refs (not state) because runAnalysis is called synchronously from handlers that just
  // changed them. Together they turn "run a search" into "top up to the target": a fresh
  // position aims for DEFAULT_ANALYSIS_ITERATIONS from 0; pausing and resuming asks only
  // for the remainder (the bot keeps refining the same search for an unchanged position);
  // "analyze more" raises the target.
  const pausedRef = useRef(false);
  const requestIdRef = useRef(0);
  const pendingRequestRef = useRef<number | null>(null);
  const targetIterationsRef = useRef(DEFAULT_ANALYSIS_ITERATIONS);
  const knownIterationsRef = useRef(0);

  const { analyze, requestMove, cancel } = useBotWorker((message: BotMessage) => {
    if (message.requestId !== pendingRequestRef.current && message.requestId !== -1) return;
    if (message.type === "error") {
      pendingRequestRef.current = null;
      setAnalyzing(false);
      setComputerThinking(false);
      setError(message.message);
      setAnalysis(null);
      return;
    }
    if (message.type === "move") {
      // The computer opponent's move (one-side mode): play it after a short pause.
      const { requestId, kind, player, action } = message;
      const wait = Math.max(0, MIN_COMPUTER_DELAY_MS - (performance.now() - requestStartRef.current));
      computerTimerRef.current = setTimeout(() => {
        if (pendingRequestRef.current !== requestId) return;
        pendingRequestRef.current = null;
        setComputerThinking(false);
        commit(kind, player, action);
      }, wait);
      return;
    }
    setAnalysis(message.analysis);
    knownIterationsRef.current = message.analysis.iterations;
    if (message.type === "analysis") {
      pendingRequestRef.current = null;
      setAnalyzing(false);
    }
  });

  /** This round's decisions: everything after the last "next round" entry. */
  const roundDecisions = useCallback((): RoundDecision[] => {
    const decisions: RoundDecision[] = [];
    for (let i = historyRef.current.length - 1; i >= 0; i--) {
      const entry = historyRef.current[i];
      if (entry.type === "next_round") break;
      decisions.unshift(entry.decision);
    }
    return decisions;
  }, []);

  const runAnalysis = useCallback(() => {
    const state = gameRef.current;
    if (
      modeRef.current === "one-side" &&
      !state.roundOver &&
      !state.gameOver &&
      currentDecision(state).player !== humanSeatRef.current
    ) {
      // The computer's turn: ask for its move instead of analyzing.
      const seat = currentDecision(state).player;
      const requestId = ++requestIdRef.current;
      pendingRequestRef.current = requestId;
      requestStartRef.current = performance.now();
      setAnalysis(null);
      setAnalyzing(false);
      setComputerThinking(true);
      setError(null);
      requestMove({
        requestId,
        state: hideFrom(state, seat),
        level: levelRef.current,
        history: roundHistory(roundDecisions(), seat),
      });
      return;
    }
    setComputerThinking(false);
    if (pausedRef.current || state.roundOver || state.gameOver) {
      setAnalysis(null);
      setAnalyzing(false);
      return;
    }
    const iterations = Math.max(1, targetIterationsRef.current - knownIterationsRef.current);
    const requestId = ++requestIdRef.current;
    pendingRequestRef.current = requestId;
    setAnalyzing(true);
    setError(null);
    const mover = currentDecision(state).player;
    analyze({
      requestId,
      state: hideFrom(state, mover),
      iterations,
      history: roundHistory(roundDecisions(), mover),
    });
  }, [analyze, requestMove, roundDecisions]);

  /** Drops any in-flight search or computer move, e.g. before the position changes under it. */
  const stopPending = () => {
    if (computerTimerRef.current) clearTimeout(computerTimerRef.current);
    computerTimerRef.current = null;
    pendingRequestRef.current = null;
    setComputerThinking(false);
    cancel();
  };

  useEffect(
    () => () => {
      if (computerTimerRef.current) clearTimeout(computerTimerRef.current);
    },
    [],
  );

  const afterStateChange = useCallback(() => {
    rerender();
    setAnalysis(null);
    setHoveredAction(null);
    targetIterationsRef.current = DEFAULT_ANALYSIS_ITERATIONS;
    knownIterationsRef.current = 0;
    runAnalysis();
  }, [rerender, runAnalysis]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  const setPaused = (next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    if (next) {
      cancel();
      pendingRequestRef.current = null;
      setAnalyzing(false);
    } else if (knownIterationsRef.current < targetIterationsRef.current) {
      // Nothing left to do if the search had already reached its target before pausing.
      runAnalysis();
    }
  };

  const commit = (kind: DecisionKind, player: number, action: number) => {
    const before = cloneState(gameRef.current);
    const undo = applyDecision(gameRef.current, kind, player, action);
    historyRef.current.push({ type: "decision", undo, decision: { before, player, action } });
    afterStateChange();
  };

  const state = gameRef.current;
  const decision = state.roundOver || state.gameOver ? null : currentDecision(state);
  const mover = decision ? decision.player : state.currentPlayer;
  const oneSide = mode === "one-side";
  const names: [string, string] = oneSide
    ? humanSeat === 0
      ? ["You", "Computer"]
      : ["Computer", "You"]
    : NAMES;
  // Whose view the board and belief grid take: yours in one-side mode, else the mover's.
  const viewer = oneSide ? humanSeat : mover;
  const humansTurn = !oneSide || mover === humanSeat;

  const playCard = (kind: DecisionKind, card: CardContext) => {
    const s = gameRef.current;
    if (s.roundOver || s.gameOver) return;
    const d = currentDecision(s);
    if (d.kind !== kind || !d.actions.includes(card.id)) return;
    if (modeRef.current === "one-side" && d.player !== humanSeatRef.current) return;
    if (kind === "play" && !isLegalPlay(s, d.player, card.id)) return;
    commit(kind, d.player, card.id);
  };

  const undoOne = () => {
    const entry = historyRef.current.pop();
    if (!entry) return false;
    if (entry.type === "decision") undoDecision(gameRef.current, entry.undo);
    else undoStartNextRound(gameRef.current, entry.undo);
    return true;
  };

  /** One step back; in one-side mode, back past the computer's replies to your last move. */
  const undo = () => {
    stopPending();
    if (!undoOne()) return;
    if (modeRef.current === "one-side") {
      for (;;) {
        const s = gameRef.current;
        if (s.roundOver || s.gameOver || currentDecision(s).player === humanSeatRef.current) break;
        if (!undoOne()) break;
      }
    }
    afterStateChange();
  };

  const setMode = (next: Mode) => {
    stopPending();
    modeRef.current = next;
    setModeState(next);
    afterStateChange();
  };

  const setHumanSeat = (seat: number) => {
    stopPending();
    humanSeatRef.current = seat;
    setHumanSeatState(seat);
    afterStateChange();
  };

  const setLevel = (next: Level) => {
    levelRef.current = next;
    setLevelState(next);
  };

  const newDeal = () => {
    stopPending();
    gameRef.current = deal(MATH_RNG);
    historyRef.current = [];
    afterStateChange();
  };

  const nextRound = () => {
    const undoToken = startNextRound(gameRef.current, MATH_RNG);
    historyRef.current.push({ type: "next_round", undo: undoToken });
    afterStateChange();
  };

  const analyzeMore = () => {
    targetIterationsRef.current += ANALYSIS_ITERATIONS_INCREMENT;
    runAnalysis();
  };

  // Memoized on `tick` (bumped on every real move): search progress re-renders this
  // component many times a second, and fresh arrays each time would keep restarting the
  // board's "flash the finished trick for 3s" timer.
  const ui = useMemo(
    () => toUiGameState(gameRef.current, { names, revealSeats: [viewer] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, viewer, mode, humanSeat],
  );
  const highlighted = new Set<number>(
    hoveredAction !== null && state.hands[viewer].includes(hoveredAction) ? [hoveredAction] : [],
  );
  const top = analysis?.actions[0];

  return (
    <div className="bot-layout">
      <GameBoardView
        gameState={ui}
        username={names[viewer]}
        onPlayCard={(card) => playCard("play", card)}
        onReplaceTrump={(card) => playCard("replace_trump", card)}
        onDiscardCard={(card) => playCard("discard", card)}
        onKeepTrump={() => playCard("replace_trump", cardContext(gameRef.current.trumpCard))}
        highlightedCardIds={highlighted}
      />

      <aside className="bot-sidebar">
        <section className="bot-card analysis-settings">
          <div className="settings-grid">
            <label htmlFor="analysis-mode">Play</label>
            <select
              id="analysis-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="one-side">One side, against the computer</option>
              <option value="both">Both sides yourself</option>
            </select>
            {oneSide && (
              <>
                <label htmlFor="analysis-seat">You are</label>
                <select
                  id="analysis-seat"
                  value={humanSeat}
                  onChange={(e) => setHumanSeat(Number(e.target.value))}
                >
                  <option value={0}>Player 1 (leads first)</option>
                  <option value={1}>Player 2</option>
                </select>
                <label htmlFor="analysis-level">Computer</label>
                <LevelPicker id="analysis-level" level={level} onChange={setLevel} label={null} />
              </>
            )}
          </div>
          {oneSide && (
            <label className="settings-check">
              <input
                type="checkbox"
                checked={revealOpponent}
                onChange={(e) => setRevealOpponent(e.target.checked)}
              />
              Show the computer&apos;s real cards in the belief grid
            </label>
          )}
        </section>

        <section className="bot-card">
          <div className="bot-card-header">
            <h2>Analysis</h2>
            <div className="bot-buttons">
              {decision && humansTurn && (
                <button
                  onClick={() => setPaused(!paused)}
                  title={paused ? "Resume the bot's analysis" : "Pause the bot's analysis"}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
              )}
              <button onClick={undo} disabled={historyRef.current.length === 0}>
                Undo
              </button>
              <button onClick={newDeal}>New deal</button>
            </div>
          </div>

          {state.gameOver ? (
            <p>
              Game over &mdash;{" "}
              {state.winner === "tie"
                ? "a tie"
                : `${names[state.winner as number]} ${verbFor(names[state.winner as number], "wins", "win")}`}{" "}
              (
              {state.score[0]}&ndash;{state.score[1]}).
            </p>
          ) : state.roundOver ? (
            <>
              <p>
                Round {state.roundNumber} complete: {names[0]} scored {roundPoints(state, 0)} (
                {state.tricksWon[0]} tricks), {names[1]} scored {roundPoints(state, 1)} (
                {state.tricksWon[1]} tricks).
              </p>
              <button onClick={nextRound}>Next round</button>
            </>
          ) : computerThinking || !humansTurn ? (
            <p className="bot-muted">
              The computer ({level}) is choosing its move
              <span className="analysis-badge">thinking</span>
            </p>
          ) : error ? (
            <p className="bot-error">Analysis failed: {error}</p>
          ) : paused && !analysis ? (
            <p className="bot-muted">Analysis paused.</p>
          ) : !analysis ? (
            <p className="bot-muted">
              Analyzing <span className="analysis-badge">thinking</span>
            </p>
          ) : (
            <>
              <div className="analysis-eval">
                <div
                  className={`analysis-eval-value ${signClass(analysis.value)}`}
                  title="Round points minus the opponent's, from here, if both sides play like the bot"
                >
                  {formatSigned(analysis.value)}
                </div>
                <div className="analysis-eval-text">
                  <div>
                    Expected round margin for{" "}
                    {names[mover] === "You" ? "you" : names[mover]}
                  </div>
                  <div className="bot-muted">
                    {names[mover]} to{" "}
                    {decision?.kind === "replace_trump"
                      ? "swap"
                      : decision?.kind === "discard"
                        ? "discard"
                        : "play"}{" "}
                    · {analysis.iterations.toLocaleString()} iterations
                    {analyzing && <span className="analysis-badge">thinking</span>}
                    {paused && <span className="analysis-badge">paused</span>}
                  </div>
                </div>
              </div>
              <div className="analysis-move-head bot-muted">
                <span />
                <span>Move</span>
                <span>How often</span>
                <span />
                <span>Margin</span>
              </div>
              <ol className="analysis-move-list">
                {analysis.actions.slice(0, 8).map((entry, i) => (
                  <li
                    key={entry.action}
                    className={`analysis-move ${i === 0 ? "best" : ""}`}
                    onMouseEnter={() => setHoveredAction(entry.action)}
                    onMouseLeave={() => setHoveredAction(null)}
                    onClick={() => decision && commit(decision.kind, decision.player, entry.action)}
                    title="Click to play this move"
                  >
                    <span className={`suit-dot ${suitOf(entry.action)}`} />
                    <span className="analysis-move-label">
                      {describeAction(analysis.kind, entry.action, state)}
                    </span>
                    <span className="analysis-move-bar">
                      <span style={{ width: `${(entry.probability * 100).toFixed(0)}%` }} />
                    </span>
                    <span className="analysis-move-pct">
                      {(entry.probability * 100).toFixed(0)}%
                    </span>
                    <span className={`analysis-move-value ${signClass(entry.value)}`}>
                      {entry.value === null ? "" : formatSigned(entry.value)}
                    </span>
                  </li>
                ))}
              </ol>
              {(() => {
                const focus =
                  analysis.actions.find((a) => a.action === hoveredAction) ?? analysis.actions[0];
                return (
                  <div className="move-explanation">
                    <h3>
                      Why {lowerFirst(describeAction(analysis.kind, focus.action, state))}?
                      <span className="bot-muted">
                        {" "}
                        ({focus === analysis.actions[0] ? "top move" : "hovered"})
                      </span>
                    </h3>
                    <ul>
                      {explainMove(state, analysis, focus, names[mover]).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              {analysis.actions.length > 8 && (
                <p className="bot-muted">
                  + {analysis.actions.length - 8} more moves, each under{" "}
                  {Math.max(1, Math.ceil((analysis.actions[8]?.probability ?? 0) * 100))}%
                </p>
              )}
              <p className="analysis-footnote bot-muted">
                How often = the share of the time the bot&apos;s mixed strategy plays the move.
                Margin = that move&apos;s expected round margin. Click a move to play it.
              </p>
              {!analyzing && !paused && top && (
                <button
                  onClick={analyzeMore}
                  title={`Run ${ANALYSIS_ITERATIONS_INCREMENT} more search iterations`}
                >
                  + Analyze more
                </button>
              )}
            </>
          )}
          {top === undefined && !state.roundOver && !state.gameOver && !error && paused && (
            <p className="bot-muted">Press Resume to analyze this position.</p>
          )}
        </section>

        {!state.roundOver && !state.gameOver && (
          <OpponentBelief
            state={state}
            probabilities={analysis?.player === viewer ? analysis.opponentCards : null}
            viewer={viewer}
            viewerName={names[viewer]}
            otherName={names[1 - viewer]}
            revealActual={!oneSide || revealOpponent}
          />
        )}

        <section className="bot-card">
          <p className="bot-muted">
            {oneSide ? (
              <>
                Play your cards from the hand at the bottom (or click a suggestion); the
                computer answers at the level you chose. Undo takes back your last move and
                the computer&apos;s reply.
              </>
            ) : (
              <>
                Play cards from the hand at the bottom (or click a suggestion) for whichever
                side is to move; Undo steps back through the round.
              </>
            )}
          </p>
        </section>
      </aside>
    </div>
  );
}
