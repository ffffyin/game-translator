import { defineStore } from 'pinia'
import type { ModelConfigView } from '../../shared/model'

export const useModelsStore = defineStore('models', {
  state: () => ({
    items: [] as ModelConfigView[],
    loaded: false
  }),

  getters: {
    defaultModel: (s): ModelConfigView | undefined => s.items.find((m) => m.is_default === 1)
  },

  actions: {
    async refresh() {
      this.items = await window.api.modelsList()
      this.loaded = true
    }
  }
})
