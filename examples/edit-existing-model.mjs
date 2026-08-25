import { Bpmn } from "../dist/index.js";

// Demonstrates the edit-in-place workflow: a model is created once, changed
// outside the generator (simulated here by a direct editor change), and then
// opened again for a targeted edit plus a fluent continuation. The file is
// the source of truth; the original generator is not re-run.

const output = process.argv[2] ?? "leave-request.bpmn";

// 1. Generate the initial model.
const initial = await Bpmn.createProcess("Process_leave_request", {
  name: "Leave request"
});

await initial
  .startEvent("Start_leave_requested", { name: "Leave requested" })
  .userTask("Task_manager_review", {
    name: "Manager review",
    formId: "leave-request-review"
  })
  .endEvent("End_done", { name: "Done" })
  .write({ output, force: true });

// 2. An external change lands in the file (a reviewer renames a task and adds
//    a note). The generator script is not involved and is now out of date.
const external = await Bpmn.open(output);
external.element("Task_manager_review").setName("Manager review (HR)");
await external.write({});

// 3. Make a further change. Open the current file — external edits included —
//    instead of regenerating. Edit an existing element by exact ID and
//    continue the process fluently from an explicit cursor.
const editor = await Bpmn.open(output);

editor
  .element("Task_manager_review")
  .extensions.ensure("zeebe:IoMapping")
  .addInput({ source: "=requester.id", target: "requesterId" });

const result = await editor
  .continueProcess("Process_leave_request")
  .at("Task_manager_review")
  .serviceTask("Task_notify_requester", {
    name: "Notify requester",
    taskType: "send-email"
  })
  .endEvent("End_notified", { name: "Requester notified" })
  .write({});

console.log(JSON.stringify(result));
