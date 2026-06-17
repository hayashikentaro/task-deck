import { FormEvent, useEffect, useMemo, useState } from "react";
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

  const codexAppServerProfile = findCodexAppServerProfile(context?.agentProfiles ?? []);
  const command = codexAppServerProfile?.command.trim() ?? "";
  const effectiveCwd = selectedProjectPath || context?.defaultCwd || "";
  const canStart = !disabled && Boolean(codexAppServerProfile) && Boolean(effectiveCwd) && Boolean(command);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) {
      return;
    }

    onCreateTask({
      title: buildTaskTitle(codexAppServerProfile?.label || "Codex App Server", effectiveCwd),
      command,
      cwd: effectiveCwd,
      agentProfileId: codexAppServerProfile?.id || defaultAgentProfileId,
      agentLabel: codexAppServerProfile?.label || "Codex App Server",
      sessionMode: "new",
    });
  };

  return (
    <section className="task-create-panel" aria-label="New agent session">
      <form className="task-create-form" onSubmit={handleSubmit}>
        <SelectField
          className="project-field"
          label="Project"
          value={selectedProjectPath}
          onChange={setSelectedProjectPath}
        >
          {projectSuggestions.map((project) => (
            <option key={project.path} value={project.path}>
              {project.label}
            </option>
          ))}
        </SelectField>
        <Button disabled={!canStart} fullWidth type="submit" variant="panel">
          Start Codex Session
        </Button>
      </form>
    </section>
  );
}

function findCodexAppServerProfile(agentProfiles: AgentProfile[]) {
  return agentProfiles.find((profile) => profile.id === defaultAgentProfileId) ?? null;
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

function buildTaskTitle(agentLabel: string, cwd: string) {
  return basename(cwd) || `${agentLabel} session`;
}
