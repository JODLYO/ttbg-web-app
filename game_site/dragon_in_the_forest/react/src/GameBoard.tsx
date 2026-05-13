import { useEffect, useRef, useState } from "react";
import type { GameState, CardContext } from "./types";
import { DraggableCard, StaticHand } from "./components"
import { pointsFromTricks, mapCardsToTrickCards, mapCardsToTrickCardsData, mapCardsContextToTrickCardsData } from "./gameUtils"
import { motion, AnimatePresence } from "framer-motion";


function GameBoard() {
    const WINNING_SCORE = 10
    const NO_CARDS_IN_HAND = 13
    const socketRef = useRef<WebSocket | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const gameData = (window as any).gameData;
    const isDiscardMode = gameState?.waiting_for_discard?.player === gameData.username;
    const isTrumpReplacement = gameState?.waiting_for_trump_replacement?.player === gameData.username;
    const trumpSuitClass = gameState?.trump_card?.suit || "";

    const [visibleTrickCards, setVisibleTrickCards] = useState<
        { card_id: string; player: string }[]
    >([]);

    const [visibleTrickCardsData, setVisibleTrickCardsData] = useState<
        { [key: number]: CardContext }
    >({});



    useEffect(() => {
        if (!gameState) return;


        // Case 1: actively playing trick
        if (gameState.current_trick && gameState.current_trick.cards.length > 0) {
            setVisibleTrickCards(
                mapCardsToTrickCards(gameState.current_trick.cards, gameState.current_player)
            );
            setVisibleTrickCardsData(
                mapCardsToTrickCardsData(gameState.current_trick.cards)
            );
            return;
        }

        // Case 2: trick just ended, flash previous cards for 1s
        if (
            gameState.current_trick.cards.length === 0 &&
            gameState.previous_trick &&
            gameState.previous_trick.cards.length > 0
        ) {
            const { cards } = gameState.previous_trick;
            setVisibleTrickCards(mapCardsToTrickCards(cards, gameState.current_player));
            setVisibleTrickCardsData(mapCardsToTrickCardsData(cards) || {});

            const timeout = setTimeout(() => {
                setVisibleTrickCards([]);
                setVisibleTrickCardsData({});
            }, 3000);

            return () => clearTimeout(timeout);
        }

        // Case 3: clear only when nothing at all
        if (
            (!gameState.current_trick || gameState.current_trick.cards.length > 0) &&
            (!gameState.previous_trick || gameState.previous_trick.cards.length > 0)
        ) {
            setVisibleTrickCards([]);
            setVisibleTrickCardsData({});
        }
    }, [
        gameState?.current_trick?.cards,
        gameState?.previous_trick?.cards,
    ]);


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

    const isPlayer1 = gameState.player1.username === gameData.username;
    const currentPlayer = isPlayer1 ? gameState.player1 : gameState.player2;
    const opponent = isPlayer1 ? gameState.player2 : gameState.player1;

    return (
        <div className={`game-container ${trumpSuitClass}`}>
            <header className="player-info">
                <section className="player">
                    <h3>{currentPlayer.username}</h3>
                    <div className="bar-container">
                        <div className="bar-label score">Score ({currentPlayer.score}/{WINNING_SCORE})</div>
                        <div className="bar">
                            <div
                                className="bar-fill score-fill"
                                style={{ width: `${(currentPlayer.score / WINNING_SCORE) * 100}%` }}
                            />
                        </div>
                    </div>
                    <div className="bar-container">
                        <div className="bar-label tricks">Tricks ({currentPlayer.tricks_won}/{NO_CARDS_IN_HAND})</div>
                        <div className="bar">
                            <div
                                className="bar-fill tricks-fill"
                                style={{ width: `${(currentPlayer.tricks_won / NO_CARDS_IN_HAND) * 100}%` }}
                            />
                            {/* threshold markers */}
                            {[3, 4, 5, 6, 9].map((t) => (
                                <div
                                    key={t}
                                    className="threshold-marker"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                    title={`${t} tricks`}
                                />
                            ))}
                            {[1, 2, 7, 8, 10, 11, 12].map((t) => (
                                <div
                                    key={t}
                                    className="points-marker"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                />
                            ))}
                        </div>
                        <div className="threshold-labels">
                            {[1.5, 3.5, 4.5, 5.5, 7.5, 11].map((t) => (
                                <div
                                    key={t}
                                    className="threshold-label"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                >
                                    {pointsFromTricks(t)}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
                <section className="player">
                    <h3>{opponent.username}</h3>
                    <div className="bar-container">
                        <div className="bar-label score">Score ({opponent.score}/{WINNING_SCORE})</div>
                        <div className="bar">
                            <div
                                className="bar-fill score-fill"
                                style={{ width: `${(opponent.score / WINNING_SCORE) * 100}%` }}
                            />
                        </div>
                    </div>
                    <div className="bar-container">
                        <div className="bar-label tricks">Tricks ({opponent.tricks_won}/{NO_CARDS_IN_HAND})</div>
                        <div className="bar">
                            <div
                                className="bar-fill tricks-fill"
                                style={{ width: `${(opponent.tricks_won / NO_CARDS_IN_HAND) * 100}%` }}
                            />
                            {/* threshold markers */}
                            {[3, 4, 5, 6, 9].map((t) => (
                                <div
                                    key={t}
                                    className="threshold-marker"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                    title={`${t} tricks`}
                                />
                            ))}
                            {[1, 2, 7, 8, 10, 11, 12].map((t) => (
                                <div
                                    key={t}
                                    className="points-marker"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                />
                            ))}
                        </div>
                        <div className="threshold-labels">
                            {[1.5, 3.5, 4.5, 5.5, 7.5, 11].map((t) => (
                                <div
                                    key={t}
                                    className="threshold-label"
                                    style={{ left: `${(t / NO_CARDS_IN_HAND) * 100}%` }}
                                >
                                    {pointsFromTricks(t)}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </header>

            <div className={`game-area ${trumpSuitClass}`}>
                <main className={`game-board ${trumpSuitClass}`}>
                    {gameState.trump_card && (
                        <section className="trump-card">
                            <h4>Trump Card</h4>
                            <AnimatePresence mode="popLayout">
                                <motion.div
                                    key={gameState.trump_card.value + gameState.trump_card.suit}
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.5 }}                             >
                                    <DraggableCard
                                        cardId={gameState.trump_card.id.toString()}
                                        card={gameState.trump_card}
                                        rotation={0}
                                        disabled
                                        isZoomed={false}
                                        onZoomToggle={() => { }}
                                        onPlayCard={() => { }}
                                    />
                                </motion.div>
                            </AnimatePresence>

                        </section>
                    )}

                    <section className="current-trick">
                        <h4>Current Trick</h4>
                        <div className="trick-cards">
                            <AnimatePresence>
                                {visibleTrickCards.map((card) => {
                                    const cardData = visibleTrickCardsData?.[Number(card.card_id)];
                                    const trickWinner = gameState.last_trick_winner;

                                    const isLoser = trickWinner && card.player !== trickWinner;

                                    if (!cardData) {
                                        return (
                                            <motion.div
                                                key={card.card_id}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                            >
                                                <div className="card-placeholder">{card.card_id}</div>
                                            </motion.div>
                                        );
                                    }

                                    return (
                                        <motion.div
                                            key={card.card_id}
                                            layout={false}
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={
                                                isLoser
                                                    ? {
                                                        opacity: 0,
                                                        scale: 0.7,
                                                        filter: "blur(6px)",
                                                        y: 30,
                                                    }
                                                    : {
                                                        opacity: 1, // Winner stays visible
                                                        scale: 1.05,
                                                    }
                                            }
                                            transition={{ duration: 0.8 }}
                                        >
                                            <DraggableCard
                                                cardId={card.card_id.toString()}
                                                card={cardData}
                                                rotation={0}
                                                disabled
                                                isZoomed={false}
                                                onZoomToggle={() => { }}
                                                onPlayCard={() => { }}
                                            />
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </section>

                    <section className="deck">
                        <h4>Deck</h4>
                        <div></div>
                    </section>
                </main>

                <section className="player-hand">
                    <StaticHand
                        cards={mapCardsContextToTrickCardsData(currentPlayer.cards)}
                        gameState={gameState}
                        username={gameData.username}
                        isDiscardMode={isDiscardMode}
                        isTrumpReplacement={isTrumpReplacement}
                        onPlayCard={
                            isDiscardMode
                                ? handleDiscardCard
                                : isTrumpReplacement
                                    ? handleReplaceTrump
                                    : handlePlayCard
                        }
                    />

                </section>

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
            </div>
        </div>
    );
}

export default GameBoard;
