export const CHILD_SESSION_BATCH_REQUEST_START_MARKER = "TASKDECK_CHILD_SESSION_BATCH_REQUEST";
export const CHILD_SESSION_BATCH_REQUEST_END_MARKER = "END_TASKDECK_CHILD_SESSION_BATCH_REQUEST";
export const CHILD_SESSION_MESSAGE_REQUEST_START_MARKER = "TASKDECK_CHILD_SESSION_MESSAGE_REQUEST";
export const CHILD_SESSION_MESSAGE_REQUEST_END_MARKER = "END_TASKDECK_CHILD_SESSION_MESSAGE_REQUEST";

const FORBIDDEN_FIELDS = new Set(["command", "rawCommand", "shell", "env", "secrets", "autoApprove"]);

export type ChildSessionRequest = {
  title: string;
  agentProfileId: string;
  cwd: string;
  workPackageId?: string;
  filesLikelyToChange?: string[];
  initialInstruction: string;
};

export type ChildSessionBatchRequest = {
  version: 1;
  reason?: string;
  sessions: ChildSessionRequest[];
};

export type ChildSessionMessageRequestTarget = {
  childSessionId?: string;
  workPackageId?: string;
};

export type ChildSessionMessageRequest = {
  version: 1;
  target: ChildSessionMessageRequestTarget;
  message: string;
  reason?: string;
};

export type ChildSessionRequestParseErrorCode =
  | "unexpected_end_marker"
  | "unterminated_block"
  | "nested_start_marker"
  | "invalid_json"
  | "invalid_batch"
  | "unsupported_version"
  | "invalid_reason"
  | "missing_sessions"
  | "invalid_sessions"
  | "empty_sessions"
  | "invalid_session"
  | "missing_title"
  | "missing_agent_profile_id"
  | "missing_cwd"
  | "missing_initial_instruction"
  | "invalid_work_package_id"
  | "invalid_files_likely_to_change"
  | "missing_target"
  | "invalid_target"
  | "missing_target_field"
  | "invalid_child_session_id"
  | "invalid_target_work_package_id"
  | "missing_message"
  | "invalid_message"
  | "forbidden_field";

export type ChildSessionRequestParseError = {
  code: ChildSessionRequestParseErrorCode;
  message: string;
  blockIndex?: number;
  sessionIndex?: number;
  path?: string;
  startIndex?: number;
  endIndex?: number;
};

export type ParseChildSessionRequestsResult = {
  requests: ChildSessionBatchRequest[];
  errors: ChildSessionRequestParseError[];
};

export type ParseChildSessionMessageRequestsResult = {
  requests: ChildSessionMessageRequest[];
  errors: ChildSessionRequestParseError[];
};

type ValidationResult =
  | {
      request: ChildSessionBatchRequest;
      errors: [];
    }
  | {
      request: null;
      errors: ChildSessionRequestParseError[];
    };

type MessageValidationResult =
  | {
      request: ChildSessionMessageRequest;
      errors: [];
    }
  | {
      request: null;
      errors: ChildSessionRequestParseError[];
    };

