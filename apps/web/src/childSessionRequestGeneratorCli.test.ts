import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
  parseChildSessionRequestsFromText,
} from "./childSessionRequests";

function scriptPath() {
  return path.resolve(process.cwd(), "../../scripts/create-child-session-request.mjs");
}

function runGenerator(args: string[]) {
  return execFileSync("node", [scriptPath(), ...args], {
    encoding: "utf8",
  }).trimEnd();
}

describe("scripts/create-child-session-request.mjs", () => {
  it("emits a parseable child session request block from CLI flags", () => {
    const output = runGenerator([
      "--title",
      "Codex low child session",
      "--cwd",
      "/Users/example/task-deck",
      "--work-package",
      "codex-low-standby",
      "--instruction",
      "Read AGENTS.md, then wait for instructions.",
      "--file",
      "README.md",
    ]);

    expect(output.startsWith(`${CHILD_SESSION_BATCH_REQUEST_START_MARKER}\n`)).toBe(true);
    expect(output.endsWith(`\n${CHILD_SESSION_BATCH_REQUEST_END_MARKER}`)).toBe(true);

    const result = parseChildSessionRequestsFromText(output);
    expect(result.errors).toEqual([]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].sessions[0]).toMatchObject({
      title: "Codex low child session",
      agentProfileId: "codex",
      agentPermissionLevel: "read_only",
      agentReasoningEffort: "low",
      cwd: "/Users/example/task-deck",
      workPackageId: "codex-low-standby",
      filesLikelyToChange: ["README.md"],
      initialInstruction: "Read AGENTS.md, then wait for instructions.",
    });
  });

  it("preserves embedded newlines in CLI instruction text", () => {
    const initialInstruction = [
      "You are working on TaskDeck.",
      "Do not edit files.",
      "Report that you are ready.",
    ].join("\n");
    const output = runGenerator([
      "--title",
      "Codex newline child session",
      "--cwd",
      "/Users/example/task-deck",
      "--work-package",
      "codex-newline-standby",
      "--instruction",
      initialInstruction,
    ]);

    const result = parseChildSessionRequestsFromText(output);
    expect(result.errors).toEqual([]);
    expect(result.requests[0].sessions[0].initialInstruction).toBe(initialInstruction);
  });
});
