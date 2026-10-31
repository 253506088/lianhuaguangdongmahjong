<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { GamePlayer } from '../../game/core/contracts/types'
import { tileName } from '../../game/core/rules/tiles'
import type { TableThemeName } from './three/tableTheme'
import { themePresentationByName, themePresentationCssVariables } from '../../theme/themePresentation'
import MahjongTile from '../MahjongTile.vue'

const props = defineProps<{ player: GamePlayer; themeName?: TableThemeName }>()
const flowers = computed(() => props.player.melds.filter(m => m.type === 'flower').map(m => m.tile))
const open = ref(false)
const badge = ref<HTMLButtonElement>()
const closeButton = ref<HTMLButtonElement>()
const themeStyle = computed(() => themePresentationCssVariables(themePresentationByName(props.themeName ?? 'jade')))
watch(() => flowers.value.length, count => { if (!count) open.value = false })
watch(open, async value => { await nextTick(); (value ? closeButton.value : badge.value)?.focus() })
</script>

<template>
  <button v-if="flowers.length" ref="badge" type="button" class="flower-badge"
    :title="`花牌：${flowers.map(tileName).join('、')}`" :aria-label="`查看${player.name}的${flowers.length}张花牌`"
    :aria-expanded="open" @click.stop="open = !open">花 {{ flowers.length }}</button>
  <Teleport to="body">
    <div v-if="open && flowers.length" class="flower-backdrop" :style="themeStyle" @click.self="open = false" @keydown.esc="open = false">
      <section class="flower-detail" role="dialog" aria-modal="true" :aria-label="`${player.name}的花牌`">
        <header><div><small>{{ player.name }}</small><h2>已补花 · {{ flowers.length }} 张</h2></div><button ref="closeButton" type="button" aria-label="关闭花牌" @click="open = false" @keydown.tab.prevent="closeButton?.focus()">×</button></header>
        <div class="flower-detail-tiles"><figure v-for="tile in flowers" :key="tile"><MahjongTile :tile="tile" :theme-name="themeName" disabled /><figcaption>{{ tileName(tile) }}</figcaption></figure></div>
        <p>花牌在牌桌独立亮出，不占吃碰杠的位置。</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.flower-badge { cursor: pointer; font: inherit; pointer-events: auto; }
.flower-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 16px; background: #07120ecd; backdrop-filter: blur(6px); }
.flower-detail { width: min(350px, 100%); box-sizing: border-box; padding: 20px; border: 1px solid var(--theme-border); border-radius: 18px; background: var(--theme-panel-elevated, #18372e); color: var(--theme-text, #fff); box-shadow: 0 16px 60px #0008; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
header small, p { color: var(--theme-text-muted, #b8c5bf); }
h2 { margin: 4px 0 0; font-size: 20px; }
header button { border: 0; border-radius: 50%; background: #ffffff12; color: inherit; font-size: 24px; width: 40px; height: 40px; cursor: pointer; }
.flower-detail-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 8px; }
figure { margin: 0; text-align: center; }
figure :deep(.mahjong-tile) { width: 52px; height: 70px; margin: auto; }
figcaption { font-size: 14px; padding-top: 16px; }
p { margin: 18px 0 0; font-size: 12px; line-height: 1.6; }
@media (max-height: 440px) { .flower-detail { padding: 14px 20px; } header { margin-bottom: 10px; } figure :deep(.mahjong-tile) { width: 40px; height: 54px; } figcaption { padding-top: 12px; } p { margin-top: 10px; } }
</style>
