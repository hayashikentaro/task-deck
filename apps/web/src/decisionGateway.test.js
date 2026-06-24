import { describe, expect, it } from "vitest";
import {
  buildDecisionGatewayTaskDeckHeaders,
  buildDecisionGatewayDeliveryMessage,
  buildTaskDeckDecisionRequest,
  boundedDecisionGatewayContextField,
  boundedDecisionGatewayRecentOutput,
  createDecisionGatewayDecisionLease,
  decisionGatewayDeliveryIdempotencyKey,
  decisionGatewayTaskDeckErrorMessage,
  isDecisionGatewayDecisionLeaseExpired,
  isDecisionGatewayAutoDeliverEnabledFromEnv,
  markDecisionGatewayDecisionLeaseDelivered,
  markDecisionGatewayDecisionLeaseDeliveryFailed,
  markDecisionGatewayDecisionLeaseReceived,
  normalizeDecisionGatewayTaskDeckApiToken,
  normalizeDecisionGatewayMailboxItem,
  normalizeTaskDeckDecisionRequestInput,
  normalizeDecisionGatewayUrl,
  shouldAutoDeliverDecisionGatewayDecision,
  validateDecisionGatewayMailboxItemAgainstLease,
} from "@taskdeck/core/decision-gateway";

describe("Decision Gateway connector helpers", () => {
  it("builds a TaskDeck decision request with mailbox routing source metadata", () => {
    const request = buildTaskDeckDecisionRequest({
      taskdeckInstanceId: "tdi_test_123",
      task: {
        id: "task_123",
        title: "Review schema field",
        cwd: "/workspace/project",
        agentProfileId: "codex-app-server",
        agentSessionId: "session_456",
        status: "running",
        agentState: "waiting_input",
        attentionState: "needs_input",
        attentionStateReason: "Agent asked what to do next.",
      },
      recentOutput: "Need a data-model decision.",
    });

    expect(request.source).toMatchObject({
      type: "taskdeck",
      taskdeckInstanceId: "tdi_test_123",
      taskId: "task_123",
      sessionId: "session_456",
      agentProfileId: "codex-app-server",
      label: "TaskDeck",
    });
    expect(request.axis).toBe("ambiguous_product_decision");
    expect(request.urgency).toBe("blocking");
    expect(request.decisionQuestion).toContain("What should the agent do next?");
    expect(Array.isArray(request.materials)).toBe(true);
    expect(request.materials.find((material) => material.label === "TaskDeck source context")?.text).toContain(
      '"taskdeckInstanceId": "tdi_test_123"',
    );
    expect(request.materials.some((material) => material.label === "Bounded recent output")).toBe(true);
  });

  it("bounds and redacts recent output", () => {
    const output = boundedDecisionGatewayRecentOutput(
      `token=super-secret-value\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n${"x".repeat(40)}`,
      30,
    );

    expect(output).toContain("TaskDeck truncated recent output");
    expect(output).not.toContain("super-secret-value");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(output.length).toBeLessThan(120);
  });

  it("bounds and redacts source context fields", () => {
    const context = boundedDecisionGatewayContextField(
      `Authorization: Bearer secret-token-value\npassword=hunter2\n${"x".repeat(80)}`,
      40,
    );

    expect(context).toContain("TaskDeck truncated this field");
    expect(context).not.toContain("secret-token-value");
    expect(context).not.toContain("hunter2");
  });

  it("redacts task source context in the request material", () => {
    const request = buildTaskDeckDecisionRequest({
      task: {
        id: "task_123",
        title: "Needs user choice",
        initialInstruction: `password=hunter2\n${"x".repeat(2100)}`,
        attentionStateReason: "Authorization: Bearer secret-token-value",
      },
      recentOutput: "",
    });
    const sourceMaterial = request.materials.find((material) => material.label === "TaskDeck source context");

    expect(sourceMaterial?.text).toContain("TaskDeck truncated this field");
    expect(sourceMaterial?.text).not.toContain("hunter2");
    expect(sourceMaterial?.text).not.toContain("secret-token-value");
  });

  it("builds a tool-triggered Decision Gateway request with host-owned routing identity", () => {
    const decisionInput = normalizeTaskDeckDecisionRequestInput({
      taskId: "model_supplied_task",
      taskdeckInstanceId: "model_supplied_instance",
      sessionId: "model_supplied_session",
      decisionQuestion: "Should this implementation stay minimal or include automatic apply?",
      goal: "Choose the TaskDeck decision workflow scope.",
      axis: "implementation_strategy",
      urgency: "blocking",
      semanticSummary: "The session is blocked on whether to keep the new decision path request-only.",
      materials: [
        {
          type: "text",
          label: "Options",
          text: "A: request only. B: request and auto-apply.",
        },
      ],
      recommendedDecision: null,
      relevantFacts: ["TaskDeck owns routing identity."],
      risks: ["Automatic apply would change the trust boundary."],
    });

    const request = buildTaskDeckDecisionRequest({
      taskdeckInstanceId: "tdi_real_123456789",
      task: {
        id: "task_real",
        title: "Dynamic decision tool",
        cwd: "/workspace/project",
        agentProfileId: "codex-app-server",
        agentSessionId: "thread_real",
        status: "running",
      },
      decisionInput,
      recentOutput: "The model asked for a decision.",
    });
    const sourceMaterial = request.materials.find((material) => material.label === "TaskDeck source context");

    expect(request.source).toMatchObject({
      taskdeckInstanceId: "tdi_real_123456789",
      taskId: "task_real",
      sessionId: "thread_real",
      agentProfileId: "codex-app-server",
      label: "TaskDeck",
    });
    expect(request.goal).toBe("Choose the TaskDeck decision workflow scope.");
    expect(request.axis).toBe("implementation_strategy");
    expect(request.urgency).toBe("blocking");
    expect(request.decisionQuestion).toContain("minimal");
    expect(request.materials.some((material) => material.label === "Options")).toBe(true);
    expect(sourceMaterial?.text).toContain('"taskdeckInstanceId": "tdi_real_123456789"');
    expect(sourceMaterial?.text).toContain('"taskId": "task_real"');
    expect(sourceMaterial?.text).not.toContain("model_supplied_task");
    expect(sourceMaterial?.text).not.toContain("model_supplied_instance");
    expect(sourceMaterial?.text).not.toContain("model_supplied_session");
  });

  it("rejects malformed dynamic decision tool arguments", () => {
    expect(normalizeTaskDeckDecisionRequestInput(null)).toBeNull();
    expect(normalizeTaskDeckDecisionRequestInput({
      decisionQuestion: "Choose a path",
      goal: "Pick one",
      urgency: "later",
      semanticSummary: "Bad urgency.",
      materials: [{ type: "text", text: "Material" }],
    })).toBeNull();
    expect(normalizeTaskDeckDecisionRequestInput({
      decisionQuestion: "Choose a path",
      goal: "Pick one",
      urgency: "normal",
      semanticSummary: "Missing material text.",
      materials: [{ type: "text", text: "" }],
    })).toBeNull();
  });

  it("bounds dynamic decision tool materials and lists", () => {
    const input = normalizeTaskDeckDecisionRequestInput({
      decisionQuestion: "Choose a path",
      goal: "Pick one",
      urgency: "normal",
      semanticSummary: "A bounded summary.",
      materials: Array.from({ length: 8 }, (_, index) => ({
        type: "text",
        label: `Material ${index + 1}`,
        text: `token=secret-${index}\n${"x".repeat(2400)}`,
      })),
      relevantFacts: Array.from({ length: 12 }, (_, index) => `Fact ${index + 1}`),
      risks: Array.from({ length: 12 }, (_, index) => `Risk ${index + 1}`),
    });

    expect(input?.materials).toHaveLength(6);
    expect(input?.materials[0].text).toContain("TaskDeck truncated this field");
    expect(input?.materials[0].text).not.toContain("secret-0");
    expect(input?.relevantFacts).toHaveLength(10);
    expect(input?.risks).toHaveLength(10);
  });

  it("normalizes configured Decision Gateway URLs", () => {
    expect(normalizeDecisionGatewayUrl(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(normalizeDecisionGatewayUrl("")).toBe("");
  });

  it("builds Decision Gateway TaskDeck headers without Authorization when no token is configured", () => {
    expect(normalizeDecisionGatewayTaskDeckApiToken("")).toBe("");
    expect(buildDecisionGatewayTaskDeckHeaders()).toEqual({});
    expect(buildDecisionGatewayTaskDeckHeaders({ contentType: "application/json" })).toEqual({
      "content-type": "application/json",
    });
  });

  it("builds Decision Gateway TaskDeck Bearer Authorization only when token is configured", () => {
    expect(normalizeDecisionGatewayTaskDeckApiToken(" example-token ")).toBe("example-token");
    expect(
      buildDecisionGatewayTaskDeckHeaders({
        apiToken: " example-token ",
        contentType: "application/json",
      }),
    ).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer example-token",
    });
  });

  it("uses a fixed Decision Gateway authentication failure message for 401 responses", () => {
    expect(
      decisionGatewayTaskDeckErrorMessage({
        status: 401,
        payloadError: "upstream detail should not be shown",
        fallback: "fallback",
      }),
    ).toBe("Decision Gateway authentication failed.");
    expect(
      decisionGatewayTaskDeckErrorMessage({
        status: 500,
        payloadError: "Gateway unavailable",
        fallback: "fallback",
      }),
    ).toBe("Gateway unavailable");
  });

  it("normalizes Decision Gateway mailbox decision results", () => {
    const item = normalizeDecisionGatewayMailboxItem(
      {
        id: "mail_123",
        status: "pending",
        payload: {
          type: "decision_result",
          decisionRequestId: "decision_123",
          decisionActionId: "action_123",
          requestId: "request_123",
          taskdeckInstanceId: "taskdeck_123",
          taskId: "task_123",
          sessionId: "session_123",
          action: {
            type: "accept",
            condition: "Proceed with the smaller scope.",
            reason: "It is enough for this release.",
            decidedAt: "2026-06-24T00:00:00.000Z",
          },
          goal: "Choose implementation scope",
          axis: "scope",
          urgency: "blocking",
        },
        createdAt: "2026-06-24T00:00:01.000Z",
      },
      { receivedAt: "2026-06-24T00:00:02.000Z" },
    );

    expect(item).toMatchObject({
      mailboxItemId: "mail_123",
      mailboxStatus: "pending",
      decisionRequestId: "decision_123",
      decisionActionId: "action_123",
      requestId: "request_123",
      taskdeckInstanceId: "taskdeck_123",
      taskId: "task_123",
      sessionId: "session_123",
      actionType: "accept",
      condition: "Proceed with the smaller scope.",
      reason: "It is enough for this release.",
      decidedAt: "2026-06-24T00:00:00.000Z",
      receivedAt: "2026-06-24T00:00:02.000Z",
    });
  });

  it("rejects malformed Decision Gateway mailbox payloads", () => {
    expect(normalizeDecisionGatewayMailboxItem({ id: "mail_123", payload: null })).toBeNull();
    expect(
      normalizeDecisionGatewayMailboxItem({
        id: "mail_123",
        payload: {
          type: "decision_result",
          action: {},
        },
      }),
    ).toBeNull();
  });

  it("creates a pending Decision Gateway decision lease", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      decisionGatewayDecisionId: "decision_123",
      decisionGatewayUrl: "http://localhost:3000/decisions/decision_123",
      requestId: "request_123",
      taskId: "task_123",
      sessionId: "session_123",
      threadId: "session_123",
      turnId: "turn_123",
      callId: "call_123",
      taskdeckInstanceId: "taskdeck_123",
      decisionQuestion: "Should TaskDeck continue?",
      createdAt: "2026-06-24T00:00:00.000Z",
      ttlMs: 30 * 60 * 1000,
    });

    expect(lease).toMatchObject({
      leaseId: "lease_123",
      decisionGatewayDecisionId: "decision_123",
      decisionGatewayUrl: "http://localhost:3000/decisions/decision_123",
      requestId: "request_123",
      taskId: "task_123",
      sessionId: "session_123",
      threadId: "session_123",
      turnId: "turn_123",
      callId: "call_123",
      taskdeckInstanceId: "taskdeck_123",
      decisionQuestion: "Should TaskDeck continue?",
      status: "pending",
      createdAt: "2026-06-24T00:00:00.000Z",
      expiresAt: "2026-06-24T00:30:00.000Z",
    });
  });

  it("classifies a mailbox item matching a pending lease as valid", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      sessionId: "session_123",
      taskdeckInstanceId: "taskdeck_123",
      createdAt: "2026-06-24T00:00:00.000Z",
    });
    const validation = validateDecisionGatewayMailboxItemAgainstLease(
      {
        requestId: "request_123",
        taskdeckInstanceId: "taskdeck_123",
        taskId: "task_123",
        sessionId: "session_123",
      },
      lease,
      {
        now: "2026-06-24T00:05:00.000Z",
        taskExists: true,
        taskSessionId: "session_123",
      },
    );

    expect(validation.validationStatus).toBe("valid");
  });

  it("rejects model or mailbox supplied routing fields that do not match the host-owned lease", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      decisionGatewayDecisionId: "decision_123",
      requestId: "request_123",
      taskId: "task_real",
      sessionId: "thread_real",
      taskdeckInstanceId: "taskdeck_real",
      createdAt: "2026-06-24T00:00:00.000Z",
    });

    expect(
      validateDecisionGatewayMailboxItemAgainstLease(
        {
          requestId: "request_123",
          decisionRequestId: "decision_123",
          taskdeckInstanceId: "taskdeck_real",
          taskId: "model_supplied_task",
          sessionId: "thread_real",
        },
        lease,
        { now: "2026-06-24T00:05:00.000Z", taskExists: true, taskSessionId: "thread_real" },
      ).validationStatus,
    ).toBe("unmatched");
    expect(
      validateDecisionGatewayMailboxItemAgainstLease(
        {
          requestId: "request_123",
          decisionRequestId: "decision_wrong",
          taskdeckInstanceId: "taskdeck_real",
          taskId: "task_real",
          sessionId: "thread_real",
        },
        lease,
        { now: "2026-06-24T00:05:00.000Z", taskExists: true, taskSessionId: "thread_real" },
      ).validationStatus,
    ).toBe("unmatched");
    expect(
      validateDecisionGatewayMailboxItemAgainstLease(
        {
          requestId: "request_123",
          decisionRequestId: "decision_123",
          taskdeckInstanceId: "taskdeck_wrong",
          taskId: "task_real",
          sessionId: "thread_real",
        },
        lease,
        { now: "2026-06-24T00:05:00.000Z", taskExists: true, taskSessionId: "thread_real" },
      ).validationStatus,
    ).toBe("unmatched");
  });

  it("classifies a mailbox item without a lease as unmatched", () => {
    const validation = validateDecisionGatewayMailboxItemAgainstLease(
      { requestId: "request_missing", taskId: "task_123" },
      null,
    );

    expect(validation.validationStatus).toBe("unmatched");
  });

  it("classifies an expired lease as stale", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
      createdAt: "2026-06-24T00:00:00.000Z",
      ttlMs: 1000,
    });

    expect(isDecisionGatewayDecisionLeaseExpired(lease, "2026-06-24T00:00:02.000Z")).toBe(true);
    expect(
      validateDecisionGatewayMailboxItemAgainstLease(
        {
          requestId: "request_123",
          taskdeckInstanceId: "taskdeck_123",
          taskId: "task_123",
        },
        lease,
        {
          now: "2026-06-24T00:00:02.000Z",
        },
      ).validationStatus,
    ).toBe("stale");
  });

  it("does not mutate received lease state for duplicate mailbox items", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
      createdAt: "2026-06-24T00:00:00.000Z",
    });
    const receivedLease = markDecisionGatewayDecisionLeaseReceived(lease, {
      receivedAt: "2026-06-24T00:10:00.000Z",
      mailboxItemId: "mail_123",
      actionType: "accept",
    });
    const duplicateResult = markDecisionGatewayDecisionLeaseReceived(receivedLease, {
      receivedAt: "2026-06-24T00:20:00.000Z",
      mailboxItemId: "mail_456",
      actionType: "reject",
    });

    expect(duplicateResult).toEqual(receivedLease);
  });

  it("does not auto-deliver when disabled", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
    });
    const mailboxItem = { mailboxItemId: "mail_123" };

    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: false,
        lease,
        mailboxItem,
        validationStatus: "valid",
      }),
    ).toEqual({ ok: false, reason: "auto-delivery-disabled" });
  });

  it("enables auto-delivery by default unless the emergency disable env is set", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
    });
    const mailboxItem = { mailboxItemId: "mail_123" };

    expect(isDecisionGatewayAutoDeliverEnabledFromEnv({})).toBe(true);
    expect(
      isDecisionGatewayAutoDeliverEnabledFromEnv({
        TASKDECK_DISABLE_DECISION_AUTO_DELIVER: "1",
      }),
    ).toBe(false);
    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        lease,
        mailboxItem,
        validationStatus: "valid",
      }),
    ).toEqual({ ok: true, reason: "deliver" });
    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: isDecisionGatewayAutoDeliverEnabledFromEnv({
          TASKDECK_DISABLE_DECISION_AUTO_DELIVER: "1",
        }),
        lease,
        mailboxItem,
        validationStatus: "valid",
      }),
    ).toEqual({ ok: false, reason: "auto-delivery-disabled" });
  });

  it("allows auto-delivery for a valid pending or received decision", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
    });
    const mailboxItem = { mailboxItemId: "mail_123" };

    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: true,
        lease,
        mailboxItem,
        validationStatus: "valid",
        taskExists: true,
        sessionActive: true,
        deliveryAllowed: true,
      }),
    ).toEqual({ ok: true, reason: "deliver" });
    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: true,
        lease: markDecisionGatewayDecisionLeaseReceived(lease, {
          mailboxItemId: "mail_123",
          actionType: "accept",
        }),
        mailboxItem,
        validationStatus: "valid",
      }),
    ).toEqual({ ok: true, reason: "deliver" });
  });

  it("does not auto-deliver stale, unmatched, or already delivered decisions", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
    });
    const mailboxItem = { mailboxItemId: "mail_123" };
    const deliveredLease = markDecisionGatewayDecisionLeaseDelivered(lease, {
      deliveryIdempotencyKey: "decision-delivery:request_123:mail_123",
    });

    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: true,
        lease,
        mailboxItem,
        validationStatus: "stale",
      }).ok,
    ).toBe(false);
    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: true,
        lease,
        mailboxItem,
        validationStatus: "unmatched",
      }).ok,
    ).toBe(false);
    expect(
      shouldAutoDeliverDecisionGatewayDecision({
        autoDeliverEnabled: true,
        lease: deliveredLease,
        mailboxItem,
        validationStatus: "valid",
      }).ok,
    ).toBe(false);
  });

  it("marks delivery failure without losing the received decision", () => {
    const lease = markDecisionGatewayDecisionLeaseReceived(
      createDecisionGatewayDecisionLease({
        leaseId: "lease_123",
        requestId: "request_123",
        taskId: "task_123",
        taskdeckInstanceId: "taskdeck_123",
      }),
      {
        mailboxItemId: "mail_123",
        actionType: "accept",
        reason: "Proceed.",
      },
    );
    const failed = markDecisionGatewayDecisionLeaseDeliveryFailed(lease, {
      deliveryError: "Codex App Server thread is not active.",
    });

    expect(failed).toMatchObject({
      status: "delivery_failed",
      mailboxItemId: "mail_123",
      actionType: "accept",
      reason: "Proceed.",
      deliveryError: "Codex App Server thread is not active.",
    });
  });

  it("builds scoped delivery messages for reject, suspend, and conditional_accept", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      decisionGatewayUrl: "https://decision.example/decisions/decision_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
      decisionQuestion: "Should the risky migration proceed?",
    });

    const rejectMessage = buildDecisionGatewayDeliveryMessage({
      lease,
      mailboxItem: {
        mailboxItemId: "mail_reject",
        actionType: "reject",
        reason: "Too risky.",
      },
    });
    const suspendMessage = buildDecisionGatewayDeliveryMessage({
      lease,
      mailboxItem: {
        mailboxItemId: "mail_suspend",
        actionType: "suspend",
      },
    });
    const conditionalMessage = buildDecisionGatewayDeliveryMessage({
      lease,
      mailboxItem: {
        mailboxItemId: "mail_conditional",
        actionType: "conditional_accept",
        condition: "Only edit docs.",
      },
    });

    expect(rejectMessage).toContain("Decision: reject");
    expect(rejectMessage).toContain("do not proceed with the rejected path");
    expect(suspendMessage).toContain("Decision: suspend");
    expect(suspendMessage).toContain("stop work and report suspended state");
    expect(conditionalMessage).toContain("Decision: conditional_accept");
    expect(conditionalMessage).toContain("Only edit docs.");
    expect(conditionalMessage).toContain("continue only within the listed conditions");
    expect(conditionalMessage).toContain("Do not broaden this approval");
  });

  it("uses a stable decision delivery idempotency key", () => {
    const lease = createDecisionGatewayDecisionLease({
      leaseId: "lease_123",
      requestId: "request_123",
      taskId: "task_123",
      taskdeckInstanceId: "taskdeck_123",
    });
    const mailboxItem = {
      mailboxItemId: "mail_123",
      decisionActionId: "action_123",
    };

    expect(decisionGatewayDeliveryIdempotencyKey(lease, mailboxItem)).toBe(
      "decision-delivery:request_123:mail_123:action_123",
    );
  });
});
