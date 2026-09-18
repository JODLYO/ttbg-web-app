// Shared between analysisWorker.ts (which runs the search) and
// AnalysisBoard.tsx (which decides how big a batch to ask for) -- kept in
// its own tiny module rather than exported from analysisWorker.ts itself,
// since that file's top-level `import * as ort from "onnxruntime-web"`
// would otherwise get pulled into the main thread's bundle too just to
// read a constant.

// A ceiling, not a target -- each `progress` message the worker sends
// carries a full live analysis snapshot (lichess/chess.com cloud-eval
// style), so the UI already has something useful after the first
// simulation and just keeps refining it. Search only runs this long if
// the position is left alone; moving cuts it short immediately (see
// analysisWorker.ts's shouldContinue). Single-threaded WASM in-browser is
// much slower per simulation than native PyTorch (~250-300ms/sim for the
// current model), so 1000 is minutes of thinking time at the ceiling, not
// seconds.
export const DEFAULT_NUM_SIMULATIONS = 1000;

// How many additional simulations the "run more" (+) button asks for once
// a search has used up its current target -- same size as the initial
// budget, just an on-demand top-up rather than a different number chosen
// for some other reason.
export const NUM_SIMULATIONS_INCREMENT = 1000;
