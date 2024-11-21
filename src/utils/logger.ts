import chalk from "chalk";

const colorArray = [
  chalk.blue,
  chalk.green,
  chalk.yellow,
  chalk.magenta,
  chalk.cyan,
  chalk.red,
  chalk.white,
  chalk.blueBright,
  chalk.greenBright,
  chalk.yellowBright,
  chalk.magentaBright,
  chalk.cyanBright,
];

export const logger = {
  system: (message: string) => {
    if (!chalk) return console.log(message);
    return console.log(chalk.gray(`[System] ${message}`));
  },

  agent: (agentId: number, message: string) => {
    if (!chalk || !colorArray)
      return console.log(`[Agent${agentId}] ${message}`);
    // Use modulo to cycle through colors
    const colorFn = colorArray[agentId % colorArray.length];
    console.log(colorFn(`[Agent${agentId}] ${message}`));
  },

  conversation: (message: string) => {
    if (!chalk) return console.log(message);
    return console.log(chalk.cyan(`[Conversation] ${message}`));
  },

  error: (message: string) => {
    if (!chalk) return console.log(`ERROR: ${message}`);
    return console.log(chalk.red(`[Error] ${message}`));
  },
};
