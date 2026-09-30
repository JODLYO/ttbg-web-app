import { useEffect, useRef, useState } from "react";
import type { GameState, CardContext } from "./types";
import GameBoardView from "./GameBoardView";


function GameBoard() {
    const socketRef = useRef<WebSocket | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const gameData = (window as any).gameData;

    useEffect(() => {
        const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
        const socket = new WebSocket(
            `${wsScheme}://${window.location.host}/ws/ditf/game/${gameData.gameStateId}/`
        );
        socketRef.current = socket;

        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    action: "start_game",
                    lobby_id: gameData.lobbyId,
                    user_id: gameData.userId,
                })
            );
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (
                data.type === "game_started" ||
                data.type === "game_state_update" ||
                data.type === "game_state"
            ) {
                setGameState(data.game_state);
            } else if (data.type === "game_over") {
                setGameState(data.game_state);
            }
        };

        return () => {
            socket.close();
        };
    }, []);

    const handlePlayCard = (card: CardContext) => {
        if (!socketRef.current || !gameState) return;
        if (gameState.current_player === gameData.username) {
            socketRef.current.send(
                JSON.stringify({
                    action: "play_card",
                    card: card,
                    user_id: gameData.userId,
                })
            );
        }
    };

    const handleReplaceTrump = (card: CardContext) => {
        if (!socketRef.current) return;
        socketRef.current.send(
            JSON.stringify({
                action: "replace_trump_card",
                card: card,
                user_id: gameData.userId,
            })
        );
    };

    const handleDiscardCard = (card: CardContext) => {
        if (!socketRef.current) return;
        socketRef.current.send(
            JSON.stringify({
                action: "discard_card",
                card: card,
                user_id: gameData.userId,
            })
        );
    };


    if (!gameState) return <div>Loading...</div>;

    return (
        <GameBoardView
            gameState={gameState}
            username={gameData.username}
            onPlayCard={handlePlayCard}
            onReplaceTrump={handleReplaceTrump}
            onDiscardCard={handleDiscardCard}
        >
            {gameState.game_over && (
                <dialog open className="game-over">
                    <h2>Game Over!</h2>
                    <p>
                        {gameState.winner === "tie"
                            ? "It's a tie!"
                            : `${gameState.winner} wins!`}
                    </p>
                </dialog>
            )}
        </GameBoardView>
    );
}

export default GameBoard;
