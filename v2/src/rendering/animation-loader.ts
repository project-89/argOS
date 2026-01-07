import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { SpriteRegistry, type SpriteAtlas, type SpriteFrame, type SpriteAnimation } from './sprite-registry';

export type Direction = 'down' | 'left' | 'right' | 'up';
export const DIRECTIONS: Direction[] = ['down', 'left', 'right', 'up'];

export interface AnimationLayout {
  type: 'standard' | 'horizontal' | 'vertical' | 'action';
  directions: number;
  framesPerDirection: number;
  rowsPerDirection: number;
  frameRate: number;
  loop: boolean;
}

export interface DetectedLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  totalFrames: number;
  layout: AnimationLayout;
}

const KNOWN_LAYOUTS: Record<string, Partial<AnimationLayout>> = {
  walk: { type: 'standard', directions: 4, framesPerDirection: 6, rowsPerDirection: 1, frameRate: 8, loop: true },
  idle: { type: 'standard', directions: 4, framesPerDirection: 1, rowsPerDirection: 1, frameRate: 1, loop: false },
  chop: { type: 'action', directions: 4, framesPerDirection: 10, rowsPerDirection: 1, frameRate: 10, loop: false },
  dig: { type: 'action', directions: 4, framesPerDirection: 9, rowsPerDirection: 1, frameRate: 10, loop: false },
  fish: { type: 'action', directions: 4, framesPerDirection: 32, rowsPerDirection: 2, frameRate: 8, loop: false },
  water: { type: 'action', directions: 4, framesPerDirection: 14, rowsPerDirection: 1, frameRate: 10, loop: false },
  harvest: { type: 'action', directions: 4, framesPerDirection: 9, rowsPerDirection: 1, frameRate: 10, loop: false },
  grow: { type: 'horizontal', directions: 1, framesPerDirection: 8, rowsPerDirection: 1, frameRate: 0.5, loop: false },
  shake: { type: 'horizontal', directions: 1, framesPerDirection: 8, rowsPerDirection: 1, frameRate: 12, loop: false },
};

export async function detectAnimationLayout(
  imagePath: string,
  tileSize: number = 32,
  hint?: string
): Promise<DetectedLayout> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  
  const cols = Math.floor(width / tileSize);
  const rows = Math.floor(height / tileSize);
  const totalFrames = cols * rows;

  let layout: AnimationLayout = {
    type: 'standard',
    directions: 4,
    framesPerDirection: Math.floor(cols / 1),
    rowsPerDirection: 1,
    frameRate: 8,
    loop: true,
  };

  if (hint) {
    const knownLayout = KNOWN_LAYOUTS[hint.toLowerCase()];
    if (knownLayout) {
      layout = { ...layout, ...knownLayout };
    }
  }

  const filename = path.basename(imagePath).toLowerCase();
  for (const [key, knownLayout] of Object.entries(KNOWN_LAYOUTS)) {
    if (filename.includes(key)) {
      layout = { ...layout, ...knownLayout };
      break;
    }
  }

  if (rows === 4 && cols >= 4) {
    layout.type = 'standard';
    layout.directions = 4;
    layout.framesPerDirection = cols;
    layout.rowsPerDirection = 1;
  } else if (rows === 1) {
    layout.type = 'horizontal';
    layout.directions = 1;
    layout.framesPerDirection = cols;
  } else if (cols === 1) {
    layout.type = 'vertical';
    layout.directions = 1;
    layout.framesPerDirection = rows;
  }

  return {
    cols,
    rows,
    tileWidth: tileSize,
    tileHeight: tileSize,
    totalFrames,
    layout,
  };
}

