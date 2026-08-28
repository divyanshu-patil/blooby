declare module 'gif.js.optimized' {
  interface GifOptions {
    workers?: number; quality?: number; workerScript?: string;
    width?: number; height?: number; background?: string; transparent?: string | null; repeat?: number; dither?: boolean | string;
  }
  export default class GIF {
    constructor(options?: GifOptions);
    addFrame(el: CanvasImageSource, opts?: { copy?: boolean; delay?: number }): void;
    on(event: 'finished', cb: (blob: Blob) => void): void;
    on(event: 'progress', cb: (p: number) => void): void;
    on(event: 'abort', cb: () => void): void;
    render(): void;
    abort(): void;
  }
}
declare module 'gif.js.optimized/dist/gif.worker.js?url' {
  const url: string;
  export default url;
}
