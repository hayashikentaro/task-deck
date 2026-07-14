import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AttentionState,
  TaskStatus,
  createTask,
  markTaskClosed,
  markTaskReviewed,
  serializeTask,
} from "@taskdeck/core";
import {
  createManagerChildStatusEvent,
  isManagerNotifiableChildState,
  managerEventFilenames,
  validateManagerEvent,
} from "@taskdeck/core/manager-inbox";
import {
  MANAGER_READABLE_CAPABILITIES_KIND,
  MANAGER_READABLE_EVENTS_KIND,
  buildManagerActionGuide,
  buildManagerReadableContext,
  createManagerActionCapabilitiesDocument,
  createManagerReadableEventsDocument,
} from "@taskdeck/core/manager-readable";
import {
  formatInvalidManagerEventWarnings,
  formatManagerInboxReport,
  readManagerInbox,
} from "../../../scripts/read-manager-inbox.mjs";

describe("manager inbox event helpers", () => {
  it("creates a valid task status manager event", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-app-server-standby-ready",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "ready_for_review",
      summary: "Short task status summary.",
      artifacts: ["docs/example.md"],
      detailsFile: "",
      createdAt: "2026-06-12T00:00:00.000Z",
    });

    expect(event).toEqual({
      kind: "taskDeckManagerEvent",
      version: 1,
      type: "taskStatusChanged",
      eventId: "child-status-app-server-standby-ready",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "ready_for_review",
      summary: "Short task status summary.",
      artifacts: ["docs/example.md"],
      detailsFile: "",
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    expect(validateManagerEvent(event)).toMatchObject({ ok: true, event });
  });

  it("rejects invalid event kind, version, and state", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-invalid-test",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "blocked",
      summary: "Blocked.",
      createdAt: "2026-06-12T00:00:00.000Z",
    });

    expect(validateManagerEvent({ ...event, kind: "childStatus" })).toMatchObject({
      ok: false,
      error: "Manager event kind must be taskDeckManagerEvent.",
    });
    expect(validateManagerEvent({ ...event, version: 2 })).toMatchObject({
      ok: false,
      error: "Manager event version must be 1.",
    });
    expect(validateManagerEvent({ ...event, state: "working" })).toMatchObject({
      ok: false,
      error: "Manager task status event state must be blocked, ready_for_review, or failed.",
    });
  });

  it("classifies manager-notifiable task states", () => {
    expect(isManagerNotifiableChildState("blocked")).toBe(true);
    expect(isManagerNotifiableChildState("ready_for_review")).toBe(true);
    expect(isManagerNotifiableChildState("failed")).toBe(true);
    expect(isManagerNotifiableChildState("working")).toBe(false);
    expect(isManagerNotifiableChildState("done")).toBe(false);
  });
});

