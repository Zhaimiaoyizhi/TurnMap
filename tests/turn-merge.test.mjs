import assert from "node:assert/strict";
import test from "node:test";

import { mergeTurnUpdates } from "../src/side-panel/turn-merge.ts";

function turn(id, index, assistantText = `assistant ${index}`) {
  return {
    id,
    turnIndex: index,
    userText: `user ${index}`,
    assistantText,
    extractedAt: 1,
    sourceAnchor: {
      turnIndex: index,
      userHash: `u${index}`,
      assistantHash: `a${index}`,
      userPreview: `user ${index}`,
      assistantPreview: assistantText
    }
  };
}

test("refresh appends only tail turns and preserves existing turn objects", () => {
  const first = turn("turn-1", 0, "old text");
  const second = turn("turn-2", 1);
  const changedFirst = turn("turn-1", 0, "new scan should not overwrite");
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, second], [changedFirst, second, third], "refresh");

  assert.equal(result.added, 1);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[0].assistantText, "old text");
});

test("refresh enriches a streamed placeholder when the same identity later has an answer", () => {
  const pending = turn("turn-2", 1, "No text response");
  const completed = turn("turn-2", 1, "TurnMap QA 1");

  const result = mergeTurnUpdates([pending], [completed], "refresh");

  assert.equal(result.added, 0);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].assistantText, "TurnMap QA 1");
  assert.equal(result.turns[0], completed);
});

test("refresh matches a remounted web turn by stable navigation identity", () => {
  const mounted = turn("turn-uid-user-0-old", 0, "No text response");
  mounted.sourceAnchor.userMessageId = "user-0-old";
  mounted.navigation = {
    kind: "ophel_notSourceAnchor",
    site: "deepseek",
    navigationId: "deepseek-mounted-user:question-hash:0",
    identitySource: "mounted-dom-id",
    messageId: "user-0-old",
    textHash: "question-hash"
  };
  const remounted = turn("turn-uid-user-12-new", 8, "Completed DeepSeek answer");
  remounted.sourceAnchor.userMessageId = "user-12-new";
  remounted.sourceAnchor.assistantHash = "completed-answer-hash";
  remounted.navigation = {
    ...mounted.navigation,
    messageId: "user-12-new",
    turnIndex: 8
  };

  const result = mergeTurnUpdates([mounted], [remounted], "refresh");

  assert.equal(result.added, 0);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0], remounted);
});

test("refresh index enriches a streamed placeholder without replacing completed neighbors", () => {
  const first = turn("turn-1", 0, "keep this answer");
  const pending = turn("turn-2", 1, "No text response");
  const changedFirst = turn("turn-1", 0, "do not overwrite");
  const completed = turn("turn-2", 1, "TurnMap QA 1");

  const result = mergeTurnUpdates([first, pending], [changedFirst, completed], "refresh-index");

  assert.equal(result.added, 0);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[1], completed);
});

test("refresh ignores missing middle turns", () => {
  const first = turn("turn-1", 0);
  const third = turn("turn-3", 2);
  const second = turn("turn-2", 1);

  const result = mergeTurnUpdates([first, third], [first, second, third], "refresh");

  assert.equal(result.added, 0);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-3"]);
});

test("refresh index inserts missing middle turns without replacing existing text", () => {
  const first = turn("turn-1", 0, "old text");
  const fourth = turn("turn-4", 3);
  const changedFirst = turn("turn-1", 0, "new scan should not overwrite");
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, fourth], [changedFirst, second, third, fourth], "refresh-index");

  assert.equal(result.added, 2);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3", "turn-4"]);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[0].assistantText, "old text");
});

test("refresh index preserves old turns that are absent from the mounted refresh", () => {
  const first = turn("turn-1", 0);
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, third], [first, second], "refresh-index");

  assert.equal(result.added, 1);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
});
