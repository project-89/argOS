/**
 * Intention-BT — BT-native intention generation and execution.
 *
 * Compiles proactive intention patterns from swarm discovery into the BT.
 * Bridges CC's intention lifecycle (forming → approved → completed) with
 * BT compilation for cost-free pattern matching.
 */

import type { PersonModel, Intention } from "../ecs/types.js";
import type { BehaviorNode, ConditionOp, CompiledPlan } from "../bt/types.js";

export type IntentionType = "exploratory" | "emergent" | "explicit";
export type ExecutionMode = "conversational" | "artifact" | "prepare" | "research";

export interface IntentionPattern {
  id: string;
  conditions: ConditionOp[];
  intentionClaim: string;
  intentionType: IntentionType;
  mode: ExecutionMode;
  activations: number;
  approvalRate: number;
}

export function generateIntention(
  model: PersonModel, claim: string, type: IntentionType,
): Intention {
  const intention: Intention = {
    id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    claim, scope: type === "explicit" ? "immediate" : "short_term",
    status: type === "exploratory" ? "active" : "forming",
    plan: [], deliverables: [], createdAt: Date.now(), lastUpdated: Date.now(),
  };
  model.intentions.push(intention);
  return intention;
}

export function approveIntention(model: PersonModel, id: string): boolean {
  const i = model.intentions.find(x => x.id === id);
  if (!i) return false;
  i.status = "active"; i.lastUpdated = Date.now(); return true;
}

export function completeIntention(model: PersonModel, id: string, deliverables: string[] = []): boolean {
  const i = model.intentions.find(x => x.id === id);
  if (!i) return false;
  i.status = "completed"; i.deliverables = deliverables; i.lastUpdated = Date.now(); return true;
}

export function getBootstrapIntentionPatterns(): IntentionPattern[] {
  return [
    {
      id: "int_pat_stressed_checkin",
      conditions: [
        { type: "hypothesis_above", domain: "stress_pattern", confidence: 0.6 },
        { type: "days_since_last_contact", min: 2 },
      ],
      intentionClaim: "Check in — they've been stressed and it's been a couple days",
      intentionType: "emergent", mode: "conversational", activations: 0, approvalRate: 0,
    },
  ];
}

export function buildIntentionTree(patterns: IntentionPattern[]): BehaviorNode {
  if (patterns.length === 0) return { type: "noop" };
  return {
    type: "selector",
    children: patterns.map(p => ({
      type: "sequence" as const,
      children: [
        ...p.conditions.map(op => ({ type: "condition" as const, op })),
        { type: "strategy" as const, strategy: {
          intent: "generate_intention", approach: p.intentionClaim,
          tone: "proactive", constraints: [`type:${p.intentionType}`, `mode:${p.mode}`],
          contextKeys: [] as string[],
        }},
      ],
    })),
  };
}
