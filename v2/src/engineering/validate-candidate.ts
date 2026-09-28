/** Bundled into a candidate workspace so the coding agent can run the actual admission tests. */
import { readFile } from "node:fs/promises";
import { prepareRelease } from "./release";
const root=process.cwd();
try {
  const request=JSON.parse(await readFile("REQUEST.json","utf8"));
  const result=await prepareRelease(root,request.request?.acceptance ?? []);
  console.log(JSON.stringify({ok:true,testsPassed:result.testsPassed,digest:result.digest}));
} catch(error) {console.error(String(error));process.exitCode=1;}
