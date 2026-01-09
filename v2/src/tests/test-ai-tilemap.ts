/**
 * Test AI Tilemap Generation
 *
 * This script tests the AI-powered tileset analysis and tilemap generation.
 * Run with: npx tsx src/scripts/test-ai-tilemap.ts
 */

import "dotenv/config";
import * as path from "path";
import * as fs from "fs";
import {
  analyzeTileset,
  analyzeSprite,
  generateTilemap,
  generateSimpleTilemap,
  type TilesetAnalysis,
  type SpriteAnalysis,
} from "../rendering/ai-tilemap-generator";

const ASSETS_DIR = path.join(process.cwd(), "public/32x32");

async function testTilesetAnalysis() {
  console.log("\n" + "=".repeat(60));
  console.log("  TILESET ANALYSIS TEST");
  console.log("=".repeat(60) + "\n");

  const tilesetPath = path.join(ASSETS_DIR, "1_Terrains_32x32.png");
  console.log(`Analyzing tileset: ${tilesetPath}`);

  try {
    const analysis = await analyzeTileset(tilesetPath, 32, 32, {
      tilesetId: "terrain_32x32",
      hints: "This is a farm/nature themed tileset with grass, dirt, water, sand, and tilled soil tiles. It uses autotile format for transitions.",
    });

    console.log(`\n✅ Analysis complete!`);
    console.log(`   Tileset: ${analysis.tilesetId}`);
    console.log(`   Grid: ${analysis.columns}x${analysis.rows}`);
    console.log(`   Tiles found: ${analysis.tiles.length}`);

    console.log(`\n📦 Tiles by Category:`);
    for (const [category, tileIds] of Object.entries(analysis.categories)) {
      console.log(`   ${category}: ${tileIds.length} tiles`);
    }

    console.log(`\n🎨 Sample Tiles:`);
    for (const tile of analysis.tiles.slice(0, 10)) {
      console.log(`   - ${tile.id}: ${tile.description}`);
      console.log(`     Position: (${tile.gridPosition.col}, ${tile.gridPosition.row})`);
      console.log(`     Walkable: ${tile.walkable}, Tags: ${tile.tags.join(", ")}`);
    }

    // Save analysis to file
    const outputPath = path.join(process.cwd(), "tileset-analysis.json");
    fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
    console.log(`\n💾 Full analysis saved to: ${outputPath}`);

    return analysis;
  } catch (error) {
    console.error(`\n❌ Analysis failed:`, error);
    throw error;
  }
}

async function testSpriteAnalysis() {
  console.log("\n" + "=".repeat(60));
  console.log("  SPRITE ANALYSIS TEST");
  console.log("=".repeat(60) + "\n");

  const spritePath = path.join(ASSETS_DIR, "Characters_32x32/Farmer_1_32x32.png");
  console.log(`Analyzing sprite: ${spritePath}`);

  try {
    const analysis = await analyzeSprite(spritePath, {
      spriteId: "farmer_1",
      hints: "This is a farmer character sprite sheet with idle and walking animations in multiple directions. The sprite is likely 32x48 pixels (taller than wide).",
    });

    console.log(`\n✅ Analysis complete!`);
    console.log(`   Sprite: ${analysis.spriteId}`);
    console.log(`   Frame size: ${analysis.frameWidth}x${analysis.frameHeight}`);
    console.log(`   Grid: ${analysis.columns}x${analysis.rows}`);
    console.log(`   Character type: ${analysis.characterType || "unknown"}`);
    console.log(`   Description: ${analysis.description}`);

    console.log(`\n🎬 Animations:`);
    for (const anim of analysis.animations) {
      console.log(`   - ${anim.name}:`);
      console.log(`     Row ${anim.row}, cols ${anim.startCol}-${anim.startCol + anim.frameCount - 1}`);
      console.log(`     Frames: ${anim.frameCount}, Rate: ${anim.frameRate}fps, Loop: ${anim.loop}`);
    }

    // Save analysis to file
    const outputPath = path.join(process.cwd(), "sprite-analysis.json");
    fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
    console.log(`\n💾 Full analysis saved to: ${outputPath}`);

    return analysis;
  } catch (error) {
    console.error(`\n❌ Analysis failed:`, error);
    throw error;
  }
}

async function testTilemapGeneration(tilesetAnalysis: TilesetAnalysis) {
  console.log("\n" + "=".repeat(60));
  console.log("  TILEMAP GENERATION TEST");
  console.log("=".repeat(60) + "\n");

  // First try simple generation (no AI)
  console.log("Testing simple (template-based) generation...");
  const simpleFarm = generateSimpleTilemap(tilesetAnalysis, 20, 15, "farm");
  console.log(`✅ Simple farm map: ${simpleFarm.width}x${simpleFarm.height}`);
  console.log(`   Layers: ${simpleFarm.layers.length}`);
  console.log(`   Collisions: ${simpleFarm.collisionBoxes.length}`);
  console.log(`   Spawn points: ${simpleFarm.spawnPoints.length}`);

  // Now try AI generation
  console.log("\nTesting AI-powered generation...");
  try {
    const aiMap = await generateTilemap(
      "Create a small farm with a vegetable garden on the left, a pond with sandy beach in the upper right, and a dirt path running through the middle. Add some grass areas for animals to graze.",
      tilesetAnalysis,
      {
        width: 25,
        height: 18,
        theme: "farm",
        includeObjects: true,
        includeSpawnPoints: true,
      }
    );

    console.log(`✅ AI-generated map: ${aiMap.width}x${aiMap.height}`);
    console.log(`   Theme: ${aiMap.metadata.theme}`);
    console.log(`   Layers: ${aiMap.layers.length}`);
    for (const layer of aiMap.layers) {
      console.log(`     - ${layer.name}: ${layer.data.length} rows`);
    }
    console.log(`   Collisions: ${aiMap.collisionBoxes.length}`);
    console.log(`   Objects: ${aiMap.objects.length}`);
    console.log(`   Spawn points: ${aiMap.spawnPoints.length}`);

    // Save generated map
    const outputPath = path.join(process.cwd(), "generated-tilemap.json");
    fs.writeFileSync(outputPath, JSON.stringify(aiMap, null, 2));
    console.log(`\n💾 Generated map saved to: ${outputPath}`);

    return aiMap;
  } catch (error) {
    console.error(`\n❌ AI generation failed:`, error);
    console.log("Falling back to simple generation...");
    return simpleFarm;
  }
}

async function main() {
  console.log("\n🚀 AI Tilemap Generator Test Suite\n");

  // Test 1: Tileset Analysis
  const tilesetAnalysis = await testTilesetAnalysis();

  // Test 2: Sprite Analysis
  await testSpriteAnalysis();

  // Test 3: Tilemap Generation
  if (tilesetAnalysis) {
    await testTilemapGeneration(tilesetAnalysis);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  ALL TESTS COMPLETE");
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
