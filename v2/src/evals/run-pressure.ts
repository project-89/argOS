import "dotenv/config";
import path from "node:path";
import {mkdir,writeFile} from "node:fs/promises";
import {format} from "node:util";
import {runPressureSuite} from "./pressure-suite";

const args:Record<string,string>=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,"").split("=")));
function bounded(name:string,fallback:number,min:number,max:number){const value=Number(args[name]??fallback);if(!Number.isInteger(value)||value<min||value>max)throw Error(`${name} must be an integer in ${min}..${max}`);return value;}
const options={directory:path.resolve(args.output??`stress-test-output/pressure-${new Date().toISOString().replace(/[:.]/g,"-")}`),seeds:(args.seeds??"7,19,42").split(",").map(Number),entities:bounded("entities",128,1,1000),ticks:bounded("ticks",200,1,10000)};
if(!options.seeds.length||options.seeds.length>12||options.seeds.some(s=>!Number.isInteger(s)||s<0||s>2147483647))throw Error("Supply 1–12 nonnegative integer seeds");
// Suppress verbose library logs, retaining a bounded tail for diagnosing a failed case.
const original=console.log;const tail:string[]=[];
console.log=(...values:unknown[])=>{tail.push(format(...values));if(tail.length>200)tail.shift();};
try {
  const results=await runPressureSuite(options);
  const passed=results.every(r=>r.passed);
  process.stdout.write(`${JSON.stringify({kind:"pressure-summary",passed,cases:results.length,failed:results.filter(r=>!r.passed).map(r=>r.name),directory:options.directory})}\n`);
  if(!passed)process.exitCode=1;
} finally {console.log=original;await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,"runtime-tail.log"),tail.join("\n"));}
