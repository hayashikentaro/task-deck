import { describe, expect, it } from "vitest";
import { parseOutputLinks } from "./outputLinks";

describe("output link parsing", () => {
  it("preserves Codex login URLs with query parameters", () => {
    const url = "https://auth.openai.com/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback#login";

    expect(parseOutputLinks(`[TaskDeck] Login URL: ${url}\n`)).toEqual([
      { kind: "text", text: "[TaskDeck] Login URL: " },
      { kind: "web", text: url, url },
      { kind: "text", text: "\n" },
    ]);
  });

  it("recognizes web, localhost, file URL, absolute, and home-relative links", () => {
    expect(parseOutputLinks("www.example.com localhost:3000/a file:///Users/me/a.txt /Users/me/b.txt ~/c.txt")).toEqual([
      { kind: "web", text: "www.example.com", url: "https://www.example.com" },
      { kind: "text", text: " " },
      { kind: "web", text: "localhost:3000/a", url: "http://localhost:3000/a" },
      { kind: "text", text: " " },
      { kind: "local-path", text: "file:///Users/me/a.txt", path: "file:///Users/me/a.txt" },
      { kind: "text", text: " " },
      { kind: "local-path", text: "/Users/me/b.txt", path: "/Users/me/b.txt" },
      { kind: "text", text: " " },
      { kind: "local-path", text: "~/c.txt", path: "~/c.txt" },
    ]);
  });

  it("keeps surrounding punctuation outside the link", () => {
    expect(parseOutputLinks("See (https://example.com/path). Then [/Users/me/file.txt].")).toEqual([
      { kind: "text", text: "See (" },
      { kind: "web", text: "https://example.com/path", url: "https://example.com/path" },
      { kind: "text", text: "). Then [" },
      { kind: "local-path", text: "/Users/me/file.txt", path: "/Users/me/file.txt" },
      { kind: "text", text: "]." },
    ]);
  });

  it("does not link relative paths or bare localhost names", () => {
    const text = "src/App.tsx localhost example.com";
    expect(parseOutputLinks(text)).toEqual([{ kind: "text", text }]);
  });
});
