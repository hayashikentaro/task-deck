# TaskDeck Agent Documentation Map

This directory contains durable guidance for AI agents working on or inside TaskDeck.

Start with the repository root `AGENTS.md`. Use this file as the actor-to-doc map when you need role-specific guidance without expanding the root checklist.

## Shared guidance

- Product and agent operating principles: `operating-principles.md`
- Review system guidance: `review-system.md`
- Specialized reviewer prompts: `reviewers/`

## Actor roles

| Actor | Use when | Role guide |
| --- | --- | --- |
| GPT collaborator | A GPT-style assistant is helping with analysis, product direction, docs, prompts, or implementation guidance without necessarily owning local edits. | `roles/gpt-collaborator.md` |
| Codex implementer | A Codex coding session is making repository changes, running verification, and committing or pushing work. | `roles/codex-implementer.md` |
| TaskDeck manager | A dedicated global manager session is supervising TaskDeck tasks across projects. | `roles/taskdeck-manager.md` |
| TaskDeck worker | A project-bound TaskDeck worker session is performing assigned work and reporting through supported worker channels. | `roles/taskdeck-worker.md` |
| Integration agent | A parent or integration session is merging child branches and converging parallel work. | `roles/integration.md` |

## Boundary docs

- Actor and manager control-plane boundary: `../taskdeck-actor-protocol.md`
- Legacy child-session file protocol, disabled on the current App Server-only route: `../taskdeck-child-session-protocol.md`
- AI-first layering and responsibility boundaries: `../ai-first-layering.md`

## Maintenance rule

Keep role guidance separated by actor. Add concise links here when a new actor-specific guide is introduced, and keep protocol details in the protocol docs rather than duplicating long instructions in role pages.
