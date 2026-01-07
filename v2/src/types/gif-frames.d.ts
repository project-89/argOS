declare module 'gif-frames' {
  interface FrameInfo {
    delay: number;
    disposal: number;
    transparent: boolean;
  }

  interface Frame {
    frameIndex: number;
    frameInfo: FrameInfo;
    getImage(): NodeJS.ReadableStream;
  }

  interface GifFramesOptions {
    url: string;
    frames: 'all' | number | number[];
    outputType?: 'png' | 'jpg' | 'canvas';
    cumulative?: boolean;
  }

  function gifFrames(options: GifFramesOptions): Promise<Frame[]>;
  
  export default gifFrames;
}
