import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/defaults'
import { resolveTheme } from '../../shared/theme'
import { isValidHex, normalizeHex } from '../../shared/colors'

const mqDark = window.matchMedia('(prefers-color-scheme: dark)')

/**
 * 本机设置行的宽泛形态。
 *
 * `cloudSyncApi` 是「是否把 API 配置（含密钥明文）同步到云端」的本机开关，
 * 它还没有进 AppSettings 的正式类型（改 shared 需要主进程侧同步加白名单），
 * 这里先用交叉类型读写，等 shared 补上 `cloudSyncApi: number` 后，
 * 直接把它并到 AppSettings、删掉这个本地类型即可。
 */
export type LocalAppSettings = AppSettings & { cloudSyncApi?: number | string }

/** 解析为本机布尔值：缺省一律按「关闭」处理，避免脏值被当成开启 */
export function readFlag(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    settings: { ...DEFAULT_SETTINGS } as AppSettings
  }),

  getters: {
    actualTheme: (s): 'dark' | 'light' =>
      resolveTheme(s.settings.themeMode, mqDark.matches),

    /** 未进正式类型的本机键从这里读 */
    local: (s): LocalAppSettings => s.settings as LocalAppSettings,

    /** 是否把 API 配置（含密钥明文）一起保存到云端。默认关闭 */
    cloudSyncApi: (s): boolean => readFlag((s.settings as LocalAppSettings).cloudSyncApi)
  },

  actions: {
    async load() {
      this.settings = await window.api.settingsGetAll()
      this.applyAppearance()
      this.listenSystem()
      this.loaded = true
    },

    async update(key: keyof AppSettings, value: unknown) {
      await this.setRaw(key, value)
    },

    /**
     * 通用写入（字符串键名）。
     *
     * 存在的唯一理由：`cloudSyncApi` 这类尚未进入 AppSettings 类型的本机键也要能写。
     * 主进程按 key 白名单校验，键没同步加进去时会抛 Unknown setting —— 由调用方降级处理。
     */
    async setRaw(key: string, value: unknown) {
      this.settings = await window.api.settingsSet(key, value)
      this.applyAppearance()
    },

    setAccent(hex: string) {
      if (!isValidHex(hex)) throw new Error('配色必须是 6 位十六进制色值')
      return this.update('accentColor', normalizeHex(hex))
    },

    applyAppearance() {
      const root = document.documentElement
      root.dataset.theme = this.actualTheme
      root.style.setProperty('--accent', this.settings.accentColor)
    },

    listenSystem() {
      mqDark.addEventListener('change', () => {
        if (this.settings.themeMode === 'system') this.applyAppearance()
      })
    }
  }
})
