import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/defaults'
import { resolveTheme } from '../../shared/theme'
import { isValidHex, normalizeHex } from '../../shared/colors'

const mqDark = window.matchMedia('(prefers-color-scheme: dark)')

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    settings: { ...DEFAULT_SETTINGS } as AppSettings
  }),

  getters: {
    actualTheme: (s): 'dark' | 'light' =>
      resolveTheme(s.settings.themeMode, mqDark.matches),

    /** 是否把 API 配置（含密钥明文）一起保存到云端。缺省一律按关闭处理 */
    cloudSyncApi: (s): boolean => Number(s.settings.cloudSyncApi ?? 0) === 1
  },

  actions: {
    async load() {
      this.settings = await window.api.settingsGetAll()
      this.applyAppearance()
      this.listenSystem()
      this.loaded = true
    },

    async update(key: keyof AppSettings, value: unknown) {
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
