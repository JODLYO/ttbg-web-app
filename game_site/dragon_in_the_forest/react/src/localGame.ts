// Glue between the bot package's engine (`dragon-forest-bot-web`, plain ids and 0/1
// seats) and the existing board UI, which was written against the live server's game-state
// JSON (usernames, CardContext objects). `toUiGameState` renders an engine state in that
// shape so the vs-computer and analysis boards can reuse the live board's components as is.

import {
  ALL_CARD_IDS,
  abilityOf,
  cloneState,
  suitOf,
  pointsForTricks,
  valueOf,
  type ActionEvaluation,
  type GameState as EngineState,
  type RecordedDecision,
  type PositionAnalysis,
} from "dragon-forest-bot-web";
import type { CardContext, CardState, GameState as UiGameState, PlayerState } from "./types";

const ABILITY_NAMES: Record<string, string> = {
  sp1: "Swan",
  sp2: "Fox",
  sp3: "Woodcutter",
  sp4: "Treasure",
  sp5: "Witch",
  sp6: "Monarch",
};

export function cardContext(id: number): CardContext {
  const ability = abilityOf(id);
  return {
    id,
    value: valueOf(id),
    suit: suitOf(id),
    special_ability: ability ?? undefined,
  };
}

export const ALL_CARDS: readonly CardContext[] = ALL_CARD_IDS.map(cardContext);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Fire 7 (Treasure)" */
export function cardName(id: number): string {
  const ability = abilityOf(id);
  const base = `${capitalize(suitOf(id))} ${valueOf(id)}`;
  return ability ? `${base} (${ABILITY_NAMES[ability]})` : base;
}

/** A copy of `state` with everything the player at `me` shouldn't know blanked out: the
 * other hand, the deck's contents, and which cards the other player put under the deck with
 * a Woodcutter (face down). The bot's search never reads them (it works from its own hand
 * plus the public record), so handing it a scrubbed state makes "no peeking" structural
 * rather than a promise. Hand and deck *sizes*, and who discarded how many, are public and
 * kept -- as are cards publicly known to be in a hand (the decree card a Fox took). */
export function hideFrom(state: EngineState, me: number): EngineState {
  const copy = cloneState(state);
  copy.hands[1 - me] = copy.hands[1 - me].map(() => -1);
  copy.deck = copy.deck.map(() => -1);
  copy.knownBottomOfDeck = copy.knownBottomOfDeck.map(([owner, card]) => [
    owner,
    owner === me ? card : -1,
  ]);
  return copy;
}

/** One decision of the current round as it happened: the state just before it (a full copy),
 * who made it, and the card. The boards keep these so the bot can read the opponent's plays
 * for clues to their hand (its belief inference). */
export interface RoundDecision {
  before: EngineState;
  player: number;
  action: number;
}

/** The round's decisions as the bot on `viewer`'s side may see them: every recorded state
 * scrubbed with `hideFrom`, so the other hand and face-down discards never reach it. */
export function roundHistory(decisions: readonly RoundDecision[], viewer: number): RecordedDecision[] {
  return decisions.map(({ before, player, action }) => ({
    state: hideFrom(before, viewer),
    player,
    action,
  }));
}

export interface UiOptions {
  /** Display names for seat 0 and seat 1. */
  names: [string, string];
  /** Seats whose hands the UI may see (the rest render as empty). */
  revealSeats: number[];
}

