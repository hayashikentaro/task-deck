import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createManagerChildStatusEvent,
  isManagerNotifiableChildState,
  managerEventFilenames,
  validateManagerEvent,
} from "@taskdeck/core/manager-inbox";
import {
  formatInvalidManagerEventWarnings,
  formatManagerInboxReport,
  readManagerInbox,
} from "../../../scripts/read-manager-inbox.mjs";

describe("manager inbox event helpers", () => {
  it("creates a valid child status manager event", () => {
    const event = createManagerChildStatusEvent({
      eventId: "child-status-codex-low-standby-ready",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      workPackageId: "codex-low-standby",
      state: "ready_for_review",
      summary: "Short child status summary.",
      artifacts: ["docs/example.md"],
      detailsFile: "",
      createdAt: "2026-06-12T00:00:00.000Z",
    });

    expect(event).toEqual({
      kind: "taskDeckManagerEvent",
      version: 1,
      type: "childStatusChanged",
      eventId: "child-status-codex-low-standby-ready",
      parentTaskId: "task_parent",
      childTaskId: "task_child",
      workPackageId: "codex-low-standby",
      state: "ready_for_review",
      summary: "Short child status summary.",
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
      error: "Manager child status event state must be blocked, ready_for_review, or failed.",
    });
  });

  it("classifies manager-notifiable child states", () => {
    expect(isManagerNotifiableChildState("blocked")).toBe(true);
    expect(isManagerNotifiableChildState("ready_for_review")).toBe(true);
    expect(isManagerNotifiableChildState("failed")).toBe(true);
    expect(isManagerNotifiableChildState("working")).toBe(false);
    expect(isManagerNotifiableChildState("done")).toBe(false);
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
        workPackageId: "codex-low-standby",
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
      expect(output).toContain("[childStatusChanged] ready_for_review workPackage=codex-low-standby child=task_child");
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
