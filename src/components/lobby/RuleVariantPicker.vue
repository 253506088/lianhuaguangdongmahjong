<script setup lang="ts">
import { ref } from 'vue'
import { RULE_VARIANTS, BLOOD_FLOW_RULE, type RuleVariant } from '../../game/core/rules/ruleVariants'

const props = withDefaults(
  defineProps<{
    modelValue: RuleVariant
    allowBloodFlow?: boolean
    shandongJiang?: '258' | 'luan'
  }>(),
  {
    allowBloodFlow: false,
    shandongJiang: '258',
  },
)

const emit = defineEmits<{
  close: []
  confirm: [value: RuleVariant, jiang?: '258' | 'luan']
  viewRules: []
}>()

const pending = ref<RuleVariant>(props.modelValue)
const pendingJiang = ref<'258' | 'luan'>(props.shandongJiang)

function handleConfirm() {
  emit('confirm', pending.value, pending.value === 'shandong' ? pendingJiang.value : undefined)
}
</script>

<template>
  <div class="picker-options rule-picker-options">
    <button
      v-for="option in allowBloodFlow ? [...RULE_VARIANTS, BLOOD_FLOW_RULE] : RULE_VARIANTS"
      :key="option.id"
      type="button"
      data-action-role="secondary"
      :class="{ active: pending === option.id }"
      @click="pending = option.id"
    >
      <i aria-hidden="true"></i>
      <span>
        <b>{{ option.name }} <em v-if="option.badge">{{ option.badge }}</em></b>
        <small>{{ option.highlights.join(' · ') }}</small>
        <span
          v-if="option.id === 'shandong' && pending === 'shandong'"
          class="shandong-sub-options"
          @click.stop
        >
          <span
            class="sub-option-btn"
            :class="{ active: pendingJiang === '258' }"
            role="button"
            tabindex="0"
            @click="pendingJiang = '258'"
          >
            258掌将
          </span>
          <span
            class="sub-option-btn"
            :class="{ active: pendingJiang === 'luan' }"
            role="button"
            tabindex="0"
            @click="pendingJiang = 'luan'"
          >
            乱将
          </span>
        </span>
      </span>
    </button>
  </div>
  <button class="view-rules-link" type="button" data-action-role="light" @click="emit('viewRules')">查看详细规则 →</button>
  <div class="dialog-actions">
    <button class="secondary" type="button" data-action-role="light" @click="emit('close')">取消</button>
    <button class="primary" type="button" data-action-role="primary" @click="handleConfirm">确定</button>
  </div>
</template>
