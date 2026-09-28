/**
 * Simulation Workspace Management
 * Handles multiple simulation projects and session persistence
 */

import { AutonomousGodState, createAutonomousGod } from '../agents/autonomous-god.js';
import { SimulationSerializer } from '../persistence/simulation-serializer.js';
import { globalRegistry } from '../components/registry.js';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

export interface SimulationWorkspace {
  id: string;
  name: string;
  description: string;
  created: string;
  modified: string;
  filePath: string;
  status: 'working' | 'needs-testing' | 'completed' | 'broken';
  lastTest?: {
    passed: boolean;
    message: string;
    timestamp: string;
  };
  stats: {
    components: number;
    systems: number;
    entities: number;
  };
}

export class WorkspaceManager {
  private workspacesDir: string;
  private workspacesFile: string;
  private currentWorkspace?: SimulationWorkspace;
  private currentGod?: AutonomousGodState;

  constructor(workspacesDir: string = './simulations') {
    this.workspacesDir = workspacesDir;
    this.workspacesFile = path.join(workspacesDir, 'workspaces.json');
  }

  async initialize(): Promise<void> {
    // Ensure workspaces directory exists
    try {
      await fs.mkdir(this.workspacesDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }

    // Create workspaces index if it doesn't exist
    try {
      await fs.access(this.workspacesFile);
    } catch {
      await this.saveWorkspaceIndex([]);
    }
  }

  async listWorkspaces(): Promise<SimulationWorkspace[]> {
    try {
      const content = await fs.readFile(this.workspacesFile, 'utf8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async createNewWorkspace(name: string, description: string = ''): Promise<SimulationWorkspace> {
    const id = this.generateWorkspaceId();
    const now = new Date().toISOString();
    const filePath = path.join(this.workspacesDir, `${id}.godsim`);

    const workspace: SimulationWorkspace = {
      id,
      name,
      description,
      created: now,
      modified: now,
      filePath,
      status: 'working',
      stats: {
        components: 0,
        systems: 0,
        entities: 0
      }
    };

    // Create new God agent
    this.currentGod = createAutonomousGod();
    this.currentWorkspace = workspace;

    // Save initial empty simulation
    await this.saveCurrentWorkspace();

    // Add to workspace index
    const workspaces = await this.listWorkspaces();
    workspaces.push(workspace);
    await this.saveWorkspaceIndex(workspaces);

    return workspace;
  }

  async loadWorkspace(id: string): Promise<AutonomousGodState | null> {
    const workspaces = await this.listWorkspaces();
    const workspace = workspaces.find(w => w.id === id);
    
    if (!workspace) {
      return null;
    }

    try {
      // Load simulation file
      await SimulationSerializer.load(workspace.filePath);
      
      // Create new God agent and load the simulation
      this.currentGod = createAutonomousGod();
      // TODO: Implement loading simulation data into God agent
      
      this.currentWorkspace = workspace;
      return this.currentGod;
    } catch (error) {
      console.error(`Failed to load workspace ${id}:`, error);
      return null;
    }
  }

  async saveCurrentWorkspace(): Promise<void> {
    if (!this.currentWorkspace || !this.currentGod) {
      throw new Error('No active workspace to save');
    }

    // Update stats
    this.updateWorkspaceStats();

    // Save simulation
    await SimulationSerializer.save(
      this.currentGod,
      this.currentWorkspace.filePath,
      {
        name: this.currentWorkspace.name,
        description: this.currentWorkspace.description
      }
    );

    // Update workspace metadata
    this.currentWorkspace.modified = new Date().toISOString();

    // Update workspace index
    const workspaces = await this.listWorkspaces();
    const index = workspaces.findIndex(w => w.id === this.currentWorkspace!.id);
    if (index >= 0) {
      workspaces[index] = this.currentWorkspace;
      await this.saveWorkspaceIndex(workspaces);
    }
  }

  getCurrentWorkspace(): SimulationWorkspace | undefined {
    return this.currentWorkspace;
  }

  getCurrentGod(): AutonomousGodState | undefined {
    return this.currentGod;
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const workspaces = await this.listWorkspaces();
    const workspace = workspaces.find(w => w.id === id);
    
    if (!workspace) {
      return false;
    }

    try {
      // Delete simulation file
      await fs.unlink(workspace.filePath);
      
      // Remove from index
      const updatedWorkspaces = workspaces.filter(w => w.id !== id);
      await this.saveWorkspaceIndex(updatedWorkspaces);
      
      // Clear current workspace if it was deleted
      if (this.currentWorkspace?.id === id) {
        this.currentWorkspace = undefined;
        this.currentGod = undefined;
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to delete workspace ${id}:`, error);
      return false;
    }
  }

  displayWorkspaceStatus(): void {
    if (!this.currentWorkspace) {
      console.log(chalk.yellow('No active workspace'));
      return;
    }

    const ws = this.currentWorkspace;
    const statusColor = {
      'working': chalk.green,
      'needs-testing': chalk.yellow,
      'completed': chalk.blue,
      'broken': chalk.red
    }[ws.status];

    console.log(chalk.cyan('╔══════════════════════════════════════════╗'));
    console.log(chalk.cyan(`║ ${this.getWorkspaceIcon(ws)} ${ws.name.padEnd(35)} ║`));
    console.log(chalk.cyan(`║ Created: ${ws.created.split('T')[0]} | Modified: ${this.getRelativeTime(ws.modified).padEnd(12)} ║`));
    console.log(chalk.cyan('╚══════════════════════════════════════════╝'));
    
    console.log(`\nComponents: ${ws.stats.components} | Systems: ${ws.stats.systems} | Entities: ${ws.stats.entities}`);
    console.log(`Status: ${statusColor('●')} ${ws.status.charAt(0).toUpperCase() + ws.status.slice(1)}`);
    
    if (ws.lastTest) {
      const testIcon = ws.lastTest.passed ? '✅' : '❌';
      console.log(`Last Test: ${testIcon} ${ws.lastTest.message}`);
    }
    
    console.log();
  }

  private updateWorkspaceStats(): void {
    if (!this.currentWorkspace || !this.currentGod) return;

    this.currentWorkspace.stats = {
      components: globalRegistry.listComponents().length,
      systems: globalRegistry.listSystems().length,
      entities: 0 // TODO: Count entities in world
    };
  }

  private generateWorkspaceId(): string {
    return 'sim_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private async saveWorkspaceIndex(workspaces: SimulationWorkspace[]): Promise<void> {
    await fs.writeFile(this.workspacesFile, JSON.stringify(workspaces, null, 2));
  }

  private getWorkspaceIcon(workspace: SimulationWorkspace): string {
    const name = workspace.name.toLowerCase();
    if (name.includes('neural') || name.includes('brain')) return '🧠';
    if (name.includes('ecosystem') || name.includes('bio')) return '🌿';
    if (name.includes('physics') || name.includes('particle')) return '⚛️';
    if (name.includes('economy') || name.includes('trade')) return '💰';
    if (name.includes('social') || name.includes('agent')) return '👥';
    return '🔬';
  }

  private getRelativeTime(isoString: string): string {
    const now = new Date();
    const then = new Date(isoString);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}min ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}hr ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  }
}