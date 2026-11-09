# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- `bpmn-sdk edit <file> [--output <file>] [--force] [--layout auto|none]`
  runner. It opens the file with `Bpmn.open()`, runs the JavaScript edit body
  read from stdin as an async function with `model` in scope, and writes
  exactly once afterwards. A returned `ProcessBuilder` is written through the
  builder, and every fluent continuation created in the body is checked for
  completeness. Calling `write()` in the body fails with `WRITE_NOT_ALLOWED`;
  a failed body writes nothing. The runner prints the `WriteResult` or
  `{ "error": { "code", "message" } }` as one JSON object and exits non-zero
  on failure. Runner-specific codes are `INVALID_ARGUMENTS`,
  `INVALID_RETURN`, `SCRIPT_FAILED`, `SCRIPT_SYNTAX_ERROR`, and
  `WRITE_NOT_ALLOWED`.

### Changed

- **BREAKING:** `configureForm()` now throws `INVALID_EXTENSION` instead of
  `INVALID_FORM` when called on a non-user task; `INVALID_FORM` was removed
  from the `ModelApiError` code union.
- **BREAKING:** `extensions.ensure()` now enforces owner placement for the
  curated Zeebe extension types: `zeebe:FormDefinition` requires a
  `bpmn:UserTask`, `zeebe:Subscription` a `bpmn:Message`,
  `zeebe:CalledDecision` a `bpmn:BusinessRuleTask`, `zeebe:CalledElement` a
  `bpmn:CallActivity`, `zeebe:Script` a `bpmn:ScriptTask`, and
  `zeebe:LoopCharacteristics` a `bpmn:MultiInstanceLoopCharacteristics`.
  Other descriptors remain open as the descriptor-level escape hatch.
- All `configureX()` editor helpers now validate their values and throw
  `INVALID_EXTENSION` on empty or ambiguous input: forms require at least one
  non-blank value, subscriptions a non-blank correlation key, called
  decisions a non-blank decision ID, called elements exactly one of
  `processId`/`processIdExpression`, scripts a non-blank expression, and
  multi-instance configuration a non-blank `inputCollection` and
  `inputElement`.

### Fixed

- `configureSubscription()` rejects non-`bpmn:Message` owners and empty
  correlation keys.
- `configureMultiInstance()` rejects non-activity owners and no longer
  attaches Zeebe loop metadata to an existing non-multi-instance
  `loopCharacteristics` (for example `bpmn:StandardLoopCharacteristics`).
