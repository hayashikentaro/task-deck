# TaskDeck Actor Protocol Model

This document records the current actor boundary and near-term manager control-plane direction for TaskDeck.

GitHub Issues remain the source of truth for actionable work and completion state. This document is durable design guidance for how TaskDeck actors are allowed to communicate.

## Core principle

TaskDeck should separate agent-readable communication from state mutation.

Non-manager AI agents should not directly mutate TaskDeck state and should not send commands directly to other agents. They produce append-only file outputs. The manager reads those outputs and decides what should happen next. The manager also does not directly control worker agents; it calls a constrained TaskDeck command interface, and TaskDeck server performs the actual validated mutation.

The immediate implementation priority is to prove the manager read loop before implementing manager write.

```text
Workers write files.
Manager reads files first.
Manager later calls taskdeckctl.
Server mutates state.
```

## Actor diagram

```mermaid
flowchart TD
  User[User] -->|UI operation| UI[TaskDeck UI]
  UI -->|fast structured action| Server[TaskDeck Server]

  Server -->|validated PTY input / process control| Runtime[Runtime / PTY Sessions]
  Runtime --> WorkerA[Worker Agent A]
  Runtime --> WorkerB[Worker Agent B]
  Runtime --> Manager[Manager Agent]

  WorkerA -->|append-only status / result / artifact files| Files[.taskdeck file protocol]
  WorkerB -->|append-only status / result / artifact files| Files

  Files -->|watch + scan| Ingest[Watcher / Ingestor]
  Ingest -->|validate / dedupe / reduce| Server

  Server -->|generated text / json / markdown| ReadModel[Agent-readable views]
  Server -->|durable manager event| ManagerInbox[Manager Inbox]
  Server -->|short nudge only| Manager

  Manager -->|read| ReadModel
  Manager -->|read / ack| ManagerInbox
  Manager -->|status / judgment output| ManagerOutput[Manager status / notes]

  Manager -. future write .-> Taskdeckctl[taskdeckctl]
  Taskdeckctl -. local IPC: Unix domain socket .-> Socket[.taskdeck/run/manager-actions.sock]
  Socket -. structured manager action .-> Server

  Server -->|broadcast state update| UI

  WorkerA -. forbidden .-> WorkerB
  WorkerB -. forbidden .-> WorkerA
  Manager -. no direct terminal write .-> WorkerA
  Manager -. no direct terminal write .-> WorkerB
```

## Actors

### Worker agents

Worker agents include ordinary Codex, Goose, shell, or future provider sessions that are not the dedicated manager.

They may read:

```text
- generated task context
- assigned instructions
- readable task views
- their own environment variables
```

They may write:

```text
- append-only status files
- append-only result or artifact files
- their own notes
- bounded request files when the protocol explicitly allows them
```

They must not:

```text
- mutate canonical TaskDeck state
- write another agent's status
- send commands directly to another agent
- call manager-action commands
- write raw PTY input to another session
- smuggle raw commands, env, secrets, or auto-approval fields through request files
```

### Manager agent

The manager agent reads TaskDeck-generated files and manager inbox events, then decides what action should happen next.

It may read:

```text
- file change notifications
- manager inbox
- generated readable views
- action results returned by TaskDeck after write support exists
```

For the immediate read-loop MVP, it may write only its own bounded judgment output:

```text
- its own status
- its own notes
- its own review/judgment artifact
```

After the read loop is proven, manager write operations should go through:

```text
taskdeckctl
```

The manager must not directly mutate TaskDeck state or directly write into worker terminals.

### TaskDeck server

TaskDeck server owns mutation and delivery.

It is responsible for:

```text
- validation
- dedupe
- projection
- action execution
- action logging
- PTY input delivery
- UI broadcast
```

### User/UI

The UI uses a fast structured action path because user-facing actions should be responsive. UI operations should not be routed through the manager inbox.

## Protocol decisions

### Manager read path

Manager reads are file-based.

```text
App/Server
  -> manager inbox / readable projection files
  -> file change notification / short nudge
  -> Manager reads files
```

The manager reads durable context from files. A nudge is only a wake-up signal and is not the source of truth.

The read loop is the first behavior to prove with a real manager session:

```text
worker status
  -> server emits manager event / readable context
  -> manager receives short nudge
  -> manager reads files
  -> manager reports its judgment in its own status/notes
```

Current read-loop MVP files:

```text
.taskdeck/manager-inbox/<eventId>.json
.taskdeck/manager-readable/context.md
.taskdeck/manager-readable/unread-events.json
```

The dedicated manager session is started with the built-in `TaskDeck Manager` profile. TaskDeck marks that task as a manager session and provides these environment variables to the PTY:

```text
TASKDECK_MANAGER_ROLE=manager
TASKDECK_MANAGER_INBOX_DIR
TASKDECK_MANAGER_READABLE_DIR
TASKDECK_MANAGER_CONTEXT_FILE
TASKDECK_MANAGER_UNREAD_EVENTS_FILE
TASKDECK_STATUS_FILE
```

When a new unread manager event is created, TaskDeck sends only a short nudge to running manager sessions. The nudge is a wake-up signal; the durable source of truth remains the manager inbox and manager-readable files.

For this MVP, the manager reports only by writing its own bounded judgment/status/notes, for example to `TASKDECK_STATUS_FILE`. It must not command workers, call `taskdeckctl`, or mutate TaskDeck state directly.

### Manager write path

Manager writes are intentionally later than manager reads.

After the read loop is validated, manager writes should go through `taskdeckctl`.

