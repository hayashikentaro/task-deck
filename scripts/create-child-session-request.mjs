#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

const startMarker = "TASKDECK_CHILD_SESSION_BATCH_REQUEST";
const endMarker = "END_TASKDECK_CHILD_SESSION_BATCH_REQUEST";
const permissionLevels = new Set(["full_access", "workspace_write", "read_only"]);
const reasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);

function usage() {
  return `Usage:
  node scripts/create-child-session-request.mjs \\
    --title "Codex low child session" \\
    --cwd /Users/hayashikentarou/Documents/task-deck \\
    --work-package codex-low-standby \\
    --instruction "You are working on hayashikentaro/task-deck. First read AGENTS.md. Do not edit files yet. Report that you are ready and wait for a scoped parent instruction."

Options:
  --title <title>              Required child task title.
  --cwd <path>                 Required TaskDeck-server-visible cwd.
  --work-package <id>          Required workPackageId.
  --instruction <text>         Required initialInstruction.
  --profile <id>               Agent profile id. Default: codex.
  --permission <level>         full_access, workspace_write, or read_only. Default: read_only.
  --reasoning <effort>         low, medium, high, or xhigh. Default: low.
  --reason <text>              Batch reason.
  --file <path>                Repeatable filesLikelyToChange entry.
  --help                       Show this help.`;
}

function readOption(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseChildSessionRequestArgs(args) {
  const draft = {
    reason: "Create a child session using the typed child-session request generator.",
    title: "",
    agentProfileId: "codex",
    agentPermissionLevel: "read_only",
    agentReasoningEffort: "low",
    cwd: "",
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
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { draft };
}

export function createChildSessionBatchRequestBlockFromCliDraft(draft) {
  const title = String(draft.title || "").trim();
  const agentProfileId = String(draft.agentProfileId || "").trim();
  const agentPermissionLevel = String(draft.agentPermissionLevel || "").trim();
  const agentReasoningEffort = String(draft.agentReasoningEffort || "").trim();
  const cwd = String(draft.cwd || "").trim();
  const workPackageId = String(draft.workPackageId || "").trim();
  const initialInstruction = String(draft.initialInstruction || "");
  const reason = String(draft.reason || "").trim();

  const missing = [];
  if (!title) missing.push("--title");
  if (!cwd) missing.push("--cwd");
  if (!workPackageId) missing.push("--work-package");
  if (!initialInstruction.trim()) missing.push("--instruction");
  if (missing.length > 0) {
    throw new Error(`Missing required option${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }
  if (!agentProfileId) {
    throw new Error("--profile must not be empty.");
  }
  if (agentPermissionLevel && !permissionLevels.has(agentPermissionLevel)) {
    throw new Error(`--permission must be one of: ${Array.from(permissionLevels).join(", ")}`);
  }
  if (agentReasoningEffort && !reasoningEfforts.has(agentReasoningEffort)) {
    throw new Error(`--reasoning must be one of: ${Array.from(reasoningEfforts).join(", ")}`);
  }

  const request = {
    version: 1,
    reason,
    sessions: [
      {
        title,
        agentProfileId,
        ...(agentPermissionLevel ? { agentPermissionLevel } : {}),
        ...(agentReasoningEffort ? { agentReasoningEffort } : {}),
        cwd,
        workPackageId,
        filesLikelyToChange: Array.isArray(draft.filesLikelyToChange) ? draft.filesLikelyToChange : [],
        initialInstruction,
      },
    ],
  };

  return [startMarker, JSON.stringify(request, null, 2), endMarker].join("\n");
}

function main() {
  try {
    const parsed = parseChildSessionRequestArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(usage());
      return;
    }
    console.log(createChildSessionBatchRequestBlockFromCliDraft(parsed.draft));
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
