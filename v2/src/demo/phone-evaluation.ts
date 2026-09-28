import type { PhoneReceipt, PhoneSnapshot } from "./phone-demo";

/** Measurements, not a scripted NPC policy. A reply may be declined; record that
 * as an unmet interaction target rather than manufacture compliance. */
export function evaluatePhoneRun(snapshot: PhoneSnapshot, history: PhoneReceipt[], privacyViolations?: string[]) {
    const values = (pattern: RegExp) => history.flatMap(r => {
        const match = r.text.match(pattern); return match ? [Number(match[1])] : [];
    });
    const distribution = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
        return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? null };
    };
    const incoming = snapshot.messages.find(m => m.direction === "in");
    const reply = snapshot.messages.find(m => m.direction === "out" && m.status === "delivered");
    const attention = history.find(r => r.kind === "perception" && r.text.includes("YOUR smartphone"));
    const decision = attention && history.find(r => r.kind === "thought" && r.atMs >= attention.atMs);
    const readyDelayMs = distribution(values(/Ready delay: (\d+)ms/));
    const decisionMs = distribution(values(/Shared cognition finished in (\d+)ms/));
    return {
        initialThoughtAtMs: history.find(r => r.kind === "thought")?.atMs ?? null,
        recognitionToDecisionMs: attention && decision ? decision.atMs - attention.atMs : null,
        deliveryToReadMs: incoming && incoming.readMs >= 0 ? incoming.readMs - incoming.deliveredMs : null,
        deliveryToReplyMs: incoming && reply ? reply.deliveredMs - incoming.deliveredMs : null,
        readyDelayMs, decisionMs,
        supersededDecisions: history.filter(r => r.kind === "cognition_completed" && r.text.includes("(superseded)")).length,
        actionFailures: history.filter(r => r.kind === "action_failed").map(r => ({ atMs: r.atMs, text: r.text })),
        privacyViolations,
        // Explicit acceptance targets for this small authored house, not promises
        // about arbitrary worlds or a guarantee the character chooses to reply.
        gates: {
            firstThoughtAtSourceZero: history.some(r => r.kind === "thought" && r.atMs === 0),
            readyDelayP95Under2Seconds: readyDelayMs.p95 !== null && readyDelayMs.p95 <= 2000,
            notificationDecisionUnder8Seconds: Boolean(attention && decision && decision.atMs - attention.atMs <= 8000),
            replyWithin60Seconds: Boolean(incoming && reply && reply.deliveredMs - incoming.deliveredMs <= 60000),
            unreadKnowledgePrivate: privacyViolations ? privacyViolations.length === 0 : null,
        },
    };
}
