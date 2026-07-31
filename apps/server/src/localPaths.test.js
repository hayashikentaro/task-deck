import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LocalPathError,
  buildLocalPathPreview,
  localPathOpenCommand,
  resolveLocalPath,
} from "./localPaths.js";

test("resolves absolute, file URL, and home-relative paths within home", async (context) => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "taskdeck-local-paths-"));
  context.after(() => fs.rm(homeDirectory, { recursive: true, force: true }));
  const filePath = path.join(homeDirectory, "hello world.txt");
  await fs.writeFile(filePath, "hello\nworld\n");
  const canonicalFilePath = await fs.realpath(filePath);

  assert.equal(await resolveLocalPath(filePath, { homeDirectory }), canonicalFilePath);
  assert.equal(await resolveLocalPath(new URL(`file://${filePath}`).toString(), { homeDirectory }), canonicalFilePath);
  assert.equal(await resolveLocalPath("~/hello world.txt", { homeDirectory }), canonicalFilePath);
});

test("rejects paths outside home after resolving symlinks", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taskdeck-local-paths-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDirectory = path.join(root, "home");
  const outsideDirectory = path.join(root, "outside");
  await fs.mkdir(homeDirectory);
  await fs.mkdir(outsideDirectory);
  await fs.writeFile(path.join(outsideDirectory, "secret.txt"), "secret");
  await fs.symlink(path.join(outsideDirectory, "secret.txt"), path.join(homeDirectory, "linked.txt"));

  await assert.rejects(
    resolveLocalPath(path.join(homeDirectory, "linked.txt"), { homeDirectory }),
    (error) => error instanceof LocalPathError && error.status === 403,
  );
});

test("builds bounded text and directory previews", async (context) => {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "taskdeck-local-paths-"));
  context.after(() => fs.rm(homeDirectory, { recursive: true, force: true }));
  const textPath = path.join(homeDirectory, "notes.txt");
  await fs.writeFile(textPath, Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"));
  for (let index = 0; index < 10; index += 1) {
    await fs.writeFile(path.join(homeDirectory, `file-${index}.txt`), "x");
  }

  const textPreview = await buildLocalPathPreview(textPath, { homeDirectory });
  assert.equal(textPreview.kind, "text");
  assert.equal(textPreview.lines.length, 8);

  const directoryPreview = await buildLocalPathPreview(homeDirectory, { homeDirectory });
  assert.equal(directoryPreview.kind, "directory");
  assert.equal(directoryPreview.entries.length, 8);
});

test("selects shell-free OS opener commands", () => {
  assert.deepEqual(localPathOpenCommand("/tmp/a", "darwin"), { command: "open", args: ["/tmp/a"] });
  assert.deepEqual(localPathOpenCommand("/tmp/a", "linux"), { command: "xdg-open", args: ["/tmp/a"] });
  assert.deepEqual(localPathOpenCommand("C:\\a", "win32"), { command: "explorer.exe", args: ["C:\\a"] });
});
