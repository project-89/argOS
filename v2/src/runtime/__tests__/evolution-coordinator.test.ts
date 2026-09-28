import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { createEvolutionCoordinator } from "../evolution-coordinator";
import { withSimulationTask } from "../task-scope";
import { addEntity, createArgosWorld } from "../../ecs/world";
import { createSpiritRegistry, deactivateSpirit } from "../../spirits/spirit-registry";
import { createDynamicSpirit, getSpiritsByType, resetFactoryState } from "../../spirits/spirit-factory";

function artificerFixture(name: string, padding = 0) {
  const world = createArgosWorld(name);
  // Native component storage is process-global; give simultaneous fixtures
  // distinct IDs so the test isolates factory discovery, not storage aliasing.
  for (let i = 0; i < padding; i++) addEntity(world);
  const spirits = createSpiritRegistry(world);
  const artificer = createDynamicSpirit(spirits, {
    name: `${name} Tinker`, type: "artificer", rank: "archangel", domain: "guardian",
  })!;
  return { world, spirits, artificer, god: { systemRegistry: {} } as any };
}

function proposal(id: string, type: "system" | "component" | "entity" | "rule", status = "pending") {
  return {
    id,
    timestamp: 1,
    fromSpiritEid: 10,
    fromSpiritName: "The Weaver",
    type,
    name: id,
    description: id,
    specification: {},
    rationale: "test",
    status,
  } as any;
}

