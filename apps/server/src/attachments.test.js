import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  AttachmentError,
  finalizePendingAttachments,
  maxAttachmentBytes,
  prepareAttachment,
  sanitizeSourceFilename,
} from "./attachments.js";

test("accepts and validates supported native image formats", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  const prepared = await prepareAttachment({ buffer: png, filename: "screen.png" });

  assert.equal(prepared.type, "image");
  assert.equal(prepared.filename, "screen.png");
  assert.equal(prepared.mimeType, "image/png");
  assert.equal(prepared.buffer, png);
});

test("converts GIF images to PNG", async () => {
  const gif = await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).gif().toBuffer();
  const prepared = await prepareAttachment({ buffer: gif, filename: "animation.gif" });
  const metadata = await sharp(prepared.buffer).metadata();

  assert.equal(prepared.type, "image");
  assert.equal(prepared.filename, "animation.png");
  assert.equal(prepared.mimeType, "image/png");
  assert.equal(metadata.format, "png");
});

test("accepts UTF-8 text and source files", async () => {
  const prepared = await prepareAttachment({ buffer: Buffer.from("const ready = true;\n"), filename: "state.ts" });
  const env = await prepareAttachment({ buffer: Buffer.from("READY=true\n"), filename: ".env" });

  assert.equal(prepared.type, "file");
  assert.equal(prepared.filename, "state.ts");
  assert.equal(prepared.mimeType, "text/plain");
  assert.equal(env.filename, ".env");
});

test("accepts PDF and Office signatures", async () => {
  const pdf = await prepareAttachment({ buffer: Buffer.from("%PDF-1.7\nbody"), filename: "notes.pdf" });
  const docx = await prepareAttachment({
    buffer: Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("[Content_Types].xml word/document.xml"),
    ]),
    filename: "notes.docx",
  });

  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(docx.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("rejects unsupported, spoofed, and binary text files", async () => {
  await assert.rejects(
    prepareAttachment({ buffer: Buffer.from("not an image"), filename: "fake.png" }),
    (error) => error instanceof AttachmentError && error.statusCode === 400,
  );
  await assert.rejects(
    prepareAttachment({ buffer: Buffer.from([0, 1, 2]), filename: "fake.txt" }),
    /binary data/,
  );
  await assert.rejects(
    prepareAttachment({ buffer: Buffer.from("data"), filename: "archive.zip" }),
    /Unsupported attachment type/,
  );
  await assert.rejects(
    prepareAttachment({ buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]), filename: "fake.docx" }),
    /Invalid DOCX/,
  );
  await assert.rejects(
    prepareAttachment({ buffer: Buffer.alloc(maxAttachmentBytes + 1, 1), filename: "large.txt" }),
    (error) => error instanceof AttachmentError && error.statusCode === 413,
  );
});

test("sanitizes attachment filenames without losing their extension", () => {
  assert.equal(sanitizeSourceFilename("../仕様 /review?.md"), "review_.md");
});

test("moves pending attachments into task-owned storage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taskdeck-attachments-"));
  const pendingRoot = path.join(root, "pending");
  const attachmentRoot = path.join(root, "attachments");
  const id = "01234567-89ab-cdef-0123-456789abcdef";
  await fs.mkdir(pendingRoot, { recursive: true });
  await fs.writeFile(path.join(pendingRoot, `${id}.md`), "# Review\n");
  await fs.writeFile(path.join(pendingRoot, `${id}.json`), JSON.stringify({
    id,
    type: "file",
    filename: "review.md",
    storedFilename: `${id}.md`,
    mimeType: "text/plain",
    size: 9,
    createdAt: "2026-08-06T00:00:00.000Z",
  }));

  try {
    const finalized = await finalizePendingAttachments({
      pendingRoot,
      attachmentRoot,
      pendingAttachments: [{ id }],
      taskId: "task-1",
    });

    assert.equal(finalized.length, 1);
    assert.equal(finalized[0].path, path.join(attachmentRoot, "task-1", `${id}.md`));
    assert.equal(await fs.readFile(finalized[0].path, "utf8"), "# Review\n");
    await assert.rejects(fs.access(path.join(pendingRoot, `${id}.json`)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
