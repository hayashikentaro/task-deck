import { describe, expect, it } from "vitest";
import {
  buildCodexAppServerThreadStartParams,
  buildCodexAppServerTurnInterruptParams,
  buildCodexAppServerTurnStartParams,
  codexAppServerThreadIdFromMessage,
  isCodexAppServerAuthError,
  isRoutineCodexAppServerNotification,
  normalizeCodexAppServerModels,
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

  it("classifies noisy App Server progress notifications as routine", () => {
    expect(isRoutineCodexAppServerNotification("thread/settings/updated")).toBe(true);
    expect(isRoutineCodexAppServerNotification("turn/diff/updated")).toBe(true);
    expect(isRoutineCodexAppServerNotification("item/commandExecution/terminalInteraction")).toBe(true);
    expect(isRoutineCodexAppServerNotification("item/agentMessage/delta")).toBe(false);
    expect(isRoutineCodexAppServerNotification("error")).toBe(false);
  });

  it("keeps assistant text contiguous when routine notifications arrive between deltas", () => {
    let log = "";
    let assistantMessageOpen = false;
    const appendAssistantDelta = (delta) => {
      if (assistantMessageOpen) {
        log += delta;
        return;
      }
      assistantMessageOpen = true;
      const prefix = log && !log.endsWith("\n") ? "\n" : "";
      log += `${prefix}[Assistant]\n${delta}`;
    };
    const appendStatus = (data) => {
      assistantMessageOpen = false;
      const prefix = log && !log.endsWith("\n") ? "\n" : "";
      const suffix = data.endsWith("\n") ? "" : "\n";
      log += `${prefix}${data}${suffix}`;
    };

    appendAssistantDelta("日本");
    if (!isRoutineCodexAppServerNotification("turn/diff/updated")) {
      appendStatus("[TaskDeck] Unknown Codex App Server notification: turn/diff/updated\n");
    }
    appendAssistantDelta("語出力");

    expect(log).toBe("[Assistant]\n日本語出力");
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

  it("applies an explicit model to thread/start without inventing one", () => {
    expect(buildCodexAppServerThreadStartParams({ cwd: "/workspace/project", model: " gpt-5.5 " })).toEqual({
      cwd: "/workspace/project",
      ephemeral: true,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      model: "gpt-5.5",
    });
    expect(buildCodexAppServerThreadStartParams({ cwd: "/workspace/project" })).not.toHaveProperty("model");
  });

  it("applies model and reasoning effort to the next turn", () => {
    expect(buildCodexAppServerTurnStartParams({
      threadId: "thread-1",
      text: "Review this change.",
      model: " gpt-5.5 ",
      effort: " xhigh ",
    })).toEqual({
      threadId: "thread-1",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      input: [{ type: "text", text: "Review this change." }],
      model: "gpt-5.5",
      effort: "xhigh",
    });
  });

  it("builds App Server turn interrupt params", () => {
    expect(buildCodexAppServerTurnInterruptParams({
      threadId: " thread-1 ",
      turnId: " turn-1 ",
    })).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("normalizes the App Server model catalog", () => {
    expect(normalizeCodexAppServerModels([
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Primary model",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "xhigh", description: "Deep reasoning" },
        ],
      },
      { id: "duplicate", model: "gpt-5.5" },
    ])).toEqual([
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Primary model",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "xhigh", description: "Deep reasoning" },
        ],
      },
    ]);
  });
});
