import { useCallback, useEffect, useRef } from "react";
import type {
  AnalysisResponse,
  AnalyzeRequest,
  CancelMessage,
  ErrorResponse,
  MoveRequest,
  MoveResponse,
  ProgressResponse,
} from "./botWorker";

export type BotMessage = ProgressResponse | AnalysisResponse | MoveResponse | ErrorResponse;

/** Owns the bot's web worker for a component's lifetime: `analyze` posts a search request,
 * `cancel` tells the worker to abandon the one in flight, and every reply is handed to
 * `onMessage` (always the latest closure, so handlers can read current state freely).
 * A worker that fails to load at all is reported as an error with `requestId: -1`. */
export function useBotWorker(onMessage: (message: BotMessage) => void) {
  const workerRef = useRef<Worker | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const worker = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<BotMessage>) => handlerRef.current(event.data);
    worker.onerror = (event) => {
      console.error("[dragon bot] worker failed to load:", event);
      handlerRef.current({
        type: "error",
        requestId: -1,
        message: "The bot's worker failed to load -- check the browser console.",
      });
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const analyze = useCallback((request: Omit<AnalyzeRequest, "type">) => {
    const message: AnalyzeRequest = { type: "analyze", ...request };
    workerRef.current?.postMessage(message);
  }, []);

  const requestMove = useCallback((request: Omit<MoveRequest, "type">) => {
    const message: MoveRequest = { type: "move", ...request };
    workerRef.current?.postMessage(message);
  }, []);

  const cancel = useCallback(() => {
    const message: CancelMessage = { type: "cancel" };
    workerRef.current?.postMessage(message);
  }, []);

  return { analyze, requestMove, cancel };
}
