import { z } from "zod";

export const MANAGED_SYSTEM_CAPABILITIES = ["read_scalar_components", "write_unprotected_scalars", "attach_dynamic_components"] as const;
/** Environmental mechanics are not an actor/God cognition capability. A future
 * privileged reader must be admitted through a separate host-owned channel. */
export const PRIVATE_MANAGED_COMPONENTS = new Set([
  "Agent","GodAgent","Mind","Memory","Thought","Belief","Goal","WorkingMemory","Attention","Personality",
  "Perception","KnowledgeNode","Impression","Plan","Schedule","DayPlanState","ScheduledActivity","ReflectionState",
  "BehaviorPolicy","Action","CurrentAction","LastAction","LastToolResult","PendingToolJob","ToolResult",
  "AffectState","CognitiveControl","PersonalConcerns","EmotionalLife","EmotionalDynamics","NarrativeEntry",
  "ConversationTurn","SocialMemory","CoordinationMemory","GoalLifecycle","CognitiveEvent","ProcedureState","StoryScaffold",
  "MemoryDecayState","SimulationAge","LegacySystemTime","Stimulus",
  "CommunicationMemory","CoordinationReviewState","OngoingActivity","GoalWorkProgress","GoalAttempt","WorkingMemoryIdentity",
  "ExternalParticipant","ParticipantEmbodiment","AuthoredAspirations",
]);
export const PROTECTED_MANAGED_COMPONENTS = new Set([
  ...PRIVATE_MANAGED_COMPONENTS,
  "Name","Position","GridPosition","Inventory","EquipSlot","WorldClock",
]);
export const MANAGED_CAPABILITY_DESCRIPTION = `Managed systems support only ${MANAGED_SYSTEM_CAPABILITIES.join(", ")}. No event emission, relation queries, entity creation/deletion, async or model calls. Private actor cognition is not readable: ${[...PRIVATE_MANAGED_COMPONENTS].join(", ")}. Do not write actor controllers, private cognition, movement or inventory. Unsupported work requires an explicit host capability change, not fabricated implementation. A read of Room does not expose membership relations.`;

export const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value), "Reserved name");
export const scalar = z.union([z.string().max(4000), z.number().finite(), z.boolean()]);
export const fieldSchema = z.object({ type: z.enum(["number", "string", "boolean"]), default: scalar }).strict();
export const componentSchema = z.object({
  name: identifier, description: z.string().max(1000),
  fields: z.record(identifier, fieldSchema),
}).strict().refine(c => Object.keys(c.fields).length > 0 && Object.keys(c.fields).length <= 32, "1–32 fields required")
  .refine(c => Object.values(c.fields).every(f => typeof f.default === f.type), "Default must match field type");
export const entitySchema = z.object({
  id: z.number().int().nonnegative(),
  components: z.record(identifier, z.record(identifier, scalar)),
}).strict();
export const testSchema = z.object({
  name: z.string().min(1).max(150), system: identifier,
  entities: z.array(entitySchema).min(1).max(100),
  ticks: z.number().int().min(1).max(20), deltaMs: z.number().min(1).max(60000),
  expect: z.array(z.object({ entity: z.number().int().nonnegative(), component: identifier,
    field: identifier, equals: scalar }).strict()).min(1).max(100),
}).strict();
export const systemSchema = z.object({
  name: identifier, description: z.string().max(1000),
  file: z.string().regex(/^systems\/[A-Za-z][A-Za-z0-9_-]*\.ts$/),
  frequency: z.number().int().min(1).max(100000),
  reads: z.array(identifier).min(1).max(40),
  writes: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/)).min(1).max(80),
}).strict();
export const releaseSchema = z.object({
  version: z.literal(1),
  components: z.array(z.string().regex(/^components\/[A-Za-z][A-Za-z0-9_-]*\.json$/)).max(12),
  systems: z.array(systemSchema).min(1).max(6),
  tests: z.array(testSchema).min(1).max(30),
}).strict();

export type Scalar = z.infer<typeof scalar>;
export type EntitySnapshot = z.infer<typeof entitySchema>;
export type ComponentSpec = z.infer<typeof componentSchema>;
export type SystemSpec = z.infer<typeof systemSchema>;
export type AcceptanceTest = z.infer<typeof testSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type BuildRequest = {
  instruction: string;
  source: string;
  /** Set by an operator/spirit, not editable by the coding worker. */
  acceptance?: AcceptanceTest[];
  protectedConditions?: string[];
};
export type BuildStatus = "queued" | "building" | "validating" | "ready" | "active" | "rejected" | "cancelled" | "rolled_back";
export type BuildJob = {
  id: string; request: BuildRequest; status: BuildStatus; directory: string;
  baseRevision: number; createdAt: number; updatedAt: number;
  error?: string; systems?: string[]; testsPassed?: number;
  /** Host-owned bounded repair lineage; never accepted from external requests. */
  repairOfJobId?: string; repairAttempt?: number;
  /** Host-owned observation scope. Pending restore requires fresh authorization. */
  admissionScope?: string;
  /** Diagnostic identity, not portable execution authority. */
  work?: import("./build-work-identity").BuildWorkIdentity;
};

export const SYSTEM_API = `Write components/*.json and systems/*.ts, then release.json LAST.
release.json: {version:1, components:["components/Wetness.json"], systems:[{name:"RainWetness",description:"...",file:"systems/RainWetness.ts",frequency:1,reads:["Weather","Wetness"],writes:["Wetness.amount"]}],tests:[{name:"rain increases wetness",system:"RainWetness",entities:[{id:1,components:{Weather:{raining:true},Wetness:{amount:0}}}],ticks:2,deltaMs:1000,expect:[{entity:1,component:"Wetness",field:"amount",equals:2}]}]}
Component file: {name:"Wetness",description:"...",fields:{amount:{type:"number",default:0}}}.
Types are number/string/boolean. Reuse registered components. Existing fields may NOT change type or disappear.
System file: export function run(ctx: any): void { for (const id of ctx.query("Weather", "Wetness")) { if(ctx.get(id,"Weather","raining")) ctx.set(id,"Wetness","amount",Math.min(100,ctx.get(id,"Wetness","amount") + ctx.deltaMs/1000)); } }
Only top-level run() plus type/interface declarations/type-only imports. No runtime imports, globals, shell, timers, async, randomness, or I/O.
ctx.query(...componentNames) requires at least ONE component name and returns entity IDs that actually have ALL components. Entities with none of the declared read components are not visible. ctx.get(id,component,field) reads a scalar or undefined.
ctx.set(id,component,field,value) changes an EXISTING component. ctx.attach(id,component) adds a declared dynamic component with defaults if absent; it never resets existing values.
ctx.tick is a logical tick count; ctx.deltaMs is elapsed in-world milliseconds since this system last ran, not model/worker wall time. Integrate continuous rates using ctx.deltaMs/1000; do not assume one invocation is one second. Test continuous rates with equivalent fine/coarse steps. Changes commit only if the ENTIRE invocation passes validation. Declare ALL read components and written Component.field coordinates.
Do not create entities, teleport NPCs, rewrite private minds, create inventory, or bypass intentional world obstacles. Implement capabilities, not puzzle solutions.
Every system needs at least one positive test that CHANGES state and one negative/boundary test. Include existing-component fixtures and attachment tests when relevant.
Use provided operator acceptance tests unchanged. Never edit REQUEST.json. The host rechecks everything independently.
`;
