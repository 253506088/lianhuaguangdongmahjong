import type { RuleVariant } from './ruleVariants'

export const RULE_PREFERENCE_STORAGE_KEY = 'lianhua-guangma:selected-rule:v1'
export const SHANDONG_JIANG_STORAGE_KEY = 'lianhua-guangma:shandong-jiang:v1'

const VALID_RULE_VARIANTS: ReadonlySet<string> = new Set([
  'lotus-classic',
  'lotus-legacy',
  'lotus-blood-flow',
  'shandong',
])

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读取保存的规则玩法，如果未保存或非法则返回 null */
export function readRuleVariantPreference(
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): RuleVariant | null {
  if (!storage) return null
  try {
    const stored = storage.getItem(RULE_PREFERENCE_STORAGE_KEY)
    if (stored && VALID_RULE_VARIANTS.has(stored)) {
      return stored as RuleVariant
    }
    return null
  } catch {
    return null
  }
}

/** 保存用户选中的规则玩法到本地存储 */
export function saveRuleVariantPreference(
  rule: RuleVariant,
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  try {
    storage?.setItem(RULE_PREFERENCE_STORAGE_KEY, rule)
  } catch {
    // 存储不可用时静默降级
  }
}

/** 读取保存的山东麻将将牌规则（258掌将 或 乱将） */
export function readShandongJiangPreference(
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): '258' | 'luan' {
  if (!storage) return '258'
  try {
    const stored = storage.getItem(SHANDONG_JIANG_STORAGE_KEY)
    return stored === 'luan' ? 'luan' : '258'
  } catch {
    return '258'
  }
}

/** 保存山东麻将将牌规则到本地存储 */
export function saveShandongJiangPreference(
  jiang: '258' | 'luan',
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  try {
    storage?.setItem(SHANDONG_JIANG_STORAGE_KEY, jiang)
  } catch {
    // 存储不可用时静默降级
  }
}
