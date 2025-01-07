import {
  World,
  observe,
  onGet,
  onSet,
  onRemove,
  setComponent,
  removeComponent,
  addComponent,
  removeEntity,
  query,
} from "bitecs";
import {
  Agent,
  Room,
  Memory,
  Appearance,
  Action,
  Perception,
  Stimulus,
  OccupiesRoom,
  StimulusInRoom,
  StimulusSource,
  RecentActions,
  Interaction,
  Goal,
  Plan,
} from "../components";
import { logger } from "../utils/logger";
import { AgentState } from "../types/state";

export class ComponentSync {
  private observers: (() => void)[] = [];
  onWorldStateChange?: () => void;

  constructor(private world: World) {
    this.setupSyncHooks();
  }

  private setupSyncHooks() {
    // Agent sync
    this.observers.push(
      observe(this.world, onSet(Agent), (eid, params) => {
        if (params.id) Agent.id[eid] = params.id;
        if (params.name) Agent.name[eid] = params.name;
        if (params.role) Agent.role[eid] = params.role;
        if (params.systemPrompt) Agent.systemPrompt[eid] = params.systemPrompt;
        if (params.active !== undefined) Agent.active[eid] = params.active;
        if (params.platform) Agent.platform[eid] = params.platform;
        if (params.appearance) Agent.appearance[eid] = params.appearance;
        if (params.attention !== undefined)
          Agent.attention[eid] = params.attention;
        this.notifyWorldStateChange();
        return params;
      }),
      observe(this.world, onGet(Agent), (eid) => ({
        id: Agent.id[eid],
        name: Agent.name[eid],
        role: Agent.role[eid],
        systemPrompt: Agent.systemPrompt[eid],
        active: Agent.active[eid],
        platform: Agent.platform[eid],
        appearance: Agent.appearance[eid],
        attention: Agent.attention[eid],
      })),
      observe(this.world, onRemove(Agent), (eid) => {
        console.log("Agent removed:", eid);

        // Clean up all component data for this entity
        delete Agent.id[eid];
        delete Agent.name[eid];
        delete Agent.role[eid];
        delete Agent.systemPrompt[eid];
        delete Agent.active[eid];
        delete Agent.platform[eid];
        delete Agent.appearance[eid];
        delete Agent.attention[eid];

        // Clean up related components
        if (Memory.thoughts[eid]) delete Memory.thoughts[eid];
        if (Memory.lastThought[eid]) delete Memory.lastThought[eid];
        if (Memory.perceptions[eid]) delete Memory.perceptions[eid];
        if (Memory.experiences[eid]) delete Memory.experiences[eid];

        if (Appearance.facialExpression[eid])
          delete Appearance.facialExpression[eid];
        if (Appearance.bodyLanguage[eid]) delete Appearance.bodyLanguage[eid];
        if (Appearance.currentAction[eid]) delete Appearance.currentAction[eid];
        if (Appearance.socialCues[eid]) delete Appearance.socialCues[eid];
        if (Appearance.lastUpdate[eid]) delete Appearance.lastUpdate[eid];

        // Remove from any rooms
        const rooms = query(this.world, [Room]);
        for (const roomId of rooms) {
          if (query(this.world, [OccupiesRoom(roomId)]).includes(eid)) {
            removeComponent(this.world, eid, OccupiesRoom(roomId));
          }
        }

        // Notify world state change after cleanup
        this.notifyWorldStateChange();
      })
    );

    // Memory sync
    this.observers.push(
      observe(this.world, onSet(Memory), (eid, params) => {
        if (params.thoughts) Memory.thoughts[eid] = params.thoughts;
        if (params.lastThought) Memory.lastThought[eid] = params.lastThought;
        if (params.lastUpdate) Memory.lastUpdate[eid] = params.lastUpdate;
        if (params.perceptions) Memory.perceptions[eid] = params.perceptions;
        if (params.experiences) Memory.experiences[eid] = params.experiences;
        return params;
      }),
      observe(this.world, onGet(Memory), (eid) => ({
        thoughts: Memory.thoughts[eid],
        lastThought: Memory.lastThought[eid],
        perceptions: Memory.perceptions[eid],
        experiences: Memory.experiences[eid],
      })),
      observe(this.world, onRemove(Memory), (eid) => {
        delete Memory.thoughts[eid];
        delete Memory.lastThought[eid];
        delete Memory.lastUpdate[eid];
        delete Memory.perceptions[eid];
        delete Memory.experiences[eid];
      })
    );

    // Appearance sync with validation
    this.observers.push(
      observe(this.world, onSet(Appearance), (eid, params) => {
        const timestamp = Date.now();
        if (params.baseDescription)
          Appearance.baseDescription[eid] = params.baseDescription;
        if (params.description)
          Appearance.description[eid] = params.description;
        if (params.facialExpression)
          Appearance.facialExpression[eid] = params.facialExpression;
        if (params.bodyLanguage)
          Appearance.bodyLanguage[eid] = params.bodyLanguage;
        if (params.currentAction)
          Appearance.currentAction[eid] = params.currentAction;
        if (params.socialCues) Appearance.socialCues[eid] = params.socialCues;
        Appearance.lastUpdate[eid] = timestamp;
        return { ...params, lastUpdate: timestamp };
      })
    );

    // Action sync with validation
    this.observers.push(
      observe(this.world, onSet(Action), (eid, params) => {
        if (params.pendingAction) {
          // Validate action against available tools
          const tools = Action.availableTools[eid] || [];
          const isValidTool = tools.some(
            (tool) => tool === params.pendingAction.tool
          );
          if (!isValidTool) {
            logger.warn(
              `Invalid tool ${params.pendingAction.tool} for entity ${eid}`
            );
            return null;
          }
          Action.pendingAction[eid] = params.pendingAction;
        }
        if (params.lastActionResult)
          Action.lastActionResult[eid] = params.lastActionResult;
        if (params.availableTools)
          Action.availableTools[eid] = params.availableTools;
        Action.lastActionTime[eid] = Date.now();
        return params;
      })
    );

    // Room sync
    this.observers.push(
      observe(this.world, onSet(Room), (eid, params) => {
        if (params.id) Room.id[eid] = String(params.id);
        if (params.name) Room.name[eid] = params.name;
        if (params.description) Room.description[eid] = params.description;
        if (params.type) Room.type[eid] = params.type;
        return params;
      }),
      observe(this.world, onGet(Room), (eid) => ({
        id: Room.id[eid] || String(eid),
        name: Room.name[eid],
        description: Room.description[eid],
        type: Room.type[eid],
      }))
    );

    // Stimulus sync with decay handling
    this.observers.push(
      observe(this.world, onSet(Stimulus), (eid, params) => {
        // Return early if no component data
        if (!params || typeof params !== "object") {
          logger.warn(
            `Invalid stimulus component data for ${eid}: ${JSON.stringify(
              params
            )}`
          );
          return null;
        }

        // When using set(), params is the actual component data
        if (params.type) Stimulus.type[eid] = params.type;
        if (params.source) Stimulus.source[eid] = params.source;
        if (params.content) Stimulus.content[eid] = params.content;
        if (params.subtype) Stimulus.subtype[eid] = params.subtype;
        if (params.intensity) Stimulus.intensity[eid] = params.intensity;
        if (params.private) Stimulus.private[eid] = params.private;
        if (params.decay) Stimulus.decay[eid] = params.decay;
        if (params.priority) Stimulus.priority[eid] = params.priority;
        if (params.metadata) Stimulus.metadata[eid] = params.metadata;

        // Set timestamp, using provided or current time
        Stimulus.timestamp[eid] = params.timestamp || Date.now();

        logger.debug(`Stimulus component updated for ${eid}:`, params);
      }),
      observe(this.world, onGet(Stimulus), (eid) => ({
        type: Stimulus.type[eid],
        source: Stimulus.source[eid],
        content: Stimulus.content[eid],
        subtype: Stimulus.subtype[eid],
        intensity: Stimulus.intensity[eid],
        private: Stimulus.private[eid],
        decay: Stimulus.decay[eid],
        priority: Stimulus.priority[eid],
        metadata: Stimulus.metadata[eid],
        timestamp: Stimulus.timestamp[eid],
      })),
      observe(this.world, onRemove(Stimulus), (eid) => {
        delete Stimulus.type[eid];
        delete Stimulus.source[eid];
        delete Stimulus.content[eid];
        delete Stimulus.timestamp[eid];
        delete Stimulus.decay[eid];
        delete Stimulus.subtype[eid];
        delete Stimulus.intensity[eid];
        delete Stimulus.private[eid];
        delete Stimulus.priority[eid];
        delete Stimulus.metadata[eid];
      })
    );

    // Room relationship sync
    this.observers.push(
      observe(this.world, onSet(OccupiesRoom), (eid, params) => {
        console.log("OccupiesRoom changed:", eid, params);
        if (params && typeof params === "object" && "roomId" in params) {
          addComponent(this.world, eid, OccupiesRoom(params.roomId));
          this.notifyWorldStateChange();
        }
        return params;
      }),
      observe(this.world, onRemove(OccupiesRoom), (eid) => {
        console.log("OccupiesRoom removed:", eid);
        // No need to explicitly remove - bitECS handles this
        this.notifyWorldStateChange();
      })
    );

    // Stimulus relationship sync
    this.observers.push(
      observe(this.world, onSet(StimulusInRoom), (eid, params) => {
        // Return early if no params or roomId
        if (!params || typeof params !== "object" || !("roomId" in params)) {
          logger.warn(
            `Invalid StimulusInRoom params for ${eid} ${JSON.stringify(params)}`
          );
          return null;
        }

        const store = StimulusInRoom(params.roomId);
        store.enteredAt[eid] = Date.now();
        if ("intensity" in params && params.intensity !== undefined) {
          store.intensity[eid] = params.intensity;
        }
        return params;
      }),
      observe(this.world, onSet(StimulusSource), (eid, params) => {
        // Return early if no params or source
        if (!params || typeof params !== "object" || !("source" in params)) {
          logger.warn(
            `Invalid StimulusSource params for ${eid} ${JSON.stringify(params)}`
          );
          return null;
        }

        const store = StimulusSource(params.source);
        store.createdAt[eid] = Date.now();
        if ("strength" in params && params.strength !== undefined) {
          store.strength[eid] = params.strength;
        }
        return params;
      })
    );

    // RecentActions sync
    this.observers.push(
      observe(this.world, onSet(RecentActions), (eid, params) => {
        if (params.actions) {
          RecentActions.actions[eid] = params.actions;
        }
        return params;
      }),
      observe(this.world, onGet(RecentActions), (eid) => ({
        actions: RecentActions.actions[eid] || [],
      })),
      observe(this.world, onRemove(RecentActions), (eid) => {
        delete RecentActions.actions[eid];
      })
    );

    // Add missing onRemove handlers for Perception
    this.observers.push(
      observe(this.world, onRemove(Perception), (eid) => {
        delete Perception.currentStimuli[eid];
        delete Perception.lastProcessedTime[eid];
        delete Perception.summary[eid];
        delete Perception.context[eid];
      })
    );

    // Add missing onRemove handlers for Stimulus
    this.observers.push(
      observe(this.world, onRemove(Stimulus), (eid) => {
        delete Stimulus.type[eid];
        delete Stimulus.source[eid];
        delete Stimulus.content[eid];
        delete Stimulus.timestamp[eid];
        delete Stimulus.decay[eid];
        delete Stimulus.subtype[eid];
        delete Stimulus.intensity[eid];
        delete Stimulus.private[eid];
        delete Stimulus.priority[eid];
        delete Stimulus.metadata[eid];
      })
    );

    // Add missing onRemove handlers for Room
    this.observers.push(
      observe(this.world, onRemove(Room), (eid) => {
        delete Room.id[eid];
        delete Room.name[eid];
        delete Room.description[eid];
        delete Room.type[eid];
      })
    );

    // Add missing onRemove handlers for Action
    this.observers.push(
      observe(this.world, onRemove(Action), (eid) => {
        delete Action.pendingAction[eid];
        delete Action.lastActionTime[eid];
        delete Action.lastActionResult[eid];
        delete Action.availableTools[eid];
      })
    );

    // Add missing onRemove handlers for Appearance
    this.observers.push(
      observe(this.world, onRemove(Appearance), (eid) => {
        delete Appearance.baseDescription[eid];
        delete Appearance.description[eid];
        delete Appearance.facialExpression[eid];
        delete Appearance.bodyLanguage[eid];
        delete Appearance.currentAction[eid];
        delete Appearance.socialCues[eid];
        delete Appearance.lastUpdate[eid];
      })
    );

    // Goal sync
    this.observers.push(
      observe(this.world, onSet(Goal), (eid, params) => {
        if (params.current !== undefined) {
          Goal.current[eid] = params.current;
        }
        if (params.completed !== undefined) {
          Goal.completed[eid] = params.completed;
        }
        Goal.lastUpdate[eid] = Date.now();
        return params;
      }),
      observe(this.world, onGet(Goal), (eid) => ({
        current: Goal.current[eid] || [],
        completed: Goal.completed[eid] || [],
        lastUpdate: Goal.lastUpdate[eid] || Date.now(),
      })),
      observe(this.world, onRemove(Goal), (eid) => {
        delete Goal.current[eid];
        delete Goal.completed[eid];
        delete Goal.lastUpdate[eid];
      })
    );

    // Plan sync
    this.observers.push(
      observe(this.world, onSet(Plan), (eid, params) => {
        if (params.plans !== undefined) {
          Plan.plans[eid] = params.plans;
        }
        Plan.lastUpdate[eid] = Date.now();
        return params;
      }),
      observe(this.world, onGet(Plan), (eid) => ({
        plans: Plan.plans[eid] || [],
        lastUpdate: Plan.lastUpdate[eid] || Date.now(),
      })),
      observe(this.world, onRemove(Plan), (eid) => {
        delete Plan.plans[eid];
        delete Plan.lastUpdate[eid];
      })
    );

    // Update Perception sync with improved structure and validation
    this.observers.push(
      observe(this.world, onSet(Perception), (eid, params) => {
        // Handle current stimuli
        if (params.currentStimuli) {
          Perception.currentStimuli[eid] = params.currentStimuli;
        }

        if (params.summary) {
          Perception.summary[eid] = params.summary;
        }

        // Update context with validation
        if (params.context !== undefined) {
          try {
            const validContext = {
              salientEntities: Array.isArray(params.context.salientEntities)
                ? params.context.salientEntities
                : [],
              roomContext: params.context.roomContext || {},
              stats: {
                totalStimuli: params.context.stats?.totalStimuli || 0,
                processedTimestamp: Date.now(),
              },
            };
            Perception.context[eid] = validContext;
          } catch (error) {
            logger.error(`Invalid context format for entity ${eid}:`, {
              error: error instanceof Error ? error.message : String(error),
              context: JSON.stringify(params.context),
            });
            Perception.context[eid] = {
              salientEntities: [],
              roomContext: {},
              stats: {
                totalStimuli: 0,
                processedTimestamp: Date.now(),
              },
            };
          }
        }

        // Always update processing timestamp
        if (params.lastProcessedTime) {
          Perception.lastProcessedTime[eid] = params.lastProcessedTime;
        }

        // Update lastUpdate timestamp
        if (params.lastUpdate) {
          Perception.lastUpdate[eid] = params.lastUpdate;
        }

        return params;
      }),
      observe(this.world, onGet(Perception), (eid) => ({
        currentStimuli: Perception.currentStimuli[eid] || [],
        context: Perception.context[eid] || {
          salientEntities: [],
          roomContext: {},
          stats: {
            totalStimuli: 0,
            processedTimestamp: 0,
          },
        },
        lastProcessedTime: Perception.lastProcessedTime[eid] || 0,
        lastUpdate: Perception.lastUpdate[eid] || 0,
      }))
    );
  }

  notifyWorldStateChange() {
    if (this.onWorldStateChange) {
      this.onWorldStateChange();
    }
  }

  cleanup() {
    // Remove all observers
    this.observers.forEach((unobserve) => unobserve());
    this.observers = [];
  }

  updateStimulus(eid: number, params: Partial<typeof Stimulus>) {
    return setComponent(this.world, eid, Stimulus, params);
  }

  setOccupiesRoom(eid: number, roomId: number) {
    return setComponent(this.world, eid, OccupiesRoom, { roomId });
  }

  setStimulusInRoom(eid: number, roomId: string, intensity?: number) {
    return setComponent(this.world, eid, StimulusInRoom, { roomId, intensity });
  }

  setStimulusSource(eid: number, source: string, strength?: number) {
    return setComponent(this.world, eid, StimulusSource, { source, strength });
  }
}
