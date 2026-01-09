/**
 * WorldTools - GodAI tools for world manipulation
 *
 * These tools allow GodAI to:
 * - Define new object types (prefabs)
 * - Spawn objects from prefabs
 * - Manage object states
 * - Define affordances and rules
 * - Query and describe the world
 */

import { tool } from "ai";
import { z } from "zod/v3";
import type { World } from "../ecs/world";
import {
  type EntityRegistry,
  registerEntity,
  unregisterEntity,
  lookupEntity,
} from "../ecs/tools";
import {
  worldSchema,
  ObjectManager,
  TextRenderer,
  RulesEngine,
  type ObjectTypeDefinition,
  type StateDefinition,
  type AffordanceDefinition,
  type RuleDefinition,
} from "./index";

export interface WorldToolsState {
  world: World;
  registry: EntityRegistry;
  objectManager: ObjectManager;
  textRenderer: TextRenderer;
  rulesEngine: RulesEngine;
}

/**
 * Create world manipulation tools for GodAI
 */
export function createWorldTools(state: WorldToolsState) {
  const { objectManager, textRenderer, rulesEngine, registry } = state;

  return {
    // ===== Prefab/Type Definition Tools =====

    defineObjectType: tool({
      description:
        "Define a new object type (prefab) that can be spawned in the world. Objects have states, traits, and descriptions.",
      inputSchema: z.object({
        name: z.string().describe("Unique type name (e.g., 'campfire', 'wooden_crate')"),
        description: z
          .string()
          .describe("Base description template. Use {adjective}, {material}, etc. for variation"),
        traits: z
          .array(z.string())
          .describe("Base traits (e.g., 'examinable', 'sittable', 'flammable')"),
        states: z
          .record(
            z.object({
              description: z.string(),
              traits: z.array(z.string()).optional(),
              blockedTraits: z.array(z.string()).optional(),
              emitsStimulus: z
                .object({
                  type: z.string(),
                  intensity: z.number(),
                  radius: z.number(),
                })
                .optional(),
            })
          )
          .describe("State definitions with descriptions and trait modifiers"),
        defaultState: z.string().describe("Initial state when spawned"),
        isContainer: z.boolean().optional().describe("Can contain other objects"),
        containerCapacity: z.number().optional().describe("How many items it can hold"),
        category: z.string().optional().describe("Category for organization"),
      }),
      execute: async (params) => {
        const typeDef: ObjectTypeDefinition = {
          name: params.name,
          description: params.description,
          traits: params.traits,
          states: params.states as Record<string, StateDefinition>,
          defaultState: params.defaultState,
          isContainer: params.isContainer,
          containerCapacity: params.containerCapacity,
          category: params.category,
        };

        worldSchema.defineObjectType(typeDef);
        console.log(`[WorldTool] defineObjectType: ${params.name}`);

        return {
          success: true,
          message: `Defined object type '${params.name}' with ${Object.keys(params.states).length} states`,
          type: typeDef,
        };
      },
    }),

    defineAffordance: tool({
      description:
        "Define a new action that can be performed on objects with specific traits",
      inputSchema: z.object({
        name: z.string().describe("Action name (e.g., 'chop', 'ignite', 'harvest')"),
        requires: z.array(z.string()).describe("Traits the target must have"),
        blockedBy: z.array(z.string()).optional().describe("Traits that prevent this action"),
        transitions: z
          .record(z.string())
          .optional()
          .describe("State transitions: { currentState: newState }"),
        duration: z.number().optional().describe("Action duration in ticks (0 = instant)"),
        effect: z.string().optional().describe("Custom effect handler name"),
        descriptionTemplate: z
          .string()
          .optional()
          .describe("Text shown when action is performed"),
      }),
      execute: async (params) => {
        const affordance: AffordanceDefinition = {
          name: params.name,
          requires: params.requires,
          blockedBy: params.blockedBy,
          transitions: params.transitions,
          duration: params.duration,
          effect: params.effect,
          descriptionTemplate: params.descriptionTemplate,
        };

        worldSchema.defineAffordance(affordance);
        console.log(`[WorldTool] defineAffordance: ${params.name}`);

        return {
          success: true,
          message: `Defined affordance '${params.name}' requiring traits: ${params.requires.join(", ")}`,
          affordance,
        };
      },
    }),

    defineRule: tool({
      description:
        "Define a declarative rule for emergent world behavior (fire spreading, decay, etc.)",
      inputSchema: z.object({
        name: z.string().describe("Unique rule name"),
        description: z.string().describe("What this rule does"),
        event: z.string().describe("When to trigger: 'tick', 'value_change', 'action_*'"),
        condition: z
          .object({
            has: z.array(z.string()).optional(),
            not: z.array(z.string()).optional(),
            inState: z.string().optional(),
            expression: z.string().optional(),
          })
          .optional()
          .describe("Conditions for entities to match"),
        effects: z
          .array(
            z.object({
              action: z
                .enum([
                  "add_trait",
                  "remove_trait",
                  "transition_state",
                  "modify_value",
                  "emit_event",
                  "destroy",
                  "spawn",
                ])
                .describe("Effect type"),
              target: z
                .enum(["self", "source", "nearby"])
                .optional()
                .describe("Target selection"),
              query: z
                .object({
                  radius: z.number().optional(),
                  has: z.array(z.string()).optional(),
                  not: z.array(z.string()).optional(),
                })
                .optional()
                .describe("Query for nearby targets"),
              params: z.record(z.any()).optional().describe("Effect parameters"),
            })
          )
          .describe("Effects to apply"),
        priority: z.number().optional().describe("Higher priority runs first"),
        enabled: z.boolean().optional().describe("Whether rule is active"),
      }),
      execute: async (params) => {
        const rule: RuleDefinition = {
          name: params.name,
          description: params.description,
          when: {
            event: params.event,
            condition: params.condition,
          },
          then: params.effects,
          priority: params.priority,
          enabled: params.enabled !== false,
        };

        worldSchema.defineRule(rule);
        console.log(`[WorldTool] defineRule: ${params.name}`);

        return {
          success: true,
          message: `Defined rule '${params.name}': ${params.description}`,
          rule,
        };
      },
    }),

    // ===== Object Spawning Tools =====

    spawnObject: tool({
      description: "Spawn an object from a defined type in the world",
      inputSchema: z.object({
        typeId: z.string().describe("Type to spawn (e.g., 'bed', 'chest', 'torch')"),
        name: z.string().optional().describe("Custom instance name"),
        description: z.string().optional().describe("Custom description override"),
        state: z.string().optional().describe("Initial state (defaults to type's defaultState)"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Grid position"),
        containedIn: z.string().optional().describe("Name of container/room"),
        onTopOf: z.string().optional().describe("Name of surface to place on"),
        properties: z
          .object({
            adjective: z.string().optional(),
            material: z.string().optional(),
            color: z.string().optional(),
            size: z.string().optional(),
          })
          .optional()
          .describe("Properties for description templates"),
      }),
      execute: async (params) => {
        // Resolve container/surface entity IDs
        let containedIn: number | undefined;
        let onTopOf: number | undefined;

        if (params.containedIn) {
          containedIn = lookupEntity(registry, params.containedIn);
          if (!containedIn) {
            return { success: false, message: `Container '${params.containedIn}' not found` };
          }
        }

        if (params.onTopOf) {
          onTopOf = lookupEntity(registry, params.onTopOf);
          if (!onTopOf) {
            return { success: false, message: `Surface '${params.onTopOf}' not found` };
          }
        }

        const eid = objectManager.spawn(params.typeId, {
          name: params.name,
          description: params.description,
          state: params.state,
          position: params.position,
          containedIn,
          onTopOf,
          properties: params.properties,
        });

        if (eid === null) {
          return { success: false, message: `Unknown object type: ${params.typeId}` };
        }

        // Register in entity registry
        const info = objectManager.getInfo(eid);
        if (info) {
          registerEntity(registry, info.name, eid);
        }

        console.log(`[WorldTool] spawnObject: ${info?.name || params.typeId} (eid: ${eid})`);

        return {
          success: true,
          eid,
          info,
          message: `Spawned ${info?.name || params.typeId} in state '${info?.state}'`,
        };
      },
    }),

    spawnCustomObject: tool({
      description: "Spawn a one-off custom object without a predefined type",
      inputSchema: z.object({
        name: z.string().describe("Object name"),
        description: z.string().describe("Object description"),
        traits: z.array(z.string()).describe("Active traits"),
        state: z.string().optional().describe("Initial state (defaults to 'normal')"),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        containedIn: z.string().optional().describe("Name of container/room"),
      }),
      execute: async (params) => {
        let containedIn: number | undefined;

        if (params.containedIn) {
          containedIn = lookupEntity(registry, params.containedIn);
          if (!containedIn) {
            return { success: false, message: `Container '${params.containedIn}' not found` };
          }
        }

        const eid = objectManager.spawnCustom({
          name: params.name,
          description: params.description,
          traits: params.traits,
          state: params.state,
          position: params.position,
          containedIn,
        });

        registerEntity(registry, params.name, eid);
        console.log(`[WorldTool] spawnCustomObject: ${params.name} (eid: ${eid})`);

        return {
          success: true,
          eid,
          message: `Spawned custom object '${params.name}' with traits: ${params.traits.join(", ")}`,
        };
      },
    }),

    // ===== State Management Tools =====

    transitionObjectState: tool({
      description: "Change an object's state (e.g., open a door, light a torch)",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object"),
        newState: z.string().describe("Target state"),
        triggeredBy: z.string().optional().describe("What caused this transition"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        const success = objectManager.transitionState(
          eid,
          params.newState,
          params.triggeredBy || "godai"
        );

        if (!success) {
          return {
            success: false,
            message: `Cannot transition '${params.objectName}' to state '${params.newState}'`,
          };
        }

        const info = objectManager.getInfo(eid);
        console.log(`[WorldTool] transitionObjectState: ${params.objectName} -> ${params.newState}`);

        return {
          success: true,
          message: `${params.objectName} transitioned to '${params.newState}'`,
          newDescription: info?.description,
          newTraits: info?.traits,
        };
      },
    }),

    addObjectTrait: tool({
      description: "Add a trait to an object",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object"),
        trait: z.string().describe("Trait to add"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        objectManager.addTrait(eid, params.trait);
        console.log(`[WorldTool] addObjectTrait: ${params.objectName} += ${params.trait}`);

        return {
          success: true,
          message: `Added trait '${params.trait}' to ${params.objectName}`,
        };
      },
    }),

    removeObjectTrait: tool({
      description: "Remove a trait from an object",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object"),
        trait: z.string().describe("Trait to remove"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        objectManager.removeTrait(eid, params.trait);
        console.log(`[WorldTool] removeObjectTrait: ${params.objectName} -= ${params.trait}`);

        return {
          success: true,
          message: `Removed trait '${params.trait}' from ${params.objectName}`,
        };
      },
    }),

    setObjectDescription: tool({
      description: "Set a dynamic description for an object (overrides type-based description)",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object"),
        description: z.string().describe("New description text"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        objectManager.setDescription(eid, params.description, "godai");
        console.log(`[WorldTool] setObjectDescription: ${params.objectName}`);

        return {
          success: true,
          message: `Updated description for ${params.objectName}`,
        };
      },
    }),

    // ===== Query Tools =====

    describeRoom: tool({
      description: "Generate a full MUD-style description of a room",
      inputSchema: z.object({
        roomName: z.string().describe("Name of the room to describe"),
        detailed: z.boolean().optional().describe("Include detailed descriptions"),
        includeAffordances: z.boolean().optional().describe("List available actions"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.roomName);
        if (!eid) {
          return { success: false, message: `Room '${params.roomName}' not found` };
        }

        const rendered = textRenderer.renderRoom(eid, {
          detailed: params.detailed !== false,
          includeAffordances: params.includeAffordances,
        });

        console.log(`[WorldTool] describeRoom: ${params.roomName}`);

        return {
          success: true,
          ...rendered,
        };
      },
    }),

    getObjectInfo: tool({
      description: "Get detailed information about an object",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object"),
        includeAffordances: z.boolean().optional().describe("Include available actions"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        const info = objectManager.getInfo(eid);
        const affordances = params.includeAffordances
          ? objectManager.getAvailableAffordances(eid)
          : undefined;

        console.log(`[WorldTool] getObjectInfo: ${params.objectName}`);

        return {
          success: true,
          ...info,
          affordances,
        };
      },
    }),

    getContainerContents: tool({
      description: "List all objects inside a container or room",
      inputSchema: z.object({
        containerName: z.string().describe("Name of the container or room"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.containerName);
        if (!eid) {
          return { success: false, message: `Container '${params.containerName}' not found` };
        }

        const contentEids = objectManager.getContents(eid);
        const contents = contentEids
          .map((cid) => objectManager.getInfo(cid))
          .filter((info) => info !== null);

        console.log(`[WorldTool] getContainerContents: ${params.containerName} (${contents.length} items)`);

        return {
          success: true,
          count: contents.length,
          contents,
        };
      },
    }),

    listObjectTypes: tool({
      description: "List all defined object types (prefabs)",
      inputSchema: z.object({
        category: z.string().optional().describe("Filter by category"),
      }),
      execute: async (params) => {
        let types = worldSchema.getAllObjectTypes();

        if (params.category) {
          types = types.filter((t) => t.category === params.category);
        }

        const summary = types.map((t) => ({
          name: t.name,
          category: t.category,
          traits: t.traits,
          states: Object.keys(t.states),
        }));

        console.log(`[WorldTool] listObjectTypes: ${types.length} types`);

        return {
          success: true,
          count: types.length,
          types: summary,
        };
      },
    }),

    listAffordances: tool({
      description: "List all defined affordances (actions)",
      inputSchema: z.object({}),
      execute: async () => {
        const affordances = worldSchema.getAllAffordances();

        const summary = affordances.map((a) => ({
          name: a.name,
          requires: a.requires,
          blockedBy: a.blockedBy,
        }));

        console.log(`[WorldTool] listAffordances: ${affordances.length} affordances`);

        return {
          success: true,
          count: affordances.length,
          affordances: summary,
        };
      },
    }),

    listTraits: tool({
      description: "List all known traits in the system",
      inputSchema: z.object({}),
      execute: async () => {
        const traits = worldSchema.getAllTraits();
        console.log(`[WorldTool] listTraits: ${traits.length} traits`);

        return {
          success: true,
          count: traits.length,
          traits,
        };
      },
    }),

    // ===== Action Execution Tools =====

    performAction: tool({
      description: "Have an actor perform an action on a target object",
      inputSchema: z.object({
        actorName: z.string().describe("Name of the entity performing the action"),
        action: z.string().describe("Action to perform (e.g., 'open', 'take', 'sit')"),
        targetName: z.string().describe("Name of the target object"),
      }),
      execute: async (params) => {
        const actorEid = lookupEntity(registry,params.actorName);
        if (!actorEid) {
          return { success: false, message: `Actor '${params.actorName}' not found` };
        }

        const targetEid = lookupEntity(registry,params.targetName);
        if (!targetEid) {
          return { success: false, message: `Target '${params.targetName}' not found` };
        }

        // Use current tick (would need to be passed in)
        const tick = Date.now();
        const result = rulesEngine.processAction(params.action, actorEid, targetEid, tick);

        console.log(`[WorldTool] performAction: ${params.actorName} -> ${params.action} -> ${params.targetName}`);

        return result;
      },
    }),

    // ===== Rules Engine Tools =====

    processWorldTick: tool({
      description: "Process one tick of world simulation (runs all active rules)",
      inputSchema: z.object({
        tick: z.number().describe("Current tick number"),
      }),
      execute: async (params) => {
        const events = rulesEngine.processTick(params.tick);

        console.log(`[WorldTool] processWorldTick: tick ${params.tick}, ${events.length} events`);

        return {
          success: true,
          tick: params.tick,
          eventsEmitted: events.length,
          events: events.map((e) => ({ type: e.type, entityId: e.entityId })),
        };
      },
    }),

    toggleRule: tool({
      description: "Enable or disable a rule",
      inputSchema: z.object({
        ruleName: z.string().describe("Name of the rule"),
        enabled: z.boolean().describe("Whether to enable or disable"),
      }),
      execute: async (params) => {
        const rule = worldSchema.getRule(params.ruleName);
        if (!rule) {
          return { success: false, message: `Rule '${params.ruleName}' not found` };
        }

        rule.enabled = params.enabled;
        console.log(`[WorldTool] toggleRule: ${params.ruleName} = ${params.enabled}`);

        return {
          success: true,
          message: `Rule '${params.ruleName}' ${params.enabled ? "enabled" : "disabled"}`,
        };
      },
    }),

    listRules: tool({
      description: "List all defined rules",
      inputSchema: z.object({
        activeOnly: z.boolean().optional().describe("Only show active rules"),
      }),
      execute: async (params) => {
        const rules: RuleDefinition[] = params.activeOnly
          ? worldSchema.getActiveRules()
          : Array.from((worldSchema as any).rules.values());

        const summary = rules.map((r) => ({
          name: r.name,
          description: r.description,
          event: r.when.event,
          enabled: r.enabled !== false,
          priority: r.priority || 0,
        }));

        console.log(`[WorldTool] listRules: ${rules.length} rules`);

        return {
          success: true,
          count: rules.length,
          rules: summary,
        };
      },
    }),

    // ===== Movement Tools =====

    moveObjectToContainer: tool({
      description: "Move an object into a container or room",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object to move"),
        containerName: z.string().describe("Name of the destination container/room"),
      }),
      execute: async (params) => {
        const objectEid = lookupEntity(registry,params.objectName);
        if (!objectEid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        const containerEid = lookupEntity(registry,params.containerName);
        if (!containerEid) {
          return { success: false, message: `Container '${params.containerName}' not found` };
        }

        objectManager.moveToContainer(objectEid, containerEid);
        console.log(`[WorldTool] moveObjectToContainer: ${params.objectName} -> ${params.containerName}`);

        return {
          success: true,
          message: `Moved ${params.objectName} into ${params.containerName}`,
        };
      },
    }),

    placeObjectOnSurface: tool({
      description: "Place an object on top of a surface",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object to place"),
        surfaceName: z.string().describe("Name of the surface"),
      }),
      execute: async (params) => {
        const objectEid = lookupEntity(registry,params.objectName);
        if (!objectEid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        const surfaceEid = lookupEntity(registry,params.surfaceName);
        if (!surfaceEid) {
          return { success: false, message: `Surface '${params.surfaceName}' not found` };
        }

        objectManager.placeOnSurface(objectEid, surfaceEid);
        console.log(`[WorldTool] placeObjectOnSurface: ${params.objectName} on ${params.surfaceName}`);

        return {
          success: true,
          message: `Placed ${params.objectName} on ${params.surfaceName}`,
        };
      },
    }),

    destroyObject: tool({
      description: "Remove an object from the world",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object to destroy"),
      }),
      execute: async (params) => {
        const eid = lookupEntity(registry,params.objectName);
        if (!eid) {
          return { success: false, message: `Object '${params.objectName}' not found` };
        }

        objectManager.destroy(eid);
        unregisterEntity(registry, eid);
        console.log(`[WorldTool] destroyObject: ${params.objectName}`);

        return {
          success: true,
          message: `Destroyed ${params.objectName}`,
        };
      },
    }),
  };
}

/**
 * Initialize world tools state
 */
export function initializeWorldToolsState(
  world: World,
  registry: EntityRegistry
): WorldToolsState {
  const objectManager = new ObjectManager(world);
  const textRenderer = new TextRenderer(world, objectManager);
  const rulesEngine = new RulesEngine(world, objectManager);

  return {
    world,
    registry,
    objectManager,
    textRenderer,
    rulesEngine,
  };
}
