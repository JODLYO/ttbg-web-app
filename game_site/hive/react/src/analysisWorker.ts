/// <reference lib="webworker" />
// Runs HiveBot's search off the main thread -- MCTS + ONNX inference for a
// few hundred simulations would otherwise freeze the UI while it thinks.
// Loaded via Vite's `new Worker(new URL(...), { type: "module" })` pattern
// from AnalysisBoard.tsx.

import { OrtWebEvaluator } from "evaluator-ort-web";
import { COMPACT_BOARD_CONFIG, HiveBot, deserializeGameState } from "hive-core";
import type { PositionAnalysis, SerializedGameState } from "hive-core";
import { DEFAULT_NUM_SIMULATIONS } from "./analysisConstants";

// Matches the vite_tags.py / game_board.html convention: the Vite build's
// `outDir` is `hive/static/hive/react/dist`, and `public/` (where the
// exported model was copied) gets copied verbatim into that same output
// root, so this is where Django ends up serving it -- see
// hive/templates/hive/analysis.html.
//
// Canonicalized compact 18x28 grid (export/onnx_export.py's --compact-board
// flag). Its weights match hive-bot's
// checkpoints/train_amount_sweep/batch_1500.pt exactly (see hive-app's
// docs/engine-notes.md) -- used for base-piece-only games and expansion
// ones alike.
const MODEL_URL = "/static/hive/react/dist/models/hive_net_mlp.onnx";

// Vite's own asset pipeline already detects and bundles the one WASM
// runtime binary this actually needs (confirmed via `npm run build`) --
// no wasmPaths override needed. OrtWebEvaluator forces single-threaded
// WASM itself: the multi-threaded backend needs Cross-Origin-Opener-Policy/
// Cross-Origin-Embedder-Policy response headers Django isn't configured
// to send.

console.log("[hive analysis worker] started");

let botPromise: Promise<HiveBot> | null = null;

function getBot(): Promise<HiveBot> {
  botPromise ??= (async () => {
    console.log("[hive analysis worker] loading model from", MODEL_URL);
    const bot = new HiveBot(await OrtWebEvaluator.load(MODEL_URL), {
      numSimulations: DEFAULT_NUM_SIMULATIONS,
      boardConfig: COMPACT_BOARD_CONFIG,
    });
    console.log("[hive analysis worker] model loaded");
    return bot;
  })();
  return botPromise;
}

export interface AnalyzeRequest {
  type: "analyze";
  requestId: number;
  state: SerializedGameState;
  // How many *new* simulations to run this call, on top of whatever
  // HiveBot's own tree reuse (see hive-core's HiveBot.findReusableRoot)
  // already carries over for this exact position -- AnalysisBoard.tsx
  // computes this from its own running "target" simulation count minus
  // this position's current visit count, so a paused-then-resumed search
  // continues toward that target instead of restarting, and the "run
  // more" button can ask for a fresh batch once one completes.
  numSimulations: number;
}

export interface AnalyzeResponse {
  type: "analysis";
  requestId: number;
  analysis: PositionAnalysis;
}

export interface AnalyzeProgressResponse {
  type: "progress";
  requestId: number;
  completed: number;
  total: number;
  // A full live analysis as of this simulation -- lets the UI update its
  // best-move/win-probability readout continuously instead of waiting for
  // the full `total` budget to be spent (see HiveBot.analyze's onProgress
  // doc).
  analysis: PositionAnalysis;
}

export interface AnalyzeErrorResponse {
  type: "error";
  requestId: number;
  message: string;
}

// Sent when the UI pauses analysis -- unlike a newer `analyze` request
// (which naturally supersedes the in-flight one via `nextRequest`), pausing
// has no next position to move on to, so without this the search would
// just run to completion in the background regardless of "paused" (up to
// NUM_SIMULATIONS steps at ~250-300ms each -- see analysisWorker's own
// budget comment), burning CPU for a result the UI has already discarded.
export interface CancelMessage {
  type: "cancel";
}

type IncomingMessage = AnalyzeRequest | CancelMessage;

// A new `analyze` message can arrive while a previous one is still
// running (the user moves again before a slow-ish search finishes) --
// `self.onmessage` firing a fresh async call per message would then run
// two `bot.analyze()` calls concurrently against the *same* cached ONNX
// Runtime session, which isn't safe to call re-entrantly: this produced
// real "Could not find OrtValue with name 'board'" errors from
// overlapping session.run() calls stepping on each other's internal
// state. Fix: only ever run one at a time. A message that arrives mid-run
// replaces `nextRequest` and (via the `shouldContinue` passed to
// `bot.analyze` below) tells that in-flight search to abandon itself at
// its next simulation boundary rather than run to completion on a
// position that's already stale -- see MCTS.run's shouldContinue doc for
// why that requires an actual event-loop yield, not just checking a flag.
let processing = false;
let nextRequest: AnalyzeRequest | null = null;
let cancelled = false;

async function processRequest(request: AnalyzeRequest): Promise<void> {
  const { requestId, state: serialized, numSimulations } = request;
  console.log("[hive analysis worker] request", requestId, "received");
  cancelled = false;
  try {
    const bot = await getBot();
    const state = deserializeGameState(serialized);
    console.log("[hive analysis worker] request", requestId, "running search...");
    const analysis = await bot.analyze(state, {
      onProgress: (completed, total, analysis) => {
        const progress: AnalyzeProgressResponse = {
          type: "progress",
          requestId,
          completed,
          total,
          analysis,
        };
        self.postMessage(progress);
      },
      // A newer request queuing up while this one is mid-search means the
      // position it's analyzing is already stale (the user moved again) --
      // abandon it now rather than burning the rest of numSimulations on a
      // result nobody will use, which otherwise made every move after the
      // first feel like it was waiting for *two* full searches back to back.
      // A `cancel` message (the UI pausing) abandons it the same way.
      shouldContinue: () => nextRequest === null && !cancelled,
      numSimulations,
    });
    console.log("[hive analysis worker] request", requestId, "done");
    const response: AnalyzeResponse = { type: "analysis", requestId, analysis };
    self.postMessage(response);
  } catch (err) {
    console.error("[hive analysis worker] request", requestId, "failed:", err);
    const response: AnalyzeErrorResponse = {
      type: "error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
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

// Catches errors that happen outside the message handler (e.g. a failure
// while this module itself is loading) -- otherwise those are silent and
// the main thread just waits forever with nothing to report.
self.onerror = (event) => {
  console.error("[hive analysis worker] uncaught error:", event);
};
