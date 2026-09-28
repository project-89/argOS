import { jest } from "@jest/globals";
import { ApartmentSitcom } from "../apartment-sitcom";
import { getAgentVisualEntities } from "../../cognition/world-capabilities";
import { getDirectContainer } from "../../ecs/location";
import { sitcomLaunchProfile } from "../sitcom-launch-profile";
import { sitcomAudienceMessages, sitcomMessageLabel } from "../sitcom-presentation";
import { sitcomFrame, evaluateSitcom } from "../sitcom-report";
import { requestProject89Influence } from "../project89";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { getIdentityAnchors } from "../../cognition/narrative-memory";
import { buildAgentContext, getAgentPerceptions } from "../../cognition/agent-mind";
import { Goal, Perception } from "../../ecs/components";
import { getRelationTargets } from "bitecs";
import { HasGoal } from "../../ecs/relations";

let t: ApartmentSitcom;
beforeEach(()=>{drainPendingStimuli();jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("offline"));});
afterEach(()=>{t?.stop();expect(fetch).not.toHaveBeenCalled();jest.restoreAllMocks();drainPendingStimuli();});
test("Project 89 keeps native discovery and a private, timed Jerry reply",async()=>{
  t=await ApartmentSitcom.create({scenario:"project89",live:false});await t.start();
  expect(t.characters).toEqual(["Jerry","George"]);expect(t.phoneOwner).toBe("Jerry");
  expect(getAgentVisualEntities(t.sim.world,t.ids.Jerry)).not.toContain(t.ids.cookie);
  expect(t.context("Jerry")).not.toContain("WHO IS WATCHING");
  t.dispatch("Jerry",{type:"interact",target:"Couch storage drawer",content:"open"});t.advance(800);
  expect(getAgentVisualEntities(t.sim.world,t.ids.Jerry)).toContain(t.ids.cookie);
  t.dispatch("Jerry",{type:"pickup",target:"Project 89 card"});t.advance(800);
  expect(getDirectContainer(t.sim.world,t.ids.cookie)).toBe(t.ids.Jerry);
  const id=t.text("What did you find?");t.advance(200);
  expect(t.context("George")).not.toContain("What did you find?");
  expect(evaluateSitcom(t).gates.ownerReadPhone).toBe(false);
  t.dispatch("Jerry",{type:"move",target:"Kitchen"});t.advance(3000);
  t.dispatch("Jerry",{type:"pickup",target:"Jerry's phone"});t.advance(800);
  t.dispatch("Jerry",{type:"interact",target:"Jerry's phone",content:"read_phone"});t.advance(1200);
  expect(t.context("Jerry")).toContain("What did you find?");
  expect(t.context("George")).not.toContain("What did you find?");
  expect(evaluateSitcom(t).gates.ownerReadPhone).toBe(true);
  const before=sitcomFrame(t);
  t.dispatch("Jerry",{type:"interact",target:"Jerry's phone",content:`reply ${JSON.stringify({replyTo:id,text:"A card."})}`});t.advance(10000);
  const after=sitcomFrame(t),reply=after.phone.find(m=>m.direction==="out");
  expect(reply).toMatchObject({text:"A card.",status:"delivered",replyTo:id});
  expect(sitcomAudienceMessages(after,before).some(m=>m.direction==="out")).toBe(false);
  expect(sitcomMessageLabel(reply!,"Jerry")).toMatch(/^Jerry →/);
  expect(()=>requestProject89Influence(t.sim.world,"A visitor arrives")).toThrow();
});
test("launch profile keeps safety and cognition, without the David or cookie premise",()=>{
  expect(sitcomLaunchProfile(["--project89"])).toMatchObject({scenario:"project89",outsideTextAtMs:null,cookieHistory:"legacy",narrativeMind:true,worldMaintenance:true,growthLimits:{maxBuildJobs:0}});
});

test("recognition memories do not create an opening notification or reveal a future text", async () => {
  t = await ApartmentSitcom.create({ scenario:"project89", live:false, outsideTextAtMs:null,
    project89History:"formative", narrativeMind:true });
  await t.start();
  const world = t.sim.world, jerry = t.ids.Jerry;
  const communication = getRelationTargets(world, jerry, HasGoal)
    .find(g => Goal.description[g].startsWith("Stay in touch through my phone"))!;
  const vibrationPerceptions = () => getAgentPerceptions(world, jerry)
    .filter(id => Perception.source[id] === "phone vibration");
  expect(buildAgentContext(world, jerry)).toContain("recognize its familiar double vibration");
  expect(t.context("Jerry")).toContain("AVAILABLE OPERATIONS (rules, not events)");
  expect(t.context("Jerry")).toContain("If it vibrates within hearing");
  for (let step = 0; step < 26; step++) {
    expect(t.phone.unread[t.ids.phone]).toBe(0);
    expect(t.phone.buzzCount[t.ids.phone]).toBe(0);
    expect(t.snapshot().phone).toHaveLength(0);
    expect(vibrationPerceptions()).toHaveLength(0);
    expect(Goal.priority[communication]).toBe(6);
    t.advance(1000);
  }
  const secret = "FUTURE_PRIVATE_MESSAGE_BOUNDARY";
  t.text(secret);
  t.advance(199);
  expect(t.phone.buzzCount[t.ids.phone]).toBe(0);
  expect(vibrationPerceptions()).toHaveLength(0);
  t.advance(1);
  expect(t.phone.unread[t.ids.phone]).toBe(1);
  expect(t.phone.buzzCount[t.ids.phone]).toBe(1);
  expect(vibrationPerceptions().length).toBeGreaterThan(0);
  expect(Goal.priority[communication]).toBe(8);
  expect(buildAgentContext(world, jerry)).not.toContain(secret);
  expect(t.context("George")).not.toContain(secret);
});
test.each(["legacy", "formative"] as const)("character history comparison is explicit and private: %s", async project89History => {
  t = await ApartmentSitcom.create({ scenario:"project89", live:false, project89History, narrativeMind:true });
  const anchors = getIdentityAnchors(t.sim.world,t.ids.Jerry);
  expect(anchors).toHaveLength(project89History === "formative" ? 2 : 0);
  if(project89History === "formative") {
    expect(buildAgentContext(t.sim.world,t.ids.Jerry)).toContain("radio kept cutting out");
    expect(buildAgentContext(t.sim.world,t.ids.George)).not.toContain("radio kept cutting out");
  }
  expect(t.context("Jerry")).not.toContain("WHO IS WATCHING");
  expect(t.snapshot().phone).toHaveLength(0);
});
