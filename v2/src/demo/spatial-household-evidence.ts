/** Pure diagnostic evidence for one small household. This module never chooses
 * actions, mutates the world, or treats authored thoughts as physical evidence.
 * Private memory is operator-only input; output contains identities/receipt IDs,
 * not private thought, message, goal-description or memory text. */
import type { PublicCommittedEvent } from "../runtime/committed-events";
import type { WorkingMemoryReceipt } from "../cognition/working-memory";
import type { SpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import type { SpatialWeatherReceipt, SpatialWeatherCondition } from "./spatial-weather";

type Entity = { id: number; key: string };
export type HouseholdGoalEvidence = Entity & { createdAtSimMs: number; status: string;
  source: string; mode: string; persistence: string; reason?: string };
export type HouseholdReceiptEvidence = { event: PublicCommittedEvent; capturedAtSimMs: number;
  native: { sourceId: string; actorKey: string; targetKey?: string; targetPresent: boolean;
    targetRemoved?: boolean; targetState?: string; targetContainerKey?: string;
    sittingOn: number[]; actorRoomId: number; hunger?: number };
  memory?: { sourceId: string; actorKey: string; capturedAtSimMs: number; receipts: readonly WorkingMemoryReceipt[] } };
export type HouseholdEvidenceInput = {
  /** Omitted means the original two-portion comparison fixture. */
  profile?: "evening" | "challenge";
  sourceId: string; endAtSimMs: number;
  initial: { atSimMs: number; residents: readonly (Entity & { name: string; openingGoal: Entity;
    identityCounts: { memories: number; motivations: number; relationships: number } })[];
    objects: readonly (Entity & { scenarioId: string; roomId: number })[];
    rooms: readonly (Entity & { scenarioId: string })[]; narrator?: Entity };
  receipts: readonly HouseholdReceiptEvidence[];
  goalSamples: readonly { sourceId: string; atSimMs: number; actorKey: string; goals: readonly HouseholdGoalEvidence[] }[];
  weather: readonly { sourceId: string; capturedAtSimMs: number; receiptId: string; spirit: string;
    receipt: SpatialWeatherReceipt; native: { roomKey: string; condition: SpatialWeatherCondition; revision: number } }[];
  narratorReviews: readonly { sourceId: string; capturedAtSimMs: number; narratorId: number; narratorKey: string;
    status: SpiritPublicEventReviewStatus }[];
};

const time = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const entity = (row: Entity) => integer(row.id) && text(row.key);
const unique = <T>(rows: readonly T[], key: (row: T) => unknown) => new Set(rows.map(key)).size === rows.length;
const householdNames = ["Tess", "Ivo", "Noor", "Mara"];
const roomIds = ["household-sitting-room", "household-kitchen", "household-patio"];

/** IDs from the public and private ledgers differ. Exact native action identity,
 * actor ownership and completion time join them; prose never supplies the join. */
export function matchesHouseholdOwnActionMemory(event: PublicCommittedEvent, receipt: WorkingMemoryReceipt): boolean {
  return event.kind === "action" && event.status === "succeeded" && text(event.targetKey)
    && time(event.atSimMs) && event.completedAtSimMs === event.atSimMs
    && text(receipt.id) && receipt.kind === "action" && receipt.provenance === "own_action" && receipt.succeeded === true
    && receipt.action?.type === event.action && receipt.action.targetKey === event.targetKey
    && receipt.completedAtSimMs === event.atSimMs
    && (!receipt.executionContext || receipt.executionContext.startedAtSimMs === event.startedAtSimMs);
}

export function evaluateHouseholdEvidence(input: HouseholdEvidenceInput) {
  const { sourceId, initial } = input;
  const propIds = [...(input.profile === "challenge" ? [] : ["household-apple-pastry"]), "household-pear-pastry", "household-patio-chair"];
  const inRun = (at: unknown): at is number => time(at) && time(initial.atSimMs) && time(input.endAtSimMs)
    && at >= initial.atSimMs && at <= input.endAtSimMs;
  const resident = (key: string, id?: number) => initial.residents.find(row => row.key === key && (id === undefined || row.id === id));
  const fixture = (input.profile === undefined || input.profile === "evening" || input.profile === "challenge")
    && (input.profile !== "challenge" || !initial.objects.some(o => o.scenarioId === "household-apple-pastry"))
    && text(sourceId) && inRun(initial.atSimMs)
    && initial.residents.length === 4 && unique(initial.residents, r => r.id) && unique(initial.residents, r => r.key)
    && householdNames.every(name => initial.residents.filter(r => r.name === name).length === 1)
    && initial.residents.every(r => entity(r) && entity(r.openingGoal)
      && Object.values(r.identityCounts).every(integer))
    && unique(initial.residents, r => r.openingGoal.key)
    && initial.rooms.length === 3 && unique(initial.rooms, r => r.id) && unique(initial.rooms, r => r.key)
    && initial.rooms.every(entity) && roomIds.every(id => initial.rooms.some(r => r.scenarioId === id))
    && propIds.every(id => initial.objects.filter(o => o.scenarioId === id).length === 1)
    && unique(initial.objects, r => r.id) && unique(initial.objects, r => r.key)
    && initial.objects.every(o => entity(o) && initial.rooms.some(r => r.id === o.roomId));

  const ownedReceipt = (row: HouseholdReceiptEvidence) => inRun(row.event.atSimMs) && inRun(row.capturedAtSimMs)
    && row.capturedAtSimMs >= row.event.atSimMs && row.event.sourceId === sourceId
    && row.native.sourceId === sourceId && row.native.actorKey === row.event.actorKey
    && !!resident(row.event.actorKey, row.event.actorId) && text(row.event.id) && text(row.event.executionId)
    && integer(row.event.sequence) && row.event.sequence > 0 && text(row.event.roomKey)
    && initial.rooms.some(room => room.id === row.event.roomId && room.key === row.event.roomKey)
    && row.native.actorRoomId === row.event.roomId;
  const owned = fixture ? input.receipts.filter(ownedReceipt) : [];
  const completions = owned.filter(row => {
    const e = row.event;
    return e.kind === "action" && e.status === "succeeded" && text(e.targetKey)
      && time(e.startedAtSimMs) && e.startedAtSimMs >= initial.atSimMs && e.startedAtSimMs <= e.atSimMs
      && e.completedAtSimMs === e.atSimMs && owned.some(start => start.event.kind === "action"
        && start.event.status === "pending" && start.event.executionId === e.executionId
        && start.event.actorId === e.actorId && start.event.actorKey === e.actorKey && start.event.action === e.action
        && start.event.targetKey === e.targetKey && start.event.operation === e.operation
        && start.event.startedAtSimMs === e.startedAtSimMs && start.event.atSimMs >= e.startedAtSimMs!
        && start.event.atSimMs <= e.atSimMs && start.event.sequence < e.sequence && start.event.completedAtSimMs === undefined);
  });
  const memoryFor = (row: HouseholdReceiptEvidence) => {
    const memory = row.memory;
    if (!memory || memory.sourceId !== sourceId || memory.actorKey !== row.event.actorKey
      || !inRun(memory.capturedAtSimMs) || memory.capturedAtSimMs < row.event.atSimMs) return [];
    return memory.receipts.filter(receipt => matchesHouseholdOwnActionMemory(row.event, receipt));
  };
  const meals = completions.filter(row => {
    const e = row.event, target = initial.objects.find(o => o.key === e.targetKey
      && ["household-apple-pastry", "household-pear-pastry"].includes(o.scenarioId));
    // SpatialDemo's admitted public interval may omit the optional operation.
    // The actual removal plus decreased native hunger, not narrated prose,
    // establish eating. A contradictory explicit operation still fails.
    return target && (e.operation === undefined || e.operation === "eating") && ["interact", "use", "eat"].includes(e.action)
      && (e.targetId === undefined || e.targetId === target.id)
      && !row.native.targetPresent && row.native.targetRemoved === true && row.native.targetKey === target.key
      && time(row.native.hunger) && row.native.hunger <= 100 && owned.some(start =>
        start.event.executionId === e.executionId && start.event.status === "pending"
        && start.event.actorKey === e.actorKey && start.event.targetId === target.id && start.event.targetKey === target.key
        && start.native.targetPresent && start.native.targetKey === target.key && time(start.native.hunger)
        && start.native.hunger <= 100 && row.native.hunger! < start.native.hunger);
  });
  const seating = completions.filter(row => {
    const target = initial.objects.find(o => o.scenarioId === "household-patio-chair" && o.key === row.event.targetKey);
    return target && ["interact", "use", "sit"].includes(row.event.action) && row.event.targetId === target.id
      && row.native.targetPresent && row.native.targetKey === target.key && row.native.targetState === "occupied"
      && row.native.sittingOn.includes(target.id) && row.native.actorRoomId === target.roomId;
  });
  // Changing rooms is a physical outcome, unlike an inspect/wait/speak receipt.
  const arrivals = completions.filter(row => row.event.action === "move" && initial.rooms.some(room =>
    room.key === row.event.targetKey && room.id === row.native.actorRoomId)
    && owned.some(start => start.event.status === "pending" && start.event.executionId === row.event.executionId
      && start.event.actorKey === row.event.actorKey && start.native.actorRoomId !== row.native.actorRoomId));
  // Additional challenge opportunities do not change the original comparison
  // gates. Require same-instant native snapshots on both sides of the exact
  // admitted interval, plus a typed own receipt; a claim of success is not an
  // object transition. Missing custody must never mean "not carried".
  const knownContainer = (key: unknown) => text(key)
    && [...initial.rooms, ...initial.objects, ...initial.residents].some(item => item.key === key);
  const challengeStartsFor = (row: HouseholdReceiptEvidence) => {
    const e = row.event;
    if (input.profile !== "challenge" || row.capturedAtSimMs !== e.atSimMs
      || !row.native.targetPresent || row.native.targetRemoved === true || row.native.targetKey !== e.targetKey
      || !knownContainer(row.native.targetContainerKey)) return [];
    return owned.filter(start => start.event.kind === "action" && start.event.status === "pending"
      && start.event.executionId === e.executionId && start.event.actorId === e.actorId && start.event.actorKey === e.actorKey
      && start.event.action === e.action && start.event.targetId === e.targetId && start.event.targetKey === e.targetKey
      && start.event.operation === e.operation && start.event.startedAtSimMs === e.startedAtSimMs
      && start.event.atSimMs >= e.startedAtSimMs! && start.event.atSimMs <= e.atSimMs
      && start.event.sequence < e.sequence && start.event.completedAtSimMs === undefined
      && start.capturedAtSimMs === start.event.atSimMs && start.native.targetPresent && start.native.targetRemoved !== true
      && start.native.targetKey === e.targetKey && knownContainer(start.native.targetContainerKey));
  };
  const hasOwnVerb = (row: HouseholdReceiptEvidence, verb: string) => memoryFor(row).some(receipt => {
    // Match the executor's command verb, never summary/facts or a quoted claim.
    const raw = ["interact", "use"].includes(receipt.action!.type)
      ? receipt.action!.content?.trim().split(/\s+/)[0].toLowerCase() : receipt.action!.type;
    return (raw === "take" ? "pickup" : raw) === verb;
  });
  const boxTransitions = completions.filter(row => {
    const target = initial.objects.find(o => o.scenarioId === "household-empty-box" && o.key === row.event.targetKey);
    const verb = row.native.targetState === "open" ? "open" : row.native.targetState === "closed" ? "close" : undefined;
    return target && row.event.targetId === target.id && verb && hasOwnVerb(row, verb)
      && (row.event.operation === undefined || row.event.operation === (verb === "open" ? "opening" : "closing"))
      && challengeStartsFor(row).some(start => start.native.targetState === (verb === "open" ? "closed" : "open")
        && start.native.targetContainerKey === row.native.targetContainerKey);
  });
  const phonePickups = completions.filter(row => {
    const target = initial.objects.find(o => householdNames.some(name => o.scenarioId === `${name.toLowerCase()}-phone`)
      && o.key === row.event.targetKey);
    return target && row.event.targetId === target.id && hasOwnVerb(row, "pickup")
      && (row.event.operation === undefined || row.event.operation === "picking_up")
      && row.native.targetContainerKey === row.event.actorKey
      && challengeStartsFor(row).some(start => start.native.targetContainerKey !== row.event.actorKey);
  });
  const physical = [...new Map([...meals, ...seating, ...arrivals, ...boxTransitions, ...phonePickups].map(row => [row.event.id, row])).values()];
  const memorized = physical.filter(row => memoryFor(row).length > 0);
  const activeActors = [...new Set(physical.map(row => row.event.actorKey))];

  const samples = fixture ? input.goalSamples.filter(sample => sample.sourceId === sourceId && inRun(sample.atSimMs)
    && resident(sample.actorKey)) : [];
  const newGoals = samples.flatMap(sample => sample.goals.filter(goal => entity(goal) && inRun(goal.createdAtSimMs)
    && goal.createdAtSimMs > initial.atSimMs && goal.createdAtSimMs <= sample.atSimMs
    && ["foreground", "autonomous", "personal"].includes(goal.source)
    && ["verified", "social", "exploratory"].includes(goal.mode) && goal.persistence === "episodic"
    && goal.status === "active" && !initial.residents.some(r => r.openingGoal.key === goal.key))
    .map(goal => ({ actorKey: sample.actorKey, atSimMs: sample.atSimMs, goal })));
  const enacted = newGoals.flatMap(row => memorized.filter(receipt => receipt.event.actorKey === row.actorKey
    && receipt.event.startedAtSimMs! >= row.goal.createdAtSimMs && receipt.event.atSimMs >= row.atSimMs
    && memoryFor(receipt).some(memory => memory.executionContext?.intention?.key === row.goal.key
      && memory.executionContext.startedAtSimMs === receipt.event.startedAtSimMs))
    .map(receipt => ({ actorKey: row.actorKey, goalKey: row.goal.key, eventId: receipt.event.id })));

  const patio = initial.rooms.find(r => r.scenarioId === "household-patio");
  const weather = fixture && patio ? input.weather.filter(row => row.sourceId === sourceId && row.spirit === "The Narrator"
    && inRun(row.receipt.atSimMs) && inRun(row.capturedAtSimMs) && row.capturedAtSimMs >= row.receipt.atSimMs
    && row.receipt.status === "applied" && row.receipt.roomId === patio.id && row.native.roomKey === patio.key
    && ["clear", "cloudy", "rain"].includes(row.receipt.condition) && row.native.condition === row.receipt.condition
    && integer(row.receipt.revision) && row.receipt.revision > 0 && row.native.revision === row.receipt.revision
    && row.receiptId === `weather:${patio.id}:${row.receipt.revision}`) : [];
  const narrator = initial.narrator;
  const acceptedReviews = narrator && entity(narrator) ? input.narratorReviews.filter(row => {
    const s = row.status;
    return row.sourceId === sourceId && row.narratorId === narrator.id && row.narratorKey === narrator.key
      && s.sourceId === sourceId && !s.sourceStopped && s.accepted && inRun(s.atSimMs)
      && inRun(row.capturedAtSimMs) && row.capturedAtSimMs >= s.atSimMs
      && [s.observedThroughSequence, s.acknowledgedThroughSequence, s.observedEnvironmentThroughSequence,
        s.acknowledgedEnvironmentThroughSequence].every(integer)
      && s.acknowledgedThroughSequence >= s.observedThroughSequence
      && s.acknowledgedEnvironmentThroughSequence >= s.observedEnvironmentThroughSequence;
  }) : [];
  const weatherObserved = weather.filter(change => acceptedReviews.some(row => row.status.atSimMs > change.receipt.atSimMs
    && row.status.observedEnvironmentThroughSequence > 0 && row.status.receiptIdsObserved.includes(change.receiptId)));
  const actionObserved = physical.filter(receipt => acceptedReviews.some(row => row.status.atSimMs > receipt.event.atSimMs
    && row.status.observedThroughSequence >= receipt.event.sequence && row.status.receiptIdsObserved.includes(receipt.event.id)));

  const gates = {
    seed: { exactFourResidentFixture: fixture,
      authoredMemoriesAndMotivations: fixture && initial.residents.every(r => r.identityCounts.memories > 0 && r.identityCounts.motivations > 0) },
    mechanical: { nativeMeal: meals.length > 0, nativeSeating: seating.length > 0, nativeRoomChange: arrivals.length > 0,
      ownActionMemory: memorized.length > 0 },
    behavioral: { multipleResidentsPhysicallyActed: activeActors.length >= 2,
      newPersonalIntentionCreated: newGoals.length > 0, newPersonalIntentionEnacted: enacted.length > 0,
      narratorChangedNativeWeather: weather.length > 0, narratorObservedExactWeatherReceipt: weatherObserved.length > 0,
      narratorObservedExactResidentOutcome: actionObserved.length > 0 },
  };
  return {
    gates, boundedHouseholdChainObserved: gates.seed.exactFourResidentFixture && gates.seed.authoredMemoriesAndMotivations
      && (gates.mechanical.nativeMeal || gates.mechanical.nativeSeating) && gates.mechanical.ownActionMemory
      && gates.behavioral.multipleResidentsPhysicallyActed && gates.behavioral.newPersonalIntentionEnacted
      && gates.behavioral.narratorChangedNativeWeather && gates.behavioral.narratorObservedExactWeatherReceipt,
    actorKeysWithPhysicalOutcomes: activeActors, mealEventIds: meals.map(r => r.event.id), seatingEventIds: seating.map(r => r.event.id),
    arrivalEventIds: arrivals.map(r => r.event.id), ownMemoryEventIds: memorized.map(r => r.event.id),
    boxTransitionEventIds: boxTransitions.map(r => r.event.id), phonePickupEventIds: phonePickups.map(r => r.event.id),
    newIntentionKeys: [...new Set(newGoals.map(r => r.goal.key))], enactedIntentions: [...new Map(enacted.map(r => [`${r.goalKey}:${r.eventId}`, r])).values()],
    weatherReceiptIds: weather.map(r => r.receiptId), observedWeatherReceiptIds: weatherObserved.map(r => r.receiptId),
    observedResidentEventIds: actionObserved.map(r => r.event.id),
    failedEvidence: { actionIds: input.receipts.filter(r => r.event.status === "failed").map(r => r.event.id),
      weatherIds: input.weather.filter(r => r.receipt.status === "rejected").map(r => r.receiptId),
      reviewTimes: input.narratorReviews.filter(r => !r.status.accepted || r.status.sourceStopped).map(r => r.status.atSimMs) },
    learning: "NOT_PROVEN", motivesAndNarrativeQuality: "REQUIRES_PRIVATE_OPERATOR_REVIEW",
    weatherCausedBehavior: "NOT_PROVEN", optionalGrowth: "SEPARATE_PROPOSAL_APPROVAL_BUILD_USE_FEEDBACK_GATE",
    baselineAndEndurance: "OPEN",
    scope: "One bounded observation of existing systems. Seed richness, physical effects, memory and enacted intentions are separate evidence; no overall realism or learning claim.",
  };
}
