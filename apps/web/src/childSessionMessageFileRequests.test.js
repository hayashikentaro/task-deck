import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND,
  buildChildSessionMessageDelivery,
  childSessionMessageFileRequestResultFilenames,
  createChildSessionMessageRequestResult,
  validateChildSessionMessageFileRequest,
} from "@taskdeck/core/child-session-message-file-requests";
import {
  parseWriteChildSessionMessageRequestArgs,
  writeChildSessionMessageRequestFile,
} from "../../../scripts/write-child-session-message-request.mjs";

describe("file-based child session message request writer", () => {
  it("writes a valid message request file from CLI-like arguments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "taskdeck-child-message-"));
    try {
      const message = "Please inspect issue #34.\nReport whether you need more context.\nDo not edit files.";
      const parsed = parseWriteChildSessionMessageRequestArgs(
        [
          "--work-package",
          "app-server-standby",
          "--message",
          message,
          "--request-id",
          "message-app-server-standby-test",
        ],
        { TASKDECK_TASK_ID: "task_parent" },
      );

      const { filePath, request } = await writeChildSessionMessageRequestFile(parsed.draft, directory);
      const fileContents = await readFile(filePath, "utf8");
      const fileRequest = JSON.parse(fileContents);
      const validation = validateChildSessionMessageFileRequest(fileRequest);

      expect(request.requestId).toBe("message-app-server-standby-test");
      expect(filePath).toBe(path.join(directory, "message-app-server-standby-test.request.json"));
      expect(fileRequest.kind).toBe(CHILD_SESSION_MESSAGE_FILE_REQUEST_KIND);
      expect(fileRequest.version).toBe(1);
      expect(fileRequest.parentTaskId).toBe("task_parent");
      expect(fileRequest.target).toEqual({ workPackageId: "app-server-standby" });
      expect(fileRequest.message).toBe(message);
      expect(fileRequest.reason).toBe("Parent follow-up instruction.");
      expect(validation.ok).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("defaults parentTaskId from TASKDECK_TASK_ID", () => {
    const parsed = parseWriteChildSessionMessageRequestArgs(
      ["--child-session", "task_child", "--message", "Report status."],
      { TASKDECK_TASK_ID: "task_parent" },
    );

    expect(parsed.draft.parentTaskId).toBe("task_parent");
    expect(parsed.draft.target).toEqual({ childSessionId: "task_child" });
  });

  it("requires a target and message", () => {
    expect(() =>
      parseWriteChildSessionMessageRequestArgs(["--message", "Report status."], { TASKDECK_TASK_ID: "task_parent" }),
    ).toThrow(/--work-package or --child-session/);
    expect(() =>
      parseWriteChildSessionMessageRequestArgs(["--work-package", "app-server-standby"], {
        TASKDECK_TASK_ID: "task_parent",
      }),
    ).toThrow(/--message/);
  });
});

describe("file-based child session message request validation", () => {
  it("rejects forbidden raw control fields", () => {
    const result = validateChildSessionMessageFileRequest({
      kind: "childSessionMessageRequest",
      version: 1,
      requestId: "message-forbidden-test",
      parentTaskId: "task_parent",
      target: { workPackageId: "app-server-standby" },
      message: "Report status.",
      command: "echo should-not-run",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("$.command");
  });

  it("rejects missing targets and invalid request ids", () => {
    expect(validateChildSessionMessageFileRequest({
      kind: "childSessionMessageRequest",
      version: 1,
      requestId: "message-test",
      parentTaskId: "task_parent",
      message: "Report status.",
    })).toMatchObject({ ok: false, error: "target must be an object." });

    expect(validateChildSessionMessageFileRequest({
      kind: "childSessionMessageRequest",
      version: 1,
      requestId: "../message-test",
      parentTaskId: "task_parent",
      target: { workPackageId: "app-server-standby" },
      message: "Report status.",
    })).toMatchObject({ ok: false, error: "requestId contains unsupported characters." });
  });

  it("creates accepted and rejected result shapes and filenames", () => {
    expect(createChildSessionMessageRequestResult({
      requestId: "message-result-test",
      state: "accepted",
      targetTaskId: "task_child",
      processedAt: "2026-06-12T00:00:00.000Z",
    })).toEqual({
      kind: "childSessionMessageRequestResult",
      version: 1,
      requestId: "message-result-test",
      state: "accepted",
      targetTaskId: "task_child",
      processedAt: "2026-06-12T00:00:00.000Z",
    });

    expect(createChildSessionMessageRequestResult({
      requestId: "message-result-test",
      state: "rejected",
      error: "No child matched.",
      processedAt: "2026-06-12T00:00:00.000Z",
    })).toMatchObject({
      kind: "childSessionMessageRequestResult",
      state: "rejected",
      error: "No child matched.",
    });

    expect(childSessionMessageFileRequestResultFilenames("message-result-test")).toEqual({
      accepted: "message-result-test.accepted.json",
      rejected: "message-result-test.rejected.json",
    });
  });
});

describe("file-based child session message delivery resolution", () => {
  const parentTask = { id: "task_parent", title: "Parent", status: "running" };
  const childTask = {
    id: "task_child",
    title: "Child",
    status: "running",
    spawnedFromParentRequest: true,
    parentSessionId: "task_parent",
    workPackageId: "app-server-standby",
  };

  function delivery(overrides = {}, tasks = [parentTask, childTask]) {
    return buildChildSessionMessageDelivery({
      parentTask,
      request: {
        requestId: "message-test",
        parentTaskId: "task_parent",
        target: { workPackageId: "app-server-standby" },
        message: "Report status.",
        ...overrides,
      },
      tasks,
      formatInput: (_parent, message) => `formatted:${message}`,
    });
  }

  it("targets a running child by workPackageId", () => {
    expect(delivery()).toMatchObject({
      ok: true,
      childTask,
      data: "formatted:Report status.",
    });
  });

  it("targets a running child by childSessionId", () => {
    expect(delivery({ target: { childSessionId: "task_child" } })).toMatchObject({
      ok: true,
      childTask,
    });
  });

  it("rejects ambiguous workPackageId targets", () => {
    const secondChild = { ...childTask, id: "task_child_2", title: "Second child" };

    expect(delivery({}, [parentTask, childTask, secondChild])).toMatchObject({
      ok: false,
      error: "Multiple children matched workPackageId app-server-standby for this parent.",
    });
  });

  it("rejects non-running and input-locked child targets", () => {
    expect(delivery({}, [parentTask, { ...childTask, status: "exited" }])).toMatchObject({
      ok: false,
      error: 'target child session "Child" is not running.',
    });

    expect(delivery({}, [parentTask, { ...childTask, terminalInputLockedAt: "2026-06-12T00:00:00.000Z" }])).toMatchObject({
      ok: false,
      error: 'target child session "Child" has terminal input locked.',
    });
  });

  it("rejects targets not owned by the parent task", () => {
    expect(delivery({}, [parentTask, { ...childTask, parentSessionId: "other_parent" }])).toMatchObject({
      ok: false,
      error: "No child matched workPackageId app-server-standby for this parent.",
    });
  });
});
