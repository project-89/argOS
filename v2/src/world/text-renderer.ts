/**
 * TextRenderer - MUD-style text generation for world perception
 *
 * This generates descriptive text that:
 * - NPCs can perceive and reason about
 * - Users can read in a text-based interface
 * - Forms the semantic layer of the simulation
 */

import { query, hasComponent } from "bitecs";
import {
  Name,
  Description,
  GridPosition,
  ObjectType,
  ObjectState,
  Traits,
  Container,
  LightSource,
  Portal,
} from "../ecs/components";
import { ContainedIn, OnTopOf, OccupiedBy, worldSchema } from "./schema";
import { ObjectManager } from "./object-manager";

export interface RenderOptions {
  /** Include detailed descriptions vs brief */
  detailed?: boolean;
  /** Include object states */
  includeStates?: boolean;
  /** Include available affordances */
  includeAffordances?: boolean;
  /** Include exits/portals */
  includeExits?: boolean;
  /** Filter objects by traits */
  traitFilter?: string[];
  /** Maximum items to list before summarizing */
  maxItems?: number;
}

export interface RenderedRoom {
  name: string;
  description: string;
  objects: RenderedObject[];
  npcs: RenderedNPC[];
  exits: RenderedExit[];
  ambience: string;
  lighting: string;
  fullText: string;
}

export interface RenderedObject {
  eid: number;
  name: string;
  description: string;
  state: string;
  traits: string[];
  affordances: string[];
  onSurface?: string;
}

export interface RenderedNPC {
  eid: number;
  name: string;
  description: string;
  state: string;
  activity?: string;
}

export interface RenderedExit {
  eid: number;
  direction?: string;
  name: string;
  state: string;
  destination?: string;
}

const DEFAULT_OPTIONS: RenderOptions = {
  detailed: true,
  includeStates: true,
  includeAffordances: false,
  includeExits: true,
  maxItems: 10,
};

export class TextRenderer {
  private world: any;
  private objectManager: ObjectManager;

  constructor(world: any, objectManager: ObjectManager) {
    this.world = world;
    this.objectManager = objectManager;
  }

  /**
   * Render a complete room description
   */
  renderRoom(roomEid: number, options: RenderOptions = {}): RenderedRoom {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const roomName = Name.value[roomEid] || "Unknown Location";
    const roomDesc = Description.value[roomEid] || "You are in a nondescript place.";

    // Get contents of the room
    const contents = this.objectManager.getContents(roomEid);

    // Separate objects and NPCs
    const objects: RenderedObject[] = [];
    const npcs: RenderedNPC[] = [];
    const exits: RenderedExit[] = [];

    for (const eid of contents) {
      const traits = this.objectManager.getTraits(eid);

      if (traits.includes("alive") || traits.includes("talkable")) {
        // It's an NPC
        npcs.push(this.renderNPC(eid, opts));
      } else if (traits.includes("portal")) {
        // It's an exit
        exits.push(this.renderExit(eid, opts));
      } else {
        // It's an object
        objects.push(this.renderObject(eid, opts));
      }
    }

    // Determine lighting
    const lighting = this.determineLighting(roomEid, contents);

    // Determine ambience
    const ambience = this.determineAmbience(roomEid, contents);

    // Generate full text
    const fullText = this.generateFullText(
      roomName,
      roomDesc,
      objects,
      npcs,
      exits,
      lighting,
      ambience,
      opts
    );

    return {
      name: roomName,
      description: roomDesc,
      objects,
      npcs,
      exits,
      ambience,
      lighting,
      fullText,
    };
  }

  /**
   * Render a single object
   */
  renderObject(eid: number, options: RenderOptions = {}): RenderedObject {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const info = this.objectManager.getInfo(eid);

    if (!info) {
      return {
        eid,
        name: "something",
        description: "You can't quite make out what it is.",
        state: "unknown",
        traits: [],
        affordances: [],
      };
    }

    const affordances = opts.includeAffordances
      ? this.objectManager.getAvailableAffordances(eid)
      : [];

    // Check if object is on a surface
    let onSurface: string | undefined;
    const surfaceEntities = query(this.world, [OnTopOf("*")]);
    // This is a simplification - would need proper relation query

    return {
      eid,
      name: info.name,
      description: info.description,
      state: info.state,
      traits: info.traits,
      affordances,
      onSurface,
    };
  }

  /**
   * Render an NPC
   */
  renderNPC(eid: number, options: RenderOptions = {}): RenderedNPC {
    const info = this.objectManager.getInfo(eid);

    if (!info) {
      return {
        eid,
        name: "someone",
        description: "A mysterious figure.",
        state: "unknown",
      };
    }

    // Determine activity based on state
    const activity = this.describeActivity(info.state, info.traits);

    return {
      eid,
      name: info.name,
      description: info.description,
      state: info.state,
      activity,
    };
  }

