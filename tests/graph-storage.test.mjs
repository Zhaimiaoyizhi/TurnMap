import test from "node:test";
import assert from "node:assert/strict";

import { loadStoredGraph, resetStoredGraph, saveStoredGraph } from "../src/side-panel/graph/graph-storage.ts";

const SOURCE_ANCHOR = {
  turnIndex: 1,
  userMessageId: "u-1",
  assistantMessageId: "a-1",
  userHash: "user-hash",
  assistantHash: "assistant-hash",
  userPreview: "What should the release note say?",
  assistantPreview: "Keep it short and specific."
};

function withChromeStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: store[key] };
          return {};
        },
        async set(value) {
          Object.assign(store, value);
        },
        async remove(key) {
          delete store[key];
        }
      }
    }
  };
}

test("graph storage preserves sourceAnchors for custom nodes", async () => {
  withChromeStorage();

  await saveStoredGraph(
    "conversation-1",
    [
      {
        id: "custom-note-1",
        position: { x: 10, y: 20 },
        data: {
          title: "AI note",
          summary: "Pending summary",
          isCustomNode: true,
          tags: ["AI"],
          sourceAnchors: [SOURCE_ANCHOR]
        }
      }
    ],
    []
  );

  const stored = await loadStoredGraph("conversation-1");

  assert.deepEqual(stored.customNodes?.[0]?.sourceAnchors, [SOURCE_ANCHOR]);

  await resetStoredGraph("conversation-1");
});

test("graph storage preserves sourceAnchors for turn node overrides", async () => {
  withChromeStorage();

  await saveStoredGraph(
    "conversation-2",
    [
      {
        id: "turn-old-user-hash-assistant-hash",
        position: { x: 30, y: 40 },
        data: {
          title: "Edited title",
          summary: "Edited summary",
          turn: {
            id: "turn-old-user-hash-assistant-hash",
            turnIndex: 1,
            userText: "What should the release note say?",
            assistantText: "Keep it short and specific.",
            extractedAt: 1,
            sourceAnchor: SOURCE_ANCHOR
          }
        }
      }
    ],
    []
  );

  const stored = await loadStoredGraph("conversation-2");

  assert.deepEqual(stored.nodeOverrides["turn-old-user-hash-assistant-hash"].sourceAnchors, [SOURCE_ANCHOR]);

  await resetStoredGraph("conversation-2");
});

test("graph storage does not freeze generated turn text as a manual override", async () => {
  withChromeStorage();
  const pendingTurn = {
    id: "turn-streaming",
    turnIndex: 0,
    userText: "Reply exactly: TurnMap QA 1",
    assistantText: "No text response",
    extractedAt: 1,
    sourceAnchor: { ...SOURCE_ANCHOR, turnIndex: 0 }
  };

  await saveStoredGraph(
    "conversation-streaming",
    [
      {
        id: pendingTurn.id,
        position: { x: 0, y: 0 },
        data: {
          title: "Reply exactly: TurnMap QA 1",
          summary: "No text response",
          turn: pendingTurn
        }
      }
    ],
    []
  );

  const stored = await loadStoredGraph("conversation-streaming");

  assert.equal(stored.nodeOverrides[pendingTurn.id].title, undefined);
  assert.equal(stored.nodeOverrides[pendingTurn.id].summary, undefined);

  await resetStoredGraph("conversation-streaming");
});

test("graph storage saves schema v4 dimensions and answer expansion data", async () => {
  withChromeStorage();

  const answerExpansion = {
    schemaVersion: 2,
    displayMode: "expanded",
    layoutDirection: "right",
    inputSource: "assistant",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    nodes: [
      { id: "m-1", title: "Main point", role: "branch", parentId: undefined, branchId: "m-1", color: "blue" },
      { id: "m-2", title: "Supporting point", role: "point", parentId: "m-1", branchId: "m-1", color: "blue", important: true }
    ],
    links: [{ id: "l-1", source: "m-1", target: "m-2", relationship: "subpoint", weight: 0.85 }]
  };

  await saveStoredGraph(
    "conversation-3",
    [
      {
        id: "turn-1",
        position: { x: 30, y: 40 },
        data: {
          title: "Edited title",
          summary: "Edited summary",
          dimensions: { width: 420, height: 260, manual: true },
          answerExpansion
        }
      }
    ],
    []
  );

  const stored = await loadStoredGraph("conversation-3");

  assert.equal(stored.schemaVersion, 4);
  assert.deepEqual(stored.nodeOverrides["turn-1"].dimensions, { width: 420, height: 260, manual: true });
  assert.deepEqual(stored.nodeOverrides["turn-1"].answerExpansion, answerExpansion);

  await resetStoredGraph("conversation-3");
});

test("graph storage preserves topic group records", async () => {
  withChromeStorage();

  const topicGroups = [
    {
      id: "topic-group-1",
      topicNodeId: "topic-node-1",
      title: "Topic: release",
      memberNodeIds: ["turn-1", "turn-2"],
      nodeSnapshots: [
        { id: "turn-1", title: "First", summary: "First answer", position: { x: 0, y: 0 } },
        { id: "turn-2", title: "Second", summary: "Second answer", position: { x: 280, y: 0 } }
      ],
      edgeSnapshots: [
        { id: "sequence-turn-1-turn-2", source: "turn-1", target: "turn-2", isAuto: true }
      ],
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    }
  ];

  await saveStoredGraph(
    "conversation-4",
    [
      {
        id: "topic-node-1",
        position: { x: 120, y: 80 },
        data: {
          title: "Topic: release",
          summary: "Collapsed topic",
          isCustomNode: true,
          topicGroupId: "topic-group-1",
          topicGroupMemberIds: ["turn-1", "turn-2"]
        }
      }
    ],
    [],
    "single",
    false,
    [],
    ["turn-1", "turn-2"],
    topicGroups
  );

  const stored = await loadStoredGraph("conversation-4");

  assert.deepEqual(stored.topicGroups, topicGroups);
  assert.equal(stored.customNodes?.[0]?.topicGroupId, "topic-group-1");
  assert.deepEqual(stored.customNodes?.[0]?.topicGroupMemberIds, ["turn-1", "turn-2"]);

  await resetStoredGraph("conversation-4");
});
