# Performance format

TypingBot uses a small JSON language so a model can describe semantic edits without controlling the computer. The local app validates and executes the result.

## Envelope

```json
{
  "version": "1.0",
  "title": "short label",
  "finalText": "authoritative final document",
  "actions": []
}
```

`finalText` is authoritative. TypingBot simulates every action before playback and refuses any script whose resulting document differs from it.

## Actions

Every action has a `phase`: `planning`, `drafting`, or `polishing`. Phases must stay in that order. `effort` is an optional integer from 1 to 5 used to distribute the phase's time budget. `note` is optional status text.

### Append

Moves to the end of the mirrored document and types text.

```json
{ "op": "append", "phase": "drafting", "text": "New text", "effort": 3 }
```

### Replace

Finds one exact, unique string, selects it, and types its replacement.

```json
{ "op": "replace", "phase": "polishing", "find": "rough phrase", "text": "clear phrase" }
```

### Delete

Finds one exact, unique string and removes it.

```json
{ "op": "delete", "phase": "drafting", "find": "unused paragraph" }
```

### Move

Removes one exact string and inserts it after one exact anchor. Set `after` to `null` to move it to the beginning.

```json
{ "op": "move", "phase": "drafting", "find": "Second paragraph.", "after": "Opening paragraph." }
```

### Clear and pause

`clear` selects all and deletes the current document. `pause` changes no text and reserves thinking or rereading time.

```json
{ "op": "clear", "phase": "drafting" }
{ "op": "pause", "phase": "polishing", "effort": 4, "note": "Final proofread" }
```

## Validation rules

- Scripts contain 3 to 250 actions.
- Every `find` and non-null `after` must match exactly once at its step.
- Phase order cannot move backward.
- Phase percentages must total 100.
- Simulated output must exactly equal `finalText`.
- Playback accepts at most 480 minutes and 20 to 220 WPM.
- Scripts are data only. They cannot run programs, access files, use the network, or introduce new commands.

See [`examples/demo.performance.json`](../examples/demo.performance.json) for a complete example.
