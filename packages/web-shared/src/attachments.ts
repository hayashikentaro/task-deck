export const maxAttachmentBytes = 12 * 1024 * 1024;

export const supportedAttachmentExtensions = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif",
  ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
  ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf", ".env", ".diff", ".patch",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".php", ".sh", ".bash", ".zsh",
  ".fish", ".ps1", ".sql", ".graphql", ".gql", ".proto", ".vue", ".svelte",
  ".pdf", ".docx", ".xlsx", ".pptx",
] as const;

export const supportedAttachmentAccept = supportedAttachmentExtensions.join(",");

const supportedAttachmentExtensionSet = new Set<string>(supportedAttachmentExtensions);

export function attachmentValidationError(file: { name: string; size: number }) {
  const basename = file.name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const lastDotIndex = basename.lastIndexOf(".");
  const extension = basename.startsWith(".") && lastDotIndex === 0
    ? basename
    : lastDotIndex >= 0
      ? basename.slice(lastDotIndex)
      : "";
  if (!supportedAttachmentExtensionSet.has(extension)) {
    return `${file.name}: unsupported attachment type.`;
  }
  if (file.size > maxAttachmentBytes) {
    return `${file.name}: attachment exceeds 12 MB.`;
  }
  return "";
}
