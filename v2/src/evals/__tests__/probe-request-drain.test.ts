import { ProbeRequestDrain } from "../probe-request-drain";
test("shutdown waits for every issued request's terminal observation",async()=>{
  const requests=new ProbeRequestDrain(),first=requests.begin(),second=requests.begin();let done=false;
  const draining=requests.drain(1000).then(result=>{done=true;return result;});
  first();await Promise.resolve();expect(done).toBe(false);expect(requests.size).toBe(1);
  second();expect(await draining).toBe(true);expect(requests.size).toBe(0);
});
test("abort without settlement does not invent a successful drain",async()=>{
  const requests=new ProbeRequestDrain(),finish=requests.begin();
  expect(await requests.drain(1)).toBe(false);expect(requests.size).toBe(1);
  finish();expect(await requests.drain(1)).toBe(true);
});
test("duplicate settlement is harmless; drain deadlines are bounded",async()=>{
  const requests=new ProbeRequestDrain(),finish=requests.begin();finish();finish();
  expect(await requests.drain(1)).toBe(true);
  await expect(requests.drain(Infinity)).rejects.toThrow(/Bounded/);
});
