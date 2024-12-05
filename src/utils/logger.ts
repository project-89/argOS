import chalk from "chalk";
import { getChalkColor } from "./colors";

const DEBUG = process.env.DEBUG === "true";

export const logger = {
  system: (message: string, systemName?: string) => {
    if (!chalk) return console.log(message + "\n");
    return console.log(
      chalk.gray(`[${systemName || "System"}] ${message}`) + "\n"
    );
  },
  debug: (message: string) => {
    if (!DEBUG) return;
    return console.log(chalk.gray(`[Debug] ${message}`) + "\n");
  },
  emphasize: (message: string) => {
    if (!chalk) return console.log(message + "\n");
    return console.log(chalk.bold(chalk.bgMagentaBright(message)) + "\n");
  },

  agent: (agentId: number, message: string, agentName?: string) => {
    if (!chalk) return console.log(`[Agent${agentId}] ${message}\n`);
    const name = agentName || `Agent${agentId}`;
    const colorFn = getChalkColor(name);
    console.log(colorFn(`[${name}] ${message}`) + "\n");
  },

  agentBold: (agentId: number, message: string, agentName?: string) => {
    if (!chalk) return console.log(`[Agent${agentId}] ${message}\n`);
    const name = agentName || `Agent${agentId}`;
    const colorFn = getChalkColor(name);
    console.log(colorFn(chalk.bold(`[${name}] ${message}`)) + "\n");
  },

  conversation: (message: string) => {
    if (!chalk) return console.log(message + "\n");
    return console.log(chalk.cyan(`[Conversation] ${message}`) + "\n");
  },

  error: (message: string) => {
    if (!chalk) return console.log(`ERROR: ${message}\n`);
    return console.log(chalk.red(`[Error] ${message}`) + "\n");
  },
};