describe("manager readable context helpers", () => {
  it("enriches unread manager events with relevant task summaries", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-readable-test",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "ready_for_review",
      summary: "Implementation is ready for review.",
      artifacts: ["docs/example.md"],
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    const document = createManagerReadableEventsDocument({
      events: [event],
      tasks: [
        { id: "task_parent", title: "Parent", status: "running", agentState: "working", attentionState: "none" },
        {
          id: "task_child",
          title: "Child",
          status: "running",
          agentState: "review_ready",
          attentionState: "review_ready",
          childReportedState: "ready_for_review",
          childStatusSummary: "Implementation is ready for review.",
        },
      ],
      generatedAt: "2026-06-12T00:02:00.000Z",
    });

    expect(document.kind).toBe(MANAGER_READABLE_EVENTS_KIND);
    expect(document.version).toBe(1);
    expect(document.supportedActions.map((action) => action.command)).toContain("taskdeckctl review --task <taskId>");
    expect(document.events[0]).toMatchObject({
      eventId: "child-status-readable-test",
      suggestedActions: [
        "taskdeckctl ack --event child-status-readable-test",
        "taskdeckctl ack --task task_child",
        "taskdeckctl review --task task_child",
      ],
      childTask: {
        id: "task_child",
        title: "Child",
        status: "running",
        attentionState: "review_ready",
      },
      parentTask: {
        id: "task_parent",
        title: "Parent",
      },
    });
    expect(document.instructions).toContain("Do not command worker sessions directly.");
  });

  it("builds markdown context with manager rules, actions, paths, and event details", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-markdown-test",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "blocked",
      summary: "Need a decision.",
      artifacts: ["docs/example.md"],
      detailsFile: ".taskdeck/statuses/details.md",
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    const markdown = buildManagerReadableContext({
      events: [event],
      tasks: [{ id: "task_child", title: "Child", status: "running", agentState: "working" }],
      generatedAt: "2026-06-12T00:02:00.000Z",
      paths: {
        managerInboxDir: ".taskdeck/manager-inbox",
        managerActionsDir: ".taskdeck/manager-actions",
        managerActionHistoryFile: ".taskdeck/manager-actions/history.json",
        contextFile: ".taskdeck/manager-readable/context.md",
        unreadEventsFile: ".taskdeck/manager-readable/unread-events.json",
        actionsFile: ".taskdeck/manager-readable/actions.md",
        capabilitiesFile: ".taskdeck/manager-readable/capabilities.json",
      },
    });

    expect(markdown).toContain("# TaskDeck Manager Context");
    expect(markdown).toContain("Read the generated manager action guide before taking action.");
    expect(markdown).toContain("Report your judgment in this terminal response only.");
    expect(markdown).toContain("Do not write TASKDECK_STATUS_FILE.");
    expect(markdown).toContain("Do not command worker sessions directly.");
    expect(markdown).toContain("Use only taskdeckctl commands listed in the generated manager action guide.");
    expect(markdown).toContain(".taskdeck/manager-actions/history.json");
    expect(markdown).toContain(".taskdeck/manager-readable/actions.md");
    expect(markdown).toContain(".taskdeck/manager-readable/capabilities.json");
    expect(markdown).toContain("## Supported Manager Actions");
    expect(markdown).toContain("taskdeckctl ack --event <eventId>");
    expect(markdown).toContain("taskdeckctl review --task <taskId>");
    expect(markdown).toContain("Judgment output: this terminal response only");
    expect(markdown).not.toContain("Your bounded judgment/status: TASKDECK_STATUS_FILE");
    expect(markdown).toContain(".taskdeck/manager-readable/unread-events.json");
    expect(markdown).toContain("[taskStatusChanged] blocked");
    expect(markdown).toContain("Task id: task_child");
    expect(markdown).toContain("Summary: Need a decision.");
    expect(markdown).toContain("- docs/example.md");
    expect(markdown).toContain("taskdeckctl ack --event child-status-markdown-test");
    expect(markdown).toContain("taskdeckctl ack --task task_child");
  });

  it("builds a standalone manager action guide and capabilities document", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-actions-test",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      state: "failed",
      summary: "Child failed.",
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    const markdown = buildManagerActionGuide({
      generatedAt: "2026-06-12T00:02:00.000Z",
      events: [event],
      paths: {
        actionsFile: ".taskdeck/manager-readable/actions.md",
        capabilitiesFile: ".taskdeck/manager-readable/capabilities.json",
      },
    });
    const capabilities = createManagerActionCapabilitiesDocument({
      generatedAt: "2026-06-12T00:02:00.000Z",
      paths: {
        actionsFile: ".taskdeck/manager-readable/actions.md",
        capabilitiesFile: ".taskdeck/manager-readable/capabilities.json",
      },
    });

    expect(capabilities.kind).toBe(MANAGER_READABLE_CAPABILITIES_KIND);
    expect(capabilities.paths).toEqual({
      actionsFile: ".taskdeck/manager-readable/actions.md",
      capabilitiesFile: ".taskdeck/manager-readable/capabilities.json",
    });
    expect(capabilities.actions.map((action) => action.command)).toEqual([
      "taskdeckctl ack --event <eventId>",
      "taskdeckctl ack --task <taskId>",
      "taskdeckctl review --task <taskId>",
      "taskdeckctl close --task <taskId>",
    ]);
    expect(markdown).toContain("# TaskDeck Manager Actions");
    expect(markdown).toContain("Use only commands listed here.");
    expect(markdown).toContain("Manager-to-worker messaging is unavailable unless it appears in this guide.");
    expect(markdown).toContain("taskdeckctl close --task task_child");
    expect(JSON.stringify(capabilities)).not.toContain("send-task-input");
    expect(markdown).not.toContain("send-task-input");
  });
});

