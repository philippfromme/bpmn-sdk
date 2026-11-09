import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runEdit } from "./edit-runner.js";
import { Bpmn } from "./index.js";
import { withTemporaryDirectory, writeBpmn } from "./test-support.test.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

const SUPPORT_PROCESS = `  <bpmn:process id="CustomerSupport" isExecutable="true">
    <bpmn:startEvent id="Start"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="SendReply" name="Send"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:serviceTask>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="SendReply"/>
  </bpmn:process>`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function rejectsWithCode(
  operation: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === code
  );
}

function runCli(
  args: readonly string[],
  input: string,
  cwd: string
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stderr, stdout }));
    child.stdin.end(input);
  });
}

test("runs an edit body against the opened model and writes once in place", async () => {
  await withTemporaryDirectory("bpmn-edit-in-place", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);

    const result = await runEdit({
      file: source,
      layout: "none",
      script: 'model.element("SendReply").setName("Send customer reply");'
    });

    assert.equal(result.status, "written");
    assert.equal(result.destination, source);
    assert.equal(result.layout, "none");
    assert.match(JSON.stringify(result.changes.changed), /SendReply/);
    assert.equal(
      (await Bpmn.open(source)).element("SendReply").raw.get("name"),
      "Send customer reply"
    );
  });
});

test("writes a returned fluent continuation through its builder", async () => {
  await withTemporaryDirectory("bpmn-edit-builder", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const output = join(directory, "output.bpmn");
    const before = await readFile(source, "utf8");

    const result = await runEdit({
      file: source,
      output,
      script: `
        model.element("SendReply").setName("Send customer reply");

        return model
          .continueProcess("CustomerSupport")
          .at("SendReply")
          .endEvent("ReplySent");
      `
    });

    assert.equal(result.destination, output);
    assert.equal(result.layout, "auto");
    assert.equal((await Bpmn.open(output)).element("ReplySent").type, "bpmn:EndEvent");
    assert.equal(await readFile(source, "utf8"), before);
  });
});

test("validates returned and unreturned fluent continuations before writing", async () => {
  await withTemporaryDirectory("bpmn-edit-unfinished", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const output = join(directory, "output.bpmn");
    const before = await readFile(source, "utf8");

    for (const script of [
      'return model.continueProcess("CustomerSupport").at("SendReply").userTask("Review");',
      'model.continueProcess("CustomerSupport").at("SendReply").userTask("Review");',
      `model.continueProcess("CustomerSupport").at("SendReply").userTask("Review");
       return model;`
    ]) {
      await rejectsWithCode(
        runEdit({ file: source, layout: "none", output, script }),
        "UNFINISHED_PROCESS"
      );
    }

    await rejectsWithCode(
      runEdit({
        file: source,
        layout: "none",
        output,
        script: `
          model.continueProcess("CustomerSupport")
            .at("SendReply")
            .parallelGateway("Split")
            .branch("a", (branch) => branch.endEvent("A"))
            .branch("b", (branch) => branch.userTask("B"));
        `
      }),
      "UNFINISHED_BRANCH"
    );

    assert.equal(await exists(output), false);
    assert.equal(await readFile(source, "utf8"), before);
  });
});

test("rejects write() calls inside the edit body and writes nothing", async () => {
  await withTemporaryDirectory("bpmn-edit-write", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const output = join(directory, "output.bpmn");
    const before = await readFile(source, "utf8");

    for (const script of [
      `model.element("SendReply").setName("Changed");
       await model.write({ output: ${JSON.stringify(output)} });`,
      `try { model.write({ output: ${JSON.stringify(output)} }); } catch {}`,
      `await model
         .continueProcess("CustomerSupport")
         .at("SendReply")
         .endEvent("ReplySent")
         .write({ output: ${JSON.stringify(output)} });`,
      `const builder = model.continueProcess("CustomerSupport").at("SendReply");
       try { builder.write({}); } catch {}
       return builder.endEvent("ReplySent");`
    ]) {
      await rejectsWithCode(
        runEdit({ file: source, layout: "none", script }),
        "WRITE_NOT_ALLOWED"
      );
    }

    assert.equal(await exists(output), false);
    assert.equal(await readFile(source, "utf8"), before);
  });
});

