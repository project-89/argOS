import { addComponent, addEntity, Relation, World } from "bitecs";
import { ComponentMap, EntityMap, RelationMap } from "./types";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool, CoreMessage, CoreToolMessage } from "ai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { relationMap, relationSchemas } from "./relationships";
import { createLSEWorld } from "./world";
import { Description, Goal, Name, Position } from "./components";
import chalk from "chalk";
import * as dotenv from "dotenv";

dotenv.config();

const MAX_MESSAGES = 100;

export type GodState = {
  world: World;
  componentMap: ComponentMap;
  generatedComponents: ComponentMap;
  entityMap: EntityMap;
  relationMap: RelationMap;
  messages: CoreMessage[];
  tools: ReturnType<typeof createGodTools>;
  ai: ReturnType<typeof createGoogleGenerativeAI>;
  mode: "world-building" | "interaction";
  systems: {
    [systemName: string]: {
      description: string;
      components: string[];
    };
  };
};

export function createGod(initialWorld?: World): GodState {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set"
    );
  }

  const godState = {
    world: initialWorld || createLSEWorld(),
    componentMap: { Position, Name, Description, Goal },
    entityMap: {},
    relationMap: relationMap,
    messages: [],
    generatedComponents: {},
    ai: createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    }),
    mode: initialWorld ? ("interaction" as const) : ("world-building" as const),
    tools: {} as ReturnType<typeof createGodTools>,
    systems: {},
  } as GodState;

  godState.tools = createGodTools(godState);
  godState.messages.push({
    role: "system",
    content: getSystemPrompt(godState),
  });

  console.log("godState", godState);

  return godState;
}

export type ProcessInputOptions = {
  maxToolRoundtrips?: number;
  toolChoice?: "auto" | "required" | "none";
};

export async function processInput(
  god: GodState,
  input: string,
  options: {
    maxToolRoundtrips?: number;
    toolChoice?: "none" | "auto" | "required";
  } = {}
): Promise<string> {
  console.log(chalk.cyan("Processing input:", input));

  god.messages.push({ role: "user", content: input });

  const tools = createGodTools(god);
  console.log("GOD COMPONENT MAP", god.componentMap);
  console.log("godState", god);

  const result = await generateText({
    model: god.ai("gemini-pro", {
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
      ],
    }),
    messages: [
      ...god.messages,
      {
        role: "system",
        content: getSystemPrompt(god),
      },
    ],
    tools,
    maxSteps: options.maxToolRoundtrips || 10,
    toolChoice: options.toolChoice || "auto",
  });

  if (result.text) {
    console.log(chalk.green("AI Response:", result.text));
    god.messages.push({ role: "assistant", content: result.text });
  }

  if (result.toolResults && result.toolResults.length > 0) {
    console.log(chalk.yellow("Tool Results:"));
    for (const toolResult of result.toolResults) {
      console.log(
        chalk.cyan("Tool Result:", JSON.stringify(toolResult, null, 2))
      );
    }

    const toolMessage: CoreToolMessage = {
      role: "tool",
      content: result.toolResults,
    };
    god.messages.push(toolMessage);
  }

  // Trim message history if it exceeds the limit
  if (god.messages.length > MAX_MESSAGES) {
    god.messages = [
      god.messages[0], // Keep the system message
      ...god.messages.slice(-MAX_MESSAGES + 1), // Keep the most recent messages
    ];
  }

  return result.text || "I couldn't process your input. Please try again.";
}

