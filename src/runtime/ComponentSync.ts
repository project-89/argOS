import { World, observe, onGet, onSet, setComponent } from "bitecs";
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
} from "../components/agent/Agent";

export class ComponentSync {
  private observers: (() => void)[] = [];

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
      }))
    );

    // Memory sync
    this.observers.push(
      observe(this.world, onSet(Memory), (eid, params) => {
        if (params.thoughts) Memory.thoughts[eid] = params.thoughts;
        if (params.lastThought) Memory.lastThought[eid] = params.lastThought;
        if (params.perceptions) Memory.perceptions[eid] = params.perceptions;
        if (params.experiences) Memory.experiences[eid] = params.experiences;
        return params;
      }),
      observe(this.world, onGet(Memory), (eid) => ({
        thoughts: Memory.thoughts[eid],
        lastThought: Memory.lastThought[eid],
        perceptions: Memory.perceptions[eid],
        experiences: Memory.experiences[eid],
      }))
    );

    // Appearance sync with validation
    this.observers.push(
      observe(this.world, onSet(Appearance), (eid, params) => {
        const timestamp = Date.now();
        if (params.baseDescription)
          Appearance.baseDescription[eid] = params.baseDescription;
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
            (t) => t.name === params.pendingAction.tool
          );
          if (!isValidTool) {
            console.warn(
              `Invalid tool ${params.pendingAction.tool} for entity ${eid}`
            );
            return null;
          }
          Action.pendingAction[eid] = params.pendingAction;
        }
        if (params.availableTools)
          Action.availableTools[eid] = params.availableTools;
        Action.lastActionTime[eid] = Date.now();
        return params;
      })
    );

    // Perception sync with processing timestamp
    this.observers.push(
      observe(this.world, onSet(Perception), (eid, params) => {
        if (params.currentStimuli) {
          Perception.currentStimuli[eid] = params.currentStimuli;
          Perception.lastProcessedTime[eid] = Date.now();
        }
        return params;
      })
    );

    // Room sync
    this.observers.push(
      observe(this.world, onSet(Room), (eid, params) => {
        if (params.id) Room.id[eid] = params.id;
        if (params.name) Room.name[eid] = params.name;
        if (params.description) Room.description[eid] = params.description;
        if (params.type) Room.type[eid] = params.type;
        return params;
      }),
      observe(this.world, onGet(Room), (eid) => ({
        id: Room.id[eid],
        name: Room.name[eid],
        description: Room.description[eid],
        type: Room.type[eid],
      }))
    );

    // Stimulus sync with decay handling
    this.observers.push(
      observe(this.world, onSet(Stimulus), (eid, params) => {
        if (params.type) Stimulus.type[eid] = params.type;
        if (params.sourceEntity)
          Stimulus.sourceEntity[eid] = params.sourceEntity;
        if (params.source) Stimulus.source[eid] = params.source;
        if (params.content) Stimulus.content[eid] = params.content;
        if (params.decay !== undefined) Stimulus.decay[eid] = params.decay;
        if (params.roomId) Stimulus.roomId[eid] = params.roomId;

        // Always set timestamp on updates
        Stimulus.timestamp[eid] = Date.now();
        return { ...params, timestamp: Stimulus.timestamp[eid] };
      })
    );

    // Relationship sync handlers
    this.observers.push(
      observe(this.world, onSet(OccupiesRoom), (eid, params) => {
        console.log("OccupiesRoom", eid, params);
        return params;
      }),
      observe(this.world, onSet(StimulusInRoom), (eid, params) => {
        console.log("StimulusInRoom", eid, params);
        const store = StimulusInRoom(params.roomId);
        store.enteredAt[eid] = Date.now();
        if (params.intensity !== undefined)
          store.intensity[eid] = params.intensity;
        return params;
      }),
      observe(this.world, onSet(StimulusSource), (eid, params) => {
        console.log("StimulusSource", eid, params);
        const store = StimulusSource(params.source);
        store.createdAt[eid] = Date.now();
        if (params.strength !== undefined)
          store.strength[eid] = params.strength;
        return params;
      })
    );
  }

  cleanup() {
    // Remove all observers
    this.observers.forEach((unobserve) => unobserve());
    this.observers = [];
  }

  // Helper methods for common sync patterns
  updateAgent(eid: number, params: Partial<typeof Agent>) {
    return setComponent(this.world, eid, Agent, params);
  }

  updateMemory(eid: number, params: Partial<typeof Memory>) {
    return setComponent(this.world, eid, Memory, params);
  }

  updateAppearance(eid: number, params: Partial<typeof Appearance>) {
    return setComponent(this.world, eid, Appearance, params);
  }

  updateAction(eid: number, params: Partial<typeof Action>) {
    return setComponent(this.world, eid, Action, params);
  }

  updatePerception(eid: number, params: Partial<typeof Perception>) {
    return setComponent(this.world, eid, Perception, params);
  }

  // Additional helper methods
  updateRoom(eid: number, params: Partial<typeof Room>) {
    return setComponent(this.world, eid, Room, params);
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
