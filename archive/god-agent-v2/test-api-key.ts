#!/usr/bin/env tsx
/**
 * Test API Key Loading
 */

import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

console.log(chalk.cyan('\n🔑 API Key Test\n'));

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  console.log(chalk.red('❌ GOOGLE_GENERATIVE_AI_API_KEY is not set!'));
  console.log(chalk.yellow('\nPlease ensure you have a .env file with:'));
  console.log(chalk.gray('GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here\n'));
} else {
  console.log(chalk.green('✅ API Key is loaded!'));
  console.log(chalk.gray(`Key starts with: ${apiKey.substring(0, 10)}...`));
  console.log(chalk.gray(`Key length: ${apiKey.length} characters\n`));
}

// Test a simple API call
import { models } from './src/llm/model-selector.js';
import { generateText } from 'ai';

async function testCall() {
  try {
    console.log(chalk.yellow('Testing API call with flash model...'));
    const { text } = await generateText({
      model: models.flash,
      prompt: 'Say hello',
      temperature: 0.7,
    });
    console.log(chalk.green('✅ API call successful!'));
    console.log(chalk.gray('Response:', text));
  } catch (error: any) {
    console.log(chalk.red('❌ API call failed:'));
    console.log(chalk.red(error.message));
  }
}

testCall();