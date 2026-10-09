import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 15000,
    // 串行跑文件：并行时部分受限环境会出现临时目录写入失败（EPERM），
    // vitest 会把失败的文件静默跳过，导致"测试文件数忽多忽少"的假绿。
    // 串行后每次都是完整的 55 文件 / 360 用例，约 40 秒。
    fileParallelism: false,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // 只统计可单元测试的核心逻辑（Electron 窗体/系统集成与纯类型文件不计入）
      include: [
        'src/main/services/actions.ts',
        'src/main/services/backup.ts',
        'src/main/services/cloud-snapshot.ts',
        'src/main/services/cloud-storage.ts',
        'src/main/services/crypto.ts',
        'src/main/services/db-wrapper.ts',
        'src/main/services/hotkey-manager.ts',
        'src/main/services/image.ts',
        'src/main/services/model-config.ts',
        'src/main/services/quota.ts',
        'src/main/services/screenshot-actions.ts',
        'src/main/services/phrases.ts',
        'src/main/services/settings.ts',
        'src/main/services/term-io.ts',
        'src/main/services/term-library.ts',
        'src/main/services/term-match.ts',
        'src/main/services/term-update.ts',
        'src/main/services/translate-prompt.ts',
        'src/main/services/translate.ts',
        'src/main/services/updater.ts',
        'src/main/services/usage.ts',
        'src/shared/accelerator.ts',
        'src/shared/cloud.ts',
        'src/shared/colors.ts',
        'src/shared/defaults.ts',
        'src/shared/hotkeys.ts',
        'src/shared/providers.ts',
        'src/shared/theme.ts',
        'src/shared/update.ts',
        'src/shared/version.ts'
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70
      }
    }
  }
})
