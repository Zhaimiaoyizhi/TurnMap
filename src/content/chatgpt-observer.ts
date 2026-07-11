import type { ExtractedTurnsMessage, Turn } from "../shared/types";
import {
  attachOphelNavigationToTurns,
  extractChatGptOphelNavigationTurns,
  mergeOphelNavigationTurns
} from "./chatgpt-ophel-navigation";
import { extractConversationApiTurns } from "./conversation-api-extractor";
import { extractStructuredTurns } from "./structured-extractor";
import { extractTurns, mergeTurns, normalizeTurnIndexes } from "./turn-extractor";

type TurnsListener = (turns: Turn[]) => void;

type HarvestMeta = NonNullable<ExtractedTurnsMessage["harvestMeta"]>;

let latestTurns: Turn[] = [];
let observer: MutationObserver | null = null;
let debounceTimer: number | null = null;
let lastHarvestMeta: HarvestMeta | undefined;
let latestTurnsConversationId = "";

function isFullConversationSource(source: HarvestMeta["source"]): boolean {
  return (
    source === "conversation-api" ||
    source === "structured" ||
    source === "web-storage" ||
    source === "indexeddb"
  );
}

function shouldReplaceLatestTurns(source: HarvestMeta["source"]): boolean {
  return isFullConversationSource(source) || source === "native-navigation";
}

function emitTurns(listener: TurnsListener): void {
  const conversationId = resetLatestTurnsForConversation();
  void getNonDisruptiveTurns().then((turns) => {
    if (conversationId !== getConversationId()) return;
    latestTurns = lastHarvestMeta && shouldReplaceLatestTurns(lastHarvestMeta.source)
      ? turns
      : mergeTurns(latestTurns, turns);
    listener(latestTurns);
  });
}

export function getConversationTitle(): string {
  const title = document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  return title || "Current conversation";
}

export function getConversationId(): string {
  const match = window.location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? window.location.href;
}

function resetLatestTurnsForConversation(): string {
  const conversationId = getConversationId();
  if (conversationId === latestTurnsConversationId) return conversationId;
  latestTurnsConversationId = conversationId;
  latestTurns = [];
  lastHarvestMeta = undefined;
  return conversationId;
}

function setSourceMeta(source: HarvestMeta["source"], turns: Turn[]): void {
  lastHarvestMeta = {
    attempted: source !== "dom",
    source,
    scrollContainer: "none",
    scrollHeight: 0,
    clientHeight: 0,
    scannedSteps: 0
  };

  if (source === "dom" && turns.length === 0) {
    lastHarvestMeta = undefined;
  }
}

function applyOphelNavigationIndex(turns: Turn[]): { turns: Turn[]; source: HarvestMeta["source"] | null } {
  const navigableTurns = attachOphelNavigationToTurns(turns);
  const nativeTurns = extractChatGptOphelNavigationTurns();
  if (nativeTurns.length === 0) return { turns: navigableTurns, source: null };

  const merged = mergeOphelNavigationTurns(navigableTurns, nativeTurns);
  return {
    turns: merged,
    source: turns.length === 0 || merged.length > turns.length ? "native-navigation" : null
  };
}

async function getNonDisruptiveTurns(): Promise<Turn[]> {
  const conversationApiResult = await extractConversationApiTurns();
  if (conversationApiResult && conversationApiResult.turns.length > 0) {
    const navigated = applyOphelNavigationIndex(conversationApiResult.turns);
    setSourceMeta(navigated.source ?? conversationApiResult.source, navigated.turns);
    return navigated.turns;
  }

  const structuredResult = await extractStructuredTurns();
  if (structuredResult && structuredResult.turns.length > 0) {
    const navigated = applyOphelNavigationIndex(structuredResult.turns);
    setSourceMeta(navigated.source ?? structuredResult.source, navigated.turns);
    return navigated.turns;
  }

  const nativeOnly = applyOphelNavigationIndex([]);
  if (nativeOnly.turns.length > 0) {
    setSourceMeta("native-navigation", nativeOnly.turns);
    return nativeOnly.turns;
  }

  const domTurns = attachOphelNavigationToTurns(normalizeTurnIndexes(extractTurns()));
  setSourceMeta("dom", domTurns);
  return domTurns;
}

export async function harvestTurnsByScrolling(): Promise<Turn[]> {
  latestTurns = await refreshLatestTurns();
  lastHarvestMeta = {
    attempted: true,
    source: lastHarvestMeta?.source ?? "native-navigation",
    scrollContainer: "none",
    scrollHeight: 0,
    clientHeight: 0,
    scannedSteps: 0
  };
  return latestTurns;
}

export function getLatestTurns(): Turn[] {
  resetLatestTurnsForConversation();
  if (latestTurns.length === 0) {
    latestTurns = attachOphelNavigationToTurns(normalizeTurnIndexes(extractTurns()));
  }
  return latestTurns;
}

export async function refreshLatestTurns(): Promise<Turn[]> {
  const conversationId = resetLatestTurnsForConversation();
  const turns = await getNonDisruptiveTurns();
  if (conversationId !== getConversationId()) return refreshLatestTurns();
  latestTurns = lastHarvestMeta && shouldReplaceLatestTurns(lastHarvestMeta.source)
    ? turns
    : mergeTurns(latestTurns, turns);
  return latestTurns;
}

export async function refreshCompleteTurns(): Promise<Turn[]> {
  const turns = await refreshLatestTurns();
  if (lastHarvestMeta && isFullConversationSource(lastHarvestMeta.source)) {
    return turns;
  }

  return turns;
}

export function startChatGptObserver(listener: TurnsListener): void {
  if (observer) return;

  const schedule = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => emitTurns(listener), 350);
  };

  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  emitTurns(listener);
}

export function toTurnsMessage(turns: Turn[]): ExtractedTurnsMessage {
  return {
    type: "TURNMAP_TURNS_UPDATED",
    turns,
    conversationTitle: getConversationTitle(),
    conversationId: getConversationId(),
    harvestMeta: lastHarvestMeta
  };
}
