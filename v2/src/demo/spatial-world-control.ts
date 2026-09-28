/** An operator-requested, bounded house spirit. Language chooses an allowlisted
 * operation; deterministic native mechanics own admission and effect. It cannot
 * issue NPC actions, read private minds, create entities or edit arbitrary ECS. */
import { generateObject } from "ai";
import { z } from "zod/v3";
import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { ObjectState, ObjectType, PhysicalObject, Position, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { spiritModel, THINKING_LEVELS } from "../llm/config";
import { transitionObjectState } from "../world/object-state";
import { worldSchema } from "../world/schema";
import type { createBlackout } from "./spatial-blackout";

const interpretation = z.object({ operation: z.enum(["light_off", "light_on", "box_open", "box_close", "unsupported"]) }).strict();
type Choice = z.infer<typeof interpretation>;
export type WorldControlReceipt = { status: "applied" | "unchanged" | "rejected"; detail: string; atSimMs: number; operation?: Choice["operation"] };
export type WorldCommandInterpreter = (text: string, signal: AbortSignal) => Promise<unknown>;
const textSchema = z.string().trim().min(1).max(500).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));

/** Exact whole-request shortcuts keep familiar controls instant and work in
 * offline mode. Compound, quoted or unrelated requests cannot match partially. */
export function directWorldCommand(text: string): Choice | undefined {
  const request = text.trim().toLowerCase().replace(/[.!]$/, "");
  if (/^(?:please )?(?:turn|switch) (?:the )?(?:apartment )?(?:light|lights|lamp) (?:back )?off(?: please)?$/.test(request)
    || /^(?:please )?(?:cut|disconnect) (?:the )?power$/.test(request)) return { operation: "light_off" };
  if (/^(?:please )?(?:turn|switch) (?:the )?(?:apartment )?(?:light|lights|lamp) (?:back )?on(?: please)?$/.test(request)
    || /^(?:please )?restore (?:the )?power$/.test(request)) return { operation: "light_on" };
  if (/^(?:please )?open (?:the )?(?:supplies|supply) box(?: please)?$/.test(request)) return { operation: "box_open" };
  if (/^(?:please )?close (?:the )?(?:supplies|supply) box(?: please)?$/.test(request)) return { operation: "box_close" };
}

export const interpretWorldCommand: WorldCommandInterpreter = async (text, signal) => {
  const result = await generateObject({ model: spiritModel, schema: interpretation, maxRetries: 0,
    maxOutputTokens: 256, abortSignal: signal,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: THINKING_LEVELS.SPIRIT } } },
    system: `You interpret a user's request to a small house spirit. Choose exactly one supported immediate physical edit:
light_off: disconnect the apartment lighting circuit; light_on: restore power through an already repaired circuit;
box_open or box_close: change the household supplies box lid.
Choose unsupported for questions, uncertainty about a target, conditional or future instructions, multiple edits, other targets, creation, repair, moving objects, changing people or their thoughts. Do not partially execute a larger request. You choose an operation, not its success. No world history or private character data is available or needed.`,
    prompt: JSON.stringify({ operatorRequest: text }),
  });
  return result.object;
};

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("World request cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

export function createSpatialWorldControl(options: { world: World; running: () => boolean; live: boolean;
  blackout: ReturnType<typeof createBlackout>; box: number;
  interpreter?: WorldCommandInterpreter;
  changed: (operation: Choice["operation"], effect: { powerChanged: boolean }) => void;
  record: (text: string, receipt: WorldControlReceipt) => void;
}) {
  const { world, blackout, box } = options;
  const sourceId = getCommittedEvents(world).sourceId, boxKey = WorkingMemoryIdentity.id[box];
  let active: AbortController | undefined, count = 0, closed = false;
  const current = () => !closed && options.running() && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === sourceId;
  const stampBox = () => isEntityPresent(world, box) && hasComponent(world, box, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[box] === boxKey && hasComponent(world, box, PhysicalObject)
    && hasComponent(world, box, ObjectState) && hasComponent(world, box, ObjectType)
    ? JSON.stringify([boxKey, ObjectState.current[box], ObjectType.typeId[box], getDirectContainer(world, box), Position.x[box], Position.y[box]]) : undefined;
  async function command(input: string): Promise<WorldControlReceipt> {
    const text = textSchema.parse(input);
    if (!current()) throw Error("Start an active Blackout world first.");
    if (active) throw Error("The house spirit is still handling your previous request.");
    if (count >= 64) throw Error("This bounded session has reached its 64 world-request limit.");
    count++;
    const controller = new AbortController(); active = controller;
    const powerStamp = blackout.controlStamp(), boxStamp = stampBox();
    const deadline = setTimeout(() => controller.abort(new Error("World request timed out")), 15_000);
    const receipt = (status: WorldControlReceipt["status"], detail: string, operation?: Choice["operation"]): WorldControlReceipt => ({ status, detail, atSimMs: readSimulationTime(world), ...(operation ? { operation } : {}) });
    let result: WorldControlReceipt;
    try {
      const quick = directWorldCommand(text);
      const raw = quick ?? (options.live || options.interpreter
        ? await abortable(withSimulationTask(controller.signal, () => (options.interpreter ?? interpretWorldCommand)(text, controller.signal)), controller.signal)
        : { operation: "unsupported" });
      controller.signal.throwIfAborted();
      if (!current() || active !== controller) throw Error("World request expired");
      const { operation } = interpretation.parse(raw);
      const previousPower = blackout.view().power;
      if (operation === "unsupported") result = receipt("rejected", "This spirit can only switch the apartment lighting off/on or open/close the supplies box. Ask for one immediate change.", operation);
      else if (operation === "light_off" || operation === "light_on") {
        const effect = blackout.controlPower(operation === "light_on" ? "on" : "off", powerStamp ?? "");
        result = receipt(effect.status, effect.detail, operation);
      } else if (!boxStamp || stampBox() !== boxStamp) result = receipt("rejected", "The supplies box changed while the request was being interpreted. Try again.", operation);
      else {
        const state = operation === "box_open" ? "open" : "closed";
        if (!["open", "closed"].includes(ObjectState.current[box])) result = receipt("rejected", "The box is not an ordinary unlocked open/closed box now. Its current barrier remains intact.", operation);
        else if (ObjectState.current[box] === state) result = receipt("unchanged", `The supplies box is already ${state}.`, operation);
        else {
          const effect = transitionObjectState(world, box, state, { world, worldSchema }, "operator:house_spirit");
          result = receipt(effect.ok ? "applied" : "rejected", effect.ok ? `The supplies box is now ${state}.` : "The native box mechanism rejected the change.", operation);
        }
      }
      if (result.status === "applied") {
        try { options.changed(operation, { powerChanged: previousPower !== blackout.view().power }); }
        catch { result.detail += " The physical change committed, but local observation delivery failed."; }
      }
    } catch {
      result = receipt("rejected", current() ? "The spirit could not safely interpret or finish that request. No change was applied." : "The world stopped or changed before this request could apply.");
    } finally { clearTimeout(deadline); if (active === controller) active = undefined; }
    // Never append late evidence to a closed or replacement world's live log.
    if (current()) {
      try { options.record(text, result); }
      catch { result.detail += " Operator history could not be recorded; this receipt still reflects the physical outcome."; }
    }
    return result;
  }
  return { command, get busy() { return !!active; }, stop() { closed = true; active?.abort(); },
    view: () => ({ available: current() && count < 64, busy: !!active,
      summary: "House spirit · light off/on and supplies box open/close. Real ECS edits; NPC reactions remain their own. New objects and autonomous growth are not enabled." }) };
}
