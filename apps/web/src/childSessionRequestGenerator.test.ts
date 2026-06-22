import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
  parseChildSessionRequestsFromText,
} from "./childSessionRequests";
import { createChildSessionBatchRequestBlock, type ChildSessionBatchRequestDraft } from "./childSessionRequestGenerator";

const draft: ChildSessionBatchRequestDraft = {
  reason: "Split protocol generator testing into a child session.",
  sessions: [
    {
      title: "Generator test child",
      agentProfileId: "codex-app-server",
      cwd: "/Users/example/task-deck",
      workPackageId: "generator-test",
      filesLikelyToChange: ["apps/web/src/childSessionRequestGenerator.ts"],
      initialInstruction: "Read AGENTS.md, then run generator tests.",
    },
  ],
};

function jsonBodyFor(block: string) {
  const lines = block.split("\n");
  expect(lines[0]).toBe(CHILD_SESSION_BATCH_REQUEST_START_MARKER);
  expect(lines.at(-1)).toBe(CHILD_SESSION_BATCH_REQUEST_END_MARKER);
  return lines.slice(1, -1).join("\n");
}

describe("createChildSessionBatchRequestBlock", () => {
  it("generates a complete marker block", () => {
    const block = createChildSessionBatchRequestBlock(draft);

    expect(block.startsWith(`${CHILD_SESSION_BATCH_REQUEST_START_MARKER}\n`)).toBe(true);
    expect(block.endsWith(`\n${CHILD_SESSION_BATCH_REQUEST_END_MARKER}`)).toBe(true);
  });

  it("generates parseable JSON between markers", () => {
    const parsed = JSON.parse(jsonBodyFor(createChildSessionBatchRequestBlock(draft)));

    expect(parsed).toMatchObject({
      version: 1,
      reason: draft.reason,
    });
    expect(parsed.sessions).toHaveLength(1);
  });

  it("serializes embedded newlines in initialInstruction as valid JSON", () => {
    const initialInstruction = [
      "You are working on TaskDeck.",
      "Do not edit files.",
      "Report status and stop.",
    ].join("\n");
    const block = createChildSessionBatchRequestBlock({
      ...draft,
      sessions: [{ ...draft.sessions[0], initialInstruction }],
    });

    const parsed = JSON.parse(jsonBodyFor(block));
    expect(parsed.sessions[0].initialInstruction).toBe(initialInstruction);
  });

  it("generates output accepted by the existing parser", () => {
    const result = parseChildSessionRequestsFromText(createChildSessionBatchRequestBlock(draft));

    expect(result.errors).toEqual([]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].sessions[0]).toMatchObject({
      title: "Generator test child",
      agentProfileId: "codex-app-server",
      cwd: "/Users/example/task-deck",
      workPackageId: "generator-test",
      filesLikelyToChange: ["apps/web/src/childSessionRequestGenerator.ts"],
      initialInstruction: "Read AGENTS.md, then run generator tests.",
    });
  });
});