export function getSystemPrompt(god: GodState): string {
  const currentEntities = Object.entries(god.entityMap)
    .map(([name, id]) => `${name} (ID: ${id})`)
    .join(", ");

  const relations = Object.keys(god.relationMap).map((key) => ({
    name: key,
    schema: zodToJsonSchema(relationSchemas[key], key),
  }));

  console.log("GOD COMPONENT MAP", god.componentMap);

  const existingSystems = Object.entries(god.systems)
    .map(
      ([name, info]) =>
        `${name}: ${info.description} (Components: ${info.components.join(
          ", "
        )})`
    )
    .join("\n");

  return `
    You are an AI assistant tasked with building, interacting with, and maintaining a simulation based on a given prompt. Use the provided tools to fulfill the user's requests.
        Take the user's input and call the appropriate functions to complete their request.
        Relations are not components. Relations are the predicates of the prompt sentences.
        Make sure to always pair an entity with a relation, and never confuse a relation with a component.

        ## Rules
        - Do not include component names that are not mentioned in the input prompt.
        - componentNames and relationNames are ALWAYS arrays of strings.
        Entity names are strings.
        - Entity IDs are integers.
        - Regulalry narrate your decisions and explain your reasons.
        - You must ALWAYS add a component or relation before setting a value for it.
        - ONLY USE ONE TOOL AT A TIME. NEVER USE MULTIPLE TOOLS AT ONCE. NEVER USE PARALLEL FUNCTION CALLING.
        - ALL NAMES SHOUDL ALWAYS BE GENERATED IN CAMEL CASE.
        - BE SURE TO ADD COMPONENTS TO ENTITIES AFTER YOU MAKE THOSE ENTITIES.
        - BE SURE TO THINK IN SYSTEMS.  THINK ABOUT WHAT YOU WANT TO ACHIEVE, AND THEN HOW TO ACHIEVE IT.
        - SYSTEMS ARE THE MOST IMPORTANT THING IN THE SIMULATION.  THEY ARE THE THINGS THAT MAKE THE SIMULATION WORK.
        - ALWAYS MAKE SYSTEMS THAT USE THE COMPONENTS YOU HAVE GENERATED.

        - ORDER OF OPERATIONS FOR CREATING AND MODIFYING THE SIMULATION, NARRATING YOUR THOUGHTS AS YOU GO
          - IF YOU NEED A COMPONENT, GENERATE IT
          - GENERATE THE SYSTEM YOU NEED
          - CREATE ENTITIES WITH THE COMPONENTS YOU NEED
          - ADD RELATIONS TO THOSE ENTITIES
          - ADD SYSTEMS TO THE WORLD THAT USE COMPONENTS YOU HAVE MADE, OR MAKE NEW COMPONENTS TO MAKE A SYSTEM YOU NEED.

        -INSTRUCTIONS TO CREATE ENTITY
          - EXECUTE THIS LOOP UNTIL DONE WITH THAT ENTITY
              - ADD COMPONENTS
              - SET COMPONENT VALUES
          - ADD RELATIONS TO ANY PREVIOUS ENTITIES
          - ADD SYSTEMS TO THE WORLD THAT USE COMPONENTS YOU HAVE MADE, OR MAKE NEW COMPONENTS TO MAKE A SYSTEM YOU NEED.
          - MOVE ONTO THE NEXT ENTITY

        Here are all of the components available:
        \`\`\`
        ${JSON.stringify(god.componentMap)}
        \`\`\`

        Here are all of the generated components available:
        \`\`\`
        ${JSON.stringify(god.generatedComponents)}
        \`\`\`

        Here are all of the relations available:
        \`\`\`
        ${JSON.stringify(relations)}
        \`\`\`

        Current entities in the world:
        ${currentEntities}

        Existing systems in the simulation:
        ${existingSystems}
  `;
}

