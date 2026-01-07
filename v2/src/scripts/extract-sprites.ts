import * as fs from 'fs';
import * as path from 'path';
import {
  extractSpritesAuto,
  extractSpritesGrid,
  extractSpritesConnectedComponents,
  extractSpriteImages,
  saveManifest,
  applyAILabels,
  generateAILabelingPrompt,
  type ExtractionResult,
  type SpriteSheetManifest,
} from '../rendering/sprite-extractor';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log(`
Usage: npx tsx src/scripts/extract-sprites.ts <image-path> [options]

Options:
  --mode=auto|grid|connected   Extraction mode (default: auto)
  --tile-size=WxH              Tile size for grid mode (e.g., 16x16, 32x32)
  --output-dir=<dir>           Output directory for extracted sprites
  --output-manifest=<file>     Output manifest JSON file
  --extract-images             Extract individual sprite images
  --generate-prompt            Generate AI labeling prompt

Examples:
  npx tsx src/scripts/extract-sprites.ts assets/characters.png --mode=auto
  npx tsx src/scripts/extract-sprites.ts assets/tiles.png --mode=grid --tile-size=16x16
  npx tsx src/scripts/extract-sprites.ts assets/items.png --extract-images --output-dir=./sprites
`);
    process.exit(1);
  }

  const imagePath = args[0];
  
  if (!fs.existsSync(imagePath)) {
    console.error(`Error: File not found: ${imagePath}`);
    process.exit(1);
  }

  const options: {
    mode: 'auto' | 'grid' | 'connected';
    tileWidth?: number;
    tileHeight?: number;
    outputDir?: string;
    outputManifest?: string;
    extractImages: boolean;
    generatePrompt: boolean;
  } = {
    mode: 'auto',
    extractImages: false,
    generatePrompt: false,
  };

  for (const arg of args.slice(1)) {
    if (arg.startsWith('--mode=')) {
      options.mode = arg.split('=')[1] as 'auto' | 'grid' | 'connected';
    } else if (arg.startsWith('--tile-size=')) {
      const [w, h] = arg.split('=')[1].split('x').map(Number);
      options.tileWidth = w;
      options.tileHeight = h || w;
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.split('=')[1];
    } else if (arg.startsWith('--output-manifest=')) {
      options.outputManifest = arg.split('=')[1];
    } else if (arg === '--extract-images') {
      options.extractImages = true;
    } else if (arg === '--generate-prompt') {
      options.generatePrompt = true;
    }
  }

  console.log(`Processing: ${imagePath}`);
  console.log(`Mode: ${options.mode}`);

  let result: ExtractionResult;

  try {
    switch (options.mode) {
      case 'grid':
        if (!options.tileWidth || !options.tileHeight) {
          console.error('Error: --tile-size required for grid mode');
          process.exit(1);
        }
        result = await extractSpritesGrid(imagePath, options.tileWidth, options.tileHeight);
        break;
      case 'connected':
        result = await extractSpritesConnectedComponents(imagePath);
        break;
      case 'auto':
      default:
        result = await extractSpritesAuto(imagePath);
        break;
    }

    console.log(`\nExtraction Results:`);
    console.log(`  Image size: ${result.width}x${result.height}`);
    console.log(`  Sprites found: ${result.sprites.length}`);
    console.log(`  Grid-based: ${result.gridBased}`);
    if (result.detectedTileSize) {
      console.log(`  Detected tile size: ${result.detectedTileSize.width}x${result.detectedTileSize.height}`);
    }

    console.log(`\nSprites:`);
    for (const sprite of result.sprites.slice(0, 20)) {
      console.log(`  ${sprite.id}: ${sprite.x},${sprite.y} ${sprite.width}x${sprite.height} (${sprite.pixels}px)`);
    }
    if (result.sprites.length > 20) {
      console.log(`  ... and ${result.sprites.length - 20} more`);
    }

    if (options.extractImages) {
      const outputDir = options.outputDir || path.join(path.dirname(imagePath), 'extracted');
      console.log(`\nExtracting images to: ${outputDir}`);
      const paths = await extractSpriteImages(imagePath, result.sprites, outputDir);
      console.log(`Extracted ${paths.size} images`);
    }

    if (options.generatePrompt) {
      console.log(`\n--- AI Labeling Prompt ---\n`);
      const prompt = generateAILabelingPrompt({
        imagePath,
        spriteImages: result.sprites.map(s => ({ id: s.id, path: `${s.id}.png` })),
        context: 'This is a sprite sheet for a 2D game.',
      });
      console.log(prompt);
      console.log(`\n--- End Prompt ---\n`);
    }

    if (options.outputManifest) {
      const defaultLabels = result.sprites.map(s => ({
        id: s.id,
        name: s.id,
        tags: [],
        description: '',
      }));
      const manifest = await applyAILabels(result, defaultLabels);
      saveManifest(manifest, options.outputManifest);
      console.log(`\nManifest saved to: ${options.outputManifest}`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