export async function registerAnimatedSpriteSheet(
  atlasId: string,
  imagePath: string,
  options: {
    tileWidth?: number;
    tileHeight?: number;
    layoutHint?: string;
    customLayout?: Partial<AnimationLayout>;
    tags?: string[];
  } = {}
): Promise<SpriteAtlas> {
  const tileWidth = options.tileWidth || 32;
  const tileHeight = options.tileHeight || 32;
  
  const detected = await detectAnimationLayout(imagePath, tileWidth, options.layoutHint);
  const layout = { ...detected.layout, ...options.customLayout };
  
  const frames = new Map<string, SpriteFrame>();
  const animations = new Map<string, SpriteAnimation>();

  for (let row = 0; row < detected.rows; row++) {
    for (let col = 0; col < detected.cols; col++) {
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

  if (layout.type === 'standard' && layout.directions === 4) {
    // Check for 6-row layout (common in some sprite packs)
    // These have 48px tall characters arranged in a 32px grid
    // Layout: row 0=down overflow, row 1=left, row 2=right, row 3=down, row 4=up overflow, row 5=up
    const is6RowLayout = detected.rows === 6;

    // Row mapping: direction index -> actual row in spritesheet
    const rowMapping = is6RowLayout
      ? { down: 3, left: 1, right: 2, up: 5 }  // 6-row layout
      : { down: 0, left: 1, right: 2, up: 3 }; // Standard 4-row layout

    // For 6-row layouts, characters are 48px tall and extend 16px above their row
    // We need to create special frames that capture the full character
    if (is6RowLayout) {
      // Override the frame definitions for 6-row character sheets
      // These frames capture 48px tall sprites starting 16px above the nominal row
      for (let row = 0; row < detected.rows; row++) {
        for (let col = 0; col < detected.cols; col++) {
          const frameId = `frame_${row}_${col}`;
          // Calculate y position: start 16px above the nominal row position
          // But clamp to 0 to avoid negative y
          const nominalY = row * tileHeight;
          const extendedY = Math.max(0, nominalY - 16);
          const extendedHeight = 48;

          frames.set(frameId, {
            x: col * tileWidth,
            y: extendedY,
            width: tileWidth,
            height: extendedHeight,
            anchorX: 0.5,
            anchorY: 1.0,
          });
        }
      }
    }

    for (let d = 0; d < 4; d++) {
      const dir = DIRECTIONS[d];
      const row = rowMapping[dir];
      const animFrames: string[] = [];

      for (let rowOffset = 0; rowOffset < layout.rowsPerDirection; rowOffset++) {
        const actualRow = row + rowOffset;
        for (let f = 0; f < Math.min(layout.framesPerDirection, detected.cols); f++) {
          animFrames.push(`frame_${actualRow}_${f}`);
        }
      }

      if (animFrames.length > 0) {
        animations.set(`walk_${dir}`, {
          frames: animFrames,
          frameRate: layout.frameRate,
          loop: layout.loop,
        });
      }
    }

    for (let d = 0; d < 4; d++) {
      const dir = DIRECTIONS[d];
      const row = rowMapping[dir];
      animations.set(`idle_${dir}`, {
        frames: [`frame_${row}_0`],
        frameRate: 1,
        loop: false,
      });
    }
  } else if (layout.type === 'action' && layout.directions === 4) {
    const framesPerRow = Math.ceil(layout.framesPerDirection / layout.rowsPerDirection);
    
    for (let d = 0; d < 4; d++) {
      const dir = DIRECTIONS[d];
      const animFrames: string[] = [];
      
      for (let rowOffset = 0; rowOffset < layout.rowsPerDirection; rowOffset++) {
        const row = d * layout.rowsPerDirection + rowOffset;
        if (row >= detected.rows) break;
        
        const framesThisRow = rowOffset === layout.rowsPerDirection - 1
          ? layout.framesPerDirection - (layout.rowsPerDirection - 1) * framesPerRow
          : framesPerRow;
        
        for (let f = 0; f < Math.min(framesThisRow, detected.cols); f++) {
          animFrames.push(`frame_${row}_${f}`);
        }
      }
      
      if (animFrames.length > 0) {
        const actionName = options.layoutHint || 'action';
        animations.set(`${actionName}_${dir}`, {
          frames: animFrames,
          frameRate: layout.frameRate,
          loop: layout.loop,
        });
      }
    }
  } else if (layout.type === 'horizontal') {
    const allFrames: string[] = [];
    for (let col = 0; col < detected.cols; col++) {
      allFrames.push(`frame_0_${col}`);
    }
    
    const animName = options.layoutHint || 'animate';
    animations.set(animName, {
      frames: allFrames,
      frameRate: layout.frameRate,
      loop: layout.loop,
    });
  }

  // For 6-row layouts, the effective tile height is 48px
  const effectiveTileHeight = (layout.type === 'standard' && layout.directions === 4 && detected.rows === 6)
    ? 48
    : tileHeight;

  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath,
    tileWidth,
    tileHeight: effectiveTileHeight,
    columns: detected.cols,
    rows: detected.rows,
    frames,
    animations,
    tags: options.tags || ['animated'],
    description: `Animated sprite sheet: ${path.basename(imagePath)}`,
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export async function extractGifFrames(
  gifPath: string,
  outputDir: string
): Promise<{ frames: string[]; delays: number[] }> {
  await fs.promises.mkdir(outputDir, { recursive: true });
  
  const gifFrames = (await import('gif-frames')).default;
  const frameData = await gifFrames({
    url: gifPath,
    frames: 'all',
    outputType: 'png',
    cumulative: true,
  });

  const frames: string[] = [];
  const delays: number[] = [];

  for (let i = 0; i < frameData.length; i++) {
    const frame = frameData[i];
    const framePath = path.join(outputDir, `frame_${i.toString().padStart(4, '0')}.png`);
    
    const stream = frame.getImage().pipe(fs.createWriteStream(framePath));
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
    
    frames.push(framePath);
    delays.push(frame.frameInfo.delay * 10);
  }

  return { frames, delays };
}

export async function registerGifAsAtlas(
  atlasId: string,
  gifPath: string,
  options: {
    outputDir?: string;
    tags?: string[];
  } = {}
): Promise<SpriteAtlas> {
  const outputDir = options.outputDir || path.join(path.dirname(gifPath), `.${atlasId}_frames`);
  const { frames: framePaths, delays } = await extractGifFrames(gifPath, outputDir);
  
  if (framePaths.length === 0) {
    throw new Error(`No frames extracted from GIF: ${gifPath}`);
  }

  const firstFrameMeta = await sharp(framePaths[0]).metadata();
  const width = firstFrameMeta.width || 32;
  const height = firstFrameMeta.height || 32;

  const frameMap = new Map<string, SpriteFrame>();
  const frameIds: string[] = [];

  for (let i = 0; i < framePaths.length; i++) {
    const frameId = `frame_${i}`;
    frameIds.push(frameId);
    frameMap.set(frameId, {
      x: 0,
      y: 0,
      width,
      height,
      anchorX: 0.5,
      anchorY: 1.0,
    });
  }

  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const frameRate = Math.round(1000 / avgDelay);

  const baseName = path.basename(gifPath, '.gif').toLowerCase().replace(/_32x32$/, '');
  
  const atlas: SpriteAtlas = {
    id: atlasId,
    imagePath: outputDir,
    tileWidth: width,
    tileHeight: height,
    columns: framePaths.length,
    rows: 1,
    frames: frameMap,
    animations: new Map([
      [baseName, {
        frames: frameIds,
        frameRate,
        loop: true,
      }],
    ]),
    tags: options.tags || ['animated', 'gif'],
    description: `Animated GIF: ${path.basename(gifPath)}`,
  };

  SpriteRegistry.registerAtlas(atlas);
  return atlas;
}

export async function loadCharacterAnimations(
  baseDir: string,
  characterName: string
): Promise<Map<string, SpriteAtlas>> {
  const atlases = new Map<string, SpriteAtlas>();
  const files = await fs.promises.readdir(baseDir);
  
  const characterFiles = files.filter(f => 
    f.toLowerCase().includes(characterName.toLowerCase()) && f.endsWith('.png')
  );

  for (const file of characterFiles) {
    const filePath = path.join(baseDir, file);
    const baseName = file.replace(/_32x32\.png$/i, '').replace(/\.png$/i, '');
    const atlasId = baseName.toLowerCase().replace(/\s+/g, '_');
    
    let layoutHint: string | undefined;
    const animTypes = ['chopping', 'chop', 'dig', 'fishing', 'fish', 'watering', 'water', 'harvesting', 'harvest'];
    for (const anim of animTypes) {
      if (baseName.toLowerCase().includes(anim)) {
        layoutHint = anim.replace('chopping', 'chop').replace('fishing', 'fish').replace('watering', 'water').replace('harvesting', 'harvest');
        break;
      }
    }

    try {
      const atlas = await registerAnimatedSpriteSheet(atlasId, filePath, {
        layoutHint,
        tags: ['character', characterName.toLowerCase()],
      });
      atlases.set(atlasId, atlas);
    } catch (e) {
      console.warn(`Failed to load ${file}:`, e);
    }
  }

  return atlases;
}

export async function loadAnimalAnimations(
  baseDir: string
): Promise<Map<string, SpriteAtlas>> {
  const atlases = new Map<string, SpriteAtlas>();
  
  const animalDirs = await fs.promises.readdir(baseDir, { withFileTypes: true });
  
  for (const dir of animalDirs) {
    if (!dir.isDirectory()) continue;
    
    const animalDir = path.join(baseDir, dir.name);
    const files = await fs.promises.readdir(animalDir);
    
    for (const file of files) {
      if (!file.endsWith('.png')) continue;
      
      const filePath = path.join(animalDir, file);
      const baseName = file.replace(/_32x32\.png$/i, '').replace(/\.png$/i, '');
      const atlasId = baseName.toLowerCase().replace(/\s+/g, '_');
      
      try {
        const atlas = await registerAnimatedSpriteSheet(atlasId, filePath, {
          tags: ['animal', dir.name.toLowerCase().replace(/_32x32$/, '')],
        });
        atlases.set(atlasId, atlas);
      } catch (e) {
        console.warn(`Failed to load ${file}:`, e);
      }
    }
  }

  return atlases;
}

export async function loadAllGifs(
  gifDir: string,
  outputBaseDir?: string
): Promise<Map<string, SpriteAtlas>> {
  const atlases = new Map<string, SpriteAtlas>();
  const files = await fs.promises.readdir(gifDir);
  
  for (const file of files) {
    if (!file.endsWith('.gif')) continue;
    
    const gifPath = path.join(gifDir, file);
    const baseName = file.replace(/_32x32\.gif$/i, '').replace(/\.gif$/i, '');
    const atlasId = `gif_${baseName.toLowerCase().replace(/\s+/g, '_')}`;
    
    const outputDir = outputBaseDir 
      ? path.join(outputBaseDir, atlasId)
      : undefined;

    try {
      const atlas = await registerGifAsAtlas(atlasId, gifPath, {
        outputDir,
        tags: ['animated', 'gif', 'effect'],
      });
      atlases.set(atlasId, atlas);
    } catch (e) {
      console.warn(`Failed to load GIF ${file}:`, e);
    }
  }

  return atlases;
}
