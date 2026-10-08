import { contextBridge, ipcRenderer } from 'electron'
import type { ApiContract } from '../shared/api-contract'

function getStartupRoute(): string | undefined {
  // 优先同步向主进程取（渲染层 argv 不一定透传自定义参数）
  try {
    const v = ipcRenderer.sendSync('app:getStartupRoute')
    if (typeof v === 'string' && v) return v
  } catch {
    // 回退到本进程 argv
  }
  const a = process.argv
  const eq = a.find((x) => x.startsWith('--route='))
  if (eq) return eq.split('=').slice(1).join('=')
  const i = a.indexOf('--route')
  if (i >= 0 && a[i + 1]) return a[i + 1]
  return undefined
}

const api: ApiContract = {
  ping: () => ipcRenderer.invoke('app:ping'),
  startupRoute: getStartupRoute(),
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  getDataDir: () => ipcRenderer.invoke('app:getDataDir'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupRestore: (name: string) => ipcRenderer.invoke('backup:restore', name),
  resetToDefaults: () => ipcRenderer.invoke('app:resetToDefaults'),
  testTranslate: (text: string) => ipcRenderer.invoke('app:testTranslate', text),

  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsGet: (id) => ipcRenderer.invoke('models:get', id),
  modelsCreate: (input) => ipcRenderer.invoke('models:create', input),
  modelsUpdate: (id, input) => ipcRenderer.invoke('models:update', id, input),
  modelsDelete: (id) => ipcRenderer.invoke('models:delete', id),
  modelsSetDefault: (id) => ipcRenderer.invoke('models:setDefault', id),
  modelsTest: (id) => ipcRenderer.invoke('models:test', id),

  usageTotals: () => ipcRenderer.invoke('usage:totals'),
  usageTotalsToday: () => ipcRenderer.invoke('usage:totalsToday'),
  usageByConfig: () => ipcRenderer.invoke('usage:byConfig'),
  usageAggregateDays: (days) => ipcRenderer.invoke('usage:aggregateDays', days),

  quotaQuery: (id) => ipcRenderer.invoke('quota:query', id),
  quotaQueryAll: () => ipcRenderer.invoke('quota:queryAll'),

  hotkeysGetAll: () => ipcRenderer.invoke('hotkeys:getAll'),
  hotkeysRebind: (actionCode, accelerator) =>
    ipcRenderer.invoke('hotkeys:rebind', actionCode, accelerator),
  hotkeysSetEnabled: (actionCode, enabled) =>
    ipcRenderer.invoke('hotkeys:setEnabled', actionCode, enabled),

  onNotify: (cb) => {
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on('app:notify', listener)
    return () => ipcRenderer.removeListener('app:notify', listener)
  },

  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximized: (cb) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },

  regionSelect: (rect) => ipcRenderer.send('region:select', rect),
  regionCancel: () => ipcRenderer.send('region:cancel'),
  regionReady: () => ipcRenderer.send('region:ready'),

  onResultData: (cb) => {
    const listener = (_e: unknown, d: Parameters<typeof cb>[0]): void => cb(d)
    ipcRenderer.on('result:data', listener)
    return () => ipcRenderer.removeListener('result:data', listener)
  },
  resultRetranslate: (req) => ipcRenderer.invoke('result:retranslate', req),
  resultSetPinned: (pinned) => ipcRenderer.send('result:setPinned', pinned),
  resultClose: () => ipcRenderer.send('result:close'),
  resultCopy: (text) => ipcRenderer.send('result:copy', text),

  termsListLibs: () => ipcRenderer.invoke('terms:listLibs'),
  termsListTerms: (libId, search) => ipcRenderer.invoke('terms:listTerms', libId, search),
  termsCountTerms: (libId) => ipcRenderer.invoke('terms:countTerms', libId),
  termsCreateLib: (input) => ipcRenderer.invoke('terms:createLib', input),
  termsRenameLib: (id, name) => ipcRenderer.invoke('terms:renameLib', id, name),
  termsDeleteLib: (id) => ipcRenderer.invoke('terms:deleteLib', id),
  termsCreateTerm: (libId, input) => ipcRenderer.invoke('terms:createTerm', libId, input),
  termsUpdateTerm: (id, input) => ipcRenderer.invoke('terms:updateTerm', id, input),
  termsDeleteTerm: (id) => ipcRenderer.invoke('terms:deleteTerm', id),
  termsExportLib: (id) => ipcRenderer.invoke('terms:exportLib', id),
  termsImportLib: () => ipcRenderer.invoke('terms:importLib'),
  termsCheckUpdates: (url) => ipcRenderer.invoke('terms:checkUpdates', url),
  termsApplyUpdates: (url) => ipcRenderer.invoke('terms:applyUpdates', url),

  phrasesListPages: () => ipcRenderer.invoke('phrases:listPages'),
  phrasesCreatePage: (input) => ipcRenderer.invoke('phrases:createPage', input),
  phrasesUpdatePage: (id, patch) => ipcRenderer.invoke('phrases:updatePage', id, patch),
  phrasesRemovePage: (id) => ipcRenderer.invoke('phrases:removePage', id),
  phrasesSetActivePage: (id) => ipcRenderer.invoke('phrases:setActivePage', id),

  phrasesList: (pageId) => ipcRenderer.invoke('phrases:list', pageId),
  phrasesCreate: (pageId, content) => ipcRenderer.invoke('phrases:create', pageId, content),
  phrasesUpdate: (id, content) => ipcRenderer.invoke('phrases:update', id, content),
  phrasesSetEnabled: (id, enabled) => ipcRenderer.invoke('phrases:setEnabled', id, enabled),
  phrasesRemove: (id) => ipcRenderer.invoke('phrases:remove', id),
  phrasesMove: (id, direction) => ipcRenderer.invoke('phrases:move', id, direction)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore fallback
  window.api = api
}

export type Api = typeof api
