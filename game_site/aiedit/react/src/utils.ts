import { CANVAS_SIZE } from './constants'

export interface ContainBounds { dx: number; dy: number; dw: number; dh: number }

export function drawContained(
  ctx: CanvasRenderingContext2D,
  src: HTMLImageElement | HTMLVideoElement,
  canvasSize: number = CANVAS_SIZE,
): ContainBounds {
  const srcW = src instanceof HTMLVideoElement ? src.videoWidth  : src.naturalWidth
  const srcH = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight
  const scale = Math.min(canvasSize / srcW, canvasSize / srcH)
  const dw = Math.round(srcW * scale)
  const dh = Math.round(srcH * scale)
  const dx = Math.round((canvasSize - dw) / 2)
  const dy = Math.round((canvasSize - dh) / 2)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvasSize, canvasSize)
  ctx.drawImage(src, dx, dy, dw, dh)
  return { dx, dy, dw, dh }
}
