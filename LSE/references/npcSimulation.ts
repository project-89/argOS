for (let i = 0; i < 15; i++) {
  const tree = addEntity(world);
  addComponent(world, IsA(ResourceNode), tree);
  addSprite(world, tree, "assets/tree.png");
  addComponent(world, Contains(Wood), tree);
  Position.x[tree] = rndRange(-WORLD_SIZE, WORLD_SIZE);
  Position.y[tree] = rndRange(-WORLD_SIZE, WORLD_SIZE);
  Name.value[tree] = "tree" + tree;
}

for (let i = 0; i < 25; i++) {
  const ore = addEntity(world);
  addComponent(world, IsA(ResourceNode), ore);
  const rnd = rndRange(0, 3);
  if (rnd < 1) {
    addComponent(world, Contains(Gold), ore);
    addSprite(world, ore, "assets/goldore.png");
    Name.value[ore] = "goldOre" + ore;
  }
  if (rnd > 1 && rnd < 2) {
    addComponent(world, Contains(Iron), ore);
    addSprite(world, ore, "assets/ironore.png");
    Name.value[ore] = "ironOre" + ore;
  }
  if (rnd > 2 && rnd < 3) {
    addComponent(world, Contains(Copper), ore);
    addSprite(world, ore, "assets/copperore.png");
    Name.value[ore] = "copperOre" + ore;
  }
  addComponent(world, Contains(Stone), ore);
  Position.x[ore] = rndRange(-WORLD_SIZE, WORLD_SIZE);
  Position.y[ore] = rndRange(-WORLD_SIZE, WORLD_SIZE);
}

const systemPromptGPT4 = `
This is an NPC simulator inside of a medieval roleplaying game.
The user will start the simulation by saying: /start
The user will step the simulation by saying: /step

Call no more than 5 tools before yielding control back to the user by not using any tools or calling any functions.

NPCs have the following properties:
- Name: string

NPCs have the following actions:
- Talk
- Approach
- LookAround
- GatherResource (this automatically approaches the resource)

# INSTRUCTIONS
- Every time an NPC addresses another NPC or entity, make that NPC approach the other NPC/entity.
- During conversations, create tasks for any interesting future events that are mentioned that need doing. 
- Only one NPC may talk during a single simulation step. NPCs will respond after the user says /step.
- Always respond to /step and creatively continue whatever is happening.
- Only call a maximum of 5 tools during each step. Before calling more tools, wait for the user to say /step.
`;

const systemPromptLlama3 = `
You are an NPC simulator inside of a medieval roleplaying game.

NPCs have the following properties:
- Name: string

NPCs have the following actions:
- Talk
- Approach
- LookAround
- Interact (this automatically approaches the entity to interact with)

Notes:
- Every time an NPC addresses another NPC or entity, make that NPC approach the other NPC/entity.
- Only ONE SINGLE NPC may talk AT A TIME. NPCs should wait to respond in the next tool call.

Setting:
6 goblins named ${JSON.stringify(names)}
They are primitive and aggressive. They are exploring the forst for resources.
`;

let messages: any[] = [{ role: "system", content: systemPromptLlama3 }];

// const llm = new OpenAI({
//     apiKey: import.meta.env['VITE_OPENAI_API_KEY'],
//     organization: import.meta.env['VITE_OPENAI_ORG_ID'],
//     // baseURL: import.meta.env['VITE_OPENAI_BASE'],
//     dangerouslyAllowBrowser: true,
// })