function createGodTools(god: GodState) {
  console.log("Components", Object.keys(god.componentMap));
  console.log("Relations", Object.keys(god.relationMap));

  return {
    ecsAddEntity: tool({
      description: "Adds a new entity to the world.",
      parameters: z.object({
        name: z
          .string()
          .describe("The name of the entity to add to the world."),
      }),
      execute: async ({ name }) => {
        const result = await ecsAddEntity(god.world, god.entityMap)({ name });
        console.log(
          chalk.green(`✅ Entity added: ${name} (ID: ${result.result})`)
        );
        return result;
      },
    }),
    ecsAddComponents: tool({
      description: "Adds components to an entity.",
      parameters: z.object({
        entityName: z
          .string()
          .describe("The name of the entity to add components to."),
        components: z
          .array(
            z
              .string()
              .describe(
                "The name of the component to add to the entity, taken from the main prompt"
              )
          )
          .describe("The array of component names to add to the entity."),
      }),
      execute: async ({ entityName, components }) => {
        const result = await ecsAddComponents(god)({
          entityName,
          components: components,
        });
        console.log(chalk.blue(`🔧 Components added to: ${entityName}`));
        console.log(chalk.gray(`   Components: ${components.join(", ")}`));
        return result;
      },
    }),
    ecsAddRelations: tool({
      description: "Adds relations between entities.",
      parameters: z.object({
        relationName: z
          .enum(Object.keys(god.relationMap) as [string, ...string[]])
          .describe("The name of the relation to add."),
        fromEntityName: z
          .string()
          .describe("The name of the entity to add the relation from."),
        toEntityName: z
          .string()
          .describe("The name of the entity to add the relation to."),
      }),
      execute: async ({ relationName, fromEntityName, toEntityName }) => {
        const result = await ecsAddRelations(
          god.world,
          god.relationMap,
          god.entityMap
        )({ relationName, fromEntityName, toEntityName });

        console.log(chalk.magenta(`🔗 Relation added: ${relationName}`));
        console.log(
          chalk.gray(`   From: ${fromEntityName} To: ${toEntityName}`)
        );
        return result;
      },
    }),
    ecsNarrate: tool({
      description:
        "Outputs the AI's reasoning and thought process for its actions.",
      parameters: z.object({
        narration: z
          .string()
          .describe("The AI's narration of its thought process and actions."),
      }),
      execute: async ({ narration }) => {
        console.log(chalk.yellow("💭 AI Narration:"));
        console.log(chalk.yellow(narration));
        return {
          result: "Narration recorded successfully",
          narration: narration,
        };
      },
    }),
    ecsGenerateComponent: tool({
      description:
        "Generates a new ECS component based on AI description.  Use this tool to generate new components to add to the simulation as needed.",
      parameters: z.object({
        componentName: z
          .string()
          .describe("The name of the new component to generate."),
        description: z
          .string()
          .describe("A description of what the component should do."),
        schema: z.string().describe("The JSON schema for the component."),
      }),
      execute: async ({ componentName, description, schema }) => {
        console.log(chalk.cyan(`🆕 New component generated: ${componentName}`));
        console.log(chalk.gray(`   Description: ${description}`));
        console.log(chalk.gray(`   Schema: ${schema}`));

        god.generatedComponents[componentName] = {
          value: [],
          description,
          schema,
        };

        // Here, we would typically integrate this with the actual ECS framework
        // For now, we'll just return a confirmation message
        return {
          result: `New component '${componentName}' generated`,
          componentName,
          description,
          schema,
        };
      },
    }),
    ecsGenerateSystem: tool({
      description:
        "Generates a new ECS system based on AI description.  Use this tool to generate new systems to add behaviour to the simulation.",
      parameters: z.object({
        systemName: z
          .string()
          .describe("The name of the new system to generate."),
        description: z
          .string()
          .describe("A description of what the system should do."),
        components: z
          .array(z.string())
          .describe("The components this system will operate on."),
        pseudocode: z
          .string()
          .describe("Optional pseudocode to illustrate the system's logic."),
      }),
      execute: async ({ systemName, description, components, pseudocode }) => {
        console.log(chalk.cyan(`🔧 New system generated: ${systemName}`));
        console.log(chalk.gray(`   Description: ${description}`));
        console.log(chalk.gray(`   Components: ${components.join(", ")}`));
        if (pseudocode) {
          console.log(chalk.gray("   Pseudocode:"));
          const lines = pseudocode.split("\n");
          for (const line of lines) {
            console.log(chalk.gray(`     ${line}`));
          }
        }

        // Add the new system to the tracking
        god.systems[systemName] = { description, components };

        // Here, we would typically integrate this with the actual ECS framework
        // For now, we'll just return a confirmation message
        return {
          result: `New system '${systemName}' generated and tracked`,
          systemName,
          description,
          components,
          pseudocode,
        };
      },
    }),
    // New tool to list existing systems
    ecsListSystems: tool({
      description: "Lists all existing systems in the simulation.",
      parameters: z.object({
        fetch: z
          .boolean()
          .optional()
          .describe("Whether to fetch the systems from the AI."),
      }),
      execute: async ({ fetch }) => {
        const systemList = Object.entries(god.systems).map(([name, info]) => ({
          name,
          description: info.description,
          components: info.components,
        }));
        console.log(chalk.cyan("📋 Existing Systems:"));
        systemList.forEach((system) => {
          console.log(chalk.cyan(`   ${system.name}:`));
          console.log(chalk.gray(`     Description: ${system.description}`));
          console.log(
            chalk.gray(`     Components: ${system.components.join(", ")}`)
          );
        });
        return {
          result: "Systems listed successfully",
          systems: systemList,
        };
      },
    }),
  };
}

