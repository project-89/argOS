import { foregroundControlShape } from "../foreground-response-shape";

test("control diagnostics distinguish nulls, structure and enumerations without retaining prose",()=>{
  const result={goalReview:{goalId:17,disposition:"complete",reason:"PRIVATE REASON", "PRIVATE KEY":"PRIVATE VALUE"},control:{goalId:null,nextPurpose:{goalId:17,purpose:"PRIVATE PURPOSE"}},action:{type:"wait",content:"PRIVATE MESSAGE"}};
  const shape=foregroundControlShape(result,"goalReview.schema")!;
  expect(shape).toBe("goalReview=object(goalId:integer,disposition:string(8),reason:string(14);extra:1);selectedGoal=null;action=wait");
  expect(shape).not.toMatch(/PRIVATE|complete/);
  expect(foregroundControlShape({...result,goalReview:null},"goalReview.schema")).toContain("goalReview=null");
  expect(foregroundControlShape(result,"control.nextPurpose")).toContain("nextPurposeReview=undefined");
});

test("motor plan shape is bounded and does not include target or contents",()=>{
  const result={motorPlan:Array.from({length:100},()=>({type:"pickup",target:"SECRET",content:"SECRET"})),action:{type:"pickup"}};
  const shape=foregroundControlShape(result,"motorPlan")!;
  expect(shape.length).toBeLessThanOrEqual(1000);expect(shape).not.toContain("SECRET");
  expect(shape.match(/type:pickup/g)).toHaveLength(4);
  expect(foregroundControlShape(result,"unrecognized")).toBeUndefined();
});