test("rejects write() calls deferred past the edit body", async () => {
  await withTemporaryDirectory("bpmn-edit-deferred-write", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const output = join(directory, "output.bpmn");
    const stray = join(directory, "stray.bpmn");
    const outcome: { value?: string } = {};
    const global = globalThis as typeof globalThis & {
      deferredWriteOutcome?: { value?: string };
    };
    global.deferredWriteOutcome = outcome;

    try {
      await rejectsWithCode(runEdit({
        file: source,
        layout: "none",
        output,
        script: `
          setImmediate(() => setImmediate(() => {
            try {
              model.write({ layout: "none", output: ${JSON.stringify(stray)} });
              globalThis.deferredWriteOutcome.value = "allowed";
            } catch (error) {
              globalThis.deferredWriteOutcome.value = error.code;
            }
          }));
        `
      }), "WRITE_NOT_ALLOWED");
      while (outcome.value === undefined) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      assert.equal(await exists(output), false);
      assert.equal(outcome.value, "WRITE_NOT_ALLOWED");
      assert.equal(await exists(stray), false);
    } finally {
      delete global.deferredWriteOutcome;
    }
  });
});

test("CLI reserves stdout for JSON and sends body console output to stderr", async () => {
  await withTemporaryDirectory("bpmn-edit-console", async (directory) => {
    await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);

    for (const fail of [false, true]) {
      const result = await runCli(
        ["edit", "source.bpmn", "--layout", "none"],
        `console.log("editing");
           console.info("details");
           console.warn("warning");
           console.error("diagnostic");
           ${fail ? 'throw new Error("stop");' : 'model.element("SendReply").setName("Changed");'}`,
        directory
      );

      assert.equal(result.exitCode, fail ? 1 : 0);
      assert.equal(result.stdout.trim().split("\n").length, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(fail ? report.error.code : report.status, fail ? "SCRIPT_FAILED" : "written");
      assert.equal(result.stderr, "editing\ndetails\nwarning\ndiagnostic\n");
    }
  });
});

test("CLI reports detached failures without publishing or replacing output", async () => {
  await withTemporaryDirectory("bpmn-edit-detached", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const existing = await writeBpmn(directory, "existing.bpmn", "");
    const before = await readFile(source, "utf8");
    const beforeExisting = await readFile(existing, "utf8");

    for (const outputArgs of [
      [],
      ["--output", "output.bpmn"],
      ["--output", "existing.bpmn", "--force"]
    ]) {
      for (const [script, code] of [
        ['setImmediate(() => model.write({}));', "WRITE_NOT_ALLOWED"],
        ['setImmediate(() => setImmediate(() => model.write({})));', "WRITE_NOT_ALLOWED"],
        ['setImmediate(() => setImmediate(() => Promise.reject(new Error("late"))));', "SCRIPT_FAILED"],
        ['setImmediate(() => setImmediate(() => { throw new Error("late"); }));', "SCRIPT_FAILED"]
      ]) {
        const result = await runCli(
          ["edit", "source.bpmn", "--layout", "none", ...outputArgs],
          `model.element("SendReply").setName("Changed"); ${script}`,
          directory
        );

        assert.equal(result.exitCode, 1, script);
        assert.equal(result.stdout.trim().split("\n").length, 1);
        assert.equal(JSON.parse(result.stdout).error.code, code);
        assert.equal(result.stderr, "");
        assert.equal(await readFile(source, "utf8"), before);
        assert.equal(await readFile(existing, "utf8"), beforeExisting);
        assert.deepEqual((await readdir(directory)).sort(), ["existing.bpmn", "source.bpmn"]);
      }
    }
  });
});

