import * as fs from 'fs';
import * as path from 'path';
import { SpriteRegistry, type SpriteAtlas, type SpriteFrame } from './sprite-registry';

export interface AssetDiscoveryResult {
  singleSprites: Array<{
    name: string;
    path: string;
    category: string;
    tags: string[];
  }>;
  spriteSheets: Array<{
    name: string;
    path: string;
    category: string;
    frameCount?: number;
    animationType?: string;
    tags: string[];
  }>;
  tilemaps: Array<{
    name: string;
    path: string;
    tileSize: number;
  }>;
}

function parseSpriteName(filename: string): {
  baseName: string;
  tags: string[];
  animationType?: string;
  frameCount?: number;
} {
  const name = filename.replace(/_32x32\.png$/i, '').replace(/\.png$/i, '');
  const tags: string[] = [];
  let animationType: string | undefined;
  let frameCount: number | undefined;

  const frameMatch = name.match(/_(\d+)_frames?/i);
  if (frameMatch) {
    frameCount = parseInt(frameMatch[1], 10);
  }

  const animTypes = ['walk', 'idle', 'chop', 'chopping', 'dig', 'fishing', 'watering', 'harvesting', 'growth', 'animation'];
  for (const anim of animTypes) {
    if (name.toLowerCase().includes(anim)) {
      animationType = anim.replace('chopping', 'chop').replace('growth', 'grow');
      tags.push('animated');
      break;
    }
  }

  const categories = [
    'pickup', 'crop', 'terrain', 'fence', 'prop', 'building', 'tree', 'fruit',
    'farmer', 'body', 'chicken', 'rooster', 'cow', 'pig', 'sheep', 'goat',
    'dog', 'duck', 'rabbit', 'donkey', 'chick', 'vehicle', 'basket'
  ];
  
  for (const cat of categories) {
    if (name.toLowerCase().includes(cat)) {
      tags.push(cat);
    }
  }

  if (name.toLowerCase().includes('rare')) tags.push('rare');
  if (name.toLowerCase().includes('modular')) tags.push('modular');
  if (name.toLowerCase().includes('small')) tags.push('small');
  if (name.toLowerCase().includes('medium')) tags.push('medium');
  if (name.toLowerCase().includes('big') || name.toLowerCase().includes('large')) tags.push('large');
  if (name.toLowerCase().includes('huge')) tags.push('huge');

  return {
    baseName: name.replace(/_\d+_frames?/i, '').replace(/_animation/i, ''),
    tags,
    animationType,
    frameCount,
  };
}

export async function discoverAssets(baseDir: string): Promise<AssetDiscoveryResult> {
  const result: AssetDiscoveryResult = {
    singleSprites: [],
    spriteSheets: [],
    tilemaps: [],
  };

  async function scanDirectory(dir: string, category: string = ''): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subCategory = entry.name.replace(/_32x32$/i, '').replace(/_/g, ' ');
        await scanDirectory(fullPath, subCategory);
        continue;
      }

      if (!entry.name.endsWith('.png')) continue;
      if (entry.name.startsWith('.')) continue;

      const parsed = parseSpriteName(entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (parsed.frameCount || parsed.animationType) {
        result.spriteSheets.push({
          name: parsed.baseName,
          path: relativePath,
          category,
          frameCount: parsed.frameCount,
          animationType: parsed.animationType,
          tags: [...parsed.tags, category.toLowerCase()].filter(Boolean),
        });
      } else if (entry.name.includes('Tileset') || entry.name.includes('Terrain')) {
        result.tilemaps.push({
          name: parsed.baseName,
          path: relativePath,
          tileSize: 32,
        });
      } else {
        result.singleSprites.push({
          name: parsed.baseName,
          path: relativePath,
          category,
          tags: [...parsed.tags, category.toLowerCase()].filter(Boolean),
        });
      }
    }
  }

  await scanDirectory(baseDir);
  return result;
}

