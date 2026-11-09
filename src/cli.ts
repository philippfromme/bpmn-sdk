#!/usr/bin/env node
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";

import {
  EditRunnerError,
  runEdit,
  toErrorReport,
  type EditOptions
} from "./edit-runner.js";

const USAGE =
  "Usage: bpmn-sdk edit <file> [--output <file>] [--force] [--layout auto|none] < edit-body.js";

const HELP = `${USAGE}

Opens <file> with Bpmn.open(), runs the stdin body as an async function with
\`model\` in scope, and writes exactly once after the body completes. Return a
ProcessBuilder from model.continueProcess(...).at(...) to write through its
completeness checks. Do not call write() in the body.

Prints the write result, or { "error": { "code", "message" } }, as one JSON
object and exits non-zero on failure.

Example:
  bpmn-sdk edit model.bpmn <<'JS'
  model.element("Task_1").setName("Renamed");
  JS`;

function parseEditArguments(
  args: readonly string[]
): Omit<EditOptions, "script"> | "help" {
  let parsed;

  try {
    parsed = parseArgs({
      allowPositionals: true,
      args: [...args],
      options: {
        force: { type: "boolean" },
        help: { short: "h", type: "boolean" },
        layout: { type: "string" },
        output: { short: "o", type: "string" }
      },
      strict: true
    });
  } catch (error) {
    throw new EditRunnerError(
      "INVALID_ARGUMENTS",
      `${error instanceof Error ? error.message : String(error)}\n${USAGE}`
    );
  }

  const { positionals, values } = parsed;
  if (values.help === true) {
    return "help";
  }

  const [command, file, ...rest] = positionals;
  if (command !== "edit" || file === undefined || rest.length > 0) {
    throw new EditRunnerError("INVALID_ARGUMENTS", USAGE);
  }
  if (
    values.layout !== undefined &&
    values.layout !== "auto" &&
    values.layout !== "none"
  ) {
    throw new EditRunnerError(
      "INVALID_ARGUMENTS",
      `--layout must be "auto" or "none", received "${values.layout}"`
    );
  }

  return {
    file,
    force: values.force,
    layout: values.layout,
    output: values.output
  };
}

async function main(): Promise<void> {
  try {
    const options = parseEditArguments(process.argv.slice(2));
    if (options === "help") {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    if (process.stdin.isTTY) {
      throw new EditRunnerError(
        "INVALID_ARGUMENTS",
        `Provide the edit body on stdin, for example with a heredoc.\n${USAGE}`
      );
    }

    const result = await runEdit({
      ...options,
      script: await text(process.stdin)
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(toErrorReport(error))}\n`);
    process.exitCode = 1;
  }
}

await main();
