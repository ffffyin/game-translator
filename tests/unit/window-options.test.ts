import { describe, it, expect } from 'vitest'
import {
  mainWindowOptions,
  MAIN_WINDOW_HEIGHT,
  MAIN_WINDOW_WIDTH
} from '../../src/main/window-options'

const opts = mainWindowOptions({ preloadPath: 'C:/x/preload/index.js', background: '#161a21' })

describe('主窗口参数（自绘标题栏）', () => {
  it('关闭系统原生标题栏，由渲染层自绘', () => {
    expect(opts.frame).toBe(false)
  })

  it('底色由主题解析结果注入，不在代码里写死', () => {
    expect(opts.backgroundColor).toBe('#161a21')
    expect(
      mainWindowOptions({ preloadPath: 'p', background: '#eef0f3' }).backgroundColor
    ).toBe('#eef0f3')
  })

  it('保留尺寸约束与安全 webPreferences', () => {
    expect(opts.width).toBe(MAIN_WINDOW_WIDTH)
    expect(opts.height).toBe(MAIN_WINDOW_HEIGHT)
    expect(opts.webPreferences?.contextIsolation).toBe(true)
    expect(opts.webPreferences?.nodeIntegration).toBe(false)
    expect(opts.webPreferences?.preload).toBe('C:/x/preload/index.js')
  })
})