describe("EvolutionCoordinator", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetFactoryState();
  });

  test("God-reviewed mode never auto-approves a pending proposal before native dispatch", async () => {
    const approve = jest.fn(), execute = jest.fn(async () => ({ executed: [], failed: [] }));
    const coordinator = createEvolutionCoordinator({ autoApproveProposals: false, proposalInterval: 1 }, {
      getPendingProposals: () => [proposal("awaiting-god", "entity")],
      getApprovedProposals: () => [], approveProposal: approve, executeProposals: execute,
    } as any);
    const status = await coordinator.run(1, { world: {} as any, god: {} as any, spirits: {} as any });
    expect(approve).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(status.totals.proposalsApproved).toBe(0); expect(status.totals.proposalsExecuted).toBe(0);
  });

  test("God-reviewed mode constrains legacy architect submission before it can self-execute", async () => {
    const architect = { definition: {name: "The Weaver"}, architectConfig: {proposalApproval: "auto", canExecuteDirectly: true} } as any;
    const runArchitect = jest.fn(async () => {
      expect(architect.architectConfig).toMatchObject({proposalApproval: "godai", canExecuteDirectly: false});
      return [proposal("awaiting-god", "entity")];
    });
    const execute = jest.fn(async () => ({executed: [], failed: []}));
    const coordinator = createEvolutionCoordinator({autoApproveProposals: false, architectInterval: 1, proposalInterval: 1}, {
      getSpiritsByType: () => [architect], runArchitect, getApprovedProposals: () => [], executeProposals: execute,
    } as any);
    await coordinator.run(1, {world: {} as any, god: {} as any, spirits: {} as any});
    expect(runArchitect).toHaveBeenCalledTimes(1);expect(execute).not.toHaveBeenCalled();
  });

  test("scoped entity execution ignores legacy, foreign, copied and disallowed approved proposals", async () => {
    const local = proposal("current-entity", "entity", "approved");
    const legacy = proposal("legacy-entity", "entity", "approved"), foreign = proposal("foreign-entity", "entity", "approved");
    const system = proposal("observed-system", "system", "approved"), component = proposal("observed-component", "component", "approved");
    const rule = proposal("observed-rule", "rule", "approved"), copied = structuredClone(local);
    const approved = [legacy, foreign, system, component, rule, copied];
    const getObserved = jest.fn((_world: any) => [local, system, component, rule]);
    const execute = jest.fn(async (_world: any, _systems: any, _options: any) => ({ executed: [local.name], failed: [], queued: [] }));
    const config = { enabledStages: ["proposals"] as any, proposalInterval: 1, autoApproveProposals: false,
      requireObservedProposals: true, allowedProposalTypes: ["entity"] as any, maxProposalExecutions: 1 };
    const coordinator = createEvolutionCoordinator(config, { getApprovedProposals: () => approved,
      getCurrentObservedProposals: getObserved, executeProposals: execute } as any);
    // Even an otherwise trusted caller cannot broaden the existing grant by editing its input array.
    config.allowedProposalTypes.push("system");
    const world = {} as any, systems = {}, context = { world, god: { systemRegistry: systems } as any, spirits: {} as any };
    const skipped = await coordinator.run(1, context);
    expect(execute).not.toHaveBeenCalled(); expect(skipped.totals.proposalsExecuted).toBe(0);
    approved.push(local);
    const status = await coordinator.run(2, context);
    expect(getObserved.mock.calls).toEqual([[world], [world]]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(world, systems, { maxProposals: 1, requireObserved: true, allowedTypes: ["entity"] });
    expect(status.totals).toMatchObject({ proposalsExecuted: 1, entitiesCreated: 1, systemsCreated: 0, componentsCreated: 0, proposalFailures: 0 });
    // Filtered proposals retain their evidence/status for their own owner.
    expect(approved.every(row => row.status === "approved")).toBe(true);
  });

  test("an empty proposal-type grant dispatches no work even for an exact observed entity", async () => {
    const local = proposal("current-entity", "entity", "approved"), execute = jest.fn();
    const coordinator = createEvolutionCoordinator({ enabledStages: ["proposals"], proposalInterval: 1,
      autoApproveProposals: false, requireObservedProposals: true, allowedProposalTypes: [] }, {
      getApprovedProposals: () => [local], getCurrentObservedProposals: () => [local], executeProposals: execute,
    } as any);
    await coordinator.run(1, { world: {} as any, god: {} as any, spirits: {} as any });
    expect(execute).not.toHaveBeenCalled(); expect(local.status).toBe("approved");
  });

  test("scoped auto-approval cannot approve legacy, foreign, copied or disallowed pending proposals", async () => {
    const local = proposal("current-entity", "entity"), legacy = proposal("legacy-entity", "entity");
    const foreign = proposal("foreign-entity", "entity"), system = proposal("current-system", "system");
    const component = proposal("current-component", "component"), copied = structuredClone(local);
    const pending = [legacy, foreign, copied, system, component, local];
    const approve = jest.fn((_id: string, _god: number) => true), execute = jest.fn();
    const coordinator = createEvolutionCoordinator({ enabledStages: ["proposals"], proposalInterval: 1,
      requireObservedProposals: true, allowedProposalTypes: ["entity"] }, {
      getPendingProposals: () => pending, getApprovedProposals: () => [],
      getCurrentObservedProposals: () => [local, system, component], approveProposal: approve, executeProposals: execute,
    } as any);
    const status = await coordinator.run(1, { world: {} as any, god: { eid: 7 } as any, spirits: {} as any });
    expect(approve.mock.calls).toEqual([[local.id, 7]]);
    expect(status.totals.proposalsApproved).toBe(1); expect(execute).not.toHaveBeenCalled();
  });

  test("runs the full specialist pipeline and exposes cumulative health", async () => {
    const calls: Record<string, number> = {};
    const count = (name: string) => { calls[name] = (calls[name] || 0) + 1; };
    const pending = [proposal("system-proposal", "system"), proposal("rule-proposal", "rule")];
    const fixture = artificerFixture("Full pipeline");

    const coordinator = createEvolutionCoordinator({
      crafterInterval: 1,
      stewardInterval: 1,
      architectInterval: 1,
      artificerInterval: 1,
      lawgiverInterval: 1,
      proposalInterval: 1,
      fileRepairInterval: 1,
    }, {
      runCrafter: async () => { count("crafter"); return { entitiesCreated: 2, recommendationsSent: 1, evolutionProposalsSent: 1 }; },
      runSteward: async () => { count("steward"); return { roomsPopulated: 1, entitiesGenerated: 3, systemRequestsSent: 1 }; },
      runArchitect: async () => { count("architect"); return [proposal("new-system", "system", "approved")]; },
      runArtificer: async () => { count("artificer"); return { repairsAttempted: [{ success: true }] } as any; },
      runLawgiver: async () => { count("lawgiver"); return { rulesProposed: 2, rulesApproved: 1 }; },
      executeProposals: async () => { count("execute"); return { executed: ["new-system"], failed: [] }; },
      getPendingProposals: () => pending,
      getApprovedProposals: () => [proposal("new-system", "system", "approved")],
      approveProposal: (id: string) => { count(`approve:${id}`); return true; },
      getSpiritsByType: (type: string) => type === "architect"
        ? [{ definition: { name: "The Weaver" } } as any]
        : type === "artificer" ? [fixture.artificer] : [],
      getSystemsNeedingFix: () => ["BrokenSystem"] as any,
      fixAllQueuedSystems: async () => { count("file-repair"); return { fixed: ["BrokenSystem"], failed: [] } as any; },
    } as any);

    const status = await coordinator.run(1, { ...fixture, god: { eid: 1, systemRegistry: {}, fileSystems: [] } as any });

    expect(calls).toMatchObject({
      crafter: 1,
      steward: 1,
      architect: 1,
      artificer: 1,
      lawgiver: 1,
      execute: 1,
      "approve:system-proposal": 1,
      "file-repair": 1,
    });
    expect(calls["approve:rule-proposal"]).toBeUndefined();
    expect(status.totals).toMatchObject({
      entitiesCreated: 5,
      roomsPopulated: 1,
      proposalsCreated: 1,
      proposalsApproved: 1,
      proposalsExecuted: 1,
      systemsCreated: 1,
      systemsRepaired: 2,
      rulesProposed: 2,
      rulesApproved: 1,
    });
    expect(status.recentErrors).toEqual([]);
    expect(status.stageRuns).toEqual({ crafter: 1, steward: 1, architect: 1, proposals: 1, artificer: 1, lawgiver: 1, "file-repair": 1 });
  });

  test("artificers must be exact active members of the current world's registry", async () => {
    const a = artificerFixture("World A"), b = artificerFixture("World B", 10);
    const inactiveA = createDynamicSpirit(a.spirits, {
      name: "Inactive A", type: "artificer", rank: "archangel", domain: "guardian",
    })!;
    const inactiveB = createDynamicSpirit(b.spirits, {
      name: "Inactive B", type: "artificer", rank: "archangel", domain: "guardian",
    })!;
    deactivateSpirit(a.spirits, inactiveA.eid); deactivateSpirit(b.spirits, inactiveB.eid);
    // A matching ID/name is insufficient: this is not the registered object.
    const copiedA = { ...a.artificer };
    const runArtificer = jest.fn(async (_world: any, _systems: any, _registry: any, _spirit: any) => ({ repairsAttempted: [] }));
    const coordinator = createEvolutionCoordinator({ enabledStages: ["artificer"], artificerInterval: 1 }, {
      getSpiritsByType: (type: Parameters<typeof getSpiritsByType>[0]) => [...getSpiritsByType(type), copiedA], runArtificer,
    } as any);
    await coordinator.run(1, a); await coordinator.run(2, b);
    expect(runArtificer).toHaveBeenCalledTimes(2);
    expect(runArtificer.mock.calls[0][0]).toBe(a.world); expect(runArtificer.mock.calls[0][2]).toBe(a.spirits);
    expect(runArtificer.mock.calls[0][3]).toBe(a.artificer);
    expect(runArtificer.mock.calls[1][0]).toBe(b.world); expect(runArtificer.mock.calls[1][2]).toBe(b.spirits);
    expect(runArtificer.mock.calls[1][3]).toBe(b.artificer);
    expect(coordinator.getStatus().recentErrors).toEqual([]);
  });

  test("artificer membership and activation are rechecked after an earlier asynchronous review", async () => {
    const f = artificerFixture("Current world");
    const removed = createDynamicSpirit(f.spirits, {
      name: "Removed during review", type: "artificer", rank: "archangel", domain: "guardian",
    })!;
    const inactive = createDynamicSpirit(f.spirits, {
      name: "Deactivated during review", type: "artificer", rank: "archangel", domain: "guardian",
    })!;
    const runArtificer = jest.fn(async () => {
      await Promise.resolve();
      f.spirits.spirits.set(removed.eid, { ...removed });
      deactivateSpirit(f.spirits, inactive.eid);
      return { repairsAttempted: [] };
    });
    const coordinator = createEvolutionCoordinator({ enabledStages: ["artificer"], artificerInterval: 1 }, {
      getSpiritsByType: () => [f.artificer, removed, inactive], runArtificer,
    } as any);
    await coordinator.run(1, f);
    expect(runArtificer).toHaveBeenCalledTimes(1);
    expect(coordinator.getStatus().recentErrors).toEqual([]);
  });

  test("an explicit architect-only grant never invokes disabled specialist or execution stages", async () => {
    const architect = { eid: 41, definition: { name: "The Weaver" } } as any;
    const deps = {
      runCrafter: jest.fn(), runSteward: jest.fn(), runArchitect: jest.fn(async () => []),
      runArtificer: jest.fn(), runLawgiver: jest.fn(), executeProposals: jest.fn(),
      getPendingProposals: jest.fn(), getApprovedProposals: jest.fn(), approveProposal: jest.fn(),
      getSpiritsByType: jest.fn(() => [architect]), getSystemsNeedingFix: jest.fn(), fixAllQueuedSystems: jest.fn(),
    };
    const coordinator = createEvolutionCoordinator({ enabledStages: ["architect"], architectNames: ["The Weaver"],
      crafterInterval: 1, stewardInterval: 1, architectInterval: 1, artificerInterval: 1,
      lawgiverInterval: 1, proposalInterval: 1, fileRepairInterval: 1 }, deps as any);
    const context = { world: {} as any, god: { systemRegistry: {} } as any,
      spirits: { spirits: new Map([[architect.eid, architect]]) } as any };
    await coordinator.run(1, context); const status = await coordinator.run(2, context);
    expect(deps.runArchitect).toHaveBeenCalledTimes(2);
    expect(deps.getSpiritsByType.mock.calls).toEqual([["architect"], ["architect"]]);
    for (const [name, dependency] of Object.entries(deps)) {
      if (!["runArchitect", "getSpiritsByType"].includes(name)) expect(dependency).not.toHaveBeenCalled();
    }
    expect(status.stageRuns).toEqual({ crafter: 0, steward: 0, architect: 2, proposals: 0, artificer: 0, lawgiver: 0, "file-repair": 0 });
    expect(status.totals.proposalsExecuted).toBe(0);
  });

  test.each([
    { enabledStages: [], stageRunLimits: {} },
    { enabledStages: ["architect"], stageRunLimits: { architect: 0 } },
  ])("an empty grant or zero stage allowance never starts work: %j", async config => {
    const getSpirits = jest.fn(() => []), runArchitect = jest.fn(async () => []), runCrafter = jest.fn(), runSteward = jest.fn();
    const coordinator = createEvolutionCoordinator({ ...config, architectInterval: 1, crafterInterval: 1, stewardInterval: 1 } as any,
      { getSpiritsByType: getSpirits, runArchitect, runCrafter, runSteward } as any);
    const context = { world: {} as any, god: {} as any, spirits: { spirits: new Map() } as any };
    await coordinator.run(1, context); const status = await coordinator.run(1000, context);
    for (const dependency of [getSpirits, runArchitect, runCrafter, runSteward]) expect(dependency).not.toHaveBeenCalled();
    expect(Object.values(status.stageRuns)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(Object.values(status.lastRunTick)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("a failed stage burns its lifetime attempt allowance while other permitted stages continue", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const architect = { eid: 41, definition: { name: "The Weaver" } } as any;
    const runArchitect = jest.fn(async () => { throw new Error("Architect request failed"); });
    const runSteward = jest.fn(async () => ({ roomsPopulated: 0, entitiesGenerated: 0, systemRequestsSent: 0 }));
    const coordinator = createEvolutionCoordinator({ enabledStages: ["architect", "steward"], architectNames: ["The Weaver"],
      stageRunLimits: { architect: 1, steward: 2 }, architectInterval: 1, stewardInterval: 1 }, {
      getSpiritsByType: () => [architect], runArchitect, runSteward,
    } as any);
    const context = { world: {} as any, god: {} as any, spirits: { spirits: new Map([[architect.eid, architect]]) } as any };
    await coordinator.run(1, context); await coordinator.run(2, context); const status = await coordinator.run(1000, context);
    expect(runArchitect).toHaveBeenCalledTimes(1); expect(runSteward).toHaveBeenCalledTimes(2);
    expect(status.stageRuns.architect).toBe(1); expect(status.stageRuns.steward).toBe(2);
    expect(status.lastRunTick.architect).toBe(1); expect(status.lastRunTick.steward).toBe(2);
    expect(status.recentErrors).toEqual([{ tick: 1, stage: "architect", error: "Architect request failed" }]);
    expect(status.running).toBe(false); expect(status.totals.proposalsCreated).toBe(0);
  });

  test("named architects require the exact current world registry object, not a global name or recycled eid", async () => {
    const local = { eid: 41, definition: { name: "The Weaver" } } as any;
    const foreignSameId = { eid: 41, definition: { name: "The Weaver" } } as any;
    const foreignOtherId = { eid: 42, definition: { name: "The Weaver" } } as any;
    const localOtherName = { eid: 43, definition: { name: "Other architect" } } as any;
    const crafter = { eid: 44, definition: { name: "The Crafter" } } as any;
    let globalArchitects = [foreignSameId, foreignOtherId, local, localOtherName, crafter];
    const registry = { spirits: new Map([[local.eid, local], [localOtherName.eid, localOtherName], [crafter.eid, crafter]]) };
    const runArchitect = jest.fn(async (_world: any, _systems: any, _registry: any, _spirit: any) => []);
    const coordinator = createEvolutionCoordinator({ enabledStages: ["architect"], architectInterval: 1,
      architectNames: ["The Weaver", "The Crafter"] }, { getSpiritsByType: () => globalArchitects, runArchitect } as any);
    const context = { world: {} as any, god: { systemRegistry: {} } as any, spirits: registry as any };
    await coordinator.run(1, context);
    expect(runArchitect).toHaveBeenCalledTimes(1); expect(runArchitect.mock.calls[0][3]).toBe(local);
    const replacement = { eid: local.eid, definition: { name: "The Weaver" } } as any;
    registry.spirits.set(local.eid, replacement);
    await coordinator.run(2, context);
    expect(runArchitect).toHaveBeenCalledTimes(1);
    globalArchitects = [local, foreignSameId, foreignOtherId, replacement];
    await coordinator.run(3, context);
    expect(runArchitect).toHaveBeenCalledTimes(2); expect(runArchitect.mock.calls[1][3]).toBe(replacement);
  });

  test("the host's input arrays and budgets cannot mutate an existing coordinator grant", async () => {
    const architect = { eid: 41, definition: { name: "The Weaver" } } as any;
    const config = { enabledStages: ["architect"] as any, architectNames: ["The Weaver"], stageRunLimits: { architect: 1 }, architectInterval: 1, crafterInterval: 1 };
    const runArchitect = jest.fn(async () => []), runCrafter = jest.fn();
    const coordinator = createEvolutionCoordinator(config, { runArchitect, runCrafter, getSpiritsByType: () => [architect] } as any);
    config.enabledStages.push("crafter"); config.architectNames.length = 0; config.stageRunLimits.architect = 50;
    const context = { world: {} as any, god: {} as any, spirits: { spirits: new Map([[architect.eid, architect]]) } as any };
    await coordinator.run(1, context); await coordinator.run(2, context);
    expect(runArchitect).toHaveBeenCalledTimes(1); expect(runCrafter).not.toHaveBeenCalled();
    expect(coordinator.config.architectNames).toEqual(["The Weaver"]);
    expect(coordinator.getStatus().stageRuns.architect).toBe(1);
  });

  test.each([-1, .5, NaN, Infinity])("invalid lifetime stage budget %s is rejected before any stage runs", limit => {
    expect(() => createEvolutionCoordinator({ stageRunLimits: { architect: limit } })).toThrow("Invalid evolution stage budget");
  });
  test("unknown stage grants and budget keys fail closed", () => {
    expect(() => createEvolutionCoordinator({ enabledStages: ["invented-stage"] } as any)).toThrow("Unknown evolution stage");
    expect(() => createEvolutionCoordinator({ stageRunLimits: { "invented-stage": 1 } } as any)).toThrow("Invalid evolution stage budget");
  });

  test("is single-flight and records stage failures without killing later stages", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    let releaseCrafter!: () => void;
    const crafterGate = new Promise<void>((resolve) => { releaseCrafter = resolve; });
    let crafterRuns = 0;
    let stewardRuns = 0;

    const coordinator = createEvolutionCoordinator({
      crafterInterval: 1,
      stewardInterval: 1,
      architectInterval: 100,
      artificerInterval: 100,
      lawgiverInterval: 100,
      proposalInterval: 100,
      fileRepairInterval: 100,
    }, {
      runCrafter: async () => {
        crafterRuns++;
        await crafterGate;
        throw new Error("materializer jammed");
      },
      runSteward: async () => {
        stewardRuns++;
        return { roomsPopulated: 0, entitiesGenerated: 0, systemRequestsSent: 0 };
      },
    } as any);

    const context = { world: {} as any, god: {} as any, spirits: {} as any };
    const first = coordinator.run(1, context);
    const overlapping = await coordinator.run(1, context);
    expect(overlapping.running).toBe(true);
    releaseCrafter();
    const final = await first;

    expect(crafterRuns).toBe(1);
    expect(stewardRuns).toBe(1);
    expect(final.running).toBe(false);
    expect(final.recentErrors).toEqual([
      { tick: 1, stage: "crafter", error: "materializer jammed" },
    ]);
  });

  test("does not run general architect cognition for the Crafter", async () => {
    const architectNames: string[] = [];
    const coordinator = createEvolutionCoordinator({
      crafterInterval: 100,
      stewardInterval: 100,
      architectInterval: 1,
      artificerInterval: 100,
      lawgiverInterval: 100,
      proposalInterval: 100,
      fileRepairInterval: 100,
    }, {
      getSpiritsByType: () => [
        { definition: { name: "The Weaver" } },
        { definition: { name: "The Crafter" } },
      ],
      runArchitect: async (_world: any, _systems: any, _spirits: any, spirit: any) => {
        architectNames.push(spirit.definition.name);
        return [];
      },
    } as any);

    await coordinator.run(1, { world: {} as any, god: { systemRegistry: {} } as any, spirits: {} as any });
    expect(architectNames).toEqual(["The Weaver"]);
  });

  test("simulation cancellation escapes the current stage and forbids later world mutations",async()=>{
    let releaseCrafter!:()=>void;const gate=new Promise<void>(resolve=>{releaseCrafter=resolve;});
    const later:string[]=[];
    const coordinator=createEvolutionCoordinator({crafterInterval:1,stewardInterval:1,architectInterval:1,
      artificerInterval:1,lawgiverInterval:1,proposalInterval:1,fileRepairInterval:1},{
      runCrafter:async()=>{await gate;return {entitiesCreated:0,recommendationsSent:0,evolutionProposalsSent:0};},
      runSteward:async()=>{later.push("steward");return {roomsPopulated:0,entitiesGenerated:0,systemRequestsSent:0};},
      getPendingProposals:()=>{later.push("proposals");return [];},
      getSystemsNeedingFix:()=>{later.push("repair");return [];},
      getSpiritsByType:()=>[],
      runLawgiver:async()=>{later.push("lawgiver");return {rulesProposed:0,rulesApproved:0};},
    } as any);
    const abort=new AbortController();
    const running=withSimulationTask(abort.signal,()=>coordinator.run(1,{world:{} as any,god:{} as any,spirits:{} as any}));
    await Promise.resolve();abort.abort(new Error("simulation stopped"));releaseCrafter();
    await expect(running).rejects.toThrow("simulation stopped");
    expect(later).toEqual([]);expect(coordinator.getStatus().running).toBe(false);
  });
});
