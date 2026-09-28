#!/usr/bin/env node
// Deterministic subprocess fixture, not a model or production builder.
const fs = require('node:fs');
process.stdin.resume();
process.stdin.on('end', () => {
  fs.mkdirSync('components', {recursive:true}); fs.mkdirSync('systems', {recursive:true});
  fs.writeFileSync('components/HostCounter.json', JSON.stringify({name:'HostCounter',description:'Host integration counter',fields:{value:{type:'number',default:0}}}));
  fs.writeFileSync('systems/Count.ts', 'export function run(ctx:any){for(const id of ctx.query("HostCounter"))ctx.set(id,"HostCounter","value",ctx.get(id,"HostCounter","value")+1);}');
  fs.writeFileSync('release.json', JSON.stringify({version:1,components:['components/HostCounter.json'],systems:[{name:'Count',description:'Count actual executions',file:'systems/Count.ts',frequency:1,reads:['HostCounter'],writes:['HostCounter.value']}],tests:[{name:'increments',system:'Count',entities:[{id:1,components:{HostCounter:{value:0}}}],ticks:2,deltaMs:1000,expect:[{entity:1,component:'HostCounter',field:'value',equals:2}]}]}));
  const release = JSON.parse(fs.readFileSync('release.json','utf8'));
  release.tests.push({...release.tests[0],name:'negative input',entities:[{id:1,components:{HostCounter:{value:-2}}}],expect:[{entity:1,component:'HostCounter',field:'value',equals:0}]});
  fs.writeFileSync('release.json',JSON.stringify(release));
  console.log(JSON.stringify({type:'turn.completed'}));
});
