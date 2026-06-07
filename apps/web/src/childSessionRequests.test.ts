import { describe, expect, it } from "vitest";
import {
  CHILD_SESSION_BATCH_REQUEST_END_MARKER,
  CHILD_SESSION_BATCH_REQUEST_START_MARKER,
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

function errorCodesFor(text: string): ChildSessionRequestParseErrorCode[] {
  return parseChildSessionRequestsFromText(text).errors.map((error) => error.code);
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
