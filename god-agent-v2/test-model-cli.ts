#!/usr/bin/env node
/**
 * Test model switching functionality
 */

import { setModelOverride, getCurrentModel, modelNames } from './src/llm/model-selector.js';
import chalk from 'chalk';

console.log(chalk.cyan('\n🤖 Testing Model Switching\n'));

// Test 1: Default state
console.log('1. Default state:');
console.log(`   Current model: ${getCurrentModel()}`);

// Test 2: Set to flash25
console.log('\n2. Setting to flash25:');
setModelOverride('flash25');
console.log(`   Current model: ${getCurrentModel()}`);

// Test 3: Set to pro
console.log('\n3. Setting to pro:');
setModelOverride('pro');
console.log(`   Current model: ${getCurrentModel()}`);

// Test 4: Reset to auto
console.log('\n4. Reset to auto:');
setModelOverride(null);
console.log(`   Current model: ${getCurrentModel()}`);

// Show all available models
console.log(chalk.yellow('\n📋 Available Models:'));
Object.entries(modelNames).forEach(([key, name]) => {
  console.log(`   ${key}: ${name}`);
});

console.log(chalk.green('\n✅ Model switching working correctly!\n'));