export function parseChildSessionRequestsFromText(text: string): ParseChildSessionRequestsResult {
  const requests: ChildSessionBatchRequest[] = [];
  const errors: ChildSessionRequestParseError[] = [];
  let cursor = 0;
  let blockIndex = 0;

  while (cursor < text.length) {
    const nextStartIndex = text.indexOf(CHILD_SESSION_BATCH_REQUEST_START_MARKER, cursor);
    const nextEndIndex = text.indexOf(CHILD_SESSION_BATCH_REQUEST_END_MARKER, cursor);

    if (nextStartIndex === -1) {
      if (nextEndIndex !== -1) {
        errors.push({
          code: "unexpected_end_marker",
          message: "Found an end marker without a preceding child session request start marker.",
          startIndex: nextEndIndex,
          endIndex: nextEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length,
        });
        cursor = nextEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length;
        continue;
      }
      break;
    }

    if (nextEndIndex !== -1 && nextEndIndex < nextStartIndex) {
      errors.push({
        code: "unexpected_end_marker",
        message: "Found an end marker before the next child session request start marker.",
        startIndex: nextEndIndex,
        endIndex: nextEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length,
      });
      cursor = nextEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length;
      continue;
    }

    const contentStartIndex = nextStartIndex + CHILD_SESSION_BATCH_REQUEST_START_MARKER.length;
    const blockEndIndex = text.indexOf(CHILD_SESSION_BATCH_REQUEST_END_MARKER, contentStartIndex);
    const currentBlockIndex = blockIndex;
    blockIndex += 1;

    if (blockEndIndex === -1) {
      errors.push({
        code: "unterminated_block",
        message: "Child session request block is missing its end marker.",
        blockIndex: currentBlockIndex,
        startIndex: nextStartIndex,
      });
      break;
    }

    const nestedStartIndex = text.indexOf(CHILD_SESSION_BATCH_REQUEST_START_MARKER, contentStartIndex);
    if (nestedStartIndex !== -1 && nestedStartIndex < blockEndIndex) {
      errors.push({
        code: "nested_start_marker",
        message: "Child session request blocks cannot be nested.",
        blockIndex: currentBlockIndex,
        startIndex: nestedStartIndex,
        endIndex: nestedStartIndex + CHILD_SESSION_BATCH_REQUEST_START_MARKER.length,
      });
      cursor = blockEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length;
      continue;
    }

    const blockContent = text.slice(contentStartIndex, blockEndIndex).trim();
    const parsed = parseChildSessionRequestBlock(blockContent, currentBlockIndex, nextStartIndex, blockEndIndex);
    if (parsed.request) {
      requests.push(parsed.request);
    }
    errors.push(...parsed.errors);
    cursor = blockEndIndex + CHILD_SESSION_BATCH_REQUEST_END_MARKER.length;
  }

  return { requests, errors };
}

export function parseChildSessionMessageRequestsFromText(text: string): ParseChildSessionMessageRequestsResult {
  const requests: ChildSessionMessageRequest[] = [];
  const errors: ChildSessionRequestParseError[] = [];
  let cursor = 0;
  let blockIndex = 0;

  while (cursor < text.length) {
    const nextStartIndex = text.indexOf(CHILD_SESSION_MESSAGE_REQUEST_START_MARKER, cursor);
    const nextEndIndex = text.indexOf(CHILD_SESSION_MESSAGE_REQUEST_END_MARKER, cursor);

    if (nextStartIndex === -1) {
      if (nextEndIndex !== -1) {
        errors.push({
          code: "unexpected_end_marker",
          message: "Found an end marker without a preceding child session message request start marker.",
          startIndex: nextEndIndex,
          endIndex: nextEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length,
        });
        cursor = nextEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length;
        continue;
      }
      break;
    }

    if (nextEndIndex !== -1 && nextEndIndex < nextStartIndex) {
      errors.push({
        code: "unexpected_end_marker",
        message: "Found an end marker before the next child session message request start marker.",
        startIndex: nextEndIndex,
        endIndex: nextEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length,
      });
      cursor = nextEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length;
      continue;
    }

    const contentStartIndex = nextStartIndex + CHILD_SESSION_MESSAGE_REQUEST_START_MARKER.length;
    const blockEndIndex = text.indexOf(CHILD_SESSION_MESSAGE_REQUEST_END_MARKER, contentStartIndex);
    const currentBlockIndex = blockIndex;
    blockIndex += 1;

    if (blockEndIndex === -1) {
      errors.push({
        code: "unterminated_block",
        message: "Child session message request block is missing its end marker.",
        blockIndex: currentBlockIndex,
        startIndex: nextStartIndex,
      });
      break;
    }

    const nestedStartIndex = text.indexOf(CHILD_SESSION_MESSAGE_REQUEST_START_MARKER, contentStartIndex);
    if (nestedStartIndex !== -1 && nestedStartIndex < blockEndIndex) {
      errors.push({
        code: "nested_start_marker",
        message: "Child session message request blocks cannot be nested.",
        blockIndex: currentBlockIndex,
        startIndex: nestedStartIndex,
        endIndex: nestedStartIndex + CHILD_SESSION_MESSAGE_REQUEST_START_MARKER.length,
      });
      cursor = blockEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length;
      continue;
    }

    const blockContent = text.slice(contentStartIndex, blockEndIndex).trim();
    const parsed = parseChildSessionMessageRequestBlock(blockContent, currentBlockIndex, nextStartIndex, blockEndIndex);
    if (parsed.request) {
      requests.push(parsed.request);
    }
    errors.push(...parsed.errors);
    cursor = blockEndIndex + CHILD_SESSION_MESSAGE_REQUEST_END_MARKER.length;
  }

  return { requests, errors };
}

