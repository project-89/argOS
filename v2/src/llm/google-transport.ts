import { Agent } from "undici";

// This runtime's native HTTP/2 sender can loop/allocate after cancelling an
// unfinished upload and receiving a window update. Reproduced offline in
// cognition-baseline-h2-upload-03; this is a provider-scoped mitigation, not a
// global dispatcher change. Keep native fetch, TLS verification and aborts.
// Pool reuse matters: creating a new dispatcher per thought defeats keep-alive.
let dispatcher: Agent | undefined;

export const googleProviderFetch: typeof globalThis.fetch = (input, init) => {
  dispatcher ??= new Agent({ allowH2: false });
  // @types/node's older bundled dispatcher types differ from Undici 8's,
  // but native fetch supports this dispatcher interface (tested over TLS).
  const options: RequestInit = {
    ...init, dispatcher: dispatcher as unknown as RequestInit["dispatcher"],
  };
  // Resolve at call time so request-budget/audit observers still see every call.
  return globalThis.fetch(input, options);
};
