export type OutputTextPart =
  | { kind: "text"; text: string }
  | { kind: "web"; text: string; url: string }
  | { kind: "local-path"; text: string; path: string };

const outputLinkPattern =
  /(^|[\s([{<])((?:(?:https?:\/\/|file:\/\/|www\.)[^\s<>"'`]+|(?:(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:.]+\]):\d{1,5})(?:\/[^\s<>"'`]*)?|(?:~\/|\/)[^\s<>"'`]+))/gi;
const trailingLinkPunctuation = /[),.;:!?}\]>]+$/;

export function parseOutputLinks(text: string): OutputTextPart[] {
  const parts: OutputTextPart[] = [];
  const matcher = new RegExp(outputLinkPattern);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const linkText = trimTrailingLinkPunctuation(match[2]);
    if (!linkText) {
      continue;
    }

    const startIndex = match.index + match[1].length;
    if (startIndex > lastIndex) {
      parts.push({ kind: "text", text: text.slice(lastIndex, startIndex) });
    }

    if (isLocalPathLink(linkText)) {
      parts.push({ kind: "local-path", text: linkText, path: linkText });
    } else {
      parts.push({ kind: "web", text: linkText, url: normalizeWebLink(linkText) });
    }
    lastIndex = startIndex + linkText.length;
  }

  if (lastIndex === 0) {
    return [{ kind: "text", text }];
  }
  if (lastIndex < text.length) {
    parts.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return parts;
}

function trimTrailingLinkPunctuation(value: string) {
  let trimmed = value;
  while (trailingLinkPunctuation.test(trimmed)) {
    const next = trimmed.replace(trailingLinkPunctuation, "");
    if (next === trimmed) {
      break;
    }
    trimmed = next;
  }
  return trimmed;
}

function isLocalPathLink(value: string) {
  return /^file:\/\//i.test(value) || value.startsWith("/") || value.startsWith("~/");
}

function normalizeWebLink(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (/^www\./i.test(value)) {
    return `https://${value}`;
  }
  return `http://${value}`;
}
