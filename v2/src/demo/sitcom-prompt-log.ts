/** Audience-safe renderer diagnostics. NPC cognition and credentials never enter this log. */
export interface H3PromptSend {
  id: number;
  atMs: number;
  message: Record<string, unknown> & { type: string; prompt_version: number };
}
export interface H3PromptLog {
  scope: string;
  entries: Array<{
    version: number; sourceStartSimMs: number; sourceEndSimMs: number; prompt: string;
    sends: H3PromptSend[];
    receipts: Array<Record<string, unknown>>;
  }>;
}

export function formatH3PromptLog(log: H3PromptLog): string {
  return ["ARGOS · H3 PROMPT LOG", log.scope,
    "Client send records mean send() returned, not proof of provider admission or correct video depiction.",
    "Client elapsed time, simulation time and provider chunk time are separate clocks.", "",
    ...log.entries.flatMap(entry => [
      `=== v${entry.version} · simulation ${entry.sourceStartSimMs / 1000}–${entry.sourceEndSimMs / 1000}s ===`,
      entry.sends.length ? `${entry.sends.length} captured send(s)` : "Prepared; no captured send evidence",
      "", entry.prompt, "",
      ...entry.sends.flatMap(send => [`OUTBOUND #${send.id} · client +${(send.atMs / 1000).toFixed(3)}s`, JSON.stringify(send.message, null, 2), ""]),
      "PROVIDER RECEIPTS (not proof of depiction)", JSON.stringify(entry.receipts, null, 2), "",
    ]),
  ].join("\n");
}
