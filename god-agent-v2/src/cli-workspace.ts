#!/usr/bin/env node
/**
 * God Agent V2 CLI with Workspace Management
 * Multi-simulation project management interface
 */

import readline from 'readline';
import chalk from 'chalk';
import { WorkspaceManager, SimulationWorkspace } from './workspace/simulation-workspace.js';
import { processAutonomousInput } from './agents/autonomous-god.js';

const workspaceManager = new WorkspaceManager();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  await workspaceManager.initialize();
  
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           GOD AGENT V2 - WORKSPACE       ║'));
  console.log(chalk.bold.cyan('║       Simulation Project Manager         ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝\n'));

  await showMainMenu();
}

async function showMainMenu(): Promise<void> {
  const workspaces = await workspaceManager.listWorkspaces();
  
  console.log(chalk.yellow('📁 SIMULATION WORKSPACES:\n'));
  
  console.log(chalk.green('🆕 [N] New Simulation'));
  console.log(chalk.blue('📂 [O] Open Existing Simulation'));
  console.log(chalk.gray('💾 [R] Recent Simulations'));
  console.log(chalk.red('🗑️  [D] Delete Simulation'));
  console.log(chalk.cyan('🔄 [I] Import .godsim file'));
  console.log(chalk.magenta('📤 [E] Export to .godsim file'));
  console.log(chalk.yellow('❓ [H] Help'));
  console.log(chalk.gray('🚪 [Q] Quit\n'));

  if (workspaces.length > 0) {
    console.log(chalk.cyan('Recent Simulations:'));
    workspaces
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, 5)
      .forEach((ws, i) => {
        const icon = getWorkspaceIcon(ws);
        const time = getRelativeTime(ws.modified);
        console.log(`  ${i + 1}. ${icon} ${ws.name} ${chalk.gray(`(${time})`)}`);
      });
    console.log();
  }

  rl.question(chalk.cyan('Select option or simulation number: '), async (input) => {
    await handleMainMenuInput(input.trim());
  });
}

async function handleMainMenuInput(input: string): Promise<void> {
  const workspaces = await workspaceManager.listWorkspaces();
  
  switch (input.toLowerCase()) {
    case 'n':
    case 'new':
      await createNewSimulation();
      break;
      
    case 'o':
    case 'open':
      await openExistingSimulation();
      break;
      
    case 'r':
    case 'recent':
      await showMainMenu(); // Already shows recent
      break;
      
    case 'd':
    case 'delete':
      await deleteSimulation();
      break;
      
    case 'h':
    case 'help':
      showHelp();
      await showMainMenu();
      break;
      
    case 'q':
    case 'quit':
      console.log(chalk.yellow('\nMay your simulations prosper! 🌟\n'));
      process.exit(0);
      break;
      
    default:
      // Check if it's a number for direct workspace selection
      const num = parseInt(input);
      if (num >= 1 && num <= Math.min(workspaces.length, 5)) {
        const sortedWorkspaces = workspaces
          .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
        const selectedWorkspace = sortedWorkspaces[num - 1];
        await openWorkspace(selectedWorkspace.id);
      } else {
        console.log(chalk.red('Invalid option. Please try again.\n'));
        await showMainMenu();
      }
  }
}

async function createNewSimulation(): Promise<void> {
  console.log(chalk.cyan('\n🆕 Creating New Simulation\n'));
  
  rl.question('Simulation name: ', async (name) => {
    if (!name.trim()) {
      console.log(chalk.red('Name cannot be empty.\n'));
      await showMainMenu();
      return;
    }
    
    rl.question('Description (optional): ', async (description) => {
      try {
        const workspace = await workspaceManager.createNewWorkspace(name.trim(), description.trim());
        console.log(chalk.green(`\n✅ Created simulation: ${workspace.name}\n`));
        await enterWorkspaceSession();
      } catch (error) {
        console.log(chalk.red(`❌ Failed to create simulation: ${error}`));
        await showMainMenu();
      }
    });
  });
}

async function openExistingSimulation(): Promise<void> {
  const workspaces = await workspaceManager.listWorkspaces();
  
  if (workspaces.length === 0) {
    console.log(chalk.yellow('\nNo simulations found. Create one first!\n'));
    await showMainMenu();
    return;
  }
  
  console.log(chalk.cyan('\n📂 Available Simulations:\n'));
  workspaces.forEach((ws, i) => {
    const icon = getWorkspaceIcon(ws);
    const time = getRelativeTime(ws.modified);
    console.log(`  ${i + 1}. ${icon} ${ws.name} ${chalk.gray(`(${time})`)}`);
  });
  
  rl.question('\nSelect simulation number (or 0 to go back): ', async (input) => {
    const num = parseInt(input);
    if (num === 0) {
      await showMainMenu();
      return;
    }
    
    if (num >= 1 && num <= workspaces.length) {
      const workspace = workspaces[num - 1];
      await openWorkspace(workspace.id);
    } else {
      console.log(chalk.red('Invalid selection.\n'));
      await openExistingSimulation();
    }
  });
}

async function openWorkspace(id: string): Promise<void> {
  console.log(chalk.cyan('\n🔄 Loading simulation...\n'));
  
  const god = await workspaceManager.loadWorkspace(id);
  if (!god) {
    console.log(chalk.red('❌ Failed to load simulation.\n'));
    await showMainMenu();
    return;
  }
  
  console.log(chalk.green('✅ Simulation loaded successfully!\n'));
  await enterWorkspaceSession();
}

