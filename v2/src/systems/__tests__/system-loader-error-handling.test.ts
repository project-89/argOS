import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { withSimulationTask } from "../../runtime/task-scope";
import { runLoadedSystems, getSystemsNeedingFix, clearSystemsNeedingFix, fixAllQueuedSystems, type LoadedSystem } from "../system-loader";

function failing(name="FailingSystem"):LoadedSystem {
  return {name,description:"Always throws",frequency:1,active:true,filePath:`/tmp/${name}.ts`,
    source:"export function run() { throw new Error('boom') }",run:()=>{throw new Error("boom");},
    lastRun:0,consecutiveErrors:0,lastError:null,fixAttempts:0};
}
function queueFailure(world:any,system:LoadedSystem):void {
  const registry=createSystemRegistry();
  runLoadedSystems(world,[system],registry,1,1);runLoadedSystems(world,[system],registry,2,1);runLoadedSystems(world,[system],registry,3,1);
}

describe("system-loader error handling", () => {
  afterEach(() => {
    clearSystemsNeedingFix();
  });

  it("deactivates a repeatedly failing system even if already queued for fix", () => {
    const world = createArgosWorld("TestWorld");
    const registry = createSystemRegistry();

    const sys=failing();

    // Hit the threshold to queue + deactivate.
    runLoadedSystems(world, [sys], registry, 1, 1);
    runLoadedSystems(world, [sys], registry, 2, 1);
    runLoadedSystems(world, [sys], registry, 3, 1);

    expect(sys.active).toBe(false);
    expect(sys.consecutiveErrors).toBeGreaterThanOrEqual(3);
    expect(getSystemsNeedingFix().length).toBe(1);

    // If something re-activates it while still queued, it should immediately be deactivated again.
    sys.active = true;
    runLoadedSystems(world, [sys], registry, 4, 1);

    expect(sys.active).toBe(false);
    expect(getSystemsNeedingFix().length).toBe(1); // no duplicates
  });

  it("scopes equal system names by world",()=>{
    const firstWorld=createArgosWorld("first"),secondWorld=createArgosWorld("second");
    queueFailure(firstWorld,failing("SameName"));queueFailure(secondWorld,failing("SameName"));
    expect(getSystemsNeedingFix()).toHaveLength(2);
    expect(getSystemsNeedingFix(firstWorld)).toHaveLength(1);
    expect(getSystemsNeedingFix(secondWorld)).toHaveLength(1);
  });

  it("retains failed and concurrently-arriving repairs until individually acknowledged",async()=>{
    const firstWorld=createArgosWorld("first"),secondWorld=createArgosWorld("second");
    const first=failing("First"),second=failing("Second");queueFailure(firstWorld,first);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const repairing=fixAllQueuedSystems([first],{world:firstWorld,repair:async()=>{await gate;return null;}});
    queueFailure(secondWorld,second);release();
    await expect(repairing).resolves.toEqual({fixed:[],failed:["First"]});
    expect(first.fixAttempts).toBe(1);expect(getSystemsNeedingFix(firstWorld)).toHaveLength(1);
    expect(getSystemsNeedingFix(secondWorld)).toHaveLength(1);
    await fixAllQueuedSystems([first],{world:firstWorld,repair:async()=>null});
    expect(first.fixAttempts).toBe(2);expect(getSystemsNeedingFix(firstWorld)).toHaveLength(0);
    expect(getSystemsNeedingFix(secondWorld)).toHaveLength(1);
  });

  it("does not consume a queued repair when its simulation task is cancelled",async()=>{
    const world=createArgosWorld("cancelled repair"),system=failing("Cancelled");queueFailure(world,system);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const abort=new AbortController();
    const repairing=withSimulationTask(abort.signal,()=>fixAllQueuedSystems([system],{world,repair:async()=>{await gate;return null;}}));
    abort.abort(new Error("simulation stopped"));release();
    await expect(repairing).rejects.toThrow("simulation stopped");
    expect(system.fixAttempts).toBe(0);expect(getSystemsNeedingFix(world)).toHaveLength(1);
  });
});
