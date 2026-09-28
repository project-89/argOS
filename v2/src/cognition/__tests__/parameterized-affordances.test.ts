import { jest } from "@jest/globals";
import { Goal, Plan } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { matchesAffordanceCommand } from "../../world/affordance-command";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { createIntentGoal } from "../cognition-system";
import { checkStepPrerequisites, createPlanEntity, getNextPlannedAction, validateGeneratedPlan, type GeneratedPlan } from "../planning-system";
import { buildAvailableActionsContext } from "../action-registry";
import { drainPendingStimuli } from "../stimulus-queue";

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Parameterized-affordance tests are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each([
  ["route north", "route north", true],
  ["route north", "  ROUTE \t north  ", true],
  ["route north", "route south", false],
  ["route north", 'route "north"', false],
  ["route north", '"route" north', false],
  ["route north", "route north elsewhere", false],
  ["route north", "route north; route south", false],
  ["route north", "route", false],
  ["unlock <combination>", "unlock 6421", true],
  ["unlock <four digits>", "unlock abc", true], // Executor validates the type; no English type guessing.
  ["unlock <four digits>", "unlock 6421", true],
  ["unlock <four digits>", "unlock", false],
  ["unlock <four digits>", "unlock <four digits>", false],
  ["unlock <four digits>", 'unlock ""', false],
  ["unlock <four digits>", 'unlock "   "', false],
  ["unlock <four digits>", "unlock 6421 extra", false],
  ["unlock <four digits>", "unlock 6421; route north", false],
  ["unlock <four digits>", "unlock 6421\nroute north", false],
  ["unlock <four digits>", "unlock 6421 && route north", false],
  ["unlock <four digits>", "unlock 6421;", false],
  ["unlock <four digits>", "unlock6421", false],
  ["send <message> to <recipient>", 'send "meet at the gate" to Ada', true],
  ["send <message> to <recipient>", '"send" "meet at the gate" to Ada', false],
  ["send <message> to <recipient>", 'send "meet at the gate" "to" Ada', false],
  ["send <message> to <recipient>", 'send "meet at the gate" elsewhere Ada', false],
  ["send <message> to <recipient>", 'send "unclosed to Ada', false],
  ["send <message> to <recipient>", 'send "message"extra to Ada', false],
  ["unlock <broken", "unlock 6421", false],
  ["unlock <>", "unlock 6421", false],
  ["run_command", "run_command node check.js && node verify.js", true],
  ["write_file", 'write_file {"path":"note.txt","content":"line one\\nline two"}', true],
  ["read_file", "READ_FILE folder/note.txt", true],
  ["read_file", "read_file_extra folder/note.txt", false],
  ["open", "open", true],
  ["", "route north", false],
] as const)("advertised %s matches issued %s: %s", (name, issued, expected) => {
  expect(matchesAffordanceCommand(name, issued)).toBe(expected);
});

function fixture() {
  const world = createArgosWorld("Parameterized controls"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Control room" }), remote = createRoomEntity(world, { name: "Remote room" });
  const actor = createAgentEntity(world, { name: "Ada", role: "technician", systemPrompt: "Use observed controls.", roomId: room });
  const panel = createObjectEntity(world, { name: "Routing board", roomId: room, portable: false });
  const keypad = createObjectEntity(world, { name: "Storage latch", roomId: room, portable: false });
  const remotePanel = createObjectEntity(world, { name: "Remote board", roomId: remote, portable: false });
  const controls = new Map<number, string[]>([[panel, ["route north", "route south", "tune amber"]], [keypad, ["unlock <combination>"]], [remotePanel, ["route north"]]]);
  const remove = registerAgentWorldCapabilities(world, actor, {
    ready: () => true, busy: () => false, context: () => "", execute: () => false,
    affordances: target => (controls.get(target) || []).map(name => ({ name, requires: [] })),
  });
  const goal = createIntentGoal(world, actor, "Configure the available local controls.", 8);
  const plan = (target: string, content: string): GeneratedPlan => ({
    goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Use the selected control", actionType: "interact", target, content }],
  });
  return { world, actor, panel, keypad, controls, goal, plan, remove };
}

test.each([
  ["Routing board", "route north"], ["Routing board", "route south"],
  ["Routing board", "tune amber"], ["Storage latch", "unlock 6421"],
])("%s / %s agrees across action menu, generated-plan validation and stored-step execution", (target, content) => {
  const f = fixture();
  try {
    const planned = f.plan(target, content);
    const menu = buildAvailableActionsContext(f.world, f.actor).objectAffordances.filter(action => action.target === target && action.action === "interact");
    expect(menu.some(action => matchesAffordanceCommand(action.affordanceName!, content))).toBe(true);
    expect(validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], planned)).toEqual({ ok: true, issues: [] });
    expect(checkStepPrerequisites(f.world, f.actor, planned.steps[0])).toBe(true);
    const id = createPlanEntity(f.world, f.actor, f.goal, planned);
    expect(getNextPlannedAction(f.world, f.actor)).toMatchObject({ target, content });
    expect(Plan.currentStep[id]).toBe(0); // Admission is neither execution nor advancement.
    expect(Goal.status[f.goal]).toBe("active");
  } finally { f.remove(); }
});

