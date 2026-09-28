import {describe,expect,test} from "@jest/globals";
import {gemini38Middleware} from "../config";
describe("Gemini 3.8 request compatibility",()=>{
  test("normalizes unsupported settings without mutating callers",async()=>{
    const params:any={temperature:0.2,topP:0.8,providerOptions:{google:{thinkingConfig:{thinkingLevel:"minimal",thinkingBudget:256},cachedContent:"cached"}}};
    const result:any=await gemini38Middleware.transformParams!({params,type:"generate",model:{} as any});
    expect(result.temperature).toBeUndefined();expect(result.topP).toBeUndefined();
    expect(result.providerOptions.google.thinkingConfig).toEqual({thinkingLevel:"low"});
    expect(result.providerOptions.google.cachedContent).toBe("cached");expect(params.temperature).toBe(0.2);
  });
});
