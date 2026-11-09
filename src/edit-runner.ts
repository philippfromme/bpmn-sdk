import { Console } from "node:console";

import { setEditorHooks } from "./editor-hooks.js";
import { ProcessBuilder, ProcessBuilderError } from "./fluent.js";
import { ModelLoadError } from "./model-loader.js";
import {
  ModelWriteError,
  type WriteOptions,
  type WriteResult
} from "./model-runtime.js";
import { Bpmn, BpmnEditor, ModelApiError } from "./model.js";

export class EditRunnerError extends Error {
  constructor(
    readonly code:
      | "INVALID_ARGUMENTS"
      | "INVALID_RETURN"
      | "SCRIPT_FAILED"
      | "SCRIPT_SYNTAX_ERROR"
      | "WRITE_NOT_ALLOWED",
    message: string
  ) {
    super(message);
  }
}

export interface EditOptions {
  file: string;
  force?: boolean;
  layout?: "auto" | "none";
  output?: string;
  script: string;
}

export interface ErrorReport {
  error: {
    code: string;
    message: string;
  };
}

type EditBody = (model: BpmnEditor, console: Console) => Promise<unknown>;

const AsyncFunction: new (...parameters: string[]) => EditBody =
  Object.getPrototypeOf(async () => undefined).constructor;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSdkError(
  error: unknown
): error is
  | EditRunnerError
  | ModelApiError
  | ModelLoadError
  | ModelWriteError
  | ProcessBuilderError {
  return error instanceof EditRunnerError ||
    error instanceof ModelApiError ||
    error instanceof ModelLoadError ||
    error instanceof ModelWriteError ||
    error instanceof ProcessBuilderError;
}

export function toErrorReport(error: unknown): ErrorReport {
  return {
    error: {
      code: isSdkError(error) ? error.code : "UNEXPECTED_ERROR",
      message: errorMessage(error)
    }
  };
}

function compile(script: string): EditBody {
  if (script.trim().length === 0) {
    throw new EditRunnerError(
      "INVALID_ARGUMENTS",
      "The edit body must not be empty"
    );
  }

  try {
    return new AsyncFunction("model", "console", `"use strict";${script}`);
  } catch (error) {
    throw new EditRunnerError("SCRIPT_SYNTAX_ERROR", errorMessage(error));
  }
}

function scriptFailure(error: unknown): unknown {
  return isSdkError(error)
    ? error
    : new EditRunnerError("SCRIPT_FAILED", errorMessage(error));
}

function writeNotAllowed(): EditRunnerError {
  return new EditRunnerError(
    "WRITE_NOT_ALLOWED",
    "The edit body must not call write(); the runner writes once after the body completes"
  );
}

export async function runEdit(options: EditOptions): Promise<WriteResult> {
  const body = compile(options.script);
  const model = await Bpmn.open(options.file);
  const builders: ProcessBuilder[] = [];
  const failures: unknown[] = [];
  const onFailure = (reason: unknown): void => {
    failures.push(reason);
  };
  let committing = false;
  let writeAttempted = false;
  let returned: unknown;

  function assertScriptSucceeded(): void {
    if (writeAttempted) {
      throw writeNotAllowed();
    }
    if (failures.length > 0) {
      throw scriptFailure(failures[0]);
    }
  }

  setEditorHooks(model, {
    beforeCommit: assertScriptSucceeded,
    beforeWrite() {
      if (!committing) {
        writeAttempted = true;
        throw writeNotAllowed();
      }
    },
    builderCreated(builder) {
      builders.push(builder);
    }
  });
  process.on("unhandledRejection", onFailure);
  process.on("uncaughtException", onFailure);

  try {
    try {
      returned = await body(model, new Console(process.stderr, process.stderr));
    } catch (error) {
      throw scriptFailure(error);
    }
    await new Promise((resolve) => setImmediate(resolve));
    assertScriptSucceeded();
    if (
      returned !== undefined &&
      returned !== model &&
      !(returned instanceof ProcessBuilder && returned.editor() === model)
    ) {
      throw new EditRunnerError(
        "INVALID_RETURN",
        "The edit body must return nothing, model, or a ProcessBuilder created from model.continueProcess(...).at(...)"
      );
    }
    for (const builder of builders) {
      builder.build();
    }

    const writeOptions: WriteOptions = {
      force: options.force,
      layout: options.layout,
      output: options.output
    };
    committing = true;
    let pending: Promise<WriteResult>;

    try {
      pending = returned instanceof ProcessBuilder
        ? returned.write(writeOptions)
        : model.write(writeOptions);
    } finally {
      committing = false;
    }

    try {
      return await pending;
    } catch (error) {
      assertScriptSucceeded();
      throw error;
    }
  } finally {
    process.off("unhandledRejection", onFailure);
    process.off("uncaughtException", onFailure);
  }
}
