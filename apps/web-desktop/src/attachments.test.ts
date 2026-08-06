import { describe, expect, it } from "vitest";
import { attachmentValidationError, maxAttachmentBytes, supportedAttachmentAccept } from "@taskdeck/web-shared";

describe("attachment validation", () => {
  it("accepts image, source, document, and dotfile extensions", () => {
    for (const name of ["screen.heic", "animation.gif", "state.ts", ".env", "report.pdf", "sheet.xlsx"]) {
      expect(attachmentValidationError({ name, size: 100 })).toBe("");
    }
  });

  it("rejects unsupported extensions and oversized files", () => {
    expect(attachmentValidationError({ name: "archive.zip", size: 100 })).toContain("unsupported");
    expect(attachmentValidationError({ name: "README", size: 100 })).toContain("unsupported");
    expect(attachmentValidationError({ name: "large.pdf", size: maxAttachmentBytes + 1 })).toContain("12 MB");
  });

  it("exposes the native file picker allowlist", () => {
    expect(supportedAttachmentAccept).toContain(".heic");
    expect(supportedAttachmentAccept).toContain(".docx");
  });
});
