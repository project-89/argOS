import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NoObjectGeneratedError } from "ai";
import { createGeminiBuilder, sanitizedAttemptMetadata, type GeminiGeneration } from "../builders";
import type { BuildJob } from "../contracts";

test("Gemini attempt metadata keeps only bounded finish and token evidence",()=>{
  const metadata=sanitizedAttemptMetadata({finishReason:"length",usage:{inputTokens:900,outputTokens:1200,totalTokens:2100,
    inputTokenDetails:{cacheReadTokens:30,secret:"no"},outputTokenDetails:{reasoningTokens:700,textTokens:500}},
    request:{headers:{authorization:"secret"}},response:{body:"private output"},text:"raw candidate"},false);
  expect(metadata).toEqual({ok:false,finishReason:"length",usage:{inputTokens:900,outputTokens:1200,totalTokens:2100,cachedInputTokens:30,reasoningTokens:700}});
  expect(JSON.stringify(metadata)).not.toMatch(/secret|authorization|private|raw candidate|headers|response/);
});

test("missing or invalid provider usage becomes explicit nulls",()=>{
  expect(sanitizedAttemptMetadata({finishReason:7,usage:{outputTokens:Number.NaN}},true)).toEqual({ok:true,finishReason:null,
    usage:{inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null}});
});

function lengthError():NoObjectGeneratedError {
  return new NoObjectGeneratedError({message:"truncated",text:"{",finishReason:"length",
    response:{id:"test",timestamp:new Date(),modelId:"test"},
    usage:{inputTokens:100,outputTokens:12000,totalTokens:12100},
  } as any);
}

async function captureThinkingLevels(errors:unknown[]):Promise<string[]> {
  const directory=await mkdtemp(path.join(tmpdir(),"argos-builder-options-"));
  const calls:Record<string,any>[]=[];
  const generate:GeminiGeneration=async options=>{calls.push(options);throw errors[calls.length-1];};
  const job={request:{source:"test",instruction:"test adaptive retry"}} as BuildJob;
  try {
    await expect(createGeminiBuilder(generate)({job,directory,context:"test registry",signal:new AbortController().signal,progress:()=>{}}))
      .rejects.toThrow("Gemini exhausted validation attempts");
    expect(calls.map(call=>call.maxOutputTokens)).toEqual([12000,12000,12000]);
    return calls.map(call=>call.providerOptions.google.thinkingConfig.thinkingLevel);
  } finally { await rm(directory,{recursive:true,force:true}); }
}

test("confirmed provider length truncation lowers thinking for remaining attempts",async()=>{
  expect(await captureThinkingLevels([lengthError(),new Error("still invalid"),new Error("still invalid")]))
    .toEqual(["medium","low","low"]);
});

test("arbitrary invalid generations retain medium thinking",async()=>{
  expect(await captureThinkingLevels([new Error("invalid one"),new Error("invalid two"),new Error("invalid three")]))
    .toEqual(["medium","medium","medium"]);
});