async function enterWorkspaceSession(): Promise<void> {
  workspaceManager.displayWorkspaceStatus();
  
  const workspace = workspaceManager.getCurrentWorkspace()!;
  console.log(chalk.yellow(`💭 God is ready to continue building your ${workspace.name}.`));
  console.log(chalk.gray('    Type your request or use commands:\n'));
  
  rl.setPrompt(chalk.cyan('🌟 > '));
  rl.prompt();
  
  rl.removeAllListeners('line');
  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    if (!trimmed) {
      rl.prompt();
      return;
    }
    
    // Handle workspace commands
    if (trimmed.startsWith('/')) {
      const handled = await handleWorkspaceCommand(trimmed);
      if (handled) {
        rl.prompt();
        return;
      }
    }
    
    // Process with God agent
    try {
      const god = workspaceManager.getCurrentGod();
      if (god) {
        console.log();
        await processAutonomousInput(god, trimmed);
        
        // Auto-save after each interaction
        await workspaceManager.saveCurrentWorkspace();
        console.log(chalk.gray('💾 Progress auto-saved'));
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('❌ Error:', error));
    }
    
    rl.prompt();
  });
}

async function handleWorkspaceCommand(command: string): Promise<boolean> {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  
  switch (cmd) {
    case '/menu':
      rl.removeAllListeners('line');
      await showMainMenu();
      return true;
      
    case '/save':
      try {
        await workspaceManager.saveCurrentWorkspace();
        console.log(chalk.green('\n💾 Simulation saved!\n'));
      } catch (error) {
        console.log(chalk.red(`❌ Save failed: ${error}\n`));
      }
      return true;
      
    case '/status':
      workspaceManager.displayWorkspaceStatus();
      return true;
      
    case '/help':
      showWorkspaceHelp();
      return true;
      
    case '/exit':
    case '/quit':
      rl.removeAllListeners('line');
      await showMainMenu();
      return true;
      
    default:
      return false; // Let regular CLI handle it
  }
}

async function deleteSimulation(): Promise<void> {
  const workspaces = await workspaceManager.listWorkspaces();
  
  if (workspaces.length === 0) {
    console.log(chalk.yellow('\nNo simulations to delete.\n'));
    await showMainMenu();
    return;
  }
  
  console.log(chalk.red('\n🗑️  Delete Simulation:\n'));
  workspaces.forEach((ws, i) => {
    const icon = getWorkspaceIcon(ws);
    console.log(`  ${i + 1}. ${icon} ${ws.name}`);
  });
  
  rl.question('\nSelect simulation number to delete (or 0 to cancel): ', async (input) => {
    const num = parseInt(input);
    if (num === 0) {
      await showMainMenu();
      return;
    }
    
    if (num >= 1 && num <= workspaces.length) {
      const workspace = workspaces[num - 1];
      rl.question(`Really delete "${workspace.name}"? (y/N): `, async (confirm) => {
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          const success = await workspaceManager.deleteWorkspace(workspace.id);
          if (success) {
            console.log(chalk.green(`✅ Deleted "${workspace.name}"\n`));
          } else {
            console.log(chalk.red(`❌ Failed to delete "${workspace.name}"\n`));
          }
        }
        await showMainMenu();
      });
    } else {
      console.log(chalk.red('Invalid selection.\n'));
      await deleteSimulation();
    }
  });
}

function showHelp(): void {
  console.log(chalk.yellow('\n📖 God Agent V2 Workspace Help:\n'));
  console.log(chalk.gray('Main Menu Options:'));
  console.log(chalk.gray('  N - Create a new simulation project'));
  console.log(chalk.gray('  O - Open an existing simulation'));
  console.log(chalk.gray('  1-5 - Quick open recent simulations'));
  console.log(chalk.gray('  D - Delete a simulation'));
  console.log(chalk.gray('  Q - Quit\n'));
  
  console.log(chalk.gray('Within a Simulation:'));
  console.log(chalk.gray('  Type natural language to build with God'));
  console.log(chalk.gray('  /menu - Return to main menu'));
  console.log(chalk.gray('  /save - Save current progress'));
  console.log(chalk.gray('  /status - Show simulation info'));
  console.log(chalk.gray('  /help - Show this help\n'));
}

function showWorkspaceHelp(): void {
  console.log(chalk.yellow('\n📖 Workspace Commands:\n'));
  console.log(chalk.gray('  /menu - Return to main menu'));
  console.log(chalk.gray('  /save - Save current progress'));
  console.log(chalk.gray('  /status - Show simulation info'));
  console.log(chalk.gray('  /test - Test the simulation'));
  console.log(chalk.gray('  /inspect - Inspect world state'));
  console.log(chalk.gray('  /help - Show this help'));
  console.log(chalk.gray('  /exit - Return to main menu\n'));
  
  console.log(chalk.gray('Or just talk to God in natural language!\n'));
}

function getWorkspaceIcon(workspace: SimulationWorkspace): string {
  const name = workspace.name.toLowerCase();
  if (name.includes('neural') || name.includes('brain')) return '🧠';
  if (name.includes('ecosystem') || name.includes('bio')) return '🌿';
  if (name.includes('physics') || name.includes('particle')) return '⚛️';
  if (name.includes('economy') || name.includes('trade')) return '💰';
  if (name.includes('social') || name.includes('agent')) return '👥';
  return '🔬';
}

function getRelativeTime(isoString: string): string {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}min ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}hr ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

// Run the workspace CLI
main().catch(error => {
  console.error(chalk.red('Fatal error:', error));
  process.exit(1);
});