import type { HiveGameState, HivePieceState, HivePosition } from "./types";
import { HivePieceType } from "./types";
import { HexCell2D, HexCell3D, HexRing } from "./HexCells";
import { useRef, useState, useEffect, useCallback } from "react";
import { hexToPixel, findClosestHex, computeBoardCells } from "./utils";

// Manual zoom range -- 1 is the board's natural pixel size; the auto-fit
// effect below can pick anything smaller than that to fit a big board into
// a small container, but never scales *up* past 1 on its own (see its
// `Math.min(..., 1)`), so 1 is a sensible "as big as a fully-zoomed-out
// board ever gets automatically" reference point for how far manual zoom
// can go beyond that.
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/* =========================
   Coordinate helpers
========================= */
function screenToBoard(
  clientX: number,
  clientY: number,
  boardEl: HTMLDivElement,
  camera: { x: number; y: number; scale: number }
) {
  const rect = boardEl.getBoundingClientRect();
  const x = (clientX - rect.left - rect.width / 2 - camera.x) / camera.scale;
  const y = (clientY - rect.top - rect.height / 2 - camera.y) / camera.scale;
  return { x, y };
}

function boardToHex(x: number, y: number, hexPositions: HivePosition[], hexRadius: number) {
  return findClosestHex(x, y, hexPositions, hexRadius);
}

function samePos(a: HivePosition, b: HivePosition): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

// Color for highlightMove -- both the source piece being moved and its
// destination share this purple, kept visually distinct from the "you can
// drop here" green (HexCell2D's own hover ring) and from the last-move
// ring below.
const HIGHLIGHT_MOVE_COLOR = "#8e44ec";
// The most recently played move's from/to -- a single steady color (not
// paired like from/to above) since this is just "here's what just
// happened", not something you need to tell the two ends apart on.
const LAST_MOVE_COLOR = "#2f80ed";

