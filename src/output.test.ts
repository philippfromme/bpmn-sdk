import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { replaceSourceFile, writeNewOutput, writeOutputFile } from "./output.js";

test("uses exclusive creation when hard links are unavailable", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bpmn-sdk-output-"));
  const temporary = join(directory, "output.tmp");
  const output = join(directory, "output.json");
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(temporary, "written");

  const unsupportedLink: typeof import("node:fs/promises").link = async () => {
    const error = new Error("hard links are unavailable") as NodeJS.ErrnoException;
    error.code = "ENOTSUP";
    throw error;
  };

  await writeNewOutput(temporary, output, "written", unsupportedLink);

  assert.equal(await readFile(output, "utf8"), "written");
  await assert.rejects(
    writeNewOutput(temporary, output, "replacement", unsupportedLink),
    { code: "EEXIST" }
  );
  assert.equal(await readFile(output, "utf8"), "written");
});

test("checks runner failures after staging but before publishing any destination", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "bpmn-sdk-output-guard-"));
  const source = join(directory, "source.bpmn");
  const existing = join(directory, "existing.bpmn");
  const output = join(directory, "output.bpmn");
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(source, "source");
  await writeFile(existing, "existing");
  const failure = new Error("script failed during staging");
  let checks = 0;
  const beforeCommit = (): void => {
    checks++;
    throw failure;
  };

  for (const write of [
    () => replaceSourceFile(source, "replacement", beforeCommit),
    () => writeOutputFile(output, "new", false, source, beforeCommit),
    () => writeOutputFile(existing, "replacement", true, source, beforeCommit)
  ]) {
    await assert.rejects(write(), (error) => error === failure);
    assert.equal(await readFile(source, "utf8"), "source");
    assert.equal(await readFile(existing, "utf8"), "existing");
    assert.deepEqual((await readdir(directory)).sort(), ["existing.bpmn", "source.bpmn"]);
  }
  assert.equal(checks, 3);
});
