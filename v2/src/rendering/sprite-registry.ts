export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
}

export interface SpriteAnimation {
  frames: string[];
  frameRate: number;
  loop: boolean;
}

export interface SpriteAtlas {
  id: string;
  imagePath: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  frames: Map<string, SpriteFrame>;
  animations: Map<string, SpriteAnimation>;
  tags: string[];
  description: string;
}

export interface TilesetDefinition {
  id: string;
  atlasId: string;
  tileMapping: Map<number, string>;
  defaultFrame: string;
  properties: Map<number, TileProperties>;
}

export interface TileProperties {
  walkable: boolean;
  solid: boolean;
  climbable?: boolean;
  liquid?: boolean;
  damage?: number;
  friction?: number;
  tags: string[];
}

class SpriteRegistryImpl {
  private atlases: Map<string, SpriteAtlas> = new Map();
  private tilesets: Map<string, TilesetDefinition> = new Map();
  private framesByTag: Map<string, Array<{ atlasId: string; frameId: string }>> = new Map();
  private framesByName: Map<string, { atlasId: string; frameId: string }> = new Map();

  registerAtlas(atlas: SpriteAtlas): void {
    this.atlases.set(atlas.id, atlas);
    
    for (const [frameId, frame] of atlas.frames) {
      const fullName = `${atlas.id}:${frameId}`;
      this.framesByName.set(fullName, { atlasId: atlas.id, frameId });
      this.framesByName.set(frameId, { atlasId: atlas.id, frameId });
    }
    
    for (const tag of atlas.tags) {
      if (!this.framesByTag.has(tag)) {
        this.framesByTag.set(tag, []);
      }
      for (const frameId of atlas.frames.keys()) {
        this.framesByTag.get(tag)!.push({ atlasId: atlas.id, frameId });
      }
    }
  }

  registerTileset(tileset: TilesetDefinition): void {
    this.tilesets.set(tileset.id, tileset);
  }

  getAtlas(id: string): SpriteAtlas | undefined {
    return this.atlases.get(id);
  }

  getTileset(id: string): TilesetDefinition | undefined {
    return this.tilesets.get(id);
  }

  getFrame(atlasId: string, frameId: string): SpriteFrame | undefined {
    return this.atlases.get(atlasId)?.frames.get(frameId);
  }

  getAnimation(atlasId: string, animationId: string): SpriteAnimation | undefined {
    return this.atlases.get(atlasId)?.animations.get(animationId);
  }

  resolveSpriteName(name: string): { atlasId: string; frameId: string } | undefined {
    return this.framesByName.get(name);
  }

  findSpritesByTag(tag: string): Array<{ atlasId: string; frameId: string }> {
    return this.framesByTag.get(tag) ?? [];
  }

  listAtlases(): SpriteAtlas[] {
    return Array.from(this.atlases.values());
  }

  listTilesets(): TilesetDefinition[] {
    return Array.from(this.tilesets.values());
  }

  listTags(): string[] {
    return Array.from(this.framesByTag.keys());
  }

  searchSprites(query: string): Array<{ atlasId: string; frameId: string; score: number }> {
    const results: Array<{ atlasId: string; frameId: string; score: number }> = [];
    const queryLower = query.toLowerCase();
    
    for (const [name, ref] of this.framesByName) {
      const nameLower = name.toLowerCase();
      if (nameLower.includes(queryLower)) {
        const score = nameLower === queryLower ? 100 : 
                      nameLower.startsWith(queryLower) ? 80 : 50;
        results.push({ ...ref, score });
      }
    }
    
    for (const [tag, sprites] of this.framesByTag) {
      if (tag.toLowerCase().includes(queryLower)) {
        for (const sprite of sprites) {
          results.push({ ...sprite, score: 30 });
        }
      }
    }
    
    return results.sort((a, b) => b.score - a.score);
  }

  createAtlasFromGrid(
    id: string,
    imagePath: string,
    tileWidth: number,
    tileHeight: number,
    columns: number,
    rows: number,
    frameNames: string[][],
    options: { tags?: string[]; description?: string } = {}
  ): SpriteAtlas {
    const frames = new Map<string, SpriteFrame>();
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const name = frameNames[row]?.[col] ?? `tile_${row}_${col}`;
        frames.set(name, {
          x: col * tileWidth,
          y: row * tileHeight,
          width: tileWidth,
          height: tileHeight,
          anchorX: 0.5,
          anchorY: 0.5,
        });
      }
    }
    
    const atlas: SpriteAtlas = {
      id,
      imagePath,
      tileWidth,
      tileHeight,
      columns,
      rows,
      frames,
      animations: new Map(),
      tags: options.tags ?? [],
      description: options.description ?? '',
    };
    
    this.registerAtlas(atlas);
    return atlas;
  }

  addAnimation(
    atlasId: string,
    animationId: string,
    frameIds: string[],
    frameRate: number = 10,
    loop: boolean = true
  ): void {
    const atlas = this.atlases.get(atlasId);
    if (!atlas) return;
    
    atlas.animations.set(animationId, {
      frames: frameIds,
      frameRate,
      loop,
    });
  }

  getSpriteInfo(atlasId: string, frameId: string): {
    atlas: SpriteAtlas;
    frame: SpriteFrame;
    animations: string[];
  } | undefined {
    const atlas = this.atlases.get(atlasId);
    if (!atlas) return undefined;
    
    const frame = atlas.frames.get(frameId);
    if (!frame) return undefined;
    
    const animations: string[] = [];
    for (const [animId, anim] of atlas.animations) {
      if (anim.frames.includes(frameId)) {
        animations.push(animId);
      }
    }
    
    return { atlas, frame, animations };
  }

  exportCatalog(): {
    atlases: Array<{
      id: string;
      imagePath: string;
      frameCount: number;
      animationCount: number;
      tags: string[];
      description: string;
    }>;
    tilesets: Array<{
      id: string;
      atlasId: string;
      tileCount: number;
    }>;
    tags: string[];
  } {
    return {
      atlases: this.listAtlases().map(a => ({
        id: a.id,
        imagePath: a.imagePath,
        frameCount: a.frames.size,
        animationCount: a.animations.size,
        tags: a.tags,
        description: a.description,
      })),
      tilesets: this.listTilesets().map(t => ({
        id: t.id,
        atlasId: t.atlasId,
        tileCount: t.tileMapping.size,
      })),
      tags: this.listTags(),
    };
  }
}

export const SpriteRegistry = new SpriteRegistryImpl();
