#!/usr/bin/env node
/**
 * Test workspace creation
 */

import { WorkspaceManager } from './src/workspace/simulation-workspace.js';
import chalk from 'chalk';

async function testWorkspace() {
  console.log(chalk.cyan('Testing workspace creation...'));
  
  const manager = new WorkspaceManager();
  await manager.initialize();
  
  try {
    // Create a new workspace
    const workspace = await manager.createNewWorkspace('Small Village', 'A simple village with trading');
    console.log(chalk.green('✅ Workspace created successfully!'));
    console.log('  ID:', workspace.id);
    console.log('  Name:', workspace.name);
    console.log('  Path:', workspace.filePath);
    
    // Display status
    manager.displayWorkspaceStatus();
    
    // List all workspaces
    const workspaces = await manager.listWorkspaces();
    console.log(chalk.cyan('\nAll workspaces:'));
    workspaces.forEach(ws => {
      console.log(`  - ${ws.name} (${ws.id})`);
    });
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

testWorkspace();