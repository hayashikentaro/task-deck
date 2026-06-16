#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChildSessionMessageFileRequestDraft,
  generateChildSessionMessageRequestId,
  sanitizeMessageRequestId,
} from "@taskdeck/core/child-session-message-file-requests";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const defaultRequestDirectory = path.join(repoRoot, ".taskdeck", "requests", "child-message");

export function childSessionMessageRequestDirectory(env = process.env) {
  const configuredDirectory = String(env.TASKDECK_CHILD_SESSION_MESSAGE_REQUEST_DIR || "").trim();
  return configuredDirectory ? path.resolve(configuredDirectory) : defaultRequestDirectory;
}

function usage() {
  return `Usage:
  node scripts/write-child-session-message-request.mjs \\
    --work-package app-server-standby \\
    --message "Please inspect issue #34 and report whether you need more context. Do not edit files."

Options:
  --work-package <id>          Target child workPackageId scoped to this parent.
  --child-session <taskId>     Target exact child task id.
  --message <text>             Required follow-up instruction.
  --reason <text>              Request reason. Default: Parent follow-up instruction.
  --request-id <id>            Optional request id.
  --help                       Show this help.

Environment:
  TASKDECK_CHILD_SESSION_MESSAGE_REQUEST_DIR overrides the request output directory.`;
}

function readOption(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseWriteChildSessionMessageRequestArgs(args, env = process.env) {
  const draft = {
    requestId: "",
    parentTaskId: String(env.TASKDECK_TASK_ID || "").trim(),
    target: {},
    message: "",
    reason: "Parent follow-up instruction.",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true };
      case "--work-package":
      case "--workPackageId":
        draft.target.workPackageId = readOption(args, index, arg);
        index += 1;
        break;
      case "--child-session":
      case "--childSessionId":
        draft.target.childSessionId = readOption(args, index, arg);
        index += 1;
        break;
      case "--message":
        draft.message = readOption(args, index, arg);
        index += 1;
        break;
      case "--reason":
        draft.reason = readOption(args, index, arg);
        index += 1;
        break;
      case "--request-id":
        draft.requestId = readOption(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  validateCliDraft(draft);
  const targetId = draft.target.workPackageId || draft.target.childSessionId || "child";
  draft.requestId = sanitizeMessageRequestId(draft.requestId) || generateChildSessionMessageRequestId(targetId);
  return { draft };
}

export async function writeChildSessionMessageRequestFile(draft, directory = childSessionMessageRequestDirectory()) {
  const request = createChildSessionMessageFileRequestDraft(draft);
  const filePath = path.join(directory, `${request.requestId}.request.json`);
  const tmpPath = `${filePath}.tmp`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(request, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
  return { filePath, request };
}

function validateCliDraft(draft) {
  const childSessionId = String(draft.target.childSessionId || "").trim();
  const workPackageId = String(draft.target.workPackageId || "").trim();
  if (!childSessionId && !workPackageId) {
    throw new Error("Missing required target: pass --work-package or --child-session.");
  }
  if (!String(draft.message || "").trim()) {
    throw new Error("Missing required option: --message");
  }
  if (!String(draft.reason || "").trim()) {
    throw new Error("--reason must not be empty.");
  }
}

async function main() {
  try {
    const parsed = parseWriteChildSessionMessageRequestArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(usage());
      return;
    }
    const { filePath, request } = await writeChildSessionMessageRequestFile(parsed.draft);
    console.log(`Wrote TaskDeck child session message request: ${filePath}`);
    console.log(`requestId: ${request.requestId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main();
}
