import { desktopCapturer, screen, NativeImage } from 'electron'

// 抓取指定显示器的全屏位图（物理像素）
export async function captureDisplay(displayId: number): Promise<NativeImage> {
  const display = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!display) throw new Error('找不到目标显示器')

  const w = Math.round(display.bounds.width * display.scaleFactor)
  const h = Math.round(display.bounds.height * display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: w, height: h }
  })
  const source = sources.find((s) => String(s.display_id) === String(displayId))
  if (!source || source.thumbnail.isEmpty()) throw new Error('屏幕抓取失败')
  return source.thumbnail
}

// 抓取鼠标所在显示器的全屏位图（快捷键 4）
export async function captureDisplayAtCursor(): Promise<{
  image: NativeImage
  displayId: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number } // DIP
}> {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const image = await captureDisplay(display.id)
  return {
    image,
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    bounds: { ...display.bounds }
  }
}