```text
Manager
  -> taskdeckctl
  -> local IPC endpoint
  -> TaskDeck server
  -> validation / dedupe / action log
  -> execution
```

The preferred local IPC endpoint is a Unix domain socket, not an exposed Web API.

```text
.taskdeck/run/manager-actions.sock
```

This avoids opening a network API surface while still avoiding the roundabout manager-action-file path for commands.

### Why not raw Web API as the manager-facing surface

Raw Web API is not the preferred manager-facing protocol because it exposes too much operational complexity to the AI agent:

```text
- API base URL
- token / auth header
- HTTP method
- JSON body escaping
- response parsing
- HTTP error interpretation
- Docker localhost confusion
```

If HTTP is used later, it should be hidden behind `taskdeckctl`.

### Why not manager-action files as the primary write path

Append-only files remain useful for worker outputs and manager-readable events.

However, for manager write operations, a file request flow can be unnecessarily indirect:

```text
Manager
  -> write action file
  -> watcher
  -> server
  -> result file
  -> manager reads result
```

Since the manager does not need UI-level latency but does need reliable command semantics, a local IPC command endpoint gives a cleaner command path while keeping mutation inside the server.

## Future manager write flow

```text
Manager Agent
  -> taskdeckctl send-task-input --target-task <taskId> --message <message>
  -> Unix domain socket
  -> TaskDeck server action executor
  -> validate actor / action / target
  -> write action log
  -> deliver PTY input to target session
  -> return result
```

Example:

```sh
taskdeckctl send-task-input \
  --target-task task_child_001 \
  --message "前回の報告では原因が曖昧です。失敗原因を1つに絞って、根拠を status に出してください。"
```

## Server-side requirements for future write support

The server must treat manager commands as structured actions, not raw terminal access.

Required safeguards:

```text
- manager-only capability
- single manager action executor
- allowlisted action types
- actorTaskId validation
- targetTaskId validation
- actionId dedupe
- action log
- clear success/failure result
```

Allowed action types:

```text
sendTaskInput
createChildSession
requestHumanDecision
acknowledgeManagerEvent
markTaskReviewed
archiveTask
closeTask
```

Forbidden operations:

```text
rawTerminalWrite
rawSql
arbitraryTaskUpdate
writeOtherAgentStatus
deleteLogs
debugStateMutation
```

## Capability boundary

The local IPC endpoint should only be visible to the manager process/session.

Desired structural boundary:

```text
Manager:
  can see .taskdeck/run/manager-actions.sock
  can execute taskdeckctl

Worker:
  cannot see manager-actions.sock
  cannot execute manager action commands
```

If running in containers, mount the manager action socket only into the manager environment.

This boundary is for future manager write support. The immediate manager read-loop MVP does not require the socket yet.

## MVP implementation sequence

### Phase 1: Document protocol boundary

Add and maintain this actor protocol document. Reference it from `AGENTS.md` so future agents do not collapse worker, manager, and server responsibilities.

### Phase 2: Validate manager inbox MVP

Use the isolated QA branch/worktree to verify that child status changes emit valid manager inbox events.

### Phase 3: Add a dedicated manager agent profile/session

Introduce a way to run a manager session whose job is to read manager inbox events and generated readable context.

The first implementation uses a built-in `TaskDeck Manager` profile. Start it from the normal New agent session form by choosing `TaskDeck Manager` as the Agent and the target project workspace.

### Phase 4: Add manager-readable context

Generate or expose files the manager can read without scraping UI or PTY transcripts:

```text
unread manager events
active tasks
child status summaries
relevant task summaries
```

The current files are `.taskdeck/manager-readable/context.md` and `.taskdeck/manager-readable/unread-events.json`.

### Phase 5: Wire short manager nudge

When manager inbox changes, server sends a short nudge to the manager session:

```text
New manager event is available.
Read the manager inbox and decide the next action.
```

### Phase 6: QA the manager read loop

Verify:

```text
worker writes append-only status
server emits manager event / readable context
manager receives nudge
manager reads files
manager reports its judgment in its own status/notes
UI or logs make the manager judgment visible
```

Manual QA outline:

```text
1. Start TaskDeck from the QA worktree.
2. Start a `TaskDeck Manager` session.
3. Start a parent/child session or any parent-spawned child capable of writing status.
4. Have the child write `ready_for_review`, `blocked`, or `failed` to `TASKDECK_STATUS_FILE`.
5. Confirm `.taskdeck/manager-inbox/*.json` exists.
6. Confirm `.taskdeck/manager-readable/context.md` and `.taskdeck/manager-readable/unread-events.json` exist.
7. Confirm the manager terminal receives the short nudge.
8. Have the manager read the files and write its own bounded judgment to `TASKDECK_STATUS_FILE`.
9. Confirm no manager-to-worker command is sent.
```

### Phase 7: Define manager write schema and transport

Only after the read loop is proven, define shared schema/types for manager actions and results:

```text
taskDeckManagerAction
taskDeckManagerActionResult
sendTaskInput
createChildSession
requestHumanDecision
```

### Phase 8: Implement manager write support

Implement, in order:

```text
server-side manager action executor
Unix socket endpoint
taskdeckctl manager commands
write-path QA
```

## Non-goals for now

```text
- SQLite migration
- tmux reattach
- remote manager
- Web API manager write endpoint
- direct worker-to-worker communication
- manager raw PTY access
- manager write implementation before manager read-loop validation
```

## Design slogan

```text
Read as text.
Prove manager read before manager write.
Write through taskdeckctl later.
Mutate only through the server.
```
