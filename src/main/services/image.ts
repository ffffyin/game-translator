import { NativeImage } from 'electron'
import type { RegionResult } from './region-overlay'

export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

// DIP 选区 → 物理像素裁剪矩形
export function toPhysicalRect(region: RegionResult): PhysicalRect {
  const f = region.scaleFactor
  return {
    x: Math.round(region.rect.x * f),
    y: Math.round(region.rect.y * f),
    width: Math.round(region.rect.width * f),
    height: Math.round(region.rect.height * f)
  }
}

// 计算最长边限制后的尺寸（0/负值保护）
export function scaledDims(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) }
  const ratio = maxEdge / longest
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

// 按框选区域裁剪
export function cropRegion(image: NativeImage, region: RegionResult): NativeImage {
  const size = image.getSize()
  const rect = toPhysicalRect(region)
  // 边界保护：裁剪框不得超出位图
  rect.x = Math.max(0, Math.min(rect.x, size.width - 1))
  rect.y = Math.max(0, Math.min(rect.y, size.height - 1))
  rect.width = Math.max(1, Math.min(rect.width, size.width - rect.x))
  rect.height = Math.max(1, Math.min(rect.height, size.height - rect.y))
  return image.crop(rect)
}

// 限制最长边，减小上传体积
export function limitMaxEdge(image: NativeImage, maxEdge = 2000): NativeImage {
  const { width, height } = image.getSize()
  const d = scaledDims(width, height, maxEdge)
  if (d.width === width && d.height === height) return image
  return image.resize({ width: d.width, height: d.height, quality: 'good' })
}

export function toPngDataUrl(image: NativeImage): string {
  // NativeImage.toDataURL 默认输出 PNG
  return image.toDataURL()
}

export function toPngBuffer(image: NativeImage): Buffer {
  return image.toPNG()
}
