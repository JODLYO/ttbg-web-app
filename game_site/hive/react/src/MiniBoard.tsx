// A small, static (non-interactive) board render -- used by AnalysisBoard
// to preview "what would the position look like after this move" when
// hovering a candidate move, the way lichess/chess.com's explorer-style
// move hover previews work. Deliberately not HiveBoardSVG cut down: no
// camera/zoom/pan/drag-drop is needed for a fixed-size, one-shot preview,
// so this just fits the whole board into `size` once per render.

import { HexCell2D, HexCell3D } from "./HexCells";
import type { HiveGameState } from "./types";
import { computeBoardCells, hexToPixel } from "./utils";

const PLAYER_COLORS: Record<string, string> = { white: "white", black: "black" };
const REFERENCE_HEX_RADIUS = 30;

export default function MiniBoard({ gameState, size = 220 }: { gameState: HiveGameState; size?: number }) {
  const cellMap = gameState.board_state.cells;
  const hexPositions = computeBoardCells(Object.values(cellMap));

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  hexPositions.forEach((pos) => {
    const { x, y } = hexToPixel(pos, REFERENCE_HEX_RADIUS);
    minX = Math.min(minX, x - REFERENCE_HEX_RADIUS);
    maxX = Math.max(maxX, x + REFERENCE_HEX_RADIUS);
    minY = Math.min(minY, y - REFERENCE_HEX_RADIUS);
    maxY = Math.max(maxY, y + REFERENCE_HEX_RADIUS);
  });
  const boardW = maxX - minX || 1;
  const boardH = maxY - minY || 1;
  const scale = Math.min(size / boardW, size / boardH) * 0.9;
  const hexRadius = REFERENCE_HEX_RADIUS * scale;
  const hexSize = hexRadius * 2;
  const offsetX = (-(minX + maxX) / 2) * scale;
  const offsetY = (-(minY + maxY) / 2) * scale;

  return (
    <div style={{ width: size, height: size, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`,
        }}
      >
        {hexPositions.map((pos) => {
          const key = `${pos.q},${pos.r},${pos.s}`;
          const cell = cellMap[key];
          const topPiece = cell?.pieces[cell.pieces.length - 1];
          const { x, y } = hexToPixel(pos, hexRadius);
          const half = hexSize / 2;
          return (
            <div
              key={key}
              style={{ position: "absolute", left: x - half, top: y - half, width: hexSize, height: hexSize }}
            >
              {topPiece ? (
                <HexCell3D size={`${hexSize}px`} fill={PLAYER_COLORS[topPiece.owner]} label={topPiece.piece_type} />
              ) : (
                <HexCell2D size={`${hexSize}px`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
