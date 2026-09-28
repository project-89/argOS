import type { AgentAction } from "./agent-mind";
import type { PublicPhysicalOperation } from "../runtime/simulation-timeline";

/** Describe admitted work, not its intended outcome or private arguments. */
export function publicPhysicalOperation(action: AgentAction): PublicPhysicalOperation | undefined {
  const atomic: Partial<Record<AgentAction["type"], PublicPhysicalOperation>> = {
    pickup: "picking_up", drop: "putting_down", give: "handing_over",
    observe: "inspecting", examine: "inspecting",
  };
  if (action.type !== "interact") return atomic[action.type];
  const verb = action.content?.trim().toLowerCase().split(/\s+/)[0];
  const operations: Record<string, PublicPhysicalOperation> = { read: "reading", read_phone: "reading", reply: "typing", type: "typing", eat: "eating", inspect: "inspecting", examine: "inspecting", observe: "inspecting",
    install: "installing", open: "opening", unlock: "opening", close: "closing",
    switch: "switching", route: "switching", wear: "wearing", remove: "removing",
    repair: "repairing", dry: "drying", pump: "pumping", calibrate: "calibrating", align: "calibrating", pour: "pouring", drink: "drinking",
    read_document: "reading", write_document: "typing", review_document: "reading", finish_document: "closing",
  };
  return verb && Object.hasOwn(operations, verb) ? operations[verb] : undefined;
}