/** The engine state in the live server's JSON shape. */
export function toUiGameState(state: EngineState, { names, revealSeats }: UiOptions): UiGameState {
  const seatName = (seat: number) => names[seat];
  const trickCards = (cards: [number, number][]): CardState[] =>
    cards.map(([player, id]) => ({ card: cardContext(id), player: seatName(player) }));

  const players = [0, 1].map(
    (seat): PlayerState => ({
      username: seatName(seat),
      cards: revealSeats.includes(seat) ? state.hands[seat].map(cardContext) : [],
      tricks_won: state.tricksWon[seat],
      score: state.score[seat],
      round_start_score: state.roundStartScore[seat],
      last_round_score: state.lastRoundScore[seat],
    }),
  );

  const trumpSuit = suitOf(state.trumpCard);
  // The engine only keeps the current trick; the trick that just finished is the last two
  // entries of the round's played-card log (what the board briefly flashes after a trick).
  const previousCards =
    state.currentTrick.length === 0 ? state.playedCards.slice(-2) : [];

  return {
    player1: players[0],
    player2: players[1],
    current_trick: {
      cards: trickCards(state.currentTrick),
      led_suit: state.ledSuit ?? undefined,
      trump_suit: trumpSuit,
    },
    previous_trick: { cards: trickCards(previousCards), trump_suit: trumpSuit },
    trump_card: cardContext(state.trumpCard),
    deck: [],
    round_over: state.roundOver,
    game_over: state.gameOver,
    round_number: state.roundNumber,
    current_player: seatName(state.currentPlayer),
    last_trick_winner:
      state.lastTrickWinner === null ? undefined : seatName(state.lastTrickWinner),
    waiting_for_trump_replacement: state.waitingForTrumpReplacement
      ? { player: seatName(state.waitingForTrumpReplacement[0]) }
      : undefined,
    waiting_for_discard: state.waitingForDiscard
      ? { player: seatName(state.waitingForDiscard[0]) }
      : undefined,
    winner:
      state.winner === null ? undefined : state.winner === "tie" ? "tie" : seatName(state.winner),
  };
}

/** Points a side scored in the round that just ended (or the current round so far). */
export function roundPoints(state: EngineState, seat: number): number {
  return state.score[seat] - state.roundStartScore[seat];
}

/** "+1.5" / "-0.3" / "0.0" */
export function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Where a trick count sits in the scoring table (0-3: 6, 4: 1, 5: 2, 6: 3, 7-9: 6, 10+: 0),
 * phrased as what the next trick would do -- the usual reason behind a surprising play. */
/** `name`'s form of a verb: "You have" but "Player 1 has". */
export function verbFor(name: string, singular: string, plural: string): string {
  return name === "You" ? plural : singular;
}

/** "Your" or "Player 1's". */
export function possessive(name: string): string {
  return name === "You" ? "Your" : `${name}'s`;
}

export function roundGoalText(name: string, tricks: number): string {
  const has = `${name} ${verbFor(name, "has", "have")} ${tricks} trick${tricks === 1 ? "" : "s"}`;
  if (tricks <= 2) return `${has}: finishing with 3 or fewer scores 6.`;
  if (tricks === 3) return `${has}: one more drops the round from 6 points to 1.`;
  if (tricks <= 6) {
    return `${has} (${pointsForTricks(tricks)} point${tricks === 4 ? "" : "s"} so far): reaching 7 scores 6.`;
  }
  if (tricks <= 9) return `${has} (6 points): a 10th trick drops the round to 0.`;
  return `${has}: 10 or more scores 0.`;
}

function cardEffectText(state: EngineState, player: number, card: number): string | null {
  const leading = state.currentTrick.length === 0;
  const isTrump = suitOf(card) === suitOf(state.trumpCard);
  const trumpsLeft = state.hands[player].filter((c) => suitOf(c) === suitOf(state.trumpCard)).length;
  const trumpNote = isTrump
    ? trumpsLeft === 1
      ? " It's the last trump in hand."
      : " It's a trump."
    : "";
  switch (abilityOf(card)) {
    case "sp1":
      return `Swan: if it loses the trick, its player still leads the next one.${trumpNote}`;
    case "sp2":
      return `Fox: afterwards its player may swap a card from hand with the trump card.${trumpNote}`;
    case "sp3":
      return `Woodcutter: its player draws a card, then puts one on the bottom of the deck.${trumpNote}`;
    case "sp4":
      return `Treasure: whoever wins this trick gets +1 point.${trumpNote}`;
    case "sp5":
      return `Witch: counts as trump unless both cards in the trick are 9s.${trumpNote}`;
    case "sp6":
      return leading
        ? `Monarch: the reply must be the 1 or the highest card of this suit, if they hold the suit.${trumpNote}`
        : `Monarch: its forcing effect only applies when it's led.${trumpNote}`;
    default:
      return trumpNote ? trumpNote.trim() : null;
  }
}