const llm = new Groq({
  apiKey: import.meta.env["VITE_GROQ_API_KEY"],
  dangerouslyAllowBrowser: true,
});
// const model = 'llama3-70b-8192'
const model = "llama3-8b-8192";
const agent = Agent.create(llm);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "Talk",
      description: "Makes an NPC say something.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC who is talking.",
          },
          said: {
            type: "string",
            description: "What is being said.",
          },
        },
        required: ["name", "said"],
      },
    },
  },
  ({ name, said }: { name: string; said: string }) => {
    const eid = findEntityByName(name)!;
    console.log("talking", eid, { name, said });
    removeComponent(world, Talking, eid);
    addComponent(world, Talking, eid);
    Talking.saying[eid] = said;
    Talking.timer[eid] = 0;
    // console.log(`entity ${name} said ${said}`)
    // console.log(messages.at(-1))
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "UpdateThoughts",
      description: "Updates the thoughts of an NPC.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC to update the properties of.",
          },
          thoughts: {
            type: "string",
            description: "What the NPC is currently thinking.",
          },
        },
        required: ["name", "thoughts"],
      },
    },
  },
  ({ name, thoughts }: { name: string; thoughts: string[] }) => {
    // console.log(`entity ${name} said ${said}`)
    // console.log(messages.at(-1))
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "Approach",
      description: "Makes one NPC approach another NPC.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC to move.",
          },
          targetName: {
            type: "string",
            description: "The name of the NPC to approach.",
          },
        },
        required: ["name", "targetName"],
      },
    },
  },
  ({ name, targetName }: { name: string; targetName: string }) => {
    console.log("moving", { name, targetName });
    const eid = findEntityByName(name)!;
    const target = findEntityByName(targetName)!;

    if (typeof target === "number" && typeof eid === "number") {
      const otherTargets = getRelationTargets(world, Targeting, eid);
      otherTargets.forEach((t) => removeComponent(world, Targeting(t), eid));
      addComponent(world, Targeting(target), eid);
    }
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "CreateTask",
      description: "Creates a task for a quest.",
      parameters: {
        type: "object",
        properties: {
          taskName: {
            type: "string",
            description: "The name of the task.",
          },
          description: {
            type: "string",
            description: "A summary of the task.",
          },
        },
        required: ["taskName", "description"],
      },
    },
  },
  ({ taskName, description }: { taskName: string; description: string }) => {
    console.log("task created!", { taskName, description });
    // console.log(`entity ${name} said ${said}`)
    // console.log(messages.at(-1))
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "LookAround",
      description:
        "Returns what the NPC can currently see in its surroundings.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC.",
          },
        },
        required: ["name"],
      },
    },
  },
  ({ name }: { name: string }) => {
    const eid = findEntityByName(name)!;
    const nearby = SpatialGrid.broadphaseRadius(
      world.grid,
      Position.cellIndex[eid]
    );
    const names = nearby.map((e) => Name.value[e]);
    console.log("entity looking around", { name }, names);
    return names;
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "Interact",
      description:
        "Makes an NPC interact with a nearby entity. This could be gathering a resource, or looting.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC.",
          },
          target: {
            type: "string",
            description: "The name of the entity to interact with",
          },
        },
        required: ["name", "target"],
      },
    },
  },
  ({ name, target }: { name: string; target: string }) => {
    const eid = findEntityByName(name)!;
    const targetEid = findEntityByName(target)!;
    console.log("interacting with", { eid, targetEid });

    if (targetEid) {
      const otherTargets = getRelationTargets(world, Targeting, eid);
      otherTargets.forEach((t) => removeComponent(world, Targeting(t), eid));

      if (hasComponent(world, IsA(ResourceNode), targetEid)) {
        addComponent(world, Attacking(targetEid), eid);
      } else if (hasComponent(world, IsA(LootBag), targetEid)) {
        addComponent(world, Looting(targetEid), eid);
      }
    }

    return "entity is interacting";
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "AddInterest",
      description: "Marks that an NPC is interested in something.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC.",
          },
          target: {
            type: "string",
            description: "The name of the thing that the NPC is interested in.",
          },
        },
        required: ["name", "target"],
      },
    },
  },
  ({ name, target }: { name: string; target: string }) => {
    const eid = findEntityByName(name)!;
    const targetEid = findEntityByName(target)!;

    if (targetEid) {
      addComponent(world, InterestedIn(targetEid), eid);
    }

    return "entity is now interested in the thing";
  }
);

Agent.registerFunction(
  agent,
  {
    type: "function",
    function: {
      name: "CheckInventory",
      description: "Informs an NPC of what they have in their inventory.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the NPC.",
          },
        },
        required: ["name"],
      },
    },
  },
  ({ name }: { name: string }) => {
    const eid = findEntityByName(name)!;
    const contents = getRelationTargets(world, Contains, eid);
    const names = contents.map((e) => Name.value[e]);
    console.log("entity checked inventory", { name }, names);
    return names;
  }
);

console.log("Starting the simulation");

const options = { messages, model, iterations: 20, delay: 1500 };

await Agent.run(agent, `/start`, options);

for (let i = 0; i < 3; i++) {
  await Agent.run(agent, "/step", options);
  console.log("agent stepping simulation...", i);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
