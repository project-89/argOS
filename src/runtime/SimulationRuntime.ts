import { World } from "../types/bitecs";
import { logger } from "../utils/logger";
import { actions as defaultActions } from "../actions";
import { System, SystemFactory } from "../systems/System";
import { EventEmitter } from "events";
import { Agent, Memory, Action, Perception } from "../components/agent/Agent";
import chalk from "chalk";

type ActionModule = {
  schema: any;
  action: {
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  };
  execute: (world: World, eid: number, parameters: any) => Promise<void>;
};

export type SimulationEvents = {
  log: (level: string, message: string) => void;
  agentThought: (agentId: number, thought: any) => void;
  agentAction: (agentId: number, action: any) => void;
  stateUpdate: (state: any) => void;
  error: (error: Error) => void;
};

export class SimulationRuntime extends EventEmitter {
  private world: World;
  private isRunning: boolean = false;
  private updateInterval: number = 1000;
  private systems: System[] = [];
  private updateTimeout: NodeJS.Timeout | null = null;
  public actions: Record<string, ActionModule>;

  constructor(
    world: World,
    config?: {
      updateInterval?: number;
      systems?: SystemFactory[];
      actions?: Record<string, ActionModule>;
    }
  ) {
    super();
    this.world = world;
    this.updateInterval = config?.updateInterval || 1000;
    this.actions = config?.actions || defaultActions;

    // Initialize systems
    if (config?.systems) {
      this.systems = config.systems.map((system) => {
        const sys = system.create(this);
        return sys;
      });
    }

    // Override logger to emit events
    type LoggerMethod = (message: string) => void;
    type LoggerAgentMethod = (agentId: number, message: string) => void;
    type Logger = Record<string, LoggerMethod | LoggerAgentMethod>;

    const originalLogger = { ...logger } as Logger;
    Object.keys(originalLogger).forEach((level) => {
      (logger as Logger)[level] = ((...args: [string] | [number, string]) => {
        (originalLogger[level] as Function).apply(null, args);
        this.emit(
          "log",
          level,
          typeof args[0] === "number" ? args[1] : args[0]
        );
      }) as LoggerMethod | LoggerAgentMethod;
    });

    const actionList = Object.keys(this.actions)
      .map((name) => chalk.green(name))
      .join(", ");
    logger.system(`Available actions: ${actionList}`);
  }

  getAvailableTools() {
    return Object.values(this.actions).map((a) => a.action);
  }

  async executeAction(tool: string, eid: number, parameters: any) {
    const action = this.actions[tool];
    const agentName = Agent.name[eid];

    if (action) {
      logger.system(`${chalk.cyan(agentName)} executing ${chalk.green(tool)}`);
      await action.execute(this.world, eid, parameters);
      this.emit("agentAction", eid, { tool, parameters });
      logger.system(`${chalk.cyan(agentName)} completed ${chalk.green(tool)}`);
    } else {
      const error = new Error(`Unknown action: ${tool}`);
      this.emit("error", error);
      logger.error(error.message);
    }
  }

  async start() {
    this.isRunning = true;
    logger.system(chalk.bold.green("Starting simulation runtime..."));
    logger.system(`Update interval: ${chalk.yellow(this.updateInterval)}ms`);
    logger.system(`Active systems: ${this.systems.length}`);
    this.update();
  }

  stop() {
    this.isRunning = false;
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }
    logger.system(chalk.bold.red("Stopping simulation runtime..."));
  }

  private async update() {
    if (!this.isRunning) return;

    try {
      const startTime = Date.now();

      for (const system of this.systems) {
        await system(this.world);
      }

      const state = this.getState();
      this.emit("stateUpdate", state);

      // Log active agents and their states
      const activeAgents = state.agents.filter((a) => a.active);
      if (activeAgents.length > 0) {
        logger.system(
          `Active agents: ${activeAgents
            .map((a) => chalk.cyan(a.name))
            .join(", ")}`
        );
      }

      const updateTime = Date.now() - startTime;
      if (updateTime > this.updateInterval * 0.5) {
        logger.system(
          chalk.yellow(
            `Warning: Update took ${updateTime}ms (${Math.round(
              (updateTime / this.updateInterval) * 100
            )}% of interval)`
          )
        );
      }

      this.updateTimeout = setTimeout(() => this.update(), this.updateInterval);
    } catch (error) {
      this.emit("error", error);
      logger.error(`Error in simulation update: ${error}`);
      this.stop();
    }
  }

  getWorld() {
    return this.world;
  }

  getAgentById(id: number) {
    return {
      id,
      name: Agent.name[id],
      role: Agent.role[id],
      active: Agent.active[id],
    };
  }

  private getState() {
    const agents = [];
    // Get all entities with Agent component
    for (let eid = 0; eid < Agent.name.length; eid++) {
      if (Agent.name[eid] !== undefined) {
        agents.push({
          eid,
          name: Agent.name[eid],
          role: Agent.role[eid],
          appearance: Agent.appearance[eid],
          active: Agent.active[eid],
          lastThought: Memory.lastThought[eid],
          experiences: Memory.experiences[eid] || [],
          pendingAction: Action.pendingAction[eid],
          currentStimuli: Perception.currentStimuli[eid] || [],
        });
      }
    }

    return {
      isRunning: this.isRunning,
      agents,
      timestamp: Date.now(),
    };
  }
}
