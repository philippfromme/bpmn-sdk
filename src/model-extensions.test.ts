import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { Bpmn } from "./index.js";
import {
  expectModelError,
  isModdleElement,
  moddleElements,
  withTemporaryDirectory,
  writeBpmn,
  ZEEBE_NAMESPACE
} from "./test-support.test.js";

test("ensures one I/O mapping, retains inputs, and rejects invalid input values", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:UserTask", {});
  model.append(process, task, "flowElements");
  const mapping = task.extensions.ensure("zeebe:IoMapping");
  mapping.addInput({ source: "=customer.id", target: "customerId" });
  task.extensions.ensure("zeebe:IoMapping").addInput({
    source: "=customer.name",
    target: "customerName"
  });

  expectModelError("INVALID_EXTENSION", () =>
    mapping.addInput({ source: "", target: "customerId" })
  );
  expectModelError("INVALID_EXTENSION", () =>
    mapping.addInput({ source: "=customer.id", target: "" })
  );

  const extensionElements = task.raw.get("extensionElements");
  assert.ok(isModdleElement(extensionElements));
  const values = moddleElements(extensionElements.get("values"));
  assert.equal(values.filter((value) => value.$type === "zeebe:IoMapping").length, 1);
  assert.deepEqual(
    moddleElements(values[0]?.get("inputParameters")).map((input) => [
      input.get("source"),
      input.get("target")
    ]),
    [
      ["=customer.id", "customerId"],
      ["=customer.name", "customerName"]
    ]
  );
});

test("allows I/O mappings only on Zeebe-supported BPMN elements", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:Task", {});
  const serviceTask = model.create("bpmn:ServiceTask", {});
  model.append(process, task, "flowElements");
  model.append(process, serviceTask, "flowElements");

  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:IoMapping")
  );
  serviceTask.extensions.ensure("zeebe:IoMapping").addInput({
    source: "=order.id",
    target: "orderId"
  });
  const extensionElements = serviceTask.raw.get("extensionElements");
  assert.ok(isModdleElement(extensionElements));
  assert.equal(moddleElements(extensionElements.get("values"))[0]?.$type, "zeebe:IoMapping");
});

test("configures forms only on user tasks and retains existing form properties", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const userTask = model.create("bpmn:UserTask", {});
  const serviceTask = model.create("bpmn:ServiceTask", {});
  model.append(process, userTask, "flowElements");
  model.append(process, serviceTask, "flowElements");

  userTask.configureForm({ formId: "customer-form", formKey: "=customer.form" });
  userTask.configureForm({ externalReference: "forms/customer.json" });
  expectModelError("INVALID_EXTENSION", () =>
    serviceTask.configureForm({ formId: "not-allowed" })
  );
  expectModelError("INVALID_EXTENSION", () =>
    userTask.configureForm({ formId: "  " })
  );
  expectModelError("INVALID_EXTENSION", () =>
    userTask.configureForm({})
  );

  const extensionElements = userTask.raw.get("extensionElements");
  assert.ok(isModdleElement(extensionElements));
  const form = moddleElements(extensionElements.get("values"))[0];
  assert.equal(form?.$type, "zeebe:FormDefinition");
  assert.equal(form?.get("formId"), "customer-form");
  assert.equal(form?.get("formKey"), "=customer.form");
  assert.equal(form?.get("externalReference"), "forms/customer.json");
});

test("validates descriptor-backed custom extension construction and nested containment", async () => {
  await withTemporaryDirectory("bpmn-custom-extension", async (directory) => {
    const descriptor = join(directory, "acme.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        name: "Acme",
        prefix: "acme",
        uri: "https://example.test/acme",
        types: [
          {
            name: "Settings",
            superClass: ["Element"],
            properties: [
              { name: "priority", type: "String", isAttr: true },
              { name: "rules", type: "Rule", isMany: true }
            ]
          },
          {
            name: "Rule",
            superClass: ["Element"],
            properties: [{ name: "name", type: "String", isAttr: true }]
          }
        ]
      }),
      "utf8"
    );
    const source = await writeBpmn(
      directory,
      "model.bpmn",
      '  <bpmn:process id="Process_1"><bpmn:task id="Task_1"/></bpmn:process>'
    );
    const model = await Bpmn.open(source, { extensions: [`acme=${descriptor}`] });
    const settings = model.element("Task_1").extensions.ensureCustom(
      "acme:Settings",
      { priority: "normal" }
    );
    settings.set("priority", "high").append("rules", "acme:Rule", { name: "one" });

    expectModelError("INVALID_EXTENSION", () =>
      model.createCustom("missing:Settings")
    );
    expectModelError("INVALID_EXTENSION", () =>
      settings.set("unknown", "value")
    );
    expectModelError("INVALID_CONTAINMENT", () =>
      settings.append("priority", "acme:Rule", { name: "two" })
    );

    const output = join(directory, "output.bpmn");
    await model.write({ layout: "none", output });
    const xml = await readFile(output, "utf8");
    assert.match(xml, /acme:Settings priority="high"/);
    assert.match(xml, /acme:Rule name="one"/);
  });
});

