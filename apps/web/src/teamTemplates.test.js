import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTask, serializeTask } from "@taskdeck/core";
import {
  buildTeamTemplateInitialInstruction,
  loadTeamTemplatesFromFile,
  mergeTeamTemplates,
  normalizeTeamTemplatesConfig,
} from "@taskdeck/core/team-templates";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("TaskDeck team template helpers", () => {
  it("loads a valid taskdeck.team-templates.json", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "taskdeck-team-template-"));
    try {
      const templatePath = path.join(tempDir, "taskdeck.team-templates.json");
      await writeFile(templatePath, JSON.stringify({
        teamTemplates: [
          {
            id: "decision-aware-solo",
            label: "Decision-aware solo agent",
            agentProfileId: "codex-app-server",
            teamId: "single-decision-aware-agent",
            roleId: "decision-aware-implementation-controller",
            instructions: ["Inline team instructions"],
            promptFiles: ["docs/agents/teams/single-decision-aware-agent.md"],
            decisionGateway: {
              required: true,
              autoDeliver: true,
              requireResumeActions: true,
            },
          },
        ],
      }));

      expect(await loadTeamTemplatesFromFile(templatePath)).toEqual([
        expect.objectContaining({
          id: "decision-aware-solo",
          agentProfileId: "codex-app-server",
          teamId: "single-decision-aware-agent",
          roleId: "decision-aware-implementation-controller",
          instructions: ["Inline team instructions"],
          promptFiles: ["docs/agents/teams/single-decision-aware-agent.md"],
          decisionGateway: {
            required: true,
            autoDeliver: true,
            requireResumeActions: true,
          },
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads the repository decision-aware loop template", async () => {
    const templates = await loadTeamTemplatesFromFile(path.join(repoRoot, "taskdeck.team-templates.json"));
    const soloTemplate = templates.find((template) => template.id === "decision-aware-solo");
    const loopTemplate = templates.find((template) => template.id === "decision-aware-loop");

    expect(soloTemplate).toBeTruthy();
    expect(loopTemplate).toMatchObject({
      id: "decision-aware-loop",
      agentProfileId: "codex-app-server",
      teamId: "single-decision-aware-loop",
      roleId: "decision-aware-loop-controller",
      promptFiles: [],
      instructions: [
        expect.stringContaining("Single Decision-Aware Loop Team"),
        expect.stringContaining("Decision-Aware Loop Controller"),
      ],
      decisionGateway: {
        required: true,
        autoDeliver: true,
        requireResumeActions: true,
      },
      loop: {
        requireDecisionBeforeEachCycle: true,
      },
    });

    expect(loopTemplate.promptFiles).toEqual([]);
    expect(loopTemplate.instructions.join("\n")).toContain("Commit after every completed cycle.");
  });

  it("returns an empty list when taskdeck.team-templates.json is missing", async () => {
    expect(await loadTeamTemplatesFromFile(path.join(os.tmpdir(), "missing-taskdeck-team-templates.json"))).toEqual([]);
  });

  it("merges custom team templates by id after defaults", () => {
    expect(mergeTeamTemplates(
      [
        { id: "decision-aware-solo", label: "Default solo" },
        { id: "decision-aware-loop", label: "Default loop" },
      ],
      [
        { id: "decision-aware-solo", label: "Custom solo" },
        { id: "custom-review", label: "Custom review" },
      ],
    )).toEqual([
      { id: "decision-aware-solo", label: "Custom solo" },
      { id: "decision-aware-loop", label: "Default loop" },
      { id: "custom-review", label: "Custom review" },
    ]);
  });

  it("normalizes invalid configs to an empty list", () => {
    expect(normalizeTeamTemplatesConfig({})).toEqual([]);
    expect(normalizeTeamTemplatesConfig({ teamTemplates: [{ id: "missing-required-fields" }] })).toEqual([]);
    expect(normalizeTeamTemplatesConfig({
      teamTemplates: [
        {
          id: "absolute-prompt",
          label: "Absolute prompt",
          agentProfileId: "codex-app-server",
          teamId: "team",
          roleId: "role",
          promptFiles: [path.join(os.tmpdir(), "prompt.md")],
        },
      ],
    })).toEqual([]);
    expect(normalizeTeamTemplatesConfig({
      teamTemplates: [
        {
          id: "bad-prompt-files",
          label: "Bad prompt files",
          agentProfileId: "codex-app-server",
          teamId: "team",
          roleId: "role",
          promptFiles: "prompt.md",
        },
      ],
    })).toEqual([]);
    expect(normalizeTeamTemplatesConfig({
      teamTemplates: [
        {
          id: "bad-instructions",
          label: "Bad instructions",
          agentProfileId: "codex-app-server",
          teamId: "team",
          roleId: "role",
          instructions: "prompt.md",
        },
      ],
    })).toEqual([]);
  });

  it("prepends inline instructions and prompt file contents to the user launch instruction", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "taskdeck-team-prompt-"));
    try {
      await writeFile(path.join(tempDir, "team.md"), "Team prompt");
      await writeFile(path.join(tempDir, "role.md"), "Role prompt");

      const initialInstruction = await buildTeamTemplateInitialInstruction({
        documentRoot: tempDir,
        template: {
          instructions: ["Inline prompt"],
          promptFiles: ["team.md", "role.md"],
        },
        userInstruction: "Implement feature X.",
      });

      expect(initialInstruction).toBe([
        "TaskDeck team template instructions:",
        "Inline prompt",
        "",
        "Team prompt",
        "",
        "Role prompt",
        "",
        "User launch instruction:",
        "Implement feature X.",
      ].join("\n"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("serializes team template task metadata while preserving no-template tasks", () => {
    const templatedTask = serializeTask(createTask({
      title: "Templated",
      command: "codex app-server",
      cwd: "/workspace/project",
      teamTemplateId: "decision-aware-solo",
      teamId: "single-decision-aware-agent",
      roleId: "decision-aware-implementation-controller",
      decisionGatewayMode: "auto-deliver",
      decisionResultHandling: "resume-action",
    }));
    const plainTask = serializeTask(createTask({
      title: "Plain",
      command: "codex app-server",
      cwd: "/workspace/project",
    }));

    expect(templatedTask).toMatchObject({
      teamTemplateId: "decision-aware-solo",
      teamId: "single-decision-aware-agent",
      roleId: "decision-aware-implementation-controller",
      decisionGatewayMode: "auto-deliver",
      decisionResultHandling: "resume-action",
    });
    expect(plainTask).toMatchObject({
      teamTemplateId: "",
      teamId: "",
      roleId: "",
      decisionGatewayMode: "",
      decisionResultHandling: "",
    });
  });
});
