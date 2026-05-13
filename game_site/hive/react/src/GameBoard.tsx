import { useEffect, useRef, useState } from "react";
import type { HiveGameState, HivePieceState, HivePosition } from "./types";
import HiveBoardSVG from "./HiveBoardSVG";
import { HexCell3D } from "./HexCells";
import Draggable from "react-draggable";
import { nodeCenterRelativeToBoard, findClosestHex, isNodeOverBoard, computeBoardCells } from "./utils"

export default function GameBoard() {
  const socketRef = useRef<WebSocket | null>(null);
  const [gameState, setGameState] = useState<HiveGameState | null>(null);
  const [hoverHex, setHoverHex] = useState<HivePosition | null>(null);

  const gameData = (window as any).gameData;
  const { gameStateId, lobbyId, username } = gameData;

  function sendMove(piece: HivePieceState, pos: HivePosition) {
    if (!socketRef.current) return;

    socketRef.current.send(
      JSON.stringify({
        action: "play_piece",
        piece,
        position: pos,
        username,
      })
    );
  }

  useEffect(() => {
    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${wsScheme}://${window.location.host}/ws/hive/game/${gameStateId}/`
    );

    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          action: "start_game",
          lobby_id: lobbyId,
          user_id: gameData.userId,
        })
      );
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "game_started" || data.type === "game_state") {
        setGameState(data.game_state);
      }
    };

    return () => socket.close();
  }, [gameStateId, lobbyId, gameData.userId]);

  useEffect(() => {
    const pageshowHandler = (event: PageTransitionEvent) => {
      if (
        event.persisted ||
        (window.performance && window.performance.navigation.type === 2)
      ) {
        window.location.reload();
      }
    };

    window.addEventListener("pageshow", pageshowHandler);
    return () => window.removeEventListener("pageshow", pageshowHandler);
  }, []);

  if (!gameState) return <div>Loading Hive board...</div>;

  const cells = Object.values(gameState.board_state.cells);
  // const radius = computeBoardRadius(cells);
  // const hexes = generateHexGrid(radius);
  const hexes = computeBoardCells(cells)

  const p1 = gameState.player1_state;
  const p2 = gameState.player2_state;
  const you = p1.username === username ? p1 : p2;
  const opponent = you === p1 ? p2 : p1;

  const playerColors = {
    [p1.username]: "white",
    [p2.username]: "black",
  };

  function handleHandDrag(node: HTMLElement | null) {
    const board = document.querySelector<HTMLElement>(".hive-board-wrapper");
    if (!board || !node) {
      setHoverHex(null);
      return;
    }

    if (!isNodeOverBoard(board, node)) {
      setHoverHex(null);
      return;
    }

    const { x, y } = nodeCenterRelativeToBoard(board, node);
    setHoverHex(findClosestHex(x, y, hexes, 20));
  }

  function handleHandDrop(piece: HivePieceState) {
    if (!hoverHex) return;
    sendMove(piece, hoverHex);
    setHoverHex(null);
  }
  // function handleHandDrop(piece: HivePieceState, node: HTMLElement) {
  //   if (!hoverHex) return;
  //   const board = document.querySelector<HTMLElement>(".hive-board-wrapper");
  //   if (!board) return;
  //   setHoverHex(null);

  //   const { x, y } = nodeCenterRelativeToBoard(board, node);

  //   const cells = Object.values(gameState!.board_state.cells);
  //   const radius = computeBoardRadius(cells);
  //   const hexes = generateHexGrid(radius);

  //   const closest = findClosestHex(x, y, hexes, 20);

  //   if (closest) {
  //     sendMove(piece, closest);
  //   }
  // }

  return (
    <>
    {gameState.game_over && gameState.winner && (
      <div className="game-over-popup">
        <h1>🎉 Game Over</h1>
        <p>
          {gameState.winner === username
            ? "You won! 🏆"
            : `${gameState.winner} won!`}
        </p>
      </div>
    )}
    <div className="hive-root">
      <section className={`hive-section opponent ${(gameState.player1_turn && opponent === p1) ||
        (!gameState.player1_turn && opponent === p2)
        ? "turn-active"
        : ""
        }`}>
        <h2>{opponent.username}</h2>
        <PiecesStrip
          pieces={opponent.pieces_in_hand}
          colour={playerColors[opponent.username]}
          title="Pieces in hand"
        />
      </section>

      <section className="hive-section board">
        <HiveBoardSVG
          gameState={gameState}
          hoverHex={hoverHex}
          // onDragPiece={handleHandDrag}
          onDropPiece={sendMove}
          playerColors={playerColors}
        />
      </section>

      <section className={`hive-section you ${(gameState.player1_turn && you === p1) ||
          (!gameState.player1_turn && you === p2)
          ? "turn-active"
          : ""
        }`} style={{ zIndex: 100 }}>
        <h2>{you.username} (You)</h2>
        <PiecesStrip
          pieces={you.pieces_in_hand}
          colour={playerColors[you.username]}
          title="Your pieces in hand"
          onDrag={handleHandDrag}
          onDrop={handleHandDrop}
        />
      </section>
    </div>
    </>
  );
}

/* ================= hand pieces ================= */

function PiecesStrip({
  pieces,
  colour,
  title,
  onDrop,
  onDrag,
}: {
  pieces: HivePieceState[];
  colour: string;
  title: string;
  onDrop?: (piece: HivePieceState, node: HTMLElement) => void;
  onDrag?: (node: HTMLElement | null) => void;
}) {
  return (
    <div className="pieces-block">
      <div className="pieces-title">{title}</div>
      <div className="pieces-row" style={{ display: "flex", gap: 6 }}>
        {pieces.map((p) => (
          <DraggableHandPiece
            key={p.id}
            piece={p}
            colour={colour}
            onDrop={onDrop}
            onDrag={onDrag}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableHandPiece({
  piece,
  colour,
  onDrop,
  onDrag,
}: {
  piece: HivePieceState;
  colour: string;
  onDrop?: (piece: HivePieceState, node: HTMLElement) => void;
  onDrag?: (node: HTMLElement | null) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: 0, y: 0 }}
      bounds="body"
      onDrag={() => onDrag?.(nodeRef.current)}
      onStop={() => {
        if (nodeRef.current) {
          onDrop?.(piece, nodeRef.current);
        }
      }}
    >
      <div ref={nodeRef} style={{ cursor: "grab" }}>
        <HexCell3D
          size="var(--hex-size)"
          fill={colour}
          label={piece.piece_type}
        />
      </div>
    </Draggable>
  );
}
