export interface LibView {
  id: number
  game: string
  name: string
  version: string
  source_url: string | null
  is_builtin: number
  term_count: number
  updated_at: string
}

export interface TermView {
  id: number
  lib_id: number
  source_text: string
  target_text: string
  tag: string | null
  is_custom: number
  updated_at: string
}

export interface TermInput {
  source_text: string
  target_text: string
  tag?: string
}
