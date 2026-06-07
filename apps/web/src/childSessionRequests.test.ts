import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
  CHILD_SESSION_MESSAGE_REQUEST_END_MARKER,
  CHILD_SESSION_MESSAGE_REQUEST_START_MARKER,
  parseChildSessionMessageRequestsFromText,
  parseChildSessionRequestsFromText,
  type ChildSessionRequestParseErrorCode,
} from "./childSessionRequests";

function requestBlock(value: unknown) {
  return [
    CHILD_SESSION_BATCH_REQUEST_START_MARKER,
    JSON.stringify(value, null, 2),
    CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  ].join("\n");
}

function messageRequestBlock(value: unknown) {
  return [
    CHILD_SESSION_MESSAGE_REQUEST_START_MARKER,
    JSON.stringify(value, null, 2),
    CHILD_SESSION_MESSAGE_REQUEST_END_MARKER,
  ].join("\n");
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    reason: "Split protocol parser work into child sessions.",
    sessions: [
      {
        title: "Parser test child",
        agentProfileId: "codex",
        agentPermissionLevel: "read_only",
        cwd: "/workspace/task-deck",
        workPackageId: "parser-test",
        filesLikelyToChange: ["apps/web/src/childSessionRequests.ts"],
        initialInstruction: "Read AGENTS.md, then run the parser test.",
        ...overrides,
      },
    ],
  };
}

function validMessageRequest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    target: {
      workPackageId: "parser-test",
    },
    message: "Please report your current status.",
    reason: "Parser test.",
    ...overrides,
  };
}

function errorCodesFor(text: string): ChildSessionRequestParseErrorCode[] {
  return parseChildSessionRequestsFromText(text).errors.map((error) => error.code);
}

function messageErrorCodesFor(text: string): ChildSessionRequestParseErrorCode[] {
  return parseChildSessionMessageRequestsFromText(text).errors.map((error) => error.code);
}

describe("parseChildSessionRequestsFromText", () => {
  it("parses a valid child session batch request block", () => {
    const result = parseChildSessionRequestsFromText(requestBlock(validRequest()));

    expect(result.errors).toEqual([]);
    expect(result.requests).toEqual([
      {
        version: 1,
        reason: "Split protocol parser work into child sessions.",
        sessions: [
          {
            title: "Parser test child",
            agentProfileId: "codex",
            agentPermissionLevel: "read_only",
            cwd: "/workspace/task-deck",
            workPackageId: "parser-test",
            filesLikelyToChange: ["apps/web/src/childSessionRequests.ts"],
            initialInstruction: "Read AGENTS.md, then run the parser test.",
          },
        ],
      },
    ]);
  });

  it("parses multiple valid request blocks from one output buffer", () => {
    const firstBlock = requestBlock(validRequest({ title: "First child", workPackageId: "first" }));
    const secondBlock = requestBlock(validRequest({ title: "Second child", workPackageId: "second" }));
    const result = parseChildSessionRequestsFromText(`before\n${firstBlock}\nbetween\n${secondBlock}\nafter`);

    expect(result.errors).toEqual([]);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].sessions[0].title).toBe("First child");
    expect(result.requests[1].sessions[0].title).toBe("Second child");
  });

  it("reports invalid JSON without returning a request", () => {
    const result = parseChildSessionRequestsFromText(
      [
        CHILD_SESSION_BATCH_REQUEST_START_MARKER,
        "{ not valid json",
        CHILD_SESSION_BATCH_REQUEST_END_MARKER,
      ].join("\n"),
    );

    expect(result.requests).toEqual([]);
    expect(result.errors).toMatchObject([{ code: "invalid_json" }]);
  });

  it("reports unsupported protocol versions", () => {
    expect(errorCodesFor(requestBlock({ ...validRequest(), version: 2 }))).toContain("unsupported_version");
  });

  it("reports a missing sessions array", () => {
    const { sessions, ...requestWithoutSessions } = validRequest();

    expect(sessions).toBeDefined();
    expect(errorCodesFor(requestBlock(requestWithoutSessions))).toContain("missing_sessions");
  });

  it("reports an empty sessions array", () => {
    expect(errorCodesFor(requestBlock({ ...validRequest(), sessions: [] }))).toContain("empty_sessions");
  });

  it.each([
    ["title", "missing_title"],
    ["agentProfileId", "missing_agent_profile_id"],
    ["cwd", "missing_cwd"],
    ["initialInstruction", "missing_initial_instruction"],
  ] as const)("reports a missing required session field: %s", (fieldName, expectedCode) => {
    const session = { ...validRequest().sessions[0] };
    delete session[fieldName];

    expect(errorCodesFor(requestBlock({ ...validRequest(), sessions: [session] }))).toContain(expectedCode);
  });

  it("reports invalid agent permission levels", () => {
    expect(errorCodesFor(requestBlock(validRequest({ agentPermissionLevel: "full-access" })))).toContain(
      "invalid_agent_permission_level",
    );
  });

  it.each([
    ["a non-array value", "README.md"],
    ["an array containing non-string values", ["README.md", 42]],
  ])("reports invalid filesLikelyToChange when it is %s", (_label, filesLikelyToChange) => {
    expect(errorCodesFor(requestBlock(validRequest({ filesLikelyToChange })))).toContain(
      "invalid_files_likely_to_change",
    );
  });

  it.each(["command", "rawCommand", "shell", "env", "secrets", "autoApprove"])(
    "rejects forbidden field %s anywhere in the request",
    (fieldName) => {
      const request = validRequest({
        nestedPolicyProbe: {
          [fieldName]: fieldName === "env" ? { SECRET: "nope" } : "forbidden",
        },
      });
      const result = parseChildSessionRequestsFromText(requestBlock(request));

      expect(result.requests).toEqual([]);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "forbidden_field",
            path: `sessions[0].nestedPolicyProbe.${fieldName}`,
          }),
        ]),
      );
    },
  );

  it("reports unterminated blocks while leaving request creation to later complete output", () => {
    const result = parseChildSessionRequestsFromText(`${CHILD_SESSION_BATCH_REQUEST_START_MARKER}\n{`);

    expect(result.requests).toEqual([]);
    expect(result.errors).toMatchObject([{ code: "unterminated_block" }]);
  });
});