export function registerSingleSpritesAsAtlas(
  atlasId: string,
  baseDir: string,
  sprites: AssetDiscoveryResult['singleSprites']
): SpriteAtlas {
  const frames = new Map<string, SpriteFrame>();
  const allTags = new Set<string>();

  for (const sprite of sprites) {
    const frameId = sprite.name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    
    frames.set(frameId, {
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      anchorX: 0.5,
      anchorY: 0.5,
    });

    sprite.tags.forEach(t => allTags.add(t));
  }

  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath: baseDir,
    tileWidth: 32,
    tileHeight: 32,
    columns: 0,
    rows: 0,
    frames,
    animations: new Map(),
    tags: Array.from(allTags),
    description: `Auto-discovered single sprites from ${baseDir}`,
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export interface CharacterAnimationConfig {
  directions: number;
  framesPerDirection: number;
  frameRate: number;
  loop: boolean;
}

const STANDARD_ANIMATIONS: Record<string, CharacterAnimationConfig> = {
  walk: { directions: 4, framesPerDirection: 4, frameRate: 8, loop: true },
  idle: { directions: 4, framesPerDirection: 1, frameRate: 1, loop: false },
  chop: { directions: 4, framesPerDirection: 10, frameRate: 10, loop: false },
  dig: { directions: 4, framesPerDirection: 9, frameRate: 10, loop: false },
  fish: { directions: 4, framesPerDirection: 32, frameRate: 8, loop: false },
  water: { directions: 4, framesPerDirection: 14, frameRate: 10, loop: false },
  harvest: { directions: 4, framesPerDirection: 9, frameRate: 10, loop: false },
};

export async function registerCharacterSpriteSheet(
  atlasId: string,
  imagePath: string,
  options: {
    tileWidth?: number;
    tileHeight?: number;
    animations?: Record<string, CharacterAnimationConfig>;
    tags?: string[];
  } = {}
): Promise<SpriteAtlas> {
  const tileWidth = options.tileWidth || 32;
  const tileHeight = options.tileHeight || 32;
  
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(imagePath).metadata();
  const imgWidth = metadata.width || 0;
  const imgHeight = metadata.height || 0;
  
  const columns = Math.floor(imgWidth / tileWidth);
  const rows = Math.floor(imgHeight / tileHeight);

  const frames = new Map<string, SpriteFrame>();
  const animations = new Map();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const frameId = `frame_${row}_${col}`;
      frames.set(frameId, {
        x: col * tileWidth,
        y: row * tileHeight,
        width: tileWidth,
        height: tileHeight,
        anchorX: 0.5,
        anchorY: 1.0,
      });
    }
  }

  const directions = ['down', 'left', 'right', 'up'];
  if (rows >= 4 && columns >= 4) {
    for (let d = 0; d < 4; d++) {
      const animFrames: string[] = [];
      for (let f = 0; f < Math.min(columns, 4); f++) {
        animFrames.push(`frame_${d}_${f}`);
      }
      animations.set(`walk_${directions[d]}`, {
        frames: animFrames,
        frameRate: 8,
        loop: true,
      });
    }
  }

  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath,
    tileWidth,
    tileHeight,
    columns,
    rows,
    frames,
    animations,
    tags: options.tags || ['character'],
    description: `Character sprite sheet: ${path.basename(imagePath)}`,
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export async function registerAnimalSpriteSheet(
  atlasId: string,
  imagePath: string,
  options: {
    tileWidth?: number;
    tileHeight?: number;
    tags?: string[];
  } = {}
): Promise<SpriteAtlas> {
  return registerCharacterSpriteSheet(atlasId, imagePath, {
    ...options,
    tags: [...(options.tags || []), 'animal'],
  });
}

export async function registerGrowthStages(
  atlasId: string,
  imagePath: string,
  cropName: string
): Promise<SpriteAtlas> {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(imagePath).metadata();
  const imgWidth = metadata.width || 0;
  
  const tileWidth = 32;
  const tileHeight = 32;
  const stages = Math.floor(imgWidth / tileWidth);

  const frames = new Map<string, SpriteFrame>();

  for (let stage = 0; stage < stages; stage++) {
    frames.set(`${cropName}_stage_${stage}`, {
      x: stage * tileWidth,
      y: 0,
      width: tileWidth,
      height: tileHeight,
      anchorX: 0.5,
      anchorY: 1.0,
    });
  }

  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath,
    tileWidth,
    tileHeight,
    columns: stages,
    rows: 1,
    frames,
    animations: new Map([
      [`${cropName}_grow`, {
        frames: Array.from({ length: stages }, (_, i) => `${cropName}_stage_${i}`),
        frameRate: 0.5,
        loop: false,
      }],
    ]),
    tags: ['crop', 'growth', cropName],
    description: `Growth stages for ${cropName}`,
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export async function loadAllAssets(baseDir: string): Promise<{
  discovery: AssetDiscoveryResult;
  atlases: SpriteAtlas[];
}> {
  console.log(`Discovering assets in: ${baseDir}`);
  const discovery = await discoverAssets(baseDir);
  const atlases: SpriteAtlas[] = [];

  console.log(`Found ${discovery.singleSprites.length} single sprites`);
  console.log(`Found ${discovery.spriteSheets.length} sprite sheets`);
  console.log(`Found ${discovery.tilemaps.length} tilemaps`);

  const categories = new Map<string, typeof discovery.singleSprites>();
  for (const sprite of discovery.singleSprites) {
    const cat = sprite.category || 'misc';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(sprite);
  }

  for (const [category, sprites] of categories) {
    const atlasId = `singles_${category.toLowerCase().replace(/\s+/g, '_')}`;
    const atlas = registerSingleSpritesAsAtlas(atlasId, baseDir, sprites);
    atlases.push(atlas);
    console.log(`  Registered atlas: ${atlasId} with ${sprites.length} sprites`);
  }

  return { discovery, atlases };
}

export function getAssetSummary(): {
  totalSprites: number;
  atlases: Array<{ id: string; frameCount: number; tags: string[] }>;
  tags: string[];
} {
  const catalog = SpriteRegistry.exportCatalog();
  return {
    totalSprites: catalog.atlases.reduce((sum, a) => sum + a.frameCount, 0),
    atlases: catalog.atlases.map(a => ({
      id: a.id,
      frameCount: a.frameCount,
      tags: a.tags,
    })),
    tags: catalog.tags,
  };
}
