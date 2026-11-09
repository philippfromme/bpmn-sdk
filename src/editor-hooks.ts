import type { ProcessBuilder } from "./fluent.js";
import type { BpmnEditor } from "./model.js";

export interface EditorHooks {
  beforeWrite(): void;
  builderCreated(builder: ProcessBuilder): void;
}

const hooks = new WeakMap<BpmnEditor, EditorHooks>();

export function setEditorHooks(
  editor: BpmnEditor,
  editorHooks: EditorHooks | undefined
): void {
  if (editorHooks === undefined) {
    hooks.delete(editor);
  } else {
    hooks.set(editor, editorHooks);
  }
}

export function getEditorHooks(editor: BpmnEditor): EditorHooks | undefined {
  return hooks.get(editor);
}
