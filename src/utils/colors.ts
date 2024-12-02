import chalk from "chalk";

// Define a color palette that maps to both chalk and Tailwind colors
export const agentColors = [
  { id: "blue", chalk: chalk.blue, tailwind: "text-blue-400" },
  { id: "green", chalk: chalk.green, tailwind: "text-green-400" },
  { id: "purple", chalk: chalk.magenta, tailwind: "text-purple-400" },
  { id: "yellow", chalk: chalk.yellow, tailwind: "text-yellow-400" },
  { id: "cyan", chalk: chalk.cyan, tailwind: "text-cyan-400" },
  { id: "pink", chalk: chalk.magentaBright, tailwind: "text-pink-400" },
  { id: "orange", chalk: chalk.yellowBright, tailwind: "text-orange-400" },
  { id: "teal", chalk: chalk.cyanBright, tailwind: "text-teal-400" },
];

// Color assignment cache
const colorAssignments = new Map<string, number>();

export function getAgentColor(agentName: string) {
  // If color is already assigned, return it
  if (colorAssignments.has(agentName)) {
    const colorIndex = colorAssignments.get(agentName)!;
    return agentColors[colorIndex];
  }

  // Assign new color based on current assignments count
  const newColorIndex = colorAssignments.size % agentColors.length;
  colorAssignments.set(agentName, newColorIndex);
  return agentColors[newColorIndex];
}

export function getChalkColor(agentName: string) {
  return getAgentColor(agentName).chalk;
}

export function getTailwindColor(agentName: string) {
  return getAgentColor(agentName).tailwind;
}
