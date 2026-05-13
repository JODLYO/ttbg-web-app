import type { CardContext, CardState} from "./types";

export const getSpecialAbilityText = (abilityCode?: string): string => {
    const abilityMap: Record<string, string> = {
        sp1: "Lead the next hand",
        sp2: "Replace a card in hand with trump card",
        sp3: "Draw card from deck and discard a card",
        sp4: "Extra point to whoever wins the trick",
        sp5: "If only one of this ability is played, the card counts as the trump suit",
        sp6: "Other player must play their highest card of this suit",
    };
    return abilityCode ? abilityMap[abilityCode] || "" : "";
};

export function pointsFromTricks(tricksWon: number): number {
    if (tricksWon <= 3) return 6;
    if (tricksWon <= 4) return 1;
    if (tricksWon <= 5) return 2;
    if (tricksWon <= 6) return 3;
    if (tricksWon <= 9) return 6;
    return 0;
  };

export function mapCardsToTrickCards(cards: CardState[], currentPlayer: string) {
    return cards.map((card) => ({
        card_id: card.card.id.toString(),
        player: currentPlayer,
    }));
}

export function mapCardsToTrickCardsData(cards: CardState[]) {
    return Object.fromEntries(cards.map((card) => [card.card.id.toString(), card.card]))
};

export function mapCardsContextToTrickCardsData(cards: CardContext[]) {
    return Object.fromEntries(cards.map((card) => [card.id.toString(), card]))
};