import { describe, expect, it } from "vitest";
import {
  TASKDECK_DYNAMIC_DECISION_TOOL_NAME,
  TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE,
  buildCodexAppServerDynamicToolCallResponse,
  buildCodexAppServerThreadStartParams,
  buildCodexAppServerTurnInterruptParams,
  buildCodexAppServerTurnStartParams,
  CodexAppServerAuthFailureReason,
  CodexAppServerInputRejectReason,
  codexAppServerAuthFailureReason,
  codexAppServerDynamicToolCallDedupeKey,
  codexAppServerThreadIdFromMessage,
  getOrCreateCodexAppServerDynamicToolCallEntry,
  isCodexAppServerAuthError,
  isTaskDeckDynamicDecisionToolCall,
  isTaskDeckDynamicDecisionToolEnabledFromEnv,
  isRoutineCodexAppServerNotification,
  normalizeCodexAppServerModels,
  resolveCodexAppServerTaskIdForThread,
  shouldIgnoreCodexAppServerMessageAfterAuthFailure,
  shouldSuppressCodexAppServerAuthErrorLine,
  taskDeckDynamicDecisionTool,
  taskDeckDynamicDecisionTools,
} from "@taskdeck/core/codex-app-server";

describe("Codex App Server helper contracts", () => {
  it("detects revoked and invalidated auth errors", () => {
    expect(isCodexAppServerAuthError("401 Unauthorized")).toBe(true);
    expect(isCodexAppServerAuthError("Encountered invalidated oauth token for user")).toBe(true);
    expect(isCodexAppServerAuthError({ error: { code: "token_revoked" }, status: 401 })).toBe(true);
    expect(isCodexAppServerAuthError("ordinary command output")).toBe(false);
  });

  it("classifies App Server auth failures without exposing raw tokens", () => {
    expect(codexAppServerAuthFailureReason("auth expired")).toBe(CodexAppServerAuthFailureReason.AUTH_EXPIRED);
    expect(codexAppServerAuthFailureReason({ error: { code: "token_revoked" } })).toBe(
      CodexAppServerAuthFailureReason.TOKEN_REVOKED,
    );
    expect(codexAppServerAuthFailureReason("Encountered invalidated oauth token for user")).toBe(
      CodexAppServerAuthFailureReason.TOKEN_INVALIDATED,
    );
    expect(codexAppServerAuthFailureReason("refresh_token_invalidated")).toBe(
      CodexAppServerAuthFailureReason.REFRESH_TOKEN_INVALIDATED,
    );
    expect(codexAppServerAuthFailureReason("ordinary command output")).toBe("");
  });

  it("exports stable App Server input rejection reasons", () => {
    expect(CodexAppServerInputRejectReason.AUTH_FAILED).toBe("auth_failed");
    expect(CodexAppServerInputRejectReason.RUNTIME_UNAVAILABLE).toBe("runtime_unavailable");
    expect(CodexAppServerInputRejectReason.RUNTIME_NOT_WRITABLE).toBe("runtime_not_writable");
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
      dynamicTools: [taskDeckDynamicDecisionTool],
    });
    expect(buildCodexAppServerThreadStartParams({ cwd: "/workspace/project" })).not.toHaveProperty("model");
  });

  it("registers the TaskDeck decision dynamic tool by default", () => {
    const params = buildCodexAppServerThreadStartParams({
      cwd: "/workspace/project",
    });

    expect(taskDeckDynamicDecisionTools()).toEqual([taskDeckDynamicDecisionTool]);
    expect(params.dynamicTools).toEqual([taskDeckDynamicDecisionTool]);
  });

  it("registers the TaskDeck decision dynamic tool when enabled", () => {
    const params = buildCodexAppServerThreadStartParams({
      cwd: "/workspace/project",
      enableDynamicDecisionTool: true,
    });

    expect(params.dynamicTools).toEqual([taskDeckDynamicDecisionTool]);
    expect(params.dynamicTools[0]).toMatchObject({
      namespace: TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE,
      name: TASKDECK_DYNAMIC_DECISION_TOOL_NAME,
    });
    expect(params.dynamicTools[0].description).toContain("Request a human decision through TaskDeck");
    expect(params.dynamicTools[0].inputSchema.required).toEqual([
      "decisionQuestion",
      "goal",
      "urgency",
      "semanticSummary",
      "materials",
    ]);
    expect(params.dynamicTools[0].inputSchema.properties.urgency.enum).toEqual(["normal", "blocking"]);
  });

  it("omits the TaskDeck decision dynamic tool when the emergency disable env is set", () => {
    expect(isTaskDeckDynamicDecisionToolEnabledFromEnv({})).toBe(true);
    expect(isTaskDeckDynamicDecisionToolEnabledFromEnv({ TASKDECK_DISABLE_DYNAMIC_DECISION_TOOL: "1" })).toBe(false);
    expect(
      buildCodexAppServerThreadStartParams({
        cwd: "/workspace/project",
        enableDynamicDecisionTool: isTaskDeckDynamicDecisionToolEnabledFromEnv({
          TASKDECK_DISABLE_DYNAMIC_DECISION_TOOL: "1",
        }),
      }),
    ).not.toHaveProperty("dynamicTools");
  });

  it("recognizes and deduplicates TaskDeck decision dynamic tool calls", () => {
    const params = {
      threadId: "thread_123",
      turnId: "turn_123",
      callId: "call_123",
      namespace: TASKDECK_DYNAMIC_DECISION_TOOL_NAMESPACE,
      tool: TASKDECK_DYNAMIC_DECISION_TOOL_NAME,
    };
    const cache = new Map();
    let createCount = 0;
    const createEntry = () => {
      createCount += 1;
      return { result: { ok: true } };
    };

    expect(isTaskDeckDynamicDecisionToolCall(params)).toBe(true);
    expect(isTaskDeckDynamicDecisionToolCall({ ...params, tool: "other" })).toBe(false);
    expect(codexAppServerDynamicToolCallDedupeKey(params)).toBe("thread_123:turn_123:call_123");
    expect(codexAppServerDynamicToolCallDedupeKey({ ...params, callId: "" })).toBe("");
    expect(getOrCreateCodexAppServerDynamicToolCallEntry(cache, "thread_123:turn_123:call_123", createEntry).created).toBe(true);
    expect(getOrCreateCodexAppServerDynamicToolCallEntry(cache, "thread_123:turn_123:call_123", createEntry).created).toBe(false);
    expect(createCount).toBe(1);
  });

  it("builds App Server dynamic tool responses with inputText content items", () => {
    const payload = {
      status: "pending",
      decisionUrl: "https://decision.example/request/123",
      message: "Human decision requested. Continue only after TaskDeck reports a decision.",
    };

    const response = buildCodexAppServerDynamicToolCallResponse(payload, true);

    expect(response.success).toBe(true);
    expect(response.contentItems[0].type).toBe("inputText");
    expect(response.contentItems[0].text).toBe(JSON.stringify(payload));

    const errorPayload = {
      status: "error",
      message: "Decision Gateway unavailable.",
    };
    const errorResponse = buildCodexAppServerDynamicToolCallResponse(errorPayload, false);

    expect(errorResponse.success).toBe(false);
    expect(errorResponse.contentItems[0].type).toBe("inputText");
    expect(errorResponse.contentItems[0].text).toBe(JSON.stringify(errorPayload));
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
