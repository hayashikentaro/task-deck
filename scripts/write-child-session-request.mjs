#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChildSessionFileRequestDraft,
  generateChildSessionRequestId,
  sanitizeRequestId,
} from "@taskdeck/core/child-session-file-requests";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const requestDirectory = path.join(repoRoot, ".taskdeck", "requests", "child-session");
const permissionLevels = new Set(["full_access", "workspace_write", "read_only"]);
const reasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);

function usage() {
  return `Usage:
  node scripts/write-child-session-request.mjs \\
    --title "Codex low child session" \\
    --work-package codex-low-standby \\
    --instruction "You are working on hayashikentaro/task-deck. First read AGENTS.md. Do not edit files yet. Report that you are ready and wait for a scoped parent instruction."

Options:
  --title <title>              Required child task title.
  --work-package <id>          Required workPackageId.
  --instruction <text>         Required initialInstruction.
  --cwd <path>                 TaskDeck-server-visible cwd. Default: .
  --profile <id>               Agent profile id. Default: codex.
  --permission <level>         full_access, workspace_write, or read_only. Default: full_access.
  --reasoning <effort>         low, medium, high, or xhigh. Default: low.
  --reason <text>              Batch reason.
  --file <path>                Repeatable filesLikelyToChange entry.
  --request-id <id>            Optional request id.
  --help                       Show this help.`;
}

function readOption(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseWriteChildSessionRequestArgs(args, env = process.env) {
  const draft = {
    requestId: "",
    parentTaskId: String(env.TASKDECK_TASK_ID || "").trim(),
    reason: "Create a child session using the file-based TaskDeck request writer.",
    title: "",
    agentProfileId: "codex",
    agentPermissionLevel: "full_access",
    agentReasoningEffort: "low",
    cwd: ".",
    workPackageId: "",
    filesLikelyToChange: [],
    initialInstruction: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true };
      case "--title":
        draft.title = readOption(args, index, arg);
        index += 1;
        break;
      case "--cwd":
        draft.cwd = readOption(args, index, arg);
        index += 1;
        break;
      case "--work-package":
      case "--workPackageId":
        draft.workPackageId = readOption(args, index, arg);
        index += 1;
        break;
      case "--instruction":
        draft.initialInstruction = readOption(args, index, arg);
        index += 1;
        break;
      case "--profile":
        draft.agentProfileId = readOption(args, index, arg);
        index += 1;
        break;
      case "--permission":
        draft.agentPermissionLevel = readOption(args, index, arg);
        index += 1;
        break;
      case "--reasoning":
        draft.agentReasoningEffort = readOption(args, index, arg);
        index += 1;
        break;
      case "--reason":
        draft.reason = readOption(args, index, arg);
        index += 1;
        break;
      case "--file":
        draft.filesLikelyToChange.push(readOption(args, index, arg));
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
  draft.requestId = sanitizeRequestId(draft.requestId) || generateChildSessionRequestId(draft.workPackageId);
  return { draft };
}

export async function writeChildSessionRequestFile(draft, directory = requestDirectory) {
  const request = createChildSessionFileRequestDraft(draft);
  const filePath = path.join(directory, `${request.requestId}.request.json`);
  const tmpPath = `${filePath}.tmp`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(request, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
  return { filePath, request };
}

function validateCliDraft(draft) {
  const missing = [];
  if (!String(draft.title || "").trim()) missing.push("--title");
  if (!String(draft.workPackageId || "").trim()) missing.push("--work-package");
  if (!String(draft.initialInstruction || "").trim()) missing.push("--instruction");
  if (missing.length > 0) {
    throw new Error(`Missing required option${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }

  const cwd = String(draft.cwd || "").trim();
  if (!cwd) {
    throw new Error("--cwd must not be empty.");
  }
  if (cwd.startsWith("/workspace/") || cwd === "/workspace") {
    throw new Error("--cwd must be TaskDeck-server-visible; do not use a container-only /workspace path.");
  }
  if (!String(draft.agentProfileId || "").trim()) {
    throw new Error("--profile must not be empty.");
  }
  if (!permissionLevels.has(String(draft.agentPermissionLevel || ""))) {
    throw new Error(`--permission must be one of: ${Array.from(permissionLevels).join(", ")}`);
  }
  if (!reasoningEfforts.has(String(draft.agentReasoningEffort || ""))) {
    throw new Error(`--reasoning must be one of: ${Array.from(reasoningEfforts).join(", ")}`);
  }
}

async function main() {
  try {
    const parsed = parseWriteChildSessionRequestArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(usage());
      return;
    }
    const { filePath, request } = await writeChildSessionRequestFile(parsed.draft);
    console.log(`Wrote TaskDeck child session request: ${filePath}`);
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