test("configures subscriptions only on messages with a non-empty correlation key", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:Task", {});
  model.append(process, task, "flowElements");
  const message = model.rootElement("bpmn:Message", { id: "Message_1" });

  expectModelError("INVALID_EXTENSION", () =>
    task.configureSubscription("=order.id")
  );
  expectModelError("INVALID_EXTENSION", () =>
    message.configureSubscription("   ")
  );

  message.configureSubscription("=order.id");
  const extensionElements = message.raw.get("extensionElements");
  assert.ok(isModdleElement(extensionElements));
  const subscription = moddleElements(extensionElements.get("values"))[0];
  assert.equal(subscription?.$type, "zeebe:Subscription");
  assert.equal(subscription?.get("correlationKey"), "=order.id");
});

test("validates called decision and called element configuration values", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const ruleTask = model.create("bpmn:BusinessRuleTask", {});
  const callActivity = model.create("bpmn:CallActivity", {});
  model.append(process, ruleTask, "flowElements");
  model.append(process, callActivity, "flowElements");

  expectModelError("INVALID_EXTENSION", () =>
    ruleTask.configureCalledDecision({ decisionId: "" })
  );
  expectModelError("INVALID_EXTENSION", () =>
    callActivity.configureCalledElement({})
  );
  expectModelError("INVALID_EXTENSION", () =>
    callActivity.configureCalledElement({
      processId: "a",
      processIdExpression: "=b"
    })
  );
  expectModelError("INVALID_EXTENSION", () =>
    callActivity.configureCalledElement({ processId: " " })
  );

  ruleTask.configureCalledDecision({ decisionId: "decision-1" });
  callActivity.configureCalledElement({ processId: "process-1" });
});

test("rejects empty script expressions", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const scriptTask = model.create("bpmn:ScriptTask", {});
  model.append(process, scriptTask, "flowElements");

  expectModelError("INVALID_EXTENSION", () =>
    scriptTask.configureScript("")
  );
  expectModelError("INVALID_EXTENSION", () =>
    scriptTask.configureScript("=1 + 1", " ")
  );

  scriptTask.configureScript("=1 + 1", "result");
  const extensionElements = scriptTask.raw.get("extensionElements");
  assert.ok(isModdleElement(extensionElements));
  const script = moddleElements(extensionElements.get("values"))[0];
  assert.equal(script?.$type, "zeebe:Script");
  assert.equal(script?.get("expression"), "=1 + 1");
  assert.equal(script?.get("resultVariable"), "result");
});

test("configures multi-instance loops only on activities with valid inputs", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:ServiceTask", {});
  const event = model.create("bpmn:StartEvent", {});
  model.append(process, task, "flowElements");
  model.append(process, event, "flowElements");

  expectModelError("INVALID_EXTENSION", () =>
    event.configureMultiInstance({
      inputCollection: "=items",
      inputElement: "item"
    })
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.configureMultiInstance({ inputElement: "item" })
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.configureMultiInstance({ inputCollection: " ", inputElement: "item" })
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.configureMultiInstance({
      inputCollection: "=items",
      inputElement: "item",
      outputCollection: ""
    })
  );

  task.configureMultiInstance({
    inputCollection: "=items",
    inputElement: "item"
  });
  const loop = task.raw.get("loopCharacteristics");
  assert.ok(isModdleElement(loop));
  assert.equal(loop.$type, "bpmn:MultiInstanceLoopCharacteristics");
});

test("rejects multi-instance configuration over standard loop characteristics", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:ServiceTask", {});
  model.append(process, task, "flowElements");
  task.createChild("loopCharacteristics", "bpmn:StandardLoopCharacteristics", {});

  expectModelError("INVALID_EXTENSION", () =>
    task.configureMultiInstance({
      inputCollection: "=items",
      inputElement: "item"
    })
  );

  const loop = task.raw.get("loopCharacteristics");
  assert.ok(isModdleElement(loop));
  assert.equal(loop.$type, "bpmn:StandardLoopCharacteristics");
});

test("enforces curated Zeebe placement in the generic extension editor", async () => {
  const model = await Bpmn.create();
  const process = model.process();
  const task = model.create("bpmn:ServiceTask", {});
  model.append(process, task, "flowElements");

  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:Subscription")
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:FormDefinition")
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:CalledElement")
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:CalledDecision")
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:Script")
  );
  expectModelError("INVALID_EXTENSION", () =>
    task.extensions.ensure("zeebe:LoopCharacteristics")
  );

  const definition = task.extensions.ensure("zeebe:TaskDefinition");
  definition.setProperties({ type: "send-notification" });

  const loop = task.createChild(
    "loopCharacteristics",
    "bpmn:MultiInstanceLoopCharacteristics",
    {}
  );
  loop.extensions.ensure("zeebe:LoopCharacteristics").setProperties({
    inputCollection: "=items",
    inputElement: "item"
  });
});

test("opens declared Zeebe extensions automatically", async () => {
  await withTemporaryDirectory("bpmn-zeebe-profile", async (directory) => {
    const source = await writeBpmn(
      directory,
      "model.bpmn",
      '  <bpmn:process id="Process_1"><bpmn:userTask id="Task_1"/></bpmn:process>',
      ` xmlns:zeebe="${ZEEBE_NAMESPACE}"`
    );
    const model = await Bpmn.open(source);
    model.element("Task_1").extensions.ensure("zeebe:IoMapping").addInput({
      source: "=customer.id",
      target: "customerId"
    });
    const extensionElements = model.element("Task_1").raw.get("extensionElements");
    assert.ok(isModdleElement(extensionElements));
    assert.equal(
      moddleElements(extensionElements.get("values"))[0]?.$type,
      "zeebe:IoMapping"
    );
  });
});
