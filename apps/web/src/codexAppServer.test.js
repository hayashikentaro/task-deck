import { describe, expect, it } from "vitest";
import {
  codexAppServerThreadIdFromMessage,
  isCodexAppServerAuthError,
  resolveCodexAppServerTaskIdForThread,
  shouldIgnoreCodexAppServerMessageAfterAuthFailure,
  shouldSuppressCodexAppServerAuthErrorLine,
} from "@taskdeck/core/codex-app-server";

describe("Codex App Server helper contracts", () => {
  it("detects revoked and invalidated auth errors", () => {
    expect(isCodexAppServerAuthError("401 Unauthorized")).toBe(true);
    expect(isCodexAppServerAuthError("Encountered invalidated oauth token for user")).toBe(true);
    expect(isCodexAppServerAuthError({ error: { code: "token_revoked" }, status: 401 })).toBe(true);
    expect(isCodexAppServerAuthError("ordinary command output")).toBe(false);
  });

  it("suppresses repeated auth diagnostics only after auth failure is latched", () => {
    const line = "Unexpected content type: token_revoked 401 Unauthorized";

    expect(shouldSuppressCodexAppServerAuthErrorLine({ authFailureDetected: true, line })).toBe(true);
    expect(shouldSuppressCodexAppServerAuthErrorLine({ authFailureDetected: false, line })).toBe(false);
    expect(shouldSuppressCodexAppServerAuthErrorLine({ authFailureDetected: true, line: "ordinary output" })).toBe(false);
  });

  it("ignores stale App Server messages after authentication failure", () => {
    expect(shouldIgnoreCodexAppServerMessageAfterAuthFailure({ authFailureDetected: true })).toBe(true);
    expect(shouldIgnoreCodexAppServerMessageAfterAuthFailure({ authFailureDetected: false })).toBe(false);
  });

  it("extracts thread ids from App Server responses and notifications", () => {
    expect(codexAppServerThreadIdFromMessage({ params: { threadId: "thread-a" } })).toBe("thread-a");
    expect(codexAppServerThreadIdFromMessage({ params: { turn: { threadId: "thread-b" } } })).toBe("thread-b");
    expect(codexAppServerThreadIdFromMessage({ params: { thread: { id: "thread-c" } } })).toBe("thread-c");
    expect(codexAppServerThreadIdFromMessage({ result: { thread: { id: "thread-d" } } })).toBe("thread-d");
    expect(codexAppServerThreadIdFromMessage({ result: { turn: { threadId: "thread-e" } } })).toBe("thread-e");
    expect(codexAppServerThreadIdFromMessage({ method: "account/updated" })).toBe("");
  });

  it("routes known thread ids to task ids and falls back to the default task", () => {
    const taskIdByThreadId = new Map([
      ["parent-thread", "task-parent"],
      ["subagent-thread", "task-subagent"],
    ]);

    expect(resolveCodexAppServerTaskIdForThread({
      threadId: "parent-thread",
      defaultTaskId: "task-default",
      taskIdByThreadId,
    })).toBe("task-parent");
    expect(resolveCodexAppServerTaskIdForThread({
      threadId: "missing-thread",
      defaultTaskId: "task-default",
      taskIdByThreadId,
    })).toBe("task-default");
    expect(resolveCodexAppServerTaskIdForThread({
      threadId: "",
      defaultTaskId: "task-default",
      taskIdByThreadId,
    })).toBe("task-default");
  });
});
