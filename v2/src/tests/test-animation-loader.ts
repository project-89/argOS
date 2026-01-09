import * as path from 'path';
import {
  registerAnimatedSpriteSheet,
  loadCharacterAnimations,
  loadAnimalAnimations,
  detectAnimationLayout,
} from '../rendering/animation-loader';
import { SpriteRegistry } from '../rendering/sprite-registry';

async function main() {
  const baseDir = path.join(process.cwd(), 'public/32x32');
  
  console.log('=== Animation Loader Test ===\n');

  console.log('--- Testing Farmer_1 character sheet ---');
  const farmer1Path = path.join(baseDir, 'Characters_32x32/Farmer_1_32x32.png');
  const layout = await detectAnimationLayout(farmer1Path, 32);
  console.log(`  Dimensions: ${layout.cols}x${layout.rows} tiles (${layout.cols * 32}x${layout.rows * 32}px)`);
  console.log(`  Layout type: ${layout.layout.type}`);
  console.log(`  Directions: ${layout.layout.directions}`);
  console.log(`  Frames per direction: ${layout.layout.framesPerDirection}`);

  const farmer1Atlas = await registerAnimatedSpriteSheet('farmer_1', farmer1Path, {
    tags: ['character', 'farmer'],
  });
  console.log(`  Registered atlas: ${farmer1Atlas.id}`);
  console.log(`  Frames: ${farmer1Atlas.frames.size}`);
  console.log(`  Animations: ${Array.from(farmer1Atlas.animations.keys()).join(', ')}`);

  console.log('\n--- Testing Farmer_1 Chopping animation ---');
  const chopPath = path.join(baseDir, 'Characters_32x32/Farmer_1_Chopping_40_frames_32x32.png');
  const chopLayout = await detectAnimationLayout(chopPath, 32, 'chop');
  console.log(`  Dimensions: ${chopLayout.cols}x${chopLayout.rows} tiles`);
  console.log(`  Layout type: ${chopLayout.layout.type}`);

  const chopAtlas = await registerAnimatedSpriteSheet('farmer_1_chop', chopPath, {
    layoutHint: 'chop',
    tags: ['character', 'farmer', 'action'],
  });
  console.log(`  Registered atlas: ${chopAtlas.id}`);
  console.log(`  Animations: ${Array.from(chopAtlas.animations.keys()).join(', ')}`);
  
  const chopDown = chopAtlas.animations.get('chop_down');
  if (chopDown) {
    console.log(`  chop_down frames: ${chopDown.frames.length}`);
  }

  console.log('\n--- Testing Chicken animation ---');
  const chickenPath = path.join(baseDir, 'Animals_32x32/Chickens_and_Roosters_32x32/Chicken_Brown_32x32.png');
  const chickenLayout = await detectAnimationLayout(chickenPath, 32);
  console.log(`  Dimensions: ${chickenLayout.cols}x${chickenLayout.rows} tiles`);

  const chickenAtlas = await registerAnimatedSpriteSheet('chicken_brown', chickenPath, {
    tags: ['animal', 'chicken'],
  });
  console.log(`  Registered atlas: ${chickenAtlas.id}`);
  console.log(`  Animations: ${Array.from(chickenAtlas.animations.keys()).join(', ')}`);

  console.log('\n--- Loading all Farmer_1 animations ---');
  const farmer1Animations = await loadCharacterAnimations(
    path.join(baseDir, 'Characters_32x32'),
    'Farmer_1'
  );
  console.log(`  Loaded ${farmer1Animations.size} animation atlases:`);
  for (const [id, atlas] of farmer1Animations) {
    const anims = Array.from(atlas.animations.keys());
    console.log(`    ${id}: ${anims.length} animations`);
  }

  console.log('\n--- Registry Summary ---');
  const catalog = SpriteRegistry.exportCatalog();
  console.log(`  Total atlases: ${catalog.atlases.length}`);
  console.log(`  Total frames: ${catalog.atlases.reduce((sum, a) => sum + a.frameCount, 0)}`);
  console.log(`  Tags: ${catalog.tags.join(', ')}`);
}

main().catch(console.error);
