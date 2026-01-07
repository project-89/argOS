import { discoverAssets, loadAllAssets, getAssetSummary } from '../rendering/asset-loader';
import * as path from 'path';

async function main() {
  const assetsDir = path.join(process.cwd(), 'public/32x32');
  
  console.log('=== Asset Discovery Test ===\n');
  
  const discovery = await discoverAssets(assetsDir);
  
  console.log(`Single Sprites: ${discovery.singleSprites.length}`);
  console.log(`Sprite Sheets: ${discovery.spriteSheets.length}`);
  console.log(`Tilemaps: ${discovery.tilemaps.length}`);
  
  console.log('\n--- Sample Single Sprites ---');
  for (const sprite of discovery.singleSprites.slice(0, 10)) {
    console.log(`  ${sprite.name}`);
    console.log(`    Category: ${sprite.category}`);
    console.log(`    Tags: ${sprite.tags.join(', ')}`);
  }
  
  console.log('\n--- Sample Sprite Sheets ---');
  for (const sheet of discovery.spriteSheets.slice(0, 10)) {
    console.log(`  ${sheet.name}`);
    console.log(`    Category: ${sheet.category}`);
    console.log(`    Animation: ${sheet.animationType || 'none'}`);
    console.log(`    Frames: ${sheet.frameCount || 'unknown'}`);
    console.log(`    Tags: ${sheet.tags.join(', ')}`);
  }

  console.log('\n--- Categories Found ---');
  const categories = new Set<string>();
  discovery.singleSprites.forEach(s => categories.add(s.category));
  discovery.spriteSheets.forEach(s => categories.add(s.category));
  for (const cat of Array.from(categories).sort()) {
    const singles = discovery.singleSprites.filter(s => s.category === cat).length;
    const sheets = discovery.spriteSheets.filter(s => s.category === cat).length;
    console.log(`  ${cat}: ${singles} singles, ${sheets} sheets`);
  }

  console.log('\n--- All Tags ---');
  const allTags = new Set<string>();
  discovery.singleSprites.forEach(s => s.tags.forEach(t => allTags.add(t)));
  discovery.spriteSheets.forEach(s => s.tags.forEach(t => allTags.add(t)));
  console.log(`  ${Array.from(allTags).sort().join(', ')}`);
}

main().catch(console.error);
