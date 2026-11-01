export type ShandongAiMode = 'classic' | 'efficiency'

export const DEFAULT_SHANDONG_AI_MODE: ShandongAiMode = 'efficiency'
export const SHANDONG_AI_MODE_STORAGE_KEY = 'lianhua-guangma:shandong-ai-mode:v1'
export const SHANDONG_AI_MODES: ReadonlyArray<{ value: ShandongAiMode; label: string; description: string }> = [
  { value: 'classic', label: '经典 AI（旧版）', description: '按牌形和听口种类选牌，计算更轻。' },
  { value: 'efficiency', label: '牌效 AI（优化版）', description: '结合向听、有效进张和公开余张选牌。' },
]

export function isShandongAiMode(value: unknown): value is ShandongAiMode {
  return value === 'classic' || value === 'efficiency'
}

export function normalizeShandongAiMode(value: unknown): ShandongAiMode {
  return isShandongAiMode(value) ? value : DEFAULT_SHANDONG_AI_MODE
}

export function shandongAiModeLabel(value: unknown): string {
  return SHANDONG_AI_MODES.find(mode => mode.value === value)?.label ?? 'AI 模式未记录'
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readShandongAiModePreference(storage?: StorageLike): ShandongAiMode {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    return normalizeShandongAiMode(target?.getItem(SHANDONG_AI_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_SHANDONG_AI_MODE
  }
}

export function saveShandongAiModePreference(mode: ShandongAiMode, storage?: StorageLike): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    target?.setItem(SHANDONG_AI_MODE_STORAGE_KEY, normalizeShandongAiMode(mode))
  } catch {
    // 存储不可用时当前场次的内存设置仍生效。
  }
}
