#!/usr/bin/env tsx
/**
 * Diagnostic tool to analyze system errors
 */

import { globalRegistry } from './src/components/registry.js';
import chalk from 'chalk';

console.log(chalk.bold.cyan('\n🔍 System Diagnostics\n'));

// List all registered systems
const systems = globalRegistry.listSystems();
console.log(chalk.yellow(`Found ${systems.length} systems:\n`));

for (const systemName of systems) {
  const system = globalRegistry.getSystem(systemName);
  if (!system) continue;
  
  console.log(chalk.blue(`📦 ${systemName}`));
  console.log(chalk.gray(`   Description: ${system.description}`));
  console.log(chalk.gray(`   Required Components: [${system.requiredComponents.join(', ')}]`));
  
  if (system.lastError) {
    console.log(chalk.red(`   ❌ Last Error: ${system.lastError.message}`));
  }
  
  // Check if all required components exist
  const missingComponents = system.requiredComponents.filter(
    comp => !globalRegistry.getComponent(comp)
  );
  
  if (missingComponents.length > 0) {
    console.log(chalk.red(`   ⚠️  Missing Components: [${missingComponents.join(', ')}]`));
  }
  
  // Show a snippet of the code if available
  if (system.code) {
    const codeLines = system.code.split('\n');
    const errorLine = codeLines.find(line => 
      line.includes('[eid]') || 
      line.includes('miniLLM') ||
      line.includes('setString')
    );
    if (errorLine) {
      console.log(chalk.gray(`   Code snippet: ${errorLine.trim()}`));
    }
  }
  
  console.log();
}

// List all components and their properties
console.log(chalk.yellow('\n📋 Registered Components:\n'));

for (const componentName of globalRegistry.listComponents()) {
  const component = globalRegistry.getComponent(componentName);
  if (!component) continue;
  
  console.log(chalk.green(`✅ ${componentName}`));
  if (component.schema?.properties) {
    for (const prop of component.schema.properties) {
      console.log(chalk.gray(`   - ${prop.name}: ${prop.type} (${prop.description})`));
    }
  }
  console.log();
}

console.log(chalk.cyan('\n💡 Common Issues:\n'));
console.log(chalk.gray('1. "Cannot set properties of undefined" - Component property array not initialized'));
console.log(chalk.gray('2. "Component is not defined" - Missing from requiredComponents'));
console.log(chalk.gray('3. "world.query is not a function" - Using wrong BitECS API'));
console.log(chalk.gray('\nTo fix: Ask the God agent to "Check for system errors and fix them"'));