/**
 * Analyze Farmer_2 spritesheet and create animation metadata
 * Uses Gemini vision to identify animation types and directions
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const SPRITE_PATH = "public/32x32/Characters_32x32/Farmer_2_32x32.png";
const OUTPUT_DIR = "public/extracted-sprites/farmer_2_analyzed";
const FRAME_W = 32;
const FRAME_H = 64;

// Known row pairs with content (from our analysis)
const ROW_PAIRS = [
  { startRow: 2, endCol: 10 },
  { startRow: 6, endCol: 70 },
  { startRow: 10, endCol: 70 },
  { startRow: 14, endCol: 106 },
  { startRow: 18, endCol: 70 },
  { startRow: 22, endCol: 107 },
  { startRow: 26, endCol: 70 },
  { startRow: 30, endCol: 167 },
  { startRow: 34, endCol: 70 },
  { startRow: 38, endCol: 119 },
  { startRow: 42, endCol: 70 },
];

const AnimationSchema = z.object({
  direction: z.enum(["down", "up", "left", "right"]),
  animationType: z.enum(["idle", "walk", "run", "action", "other"]),
  description: z.string(),
});

async function extractRowPreview(startRow: number, endCol: number): Promise<Buffer> {
  // Extract first 16 frames as a preview strip
  const previewWidth = Math.min(16, endCol) * FRAME_W;

  return sharp(SPRITE_PATH)
    .extract({
      left: FRAME_W, // Skip first empty column
      top: startRow * 32, // Row in 32-pixel units
      width: previewWidth,
      height: FRAME_H,
    })
    .png()
    .toBuffer();
}

async function analyzeRowWithAI(imageBuffer: Buffer, rowIndex: number) {
  const base64Image = imageBuffer.toString("base64");

  const model = google("gemini-2.0-flash");

  try {
    const result = await generateObject({
      model,
      schema: AnimationSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: base64Image,
            },
            {
              type: "text",
              text: `This is a strip of animation frames from a game spritesheet showing a farmer character.

Analyze the frames and determine:
1. What direction is the character facing? (down=facing camera, up=back view, left=facing left, right=facing right)
2. What type of animation is this? (idle=standing still, walk=walking, run=running, action=doing something like farming)
3. Brief description of what the character is doing.

Row index: ${rowIndex}`,
            },
          ],
        },
      ],
    });

    return result.object;
  } catch (error) {
    console.error(`Error analyzing row ${rowIndex}:`, error);
    return null;
  }
}

async function main() {
  console.log("Analyzing Farmer_2 spritesheet...\n");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const animationMap: Record<number, any> = {};

  for (const rowPair of ROW_PAIRS) {
    console.log(`\nAnalyzing row pair starting at ${rowPair.startRow}...`);

    // Extract preview
    const preview = await extractRowPreview(rowPair.startRow, rowPair.endCol);

    // Save preview for reference
    const previewPath = path.join(OUTPUT_DIR, `row_${rowPair.startRow}_preview.png`);
    await sharp(preview).toFile(previewPath);

    // Analyze with AI
    const analysis = await analyzeRowWithAI(preview, rowPair.startRow);

    if (analysis) {
      animationMap[rowPair.startRow] = {
        ...analysis,
        frameCount: rowPair.endCol,
        startCol: 1,
      };
      console.log(`  Direction: ${analysis.direction}`);
      console.log(`  Type: ${analysis.animationType}`);
      console.log(`  Description: ${analysis.description}`);
    }
  }

  // Save animation map
  const mapPath = path.join(OUTPUT_DIR, "animation_map.json");
  fs.writeFileSync(mapPath, JSON.stringify(animationMap, null, 2));
  console.log(`\nAnimation map saved to ${mapPath}`);

  // Generate a summary organized by animation type and direction
  const organized: Record<string, Record<string, any[]>> = {
    idle: { down: [], up: [], left: [], right: [] },
    walk: { down: [], up: [], left: [], right: [] },
    run: { down: [], up: [], left: [], right: [] },
    action: { down: [], up: [], left: [], right: [] },
  };

  for (const [row, data] of Object.entries(animationMap)) {
    if (data && organized[data.animationType]) {
      organized[data.animationType][data.direction].push({
        row: parseInt(row),
        frameCount: data.frameCount,
      });
    }
  }

  console.log("\n=== ORGANIZED ANIMATION MAP ===");
  for (const [type, directions] of Object.entries(organized)) {
    console.log(`\n${type.toUpperCase()}:`);
    for (const [dir, rows] of Object.entries(directions)) {
      if (rows.length > 0) {
        console.log(`  ${dir}: rows ${rows.map(r => r.row).join(", ")}`);
      }
    }
  }
}

main().catch(console.error);
