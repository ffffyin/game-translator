/// <reference types="vite/client" />
import type { ApiContract } from '../shared/api-contract'

declare global {
  interface Window {
    api: ApiContract
  }
}

export {}
