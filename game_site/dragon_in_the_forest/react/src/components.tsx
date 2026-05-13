import { useRef, useState } from 'react';
import Draggable from 'react-draggable';
import type { DraggableEvent, DraggableData } from 'react-draggable';
import type { CardContext, GameState } from "./types";
import { getSpecialAbilityText } from './gameUtils'; // ✅ import from utils
import './App.css';
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";


export function DraggableCard({
    cardId,
    card,
    rotation,
    disabled,
    isZoomed,
    onZoomToggle,
    onPlayCard,
}: {
    cardId: string;
    card: CardContext;
    rotation: number;
    disabled: boolean;
    isZoomed: boolean;
    onZoomToggle: (id: string) => void;
    onPlayCard: (card: CardContext) => void;
}) {
    const nodeRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    const imagePath = `/static/dragon_in_the_forest/images/cards/${card.suit}_${card.value}.jpg`;
    const abilityText = getSpecialAbilityText(card.special_ability);

    const handleStop = (_: DraggableEvent, data: DraggableData) => {
        if (!nodeRef.current) return;

        if (Math.abs(data.x) < 5 && Math.abs(data.y) < 5) {
            onZoomToggle(cardId);
            return;
        }

        if (disabled) {
            setPosition({ x: 0, y: 0 });
            return;
        }

        const dropZone = document.querySelector('.current-trick') as HTMLElement | null;
        let played = false;

        if (dropZone) {
            const cardRect = nodeRef.current.getBoundingClientRect();
            const dropRect = dropZone.getBoundingClientRect();
            const overlap =
                cardRect.left < dropRect.right &&
                cardRect.right > dropRect.left &&
                cardRect.top < dropRect.bottom &&
                cardRect.bottom > dropRect.top;

            if (overlap) {
                onPlayCard(card);
                played = true;
            }
        }

        if (!played) setPosition({ x: 0, y: 0 });
    };

    // Zoom overlay
    if (isZoomed) {
        return (
            <>
                {/* placeholder keeps hand size */}
                <div style={{ width: 'var(--card-width)', height: 'var(--card-height)' }} />
                {createPortal(
                    <div
                        className="zoom-overlay"
                        onClick={() => onZoomToggle(cardId)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0,0,0,0.6)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            zIndex: 10000,
                        }}
                    >
                        <div onClick={(e) => e.stopPropagation()}>
                            <div
                                ref={nodeRef}
                                className="card zoomed"
                                style={{
                                    width: 'var(--card-width)',
                                    height: 'var(--card-height)',
                                    transform: 'scale(3)',
                                }}
                                data-suit={card.suit}
                            >
                                <div className="card-number" data-suit={card.suit}>{card.value}</div>
                                <div className="card-image-container">
                                    <img src={imagePath} alt={`${card.value} of ${card.suit}`} className="card-image" draggable={false}/>
                                </div>
                                <div className="card-text-area">
                                    {abilityText && <div className="card-ability-text">{abilityText}</div>}
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.getElementById('zoom-root')!
                )}
            </>
        );
    }

    // Normal draggable
    return (
        // <Draggable nodeRef={nodeRef} position={position} onStop={handleStop} disabled={false}>
        <Draggable
            nodeRef={nodeRef}
            position={position}
            onStart={() => {
                if (!disabled) {
                    // Only glow if this card is playable
                    document.querySelector('.current-trick')?.classList.add('playable-glow');
                }
            }}
            onStop={(e, data) => {
                // Always remove the glow
                document.querySelector('.current-trick')?.classList.remove('playable-glow');
                handleStop(e, data); // ✅ forward the arguments to your logic
            }}
            disabled={false}
        >
            <div
                ref={nodeRef}
                className={`card ${disabled ? 'disabled' : ''}`}
                style={{ transform: `rotate(${rotation}deg)` }}
                data-suit={card.suit}
            >
                {/* <div className="card-number" data-suit={card.suit}> {card.value}</div> */}
                <div className="card-number" data-suit={card.suit}> <span>{card.value}</span></div>
                <div className="card-image-container">
                    <img src={imagePath} alt={`${card.value} of ${card.suit}`} className="card-image" draggable={false}/>
                </div>
                <div className="card-text-area">
                    {abilityText && <div className="card-ability-text">{abilityText}</div>}
                </div>
            </div>
        </Draggable>
    );
}

export function StaticHand({
    cards,
    gameState,
    username,
    isDiscardMode,
    isTrumpReplacement,
    onPlayCard,
}: {
    cards: { [key: number]: CardContext };
    gameState: GameState;
    username: string;
    isDiscardMode: boolean;
    isTrumpReplacement: boolean;
    onPlayCard: (card: CardContext) => void;
}) {
    const cardCount = Object.keys(cards).length;
    const [zoomedCard, setZoomedCard] = useState<string | null>(null);

    const handleZoomToggle = (id: string) => {
        setZoomedCard((prev) => (prev === id ? null : id));
    };

    return (
        <div className="hand-cards">
            <AnimatePresence initial={false}>
                {Object.entries(cards).map(([cardId, card], index) => {
                    const positionInHand = index / (cardCount - 1 || 1);
                    const rotation = (positionInHand - 0.5) * 15;
                    return (
                        <motion.div
                            key={cardId}
                            layout
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -50, scale: 0.7 }}
                            transition={{ duration: 0.4 }}
                        >
                            <DraggableCard
                                key={cardId}
                                cardId={cardId}
                                card={card}
                                rotation={rotation}
                                disabled={isCardDisabled(card, cards, gameState, username, isDiscardMode, isTrumpReplacement)}
                                isZoomed={zoomedCard === cardId}
                                onZoomToggle={handleZoomToggle}
                                onPlayCard={onPlayCard}
                            />
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}


export function isCardDisabled(
    card: CardContext,
    hand: { [key: number]: CardContext },
    gameState: GameState,
    username: string,
    isDiscardMode: boolean,
    isTrumpReplacement: boolean,
): boolean {
    // 1. Not this player's turn → always disabled
    if (gameState.current_player !== username) return true;
    if (isDiscardMode) return false;
    if (isTrumpReplacement) return false;

    const leadingSuit = gameState.current_trick?.led_suit;

    // Convert hand object → array
    const handArray = Object.values(hand);

    // 2. No leading suit → any card is playable
    if (!leadingSuit) return false;
    // if (!gameState.current_trick) return false;

    // 3. Does hand contain the leading suit?
    const hasLeadingSuit = handArray.some((c) => c.suit === leadingSuit);

    if (hasLeadingSuit) {
        // Must follow suit → disable if card is off-suit
        if (card.suit !== leadingSuit) return true;
    }

    // 4. Special ability: sp6
    if (gameState.current_trick?.cards.length === 1) {
        const firstCardEntry = gameState.current_trick.cards[0].card;
        // const firstCard = gameState.current_trick.cards[firstCardEntry.id];
        if (firstCardEntry.special_ability === "sp6") {
            const sameSuitCards = handArray.filter((c) => c.suit === card.suit);

            if (sameSuitCards.length > 0) {
                const highest = sameSuitCards.reduce((max, c) =>
                    c.value > max.value ? c : max
                );

                // If this card is not the highest of its suit → disable
                if (card.value !== highest.value && card.value !== 1) {
                    return true;
                }
            }
        }
    }

    // 5. Otherwise → allowed
    return false;
}