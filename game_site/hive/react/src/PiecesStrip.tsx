// A player's row of in-hand pieces, draggable onto the board -- shared by
// the live 2-player board (GameBoard.tsx) and the analysis board
// (AnalysisBoard.tsx), which otherwise had two copies of this drifting
// slowly apart.

import { useRef } from "react";
import Draggable from "react-draggable";
import { HexCell3D } from "./HexCells";
import type { HivePieceState } from "./types";

export function PiecesStrip({
  pieces,
  colour,
  title,
  onDrop,
}: {
  pieces: HivePieceState[];
  colour: string;
  title: string;
  onDrop?: (piece: HivePieceState, node: HTMLElement) => void;
}) {
  return (
    <div className="pieces-block">
      <div className="pieces-title">{title}</div>
      <div className="pieces-row" style={{ display: "flex", gap: 6 }}>
        {pieces.map((p) => (
          <DraggableHandPiece key={p.id} piece={p} colour={colour} onDrop={onDrop} />
        ))}
      </div>
    </div>
  );
}

function DraggableHandPiece({
  piece,
  colour,
  onDrop,
}: {
  piece: HivePieceState;
  colour: string;
  onDrop?: (piece: HivePieceState, node: HTMLElement) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);

  return (
    <Draggable
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      position={{ x: 0, y: 0 }}
      bounds="body"
      onStop={() => {
        if (nodeRef.current) onDrop?.(piece, nodeRef.current);
      }}
    >
      <div
        ref={nodeRef}
        style={{ cursor: onDrop ? "grab" : "not-allowed", opacity: onDrop ? 1 : 0.5 }}
      >
        <HexCell3D size="var(--hex-size)" fill={colour} label={piece.piece_type} />
      </div>
    </Draggable>
  );
}