export function parseChildSessionRequestBlock(
  blockContent: string,
  blockIndex = 0,
  startIndex?: number,
  endIndex?: number,
): ValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(blockContent);
  } catch {
    return {
      request: null,
      errors: [
        {
          code: "invalid_json",
          message: "Child session request block content must be valid JSON.",
          blockIndex,
          startIndex,
          endIndex,
        },
      ],
    };
  }

  return validateChildSessionBatchRequest(parsed, blockIndex);
}

export function parseChildSessionMessageRequestBlock(
  blockContent: string,
  blockIndex = 0,
  startIndex?: number,
  endIndex?: number,
): MessageValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(blockContent);
  } catch {
    return {
      request: null,
      errors: [
        {
          code: "invalid_json",
          message: "Child session message request block content must be valid JSON.",
          blockIndex,
          startIndex,
          endIndex,
        },
      ],
    };
  }

  return validateChildSessionMessageRequest(parsed, blockIndex);
}

export function validateChildSessionBatchRequest(value: unknown, blockIndex = 0): ValidationResult {
  const errors: ChildSessionRequestParseError[] = [];

  if (!isRecord(value)) {
    return {
      request: null,
      errors: [
        {
          code: "invalid_batch",
          message: "Child session request block must contain a JSON object.",
          blockIndex,
        },
      ],
    };
  }

  errors.push(...findForbiddenFieldErrors(value, blockIndex));

  if (value.version !== 1) {
    errors.push({
      code: "unsupported_version",
      message: "Child session request version must be 1.",
      blockIndex,
      path: "version",
    });
  }

  if ("reason" in value && typeof value.reason !== "string") {
    errors.push({
      code: "invalid_reason",
      message: "Child session request reason must be a string when provided.",
      blockIndex,
      path: "reason",
    });
  }

  const sessionsValue = value.sessions;
  if (sessionsValue === undefined) {
    errors.push({
      code: "missing_sessions",
      message: "Child session request must include a non-empty sessions array.",
      blockIndex,
      path: "sessions",
    });
  } else if (!Array.isArray(sessionsValue)) {
    errors.push({
      code: "invalid_sessions",
      message: "Child session request sessions must be an array.",
      blockIndex,
      path: "sessions",
    });
  } else if (sessionsValue.length === 0) {
    errors.push({
      code: "empty_sessions",
      message: "Child session request sessions array must not be empty.",
      blockIndex,
      path: "sessions",
    });
  }

  const parsedSessions = Array.isArray(sessionsValue)
    ? sessionsValue.map((sessionValue, sessionIndex) =>
        validateChildSessionRequest(sessionValue, blockIndex, sessionIndex),
      )
    : [];

  for (const parsedSession of parsedSessions) {
    errors.push(...parsedSession.errors);
  }

  if (errors.length > 0) {
    return { request: null, errors };
  }

  return {
    request: {
      version: 1,
      reason: typeof value.reason === "string" ? value.reason : undefined,
      sessions: parsedSessions.flatMap((parsedSession) =>
        parsedSession.request === null ? [] : [parsedSession.request],
      ),
    },
    errors: [],
  };
}