function ecsAddEntity(world: World, entityMap: EntityMap) {
  return ({ name }: { name: string }) => {
    console.log("ADDING ENTITY", name);
    const eid = addEntity(world);
    entityMap[name] = eid;
    return {
      result: `Entity '${name}' added with ID ${eid}`,
    };
  };
}

function ecsAddComponents(god: GodState) {
  return ({
    entityName,
    components,
  }: {
    entityName: string;
    components: string[];
  }) => {
    const eid = god.entityMap[entityName];
    if (eid === undefined) {
      return `Error: Entity '${entityName}' not found`;
    }

    for (const componentName of components) {
      const component = god.componentMap[componentName];
      if (!component) {
        const generatedComponent = god.generatedComponents[componentName];
        if (!generatedComponent) {
          return `Error: Component '${componentName}' not found`;
        }

        addComponent(god.world, generatedComponent, eid);
        console.log(
          chalk.green(
            `Generated component added: ${chalk.bold(
              generatedComponent
            )} to ${chalk.bold(entityName)}`
          )
        );
        return {
          result: `Generated component '${componentName}' added to entity '${entityName}'`,
          component: generatedComponent,
        };
      }

      addComponent(god.world, component, eid);
      console.log(
        chalk.blue(
          `🔧 Component added: ${chalk.bold(componentName)} to ${chalk.bold(
            entityName
          )}`
        )
      );
    }

    return {
      result: `Components added to entity '${entityName}'`,
      components: components,
    };
  };
}

function ecsAddRelations(
  world: World,
  relationMap: RelationMap,
  entityMap: EntityMap
) {
  return ({
    relationName,
    fromEntityName,
    toEntityName,
  }: {
    relationName: string;
    fromEntityName: string;
    toEntityName: string;
  }) => {
    const fromEid = entityMap[fromEntityName];
    const toEid = entityMap[toEntityName];
    if (fromEid === undefined) {
      return `Error: Entity '${fromEntityName}' not found`;
    }
    if (toEid === undefined) {
      return `Error: Entity '${toEntityName}' not found`;
    }

    const relation = relationMap[relationName] as Relation<any>;

    if (!relation) {
      return `Error: Relation '${relationName}' not found`;
    }

    addComponent(world, relation(toEid), fromEid);

    console.log(
      chalk.magenta(
        `Relation added: ${chalk.bold(relationName)} from ${chalk.bold(
          fromEntityName
        )} to ${chalk.bold(toEntityName)}`
      )
    );

    return {
      result: `Relation '${relationName}' added from '${fromEntityName}' to '${toEntityName}'`,
    };
  };
}

export async function getWorldSummary(god: GodState): Promise<string> {
  const summaryPrompt =
    "Provide a concise summary of the current world state. Include the number of entities, major locations, significant events, and important relationships. Highlight any unique or interesting aspects of the world.";

  const response = await processInput(god, summaryPrompt);

  return response;
}

export function switchMode(
  god: GodState,
  newMode: "world-building" | "interaction"
): void {
  god.mode = newMode;
}
