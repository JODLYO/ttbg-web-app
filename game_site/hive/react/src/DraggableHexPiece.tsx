import { useRef } from "react";
import Draggable from "react-draggable";
import { HexCell3D } from "./HexCells";
import type { HivePieceState } from "./types";

interface DraggableHexPieceProps {
  piece: HivePieceState;
  colour: string;
  size: string;
  bounds?: string;
  onDrag?: (node: HTMLElement | null) => void;
  onDrop?: (piece: HivePieceState, node: HTMLElement) => void;
}

export function DraggableHexPiece({
  piece,
  colour,
  size,
  bounds,
  onDrag,
  onDrop,
}: DraggableHexPieceProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: 0, y: 0 }}
      bounds={bounds}
      onDrag={() => onDrag?.(nodeRef.current)}
      onStop={() => {
        if (nodeRef.current) {
          onDrop?.(piece, nodeRef.current);
        }
      }}
    >
      <div
        ref={nodeRef}
        style={{ width: "100%", height: "100%", cursor: "grab" }}
      >
        <HexCell3D
          size={size}
          fill={colour}
          label={piece.piece_type}
        />
      </div>
    </Draggable>
  );
}
