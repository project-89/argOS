import { GodState, processInput } from "./god";

export async function generateWorld(
  god: GodState,
  initialPrompt: string,
  maxIterations: number = 10
) {
  const prompt = `You are going to help create a simulation. The simulation is a collection of entities, each with their own components and relations. Do not focus on adding people if the simulation requires them, focus on adding the components and relations that describe the simulation. Think about the simulation as a whole, and how the entities relate to each other. Think about what objects, cells, mechanisms, phenomena, buildings, flora, and fauna are in the simulation, and how they relate to each other. 
      
  Create a simulation based on the following prompt: ${initialPrompt}`;

  let worldSummary = "";

  try {
    console.log("Starting world generation...");

    for (let i = 0; i < maxIterations; i++) {
      if (god.mode === "interaction") {
        break;
      }

      console.log(`Generation iteration ${i + 1}/${maxIterations}`);

      const response = await processInput(god, prompt, {
        maxToolRoundtrips: 20,
        toolChoice: "required",
      });

      if (response) {
        console.log("AI Response:", response);
        worldSummary += response + "\n";
      }

      // Add a small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return (
      worldSummary || "World generation complete, but no summary was produced."
    );
  } catch (error) {
    console.error("Error during world generation:", error);
    throw error;
  }
}
