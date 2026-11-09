# AGENTS.md

## Purpose

`bpmn-sdk` is a focused TypeScript library for safe, fluent BPMN model changes.
Optimize for semantic correctness, deterministic behavior, and low agent
context cost.

## Public contract

- Keep the public API semantic: no XML editing, JSON Pointers, or generic edit
  operations.
- The only executable entry point is the `bpmn-sdk edit` runner. It owns the
  open/write lifecycle around a JavaScript edit body and must not add
  operations beyond the library API. Treat its options, error codes, and JSON
  output as versioned API.
- Treat exported types, method names, error codes, and write result fields
  as versioned API.
- Use exact IDs and typed extension builders. Do not expose moddle internals as
  the primary API.
- Keep direct library use independent from runners, network access, and plugins.

## Safety

- The library owns IDs, containment, and reciprocal references.
- `write` must serialize, reload, verify intended semantics, and write
  atomically.
- Reject ambiguous targets, foreign model elements, malformed BPMN, and
  unsupported or unparsed extension data. Never silently discard data.
- Diagram Interchange and presentation-only data must not affect semantic hashes
  or change reports.

## Implementation

- Keep parsing, semantic projection, model mutation, and output writing separate.
- Use loaded moddle descriptors for standard and custom extensions.
- Preserve strict typing; avoid broad casts and silent fallbacks.
- Add dependencies only when they improve correctness or maintainability.

## Verification

- Test public library behavior and compiled imports.
- Cover Zeebe and custom extensions, write failures, DI invariance, and
  atomic output.
- Do not weaken tests. Complete relevant build, typecheck, lint, and tests
  before finishing.