export function validateChildSessionMessageRequest(value: unknown, blockIndex = 0): MessageValidationResult {
  const errors: ChildSessionRequestParseError[] = [];

  if (!isRecord(value)) {
    return {
      request: null,
      errors: [
        {
          code: "invalid_batch",
          message: "Child session message request block must contain a JSON object.",
          blockIndex,
        },
      ],
    };
  }

  errors.push(...findForbiddenFieldErrors(value, blockIndex));

  if (value.version !== 1) {
    errors.push({
      code: "unsupported_version",
      message: "Child session message request version must be 1.",
      blockIndex,
      path: "version",
    });
  }

  if ("reason" in value && typeof value.reason !== "string") {
    errors.push({
      code: "invalid_reason",
      message: "Child session message request reason must be a string when provided.",
      blockIndex,
      path: "reason",
    });
  }

  const targetValue = value.target;
  let target: ChildSessionMessageRequestTarget = {};
  if (targetValue === undefined) {
    errors.push({
      code: "missing_target",
      message: "Child session message request must include a target object.",
      blockIndex,
      path: "target",
    });
  } else if (!isRecord(targetValue)) {
    errors.push({
      code: "invalid_target",
      message: "Child session message request target must be a JSON object.",
      blockIndex,
      path: "target",
    });
  } else {
    target = validateChildSessionMessageTarget(targetValue, blockIndex, errors);
  }

  const messageValue = value.message;
  if (typeof messageValue === "string") {
    if (messageValue.trim() === "") {
      errors.push({
        code: "missing_message",
        message: "Child session message request message must not be empty.",
        blockIndex,
        path: "message",
      });
    }
  } else if (messageValue === undefined) {
    errors.push({
      code: "missing_message",
      message: "Child session message request must include a non-empty message string.",
      blockIndex,
      path: "message",
    });
  } else {
    errors.push({
      code: "invalid_message",
      message: "Child session message request message must be a string.",
      blockIndex,
      path: "message",
    });
  }

  if (errors.length > 0) {
    return { request: null, errors };
  }

  return {
    request: {
      version: 1,
      target,
      message: messageValue as string,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    },
    errors: [],
  };
}

type SessionValidationResult =
  | {
      request: ChildSessionRequest;
      errors: [];
    }
  | {
      request: null;
      errors: ChildSessionRequestParseError[];
    };

function validateChildSessionRequest(
  value: unknown,
  blockIndex: number,
  sessionIndex: number,
): SessionValidationResult {
  const errors: ChildSessionRequestParseError[] = [];
  const sessionPath = `sessions[${sessionIndex}]`;

  if (!isRecord(value)) {
    return {
      request: null,
      errors: [
        {
          code: "invalid_session",
          message: `${sessionPath} must be a JSON object.`,
          blockIndex,
          sessionIndex,
          path: sessionPath,
        },
      ],
    };
  }

  const title = readRequiredString(value, "title", "missing_title", blockIndex, sessionIndex);
  const agentProfileId = readRequiredString(
    value,
    "agentProfileId",
    "missing_agent_profile_id",
    blockIndex,
    sessionIndex,
  );
  const cwd = readRequiredString(value, "cwd", "missing_cwd", blockIndex, sessionIndex);
  const initialInstruction = readRequiredString(
    value,
    "initialInstruction",
    "missing_initial_instruction",
    blockIndex,
    sessionIndex,
  );

  errors.push(...title.errors, ...agentProfileId.errors, ...cwd.errors, ...initialInstruction.errors);

  const workPackageId = value.workPackageId;
  if (workPackageId !== undefined && typeof workPackageId !== "string") {
    errors.push({
      code: "invalid_work_package_id",
      message: `${sessionPath}.workPackageId must be a string when provided.`,
      blockIndex,
      sessionIndex,
      path: `${sessionPath}.workPackageId`,
    });
  }

  const filesLikelyToChange = value.filesLikelyToChange;
  if (
    filesLikelyToChange !== undefined &&
    (!Array.isArray(filesLikelyToChange) || filesLikelyToChange.some((filePath) => typeof filePath !== "string"))
  ) {
    errors.push({
      code: "invalid_files_likely_to_change",
      message: `${sessionPath}.filesLikelyToChange must be an array of strings when provided.`,
      blockIndex,
      sessionIndex,
      path: `${sessionPath}.filesLikelyToChange`,
    });
  }

  if (errors.length > 0) {
    return { request: null, errors };
  }

  return {
    request: {
      title: title.value,
      agentProfileId: agentProfileId.value,
      cwd: cwd.value,
      workPackageId: typeof workPackageId === "string" ? workPackageId : undefined,
      filesLikelyToChange: Array.isArray(filesLikelyToChange) ? filesLikelyToChange : undefined,
      initialInstruction: initialInstruction.value,
    },
    errors: [],
  };
}

