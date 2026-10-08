<script setup lang="ts">
import { onMounted } from 'vue'
import SideNav from './components/SideNav.vue'
import ToastHost from './components/ToastHost.vue'
import { useSettingsStore } from './stores/settings'
import { useModelsStore } from './stores/models'

const settings = useSettingsStore()
const models = useModelsStore()

onMounted(async () => {
  await settings.load()
  await models.refresh()
})
</script>

<template>
  <div class="app-shell">
    <SideNav />
    <main class="content">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 26px 28px;
}
</style>
