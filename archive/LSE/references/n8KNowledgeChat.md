asier to have a check inventory function, but still...could it?
Parzival — 08/02/2024 1:13 PM
Probably could yeah.
And of course we can see what other models and tech they are cooking we can play with.
n8bit — 08/02/2024 1:13 PM
:3
n8bit — 08/02/2024 3:37 PM
i have a thought
components are composable so we can basically concat all the values of components that constitute an agents awareness
trying to think of an example
addComponent(world, bob, AwareOf(lucy))
addComponent(world, bob, AwareOf(table))
addComponent(world, bob, AwareOf(rat))
addComponent(world, bob, AwareOf(grog))
there could be a system that crawls awareOf too
so if you're in a room all u have to do for the agent is addComponent(world, bob, AwareOf(roomBobIsIn)) and it automatically makes him aware of everything in it
which is to say, it takes the descriptions of everything and puts it in the context window
Parzival — 08/02/2024 3:41 PM
Oh i like that pattern!
n8bit — 08/02/2024 4:08 PM
what is longterm memory? a rag?
or do u think context window sizes will make that irrelevant
Parzival — 08/02/2024 4:13 PM
I think we still kind of need both. RAG knowledge graphs.
n8bit — 08/02/2024 4:22 PM
ok
uhm
wild idea
we could make the rag knowledge graph in the ecs
if the world is the agent's entire consciousness
and the entities inside of the world are its own perception of the "reality" around it
const bob = createWorld()

// make bob aware of lucy
const lucy = addEntity(bob)

// make bob know that lucy sells armor
addComponent(bob, lucy, Sells(armor))
and this is what would happen in lucy's world:
const lucy = createWorld()

// make lucy aware of bob
const bob = addEntity(lucy)

// make lucy know about the location bob told her about
addComponent(lucy, bob, ToldMeAbout(location))

too crazy?
n8bit — 08/02/2024 4:29 PM
const thingsBobToldLucyAbout = getRelationTargets(lucy, bob, ToldMeAbout) // => [ location ]

Parzival — 08/02/2024 4:46 PM
Or use Yerah I was thinking this.
Use ECS relationships to build a dynamic knowldge graph
i love the idea that the agent is a world itself
so you really have 2 worlds the simulated God world, and each entity has its own world.
Could bob also be an entity processed by the world system, and use that to add and remove perceptions from bobs world?
n8bit — 08/02/2024 4:58 PM
Haha yes
n8bit — 08/02/2024 4:58 PM
Yea im thinking these agent worlds are entities in the god world
Lol this is wild
Welp i know what im doing this weekend
Its like indra's net
The whole reflected in each part
I wonder if the redundancy is uneccessary tho
I guess its not
Not that redundant
Parzival — 08/02/2024 5:04 PM
nah not redundant
what is wild is that if all entities absorb all other entities in the world, they all become the same.
n8bit — 08/02/2024 5:17 PM
Hivemind lol
Parzival — 08/02/2024 5:17 PM
yup
one step beyond swarms
Parzival — 08/03/2024 11:10 AM
So I think we are going to try starting with AI generated evening of murder. And all participants have the cameras for visual intelligence, mic’s to transcribe and process audio, and earpieces to receive AI instructions.
Probably smallest possible constrained environment.
n8bit — 08/03/2024 11:29 AM
oh like a town of salem type deal?
or that two wearwolves game
murder mystery, each round ppl die, gotta find out who the murderers are, sorta thing?
Parzival — 08/03/2024 11:38 AM
Yeah. Everyone is assigned a characters. There are major plot points that develop. The AI feeds people some lines and actions at points. People keep dying and the players all need to figure it out.
n8bit — 08/04/2024 2:06 PM
const createAgent = () => {
const world = createWorld()
return world
}

// relations
const Likes = defineRelation()
const Sells = defineRelation()

// prefabs
const Armor = definePrefab()
const Merchant = definePrefab()
const Adventurer = definePrefab()
const Warrior = definePrefab()

// agents
const God = createAgent()
const Bob = createAgent()
const Jane = createAgent()

// mapping from agent world to God EID
const agentWorldMap = new Map()
agentWorldMap.set(Bob, addEntity(God))
agentWorldMap.set(Jane, addEntity(God))

// make bob aware of jane
const janeInBobsHead = addEntity(Bob)

// make bob like jane
addComponent(Bob, Likes, janeInBobsHead)

// make bob know that jane sells armor
addComponent(Bob, IsA(Merchant), janeInBobsHead)
addComponent(Bob, Sells(Armor), janeInBobsHead)

const bobInJanesHead = addEntity(Jane)

// make jane like bob
addComponent(Jane, Likes, bobInJanesHead)

// make jane know that bob is a warrior adventurer
addComponent(Jane, IsA(Adventurer), bobInJanesHead)
addComponent(Jane, IsA(Warrior), bobInJanesHead)
^ static knowledge
we can do some crazy stuff with dynamic knowledge
// make jane know bob is nearby
addComponent(Jane, Nearby, bobInJanesHead)
const janeEid = agentToEid.get(Jane)
const nearby = spatialGrid.queryNearby(janeEid)

for (const eid of nearby) {
const nearbyAgent = eidToAgent.get(eid)
addComponent(Jane, Nearby, nearbyAgent)
}

Parzival — 08/04/2024 3:17 PM
This is so crazy.
One of my goals is to try to use pictures of a room to generate entities with components/relations from the images. So you could ‘scan’ a room with the smart glasses wearable and map it into entity space.
Parzival — 08/04/2024 3:53 PM
Is this functional code?
n8bit — 08/04/2024 3:58 PM
ya it works
Parzival — 08/04/2024 6:47 PM
Now to add memory functions for the LLM to add knowledge and retrieve it.
n8bit — 08/04/2024 7:12 PM
const getFriendsOfAgent = (god, agent) => {
return query(god, [FriendsWith(agent)])
}
Parzival — 08/04/2024 7:12 PM
I love that it is god.
n8bit — 08/04/2024 7:12 PM
😄
the modern models are probably smart enough to construct queries themselves
reliably enough
Parzival — 08/04/2024 7:13 PM
Oh yeah totally.
And if we gather enough prompt and returned query we can fine tune much smaller models too.
n8bit — 08/04/2024 7:14 PM
indeed
{
type: "function",
function: {
name: "ecsQuery",
description: "Queries the ECS game world for entities who have the specified components on them.",
parameters: {
type: "object",
properties: {
componentNames: {
type: "array",
description: "An array of component names.",
enum: Object.keys(componentMap),
},
},
},
},
}
this is essentially how bitecs agent does querying
Parzival — 08/04/2024 7:18 PM
And I guess you also let it know what components are available?
n8bit — 08/04/2024 7:18 PM
enum: Object.keys(componentMap)
😄
just populate an object/map with components heh
const Alive = defineComponent()
const Dead = defineComponent()

const componentMap = {
Alive,
Dead,
}
