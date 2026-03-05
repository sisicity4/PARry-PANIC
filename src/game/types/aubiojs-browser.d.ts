declare module "aubiojs/build/aubio.esm.js" {
  export interface Tempo {
    do(buffer: Float32Array): number;
    getBpm(): number;
  }

  export interface AubioModule {
    Tempo: new (bufferSize: number, hopSize: number, sampleRate: number) => Tempo;
  }

  const initAubio: () => Promise<AubioModule>;
  export default initAubio;
}
