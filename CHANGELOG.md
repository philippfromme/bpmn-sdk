# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
