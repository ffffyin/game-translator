import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/tokens.css'
import './styles/base.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 支持 --route=/xxx 启动直达页面（也供自动化/深链使用）
const startRoute = window.api.startupRoute
if (startRoute && startRoute.startsWith('/')) router.replace(startRoute)

app.mount('#app')