  /**
   * Render an exit/portal
   */
  renderExit(eid: number, options: RenderOptions = {}): RenderedExit {
    const info = this.objectManager.getInfo(eid);

    if (!info) {
      return {
        eid,
        name: "an exit",
        state: "unknown",
      };
    }

    // Get destination if portal component exists
    let destination: string | undefined;
    if (hasComponent(this.world, eid, Portal)) {
      const destRoomEid = Portal.destinationRoom[eid];
      if (destRoomEid && hasComponent(this.world, destRoomEid, Name)) {
        destination = Name.value[destRoomEid];
      }
    }

    // Try to infer direction from name
    const direction = this.inferDirection(info.name);

    return {
      eid,
      direction,
      name: info.name,
      state: info.state,
      destination,
    };
  }

  /**
   * Render what an agent can perceive from a position
   */
  renderPerception(
    agentEid: number,
    roomEid: number,
    options: RenderOptions = {}
  ): string {
    const room = this.renderRoom(roomEid, options);

    // Filter out the perceiving agent from NPCs
    const otherNpcs = room.npcs.filter((npc) => npc.eid !== agentEid);

    const lines: string[] = [];

    lines.push(`You are in ${room.name}.`);

    if (room.lighting !== "normal") {
      lines.push(this.describeLighting(room.lighting));
    }

    lines.push(room.description);

    if (room.ambience) {
      lines.push(room.ambience);
    }

    // Describe other characters
    if (otherNpcs.length > 0) {
      lines.push("");
      lines.push(this.describeNPCs(otherNpcs));
    }

    // Describe notable objects
    const notableObjects = room.objects.filter(
      (obj) => !obj.traits.includes("scenery")
    );
    if (notableObjects.length > 0) {
      lines.push("");
      lines.push(this.describeObjects(notableObjects, options));
    }

    // Describe exits
    if (options.includeExits !== false && room.exits.length > 0) {
      lines.push("");
      lines.push(this.describeExits(room.exits));
    }

    return lines.join("\n");
  }

  /**
   * Generate a brief look description (for quick scanning)
   */
  renderBrief(roomEid: number): string {
    const room = this.renderRoom(roomEid, { detailed: false });

    const parts: string[] = [room.name];

    if (room.npcs.length > 0) {
      const npcNames = room.npcs.map((n) => n.name).join(", ");
      parts.push(`[${npcNames}]`);
    }

    if (room.exits.length > 0) {
      const exitDirs = room.exits
        .map((e) => e.direction || e.name)
        .join(", ");
      parts.push(`(${exitDirs})`);
    }

    return parts.join(" ");
  }

