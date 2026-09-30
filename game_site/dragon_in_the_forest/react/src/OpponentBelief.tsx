// "What can the side to move tell about the other hand?" -- the bot's own read, as a
// suit-by-value grid. Before the bot has analyzed the position this is the certain-facts
// belief (`priorMarginals`): cards the other player is known to hold (the old trump a Fox
// handed them) are certain, cards their plays rule out (a suit they didn't follow, cards
// above their answer to a led Monarch) are impossible, and the rest of their hand is spread
// evenly over everything else unseen. Once an analysis arrives it shows the bot's inferred
// belief instead (`probabilities`, the analysis's `opponentCards`): the same facts, plus
// what the other player's plays suggest -- each hand weighted by how likely those plays
// would have been with it. Either way it's worked out from a scrubbed state and history, so
// it can't use anything the mover couldn't know; the analysis board separately outlines
// the cards the other player really holds, since you can see both hands.

import {
  NUM_VALUES,
  SUITS,
  excludedCards,
  knownHeld,
  priorMarginals,
  unseenCards,
  type GameState as EngineState,
} from "dragon-forest-bot-web";
import { cardName, hideFrom, possessive } from "./localGame";

const VALUES = Array.from({ length: NUM_VALUES }, (_, i) => i + 1);
const cardId = (suitIndex: number, value: number) => suitIndex * NUM_VALUES + value - 1;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  state: EngineState;
  /** The bot's inferred belief for this position (`PositionAnalysis.opponentCards`); null
   * until an analysis of it arrives. */
  probabilities?: { card: number; probability: number }[] | null;
  /** Whose point of view: the side to move. */
  viewer: number;
  viewerName: string;
  otherName: string;
  /** Outline the cards the other player really holds (off when you're playing against them). */
  revealActual?: boolean;
}

export default function OpponentBelief({
  state,
  probabilities,
  viewer,
  viewerName,
  otherName,
  revealActual = true,
}: Props) {
  const other = 1 - viewer;
  const view = hideFrom(state, viewer);
  const unseen = new Set(unseenCards(view, viewer));
  const inferred = probabilities != null;
  // "You" in one-side mode: "as you see it", not "as You sees it".
  const you = viewerName === "You";
  const viewerLabel = you ? "you" : viewerName;
  const marginals = priorMarginals(view, viewer);
  if (inferred) {
    marginals.fill(0);
    for (const { card, probability } of probabilities) marginals[card] = probability;
  }
  const known = knownHeld(view, other);
  const excluded = excludedCards(view, other);
  const actual = new Set(revealActual ? state.hands[other] : []);
  const share = [...unseen].find((c) => !known.has(c) && !excluded.has(c));

  return (
    <section className="bot-card">
      <h3>
        {possessive(otherName)} hand, as {viewerLabel} {you ? "see" : "sees"} it
      </h3>
      <p className="bot-muted">
        The chance of each card being in {otherName}&apos;s hand, from what {viewerLabel} can
        know{inferred ? <> and how {otherName} has played so far</> : null}. This is the
        belief the bot searches with.
        {!inferred && <> (Certain facts only until the analysis arrives.)</>}
      </p>
      <table className="belief-grid">
        <thead>
          <tr>
            <th />
            {VALUES.map((v) => (
              <th key={v}>{v}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SUITS.map((suit, suitIndex) => (
            <tr key={suit}>
              <th>
                <span className={`suit-dot ${suit}`} title={capitalize(suit)} />
              </th>
              {VALUES.map((value) => {
                const id = cardId(suitIndex, value);
                const holds = actual.has(id) ? " held" : "";
                if (!unseen.has(id)) {
                  return (
                    <td
                      key={value}
                      className={`belief-cell accounted${holds}`}
                      title={`${cardName(id)}: accounted for (in ${you ? "your" : `${viewerName}'s`} hand, played, the trump card, or discarded by ${viewerLabel})`}
                    >
                      &middot;
                    </td>
                  );
                }
                const p = marginals[id];
                const reason = known.has(id)
                  ? `${otherName} took it with a Fox`
                  : excluded.has(id)
                    ? `ruled out by ${otherName}'s plays`
                    : "unseen";
                return (
                  <td
                    key={value}
                    className={`belief-cell${known.has(id) ? " certain" : ""}${excluded.has(id) ? " ruled-out" : ""}${holds}`}
                    style={{ ["--p" as string]: p }}
                    title={`${cardName(id)}: ${Math.round(p * 100)}% (${reason})${actual.has(id) ? ` - ${otherName} does hold it` : ""}`}
                  >
                    {Math.round(p * 100)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bot-muted">
        Percentages.{" "}
        {!inferred && share !== undefined && (
          <>Every other unseen card: {Math.round(marginals[share] * 100)}%. </>
        )}
        {known.size > 0 && <>100 = taken with a Fox. </>}
        {excluded.size > 0 && <>0 = ruled out by {otherName}&apos;s plays (a suit not followed, or a Monarch answer). </>}
        &middot; = accounted for.
        {revealActual && <> Outlined = what {otherName} really holds (hidden from the bot).</>}
      </p>
      <p className="bot-muted">{state.deck.length} cards in the deck.</p>
    </section>
  );
}
