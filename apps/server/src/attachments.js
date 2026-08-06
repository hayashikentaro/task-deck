import path from "node:path";
import fs from "node:fs/promises";
import { TextDecoder } from "node:util";
import convertHeic from "heic-convert";
import sharp from "sharp";

export const maxAttachmentBytes = 12 * 1024 * 1024;

const imageFormats = new Map([
  [".png", { format: "png", mimeType: "image/png" }],
  [".jpg", { format: "jpeg", mimeType: "image/jpeg" }],
  [".jpeg", { format: "jpeg", mimeType: "image/jpeg" }],
  [".webp", { format: "webp", mimeType: "image/webp" }],
  [".gif", { format: "gif", mimeType: "image/gif", convertToPng: true }],
  [".heic", { format: "heic", mimeType: "image/heic", convertToPng: true }],
  [".heif", { format: "heic", mimeType: "image/heif", convertToPng: true }],
]);

const textExtensions = new Set([
  ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
  ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf", ".env", ".diff", ".patch",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh",
  ".fish", ".ps1", ".sql", ".graphql", ".gql", ".proto", ".vue", ".svelte",
]);

const documentFormats = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

const officeRequiredEntries = new Map([
  [".docx", "word/document.xml"],
  [".xlsx", "xl/workbook.xml"],
  [".pptx", "ppt/presentation.xml"],
]);

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class AttachmentError extends Error {
  constructor(message, statusCode = 415) {
    super(message);
    this.name = "AttachmentError";
    this.statusCode = statusCode;
  }
}

export async function prepareAttachment({ buffer, filename }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AttachmentError("Attachment body is required.", 400);
  }
  enforceAttachmentSize(buffer);

  const safeSourceFilename = sanitizeSourceFilename(filename);
  const extension = attachmentExtension(safeSourceFilename);
  const imageFormat = imageFormats.get(extension);
  if (imageFormat) {
    return prepareImageAttachment(buffer, safeSourceFilename, imageFormat);
  }

  if (textExtensions.has(extension)) {
    validateUtf8Text(buffer);
    return buildPreparedFile(buffer, safeSourceFilename, "text/plain");
  }

  const documentMimeType = documentFormats.get(extension);
  if (documentMimeType) {
    validateDocument(buffer, extension);
    return buildPreparedFile(buffer, safeSourceFilename, documentMimeType);
  }

  throw new AttachmentError("Unsupported attachment type.");
}

export function sanitizeSourceFilename(filename) {
  const rawBasename = path.basename(String(filename || "attachment")).trim();
  return rawBasename
    .replace(/[^\w .()-]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "attachment";
}

export async function finalizePendingAttachments({ pendingRoot, attachmentRoot, pendingAttachments, taskId, onError }) {
  const finalizedAttachments = [];
  if (!Array.isArray(pendingAttachments) || !pendingAttachments.length) {
    return finalizedAttachments;
  }

  const taskAttachmentRoot = path.join(attachmentRoot, taskId);
  await fs.mkdir(taskAttachmentRoot, { recursive: true });

  for (const pendingAttachment of pendingAttachments) {
    const id = String(pendingAttachment?.id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      continue;
    }

    try {
      const metadataPath = path.join(pendingRoot, `${id}.json`);
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const type = metadata.type === "image" ? "image" : metadata.type === "file" ? "file" : "";
      const mimeType = String(metadata.mimeType || "").trim();
      const storedFilename = path.basename(String(metadata.storedFilename || ""));
      const filename = sanitizeSourceFilename(metadata.filename || "attachment");
      const extension = attachmentExtension(filename);
      if (!type || !mimeType || !storedFilename || !extension) {
        throw new Error("invalid attachment metadata");
      }

      const sourcePath = path.join(pendingRoot, storedFilename);
      const destinationPath = path.join(taskAttachmentRoot, `${id}${extension}`);
      await fs.rename(sourcePath, destinationPath);
      await fs.rm(metadataPath, { force: true });

      finalizedAttachments.push({
        id,
        type,
        filename,
        path: destinationPath,
        mimeType,
        size: Number.isFinite(Number(metadata.size)) ? Number(metadata.size) : 0,
        createdAt: String(metadata.createdAt || new Date().toISOString()),
      });
    } catch (error) {
      onError?.(id, error);
    }
  }

  return finalizedAttachments;
}

async function prepareImageAttachment(buffer, filename, imageFormat) {
  try {
    if (imageFormat.format === "heic") {
      const converted = Buffer.from(await convertHeic({ buffer, format: "JPEG", quality: 0.9 }));
      enforceAttachmentSize(converted);
      await assertSharpImageFormat(converted, "jpeg");
      return buildPreparedImage(converted, replaceExtension(filename, ".jpg"), "image/jpeg", ".jpg");
    }

    await assertSharpImageFormat(buffer, imageFormat.format);
    if (imageFormat.convertToPng) {
      const converted = await sharp(buffer, { animated: false, failOn: "error" }).png().toBuffer();
      enforceAttachmentSize(converted);
      return buildPreparedImage(converted, replaceExtension(filename, ".png"), "image/png", ".png");
    }

    const extension = imageFormat.format === "jpeg" ? ".jpg" : `.${imageFormat.format}`;
    return buildPreparedImage(buffer, replaceExtension(filename, extension), imageFormat.mimeType, extension);
  } catch (error) {
    if (error instanceof AttachmentError) {
      throw error;
    }
    throw new AttachmentError(`Invalid or unsupported image data: ${error.message}`, 400);
  }
}

function enforceAttachmentSize(buffer) {
  if (buffer.length > maxAttachmentBytes) {
    throw new AttachmentError("Attachment exceeds 12 MB after processing.", 413);
  }
}

async function assertSharpImageFormat(buffer, expectedFormat) {
  const metadata = await sharp(buffer, { animated: false, failOn: "error" }).metadata();
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`expected ${expectedFormat} image data`);
  }
}

function validateUtf8Text(buffer) {
  if (buffer.includes(0)) {
    throw new AttachmentError("Text attachment contains binary data.", 400);
  }
  try {
    utf8Decoder.decode(buffer);
  } catch {
    throw new AttachmentError("Text attachment must use UTF-8 encoding.", 400);
  }
}

function validateDocument(buffer, extension) {
  if (extension === ".pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new AttachmentError("Invalid PDF data.", 400);
    }
    return;
  }

  const signature = buffer.subarray(0, 4).toString("hex");
  if (!["504b0304", "504b0506", "504b0708"].includes(signature)) {
    throw new AttachmentError("Invalid Office document data.", 400);
  }
  const requiredEntry = officeRequiredEntries.get(extension);
  if (!buffer.includes(Buffer.from("[Content_Types].xml")) || !buffer.includes(Buffer.from(requiredEntry))) {
    throw new AttachmentError(`Invalid ${extension.slice(1).toUpperCase()} document data.`, 400);
  }
}

function buildPreparedImage(buffer, filename, mimeType, extension) {
  return { buffer, type: "image", filename, mimeType, extension };
}

function buildPreparedFile(buffer, filename, mimeType) {
  return { buffer, type: "file", filename, mimeType, extension: path.extname(filename).toLowerCase() };
}

function replaceExtension(filename, extension) {
  const currentExtension = path.extname(filename);
  const basename = path.basename(filename, currentExtension).trim() || "attachment";
  return `${basename}${extension}`;
}

export function attachmentExtension(filename) {
  const basename = path.basename(filename).toLowerCase();
  if (basename.startsWith(".") && !basename.slice(1).includes(".")) {
    return basename;
  }
  return path.extname(basename);
}
