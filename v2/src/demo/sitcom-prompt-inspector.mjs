import { formatH3PromptLog } from "./sitcom-prompt-log.ts";

/** Debugging stays off the video and never gates generation or NPC execution. */
export function installH3PromptInspector(request) {
  const $ = id => document.getElementById(id);
  const local = new Map(), sends = [];
  let saved = { scope: "Exact client-captured outgoing H3 messages. No NPC private cognition.", entries: [] };
  let saving = Promise.resolve(), refreshing = false, lastRefresh = 0, failure = "", full = false, zero = performance.now();
  const links = new Map();
  function report() {
    const entries = new Map(saved.entries.map(entry => [entry.version, { ...entry, sends: [...entry.sends] }]));
    for (const [version, entry] of local) if (!entries.has(version)) entries.set(version, { ...entry, sends: [] });
    for (const send of sends) {
      const entry = entries.get(send.message.prompt_version);
      if (entry && !entry.sends.some(item => item.id === send.id)) entry.sends.push(send);
    }
    return { scope: saved.scope, entries: [...entries.values()].sort((a, b) => a.version - b.version) };
  }
  function draw() {
    const log = report(), select = $("prompt-version"), selected = select.value;
    select.replaceChildren(...log.entries.map(entry => {
      const option = document.createElement("option"); option.value = entry.version;
      option.textContent = `v${entry.version} · ${entry.sourceStartSimMs / 1000}–${entry.sourceEndSimMs / 1000}s · ${entry.sends.length ? "sent" : "prepared"}`;
      return option;
    }));
    if (!$("prompt-follow").checked && log.entries.some(entry => String(entry.version) === selected)) select.value = selected;
    else if (log.entries.length) select.value = log.entries.at(-1).version;
    const chosen = log.entries.find(entry => String(entry.version) === select.value);
    $("prompt-body").textContent = log.entries.length
      ? formatH3PromptLog(full ? log : { ...log, entries: chosen ? [chosen] : [] })
      : "No H3 prompts prepared yet. Simulation-only sessions do not send prompts to H3.";
    $("prompt-status").textContent = failure || `${log.entries.length} prepared · ${log.entries.reduce((n, e) => n + e.sends.length, 0)} captured sends. Receipts do not prove correct depiction.`;
    $("prompt-full").textContent = full ? "Selected prompt" : "View whole log";
  }
  async function refresh(force = false) {
    if (refreshing || !force && (!$("prompt-inspector").open || Date.now() - lastRefresh < 2000)) return;
    refreshing = true; lastRefresh = Date.now();
    try { saved = await request("/prompts"); draw(); }
    catch { $("prompt-status").textContent = "Cannot load server log. Local captured prompts remain available."; }
    finally { refreshing = false; }
  }
  function download(kind) {
    const log = report(), json = kind === "json", id = json ? "prompt-json" : "prompt-text";
    if (links.has(id)) URL.revokeObjectURL(links.get(id));
    const url = URL.createObjectURL(new Blob([json ? JSON.stringify(log, null, 2) : formatH3PromptLog(log)], { type: json ? "application/json" : "text/plain;charset=utf-8" }));
    links.set(id, url); $(id).href = url; $(id).download = `argos-h3-prompts.${json ? "json" : "txt"}`;
  }
  $("prompt-inspector").addEventListener("toggle", () => { if ($("prompt-inspector").open) { draw(); void refresh(true); } });
  $("prompt-version").addEventListener("change", () => { $("prompt-follow").checked = false; full = false; draw(); });
  $("prompt-follow").addEventListener("change", draw);
  $("prompt-full").addEventListener("click", () => { full = !full; draw(); });
  $("prompt-refresh").addEventListener("click", () => void refresh(true));
  $("prompt-json").addEventListener("click", () => download("json"));
  $("prompt-text").addEventListener("click", () => download("text"));
  draw();
  return {
    refresh,
    receipt(message) {
      if (!["prompt_applied", "chunk"].includes(message.type)) return;
      const clean = { type: message.type };
      for (const key of ["prompt_version", "script_version", "script_beats", "script_mode", "chunk_index", "playback_seconds"])
        if (["number", "string"].includes(typeof message[key])) clean[key] = message[key];
      saving = saving.then(async () => {
        try { await request("/telemetry", clean, 8000); }
        catch { failure = "Some provider receipts could not be saved. Send records remain available."; draw(); }
      });
    },
    capture(message, segment) {
      // Snapshot only after send() returned. Later mutations cannot change evidence.
      const send = { id: sends.length + 1, atMs: performance.now() - zero, message: JSON.parse(JSON.stringify(message)) };
      sends.push(send);
      local.set(segment.version, { version: segment.version, sourceStartSimMs: segment.sourceStartSimMs,
        sourceEndSimMs: segment.sourceEndSimMs, prompt: segment.prompt, sends: [], receipts: [] });
      if ($("prompt-inspector").open) draw();
      saving = saving.then(async () => {
        try { await request("/prompts", send, 8000); }
        catch { failure = "Some sends could not be saved on the server. Download this browser’s log to preserve them."; draw(); }
      });
    },
    start() { zero = performance.now(); },
  };
}
