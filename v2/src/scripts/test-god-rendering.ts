import 'dotenv/config';
import { createArgosWorld } from '../ecs/world';
import { initializePrefabs } from '../ecs/prefabs';
import { createGodAgent, godThink } from '../god/god-agent';
import { loadCharacterAnimations } from '../rendering/animation-loader';
import * as path from 'path';

async function main() {
  console.log('=== Testing GodAI Rendering Tools ===\n');

  console.log('Loading character assets first...');
  const assetsDir = path.join(process.cwd(), 'public/32x32/Characters_32x32');
  const atlases = await loadCharacterAnimations(assetsDir, 'Farmer_1');
  console.log(`Loaded ${atlases.size} atlases for Farmer_1\n`);

  const world = createArgosWorld('RenderingTest');
  initializePrefabs(world);
  const god = createGodAgent(world, {
    name: 'TestGod',
    worldName: 'RenderingTest',
    narrative: 'Testing sprite and animation tools',
  });

  const prompt = `Create a farmer NPC named "Old MacDonald" and set them up with a character rig using the farmer_1 sprites. 
Place them on a small farm map at position (5,5). 
Then trigger their walk animation facing down.
Show me what characters and animations are available first.`;

  console.log('Prompt:', prompt);
  console.log('\n--- GodAI Response ---\n');

  const result = await godThink(god, prompt);
  
  console.log('\n--- Thinking ---');
  console.log(result.thinking);
  
  console.log('\n--- Actions Taken ---');
  for (const action of result.actions) {
    console.log(JSON.stringify(action, null, 2));
  }

  console.log('\n--- Character Rigs ---');
  const rigs = god.renderingTools.listCharacterRigs();
  console.log(JSON.stringify(rigs, null, 2));
}

main().catch(console.error);
