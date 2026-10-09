<script setup lang="ts">
import { onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import AccountLoginForm from '../components/account/AccountLoginForm.vue'
import AccountPanel from '../components/account/AccountPanel.vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'

const auth = useAuthStore()
const settings = useSettingsStore()

onMounted(async () => {
  await auth.refresh()
})
</script>

<template>
  <PageHeader
    title="账号与云同步"
    note="登录后可把术语库、常用语与偏好设置同步到云端，换一台电脑接着用"
  />

  <div class="wrap">
    <section v-if="!auth.status" class="m-card">
      <p class="loading">正在读取账号状态…</p>
    </section>

    <AccountPanel v-else-if="auth.signedIn" />

    <section v-else class="m-card">
      <div class="lab">登录后使用</div>
      <p class="tip">本软件需要先登录才能使用。登录标识是邮箱，密码由你自设。</p>
      <AccountLoginForm
        :remembered-email="settings.settings.cloudAccountEmail ?? ''"
        :initial-remember="settings.settings.cloudRememberAccount !== 0"
        :initial-save-password="Number(settings.settings.cloudSavePassword ?? 0) === 1"
        :initial-auto-login="Number(settings.settings.cloudAutoLogin ?? 0) === 1"
        :show-links="false"
      />
    </section>

    <section class="m-card note-card">
      <div class="lab">同步范围</div>
      <ul class="list">
        <li><b>会同步</b>：语言方向、翻译风格、OCR 通道、主题与配色、常用语开关、术语库更新地址</li>
        <li><b>会同步</b>：你自建的术语库（不含软件内置库）、全部常用语分页与条目</li>
        <li><b>不同步</b>：模型地址与 API Key —— 它们用本机 DPAPI 加密，换机器本就解不开，也绝不会上传</li>
        <li><b>不同步</b>：用量统计、备份文件、快捷键绑定（与本机强相关）</li>
        <li><b>API 配置</b>：默认不同步；开启后同步（含密钥明文）</li>
      </ul>
      <p class="tip dim">
        同步是整包覆盖，不是合并：保存到云端 = 用本机覆盖云端；从云端恢复 = 用云端覆盖本机（覆盖前会自动做一份本地备份）。
      </p>
    </section>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.lab {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.loading {
  font-size: 12.5px;
  color: var(--txt3);
}
.tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--txt2);
  margin-bottom: 12px;
}
.tip.dim {
  color: var(--txt3);
  margin-bottom: 0;
  margin-top: 10px;
}
.list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--txt2);
}
.list b {
  color: var(--txt);
}
</style>
