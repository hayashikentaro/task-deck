import fs from "node:fs/promises";
import path from "node:path";

export function normalizeTeamTemplatesConfig(value) {
  if (!Array.isArray(value?.teamTemplates)) {
    return [];
  }

  return value.teamTemplates
    .map(normalizeTeamTemplate)
    .filter(Boolean);
}

export async function loadTeamTemplatesFromFile(filePath) {
  try {
    const rawContents = await fs.readFile(filePath, "utf8");
    return normalizeTeamTemplatesConfig(JSON.parse(rawContents));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function mergeTeamTemplates(...templateGroups) {
  const mergedTemplates = [];
  const indexById = new Map();
  for (const templates of templateGroups) {
    for (const template of Array.isArray(templates) ? templates : []) {
      const id = normalizedString(template?.id);
      if (!id) {
        continue;
      }
      if (indexById.has(id)) {
        mergedTemplates[indexById.get(id)] = template;
        continue;
      }
      indexById.set(id, mergedTemplates.length);
      mergedTemplates.push(template);
    }
  }
  return mergedTemplates;
}

export async function buildTeamTemplateInitialInstruction({
  template,
  documentRoot,
  userInstruction = "",
} = {}) {
  const instructions = Array.isArray(template?.instructions) ? template.instructions : [];
  const promptFiles = Array.isArray(template?.promptFiles) ? template.promptFiles : [];
  const promptContents = [];
  for (const promptFile of promptFiles) {
    const resolvedPromptPath = resolveTeamTemplatePromptFile(documentRoot, promptFile);
    promptContents.push((await fs.readFile(resolvedPromptPath, "utf8")).trim());
  }

  return [
    "TaskDeck team template instructions:",
    [...instructions, ...promptContents].filter(Boolean).join("\n\n"),
    "",
    "User launch instruction:",
    String(userInstruction || "").trim(),
  ].join("\n").trim();
}

export function resolveTeamTemplatePromptFile(documentRoot, promptFile) {
  const normalizedPromptFile = String(promptFile || "").trim();
  if (!normalizedPromptFile || path.isAbsolute(normalizedPromptFile)) {
    throw new Error("Team template promptFiles must be relative paths.");
  }
  const resolvedRoot = path.resolve(documentRoot || ".");
  const resolvedPromptPath = path.resolve(resolvedRoot, normalizedPromptFile);
  const relativePromptPath = path.relative(resolvedRoot, resolvedPromptPath);
  if (relativePromptPath.startsWith("..") || path.isAbsolute(relativePromptPath)) {
    throw new Error("Team template promptFiles must stay within the TaskDeck document root.");
  }
  return resolvedPromptPath;
}

function normalizeTeamTemplate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = normalizedString(value.id);
  const label = normalizedString(value.label);
  const agentProfileId = normalizedString(value.agentProfileId);
  const teamId = normalizedString(value.teamId);
  const roleId = normalizedString(value.roleId);
  if (!id || !label || !agentProfileId || !teamId || !roleId) {
    return null;
  }

  if (value.promptFiles !== undefined && !Array.isArray(value.promptFiles)) {
    return null;
  }
  if (value.instructions !== undefined && !Array.isArray(value.instructions)) {
    return null;
  }

  const instructions = Array.isArray(value.instructions)
    ? value.instructions.map((instruction) => normalizedString(instruction)).filter(Boolean)
    : [];
  const promptFiles = Array.isArray(value.promptFiles)
    ? value.promptFiles.map((promptFile) => normalizedString(promptFile)).filter(Boolean)
    : [];
  if (promptFiles.some((promptFile) => path.isAbsolute(promptFile))) {
    return null;
  }

  return {
    id,
    label,
    description: normalizedString(value.description),
    agentProfileId,
    teamId,
    roleId,
    instructions,
    promptFiles,
    decisionGateway: normalizeTeamTemplateDecisionGateway(value.decisionGateway),
    loop: normalizeTeamTemplateLoop(value.loop),
  };
}

function normalizeTeamTemplateDecisionGateway(value) {
  return {
    required: value?.required === true,
    autoDeliver: value?.autoDeliver === true,
    requireResumeActions: value?.requireResumeActions === true,
  };
}

function normalizeTeamTemplateLoop(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return {
    requireDecisionBeforeEachCycle: value.requireDecisionBeforeEachCycle === true,
  };
}

function normalizedString(value) {
  return String(value || "").trim();
}
