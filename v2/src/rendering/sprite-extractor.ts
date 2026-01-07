import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { SpriteRegistry, type SpriteAtlas, type SpriteFrame } from './sprite-registry';

export interface ExtractedSprite {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

export interface ExtractionResult {
  imagePath: string;
  width: number;
  height: number;
  sprites: ExtractedSprite[];
  gridBased: boolean;
  detectedTileSize?: { width: number; height: number };
}

export interface LabeledSprite extends ExtractedSprite {
  name: string;
  tags: string[];
  description: string;
}

export interface SpriteSheetManifest {
  id: string;
  imagePath: string;
  sprites: LabeledSprite[];
  animations: Array<{
    id: string;
    frames: string[];
    frameRate: number;
    loop: boolean;
  }>;
  tags: string[];
  description: string;
}

async function getImageData(imagePath: string): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

function isTransparent(data: Buffer, index: number, channels: number): boolean {
  if (channels === 4) {
    return data[index + 3] === 0;
  }
  return false;
}

function floodFill(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  startX: number,
  startY: number,
  visited: Set<number>
): { minX: number; minY: number; maxX: number; maxY: number; pixels: number } {
  const stack: [number, number][] = [[startX, startY]];
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let pixels = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = y * width + x;

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (visited.has(key)) continue;

    const index = key * channels;
    if (isTransparent(data, index, channels)) continue;

    visited.add(key);
    pixels++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return { minX, minY, maxX, maxY, pixels };
}

export async function extractSpritesConnectedComponents(imagePath: string): Promise<ExtractionResult> {
  const { data, width, height, channels } = await getImageData(imagePath);
  
  if (channels !== 4) {
    console.warn('Image does not have alpha channel, connected components may not work well');
  }

  const visited = new Set<number>();
  const sprites: ExtractedSprite[] = [];
  let spriteIndex = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = y * width + x;
      if (visited.has(key)) continue;

      const index = key * channels;
      if (isTransparent(data, index, channels)) {
        visited.add(key);
        continue;
      }

      const bounds = floodFill(data, width, height, channels, x, y, visited);
      
      if (bounds.pixels > 4) {
        sprites.push({
          id: `sprite_${spriteIndex++}`,
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.maxX - bounds.minX + 1,
          height: bounds.maxY - bounds.minY + 1,
          pixels: bounds.pixels,
        });
      }
    }
  }

  sprites.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 8) return a.y - b.y;
    return a.x - b.x;
  });

  return {
    imagePath,
    width,
    height,
    sprites,
    gridBased: false,
  };
}

export async function extractSpritesGrid(
  imagePath: string,
  tileWidth: number,
  tileHeight: number
): Promise<ExtractionResult> {
  const { width, height } = await getImageData(imagePath);
  
  const columns = Math.floor(width / tileWidth);
  const rows = Math.floor(height / tileHeight);
  const sprites: ExtractedSprite[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      sprites.push({
        id: `tile_${row}_${col}`,
        x: col * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
        pixels: tileWidth * tileHeight,
      });
    }
  }

  return {
    imagePath,
    width,
    height,
    sprites,
    gridBased: true,
    detectedTileSize: { width: tileWidth, height: tileHeight },
  };
}

export async function detectGridSize(imagePath: string): Promise<{ width: number; height: number } | null> {
  const { data, width, height, channels } = await getImageData(imagePath);
  
  const commonSizes = [8, 16, 24, 32, 48, 64];
  const scores: Map<number, number> = new Map();

  for (const size of commonSizes) {
    let emptyLineCount = 0;
    
    for (let y = size; y < height; y += size) {
      let isEmpty = true;
      for (let x = 0; x < width && isEmpty; x++) {
        const index = (y * width + x) * channels;
        if (!isTransparent(data, index, channels)) {
          isEmpty = false;
        }
      }
      if (isEmpty) emptyLineCount++;
    }

    for (let x = size; x < width; x += size) {
      let isEmpty = true;
      for (let y = 0; y < height && isEmpty; y++) {
        const index = (y * width + x) * channels;
        if (!isTransparent(data, index, channels)) {
          isEmpty = false;
        }
      }
      if (isEmpty) emptyLineCount++;
    }

    scores.set(size, emptyLineCount);
  }

  let bestSize = 16;
  let bestScore = 0;
  for (const [size, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestSize = size;
    }
  }

  if (bestScore < 2) return null;
  
  return { width: bestSize, height: bestSize };
}

export async function extractSpritesAuto(imagePath: string): Promise<ExtractionResult> {
  const gridSize = await detectGridSize(imagePath);
  
  if (gridSize) {
    console.log(`Detected grid-based spritesheet: ${gridSize.width}x${gridSize.height}`);
    return extractSpritesGrid(imagePath, gridSize.width, gridSize.height);
  }
  
  console.log('No grid detected, using connected components');
  return extractSpritesConnectedComponents(imagePath);
}

