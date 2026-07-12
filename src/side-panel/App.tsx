import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExtractedTurnsMessage, Turn } from "../shared/types";
import { useRef } from "react";
import { isTurnMapMessage, requestTurnsFromActiveTab, setFloatingPanelInTab } from "../shared/messaging";
import { Icon } from "./components/Icon";
import { buildDebugReport } from "./debug-report";
import { TurnMapCanvas } from "./graph/TurnMapCanvas";
import { useI18n } from "./i18n/useI18n";
import { applyTheme, loadTheme, normalizeTheme, THEME_STORAGE_KEY } from "./settings/theme-storage";
import { applyNodeColorRendering, loadUiSettings } from "./settings/ui-settings-storage";
import { loadTurnsFromIndexedDb, saveTurnsToIndexedDb } from "./storage/turn-storage";
import {
  buildApiTaskLogExport,
  loadApiTaskLog,
  recordApiTaskLog,
  type ApiTaskKind,
  type ApiTaskLogEntry,
  type ApiTaskStatus
} from "./task-log";
import { mergeTurnUpdates, type TurnUpdateMode } from "./turn-merge";

type AppProps = {
  mode?: "side-panel" | "full-page";
};

function sourceTabIdFromUrl(): number | undefined {
  const value = new URLSearchParams(window.location.search).get("sourceTabId");
  if (!value) return undefined;
  const tabId = Number(value);
  return Number.isFinite(tabId) ? tabId : undefined;
}

function safeFilePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "turnmap";
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function canUseConversationIdForSwitch(nextConversationId: string, currentConversationId: string): boolean {
  if (!nextConversationId || nextConversationId === currentConversationId) return false;
  if (nextConversationId === "current" && currentConversationId !== "current") return false;
  return true;
}

