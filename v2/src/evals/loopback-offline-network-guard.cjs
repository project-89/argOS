/** Local HTTP regression fixtures only. Numeric loopback, no DNS or providers. */
const fs = require('node:fs'), { syncBuiltinESMExports } = require('node:module');
const deny = () => {
  if (process.env.ARGOS_SPIRIT_GATE_NETWORK_LOG) fs.appendFileSync(process.env.ARGOS_SPIRIT_GATE_NETWORK_LOG,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString(), blocked: true, stack: new Error().stack }) + '\n', { mode: 0o600 });
  throw Error('External network forbidden in loopback-only regressions');
};
const local = host => ['127.0.0.1', '::1', '[::1]'].includes(host);
function allowed(args) {
  if (Array.isArray(args[0])) return allowed(args[0]); // Node's normalized connect tuple
  const [input, options] = args;
  let hostname;
  if (typeof input === 'string' || input instanceof URL || typeof Request !== 'undefined' && input instanceof Request) {
    try { hostname = new URL(input instanceof Request ? input.url : String(input)).hostname; } catch { return false; }
  } else if (typeof input === 'number') hostname = typeof options === 'string' ? options : undefined;
  else hostname = input?.hostname ?? input?.host;
  if (!local(hostname)) return false;
  for (const value of [input, options]) if (value && typeof value === 'object' && !(value instanceof URL) && !(value instanceof Request)) {
    if (value.path && typeof value.port !== 'number' && typeof value.port !== 'string' && !value.hostname && !value.host) return false;
    if (value.hostname && !local(value.hostname) || value.host && !local(value.host)) return false;
    if (value.socketPath) return false;
  }
  return true;
}
const wrap = original => function (...args) { if (!allowed(args)) return deny(); return Reflect.apply(original, this, args); };
globalThis.fetch = wrap(globalThis.fetch);
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = wrap(mod.request); mod.get = wrap(mod.get); }
const net = require('node:net'); net.connect = wrap(net.connect); net.createConnection = wrap(net.createConnection); net.Socket.prototype.connect = wrap(net.Socket.prototype.connect);
require('node:tls').connect = wrap(require('node:tls').connect);
require('node:dgram').createSocket = deny;
syncBuiltinESMExports();
