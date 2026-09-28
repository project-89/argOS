import { Command } from "commander";
import { input } from "@inquirer/prompts";
import chalk from "chalk";
import {
  createGod,
  switchMode,
  processInput,
  getWorldSummary,
  GodState,
} from "./god";
import { generateWorld } from "./worldGenerator";

export function runCLI() {
  const program = new Command();

  program
    .name("world-sim")
    .description("CLI for interacting with the World Simulation and GodAI")
    .version("0.1.0");

  program
    .command("start", { isDefault: true })
    .description("Start the World Simulation CLI")
    .action(() => {
      startSimulation();
    });

  program.parse(process.argv);
}

async function startSimulation() {
  console.log(chalk.blue("Welcome to the World Simulation CLI!"));
  console.log(chalk.blue("Let's start by creating a world"));

  const godState = createGod();
  console.log("GodState created:", godState); // Debug log

  if (!godState || typeof godState !== "object") {
    console.error(chalk.red("Error: GodState not created properly"));
    process.exit(1);
  }

  console.log(chalk.green("God AI initialized in world-building mode!"));
  console.log(chalk.yellow("Describe the world you want to create:"));

  const initialPrompt = await input({
    message: chalk.cyan("World Description:"),
  });

  // Start world generation asynchronously
  generateWorldAsync(godState, initialPrompt);

  switchMode(godState, "interaction");
  console.log(
    chalk.blue(
      "\nYou can now interact with the world while it's being generated."
    )
  );

  conversationLoop(godState);
}

async function generateWorldAsync(godState: GodState, initialPrompt: string) {
  try {
    console.log(chalk.yellow("\nStarting world generation..."));
    console.log(chalk.cyan("Initial prompt:"), initialPrompt);

    const worldSummary = await generateWorld(godState, initialPrompt);

    if (worldSummary) {
      console.log(
        chalk.green(
          "\nWorld-building complete! Here's a summary of the created world:"
        )
      );
      console.log(chalk.yellow(worldSummary));
    } else {
      console.log(
        chalk.yellow(
          "\nWorld generation completed but no summary was produced."
        )
      );
    }
  } catch (error) {
    console.error(chalk.red("Error during world generation:"), error);
  }
}

async function conversationLoop(godState: GodState) {
  const userInput = await input({
    message: chalk.cyan("You:"),
  });

  if (userInput.toLowerCase() === "exit") {
    console.log(chalk.blue("Exiting the World Simulation. Goodbye!"));
    process.exit(0);
  }

  if (userInput.startsWith("/")) {
    await handleCommand(godState, userInput.slice(1));
  } else {
    await interactWithGodAI(godState, userInput);
  }

  conversationLoop(godState);
}

async function handleCommand(godState: GodState, command: string) {
  const [cmd, ...args] = command.split(" ");

  switch (cmd) {
    case "help":
      showHelp();
      break;
    case "status":
      const summary = await getWorldSummary(godState);
      console.log(chalk.yellow("\nWorld Status:"));
      console.log(chalk.cyan(summary));
      break;
    case "generate":
      console.log(chalk.yellow("Generating new world elements..."));
      generateWorldAsync(godState, args.join(" "));
      break;
    default:
      console.log(chalk.red(`Unknown command: ${cmd}`));
      showHelp();
  }
}

function showHelp() {
  console.log(chalk.yellow("\nAvailable commands:"));
  console.log(chalk.green("/help") + " - Show this help message");
  console.log(
    chalk.green("/status") + " - Get a summary of the current world state"
  );
  console.log(
    chalk.green("/generate [prompt]") + " - Generate new world elements"
  );
  console.log(chalk.green("exit") + " - Exit the simulation");
  console.log(
    chalk.yellow("\nAny other input will be treated as a query for the GodAI.")
  );
}

async function interactWithGodAI(godState: GodState, input: string) {
  try {
    const response = await processInput(godState, input);
    console.log(
      chalk.magenta("GodAI: ") +
        chalk.yellow(
          response || "I couldn't process your input. Please try again."
        )
    );
  } catch (error) {
    console.error(
      chalk.red("An error occurred while processing your input:"),
      error
    );
  }
}
