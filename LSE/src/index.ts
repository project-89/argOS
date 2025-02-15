// import { Position, Name, Description, Goal } from "./components";
// import { createLSEWorld } from "./world";
// import { initializeWorld } from "./god";

import dotenv from "dotenv";
import { runCLI } from "./cli";
// import { relationMap } from "./relationships";

dotenv.config();

// export async function runLSESimulation(
//   initialPrompt: string,
//   maxIterations: number = 100
// ) {
//   const world = createLSEWorld();
//   const componentMap = { Position, Name, Description, Goal };
//   const relations = relationMap;
//   const entityMap = {};

//   await initializeWorld(
//     initialPrompt,
//     world,
//     componentMap,
//     entityMap,
//     relations
//   );

//   // for (let i = 0; i < maxIterations; i++) {
//   //   console.log(`Simulation step ${i + 1}`);
//   //   await simulationStep(world, entityMap, relationMap);
//   // }

//   console.log("Simulation complete");
// }

// // Example usage of runLSESimulation
// // const initialPrompt =
// //   "Simulate the biochemical functioning of a single neuron in the brain. Make this very detailed, even simulating the movement of ions across the neuron, the internal operations of the cell. Leverage everything you know about wneurons and neuroscience to make this as realistic as possible.";
// const initialPrompt =
//   "Simulate the proprties of a narrative structure. The goal is to create a detailed and complex narrative structure that can be used to generate any story, and will be able to adapt to any changes in the story as it progresses.";
// runLSESimulation(initialPrompt, 50)
//   .then(() => console.log("Simulation finished"))
//   .catch((error) => console.error("Error in simulation:", error));

runCLI();
