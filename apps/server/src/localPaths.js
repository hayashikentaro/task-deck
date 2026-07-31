import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const imageMimeTypes = new Map([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const textPreviewExtensions = new Set([
  ".css",
  ".csv",
  ".json",
  ".log",
  ".md",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const maxImagePreviewBytes = 5 * 1024 * 1024;
const maxTextPreviewBytes = 64 * 1024;
const maxPreviewLines = 8;
const maxDirectoryEntries = 8;

export class LocalPathError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "LocalPathError";
    this.status = status;
  }
}

export async function resolveLocalPath(input, { homeDirectory = os.homedir() } = {}) {
  const rawPath = String(input || "").trim();
  if (!rawPath) {
    throw new LocalPathError("Local path is required.");
  }

  const candidatePath = normalizeLocalPath(rawPath, homeDirectory);
  const [canonicalHome, canonicalPath] = await Promise.all([
    fs.realpath(homeDirectory).catch(() => {
      throw new LocalPathError("Home directory is unavailable.", 500);
    }),
    fs.realpath(candidatePath).catch((error) => {
      if (error?.code === "ENOENT") {
        throw new LocalPathError("Local path does not exist.", 404);
      }
      throw new LocalPathError("Local path could not be resolved.", 400);
    }),
  ]);

  if (!isPathWithinRoot(canonicalPath, canonicalHome)) {
    throw new LocalPathError("Local path is outside the home directory.", 403);
  }
  return canonicalPath;
}

export async function buildLocalPathPreview(input, options) {
  const canonicalPath = await resolveLocalPath(input, options);
  const metadata = await fs.stat(canonicalPath);
  const title = path.basename(canonicalPath) || canonicalPath;

  if (metadata.isDirectory()) {
    const entries = await fs.readdir(canonicalPath, { withFileTypes: true });
    return {
      kind: "directory",
      title,
      subtitle: canonicalPath,
      entries: entries.slice(0, maxDirectoryEntries).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`),
    };
  }

  const extension = path.extname(canonicalPath).toLowerCase();
  const mimeType = imageMimeTypes.get(extension);
  if (mimeType && metadata.size <= maxImagePreviewBytes) {
    return {
      kind: "image",
      title,
      subtitle: formatFileSize(metadata.size),
      mimeType,
      data: (await fs.readFile(canonicalPath)).toString("base64"),
    };
  }

  if (textPreviewExtensions.has(extension)) {
    return {
      kind: "text",
      title,
      subtitle: formatFileSize(metadata.size),
      lines: await readTextPreviewLines(canonicalPath),
    };
  }

  return {
    kind: "unknown",
    title,
    subtitle: `${canonicalPath} | ${formatFileSize(metadata.size)}`,
  };
}

export async function openLocalPath(input, options) {
  const canonicalPath = await resolveLocalPath(input, options);
  const { command, args } = localPathOpenCommand(canonicalPath);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  }).catch(() => {
    throw new LocalPathError("Local path could not be opened.", 500);
  });

  return canonicalPath;
}

export function localPathOpenCommand(canonicalPath, platform = os.platform()) {
  if (platform === "darwin") {
    return { command: "open", args: [canonicalPath] };
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [canonicalPath] };
  }
  return { command: "xdg-open", args: [canonicalPath] };
}

function normalizeLocalPath(rawPath, homeDirectory) {
  if (/^file:\/\//i.test(rawPath)) {
    try {
      return fileURLToPath(new URL(rawPath));
    } catch {
      throw new LocalPathError("Local file URL is invalid.");
    }
  }
  if (rawPath === "~") {
    return homeDirectory;
  }
  if (rawPath.startsWith("~/")) {
    return path.join(homeDirectory, rawPath.slice(2));
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  throw new LocalPathError("Local path must be absolute, file://, or home-relative.");
}

function isPathWithinRoot(candidatePath, rootPath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));
}

async function readTextPreviewLines(filePath) {
  const file = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxTextPreviewBytes);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).slice(0, maxPreviewLines);
  } finally {
    await file.close();
  }
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
