import * as tf from '@tensorflow/tfjs';
import { drawContained } from './utils';

const MODEL_URL     = '/static/aiedit/tfjs_model/model.json';
const VGG_MEANS_BGR = [103.939, 116.779, 123.68];
const TILE_SIZE     = 256;
const OUTPUT_SIZE   = 512;
const BLEND_PX      = 32;

const TILE_POSITIONS = [
  { sx: 0,         sy: 0,         label: 'top-left'     },
  { sx: TILE_SIZE, sy: 0,         label: 'top-right'    },
  { sx: 0,         sy: TILE_SIZE, label: 'bottom-left'  },
  { sx: TILE_SIZE, sy: TILE_SIZE, label: 'bottom-right' },
];

interface TileResult { sx: number; sy: number; canvas: HTMLCanvasElement; }

let model: tf.GraphModel | null = null;

export async function loadModel(onProgress?: (msg: string) => void): Promise<void> {
  if (model) return;
  if (onProgress) onProgress('Loading model weights...');
  model = await tf.loadGraphModel(MODEL_URL);
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function srcToImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function preprocessImage(
  imgElement: HTMLCanvasElement | HTMLImageElement,
  targetH: number,
  targetW: number
): tf.Tensor {
  return tf.tidy(() => {
    let t = tf.browser.fromPixels(imgElement);
    t = tf.image.resizeBilinear(t, [targetH, targetW]);
    t = tf.cast(t, 'float32');
    const r = t.slice([0, 0, 0], [-1, -1, 1]);
    const g = t.slice([0, 0, 1], [-1, -1, 1]);
    const b = t.slice([0, 0, 2], [-1, -1, 1]);
    t = tf.concat([b, g, r], 2);
    const means = tf.tensor(VGG_MEANS_BGR, [1, 1, 3]);
    t = tf.sub(t, means);
    return tf.expandDims(t, 0);
  });
}

async function tensorToCanvas(outputTensor: tf.Tensor): Promise<HTMLCanvasElement> {
  const rgbTensor = tf.tidy(() => {
    let t = tf.squeeze(outputTensor, [0]);
    const b = t.slice([0, 0, 0], [-1, -1, 1]);
    const g = t.slice([0, 0, 1], [-1, -1, 1]);
    const r = t.slice([0, 0, 2], [-1, -1, 1]);
    t = tf.concat([r, g, b], 2);
    t = tf.clipByValue(t, 0, 255);
    return tf.cast(t, 'int32');
  }) as tf.Tensor3D;

  const [h, w] = rgbTensor.shape;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d', { willReadFrequently: true });
  await tf.browser.toPixels(rgbTensor, canvas);
  rgbTensor.dispose();
  return canvas;
}

async function runTile(
  tileCanvas: HTMLCanvasElement,
  styleTensor: tf.Tensor
): Promise<HTMLCanvasElement> {
  const contentTensor = preprocessImage(tileCanvas, TILE_SIZE, TILE_SIZE);
  const outputTensor = await model!.executeAsync(
    { content_input: contentTensor, style_input: styleTensor },
    'Identity'
  ) as tf.Tensor;
  contentTensor.dispose();
  const result = await tensorToCanvas(outputTensor);
  outputTensor.dispose();
  return result;
}

function stitchWithBlending(tiles: TileResult[]): HTMLCanvasElement {
  const out    = document.createElement('canvas');
  out.width    = OUTPUT_SIZE; out.height = OUTPUT_SIZE;
  const outCtx = out.getContext('2d', { willReadFrequently: true })!;

  const tileData = tiles.map(t => ({
    sx: t.sx, sy: t.sy,
    data: t.canvas.getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data,
  }));
  const img    = outCtx.createImageData(OUTPUT_SIZE, OUTPUT_SIZE);
  const buf    = img.data;
  const seam       = OUTPUT_SIZE / 2;
  const blendStart = seam - BLEND_PX / 2;
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    const ty = Math.min(1, Math.max(0, (y - blendStart) / BLEND_PX));
    for (let x = 0; x < OUTPUT_SIZE; x++) {
      const tx = Math.min(1, Math.max(0, (x - blendStart) / BLEND_PX));
      const w  = [
        (1 - tx) * (1 - ty),
        tx       * (1 - ty),
        (1 - tx) * ty,
        tx       * ty,
      ];
      let r = 0, g = 0, b = 0;
      tileData.forEach((t, i) => {
        const px  = Math.min(TILE_SIZE - 1, Math.max(0, x - t.sx));
        const py  = Math.min(TILE_SIZE - 1, Math.max(0, y - t.sy));
        const idx = (py * TILE_SIZE + px) * 4;
        r += t.data[idx]     * w[i];
        g += t.data[idx + 1] * w[i];
        b += t.data[idx + 2] * w[i];
      });
      const o = (y * OUTPUT_SIZE + x) * 4;
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g);
      buf[o + 2] = Math.round(b); buf[o + 3] = 255;
    }
  }
  outCtx.putImageData(img, 0, 0);
  return out;
}

export async function runStyleTransferFromCanvas(
  frameCanvas: HTMLCanvasElement,
  styleImgSrc: string,
  onProgress?: (msg: string) => void
): Promise<HTMLCanvasElement> {
  await loadModel(onProgress);
  if (onProgress) onProgress('Preprocessing images...');
  const styleImg    = await srcToImage(styleImgSrc);
  const styleTensor = preprocessImage(styleImg, TILE_SIZE, TILE_SIZE);

  const tiles: TileResult[] = [];
  for (let i = 0; i < TILE_POSITIONS.length; i++) {
    const { sx, sy, label } = TILE_POSITIONS[i];
    if (onProgress) onProgress(`Tile ${i + 1}/4 (${label})...`);
    const tc = document.createElement('canvas');
    tc.width = tc.height = TILE_SIZE;
    tc.getContext('2d')!.drawImage(frameCanvas, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
    tiles.push({ sx, sy, canvas: await runTile(tc, styleTensor) });
  }

  styleTensor.dispose();
  if (onProgress) onProgress('Stitching tiles...');
  return stitchWithBlending(tiles);
}

export async function runStyleTransfer(
  contentFile: File,
  styleImgSrc: string,
  onProgress?: (msg: string) => void
): Promise<HTMLCanvasElement> {
  await loadModel(onProgress);
  if (onProgress) onProgress('Preprocessing images...');
  const contentImg = await fileToImage(contentFile);
  const styleImg   = await srcToImage(styleImgSrc);

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullCanvas.height = OUTPUT_SIZE;
  drawContained(fullCanvas.getContext('2d')!, contentImg, OUTPUT_SIZE);

  const styleTensor = preprocessImage(styleImg, TILE_SIZE, TILE_SIZE);
  const tiles: TileResult[] = [];

  for (let i = 0; i < TILE_POSITIONS.length; i++) {
    const { sx, sy, label } = TILE_POSITIONS[i];
    if (onProgress) onProgress(`Tile ${i + 1}/4 (${label})...`);
    const tc = document.createElement('canvas');
    tc.width = tc.height = TILE_SIZE;
    tc.getContext('2d')!.drawImage(fullCanvas, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
    tiles.push({ sx, sy, canvas: await runTile(tc, styleTensor) });
  }

  styleTensor.dispose();
  if (onProgress) onProgress('Stitching tiles...');
  return stitchWithBlending(tiles);
}
