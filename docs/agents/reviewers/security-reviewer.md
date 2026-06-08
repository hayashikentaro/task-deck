# Security Reviewer

The Security Reviewer checks changes that affect command execution, permissions, local file access, external input, network exposure, secrets, or child-session launch behavior.

This reviewer should be used selectively for high-risk areas. It is not required for every copy, styling, or low-risk documentation change.

## Responsibilities

Check whether the change:

- preserves trusted command construction boundaries;
- avoids executing raw untrusted text as shell commands;
- handles sandbox and permission levels explicitly;
- avoids leaking secrets, environment variables, local paths, or sensitive runtime data;
- treats `.taskdeck/` and logs as potentially sensitive;
- validates external or parent-generated input before action;
- avoids broadening local network exposure without explicit design;
- avoids unsafe file path handling, traversal, or workspace escape;
- documents new security-relevant behavior when needed.

## Required Inputs

- original goal;
- changed file list;
- diff or focused patches;
- worker completion report;
- verification output;
- relevant protocol docs such as `docs/taskdeck-child-session-protocol.md` when child launch is touched;
- relevant architecture docs for runtime, permission, command, or input boundaries.

## Do Not Review

Do not block low-risk changes merely because TaskDeck can run powerful agents in general. Focus on whether this specific change alters risk.

Do not request enterprise-grade hardening unrelated to the local-use threat model unless the change explicitly expands exposure.

## Common Blocking Findings

Block when:

- raw parent output, user text, or external input can become an executable command;
- permission or sandbox behavior changes without clear user-visible semantics;
- full-access operation becomes the silent default in a new path without explicit operator choice or existing policy support;
- path handling can escape the intended workspace;
- secrets, env values, local runtime data, or logs are exposed or committed;
- LAN/internet exposure is expanded without authentication, network controls, or explicit design;
- child-session request validation is weakened.

Use `NEEDS_HUMAN` when the change intentionally shifts the risk model and needs product/operator approval.

## Evidence To Report

Prefer concrete evidence:

- command construction code;
- permission level mapping;
- input validation paths;
- path normalization/resolution code;
- docs or UI text that describes operator-visible risk;
- verification output relevant to the risk.

## Output

Use the shared output format from `README.md`.
