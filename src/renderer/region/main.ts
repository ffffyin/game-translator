interface Point {
  x: number
  y: number
}

const sel = document.getElementById('sel')!
const size = document.getElementById('size')!
const tip = document.getElementById('tip')!

let start: Point | null = null
let dragging = false

function point(e: MouseEvent): Point {
  return { x: e.clientX, y: e.clientY }
}

function onDown(e: MouseEvent) {
  if (e.button !== 0) return
  start = point(e)
  dragging = true
  tip.hidden = true
  sel.hidden = false
  sel.style.left = start.x + 'px'
  sel.style.top = start.y + 'px'
  sel.style.width = '0px'
  sel.style.height = '0px'
}

function onMove(e: MouseEvent) {
  if (!dragging || !start) return
  const p = point(e)
  const x = Math.min(start.x, p.x)
  const y = Math.min(start.y, p.y)
  const w = Math.abs(p.x - start.x)
  const h = Math.abs(p.y - start.y)
  sel.style.left = x + 'px'
  sel.style.top = y + 'px'
  sel.style.width = w + 'px'
  sel.style.height = h + 'px'
  size.textContent = `${Math.round(w)} × ${Math.round(h)}`
}

function onUp(e: MouseEvent) {
  if (!dragging || !start) return
  dragging = false
  const p = point(e)
  const rect = {
    x: Math.min(start.x, p.x),
    y: Math.min(start.y, p.y),
    width: Math.abs(p.x - start.x),
    height: Math.abs(p.y - start.y)
  }
  // 过小的选区视为误触
  if (rect.width < 8 || rect.height < 8) {
    window.api.regionCancel()
    return
  }
  window.api.regionSelect(rect)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') window.api.regionCancel()
}

document.addEventListener('mousedown', onDown)
document.addEventListener('mousemove', onMove)
document.addEventListener('mouseup', onUp)
document.addEventListener('keydown', onKey)
