import { Texture, Rectangle, Assets, AnimatedSprite } from "pixi.js";

export interface SpriteConfig {
  name: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  animations: Record<string, number[]>;
}

// Default character sprite config (RPG Maker style)
// Layout: 24 columns x 6 rows
// Rows: down, left, right, up (with variants)
const DEFAULT_CHARACTER_CONFIG = {
  frameWidth: 32,
  frameHeight: 32,
  columns: 24,
  rows: 6,
  animations: {
    idle_down: [0],
    idle_left: [24],
    idle_right: [48],
    idle_up: [72],
    walk_down: [0, 1, 2, 3, 4, 5],
    walk_left: [24, 25, 26, 27, 28, 29],
    walk_right: [48, 49, 50, 51, 52, 53],
    walk_up: [72, 73, 74, 75, 76, 77],
  },
};

// Available character sprites
export const CHARACTER_SPRITES = [
  "Farmer_1_32x32.png",
  "Farmer_2_32x32.png",
  "Body_2_32x32.png",
];

export class SpriteManager {
  private textures: Map<string, Texture> = new Map();
  private frameTextures: Map<string, Texture[]> = new Map();
  private loaded: Set<string> = new Set();

  async loadCharacterSprite(name: string): Promise<Texture[]> {
    const path = `/32x32/Characters_32x32/${name}`;

    if (this.frameTextures.has(path)) {
      return this.frameTextures.get(path)!;
    }

    try {
      const baseTexture = await Assets.load(path);
      const source = baseTexture.source;

      const { frameWidth, frameHeight, columns, rows } = DEFAULT_CHARACTER_CONFIG;
      const frames: Texture[] = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const frame = new Rectangle(
            col * frameWidth,
            row * frameHeight,
            frameWidth,
            frameHeight
          );
          const texture = new Texture({ source, frame });
          frames.push(texture);
        }
      }

      this.textures.set(path, baseTexture);
      this.frameTextures.set(path, frames);
      this.loaded.add(path);

      return frames;
    } catch (err) {
      console.error(`Failed to load character sprite ${name}:`, err);
      return [];
    }
  }

  getAnimationFrames(
    spriteName: string,
    animationName: string
  ): Texture[] {
    const path = `/32x32/Characters_32x32/${spriteName}`;
    const frames = this.frameTextures.get(path);

    if (!frames) return [];

    const animations = DEFAULT_CHARACTER_CONFIG.animations as Record<string, number[]>;
    const animConfig = animations[animationName];
    if (!animConfig) return [frames[0]];

    return animConfig.map((idx) => frames[idx]);
  }

  createAnimatedSprite(
    spriteName: string,
    animation: string = "idle_down"
  ): AnimatedSprite | null {
    const frames = this.getAnimationFrames(spriteName, animation);

    if (frames.length === 0) return null;

    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.15;
    sprite.anchor.set(0.5, 0.5);
    return sprite;
  }

  isLoaded(spriteName: string): boolean {
    const path = `/32x32/Characters_32x32/${spriteName}`;
    return this.loaded.has(path);
  }
}

export const spriteManager = new SpriteManager();

// Direction helpers
export type Direction = "up" | "down" | "left" | "right";

export function getAnimationName(
  action: "idle" | "walk",
  direction: Direction
): string {
  return `${action}_${direction}`;
}

export function directionFromDelta(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}
