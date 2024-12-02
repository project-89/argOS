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
    if (!chalk) return console.log(message + "\n");
    return console.log(chalk.gray(`[System] ${message}`) + "\n");
  },

  emphasize: (message: string) => {
    if (!chalk) return console.log(message + "\n");
    return console.log(chalk.bold(chalk.bgMagentaBright(message)) + "\n");
  },

  agent: (agentId: number, message: string) => {
    if (!chalk || !colorArray)
      return console.log(`[Agent${agentId}] ${message}\n`);
    // Use modulo to cycle through colors
    const colorFn = colorArray[agentId % colorArray.length];
    console.log(colorFn(`[Agent${agentId}] ${message}`) + "\n");
  },

  agentBold: (agentId: number, message: string) => {
    if (!chalk || !colorArray)
      return console.log(`[Agent${agentId}] ${message}\n`);
    const colorFn = colorArray[agentId % colorArray.length];
    console.log(colorFn(chalk.bold(`[Agent${agentId}] ${message}`)) + "\n");
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
