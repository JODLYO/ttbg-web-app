import type { HiveGameState, HivePieceState, HivePosition } from "./types";
import { HexCell2D, HexCell3D } from "./HexCells";
import { useRef, useState, useEffect } from "react";
import { hexToPixel, findClosestHex, computeBoardCells } from "./utils";

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

/* =========================
   Main component
========================= */
export default function HiveBoardSVG({
  gameState,
  hoverHex,
  onDropPiece,
  playerColors,
}: {
  gameState: HiveGameState;
  hoverHex: HivePosition | null;
  onDropPiece?: (piece: HivePieceState, pos: HivePosition) => void;
  playerColors: Record<string, string>;
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
      // Adjust the 0.04 multiplier to make hexes bigger/smaller
      const newRadius = Math.min(rect.width, rect.height) * 0.06;
      
      // Set minimum and maximum bounds
      const boundedRadius = Math.max(15, Math.min(newRadius, 50));
      setHexRadius(boundedRadius);
    };

    updateHexSize();
    
    // Update on window resize
    window.addEventListener('resize', updateHexSize);
    return () => window.removeEventListener('resize', updateHexSize);
  }, []);

  /* =========================
     Auto center & scale
  ========================= */
  useEffect(() => {
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
  }, [hexPositions, hexRadius]);

  /* =========================
     Global pointer tracking
  ========================= */
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!boardRef.current) return;

      const { x, y } = screenToBoard(e.clientX, e.clientY, boardRef.current, camera);
      const hex = boardToHex(x, y, hexPositions, hexRadius);

      setHoveredHex(hex);
      setPointer({ x, y });
    };

    document.addEventListener("pointermove", handler);
    return () => document.removeEventListener("pointermove", handler);
  }, [camera, hexPositions, hexRadius]);

  /* =========================
     Drop logic
  ========================= */
  function dropPiece() {
    if (!draggingPiece || !pointer) return;
    const hex = boardToHex(pointer.x, pointer.y, hexPositions, hexRadius);
    if (hex) onDropPiece?.(draggingPiece, hex);
    setDraggingPiece(null);
  }

  // Clear dragging state if pointer released anywhere outside the board
  useEffect(() => {
    const handler = () => setDraggingPiece(null);
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
      onPointerUp={dropPiece}
      style={{ width: "100%", height: "100%", touchAction: "none", position: "relative" }}
    >
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

          return (
            <div
              key={key}
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
                    setDraggingPiece(topPiece);
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    cursor: "grab",
                    opacity: draggingPiece?.id === topPiece.id ? 0.3 : 1,
                  }}
                >
                  <HexCell3D
                    size={`${HEX_SIZE}px`}
                    fill={colour!}
                    label={topPiece.piece_type}
                  />
                </div>
              ) : (
                <HexCell2D size={`${HEX_SIZE}px`} highlight={Boolean(isHover)} />
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