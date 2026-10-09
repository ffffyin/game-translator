<script setup lang="ts">
import { useModelsStore } from '../stores/models'
const models = useModelsStore()

const nav = [
  {
    to: '/home',
    label: '主页',
    icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'
  },
  {
    to: '/mode',
    label: '模式',
    icon: 'M4 6h16M4 12h16M4 18h16'
  },
  {
    to: '/phrases',
    label: '常用语',
    icon: 'M21 14a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h13a2 2 0 012 2z'
  },
  {
    to: '/quota',
    label: 'AI 额度',
    icon: 'M3 7h18v12H3zM3 11h18'
  },
  {
    to: '/config',
    label: '模型配置',
    icon: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1'
  },
  {
    to: '/account',
    label: '账号同步',
    icon: 'M4 7a4 4 0 014-4h8a4 4 0 014 4v10a4 4 0 01-4 4H8a4 4 0 01-4-4zM12 8v4M12 15.5h.01'
  },
  {
    to: '/about',
    label: '关于软件',
    icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5h.01'
  }
]
</script>

<template>
  <aside class="side">
    <div class="logo">
      <span class="lg">译</span>
      <b>游戏翻译助手</b>
    </div>

    <nav class="nav">
      <router-link v-for="n in nav" :key="n.to" :to="n.to" class="nav-item" active-class="on">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path :d="n.icon" />
        </svg>
        {{ n.label }}
      </router-link>
    </nav>

    <div class="foot">
      <span class="dot" :class="{ ok: models.defaultModel }"></span>
      {{ models.defaultModel ? models.defaultModel.name : '等待配置模型' }}
    </div>
  </aside>
</template>

<style scoped>
.side {
  width: 172px;
  flex-shrink: 0;
  background: var(--side);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 18px 13px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 8px 18px;
}
.lg {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  color: #161a21;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.logo b {
  font-size: 13.5px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 11px;
  border-radius: 8px;
  font-size: 15px;
  color: var(--txt2);
  text-decoration: none;
}
.nav-item svg {
  width: 19px;
  height: 19px;
}
.nav-item:hover,
.nav-item:focus,
.nav-item:focus-visible,
.nav-item:active,
.nav-item:visited,
.nav-item.on {
  color: var(--txt);
  text-decoration: none;
}
.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.foot {
  margin-top: auto;
  font-size: 11px;
  color: var(--txt3);
  padding: 10px 8px 0;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 7px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--txt3);
}
.dot.ok {
  background: var(--teal);
}
</style>
