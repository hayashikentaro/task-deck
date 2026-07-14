# AI-First Layering

Status: design principle, not implemented behavior or an actor protocol.

TaskDeck is being developed with AI-assisted workflows. This document captures a working design principle for using architectural layers as responsibility boundaries.

This is not a strict Clean Architecture template. Use it as a practical way to shape agent responsibilities, decision authority, context reuse, and integration flow.

## Core idea

AI-first layering treats a layer as all of the following:

- a responsibility boundary;
- a decision-authority boundary;
- a merge/integration boundary;
- a way to reduce accidental cross-layer changes.

Traditional layering helps humans reason about maintainability. AI-first layering also helps keep changes scoped and reviewable.

## Why this matters for TaskDeck

AI-assisted work tends to drift toward whatever location is most convenient unless the working boundary is explicit. Layering should make it easier to:

- keep prompts shorter by reading only relevant files;
- avoid changing unrelated layers;
- make merge order and conflict ownership clearer;
- identify when a decision crosses a layer boundary and should be handled deliberately.

The previous AI-agent actor and role model has been removed pending redesign. This document should not be used as a substitute actor definition.

## Suggested layers

These layers are intentionally practical rather than rigid.

### Core

Owns product concepts and stable domain semantics.

Examples:

- Task/session meaning;
- supervision concepts;
- parent/subagent task metadata semantics;
- persisted task compatibility rules.

Typical files:

- `packages/core/src/*`

Core sessions may decide what a concept means. They should not decide UI layout, App Server timing, or protocol transport details unless explicitly asked.

### Protocol

Owns machine-readable boundaries between TaskDeck and runtime flows.

Examples:

- server-owned action contracts;
- App Server-native event contracts;
- generated manager action capabilities;
- bounded worker status/report formats.

Typical files:

- `docs/taskdeck-actor-protocol.md`;
- `packages/core/src/managerInbox.js`;
- `packages/core/src/managerReadable.js`;
- future App Server-native protocol modules.

Protocol changes should keep contracts explicit and testable. They should not build UI workflows or raw launch commands.

### Runtime

Owns side-effectful runtime behavior.

Examples:

- Codex App Server subprocess lifecycle;
- App Server JSON-RPC request/notification handling;
- input queueing;
- websocket server behavior;
- process start/exit handling;
- server-side initial instruction delivery.

Typical files:

- `apps/server/src/server.js`

Runtime changes should be careful with timing, process lifecycle, and existing queue mechanisms. They should not alter protocol semantics or UI presentation without coordination.

### UI

Owns presentation, interaction affordances, and visual hierarchy.

Examples:

- Task cards;
- native subagent badges;
- expanded task-card metadata;
- action buttons;
- CSS and visual emphasis.

Typical files:

- `apps/web-desktop/src/components/*`;
- `apps/web-desktop/src/styles.css`;
- `apps/web-phone/src/*`;
- `docs/guides/ui-style.md`;
- `docs/guides/ui-components.md`.

UI changes should not change supervision semantics or server behavior merely to satisfy display needs.

### App Flow

Owns frontend orchestration and lifecycle wiring.

Examples:

- WebSocket event handling;
- App Server request/event orchestration;
- native subagent card selection and update flow;
- dedupe for supported runtime events;
- status/error messages;
- connecting trusted launch profiles to task creation.

Typical files:

- `apps/web-desktop/src/App.tsx`;
- `apps/web-desktop/src/components/TaskCreateForm.tsx`;
- `apps/web-phone/src/PhoneApp.tsx`;
- related orchestration helpers.

App Flow changes often cross layer boundaries. They should reuse Protocol, Core, Runtime, and UI pieces rather than redefining their rules.

### Integration

Owns convergence across subtask branches and layers.

Examples:

- collecting pushed subtask branches;
- deciding merge order;
- merging into the integration branch;
- running checks after merges;
- resolving conflicts or routing work back to the correct subtask session;
- final integration passes.

Typical files:

- no single ownership area;
- uses Git state, reports, diffs, and checks.

Integration work should not become another feature implementation pass unless explicitly assigned. Its main job is convergence.

## Practical rule of thumb

Parallelize across layers when the interface is clear.

Keep work sequential when the change is a vertical orchestration flow through the same central files.

Examples:

- Good parallel work: docs, parser, runtime, UI display.
- Better sequential work: App Server event -> server reduction -> task state/log projection -> UI display.
