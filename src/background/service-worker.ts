import type { FetchConversationApiMessage, FetchConversationApiResult } from "../shared/types";

type HeaderMap = Record<string, string>;

import { isBackgroundCommand } from "../shared/runtime-protocol.ts";

const BACKEND_FILTER = { urls: ["https://chatgpt.com/backend-api/*"] };
const REPLAYABLE_STANDARD_HEADERS = new Set(["accept", "accept-language", "content-type"]);
const REPLAYABLE_CHATGPT_HEADER_PREFIXES = ["oai-", "x-openai-"];

let cachedHeaders: HeaderMap | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function normalizeHeaderName(name: string): string {
  return name.toLowerCase();
}

function canReplayHeader(name: string): boolean {
  const normalized = normalizeHeaderName(name);
  return (
    REPLAYABLE_STANDARD_HEADERS.has(normalized) ||
    REPLAYABLE_CHATGPT_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function headersFromRequest(details: chrome.webRequest.OnBeforeSendHeadersDetails): HeaderMap {
  const headers: HeaderMap = {};

  for (const header of details.requestHeaders ?? []) {
    if (!header.name || typeof header.value !== "string") continue;
    if (!canReplayHeader(header.name)) continue;
    headers[normalizeHeaderName(header.name)] = header.value;
  }

  headers.accept = headers.accept ?? "application/json";
  return headers;
}

function saveHeaders(headers: HeaderMap): void {
  cachedHeaders = headers;
}

function loadHeaders(): HeaderMap {
  if (cachedHeaders) return cachedHeaders;
  return { accept: "application/json" };
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    saveHeaders(headersFromRequest(details));
    return undefined;
  },
  BACKEND_FILTER,
  ["requestHeaders", "extraHeaders"]
);

async function fetchConversationApi(
  message: FetchConversationApiMessage
): Promise<FetchConversationApiResult> {
  const headers = loadHeaders();

  try {
    const response = await fetch(
      `https://chatgpt.com/backend-api/conversation/${encodeURIComponent(message.conversationId)}`,
      {
        credentials: "include",
        headers
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: `Conversation API returned ${response.status}.`
      };
    }

    return {
      ok: true,
      status: response.status,
      root: await response.json()
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Conversation API request failed."
    };
  }
}

async function openSidePanel(tabId?: number): Promise<{ ok: boolean; reason?: string }> {
  if (!tabId) return { ok: false, reason: "No source tab was found." };
  const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
    open?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  };

  if (!sidePanel.open) {
    return { ok: false, reason: "This browser does not expose sidePanel.open." };
  }

  await sidePanel.open({ tabId });
  return { ok: true };
}

async function openSettingsPage(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Settings page could not be opened."
    };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isBackgroundCommand(message)) return false;

  if (message.type === "TURNMAP_FETCH_CONVERSATION_API") {
    fetchConversationApi(message).then(sendResponse);
    return true;
  }

  if (message.type === "TURNMAP_OPEN_SIDE_PANEL") {
    openSidePanel(sender.tab?.id).then(sendResponse).catch((error) =>
      sendResponse({
        ok: false,
        reason: error instanceof Error ? error.message : "Side panel could not be opened."
      })
    );
    return true;
  }

  if (message.type === "TURNMAP_OPEN_SETTINGS") {
    openSettingsPage().then(sendResponse);
    return true;
  }

  return false;
});