  /**
   * Render an inventory listing
   */
  renderInventory(containerEid: number): string {
    const contents = this.objectManager.getContents(containerEid);

    if (contents.length === 0) {
      return "You are carrying nothing.";
    }

    const lines: string[] = ["You are carrying:"];

    for (const eid of contents) {
      const info = this.objectManager.getInfo(eid);
      if (info) {
        lines.push(`  - ${info.name}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Describe an action result
   */
  describeAction(
    action: string,
    targetEid: number,
    success: boolean,
    result?: string
  ): string {
    const targetInfo = this.objectManager.getInfo(targetEid);
    const targetName = targetInfo?.name || "it";

    if (result) {
      return result;
    }

    if (!success) {
      return `You can't ${action} the ${targetName}.`;
    }

    // Default descriptions for common actions
    const affordance = worldSchema.getAffordance(action);
    if (affordance?.descriptionTemplate) {
      return affordance.descriptionTemplate
        .replace("{target.name}", targetName)
        .replace("{target.description}", targetInfo?.description || "");
    }

    return `You ${action} the ${targetName}.`;
  }

  // --- Private helpers ---

  private generateFullText(
    name: string,
    description: string,
    objects: RenderedObject[],
    npcs: RenderedNPC[],
    exits: RenderedExit[],
    lighting: string,
    ambience: string,
    options: RenderOptions
  ): string {
    const lines: string[] = [];

    // Room header
    lines.push(`=== ${name} ===`);
    lines.push("");

    // Lighting conditions
    if (lighting === "dark") {
      lines.push("It is pitch black. You cannot see anything.");
      return lines.join("\n");
    } else if (lighting === "dim") {
      lines.push("The light is dim here.");
    }

    // Room description
    lines.push(description);

    // Ambience
    if (ambience) {
      lines.push("");
      lines.push(ambience);
    }

    // NPCs
    if (npcs.length > 0) {
      lines.push("");
      lines.push(this.describeNPCs(npcs));
    }

    // Objects
    const visibleObjects = objects.filter(
      (o) => !o.traits.includes("hidden")
    );
    if (visibleObjects.length > 0) {
      lines.push("");
      lines.push(this.describeObjects(visibleObjects, options));
    }

    // Exits
    if (options.includeExits !== false && exits.length > 0) {
      lines.push("");
      lines.push(this.describeExits(exits));
    }

    return lines.join("\n");
  }

  private describeNPCs(npcs: RenderedNPC[]): string {
    if (npcs.length === 0) return "";

    if (npcs.length === 1) {
      const npc = npcs[0];
      if (npc.activity) {
        return `${npc.name} is here, ${npc.activity}.`;
      }
      return `${npc.name} is here.`;
    }

    // Multiple NPCs
    const descriptions = npcs.map((npc) => {
      if (npc.activity) {
        return `${npc.name} (${npc.activity})`;
      }
      return npc.name;
    });

    return `Present here: ${descriptions.join(", ")}.`;
  }

  private describeObjects(
    objects: RenderedObject[],
    options: RenderOptions
  ): string {
    if (objects.length === 0) return "";

    const maxItems = options.maxItems || 10;

    if (objects.length > maxItems) {
      const shown = objects.slice(0, maxItems);
      const remaining = objects.length - maxItems;
      const objList = shown.map((o) => o.name).join(", ");
      return `You see ${objList}, and ${remaining} other items.`;
    }

    if (objects.length === 1) {
      const obj = objects[0];
      if (options.detailed) {
        return `You see ${obj.name}. ${obj.description}`;
      }
      return `You see ${obj.name}.`;
    }

    // Group objects by type if many
    if (objects.length > 5) {
      const names = objects.map((o) => o.name);
      return `You see: ${names.join(", ")}.`;
    }

    // Detailed listing for few objects
    const lines: string[] = ["You see:"];
    for (const obj of objects) {
      if (options.detailed) {
        lines.push(`  - ${obj.name}: ${obj.description}`);
      } else {
        lines.push(`  - ${obj.name}`);
      }
    }
    return lines.join("\n");
  }

  private describeExits(exits: RenderedExit[]): string {
    if (exits.length === 0) return "";

    const exitDescs = exits.map((exit) => {
      if (exit.direction) {
        if (exit.state === "open") {
          return `${exit.direction} (open ${exit.name})`;
        } else if (exit.state === "locked") {
          return `${exit.direction} (locked ${exit.name})`;
        }
        return `${exit.direction} (${exit.name})`;
      }
      return exit.name;
    });

    if (exits.length === 1) {
      return `Exit: ${exitDescs[0]}.`;
    }

    return `Exits: ${exitDescs.join(", ")}.`;
  }

  private determineLighting(roomEid: number, contents: number[]): string {
    // Check room state
    if (hasComponent(this.world, roomEid, ObjectState)) {
      const roomState = ObjectState.current[roomEid];
      if (roomState === "dark") return "dark";
    }

    // Check for light sources
    let totalLight = 0;
    for (const eid of contents) {
      if (hasComponent(this.world, eid, LightSource)) {
        const intensity = LightSource.intensity[eid];
        const traits = this.objectManager.getTraits(eid);
        // Only count if the light source is "on"
        if (hasComponent(this.world, eid, ObjectState)) {
          const state = ObjectState.current[eid];
          if (state === "lit" || state === "on") {
            totalLight += intensity;
          }
        }
      }
    }

    if (totalLight === 0) return "dark";
    if (totalLight < 0.5) return "dim";
    return "normal";
  }

  private describeLighting(lighting: string): string {
    switch (lighting) {
      case "dark":
        return "It is pitch black here.";
      case "dim":
        return "The light is dim, making it hard to see clearly.";
      case "bright":
        return "Bright light illuminates everything.";
      default:
        return "";
    }
  }

  private determineAmbience(roomEid: number, contents: number[]): string {
    // Collect ambient effects from objects
    const effects: string[] = [];

    for (const eid of contents) {
      const typeId = ObjectType.typeId[eid];
      const typeDef = worldSchema.getObjectType(typeId);

      if (typeDef) {
        const state = ObjectState.current[eid];
        const stateDef = typeDef.states[state];

        if (stateDef?.emitsStimulus) {
          // Could generate ambient text based on stimulus type
          if (stateDef.emitsStimulus.type === "light") {
            effects.push("Flickering light dances on the walls.");
          }
        }
      }
    }

    return effects.join(" ");
  }

  private describeActivity(state: string, traits: string[]): string | undefined {
    switch (state) {
      case "sleeping":
        return "sleeping";
      case "busy":
        return "busy with something";
      case "idle":
        return undefined;
      case "talking":
        return "in conversation";
      case "working":
        return "working";
      default:
        return undefined;
    }
  }

  private inferDirection(name: string): string | undefined {
    const nameLower = name.toLowerCase();

    if (nameLower.includes("north")) return "north";
    if (nameLower.includes("south")) return "south";
    if (nameLower.includes("east")) return "east";
    if (nameLower.includes("west")) return "west";
    if (nameLower.includes("up") || nameLower.includes("stair")) return "up";
    if (nameLower.includes("down")) return "down";
    if (nameLower.includes("out")) return "out";
    if (nameLower.includes("in")) return "in";

    return undefined;
  }
}
