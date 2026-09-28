// Loaded before test code, both in Node and each Jest environment. A blocked
// network attempt remains failed evidence even if application code catches it.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const deny = () => {
  if (process.env.ARGOS_SPIRIT_GATE_NETWORK_LOG) {
    fs.appendFileSync(process.env.ARGOS_SPIRIT_GATE_NETWORK_LOG,
      JSON.stringify({ pid: process.pid, at: new Date().toISOString(), blocked: true, stack: new Error().stack }) + "\n", { mode: 0o600 });
  }
  throw new Error("Network forbidden in the offline spirit readiness checkpoint");
};
globalThis.fetch = deny;
for (const name of ["node:http", "node:https"]) {
  const mod = require(name); mod.request = deny; mod.get = deny;
}
// tsx workers probe their direct parent's local IPC socket on import. This is
// not provider/network traffic; allow only that exact UID/parent-owned path.
const parentPipe = require("node:path").join(require("node:os").tmpdir(), `tsx-${process.geteuid?.() ?? require("node:os").userInfo().username}`, `${process.ppid}.pipe`);
const parentIPC = original => function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  if ((typeof normalized[0] === "string" ? normalized[0] : normalized[0]?.path) !== parentPipe) return deny();
  return Reflect.apply(original, this, args);
};
const net = require("node:net"); net.connect = parentIPC(net.connect); net.createConnection = parentIPC(net.createConnection);
net.Socket.prototype.connect = parentIPC(net.Socket.prototype.connect);
require("node:tls").connect = deny;
require("node:dgram").createSocket = deny;
syncBuiltinESMExports();
