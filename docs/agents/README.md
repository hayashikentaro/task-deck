# TaskDeck Agent Documentation

This directory contains shared guidance for AI-assisted TaskDeck development.

The previous broad AI-agent actor and role definitions have been removed because the actor model is being redesigned. Do not infer current or future actor responsibilities from deleted role documents, older prompts, or historical issue notes.

## Shared guidance

- Product and agent operating principles: `operating-principles.md`

## Current minimal template docs

The current template-specific role/team docs are:

- `teams/single-decision-aware-agent.md`
- `roles/decision-aware-implementation-controller.md`
- `teams/single-decision-aware-loop.md`
- `roles/decision-aware-loop-controller.md`

These support the minimal `decision-aware-solo` and `decision-aware-loop` team templates. They are not a general multi-agent actor model or a replacement for the pending actor protocol redesign.

For `decision-aware-loop`, each completed cycle is also a required commit unit. The loop controller must verify, commit, report the commit hash, confirm the working tree, and only then continue to the next cycle.
