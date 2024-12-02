import chalk from "chalk";
import { getChalkColor } from "./colors";

export const logger = {
  system: (message: string) => {
    if (!chalk) return console.log(message + "\n");
    return console.log(chalk.gray(`[System] ${message}`) + "\n");
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
