import { defineStore } from 'pinia'
import { offlineStatus, type CloudStatus } from '../../shared/cloud'

/**
 * 全局登录态（渲染层的唯一事实来源）。
 *
 * 判定依据只有一条：**本机是否存在有效会话**，即主进程 cloudStatus() 回传的 signedIn。
 * 这里**不做任何联网校验** —— 断网时主进程返回的是 signedIn=true + online=false，
 * 用户照常使用软件，只有云端读写会提示「网络不可用」。反过来也一样：一次 IPC 抖动
 * 读不到状态，不代表会话失效，因此 refresh 失败且本地已有登录态时原样保留。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    status: null as CloudStatus | null,
    /** status 是否已回填过一次。false 时路由守卫一律放行，避免开局把人误拦到登录页 */
    ready: false,
    /**
     * 启动门控带回来的提示（自动登录失败的原因等）。
     *
     * 单独存一份是因为 refresh() 随后会覆盖 status —— 而自动登录失败的原因
     * 恰恰必须让用户看见（断网和被改密码是两件事），不能静默消失。
     * 登录成功后自动清空。
     */
    bootMessage: null as string | null
  }),

  getters: {
    signedIn: (s): boolean => s.status?.signedIn === true,
    /** 网络是否通畅。status 尚未拿到时按在线处理，避免冷启动闪一下「离线」 */
    online: (s): boolean => s.status?.online !== false,
    /** 云端能力是否可用（配置齐全、初始化成功） */
    available: (s): boolean => s.status?.available !== false,
    email: (s): string => s.status?.email ?? '',
    /** 展示用昵称。**不参与鉴权**，只用于界面显示 */
    accountName: (s): string => s.status?.accountName ?? '',
    remoteUpdatedAt: (s): string | null => s.status?.remoteUpdatedAt ?? null,
    remoteSummary: (s) => s.status?.remoteSummary ?? null
  },

  actions: {
    /** 表单拿到 CloudAuthResult 后回填登录态，省掉一次额外的 cloudStatus 往返 */
    applyStatus(next: CloudStatus | null | undefined): void {
      this.status = next ?? null
      if (this.status?.signedIn) this.bootMessage = null
    },

    /**
     * 启动门控：渲染层起来后**第一个**调用，必须在 refresh() 之前。
     *
     * 未开启「自动登录」时主进程会清掉本机会话并返回未登录（每次打开都要重新登录）；
     * 开启时用保存的邮箱 + 密码走一次真实联网登录。失败的原因留在 bootMessage 里，
     * 由登录页显示 —— 静默回到登录页会让人以为软件坏了。
     */
    async prepareBoot(): Promise<CloudStatus | null> {
      try {
        const next = await window.api.cloudPrepareBoot()
        if (next && typeof next.signedIn === 'boolean') {
          this.applyStatus(next)
          if (!next.signedIn && next.message) this.bootMessage = next.message
        }
      } catch {
        // 门控失败也要继续往下走：refresh() 会再判一次，最坏结果只是停在登录页
      }
      return this.status
    },

    /** 重新读取登录态。**离线可用**：成败都不改变「本地会话是否有效」这一判定 */
    async refresh(): Promise<CloudStatus | null> {
      try {
        const next = await window.api.cloudStatus()
        if (next && typeof next.signedIn === 'boolean') this.status = next
        else this.status = offlineStatus('读取登录状态失败，请重启软件重试')
      } catch {
        // IPC 异常不等于没登录：已有登录态时原样保留，绝不因为一次读失败就把人踢下线
        if (!this.status) this.status = offlineStatus('读取登录状态失败，请重启软件重试')
      } finally {
        this.ready = true
      }
      return this.status
    },

    /** 退出登录。无论 IPC 成败都刷新一次，保证界面与本机会话一致 */
    async signOut(): Promise<{ ok: boolean; message: string }> {
      let result: { ok: boolean; message: string } = { ok: false, message: '' }
      try {
        result = await window.api.cloudSignOut()
      } catch (e) {
        result = { ok: false, message: e instanceof Error ? e.message : '' }
      }
      await this.refresh()
      return result
    }
  }
})
