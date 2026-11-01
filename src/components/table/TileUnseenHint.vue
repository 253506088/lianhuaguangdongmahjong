<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { tileName } from '../../game/core/rules/tiles'
import { tileFaceUrl, type TileAssetTheme } from '../../game/core/presentation/tileAssets'
import type { TileType } from '../../game/core/contracts/types'
import { tileHintPosition, type TileHintAnchor } from './tileInspection'

const props = defineProps<{
  tile: TileType
  items: { tile: TileType; remaining: number }[]
  anchor: TileHintAnchor
  themeName: TileAssetTheme
  source: string
}>()
const panel = ref<HTMLElement | null>(null)
const position = ref({ left: 8, top: 8 })
const ready = ref(false)
const label = computed(() => props.items.map(item => `${tileName(item.tile)}，未知${item.remaining}张`).join('；'))
async function reposition() {
  await nextTick()
  if (!panel.value) return
  const rect = panel.value.getBoundingClientRect()
  position.value = tileHintPosition(props.anchor, rect.width, rect.height, window.innerWidth, window.innerHeight)
  ready.value = true
}
watch(() => [props.anchor, props.items.length], reposition, { immediate: true, flush: 'post' })
window.addEventListener('resize', reposition)
onBeforeUnmount(() => window.removeEventListener('resize', reposition))
</script>

<template>
  <aside ref="panel" class="tile-unseen-hint" role="status" aria-live="polite" :aria-label="label"
    :data-source="source" :style="{ left: `${position.left}px`, top: `${position.top}px`, visibility: ready ? 'visible' : 'hidden' }">
    <div class="tile-hint-heading"><strong>未知张数</strong><span>{{ source }}</span></div>
    <div class="tile-hint-items">
      <div v-for="item in items" :key="item.tile" class="tile-hint-item"
        :class="{ current: item.tile === tile, exhausted: item.remaining === 0 }"
        :data-tile="item.tile" :data-remaining="item.remaining">
        <img :src="tileFaceUrl(item.tile, themeName)" alt="" />
        <div><span class="tile-hint-name">{{ tileName(item.tile) }}</span><strong class="tile-hint-count">{{ item.remaining }}<small>张</small></strong></div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.tile-unseen-hint { position: fixed; z-index: 90; box-sizing: border-box; max-width: calc(100vw - 16px); padding: 8px; border: 1px solid var(--theme-accent, #f4cb63); border-radius: 12px; background: var(--theme-panel, #10251e); color: var(--theme-text, #fff4d0); box-shadow: 0 6px 22px #0009; pointer-events: none; user-select: none; }
.tile-hint-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 3px 6px; font-size: 11px; line-height: 1.3; }
.tile-hint-heading strong { font-weight: 600; }
.tile-hint-heading > span { margin-left: 12px; font-size: 10px; opacity: .7; }
.tile-hint-items { display: flex; }
.tile-hint-item { display: flex; align-items: center; padding: 5px 7px; border: 1px solid transparent; border-radius: 7px; background: #ffffff0a; }
.tile-hint-item + .tile-hint-item { margin-left: 5px; }
.tile-hint-item.current { border-color: var(--theme-accent, #f4cb63); background: #ffffff15; }
.tile-hint-item img { width: 24px; height: 34px; object-fit: contain; margin-right: 5px; border-radius: 3px; background: #f4f0df; }
.tile-hint-name { display: block; font-size: 11px; line-height: 1.4; white-space: nowrap; }
.tile-hint-count { display: block; font-size: 21px; line-height: 1.05; font-variant-numeric: tabular-nums; color: var(--theme-accent, #f4cb63); }
.tile-hint-count small { margin-left: 3px; font-size: 10px; font-weight: 400; color: var(--theme-text, #fff4d0); }
.tile-hint-item.exhausted .tile-hint-count { color: #ff8e82; }
@media (max-height: 500px), (max-width: 600px) {
  .tile-unseen-hint { padding: 6px; border-radius: 9px; }
  .tile-hint-item { padding: 4px 5px; }
  .tile-hint-item img { width: 20px; height: 29px; margin-right: 4px; }
  .tile-hint-count { font-size: 19px; }
}
</style>
