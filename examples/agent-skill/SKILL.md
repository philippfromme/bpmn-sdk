---
name: bpmn-sdk
description: Create and safely edit BPMN 2.0 and Camunda 8 / Zeebe models with @philippfromme/bpmn-sdk.
---

# Model BPMN with bpmn-sdk

Use `@philippfromme/bpmn-sdk` to create or edit BPMN 2.0 and Zeebe models.
This is a reference skill to adapt for an agent host; installing the package
does not activate this file automatically.

## Choose an entry point

To edit an existing BPMN file, use the `bpmn-sdk edit` runner by default. It
opens the file, runs only your edit body with `model` (from `Bpmn.open`) in
scope, writes once, and prints one JSON result:

```sh
npx bpmn-sdk edit existing.bpmn <<'JS'
model.element("SendReply").setName("Send customer reply");
JS
```

To create a new model, write a Node script that uses the library directly:

```ts
import { Bpmn } from "@philippfromme/bpmn-sdk";

const process = await Bpmn.createProcess("process-id");
const collaboration = await Bpmn.createCollaboration("collaboration-id");
const emptyEditor = await Bpmn.create();
```

- Use `bpmn-sdk edit` to make exact-ID changes to an existing BPMN file.
- Use `createProcess` for a new single-process design.
- Use `createCollaboration` for pools, messages, and message flows.
- Use `create` only when the fluent builders do not express the required
  operation.
- Use `Bpmn.open` in a script only when the runner cannot express the change,
  for example when custom moddle descriptors must be loaded.

When a BPMN file already exists — including one changed outside the SDK, for
example by a reviewer in a modeler — treat the file as the source of truth:
edit it in place with `bpmn-sdk edit`, and use
`continueProcess(...).at(...)` to extend topology fluently. Do not regenerate
the model from scratch, which would discard those external changes.

## Core rules

1. Use stable, meaningful IDs supplied by the caller.
2. Keep topology explicit. Declare branch conditions/defaults, joins, loop
   targets, and fluent continuation points; never infer a cursor from graph
   order.
3. Use the fluent builders for common new-model topology. Use the editor for
   exact-ID changes or descriptor-backed features outside the fluent surface.
4. Prefer in-place edits over regeneration for existing files: open the file,
   change only what is needed, and write once. Regenerating from scratch
   discards changes made outside the generator.
5. Do not edit BPMN XML, Diagram Interchange, or raw moddle objects.
6. With `bpmn-sdk edit`, never call `write()`; the runner writes once. In a
   script, call `write()` once after all mutations are complete.
7. Treat library errors as actionable input errors. Fix the edit based on the
   error `code`. Do not bypass validation or retry by mutating XML.

## Create a process

```ts
const process = await Bpmn.createProcess("approval-flow");

await process
  .startEvent("start")
  .userTask("review", { formId: "review-request" })
  .exclusiveGateway("approved")
  .branch("yes", (branch) =>
    branch
      .condition("= approved")
      .serviceTask("notify", {
        taskType: "send-email",
        retries: "3",
        inputs: [{ source: "=requester.email", target: "email" }]
      })
      .endEvent("completed")
  )
  .branch("no", (branch) => branch.defaultFlow().endEvent("rejected"))
  .write({ output: "approval-flow.bpmn" });
```

## Edit an existing process

```sh
npx bpmn-sdk edit existing.bpmn --output edited.bpmn --layout none <<'JS'
const task = model.element("SendReply");

task.setName("Send customer reply");
task.extensions.ensure("zeebe:IoMapping").addInput({
  source: "=customer.id",
  target: "customerId"
});
JS
```

To continue an existing process fluently, specify both IDs and return the
builder so its completeness checks run before writing:

```sh
npx bpmn-sdk edit existing.bpmn --output completed.bpmn <<'JS'
return model
  .continueProcess("CustomerSupport")
  .at("SendReply")
  .endEvent("ReplySent");
JS
```

Runner contract:

- Options: `--output <file>` (default: replace the input in place),
  `--force` (replace an existing distinct output), and `--layout auto|none`.
- The body is an async function body: use `await` and `return` directly. Return
  nothing, `model`, or a builder from `model.continueProcess(...).at(...)`.
  Every continuation created in the body must be complete, even if not
  returned.
- If the body throws, nothing is written.
- Output is one JSON object: the write result (`status`, `destination`,
  `changes`, hashes) on success, or `{ "error": { "code", "message" } }` with
  a non-zero exit code on failure.
- Runner error codes: `INVALID_ARGUMENTS`, `SCRIPT_SYNTAX_ERROR`,
  `SCRIPT_FAILED`, `INVALID_RETURN`, and `WRITE_NOT_ALLOWED`. Other codes come
  from the library, for example `ELEMENT_NOT_FOUND`, `UNFINISHED_PROCESS`, or
  `OUTPUT_WRITE_FAILED`.
- The runner is not a sandbox; it runs the body with full Node.js permissions.

## Layout and output

- `layout: "auto"` is the default. It discards any existing Diagram
  Interchange and generates a fresh deterministic diagram for the whole
  model, including newly added nodes.
- `layout: "none"` skips automatic layout and also discards any existing
  Diagram Interchange; the output has no diagram. No mode preserves a
  hand-arranged layout, so prefer `layout: "auto"` when the input model has a
  diagram.
- `write()` serializes, reloads, checks BPMN/Zeebe semantics, and writes
  atomically.
- A distinct existing output path requires `force: true`; do not use it unless
  replacement is intentional.

## Common patterns

- Service work: `serviceTask` with `taskType`, retries, I/O, headers, and
  properties.
- Human work: `userTask` with `form` and optional `humanTask` assignment,
  priority, schedule, and listener configuration.
- Called work: `callActivity` with `calledElement`, `businessRuleTask` with
  `calledDecision`, or `scriptTask` with `script`.
- Repeated work: `multiInstanceLoop` with optional Zeebe collection and
  element mappings.
- Exception handling: attach typed timer, error, escalation, message, or
  signal boundary handlers.
- Collaboration: create participants, messages, and message flows with exact
  IDs through `Bpmn.createCollaboration`.
- Complex or uncommon BPMN/Zeebe properties: use the exact-ID editor through
  `bpmn-sdk edit` (or `Bpmn.create` for new models).

Read the repository README for the complete supported fluent surface and the
current intentionally unsupported conveniences.
