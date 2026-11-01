<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_SHANDONG_AI_MODE, SHANDONG_AI_MODES, normalizeShandongAiMode, type ShandongAiMode } from '../game/variants/shandong/shandongAiMode'

const props = withDefaults(defineProps<{ modelValue?: ShandongAiMode; disabled?: boolean }>(), {
  modelValue: DEFAULT_SHANDONG_AI_MODE,
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [mode: ShandongAiMode] }>()
const selected = computed(() => SHANDONG_AI_MODES.find(mode => mode.value === normalizeShandongAiMode(props.modelValue))!)
</script>

<template>
  <label class="shandong-ai-mode">
    <span>AI 模式</span>
    <select aria-label="山东麻将 AI 模式" :value="selected.value" :disabled="disabled"
      @change="emit('update:modelValue', normalizeShandongAiMode(($event.target as HTMLSelectElement).value))">
      <option v-for="mode in SHANDONG_AI_MODES" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
    </select>
    <small>{{ selected.description }}</small>
  </label>
</template>

<style scoped>
.shandong-ai-mode {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 4px 12px;
  margin: 8px 0;
  color: var(--theme-text, #f4f1e7);
}
.shandong-ai-mode > span { font-size: 14px; font-weight: 600; }
.shandong-ai-mode select {
  min-width: 0;
  min-height: 38px;
  padding: 6px 10px;
  border: 1px solid var(--theme-border, #47645a);
  border-radius: 8px;
  background: var(--theme-panel, #1b2d28);
  color: inherit;
  font: inherit;
}
.shandong-ai-mode small { grid-column: 1 / -1; color: var(--theme-text-muted, #a5b8ac); font-size: 12px; }
</style>
