/// <reference lib="webworker" />
// Runs the bot's CFR search off the main thread -- a search is a second or two of pure
// JavaScript, which would otherwise freeze the UI (and, in analysis mode, keep running for
// many seconds while the panel streams progress). Loaded via Vite's
// `new Worker(new URL(...), { type: "module" })` pattern from the board components.

import {
  DragonForestBot,
  currentDecision,
  type DecisionKind,
  type GameState,
  type Level,
  type PositionAnalysis,
  type RecordedDecision,
} from "dragon-forest-bot-web";

// `public/` is copied verbatim into the Vite output root, which Django serves under
// /static/dragon_in_the_forest/react/dist/ (see vite.config.ts's `base`).
const MODEL_URL = "/static/dragon_in_the_forest/react/dist/models/value_net.json";

let botPromise: Promise<DragonForestBot> | null = null;

function getBot(): Promise<DragonForestBot> {
  botPromise ??= DragonForestBot.fromUrl(MODEL_URL);
  return botPromise;
}

export interface AnalyzeRequest {
  type: "analyze";
  requestId: number;
  state: GameState;
  /** How many *new* CFR iterations to run on top of whatever the bot already has for this
   * exact position (it keeps refining the same search when asked again about an unchanged
   * position -- see DragonForestBot.analyze). Omit for the bot's own default. */
  iterations?: number;
  /** This round's decisions so far (`roundHistory` in localGame.ts), scrubbed for the mover.
   * Turns on the bot's belief inference: it reads the opponent's plays for clues to their
   * hand. */
  history?: RecordedDecision[];
}

/** "What does the computer play here?" at a difficulty level -- the vs-computer game and the
 * analysis board's computer opponent. */
export interface MoveRequest {
  type: "move";
  requestId: number;
  state: GameState;
  level: Level;
  history?: RecordedDecision[];
}

export interface MoveResponse {
  type: "move";
  requestId: number;
  player: number;
  kind: DecisionKind;
  action: number;
}

export interface CancelMessage {
  type: "cancel";
}

export interface ProgressResponse {
  type: "progress";
  requestId: number;
  completed: number;
  total: number;
  analysis: PositionAnalysis;
}

export interface AnalysisResponse {
  type: "analysis";
  requestId: number;
  analysis: PositionAnalysis;
  /** The action a sampled draw from the mixed strategy picked -- what the computer plays. */
  chosenAction: number;
}

export interface ErrorResponse {
  type: "error";
  requestId: number;
  message: string;
}

type IncomingMessage = AnalyzeRequest | MoveRequest | CancelMessage;
type WorkRequest = AnalyzeRequest | MoveRequest;

// One search at a time: a request that arrives mid-search replaces `nextRequest` and (via
// `shouldContinue`) makes the in-flight search stop at its next iteration boundary rather
// than finish a position that's already stale. A `cancel` (the UI pausing) stops it the same
// way.
let processing = false;
let nextRequest: WorkRequest | null = null;
let cancelled = false;

async function processRequest(request: WorkRequest): Promise<void> {
  cancelled = false;
  try {
    if (request.type === "move") {
      await processMove(request);
      return;
    }
    const { requestId, state, iterations, history } = request;
    const bot = await getBot();
    const analysis = await bot.analyze(
      state,
      (completed, total, snapshot) => {
        const progress: ProgressResponse = {
          type: "progress",
          requestId,
          completed,
          total,
          analysis: snapshot,
        };
        self.postMessage(progress);
      },
      () => nextRequest === null && !cancelled,
      iterations,
      history,
    );
    const response: AnalysisResponse = {
      type: "analysis",
      requestId,
      analysis,
      chosenAction: bot.sampleAction(analysis),
    };
    self.postMessage(response);
  } catch (err) {
    console.error("[dragon bot worker] request", request.requestId, "failed:", err);
    const response: ErrorResponse = {
      type: "error",
      requestId: request.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
}

async function processMove({ requestId, state, level, history }: MoveRequest): Promise<void> {
  const bot = await getBot();
  const { player, kind } = currentDecision(state);
  const { action } = await bot.chooseAction(
    state,
    level,
    history,
    () => nextRequest === null && !cancelled,
  );
  const response: MoveResponse = { type: "move", requestId, player, kind, action };
  self.postMessage(response);
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (nextRequest) {
      const request = nextRequest;
      nextRequest = null;
      await processRequest(request);
    }
  } finally {
    processing = false;
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type === "cancel") {
    cancelled = true;
    return;
  }
  nextRequest = event.data;
  void processQueue();
};
