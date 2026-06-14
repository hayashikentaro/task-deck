# Codex App Server smoke path

This note tracks the first TaskDeck-facing App Server smoke path.

Goal:

```text
User -> TaskDeck UI -> TaskDeck server -> Codex App Server process
```

For the first pass, add a local agent profile that launches Codex App Server in stdio mode and use the existing TaskDeck terminal/composer path to inspect raw protocol output.

This is intentionally not the final structured adapter. The final design should move JSON-RPC framing and event mapping into `apps/server`.

## Manual smoke shape

Add a local profile in `taskdeck.local.json` or `TASKDECK_CONFIG` with:

```json
{
  "agentProfiles": [
    {
      "id": "codex-app-server",
      "label": "Codex App Server smoke",
      "command": "codex app-server --stdio",
      "description": "Experimental Codex App Server profile for protocol smoke testing"
    }
  ]
}
```

Then start that profile from the TaskDeck UI and send one JSON-RPC line at a time through the composer.

First probe:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

Use the raw response to confirm the current protocol shape before implementing the structured adapter.
