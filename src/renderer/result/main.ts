import { createApp } from 'vue'
import ResultView from './ResultView.vue'
import '../styles/tokens.css'
import '../styles/base.css'
import { resolveTheme } from '../../shared/theme'

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(null)
      }
    )
  })
}

async function boot(): Promise<void> {
  // 应用主题 token；IPC 不可用（如自检模式）时回退深色
  const s = await withTimeout(window.api.settingsGetAll(), 800)
  if (s) {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = resolveTheme(String(s.themeMode), systemDark)
    document.documentElement.dataset.theme = theme
    document.documentElement.style.setProperty('--accent', String(s.accentColor))
  } else {
    document.documentElement.dataset.theme = 'dark'
  }

  createApp(ResultView).mount('#app')
}

window.addEventListener('error', (e) => {
  document.getElementById('app')!.innerHTML =
    '<div style="color:#fff;padding:20px;font:14px monospace">ERROR ' + e.message + '<br>' + (e.error?.stack ?? '') + '</div>'
})
window.addEventListener('unhandledrejection', (e) => {
  document.getElementById('app')!.innerHTML =
    '<div style="color:#fff;padding:20px;font:14px monospace">REJECT ' + String(e.reason) + '</div>'
})

void boot()