/* =========================
   Main component
========================= */
export default function HiveBoardSVG({
  gameState,
  hoverHex,
  onDropPiece,
  onHoverHexChange,
  playerColors,
  currentUsername,
  armedPillbug,
  throwTarget,
  onArmPillbug,
  onSelectThrowTarget,
  onCompleteThrow,
  highlightMove,
  lastMove,
  hexSizeRatio = 0.06,
  maxHexRadius = 50,
  showCoordinates = false,
}: {
  gameState: HiveGameState;
  hoverHex: HivePosition | null;
  onDropPiece?: (piece: HivePieceState, pos: HivePosition) => void;
  onHoverHexChange?: (hex: HivePosition | null) => void;
  playerColors: Record<string, string>;
  currentUsername?: string;
  armedPillbug?: HivePieceState | null;
  throwTarget?: HivePieceState | null;
  onArmPillbug?: (piece: HivePieceState | null) => void;
  onSelectThrowTarget?: (piece: HivePieceState) => void;
  onCompleteThrow?: (pos: HivePosition) => void;
  /** A move (from a hovered analysis suggestion or move-history entry) to
   * highlight on the board -- `from` null for a placement (no single
   * source piece to point at). `to` is a list, not a single hex: a hovered
   * analysis suggestion that's really several symmetric-equivalent
   * placements (see hive-core's openingSymmetry.ts/MoveEvaluation.
   * equivalentMoves) highlights every one of them, not just the
   * representative MCTS happened to search; a move-history entry always
   * passes a single-element list. */
  highlightMove?: { from: HivePosition | null; to: HivePosition[] } | null;
  /** The most recently played move, highlighted persistently (not just on
   * hover) so it's always visible which piece moved last and from where. */
  lastMove?: { from: HivePosition | null; to: HivePosition } | null;
  /** Hex radius as a fraction of the board container's smaller dimension --
   * tuned for the live 2-player layout, where the board's container is
   * already sized close to the board's natural footprint. The analysis
   * board gives the board a much larger, mostly-empty container (see
   * App.css's .analysis-layout), so it passes a bigger ratio/cap to
   * actually use that space instead of rendering small hexes in a sea of
   * whitespace. */
  hexSizeRatio?: number;
  maxHexRadius?: number;
  /** Overlay each hex's `q,r,s` key -- on by default for the analysis
   * board (see AnalysisBoard.tsx) where reading off coordinates matters
   * for reporting/replaying positions; off for the live 2-player board,
   * which doesn't need it and has less room to spare. */
  showCoordinates?: boolean;
}) {
  const cellMap = gameState.board_state.cells;
  const hexPositions = computeBoardCells(Object.values(cellMap));
  const boardRef = useRef<HTMLDivElement>(null);

  /* =========================
     Responsive hex size
  ========================= */
  const [hexRadius, setHexRadius] = useState(20);
  const HEX_SIZE = hexRadius * 2;

  /* =========================
     Camera
  ========================= */
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  // Once the user manually zooms/pans, the auto-fit effect below backs off
  // (otherwise every new move -- which changes hexPositions -- would snap
  // their chosen view back to the auto-fit one). The "Fit board" button
  // clears this to re-enable auto-fit.
  const manualCameraRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);

  /* =========================
     Hover / drag state
  ========================= */
  const [hoveredHex, setHoveredHex] = useState<HivePosition | null>(null);
  const activeHover = hoverHex ?? hoveredHex;

  const [draggingPiece, setDraggingPiece] = useState<HivePieceState | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  /* =========================
     Calculate responsive hex size based on board container
  ========================= */
  useEffect(() => {
    if (!boardRef.current) return;

    const updateHexSize = () => {
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();

      // Calculate hex radius as percentage of board size
      const newRadius = Math.min(rect.width, rect.height) * hexSizeRatio;

      // Set minimum and maximum bounds
      const boundedRadius = Math.max(15, Math.min(newRadius, maxHexRadius));
      setHexRadius(boundedRadius);
    };

    updateHexSize();

    // Re-measure whenever the board's actual rendered size changes - not just on
    // window resize. The board sits in a CSS grid row sized off its siblings'
    // "auto" heights, which can shift after mount (e.g. web fonts finishing load),
    // so a resize-only listener can permanently lock in a too-small size measured
    // before layout settled.
    const observer = new ResizeObserver(updateHexSize);
    observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, [hexSizeRatio, maxHexRadius]);

  /* =========================
     Auto center & scale (skipped once the user has manually zoomed/panned)
  ========================= */
  const fitToBoard = useCallback(() => {
    if (!boardRef.current || hexRadius === 0) return;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    hexPositions.forEach((pos) => {
      const { x, y } = hexToPixel(pos, hexRadius);
      minX = Math.min(minX, x - hexRadius);
      maxX = Math.max(maxX, x + hexRadius);
      minY = Math.min(minY, y - hexRadius);
      maxY = Math.max(maxY, y + hexRadius);
    });

    const boardW = maxX - minX;
    const boardH = maxY - minY;

    const rect = boardRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / boardW, rect.height / boardH, 1) * 0.9;

    const offsetX = -(minX + maxX) / 2 * scale;
    const offsetY = -(minY + maxY) / 2 * scale;

    setCamera({ x: offsetX, y: offsetY, scale });
    manualCameraRef.current = false;
  }, [hexPositions, hexRadius]);

  useEffect(() => {
    if (manualCameraRef.current) return;
    fitToBoard();
  }, [fitToBoard]);

  /* =========================
     Manual zoom (mouse wheel / trackpad) -- attached as a native listener
     (rather than React's onWheel) so preventDefault actually stops the
     page from scrolling; React registers wheel listeners as passive by
     default.
  ========================= */
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left - rect.width / 2;
      const pointerY = e.clientY - rect.top - rect.height / 2;
      const zoomFactor = Math.exp(-e.deltaY * 0.0015);
      setCamera((prev) => {
        const newScale = clampScale(prev.scale * zoomFactor);
        const ratio = newScale / prev.scale;
        // Keep the world point currently under the cursor fixed on screen.
        return {
          x: pointerX - (pointerX - prev.x) * ratio,
          y: pointerY - (pointerY - prev.y) * ratio,
          scale: newScale,
        };
      });
      manualCameraRef.current = true;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const zoomBy = (factor: number) => {
    setCamera((prev) => {
      const newScale = clampScale(prev.scale * factor);
      const ratio = newScale / prev.scale;
      return { x: prev.x * ratio, y: prev.y * ratio, scale: newScale };
    });
    manualCameraRef.current = true;
  };

  /* =========================
     Drag-to-pan. Two ways in:
       - Left-drag starting on empty board (pieces stopPropagation on their
         own pointerdown, so this only fires for background/empty-hex
         clicks).
       - Right-drag starting *anywhere*, pieces included -- a packed board
         (see AnalysisBoard's "load game") can have no empty hex visible at
         all once zoomed in, so panning can't depend on finding empty
         space. Handled in the capture phase so it wins before a piece's
         own pointerdown (which would otherwise start moving that piece).
  ========================= */
  const startPan = (e: React.PointerEvent) => {
    if (draggingPiece) return;
    if (armedPillbug && throwTarget) return; // let the click land on a hex to complete the throw
    panStartRef.current = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y };
    setIsPanning(true);
  };

  const startPanCapture = (e: React.PointerEvent) => {
    if (e.button !== 2) return; // right button only; left-drag is handled by startPan/bubbling
    e.preventDefault();
    e.stopPropagation();
    panStartRef.current = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y };
    setIsPanning(true);
  };

  /* =========================
     Global pointer tracking
  ========================= */
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (isPanning && panStartRef.current) {
        const start = panStartRef.current;
        setCamera((prev) => ({
          ...prev,
          x: start.camX + (e.clientX - start.x),
          y: start.camY + (e.clientY - start.y),
        }));
        manualCameraRef.current = true;
        return;
      }

      if (!boardRef.current) return;

      const rect = boardRef.current.getBoundingClientRect();
      const withinBoard =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      const { x, y } = screenToBoard(e.clientX, e.clientY, boardRef.current, camera);
      const hex = withinBoard ? boardToHex(x, y, hexPositions, hexRadius) : null;

      setHoveredHex(hex);
      setPointer({ x, y });
      onHoverHexChange?.(hex);
    };

    document.addEventListener("pointermove", handler);
    return () => document.removeEventListener("pointermove", handler);
  }, [camera, hexPositions, hexRadius, onHoverHexChange, isPanning]);

  /* =========================
     Drop logic
  ========================= */
  function dropPiece() {
    if (!draggingPiece || !pointer) return;
    const hex = boardToHex(pointer.x, pointer.y, hexPositions, hexRadius);
    if (hex) onDropPiece?.(draggingPiece, hex);
    setDraggingPiece(null);
  }

  // Clear dragging/panning state if pointer released anywhere outside the board
  useEffect(() => {
    const handler = () => {
      setDraggingPiece(null);
      setIsPanning(false);
      panStartRef.current = null;
    };
    document.addEventListener("pointerup", handler);
    return () => document.removeEventListener("pointerup", handler);
  }, []);

  /* =========================
     Render
  ========================= */
  return (
    <div
      ref={boardRef}
      className="hive-board-wrapper"
      onPointerDownCapture={startPanCapture}
      onPointerDown={startPan}
      onPointerUp={dropPiece}
      onContextMenu={(e) => e.preventDefault()}
      title="Scroll to zoom · drag empty space to pan (right-click-drag pans from anywhere, pieces included)"
      style={{
        width: "100%",
        height: "100%",
        touchAction: "none",
        position: "relative",
        cursor: isPanning ? "grabbing" : "grab",
      }}
    >
      <div className="board-zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
          &minus;
        </button>
        <button type="button" onClick={fitToBoard} title="Fit board to view" aria-label="Fit board to view">
          Fit
        </button>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "center center",
        }}
      >
        {hexPositions.map((pos) => {
          const key = `${pos.q},${pos.r},${pos.s}`;
          const cell = cellMap[key];
          const topPiece = cell?.pieces[cell.pieces.length - 1];
          const colour = topPiece ? playerColors[topPiece.owner] : undefined;

          const { x, y } = hexToPixel(pos, hexRadius);
          const half = HEX_SIZE / 2;

          const isHover =
            activeHover &&
            pos.q === activeHover.q &&
            pos.r === activeHover.r &&
            pos.s === activeHover.s;

          const isHighlightMove = Boolean(
            (highlightMove?.from && samePos(pos, highlightMove.from)) ||
              highlightMove?.to.some((to) => samePos(pos, to)),
          );
          const isLastMove = Boolean(
            (lastMove?.from && samePos(pos, lastMove.from)) || (lastMove?.to && samePos(pos, lastMove.to)),
          );
          // Priority when more than one applies to the same hex: a hovered
          // candidate move's own from/to is the most specific/deliberate
          // thing being pointed at, so it wins over the passive "last move
          // played" marker.
          const ringColor = isHighlightMove ? HIGHLIGHT_MOVE_COLOR : isLastMove ? LAST_MOVE_COLOR : null;

          return (
            <div
              key={key}
              data-hex={key}
              style={{
                position: "absolute",
                left: x - half,
                top: y - half,
                width: HEX_SIZE,
                height: HEX_SIZE,
              }}
            >
              {topPiece ? (
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (armedPillbug) {
                      if (topPiece.id === armedPillbug.id) {
                        onArmPillbug?.(null); // clicking the armed Pillbug again cancels
                      } else if (!throwTarget) {
                        onSelectThrowTarget?.(topPiece);
                      }
                      return;
                    }
                    setDraggingPiece(topPiece);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (
                      topPiece.piece_type === HivePieceType.PILLBUG &&
                      topPiece.owner === currentUsername
                    ) {
                      onArmPillbug?.(
                        armedPillbug?.id === topPiece.id ? null : topPiece
                      );
                    }
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    cursor:
                      topPiece.piece_type === HivePieceType.PILLBUG &&
                      topPiece.owner === currentUsername
                        ? "context-menu"
                        : "grab",
                    opacity:
                      draggingPiece?.id === topPiece.id ||
                      throwTarget?.id === topPiece.id
                        ? 0.3
                        : 1,
                    outline: armedPillbug?.id === topPiece.id ? "3px solid #2ecc71" : undefined,
                  }}
                >
                  <HexCell3D
                    size={`${HEX_SIZE}px`}
                    fill={colour!}
                    label={topPiece.piece_type}
                  />
                </div>
              ) : (
                <div
                  onPointerDown={(e) => {
                    if (armedPillbug && throwTarget) {
                      e.stopPropagation();
                      onCompleteThrow?.(pos);
                    }
                  }}
                >
                  <HexCell2D size={`${HEX_SIZE}px`} highlight={Boolean(isHover)} />
                </div>
              )}
              {ringColor && <HexRing color={ringColor} />}
              {showCoordinates && (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 0,
                    width: "100%",
                    textAlign: "center",
                    fontSize: Math.max(8, HEX_SIZE * 0.14),
                    lineHeight: 1,
                    color: topPiece ? "#fff" : "#8a94a6",
                    textShadow: topPiece ? "0 1px 2px rgba(0,0,0,0.8)" : undefined,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {key}
                </span>
              )}
            </div>
          );
        })}

        {/* Drag ghost (world-space rendered) */}
        {draggingPiece && pointer && (
          <div
            style={{
              position: "absolute",
              left: pointer.x - HEX_SIZE / 2,
              top: pointer.y - HEX_SIZE / 2,
              width: HEX_SIZE,
              height: HEX_SIZE,
              pointerEvents: "none",
            }}
          >
            <HexCell3D
              size={`${HEX_SIZE}px`}
              fill={playerColors[draggingPiece.owner]}
              label={draggingPiece.piece_type}
            />
          </div>
        )}
      </div>
    </div>
  );
}