describe("parseChildSessionMessageRequestsFromText", () => {
  it("parses a valid child session message request block", () => {
    const result = parseChildSessionMessageRequestsFromText(messageRequestBlock(validMessageRequest()));

    expect(result.errors).toEqual([]);
    expect(result.requests).toEqual([
      {
        version: 1,
        target: {
          workPackageId: "parser-test",
        },
        message: "Please report your current status.",
        reason: "Parser test.",
      },
    ]);
  });

  it("parses multiple valid child session message request blocks", () => {
    const firstBlock = messageRequestBlock(
      validMessageRequest({ target: { childSessionId: "task_first" }, message: "First message." }),
    );
    const secondBlock = messageRequestBlock(
      validMessageRequest({ target: { workPackageId: "second" }, message: "Second message." }),
    );
    const result = parseChildSessionMessageRequestsFromText(`${firstBlock}\ntext\n${secondBlock}`);

    expect(result.errors).toEqual([]);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].target.childSessionId).toBe("task_first");
    expect(result.requests[1].target.workPackageId).toBe("second");
  });

  it("reports invalid JSON without returning a message request", () => {
    const result = parseChildSessionMessageRequestsFromText(
      [
        CHILD_SESSION_MESSAGE_REQUEST_START_MARKER,
        "{ not valid json",
        CHILD_SESSION_MESSAGE_REQUEST_END_MARKER,
      ].join("\n"),
    );

    expect(result.requests).toEqual([]);
    expect(result.errors).toMatchObject([{ code: "invalid_json" }]);
  });

  it("reports unsupported message request protocol versions", () => {
    expect(messageErrorCodesFor(messageRequestBlock({ ...validMessageRequest(), version: 2 }))).toContain(
      "unsupported_version",
    );
  });

  it("reports a missing target", () => {
    const { target, ...requestWithoutTarget } = validMessageRequest();

    expect(target).toBeDefined();
    expect(messageErrorCodesFor(messageRequestBlock(requestWithoutTarget))).toContain("missing_target");
  });

  it("reports a target without childSessionId or workPackageId", () => {
    expect(messageErrorCodesFor(messageRequestBlock(validMessageRequest({ target: {} })))).toContain(
      "missing_target_field",
    );
  });

  it.each([
    ["missing", undefined, "missing_message"],
    ["empty", "", "missing_message"],
    ["non-string", 42, "invalid_message"],
  ] as const)("reports a %s message", (_label, message, expectedCode) => {
    const request = validMessageRequest();
    if (message === undefined) {
      delete request.message;
    } else {
      request.message = message;
    }

    expect(messageErrorCodesFor(messageRequestBlock(request))).toContain(expectedCode);
  });

  it("reports non-string target fields", () => {
    const result = parseChildSessionMessageRequestsFromText(
      messageRequestBlock(validMessageRequest({ target: { childSessionId: 123, workPackageId: [] } })),
    );

    expect(result.requests).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_child_session_id", path: "target.childSessionId" }),
        expect.objectContaining({ code: "invalid_target_work_package_id", path: "target.workPackageId" }),
      ]),
    );
  });

  it.each(["command", "rawCommand", "shell", "env", "secrets", "autoApprove"])(
    "rejects forbidden field %s anywhere in a message request",
    (fieldName) => {
      const request = validMessageRequest({
        target: {
          workPackageId: "parser-test",
          nestedPolicyProbe: {
            [fieldName]: "forbidden",
          },
        },
      });
      const result = parseChildSessionMessageRequestsFromText(messageRequestBlock(request));

      expect(result.requests).toEqual([]);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "forbidden_field",
            path: `target.nestedPolicyProbe.${fieldName}`,
          }),
        ]),
      );
    },
  );

  it("reports unterminated message request blocks", () => {
    const result = parseChildSessionMessageRequestsFromText(`${CHILD_SESSION_MESSAGE_REQUEST_START_MARKER}\n{`);

    expect(result.requests).toEqual([]);
    expect(result.errors).toMatchObject([{ code: "unterminated_block" }]);
  });
});
