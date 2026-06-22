import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_FILE_REQUEST_KIND,
  createChildSessionFileRequestDraft,
  createChildSessionRequestResult,
  validateChildSessionFileRequest,
} from "@taskdeck/core/child-session-file-requests";
import {
  parseWriteChildSessionRequestArgs,
  writeChildSessionRequestFile,
} from "../../../scripts/write-child-session-request.mjs";

describe("file-based child session request writer", () => {
  it("writes a valid request file from CLI-like arguments", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "taskdeck-child-request-"));
    try {
      const instruction = "Read AGENTS.md.\nDo not edit files.\nReport ready.";
      const parsed = parseWriteChildSessionRequestArgs(
        [
          "--title",
          "App Server child session",
          "--work-package",
          "app-server-standby",
          "--instruction",
          instruction,
          "--file",
          "README.md",
          "--request-id",
          "app-server-standby-test",
        ],
        { TASKDECK_TASK_ID: "task_parent" },
      );

      const { filePath, request } = await writeChildSessionRequestFile(parsed.draft, directory);
      const fileContents = await readFile(filePath, "utf8");
      const fileRequest = JSON.parse(fileContents);
      const validation = validateChildSessionFileRequest(fileRequest);

      expect(request.requestId).toBe("app-server-standby-test");
      expect(filePath).toBe(path.join(directory, "app-server-standby-test.request.json"));
      expect(fileRequest.kind).toBe(CHILD_SESSION_FILE_REQUEST_KIND);
      expect(fileRequest.version).toBe(1);
      expect(fileRequest.parentTaskId).toBe("task_parent");
      expect(fileRequest.sessions[0]).toMatchObject({
        title: "App Server child session",
        agentProfileId: "codex-app-server",
        cwd: ".",
        workPackageId: "app-server-standby",
        filesLikelyToChange: ["README.md"],
        initialInstruction: instruction,
      });
      expect(validation.ok).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects container-only /workspace cwd values", () => {
    expect(() =>
      parseWriteChildSessionRequestArgs(
        [
          "--title",
          "Bad cwd child session",
          "--cwd",
          "/workspace/task-deck",
          "--work-package",
          "bad-cwd",
          "--instruction",
          "Report ready.",
        ],
        { TASKDECK_TASK_ID: "task_parent" },
      ),
    ).toThrow(/do not use a container-only \/workspace path/);
  });

  it("defaults draft helper to the App Server profile", () => {
    const request = createChildSessionFileRequestDraft({
      requestId: "default-permission-test",
      parentTaskId: "task_parent",
      title: "Default permission child",
      workPackageId: "default-permission-test",
      initialInstruction: "Report ready.",
    });

    expect(request.sessions[0].agentProfileId).toBe("codex-app-server");
    expect(validateChildSessionFileRequest(request).ok).toBe(true);
  });

  it("rejects forbidden raw command fields", () => {
    const result = validateChildSessionFileRequest({
      kind: "childSessionRequest",
      version: 1,
      requestId: "forbidden-test",
      parentTaskId: "task_parent",
      sessions: [
        {
          title: "Forbidden command child",
          agentProfileId: "codex-app-server",
          cwd: ".",
          workPackageId: "forbidden-test",
          initialInstruction: "Report ready.",
          command: "echo should-not-run",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("$.sessions[0].command");
  });

  it("creates accepted and rejected result shapes", () => {
    expect(createChildSessionRequestResult({
      requestId: "result-test",
      state: "accepted",
      createdTaskIds: ["task_child"],
      processedAt: "2026-06-08T00:00:00.000Z",
    })).toEqual({
      kind: "childSessionRequestResult",
      version: 1,
      requestId: "result-test",
      state: "accepted",
      createdTaskIds: ["task_child"],
      processedAt: "2026-06-08T00:00:00.000Z",
    });

    expect(createChildSessionRequestResult({
      requestId: "result-test",
      state: "rejected",
      error: "No parent task.",
      processedAt: "2026-06-08T00:00:00.000Z",
    })).toMatchObject({
      kind: "childSessionRequestResult",
      state: "rejected",
      error: "No parent task.",
    });
  });
});
