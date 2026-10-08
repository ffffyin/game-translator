import { describe, it, expect, vi } from 'vitest'
import {
  scaledDims,
  toPhysicalRect,
  cropRegion,
  limitMaxEdge,
  toPngDataUrl,
  toPngBuffer
} from '../../src/main/services/image'
import type { NativeImage } from 'electron'
import type { RegionResult } from '../../src/main/services/region-overlay'

function region(patch: Partial<RegionResult['rect']> = {}, scaleFactor = 1): RegionResult {
  return {
    rect: { x: 10, y: 20, width: 100, height: 200, ...patch },
    scaleFactor,
    displayId: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 }
  }
}

describe('图像几何工具', () => {
  it('DIP 选区按缩放因子换算为物理矩形', () => {
    expect(toPhysicalRect(region({}, 1))).toEqual({ x: 10, y: 20, width: 100, height: 200 })
    expect(toPhysicalRect(region({}, 1.25))).toEqual({ x: 13, y: 25, width: 125, height: 250 })
    expect(toPhysicalRect(region({}, 1.5))).toEqual({ x: 15, y: 30, width: 150, height: 300 })
  })

  it('最长边不超限：原样返回（取整）', () => {
    expect(scaledDims(800, 600, 2000)).toEqual({ width: 800, height: 600 })
    expect(scaledDims(2000, 500, 2000)).toEqual({ width: 2000, height: 500 })
  })

  it('超限：等比缩小，长边等于上限', () => {
    expect(scaledDims(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 })
    expect(scaledDims(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 })
  })

  it('异常尺寸返回 0，不产生 NaN', () => {
    expect(scaledDims(0, 500, 2000)).toEqual({ width: 0, height: 0 })
    expect(scaledDims(-10, 500, 2000)).toEqual({ width: 0, height: 0 })
  })

  function fakeImage(width: number, height: number) {
    const crop = vi.fn(() => ({ cropped: true }))
    const resize = vi.fn(() => ({ resized: true }))
    const toDataURL = vi.fn(() => 'data:image/png;base64,xxx')
    const toPNG = vi.fn(() => Buffer.from([1, 2, 3]))
    const img = {
      getSize: () => ({ width, height }),
      crop,
      resize,
      toDataURL,
      toPNG
    } as unknown as NativeImage
    return { img, crop, resize, toDataURL, toPNG }
  }

  it('cropRegion：按物理矩形裁剪并做边界保护', () => {
    const f = fakeImage(1920, 1080)
    const out = cropRegion(f.img, region({ x: 10, y: 20, width: 100, height: 200 }))
    expect(out).toEqual({ cropped: true })
    expect(f.crop).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 200 })

    // 超出位图的选区被夹到边界
    const g = fakeImage(200, 100)
    cropRegion(g.img, region({ x: 150, y: 80, width: 100, height: 100 }))
    const rect = g.crop.mock.calls[0][0]
    expect(rect.x + rect.width).toBeLessThanOrEqual(200)
    expect(rect.y + rect.height).toBeLessThanOrEqual(100)
  })

  it('limitMaxEdge：未超限原样返回，超限触发 resize', () => {
    const small = fakeImage(800, 600)
    expect(limitMaxEdge(small.img)).toBe(small.img)
    expect(small.resize).not.toHaveBeenCalled()

    const big = fakeImage(4000, 2000)
    const out = limitMaxEdge(big.img)
    expect(out).toEqual({ resized: true })
    expect(big.resize).toHaveBeenCalledWith({ width: 2000, height: 1000, quality: 'good' })
  })

  it('toPngDataUrl / toPngBuffer 透传 NativeImage 输出', () => {
    const f = fakeImage(10, 10)
    expect(toPngDataUrl(f.img)).toBe('data:image/png;base64,xxx')
    expect(toPngBuffer(f.img)).toEqual(Buffer.from([1, 2, 3]))
  })
})
