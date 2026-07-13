import type { Turn } from "../shared/types";
import { sourceAnchorMatches } from "./graph/source-anchors.ts";

export type TurnUpdateMode = "replace" | "refresh" | "refresh-index";

const EMPTY_ASSISTANT_REPLY = "No text response";

function sameTurn(left: Turn, right: Turn): boolean {
  const sameNavigationIdentity =
    Boolean(left.navigation?.navigationId) &&
    left.navigation?.site === right.navigation?.site &&
    left.navigation?.navigationId === right.navigation?.navigationId;
  return sameNavigationIdentity || left.id === right.id || sourceAnchorMatches(left.sourceAnchor, right.sourceAnchor);
}

function findTurnIndex(turns: Turn[], target: Turn): number {
  return turns.findIndex((turn) => sameTurn(turn, target));
}

function maxExistingTurnIndex(turns: Turn[]): number {
  return Math.max(-1, ...turns.map((turn) => turn.turnIndex));
}

function enrichStreamedPlaceholder(existing: Turn, incoming: Turn): Turn {
  if (
    existing.assistantText.trim() === EMPTY_ASSISTANT_REPLY &&
    incoming.assistantText.trim() !== EMPTY_ASSISTANT_REPLY
  ) {
    return incoming;
  }
  return existing;
}

function appendAfter(result: Turn[], anchor: Turn, incoming: Turn): void {
  const anchorIndex = findTurnIndex(result, anchor);
  if (anchorIndex === -1) {
    result.push(incoming);
    return;
  }
  result.splice(anchorIndex + 1, 0, incoming);
}

function insertBefore(result: Turn[], anchor: Turn, incoming: Turn): void {
  const anchorIndex = findTurnIndex(result, anchor);
  if (anchorIndex === -1) {
    result.push(incoming);
    return;
  }
  result.splice(anchorIndex, 0, incoming);
}

export function mergeTurnUpdates(
  existingTurns: Turn[],
  incomingTurns: Turn[],
  mode: TurnUpdateMode
): { turns: Turn[]; added: number } {
  if (mode === "replace" || existingTurns.length === 0) {
    return { turns: incomingTurns, added: Math.max(0, incomingTurns.length - existingTurns.length) };
  }

  const result = existingTurns.map((existing) => {
    const incoming = incomingTurns.find((candidate) => sameTurn(existing, candidate));
    return incoming ? enrichStreamedPlaceholder(existing, incoming) : existing;
  });
  let added = 0;

  if (mode === "refresh") {
    const lastMatchedIncomingIndex = incomingTurns.reduce(
      (latest, turn, index) => (findTurnIndex(existingTurns, turn) === -1 ? latest : index),
      -1
    );
    const maxExistingIndex = maxExistingTurnIndex(existingTurns);

    incomingTurns.forEach((turn, index) => {
      if (findTurnIndex(result, turn) !== -1) return;
      const looksLikeTailTurn = lastMatchedIncomingIndex === -1
        ? turn.turnIndex > maxExistingIndex
        : index > lastMatchedIncomingIndex;
      if (!looksLikeTailTurn) return;
      result.push(turn);
      added += 1;
    });

    return { turns: result, added };
  }

  incomingTurns.forEach((turn, index) => {
    if (findTurnIndex(result, turn) !== -1) return;

    const previousResultTurn = [...incomingTurns.slice(0, index)]
      .reverse()
      .find((candidate) => findTurnIndex(result, candidate) !== -1);
    const nextExisting = incomingTurns
      .slice(index + 1)
      .find((candidate) => findTurnIndex(existingTurns, candidate) !== -1);

    if (previousResultTurn) {
      appendAfter(result, previousResultTurn, turn);
    } else if (nextExisting) {
      insertBefore(result, nextExisting, turn);
    } else {
      result.push(turn);
    }
    added += 1;
  });

  return { turns: result, added };
}
