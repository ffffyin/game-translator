import { defineStore } from 'pinia'

/**
 * 应用内下载安装包的状态机。
 *
 * 放在 stores 而不是 utils/composable，是因为**两个互不相干的组件要看同一份状态**：
 * 「关于软件」页的 AboutPage 和挂在 App.vue 根上的 UpdatePromptDialog。它们不在同一棵
 * 组件子树里（一个是 router-view 里的页面，一个是与 ToastHost 平级的浮层），
 * 用 composable 的话各自 `useXXX()` 会拿到两份互不相干的 ref —— 弹窗里下到 50%，
 * 页面上看还是 idle。Pinia store 是全局单例，正好解决这个，也和已有的
 * settings / models / auth 三个 store 同一套写法。
 *
 * 状态流转：idle → downloading → done | error → idle（重试）
 */
export type UpdateDownloadPhase = 'idle' | 'downloading' | 'done' | 'error'

export const useUpdateDownloadStore = defineStore('update-download', {
  state: () => ({
    phase: 'idle' as UpdateDownloadPhase,
    percent: 0,
    received: 0,
    total: 0,
    /** 下载完成的落盘路径（.idle 时为 ''） */
    path: '',
    /** 失败原因；下到一半被用户取消也算「失败」，靠 canceled 区分 */
    message: '',
    canceled: false,
    /** 是否订阅过进度推送，避免重复挂载 onUpdateProgress */
    subscribed: false
  }),

  getters: {
    downloading: (s): boolean => s.phase === 'downloading',
    finished: (s): boolean => s.phase === 'done'
  },

  actions: {
    subscribe() {
      if (this.subscribed) return
      this.subscribed = true
      window.api.onUpdateProgress((p) => {
        this.percent = p.percent
        this.received = p.received
        this.total = p.total
      })
    },

    /** 回到初始态：换一个更新开始时调用，避免上一轮的错误提示黏在界面上 */
    reset() {
      this.phase = 'idle'
      this.percent = 0
      this.received = 0
      this.total = 0
      this.path = ''
      this.message = ''
      this.canceled = false
    },

    async start(url: string, sha256: string, size: number) {
      this.subscribe()
      this.reset()
      this.phase = 'downloading'
      try {
        const r = await window.api.updateDownload(url, sha256, size)
        if (r.ok) {
          this.phase = 'done'
          this.path = r.path
          this.percent = 100
          return
        }
        this.phase = 'error'
        this.canceled = r.canceled === true
        this.message = r.message
      } catch (e) {
        // IPC 本身断了也要落到错误态，界面不能永远停在「下载中」
        this.phase = 'error'
        this.canceled = false
        this.message = e instanceof Error ? e.message : '下载失败'
      }
    },

    async cancel() {
      try {
        await window.api.updateCancel()
      } catch {
        // 取消通知没送到也要放手：下面的本地态照样回到 idle
      }
      this.reset()
    },

    /** 跑安装包并退出软件。返回 false 时错误原因写进 message 由界面显示 */
    async install(): Promise<boolean> {
      if (!this.path) {
        this.message = '安装包不存在，请重新下载'
        this.phase = 'error'
        return false
      }
      try {
        const r = await window.api.updateInstall(this.path)
        if (r.ok) return true
        this.message = r.message
        this.phase = 'error'
        return false
      } catch (e) {
        this.message = e instanceof Error ? e.message : '安装失败'
        this.phase = 'error'
        return false
      }
    },

    async reveal() {
      if (!this.path) return
      try {
        await window.api.updateReveal(this.path)
      } catch {
        // 打开资源管理器失败不必打扰用户，他自己能找到下载目录
      }
    }
  }
})