export function App({ mode = "side-panel" }: AppProps) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState("current");
  const [conversationTitle, setConversationTitle] = useState("Current conversation");
  const [status, setStatus] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [floatingEnabled, setFloatingEnabled] = useState(false);
  const [lastMessage, setLastMessage] = useState<ExtractedTurnsMessage | null>(null);
  const [taskLog, setTaskLog] = useState<ApiTaskLogEntry[]>([]);
  const [rebuildRequest, setRebuildRequest] = useState(0);
  const [turnUpdateMode, setTurnUpdateMode] = useState<TurnUpdateMode>("refresh");
  const [sourceTabId, setSourceTabId] = useState<number | undefined>(() =>
    mode === "full-page" ? sourceTabIdFromUrl() : undefined
  );
  const turnsRef = useRef<Turn[]>([]);

  const applyTurnsMessage = useCallback((message: ExtractedTurnsMessage, mode: TurnUpdateMode = "refresh") => {
    setLastMessage(message);
    setTurnUpdateMode(mode);
    const merged = mergeTurnUpdates(turnsRef.current, message.turns, mode);
    turnsRef.current = merged.turns;
    setTurns(merged.turns);
    setConversationId(message.conversationId);
    setConversationTitle(message.conversationTitle);
    if (message.site?.id === "unsupported") {
      setStatus(t("app.status.openConversation"));
      return;
    }
    void saveTurnsToIndexedDb(message.conversationId, message.conversationTitle, merged.turns).catch(() => {
      setStatus(t("app.status.cacheFailed"));
    });
    const meta = message.harvestMeta;
    if (mode === "refresh") {
      setStatus(
        merged.added > 0
          ? t("app.status.refreshAdded", { added: merged.added, total: merged.turns.length })
          : t("app.status.refreshNoNew", { total: merged.turns.length })
      );
      return;
    }
    if (mode === "refresh-index") {
      setStatus(
        merged.added > 0
          ? t("app.status.refreshIndexAdded", {
              added: merged.added,
              total: merged.turns.length
            })
          : t("app.status.refreshIndexNoNew", { total: merged.turns.length })
      );
      return;
    }
    setStatus(
      meta
        ? t("app.status.mappedVia", { count: merged.turns.length, source: meta.source })
        : t("app.status.loadedTurns", { count: merged.turns.length })
    );
  }, [t]);

  const applyCachedConversation = useCallback(
    async (conversationIdToLoad: string): Promise<boolean> => {
      const cached = await loadTurnsFromIndexedDb(conversationIdToLoad).catch(() => null);
      if (!cached || cached.turns.length === 0) return false;

      applyTurnsMessage(
        {
          type: "TURNMAP_TURNS_UPDATED",
          turns: cached.turns,
          conversationId: cached.conversationId,
          conversationTitle: cached.conversationTitle,
          harvestMeta: {
            attempted: false,
            source: "indexeddb",
            scrollContainer: "none",
            scrollHeight: 0,
            clientHeight: 0,
            scannedSteps: 0
          }
        },
        "replace"
      );
      setStatus(t("app.status.restoredConversation", { count: cached.turns.length }));
      return true;
    },
    [applyTurnsMessage, t]
  );

  const applyConversationRead = useCallback(
    async (message: ExtractedTurnsMessage, mode: "refresh" | "refresh-index"): Promise<boolean> => {
      if (message.site?.id === "unsupported") {
        applyTurnsMessage(message, mode);
        return false;
      }

      const isSwitch = canUseConversationIdForSwitch(message.conversationId, conversationId);
      if (!isSwitch) {
        applyTurnsMessage(message, mode);
        return true;
      }

      if (await applyCachedConversation(message.conversationId)) {
        if (message.turns.length > 0) applyTurnsMessage(message, mode);
        return true;
      }

      if (mode === "refresh-index") {
        if (message.turns.length === 0) {
          setStatus(t("app.status.switchReadFailed"));
          return false;
        }
        applyTurnsMessage(message, "replace");
        setStatus(t("app.status.switchCreated", { count: message.turns.length }));
        return true;
      }

      setStatus(t("app.status.switchReadingIndex"));
      const scanned = await requestTurnsFromActiveTab({ harvest: true, tabId: sourceTabId });
      if (scanned?.type === "TURNMAP_TURNS_UPDATED" && scanned.turns.length > 0) {
        applyTurnsMessage(scanned, "replace");
        setStatus(t("app.status.switchCreated", { count: scanned.turns.length }));
        return true;
      }

      setStatus(t("app.status.switchReadFailed"));
      return false;
    },
    [applyCachedConversation, applyTurnsMessage, conversationId, sourceTabId, t]
  );

  const refreshTurns = useCallback(async () => {
    setStatus(t("app.status.reading"));
    const message = await requestTurnsFromActiveTab({ tabId: sourceTabId });
    if (message?.type === "TURNMAP_TURNS_UPDATED") {
      await applyConversationRead(message, "refresh");
    } else {
      setStatus(t("app.status.openConversation"));
    }
  }, [applyConversationRead, sourceTabId, t]);

  const rebuildMap = useCallback(async () => {
    const confirmed = window.confirm(t("app.confirm.rebuild"));
    if (!confirmed) return;

    setStatus(t("app.status.rebuilding"));
    const message = await requestTurnsFromActiveTab({ ensureFull: true, tabId: sourceTabId });
    if (message?.type === "TURNMAP_TURNS_UPDATED") {
      applyTurnsMessage(message, "replace");
      setRebuildRequest((request) => request + 1);
    } else {
      setStatus(t("app.status.rebuildFailed"));
    }
  }, [applyTurnsMessage, sourceTabId, t]);

  const refreshIndexTurns = useCallback(async () => {
    setStatus(t("app.status.refreshingIndex"));
    const message = await requestTurnsFromActiveTab({ harvest: true, tabId: sourceTabId });
    if (message?.type === "TURNMAP_TURNS_UPDATED") {
      await applyConversationRead(message, "refresh-index");
    } else {
      setStatus(t("app.status.refreshIndexFailed"));
    }
  }, [applyConversationRead, sourceTabId, t]);

  const openFullPage = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      setStatus(t("app.status.noActiveTab"));
      return;
    }
    setSourceTabId(tab.id);
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/full-page/index.html?sourceTabId=${tab.id}`)
    });
    setViewMenuOpen(false);
  }, [t]);

  const toggleFloatingPanel = useCallback(async () => {
    const nextEnabled = !floatingEnabled;
    const ok = await setFloatingPanelInTab(nextEnabled, sourceTabId);
    if (ok) {
      setFloatingEnabled(nextEnabled);
      await chrome.storage.local.set({ "turnmap.floatingPanel.enabled": nextEnabled });
      setStatus(t(nextEnabled ? "app.status.floatEnabled" : "app.status.floatDisabled"));
      setViewMenuOpen(false);
    } else {
      setStatus(t("app.status.floatFailed"));
    }
  }, [floatingEnabled, sourceTabId, t]);

  const openSettingsPage = useCallback(async () => {
    await chrome.runtime.openOptionsPage();
  }, []);

  const exportDebugReport = useCallback(async () => {
    const report = buildDebugReport({
      conversationTitle,
      conversationId,
      lastMessage,
      mode,
      sourceTabId,
      status,
      userAgent: navigator.userAgent,
      extensionVersion: chrome.runtime.getManifest().version,
      taskLog
    });
    const filename = `${safeFilePart(conversationTitle)}.turnmap-debug.md`;
    downloadTextFile(filename, report, "text/markdown;charset=utf-8");
    setStatus(t("debug.exportReportDone", { filename }));
  }, [conversationId, conversationTitle, lastMessage, mode, sourceTabId, status, taskLog, t]);

  const exportTaskLog = useCallback(() => {
    const filename = `${safeFilePart(conversationTitle)}.turnmap-task-log.json`;
    const payload = buildApiTaskLogExport(taskLog);
    downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    setStatus(t("debug.exportTaskLogDone", { filename }));
  }, [conversationTitle, taskLog, t]);

  const reportTaskStatus = useCallback(
    async (entry: {
      id: string;
      kind: ApiTaskKind;
      status: ApiTaskStatus;
      message: string;
      progress: number;
    }) => {
      setStatus(entry.message);
      const nextLog = await recordApiTaskLog(entry);
      setTaskLog(nextLog);
    },
    []
  );

  useEffect(() => {
    void chrome.storage.local.get("turnmap.floatingPanel.enabled").then((result) => {
      setFloatingEnabled(Boolean(result["turnmap.floatingPanel.enabled"]));
    });
    void loadApiTaskLog().then(setTaskLog);
    void loadUiSettings().then(applyNodeColorRendering);
  }, []);

  useEffect(() => {
    const listener = () => {
      void loadUiSettings().then(applyNodeColorRendering);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    setStatus((current) => current || t("app.status.waiting"));
  }, [t]);

  useEffect(() => {
    document.title = t(mode === "full-page" ? "app.documentTitle.fullPage" : "app.documentTitle");
  }, [mode, t]);

  useEffect(() => {
    let currentTheme = normalizeTheme(undefined);
    void loadTheme().then((theme) => {
      currentTheme = theme;
      applyTheme(theme);
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[THEME_STORAGE_KEY]) return;
      currentTheme = normalizeTheme(changes[THEME_STORAGE_KEY].newValue);
      applyTheme(currentTheme);
    };
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const mediaListener = () => {
      if (currentTheme === "browser") applyTheme(currentTheme);
    };

    chrome.storage.onChanged.addListener(listener);
    media?.addEventListener?.("change", mediaListener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      media?.removeEventListener?.("change", mediaListener);
    };
  }, []);

  useEffect(() => {
    void refreshTurns();

    const listener = (message: unknown) => {
      if (!isTurnMapMessage(message)) return;
      if (message.type === "TURNMAP_TURNS_UPDATED") {
        const turnsMessage = message as ExtractedTurnsMessage;
        if (canUseConversationIdForSwitch(turnsMessage.conversationId, conversationId)) return;
        applyTurnsMessage(turnsMessage);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyTurnsMessage, conversationId, refreshTurns]);

  const hasTurns = turns.length > 0;
  const siteName = lastMessage?.site?.displayName ?? "unknown";
  const runningTasks = useMemo(
    () =>
      taskLog
        .filter((entry) => entry.status === "running")
        .slice(0, 3),
    [taskLog]
  );
  const subtitle = useMemo(
    () => (hasTurns ? t("app.subtitle.hasTurns") : t("app.subtitle.noTurns")),
    [hasTurns, t]
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <div className="app-brand__mark" aria-hidden="true">
            <Icon name="map" size={20} />
          </div>
          <div>
            <div className="app-kicker">{t("app.kicker")}</div>
            <h1>TurnMap</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="app-actions">
          <button className="button-with-icon" type="button" onClick={refreshTurns}>
            <Icon name="refresh" />
            <span>{t("app.action.refresh")}</span>
          </button>
          <button className="button-with-icon" type="button" onClick={refreshIndexTurns}>
            <Icon name="scan" />
            <span>{t("app.action.refreshIndex")}</span>
          </button>
          <button className="button-with-icon" type="button" onClick={rebuildMap}>
            <Icon name="rebuild" />
            <span>{t("app.action.rebuild")}</span>
          </button>
          <button className="button-with-icon" type="button" onClick={openSettingsPage}>
            <Icon name="settings" />
            <span>{t("app.action.settings")}</span>
          </button>
          <button className="button-with-icon" type="button" onClick={() => setDebugOpen((open) => !open)}>
            <Icon name="bug" />
            <span>{t("app.action.debug")}</span>
          </button>
          <div className="view-menu">
            <button className="button-with-icon" type="button" onClick={() => setViewMenuOpen((open) => !open)}>
              <Icon name="view" />
              <span>{t("app.action.view")}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {viewMenuOpen ? (
              <div className="view-menu__panel">
                <button className="button-with-icon" type="button" disabled={mode === "side-panel"}>
                  <Icon name="panel" />
                  <span>{t("app.view.sidePanel")}{mode === "side-panel" ? ` 路 ${t("app.view.current")}` : ""}</span>
                </button>
                <button className="button-with-icon" type="button" onClick={openFullPage} disabled={mode === "full-page"}>
                  <Icon name="maximize" />
                  <span>{t("app.view.fullPage")}{mode === "full-page" ? ` 路 ${t("app.view.current")}` : ""}</span>
                </button>
                <button className="button-with-icon" type="button" onClick={toggleFloatingPanel}>
                  <Icon name="float" />
                  <span>{t(floatingEnabled ? "app.view.hideFloat" : "app.view.showFloat")}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className={`status-bar ${runningTasks.length > 1 ? "status-bar--stacked" : ""}`}>
        {runningTasks.length > 1 ? (
          <div className="status-bar__tasks">
            {runningTasks.map((task) => (
              <div className="status-bar__task" key={task.id}>
                <span>{task.message}</span>
                <strong>{task.progress}%</strong>
              </div>
            ))}
          </div>
        ) : (
          status
        )}
      </section>
      {debugOpen ? (
        <section className="debug-panel">
          <div className="debug-panel__grid">
            {[
              [t("debug.conversation"), conversationTitle],
              [t("debug.site"), siteName],
              [t("debug.id"), conversationId],
              [t("debug.turns"), String(turns.length)],
              [t("debug.source"), lastMessage?.harvestMeta?.source ?? "unknown"],
              [t("debug.selectorTurns"), String(lastMessage?.harvestMeta?.diagnostics?.selectorTurns ?? 0)],
              [t("debug.fallbackTurns"), String(lastMessage?.harvestMeta?.diagnostics?.fallbackTurns ?? 0)],
              [t("debug.apiTasks"), String(taskLog.length)]
            ].map(([label, value]) => (
              <div className="debug-panel__item" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="debug-panel__actions">
            <button className="button-with-icon debug-panel__button" type="button" onClick={() => void exportDebugReport()}>
              <Icon name="download" />
              <span>{t("debug.exportReport")}</span>
            </button>
            <button className="button-with-icon debug-panel__button" type="button" onClick={exportTaskLog}>
              <Icon name="download" />
              <span>{t("debug.exportTaskLog")}</span>
            </button>
          </div>
        </section>
      ) : null}

      <TurnMapCanvas
        conversationId={conversationId}
        conversationTitle={conversationTitle}
        turns={turns}
        turnUpdateMode={turnUpdateMode}
        sourceTabId={sourceTabId}
        rebuildRequest={rebuildRequest}
        onStatus={setStatus}
        onTaskStatus={reportTaskStatus}
      />
    </main>
  );
}