/** Plain-language reasons for one of the bot's candidate moves: what it does to the current
 * trick (and whether that looks like going for the trick or ducking it, compared with the
 * alternatives), what the card's ability does, where the round's scoring stands, and how
 * the bot's own value estimate compares with its best option. Everything is read off the
 * game state and the search's numbers -- it describes what the move tends to lead to, not
 * the value network's internals. `state` is the position *before* the move. */
export function explainMove(
  state: EngineState,
  analysis: PositionAnalysis,
  entry: ActionEvaluation,
  name: string,
): string[] {
  const lines: string[] = [];
  const player = analysis.player;
  const describe = (action: number) =>
    analysis.kind === "play"
      ? cardName(action)
      : analysis.kind === "discard"
        ? `discarding ${cardName(action)}`
        : action === state.trumpCard
          ? "keeping the trump"
          : `swapping ${cardName(action)}`;

  // The current trick.
  const p = entry.trickWinProbability;
  const opponentAlreadyPlayed = state.currentTrick.some(([pl]) => pl !== player);
  if (opponentAlreadyPlayed && (p === 0 || p === 1)) {
    lines.push(p === 1 ? "Wins the current trick." : "Loses the current trick.");
  } else {
    lines.push(
      p >= 0.97
        ? "Almost always wins the current trick."
        : p <= 0.03
          ? "Almost never wins the current trick."
          : `Wins the current trick about ${pct(p)} of the time.`,
    );
  }

  // Going for it or ducking, relative to the other options.
  if (analysis.actions.length > 1) {
    const all = analysis.actions.map((a) => a.trickWinProbability);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (hi - lo >= 0.3) {
      if (p <= lo + 0.1) lines.push("That's among the least likely options to win it: ducking this trick.");
      else if (p >= hi - 0.1) lines.push("That's among the likeliest options to win it: going for this trick.");
    }
  }

  // What the move itself does.
  if (analysis.kind === "play") {
    const effect = cardEffectText(state, player, entry.action);
    if (effect) lines.push(effect);
  } else if (analysis.kind === "replace_trump") {
    lines.push(
      entry.action === state.trumpCard
        ? `Keeps ${cardName(state.trumpCard)} as the trump card.`
        : `Makes ${capitalize(suitOf(entry.action))} the trump suit and takes ${cardName(state.trumpCard)} into hand.`,
    );
  } else {
    lines.push(`${cardName(entry.action)} goes to the bottom of the deck and won't be drawn again this round.`);
  }

  // Scoring context.
  lines.push(roundGoalText(name, state.tricksWon[player]));

  // The bot's own value comparison.
  const valued = analysis.actions.filter((a) => a.value !== null);
  if (entry.value !== null && valued.length > 1) {
    const best = valued.reduce((a, b) => (b.value! > a.value! ? b : a));
    if (best.action === entry.action) {
      lines.push(`Best expected margin of the options (${formatSigned(entry.value)}).`);
    } else {
      const diff = best.value! - entry.value;
      lines.push(
        diff < 0.15
          ? `Expected margin ${formatSigned(entry.value)}: about as good as the best option, ${describe(best.action)}.`
          : `Expected margin ${formatSigned(entry.value)}: ${diff.toFixed(1)} below ${describe(best.action)} (${formatSigned(best.value!)}).`,
      );
    }
  }
  return lines;
}