function validateChildSessionMessageTarget(
  targetValue: Record<string, unknown>,
  blockIndex: number,
  errors: ChildSessionRequestParseError[],
): ChildSessionMessageRequestTarget {
  const target: ChildSessionMessageRequestTarget = {};
  const childSessionId = targetValue.childSessionId;
  const workPackageId = targetValue.workPackageId;

  if (childSessionId !== undefined) {
    if (typeof childSessionId === "string" && childSessionId.trim() !== "") {
      target.childSessionId = childSessionId;
    } else {
      errors.push({
        code: "invalid_child_session_id",
        message: "Child session message request target.childSessionId must be a non-empty string when provided.",
        blockIndex,
        path: "target.childSessionId",
      });
    }
  }

  if (workPackageId !== undefined) {
    if (typeof workPackageId === "string" && workPackageId.trim() !== "") {
      target.workPackageId = workPackageId;
    } else {
      errors.push({
        code: "invalid_target_work_package_id",
        message: "Child session message request target.workPackageId must be a non-empty string when provided.",
        blockIndex,
        path: "target.workPackageId",
      });
    }
  }

  if (childSessionId === undefined && workPackageId === undefined) {
    errors.push({
      code: "missing_target_field",
      message: "Child session message request target must include childSessionId or workPackageId.",
      blockIndex,
      path: "target",
    });
  }

  return target;
}

function readRequiredString(
  record: Record<string, unknown>,
  fieldName: string,
  errorCode: Extract<
    ChildSessionRequestParseErrorCode,
    "missing_title" | "missing_agent_profile_id" | "missing_cwd" | "missing_initial_instruction"
  >,
  blockIndex: number,
  sessionIndex: number,
) {
  const value = record[fieldName];
  const sessionPath = `sessions[${sessionIndex}]`;

  if (typeof value === "string" && value.trim() !== "") {
    return { value, errors: [] as ChildSessionRequestParseError[] };
  }

  return {
    value: "",
    errors: [
      {
        code: errorCode,
        message: `${sessionPath}.${fieldName} must be a non-empty string.`,
        blockIndex,
        sessionIndex,
        path: `${sessionPath}.${fieldName}`,
      },
    ],
  };
}

function findForbiddenFieldErrors(
  value: unknown,
  blockIndex: number,
  path = "",
): ChildSessionRequestParseError[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFieldErrors(item, blockIndex, `${path}[${index}]`));
  }

  if (!isRecord(value)) {
    return [];
  }

  const errors: ChildSessionRequestParseError[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_FIELDS.has(key)) {
      errors.push({
        code: "forbidden_field",
        message: `Child session request field "${key}" is forbidden at ${nextPath}.`,
        blockIndex,
        path: nextPath,
      });
    }
    errors.push(...findForbiddenFieldErrors(nestedValue, blockIndex, nextPath));
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