export async function extractSpriteImages(
  imagePath: string,
  sprites: ExtractedSprite[],
  outputDir: string
): Promise<Map<string, string>> {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const paths = new Map<string, string>();

  for (const sprite of sprites) {
    const outputPath = path.join(outputDir, `${sprite.id}.png`);
    await sharp(imagePath)
      .extract({
        left: sprite.x,
        top: sprite.y,
        width: sprite.width,
        height: sprite.height,
      })
      .toFile(outputPath);
    paths.set(sprite.id, outputPath);
  }

  return paths;
}

export async function createContactSheet(
  sprites: Array<{ path: string; label: string }>,
  outputPath: string,
  columns: number = 8
): Promise<void> {
  if (sprites.length === 0) return;

  const firstImage = await sharp(sprites[0].path).metadata();
  const tileWidth = firstImage.width || 32;
  const tileHeight = firstImage.height || 32;
  const labelHeight = 20;
  
  const rows = Math.ceil(sprites.length / columns);
  const width = columns * tileWidth;
  const height = rows * (tileHeight + labelHeight);

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < sprites.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * tileWidth;
    const y = row * (tileHeight + labelHeight);

    composites.push({
      input: sprites[i].path,
      left: x,
      top: y,
    });
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 40, g: 40, b: 40, alpha: 1 },
    },
  })
    .composite(composites)
    .toFile(outputPath);
}

export function createAtlasFromExtraction(
  atlasId: string,
  imagePath: string,
  sprites: LabeledSprite[],
  options: { tags?: string[]; description?: string } = {}
): SpriteAtlas {
  const frames = new Map<string, SpriteFrame>();
  
  for (const sprite of sprites) {
    frames.set(sprite.name, {
      x: sprite.x,
      y: sprite.y,
      width: sprite.width,
      height: sprite.height,
      anchorX: 0.5,
      anchorY: 0.5,
    });
  }

  let tileWidth = 16, tileHeight = 16;
  if (sprites.length > 0) {
    tileWidth = sprites[0].width;
    tileHeight = sprites[0].height;
  }

  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath,
    tileWidth,
    tileHeight,
    columns: 0,
    rows: 0,
    frames,
    animations: new Map(),
    tags: options.tags ?? [],
    description: options.description ?? '',
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export function saveManifest(manifest: SpriteSheetManifest, outputPath: string): void {
  const serializable = {
    ...manifest,
    sprites: manifest.sprites,
    animations: manifest.animations,
  };
  fs.writeFileSync(outputPath, JSON.stringify(serializable, null, 2));
}

export function loadManifest(manifestPath: string): SpriteSheetManifest {
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return data as SpriteSheetManifest;
}

export function registerManifestAsAtlas(manifest: SpriteSheetManifest): SpriteAtlas {
  const atlas = createAtlasFromExtraction(
    manifest.id,
    manifest.imagePath,
    manifest.sprites,
    { tags: manifest.tags, description: manifest.description }
  );

  for (const anim of manifest.animations) {
    SpriteRegistry.addAnimation(manifest.id, anim.id, anim.frames, anim.frameRate, anim.loop);
  }

  return atlas;
}

export interface AILabelingPrompt {
  imagePath: string;
  spriteImages: Array<{ id: string; path: string }>;
  context?: string;
}

export function generateAILabelingPrompt(prompt: AILabelingPrompt): string {
  return `You are analyzing a sprite sheet that has been automatically segmented into individual sprites.
The original image is: ${prompt.imagePath}

${prompt.context ? `Context: ${prompt.context}\n` : ''}

For each sprite, provide a JSON response with:
1. A semantic name (snake_case, descriptive)
2. Relevant tags (e.g., "character", "item", "terrain", "animation_frame")
3. A brief description

Sprites to label (${prompt.spriteImages.length} total):
${prompt.spriteImages.map((s, i) => `${i + 1}. ID: ${s.id}`).join('\n')}

Respond with a JSON array:
[
  {
    "id": "sprite_0",
    "name": "player_idle_front",
    "tags": ["character", "player", "idle"],
    "description": "Player character facing forward in idle pose"
  },
  ...
]

If sprites appear to be animation frames, also suggest animations:
{
  "sprites": [...],
  "animations": [
    {
      "id": "player_walk_right",
      "frames": ["player_walk_right_1", "player_walk_right_2", "player_walk_right_3"],
      "frameRate": 8,
      "loop": true
    }
  ]
}`;
}

export async function applyAILabels(
  extraction: ExtractionResult,
  labels: Array<{ id: string; name: string; tags: string[]; description: string }>,
  animations?: Array<{ id: string; frames: string[]; frameRate: number; loop: boolean }>
): Promise<SpriteSheetManifest> {
  const labelMap = new Map(labels.map(l => [l.id, l]));
  
  const labeledSprites: LabeledSprite[] = extraction.sprites.map(sprite => {
    const label = labelMap.get(sprite.id);
    return {
      ...sprite,
      name: label?.name ?? sprite.id,
      tags: label?.tags ?? [],
      description: label?.description ?? '',
    };
  });

  return {
    id: path.basename(extraction.imagePath, path.extname(extraction.imagePath)),
    imagePath: extraction.imagePath,
    sprites: labeledSprites,
    animations: animations ?? [],
    tags: [...new Set(labeledSprites.flatMap(s => s.tags))],
    description: `Extracted from ${extraction.imagePath}`,
  };
}
