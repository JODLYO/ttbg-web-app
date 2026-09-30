// Play a full game of Dragon in the Forest against the bot, entirely in the browser: the
// rules engine and the bot's search both come from `dragon-forest-bot-web` (see
// botWorker.ts), so there's no lobby, no WebSocket and no login. The board itself is the
// same GameBoardView the live game uses.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MATH_RNG,
  applyDecision,
  cloneState,
  currentDecision,
  deal,
  isLegalPlay,
  startNextRound,
  type DecisionKind,
  type GameState as EngineState,
} from "dragon-forest-bot-web";
import GameBoardView from "./GameBoardView";
import { savedLevel } from "./analysisConstants";
import LevelPicker from "./LevelPicker";
import {
  type RoundDecision,
  cardContext,
  hideFrom,
  roundHistory,
  roundPoints,
  toUiGameState,
} from "./localGame";
import { useBotWorker, type BotMessage } from "./useBotWorker";
import type { CardContext } from "./types";

const HUMAN_NAME = "You";
const COMPUTER_NAME = "Computer";
// A bot move usually comes back in a second or two; never play faster than this, so the
// human can follow what just happened.
const MIN_BOT_DELAY_MS = 900;

export default function VsComputerBoard() {
  const gameRef = useRef<EngineState>(deal(MATH_RNG));
  // This round's decisions, for the bot's belief inference (cleared each new round).
  const roundRef = useRef<RoundDecision[]>([]);
  const humanSeatRef = useRef(0);
  const [level, setLevelState] = useState(() => savedLevel());
  const levelRef = useRef(level);
  const setLevel = (next: typeof level) => {
    levelRef.current = next;
    setLevelState(next);
  };
  const [humanSeat, setHumanSeat] = useState(0);
  const [tick, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const [error, setError] = useState<string | null>(null);

  const pendingRequestRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const startTimesRef = useRef(new Map<number, number>());
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const names = (seat: number): [string, string] =>
    seat === 0 ? [HUMAN_NAME, COMPUTER_NAME] : [COMPUTER_NAME, HUMAN_NAME];

  const afterChangeRef = useRef<() => void>(() => {});

  const { requestMove, cancel } = useBotWorker((message: BotMessage) => {
    if (
      message.requestId !== pendingRequestRef.current &&
      message.requestId !== -1
    )
      return;
    if (message.type === "error") {
      pendingRequestRef.current = null;
      setError(message.message);
      return;
    }
    if (message.type !== "move") return;
    // The computer's move: play it, but not before the minimum delay.
    const { kind, player, action, requestId } = message;
    const startedAt = startTimesRef.current.get(requestId) ?? performance.now();
    const wait = Math.max(
      0,
      MIN_BOT_DELAY_MS - (performance.now() - startedAt),
    );
    moveTimerRef.current = setTimeout(() => {
      if (pendingRequestRef.current !== requestId) return;
      pendingRequestRef.current = null;
      roundRef.current.push({
        before: cloneState(gameRef.current),
        player,
        action,
      });
      applyDecision(gameRef.current, kind, player, action);
      afterChangeRef.current();
    }, wait);
  });

  const runBotIfItsTurn = useCallback(() => {
    const state = gameRef.current;
    const botSeat = 1 - humanSeatRef.current;
    if (
      state.gameOver ||
      state.roundOver ||
      currentDecision(state).player !== botSeat
    )
      return;
    const requestId = ++requestIdRef.current;
    pendingRequestRef.current = requestId;
    startTimesRef.current.set(requestId, performance.now());
    setError(null);
    requestMove({
      requestId,
      state: hideFrom(state, botSeat),
      level: levelRef.current,
      history: roundHistory(roundRef.current, botSeat),
    });
  }, [requestMove]);

  afterChangeRef.current = () => {
    rerender();
    runBotIfItsTurn();
  };

  useEffect(() => {
    runBotIfItsTurn();
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, [runBotIfItsTurn]);

  const newGame = (seat: number) => {
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    pendingRequestRef.current = null;
    cancel();
    humanSeatRef.current = seat;
    setHumanSeat(seat);
    gameRef.current = deal(MATH_RNG);
    roundRef.current = [];
    // `deal` always has seat 0 lead the first round.
    setError(null);
    afterChangeRef.current();
  };

  const state = gameRef.current;

  const playHuman = (kind: DecisionKind, card: CardContext) => {
    const s = gameRef.current;
    if (s.roundOver || s.gameOver) return;
    const decision = currentDecision(s);
    if (decision.player !== humanSeatRef.current || decision.kind !== kind)
      return;
    if (kind === "play" && !isLegalPlay(s, humanSeatRef.current, card.id))
      return;
    if (!decision.actions.includes(card.id)) return;
    roundRef.current.push({
      before: cloneState(s),
      player: humanSeatRef.current,
      action: card.id,
    });
    applyDecision(s, kind, humanSeatRef.current, card.id);
    afterChangeRef.current();
  };

  const nextRound = () => {
    startNextRound(gameRef.current, MATH_RNG);
    roundRef.current = [];
    afterChangeRef.current();
  };

  // Memoized on `tick` (bumped on every real move), not rebuilt per render: the board's
  // "flash the finished trick for 3s" effect keys on these arrays, so fresh copies on
  // unrelated re-renders would keep restarting its timer.
  const ui = useMemo(
    () =>
      toUiGameState(gameRef.current, {
        names: names(humanSeat),
        revealSeats: [humanSeat],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, humanSeat],
  );
  const computerSeat = 1 - humanSeat;

  return (
    <div className="bot-layout">
      <GameBoardView
        gameState={ui}
        username={HUMAN_NAME}
        onPlayCard={(card) => playHuman("play", card)}
        onReplaceTrump={(card) => playHuman("replace_trump", card)}
        onDiscardCard={(card) => playHuman("discard", card)}
        onKeepTrump={() =>
          playHuman("replace_trump", cardContext(gameRef.current.trumpCard))
        }
      >
        {state.roundOver && !state.gameOver && (
          <dialog open className="round-summary">
            <h2>Round {state.roundNumber} complete</h2>
            <p>
              You scored {roundPoints(state, humanSeat)} (
              {state.tricksWon[humanSeat]} tricks) &middot; Computer scored{" "}
              {roundPoints(state, computerSeat)} (
              {state.tricksWon[computerSeat]} tricks)
            </p>
            <button onClick={nextRound}>Next round</button>
          </dialog>
        )}
        {state.gameOver && (
          <dialog open className="round-summary">
            <h2>Game over!</h2>
            <p>
              {state.winner === "tie"
                ? "It's a tie!"
                : state.winner === humanSeat
                  ? "You win!"
                  : "The computer wins."}{" "}
              Final score {state.score[humanSeat]}&ndash;
              {state.score[computerSeat]}.
            </p>
            <button onClick={() => newGame(humanSeat)}>Play again</button>
          </dialog>
        )}
        {error && (
          <dialog open className="round-summary">
            <h2>The computer hit a problem</h2>
            <p>{error}</p>
            <button onClick={runBotIfItsTurn}>Try again</button>
          </dialog>
        )}
      </GameBoardView>
      <aside className="bot-sidebar">
        <section className="bot-card">
          <h2>Vs computer</h2>
          <p>
            <LevelPicker level={level} onChange={setLevel} />
          </p>
          <p className="bot-muted">
            A new level applies from the computer&apos;s next move.
          </p>
          <div className="bot-buttons">
            <button onClick={() => newGame(0)} title="You lead the first trick">
              New game (you first)
            </button>
            <button
              onClick={() => newGame(1)}
              title="The computer leads the first trick"
            >
              New game (computer first)
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
