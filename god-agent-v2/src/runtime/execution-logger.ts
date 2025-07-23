/**
 * Execution Logger
 * Provides real-time logging of system execution and entity activities
 */

import chalk from 'chalk';
import { EventEmitter } from 'events';

export interface ExecutionLog {
  timestamp: Date;
  type: 'system' | 'entity' | 'event' | 'thought' | 'action' | 'error';
  system?: string;
  entityId?: number;
  message: string;
  data?: any;
}

class ExecutionLogger extends EventEmitter {
  private logs: ExecutionLog[] = [];
  private maxLogs: number = 1000;
  private liveMode: boolean = false;
  private outputStream: boolean = true;

  constructor() {
    super();
  }

  setLiveMode(enabled: boolean) {
    this.liveMode = enabled;
    if (enabled) {
      console.log(chalk.green('🔴 Live execution logging enabled'));
    }
  }

  setOutputStream(enabled: boolean) {
    this.outputStream = enabled;
  }

  log(entry: Omit<ExecutionLog, 'timestamp'>) {
    const log: ExecutionLog = {
      ...entry,
      timestamp: new Date()
    };

    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Emit for other systems to listen
    this.emit('log', log);

    // Output to console if enabled
    if (this.outputStream && this.liveMode) {
      this.formatAndPrint(log);
    }
  }

  private formatAndPrint(log: ExecutionLog) {
    const time = log.timestamp.toLocaleTimeString();
    
    switch (log.type) {
      case 'system':
        console.log(chalk.blue(`[${time}] ⚙️  ${log.system}:`), log.message);
        break;
      
      case 'entity':
        console.log(chalk.yellow(`[${time}] 🎭 Entity ${log.entityId}:`), log.message);
        break;
      
      case 'thought':
        console.log(chalk.magenta(`[${time}] 💭 Entity ${log.entityId} thinks:`), log.message);
        break;
      
      case 'action':
        console.log(chalk.green(`[${time}] 🎯 Entity ${log.entityId}:`), log.message);
        break;
      
      case 'event':
        console.log(chalk.cyan(`[${time}] 📢 Event:`), log.message);
        break;
      
      case 'error':
        console.log(chalk.red(`[${time}] ❌ Error in ${log.system}:`), log.message);
        break;
    }
  }

  getRecentLogs(count: number = 50): ExecutionLog[] {
    return this.logs.slice(-count);
  }

  clearLogs() {
    this.logs = [];
  }

  printSummary() {
    const systemCounts = new Map<string, number>();
    const entityActions = new Map<number, number>();
    let thoughtCount = 0;
    let errorCount = 0;

    for (const log of this.logs) {
      if (log.type === 'system' && log.system) {
        systemCounts.set(log.system, (systemCounts.get(log.system) || 0) + 1);
      }
      if (log.type === 'action' && log.entityId !== undefined) {
        entityActions.set(log.entityId, (entityActions.get(log.entityId) || 0) + 1);
      }
      if (log.type === 'thought') thoughtCount++;
      if (log.type === 'error') errorCount++;
    }

    console.log(chalk.bold('\n📊 Execution Summary:'));
    console.log(chalk.gray('─'.repeat(40)));
    
    console.log(chalk.blue('Systems Run:'));
    systemCounts.forEach((count, system) => {
      console.log(`  ${system}: ${count} times`);
    });
    
    console.log(chalk.yellow('\nActive Entities:'), entityActions.size);
    console.log(chalk.magenta('Thoughts Generated:'), thoughtCount);
    
    if (errorCount > 0) {
      console.log(chalk.red('Errors:'), errorCount);
    }
    
    console.log(chalk.gray('─'.repeat(40)));
  }
}

// Singleton instance
export const executionLogger = new ExecutionLogger();

// Convenience functions
export function logSystemExecution(system: string, message: string, data?: any) {
  executionLogger.log({
    type: 'system',
    system,
    message,
    data
  });
}

export function logEntityAction(entityId: number, message: string, data?: any) {
  executionLogger.log({
    type: 'action',
    entityId,
    message,
    data
  });
}

export function logEntityThought(entityId: number, message: string) {
  executionLogger.log({
    type: 'thought',
    entityId,
    message
  });
}

export function logSystemError(system: string, error: Error) {
  executionLogger.log({
    type: 'error',
    system,
    message: error.message,
    data: { stack: error.stack }
  });
}