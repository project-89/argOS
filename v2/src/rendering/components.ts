export const PixiSprite = {
  atlasId: [] as string[],
  frameId: [] as string[],
  anchorX: [] as number[],
  anchorY: [] as number[],
  scaleX: [] as number[],
  scaleY: [] as number[],
  rotation: [] as number[],
  tint: [] as number[],
  alpha: [] as number[],
  visible: [] as boolean[],
  zIndex: [] as number[],
};

export const AnimatedSprite = {
  atlasId: [] as string[],
  animationId: [] as string[],
  frameIndex: [] as number[],
  frameTime: [] as number[],
  lastFrameTime: [] as number[],
  loop: [] as boolean[],
  playing: [] as boolean[],
  speed: [] as number[],
};

export const TileLayer = {
  tilemapId: [] as number[],
  layerIndex: [] as number[],
  tilesetId: [] as string[],
  visible: [] as boolean[],
  alpha: [] as number[],
};

export const Tilemap = {
  width: [] as number[],
  height: [] as number[],
  tileWidth: [] as number[],
  tileHeight: [] as number[],
  data: [] as string[],
};

export const Camera = {
  targetEid: [] as number[],
  offsetX: [] as number[],
  offsetY: [] as number[],
  zoom: [] as number[],
  smoothing: [] as number[],
  viewportWidth: [] as number[],
  viewportHeight: [] as number[],
};

export const VisualEffect = {
  type: [] as string[],
  startTime: [] as number[],
  duration: [] as number[],
  intensity: [] as number[],
  color: [] as number[],
};

export const RenderingComponents = {
  PixiSprite,
  AnimatedSprite,
  TileLayer,
  Tilemap,
  Camera,
  VisualEffect,
};