test("reports structured errors for failed edit bodies without writing", async () => {
  await withTemporaryDirectory("bpmn-edit-errors", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const before = await readFile(source, "utf8");

    for (const [script, code] of [
      ['model.element("Missing").setName("Changed");', "ELEMENT_NOT_FOUND"],
      ['model.element("SendReply").setName("Changed"); throw new Error("stop");', "SCRIPT_FAILED"],
      ["undeclared = 1;", "SCRIPT_FAILED"],
      ["model.element(", "SCRIPT_SYNTAX_ERROR"],
      ['return model.element("SendReply");', "INVALID_RETURN"],
      ["return 42;", "INVALID_RETURN"],
      ["  \n", "INVALID_ARGUMENTS"]
    ] as const) {
      await rejectsWithCode(
        runEdit({ file: source, layout: "none", script }),
        code
      );
    }

    await rejectsWithCode(
      runEdit({
        file: join(directory, "missing.bpmn"),
        script: 'model.element("SendReply");'
      }),
      "SOURCE_READ_FAILED"
    );
    assert.equal(await readFile(source, "utf8"), before);
  });
});

test("protects existing outputs unless force is requested", async () => {
  await withTemporaryDirectory("bpmn-edit-force", async (directory) => {
    const source = await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);
    const output = await writeBpmn(directory, "output.bpmn", "");
    const script = 'model.element("SendReply").setName("Changed");';

    await rejectsWithCode(
      runEdit({ file: source, layout: "none", output, script }),
      "OUTPUT_WRITE_FAILED"
    );
    const result = await runEdit({
      file: source,
      force: true,
      layout: "none",
      output,
      script
    });

    assert.equal(result.destination, output);
    assert.equal(
      (await Bpmn.open(output)).element("SendReply").raw.get("name"),
      "Changed"
    );
  });
});

test("CLI prints one JSON object per run and exits non-zero on failure", async () => {
  await withTemporaryDirectory("bpmn-edit-cli", async (directory) => {
    await writeBpmn(directory, "source.bpmn", SUPPORT_PROCESS);

    const success = await runCli(
      ["edit", "source.bpmn", "--output", "output.bpmn", "--layout", "none"],
      `model.element("SendReply").setName("Send customer reply");
       return model.continueProcess("CustomerSupport").at("SendReply").endEvent("ReplySent");`,
      directory
    );
    assert.equal(success.exitCode, 0);
    const result = JSON.parse(success.stdout) as Record<string, unknown>;
    assert.equal(result.destination, "output.bpmn");
    assert.equal(result.layout, "none");
    assert.equal(result.status, "written");
    assert.equal(
      (await Bpmn.open(join(directory, "output.bpmn"))).element("ReplySent").type,
      "bpmn:EndEvent"
    );

    const before = await readFile(join(directory, "source.bpmn"), "utf8");
    for (const [args, input, code] of [
      [["edit", "source.bpmn"], 'Promise.reject(new Error("leaked"));', "SCRIPT_FAILED"],
      [["edit", "source.bpmn"], "model.write({});", "WRITE_NOT_ALLOWED"],
      [["edit", "source.bpmn", "--layout", "manual"], "return;", "INVALID_ARGUMENTS"],
      [["edit", "source.bpmn", "--unknown"], "return;", "INVALID_ARGUMENTS"],
      [["source.bpmn"], "return;", "INVALID_ARGUMENTS"]
    ] as const) {
      const failure = await runCli(args, input, directory);
      assert.equal(failure.exitCode, 1);
      assert.equal(failure.stdout.trim().split("\n").length, 1);
      const report = JSON.parse(failure.stdout) as {
        error: { code: string; message: string };
      };
      assert.equal(report.error.code, code);
      assert.equal(typeof report.error.message, "string");
    }
    assert.equal(await readFile(join(directory, "source.bpmn"), "utf8"), before);
  });
});
