/** Slot hardening: a learned skill's small choices (who to turn to) start as
 * decisions for the character's mind; once the recorded choices are all
 * explained by one plain rule, the rule takes over and the model is no longer
 * asked. Pure functions over recorded choices; no world access. */

/** Deterministic facts about one option, recorded with each choice. */
export type DecisionFeatures = { nearest?: boolean; partner?: boolean; liked?: boolean; sameRole?: boolean };
export type PickRule = "nearest" | "partner" | "liked" | "sameRole";
/** One recorded choice among several options (the model's, not a fallback). */
export type SlotChoice = { index: number; features: DecisionFeatures[] };

/** Rules in order of preference when several explain the same choices. */
export const PICK_RULES: readonly PickRule[] = ["partner", "liked", "nearest", "sameRole"];
export const MIN_CHOICES_TO_HARDEN = 5;
export const MAX_SLOT_CHOICES = 24;

/** The one plain rule that explains every recorded choice: each time it singles
 * out exactly one option and that is the option chosen. Undefined while the
 * choice still varies or there is too little evidence. */
export function distillPickRule(choices: readonly SlotChoice[], minAgreeing = MIN_CHOICES_TO_HARDEN): PickRule | undefined {
  const real = choices.filter(c => c.features.length > 1 && Number.isInteger(c.index) && c.index >= 0 && c.index < c.features.length);
  if (real.length < minAgreeing) return undefined;
  return PICK_RULES.find(rule => real.every(choice => {
    const hits = choice.features.map((f, i) => f[rule] ? i : -1).filter(i => i >= 0);
    return hits.length === 1 && hits[0] === choice.index;
  }));
}
