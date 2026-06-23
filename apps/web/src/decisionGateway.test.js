import { describe, expect, it } from "vitest";
import {
  buildTaskDeckDecisionRequest,
  boundedDecisionGatewayContextField,
  boundedDecisionGatewayRecentOutput,
  createDecisionGatewayDecisionLease,
  isDecisionGatewayDecisionLeaseExpired,
  markDecisionGatewayDecisionLeaseReceived,
  normalizeDecisionGatewayMailboxItem,
  normalizeDecisionGatewayUrl,
  validateDecisionGatewayMailboxItemAgainstLease,
} from "@taskdeck/core/decision-gateway";

describe("Decision Gateway connector helpers", () => {
  it("builds a source-neutral TaskDeck decision request", () => {
    const request = buildTaskDeckDecisionRequest({
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
      taskId: "task_123",
      sessionId: "session_456",
      label: "TaskDeck",
    });
    expect(request.axis).toBe("ambiguous_product_decision");
    expect(request.urgency).toBe("blocking");
    expect(request.decisionQuestion).toContain("What should the agent do next?");
    expect(Array.isArray(request.materials)).toBe(true);
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

  it("normalizes configured Decision Gateway URLs", () => {
    expect(normalizeDecisionGatewayUrl(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(normalizeDecisionGatewayUrl("")).toBe("");
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
      taskdeckInstanceId: "taskdeck_123",
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
      taskdeckInstanceId: "taskdeck_123",
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
      { requestId: "request_123", taskId: "task_123", sessionId: "session_123" },
      lease,
      {
        now: "2026-06-24T00:05:00.000Z",
        taskExists: true,
        taskSessionId: "session_123",
      },
    );

    expect(validation.validationStatus).toBe("valid");
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
      validateDecisionGatewayMailboxItemAgainstLease({ requestId: "request_123", taskId: "task_123" }, lease, {
        now: "2026-06-24T00:00:02.000Z",
      }).validationStatus,
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
});
