import {afterEach,expect,jest,test} from "@jest/globals";
import {initializeTaskQueue,startTaskQueue,stopTaskQueue,queueTask,getTaskStatus} from "../../runtime/async-task-queue";

afterEach(()=>{stopTaskQueue();jest.useRealTimers();});

test("completed background work clears its five-minute deadline timer",async()=>{
  jest.useFakeTimers();
  initializeTaskQueue({processInterval:10,taskTimeout:300000});startTaskQueue();
  const id=queueTask("quick cognition",async()=>42);
  await jest.advanceTimersByTimeAsync(10);
  expect(getTaskStatus(id)?.status).toBe("completed");
  stopTaskQueue();expect(jest.getTimerCount()).toBe(0);
});