test.each([
  ["Routing board", "route east"], ["Routing board", "route north extra"],
  ["Routing board", "tune violet"], ["Storage latch", "unlock"],
  ["Storage latch", "unlock 6421; route north"], ["Remote board", "route north"],
])("%s / %s is rejected by both planner gates without exposing an unavailable operation", (target, content) => {
  const f = fixture();
  try {
    const planned = f.plan(target, content);
    const validation = validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], planned);
    expect(validation.ok).toBe(false);
    if (target !== "Remote board") expect(validation.issues.some(issue => issue.includes(`command "${content}"`))).toBe(true);
    expect(checkStepPrerequisites(f.world, f.actor, planned.steps[0])).toBe(false);
  } finally { f.remove(); }
});

test("a previously allowed argument does not remain available after its actual control disappears", () => {
  const f = fixture();
  try {
    const planned = f.plan("Routing board", "route north");
    const id = createPlanEntity(f.world, f.actor, f.goal, planned);
    expect(getNextPlannedAction(f.world, f.actor)?.content).toBe("route north");
    f.controls.set(f.panel, ["route south"]);
    expect(checkStepPrerequisites(f.world, f.actor, planned.steps[0])).toBe(false);
    expect(getNextPlannedAction(f.world, f.actor)).toBeNull();
    expect(Plan.status[id]).toBe("failed");
    expect(Plan.currentStep[id]).toBe(0);
  } finally { f.remove(); }
});

test.each(["READ_FILE /private/note.txt", "WRITE_FILE /private/note.txt\ncontent", 'WRITE_FILE {"path":"/private/note.txt","content":"text"}'])(
  "case normalization does not bypass existing workspace path restrictions: %s", content => {
    const f = fixture();
    try {
      f.controls.set(f.panel, ["read_file", "write_file"]);
      const validation = validateGeneratedPlan(f.world, f.actor, Goal.description[f.goal], f.plan("Routing board", content));
      expect(validation.ok).toBe(false);
      expect(validation.issues).toEqual(expect.arrayContaining([expect.stringContaining("invalid absolute path")]));
    } finally { f.remove(); }
  },
);

test("uppercase coding-agent commands cannot bypass explicit opt-in, but an explicit request still permits them", () => {
  const f = fixture();
  try {
    f.controls.set(f.panel, ["gemini_cli"]);
    const planned = f.plan("Routing board", "GEMINI_CLI inspect the requested change");
    const denied = validateGeneratedPlan(f.world, f.actor, "Complete ticket: inspect the requested change", planned);
    expect(denied.ok).toBe(false);
    expect(denied.issues).toContain("ticket plans must not use gemini_cli unless the goal explicitly requests UseCLI: true/CLI_ONLY");
    expect(validateGeneratedPlan(f.world, f.actor, "Complete ticket: inspect the requested change | UseCLI: true", planned)).toEqual({ ok: true, issues: [] });
  } finally { f.remove(); }
});

test("case-insensitive required CLI/apply/run detection preserves exact execution order and case-sensitive arguments", () => {
  const f = fixture();
  try {
    f.controls.set(f.panel, ["read_file", "gemini_cli", "git_apply_from_last_gemini", "run_command"]);
    const goal = "Complete ticket: fix the system | Writes: Index.ts | Run: node Test.js | UseCLI: true";
    const step = (content: string) => f.plan("Routing board", content).steps[0];
    const planned = { ...f.plan("Routing board", ""), steps: [
      step("READ_FILE Index.ts"), step("GEMINI_CLI update Index.ts"), step("GIT_APPLY_FROM_LAST_GEMINI Index.ts"), step("RUN_COMMAND node Test.js"),
    ] };
    expect(validateGeneratedPlan(f.world, f.actor, goal, planned)).toEqual({ ok: true, issues: [] });
    const reversed = { ...planned, steps: [planned.steps[0], planned.steps[2], planned.steps[1], planned.steps[3]] };
    expect(validateGeneratedPlan(f.world, f.actor, goal, reversed).issues).toContain("git_apply_from_last_gemini must occur after gemini_cli");
    const wrongCase = { ...planned, steps: [step("READ_FILE index.ts"), ...planned.steps.slice(1)] };
    expect(validateGeneratedPlan(f.world, f.actor, goal, wrongCase).issues).toContain("plan must include read_file for: Index.ts");
    const mentionedOnly = { ...planned, steps: [planned.steps[0], step("GEMINI_CLI mention git_apply_from_last_gemini Index.ts"), planned.steps[3]] };
    expect(validateGeneratedPlan(f.world, f.actor, goal, mentionedOnly).issues).toContain("CLI-only ticket must include git_apply_from_last_gemini for: Index.ts");
  } finally { f.remove(); }
});