describe("manager task metadata", () => {
  it("serializes manager task identity", () => {
    const task = createTask({
      title: "TaskDeck Manager session",
      command: "taskdeck-manager-app-server-placeholder",
      cwd: ".",
      agentProfileId: "taskdeck-manager",
      agentLabel: "TaskDeck Manager",
      isManager: true,
    });

    expect(serializeTask(task).isManager).toBe(true);
  });

  it("serializes manager review and close metadata", () => {
    const task = createTask({
      title: "Child ready for review",
      command: "echo ready",
      cwd: ".",
    });
    const reviewed = markTaskReviewed(
      {
        ...task,
        attentionState: AttentionState.REVIEW_READY,
      },
      { reviewedAt: "2026-06-12T00:03:00.000Z", reviewedByTaskId: "task_manager" },
    );
    const closed = markTaskClosed(reviewed, {
      closedAt: "2026-06-12T00:04:00.000Z",
      closedByTaskId: "task_manager",
    });

    expect(serializeTask(reviewed)).toMatchObject({
      attentionState: AttentionState.NONE,
      reviewedAt: "2026-06-12T00:03:00.000Z",
      reviewedByTaskId: "task_manager",
    });
    expect(serializeTask(closed)).toMatchObject({
      status: TaskStatus.CLOSED,
      attentionState: AttentionState.NONE,
      closedAt: "2026-06-12T00:04:00.000Z",
      closedByTaskId: "task_manager",
    });
  });
});

describe("read-manager-inbox script helpers", () => {
  it("lists unread events", async () => {
    const inbox = await mkdtemp(path.join(os.tmpdir(), "taskdeck-manager-inbox-"));
    try {
      const event = createManagerChildStatusEvent({
        eventId: "child-status-list-test",
        parentTaskId: "task_parent",
        childTaskId: "task_child",
        state: "ready_for_review",
        summary: "Implementation is ready for review.",
        artifacts: ["docs/example.md"],
        createdAt: "2026-06-12T00:00:00.000Z",
      });
      await writeEvent(inbox, event);

      const result = await readManagerInbox({ inbox });
      const output = formatManagerInboxReport(result.events);

      expect(result.events).toEqual([event]);
      expect(output).toContain("Unread TaskDeck manager events: 1");
      expect(output).toContain("[taskStatusChanged] ready_for_review task=task_child");
      expect(output).toContain("Implementation is ready for review.");
      expect(output).toContain("- docs/example.md");
    } finally {
      await rm(inbox, { recursive: true, force: true });
    }
  });

  it("acks unread events and skips them on the next read", async () => {
    const inbox = await mkdtemp(path.join(os.tmpdir(), "taskdeck-manager-inbox-"));
    try {
      const event = createManagerChildStatusEvent({
        eventId: "child-status-ack-test",
        parentTaskId: "task_parent",
        childTaskId: "task_child",
        state: "blocked",
        summary: "Need parent input.",
        createdAt: "2026-06-12T00:00:00.000Z",
      });
      await writeEvent(inbox, event);

      const acked = await readManagerInbox({
        inbox,
        ack: true,
        ackedAt: "2026-06-12T00:01:00.000Z",
      });
      const filenames = managerEventFilenames(event.eventId);
      const ackContents = JSON.parse(await readFile(path.join(inbox, filenames.ack), "utf8"));
      const nextRead = await readManagerInbox({ inbox });

      expect(acked.events).toEqual([event]);
      expect(acked.ackedCount).toBe(1);
      expect(ackContents).toEqual({
        kind: "taskDeckManagerEventAck",
        version: 1,
        eventId: event.eventId,
        ackedAt: "2026-06-12T00:01:00.000Z",
      });
      expect(nextRead.events).toEqual([]);
    } finally {
      await rm(inbox, { recursive: true, force: true });
    }
  });

  it("reports invalid event files without crashing", async () => {
    const inbox = await mkdtemp(path.join(os.tmpdir(), "taskdeck-manager-inbox-"));
    try {
      await writeFile(path.join(inbox, "not-json.json"), "{ not json\n");
      await writeFile(
        path.join(inbox, "wrong-kind.json"),
        `${JSON.stringify({
          kind: "childStatus",
          version: 1,
          type: "childStatusChanged",
          eventId: "wrong-kind",
          parentTaskId: "task_parent",
          childTaskId: "task_child",
          state: "blocked",
          summary: "Blocked.",
          artifacts: [],
          detailsFile: "",
          createdAt: "2026-06-12T00:00:00.000Z",
        })}\n`,
      );

      const result = await readManagerInbox({ inbox });
      const warnings = formatInvalidManagerEventWarnings(result.invalidEvents);

      expect(result.events).toEqual([]);
      expect(result.invalidEvents).toHaveLength(2);
      expect(warnings).toContain("Skipped invalid TaskDeck manager event files: 2");
      expect(warnings).toContain("not-json.json: Could not parse event JSON");
      expect(warnings).toContain("wrong-kind.json: Manager event kind must be taskDeckManagerEvent.");
    } finally {
      await rm(inbox, { recursive: true, force: true });
    }
  });
});

async function writeEvent(inbox, event) {
  const filenames = managerEventFilenames(event.eventId);
  await writeFile(path.join(inbox, filenames.event), `${JSON.stringify(event, null, 2)}\n`);
}
