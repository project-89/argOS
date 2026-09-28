import {mkdtemp} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {coupledOracle,queuePressure} from "../pressure-suite";
import {npcContention} from "../npc-contention";

test("coupled world systems agree with a prior-state numerical oracle",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"argos-pressure-regression-"));
  const result=await coupledOracle(directory,7,12,8);
  expect(result.assertions).toBe(12*8*8);
});

test("competing NPC intentions preserve unique item ownership and missing objects",async()=>{
  const result=await npcContention();expect(result.successfulPickups).toBe(20);
});

test("wall-time builder timeout rejects only its candidate; physics and subsequent builds continue",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"argos-pressure-timeout-"));
  const result=await queuePressure(directory);
  expect(result).toMatchObject({timedOutJobs:1,recoveryActive:true,burstRequests:40,accepted:8,rejected:32});
  expect(result.hostTicks).toBeGreaterThan(0);
});
