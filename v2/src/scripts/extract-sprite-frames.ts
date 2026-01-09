/**
 * Extract Sprite Frames for Visual Inspection
 *
 * This script extracts individual frames from spritesheets and saves them
 * as PNGs so we can visually verify the correct frame sizes and animations.
 *
 * Run with: npx tsx src/scripts/extract-sprite-frames.ts
 */

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

const ASSETS_DIR = path.join(process.cwd(), "public/32x32");
const OUTPUT_DIR = path.join(process.cwd(), "public/extracted-sprites");

interface SpriteSheetConfig {
  name: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  expectedCols?: number;
  expectedRows?: number;
}

const SPRITES_TO_EXTRACT: SpriteSheetConfig[] = [
  {
    name: "farmer_2",
    path: "Characters_32x32/Farmer_2_32x32.png",
    frameWidth: 32,
    frameHeight: 64, // Full multi-directional spritesheet
  },
  {
    name: "farmer_1",
    path: "Characters_32x32/Farmer_1_32x32.png",
    frameWidth: 32,
    frameHeight: 64,
  },
  {
    name: "chicken_brown",
    path: "Animals_32x32/Chickens_and_Roosters_32x32/Chicken_Brown_32x32.png",
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    name: "cow",
    path: "Animals_32x32/Cows_32x32/Cow_32x32.png",
    frameWidth: 64,  // Cows are 64x64
    frameHeight: 64,
  },
  {
    name: "terrain",
    path: "1_Terrains_32x32.png",
    frameWidth: 32,
    frameHeight: 32,
  },
];

async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(imagePath).metadata();
  return { width: metadata.width || 0, height: metadata.height || 0 };
}

async function extractFrames(config: SpriteSheetConfig): Promise<void> {
  const inputPath = path.join(ASSETS_DIR, config.path);
  const outputSubdir = path.join(OUTPUT_DIR, config.name);

  // Create output directory
  if (!fs.existsSync(outputSubdir)) {
    fs.mkdirSync(outputSubdir, { recursive: true });
  }

  // Get image dimensions
  const { width, height } = await getImageDimensions(inputPath);
  const cols = Math.floor(width / config.frameWidth);
  const rows = Math.floor(height / config.frameHeight);

  console.log(`\n📦 ${config.name}:`);
  console.log(`   Input: ${config.path}`);
  console.log(`   Image size: ${width}x${height}`);
  console.log(`   Frame size: ${config.frameWidth}x${config.frameHeight}`);
  console.log(`   Grid: ${cols} cols x ${rows} rows = ${cols * rows} frames`);

  // Extract each frame
  let frameCount = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * config.frameWidth;
      const y = row * config.frameHeight;

      const outputPath = path.join(outputSubdir, `frame_r${row}_c${col}.png`);

      await sharp(inputPath)
        .extract({
          left: x,
          top: y,
          width: config.frameWidth,
          height: config.frameHeight,
        })
        .toFile(outputPath);

      frameCount++;
    }
  }

  console.log(`   Extracted ${frameCount} frames to ${outputSubdir}`);

  // Create a contact sheet (all frames in one image for easy viewing)
  await createContactSheet(config, inputPath, outputSubdir, cols, rows);
}

async function createContactSheet(
  config: SpriteSheetConfig,
  inputPath: string,
  outputSubdir: string,
  cols: number,
  rows: number
): Promise<void> {
  // Create a labeled contact sheet with frame numbers
  const frameWidth = config.frameWidth;
  const frameHeight = config.frameHeight;
  const padding = 4;
  const labelHeight = 16;

  const sheetWidth = cols * (frameWidth + padding) + padding;
  const sheetHeight = rows * (frameHeight + labelHeight + padding) + padding;

  // Create composites for each frame
  const composites: sharp.OverlayOptions[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const framePath = path.join(outputSubdir, `frame_r${row}_c${col}.png`);
      const x = col * (frameWidth + padding) + padding;
      const y = row * (frameHeight + labelHeight + padding) + padding + labelHeight;

      composites.push({
        input: framePath,
        left: x,
        top: y,
      });
    }
  }

  // Create the contact sheet
  const contactSheetPath = path.join(outputSubdir, "_contact_sheet.png");

  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 40, g: 40, b: 60, alpha: 255 },
    },
  })
    .composite(composites)
    .toFile(contactSheetPath);

  console.log(`   Created contact sheet: ${contactSheetPath}`);
}

async function analyzeSpritesheetVisually(config: SpriteSheetConfig): Promise<void> {
  const inputPath = path.join(ASSETS_DIR, config.path);
  const { width, height } = await getImageDimensions(inputPath);

  console.log(`\n🔍 Analyzing ${config.name} for best frame size:`);
  console.log(`   Total image: ${width}x${height}`);

  // Test different common frame sizes
  const testSizes = [
    { w: 16, h: 16 },
    { w: 16, h: 24 },
    { w: 32, h: 32 },
    { w: 32, h: 48 },
    { w: 32, h: 64 },
    { w: 48, h: 48 },
    { w: 64, h: 64 },
  ];

  for (const size of testSizes) {
    const cols = width / size.w;
    const rows = height / size.h;
    const isExact = Number.isInteger(cols) && Number.isInteger(rows);

    if (isExact) {
      console.log(`   ✅ ${size.w}x${size.h} -> ${cols}x${rows} grid (${cols * rows} frames)`);
    }
  }
}

async function main() {
  console.log("🎨 Sprite Frame Extractor\n");
  console.log("=".repeat(50));

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // First, analyze each spritesheet to find valid frame sizes
  console.log("\n📊 ANALYZING SPRITESHEETS FOR VALID FRAME SIZES:");
  for (const config of SPRITES_TO_EXTRACT) {
    await analyzeSpritesheetVisually(config);
  }

  // Then extract frames
  console.log("\n" + "=".repeat(50));
  console.log("📦 EXTRACTING FRAMES:");

  for (const config of SPRITES_TO_EXTRACT) {
    try {
      await extractFrames(config);
    } catch (error) {
      console.error(`   ❌ Error extracting ${config.name}:`, error);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Done! Check public/extracted-sprites/ for results");
  console.log("=".repeat(50));
}

main().catch(console.error);
