import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildLaunchCommand,
  buildTaskTitle,
  executionCwdForAgentProfile,
  isTaskDeckManagerProfile,
} from "../agentLaunch";
import type { AgentProfile, CreateTaskInput, ProjectSuggestion, TaskDeckContext } from "../types";
import { Button } from "./ui/Button";
import { SelectField } from "./ui/SelectField";

type TaskCreateFormProps = {
  context: TaskDeckContext | null;
  disabled: boolean;
  onCreateTask: (input: CreateTaskInput) => boolean;
};

const defaultAgentProfileId = "codex-app-server";

export function TaskCreateForm({ context, disabled, onCreateTask }: TaskCreateFormProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentProfileId);
  const [selectedProjectPath, setSelectedProjectPath] = useState("");

  const projectSuggestions = useMemo(() => buildProjectSuggestions(context), [context]);

  useEffect(() => {
    if (!projectSuggestions.length) {
      return;
    }
    if (!selectedProjectPath || !projectSuggestions.some((project) => project.path === selectedProjectPath)) {
      setSelectedProjectPath(selectDefaultProjectPath(projectSuggestions, context?.defaultCwd));
    }
  }, [context?.defaultCwd, projectSuggestions, selectedProjectPath]);

  const agentProfiles = context?.agentProfiles ?? [];
  const selectedAgent =
    agentProfiles.find((profile) => profile.id === selectedAgentId) ??
    findDefaultAgentProfile(agentProfiles);
  const selectedAgentIsManager = isTaskDeckManagerProfile(selectedAgent);
  const launchCommand = selectedAgent ? buildLaunchCommand(selectedAgent) : { command: "", resumeCommand: "" };
  const command = launchCommand.command;
  const effectiveCwd = executionCwdForAgentProfile(
    selectedAgent,
    selectedProjectPath,
    context?.controlRoot,
    context?.defaultCwd,
  );
  const canStart = !disabled && Boolean(selectedAgent) && Boolean(effectiveCwd) && Boolean(command);

  useEffect(() => {
    if (!agentProfiles.some((profile) => profile.id === selectedAgentId)) {
      setSelectedAgentId(findDefaultAgentProfile(agentProfiles)?.id ?? "");
    }
  }, [agentProfiles, selectedAgentId]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) {
      return;
    }

    onCreateTask({
      title: selectedAgentIsManager
        ? "TaskDeck Manager"
        : buildTaskTitle(selectedAgent?.label || "Agent", effectiveCwd),
      command,
      cwd: effectiveCwd,
      agentProfileId: selectedAgent?.id || "",
      agentLabel: selectedAgent?.label || "Agent",
      sessionMode: "new",
    });
  };

  return (
    <section className="task-create-panel" aria-label="New agent session">
      <form className="task-create-form" onSubmit={handleSubmit}>
        <SelectField
          className="agent-picker"
          disabled={!agentProfiles.length}
          label="Agent"
          value={selectedAgent?.id ?? ""}
          onChange={setSelectedAgentId}
        >
          {agentProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          className="project-field"
          disabled={selectedAgentIsManager}
          hint={selectedAgentIsManager ? "Global manager sessions use the document/control root." : undefined}
          label={selectedAgentIsManager ? "Control root" : "Project"}
          value={selectedAgentIsManager ? effectiveCwd : selectedProjectPath}
          onChange={setSelectedProjectPath}
        >
          {selectedAgentIsManager ? (
            <option value={effectiveCwd}>
              Global · {basename(effectiveCwd) || "TaskDeck"}
            </option>
          ) : null}
          {projectSuggestions.map((project) => (
            <option key={project.path} value={project.path}>
              {project.label}
            </option>
          ))}
        </SelectField>
        <Button disabled={!canStart} fullWidth type="submit" variant="panel">
          Start Session
        </Button>
      </form>
    </section>
  );
}

function findDefaultAgentProfile(agentProfiles: AgentProfile[]) {
  return (
    agentProfiles.find((profile) => profile.id === defaultAgentProfileId) ??
    agentProfiles[0] ??
    null
  );
}

function buildProjectSuggestions(context: TaskDeckContext | null): ProjectSuggestion[] {
  const suggestions = context?.projectSuggestions?.length
    ? context.projectSuggestions
    : context?.defaultCwd
      ? [{ label: basename(context.defaultCwd) || "Repository root", path: context.defaultCwd, isGitRepo: context.isGitRepo }]
      : [];
  const seenPaths = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (!suggestion.path || seenPaths.has(suggestion.path)) {
      return false;
    }
    seenPaths.add(suggestion.path);
    return true;
  });
}

function selectDefaultProjectPath(projectSuggestions: ProjectSuggestion[], defaultCwd?: string) {
  return (
    projectSuggestions.find((project) => project.path === defaultCwd)?.path ??
    projectSuggestions.find((project) => project.label === "task-deck")?.path ??
    projectSuggestions[0]?.path ??
    ""
  );
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? "";
}
