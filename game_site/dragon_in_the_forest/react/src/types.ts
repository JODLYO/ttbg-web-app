export interface CardContext {
    id: number;
    value: number;
    suit: string;
    special_ability?: string;
}

export interface CardState {
    card: CardContext;
    player: PlayerState;
}

export interface TrickState {
    cards: CardState[];
    led_suit?: string;
    trump_suit?: string;
    leader?: string
}

export interface PlayerState {
    username: string;
    cards: CardContext[];
    tricks_won: number;
    score: number;
}

export interface GameState {
    player1: PlayerState;
    player2: PlayerState;
    current_trick: TrickState;
    previous_trick: TrickState;
    trump_card?: CardContext;
    deck?: CardContext[]
    round_over: boolean;
    game_over?: boolean;
    round_number: number;
    current_player: string;
    last_trick_winner?: string;
    waiting_for_trump_replacement?: { player: string };
    waiting_for_discard?: { player: string };
    winner?: string;
    next_trick_leader?: string
}