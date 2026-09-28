import { jest } from "@jest/globals";
import { initializeTaskQueue, startTaskQueue, stopTaskQueue, queueTask, getTaskStatus } from "../async-task-queue";
import { drainPendingStimuli, queueStimulus } from "../../cognition/stimulus-queue";
import { houseTravelMs } from "../../demo/phone-demo";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";

test("builders and a slow NPC cannot occupy a fast NPC's reserved cognition slot", async () => {
    jest.useFakeTimers();
    const releases: (() => void)[] = [];
    const hold = () => new Promise<void>(resolve => releases.push(resolve));
    initializeTaskQueue({ maxConcurrent: 3, foregroundMaxConcurrent: 2, processInterval: 10 });
    startTaskQueue();
    try {
        const builders = [1, 2, 3].map(i => queueTask(`builder-${i}`, hold));
        await jest.advanceTimersByTimeAsync(20);
        expect(builders.map(id => getTaskStatus(id)?.status)).toEqual(["running", "running", "running"]);
        const slow = queueTask("slow NPC", hold, { lane: "foreground" });
        const fast = queueTask("Mara", async () => "heard the phone", { lane: "foreground" });
        await jest.advanceTimersByTimeAsync(20);
        expect(getTaskStatus(slow)?.status).toBe("running");
        expect(getTaskStatus(fast)?.result).toBe("heard the phone");
        const next = queueTask("Mara next decision", async () => "continue my goal", { lane: "foreground" });
        await jest.advanceTimersByTimeAsync(20);
        expect(getTaskStatus(next)?.status).toBe("completed");
    } finally {
        releases.forEach(release => release());
        await jest.advanceTimersByTimeAsync(20);
        stopTaskQueue(); jest.useRealTimers();
    }
});

test("one actor's cognition cannot consume another actor's pending perceptions", () => {
    drainPendingStimuli();
    const world = createArgosWorld("Foreground mailboxes"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Hall" });
    const first = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
    const second = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Observe", roomId: room });
    queueStimulus(world, { targetEid: first, type: "auditory", source: "phone", content: "buzz" });
    queueStimulus(world, { targetEid: second, type: "speech", source: "visitor", content: "hello" });
    expect(drainPendingStimuli(new Set([first]), world).map(s => s.content)).toEqual(["buzz"]);
    expect(drainPendingStimuli(new Set([second]), world).map(s => s.content)).toEqual(["hello"]);
    expect(drainPendingStimuli()).toEqual([]);
});

test("a route takes the same physical time whether planned as one move or several", () => {
    const direct = houseTravelMs("Basement", "Bedroom");
    const steps = houseTravelMs("Basement", "Landing") + houseTravelMs("Landing", "Stairs") + houseTravelMs("Stairs", "Bedroom");
    expect(direct).toBe(12000);
    expect(steps).toBe(direct);
    expect(houseTravelMs("Landing", "Bedroom")).toBe(8000);
});
