import { describe, expect, it } from "vitest";
import {
  buildTaskDeckDecisionRequest,
  boundedDecisionGatewayRecentOutput,
  normalizeDecisionGatewayUrl,
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

  it("normalizes configured Decision Gateway URLs", () => {
    expect(normalizeDecisionGatewayUrl(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(normalizeDecisionGatewayUrl("")).toBe("");
  });
});
