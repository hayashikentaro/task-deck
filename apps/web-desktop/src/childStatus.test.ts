import { describe, expect, it } from "vitest";
import {
  AttentionState,
  attentionStateForChildReportedState,
  parseChildStatusReportJson,
  validateChildStatusReport,
} from "@taskdeck/core";

describe("task status report validation", () => {
  it("accepts a valid task status report", () => {
    const result = validateChildStatusReport({
      kind: "childStatus",
      version: 1,
      state: "ready_for_review",
      summary: "Changes are ready.",
      artifacts: ["README.md"],
      detailsFile: ".taskdeck/statuses/manual-qa.details.md",
      updatedAt: "2026-06-07T13:00:00.000Z",
    });

    expect(result).toEqual({
      ok: true,
      report: {
        state: "ready_for_review",
        summary: "Changes are ready.",
        artifacts: ["README.md"],
        detailsFile: ".taskdeck/statuses/manual-qa.details.md",
        updatedAt: "2026-06-07T13:00:00.000Z",
      },
    });
  });

  it("rejects invalid JSON without throwing", () => {
    expect(parseChildStatusReportJson("{ not json")).toEqual({
      ok: false,
      error: "Task status file must contain valid JSON.",
    });
  });

  it("rejects unsupported states", () => {
    const result = validateChildStatusReport({
      kind: "childStatus",
      version: 1,
      state: "chatty_update",
    });

    expect(result).toEqual({
      ok: false,
      error: "Task status report state must be one of working, blocked, ready_for_review, done, or failed.",
    });
  });

  it("rejects invalid detailsFile values", () => {
    const result = validateChildStatusReport({
      kind: "childStatus",
      version: 1,
      state: "working",
      detailsFile: ["details.md"],
    });

    expect(result).toEqual({
      ok: false,
      error: "Task status report detailsFile must be a string when provided.",
    });
  });

  it("rejects invalid artifacts values", () => {
    const result = validateChildStatusReport({
      kind: "childStatus",
      version: 1,
      state: "working",
      artifacts: ["README.md", 42],
    });

    expect(result).toEqual({
      ok: false,
      error: "Task status report artifacts must be an array of strings when provided.",
    });
  });

  it("maps attention-worthy child states to supervision attention", () => {
    expect(attentionStateForChildReportedState("blocked")).toBe(AttentionState.MAY_NEED_USER);
    expect(attentionStateForChildReportedState("ready_for_review")).toBe(AttentionState.REVIEW_READY);
    expect(attentionStateForChildReportedState("failed")).toBe(AttentionState.FAILED);
  });

  it("does not demand attention for working or done reports", () => {
    expect(attentionStateForChildReportedState("working")).toBe(AttentionState.NONE);
    expect(attentionStateForChildReportedState("done")).toBe(AttentionState.NONE);
  });
});
