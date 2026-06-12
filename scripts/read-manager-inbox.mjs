#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  managerEventFilenames,
  validateManagerEvent,
} from "@taskdeck/core/manager-inbox";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const defaultInboxDirectory = path.join(repoRoot, ".taskdeck", "manager-inbox");
const ACK_KIND = "taskDeckManagerEventAck";
const ACK_VERSION = 1;

function usage() {
  return `Usage:
  node scripts/read-manager-inbox.mjs [--ack] [--json] [--inbox <path>]

Options:
  --ack           Write .ack.json files for valid unread events after reading.
  --json          Print unread valid events as a JSON array.
  --inbox <path>  Read a custom manager inbox directory. Default: .taskdeck/manager-inbox.
  --help          Show this help.`;
}

function readOption(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseReadManagerInboxArgs(args) {
  const parsed = {
    inbox: defaultInboxDirectory,
    ack: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--ack":
        parsed.ack = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--inbox":
        parsed.inbox = path.resolve(readOption(args, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function readManagerInbox({ inbox = defaultInboxDirectory, ack = false, ackedAt = new Date().toISOString() } = {}) {
  const entries = await readInboxDirectory(inbox);
  const validEntries = [];
  const invalidEvents = [];

  for (const filename of entries) {
    if (!isManagerEventFilename(filename)) {
      continue;
    }

    const eventIdFromFilename = path.basename(filename, ".json");
    const eventPath = path.join(inbox, filename);
    const filenames = managerEventFilenames(eventIdFromFilename);
    if (await fileExists(path.join(inbox, filenames.ack))) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(eventPath, "utf8"));
    } catch (error) {
      invalidEvents.push({ filename, error: `Could not parse event JSON: ${error.message}` });
      continue;
    }

    const validation = validateManagerEvent(parsed);
    if (!validation.ok) {
      invalidEvents.push({ filename, error: validation.error });
      continue;
    }
    if (validation.event.eventId !== eventIdFromFilename) {
      invalidEvents.push({ filename, error: "eventId must match the event filename." });
      continue;
    }

    validEntries.push({ filename, event: validation.event });
  }

  validEntries.sort(compareManagerEventEntries);

  let ackedCount = 0;
  if (ack) {
    for (const entry of validEntries) {
      if (await writeManagerEventAck(inbox, entry.event, ackedAt)) {
        ackedCount += 1;
      }
    }
  }

  return {
    inbox,
    events: validEntries.map((entry) => entry.event),
    invalidEvents,
    ackedCount,
  };
}

export function formatManagerInboxReport(events, { ackedCount = 0 } = {}) {
  const lines = [`Unread TaskDeck manager events: ${events.length}`];

  for (const event of events) {
    lines.push("");
    lines.push(`[${event.type}] ${event.state}${formatWorkPackage(event)} child=${event.childTaskId}`);
    if (event.summary) {
      lines.push(event.summary);
    }
    if (event.artifacts.length > 0) {
      lines.push("Artifacts:");
      for (const artifact of event.artifacts) {
        lines.push(`- ${artifact}`);
      }
    }
    if (event.detailsFile) {
      lines.push(`Details: ${event.detailsFile}`);
    }
  }

  if (ackedCount > 0) {
    lines.push("");
    lines.push(`Acked ${ackedCount} ${ackedCount === 1 ? "event" : "events"}.`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatInvalidManagerEventWarnings(invalidEvents) {
  if (!invalidEvents.length) {
    return "";
  }

  const lines = [`Skipped invalid TaskDeck manager event files: ${invalidEvents.length}`];
  for (const invalidEvent of invalidEvents) {
    lines.push(`- ${invalidEvent.filename}: ${invalidEvent.error}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readInboxDirectory(inbox) {
  try {
    return await fs.readdir(inbox);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isManagerEventFilename(filename) {
  return filename.endsWith(".json") && !filename.endsWith(".ack.json") && !filename.endsWith(".tmp");
}

function compareManagerEventEntries(left, right) {
  const createdAtOrder = left.event.createdAt.localeCompare(right.event.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }
  return left.event.eventId.localeCompare(right.event.eventId);
}

async function writeManagerEventAck(inbox, event, ackedAt) {
  const filenames = managerEventFilenames(event.eventId);
  const ackPath = path.join(inbox, filenames.ack);
  const tempPath = `${ackPath}.tmp`;
  if (await fileExists(ackPath)) {
    return false;
  }

  const ack = {
    kind: ACK_KIND,
    version: ACK_VERSION,
    eventId: event.eventId,
    ackedAt,
  };

  await fs.writeFile(tempPath, `${JSON.stringify(ack, null, 2)}\n`);
  await fs.rename(tempPath, ackPath);
  return true;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatWorkPackage(event) {
  return event.workPackageId ? ` workPackage=${event.workPackageId}` : "";
}

async function main() {
  try {
    const parsed = parseReadManagerInboxArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log(usage());
      return;
    }

    const result = await readManagerInbox(parsed);
    const warnings = formatInvalidManagerEventWarnings(result.invalidEvents);
    if (warnings) {
      console.error(warnings.trimEnd());
    }

    if (parsed.json) {
      console.log(JSON.stringify(result.events, null, 2));
      if (result.ackedCount > 0) {
        console.error(`Acked ${result.ackedCount} ${result.ackedCount === 1 ? "event" : "events"}.`);
      }
      return;
    }

    process.stdout.write(formatManagerInboxReport(result.events, { ackedCount: result.ackedCount }));
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
