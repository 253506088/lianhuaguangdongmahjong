<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { defaultAvatarForSeat } from '../game/core/presentation/avatar'
import { displayImageSrc, materializedImageVersion } from '../game/core/presentation/imagePreload'
import type { GamePlayer, TileType } from '../game/core/contracts/types'
import type { TableThemeName } from './table/three/tableTheme'
import { animeCharacterAccent } from '../game/core/presentation/animeCharacterPalette'
import { scoreDirection } from '../theme/themeEventPresentation'
import MahjongTile from './MahjongTile.vue'

const props = withDefaults(defineProps<{
  player: GamePlayer
  active?: boolean
  actionActive?: boolean
  scoreDelta?: number
  scoreFlowId?: number
  position: string
  dealer?: boolean
  themeName?: TableThemeName
  /** 主题表现头像覆盖，不修改权威玩家 avatar。 */
  avatarOverride?: string
  /** AI 大模型吐槽气泡（可选；由上层管理过期） */
  bubble?: { text: string; id: number; persistent?: boolean } | null
  /** 明搂听牌与剩余张数（他人视角） */
  mingLouWaits?: Array<{ tile: TileType; remaining: number; fan?: number }>
}>(), { active: false, actionActive: false, scoreDelta: 0, scoreFlowId: 0, dealer: false, avatarOverride: undefined, bubble: null, mingLouWaits: undefined })

// 外部头像（联机真人）加载失败 → 回退到本地座位默认头像
// 已物化的头像用本地 blob（座位会随快照重建，避免每次重建都做一次协商校验）。
const avatarSrc = ref(displayImageSrc(props.avatarOverride || props.player.avatar))
watch(() => [props.avatarOverride, props.player.avatar, materializedImageVersion.value], () => {
  avatarSrc.value = displayImageSrc(props.avatarOverride || props.player.avatar)
})
function onAvatarError() {
  avatarSrc.value = displayImageSrc(props.avatarOverride && avatarSrc.value !== props.player.avatar
    ? props.player.avatar
    : defaultAvatarForSeat(props.player.seat))
}
const animeStyle = computed(() => props.themeName === 'llmAnime'
  ? { '--anime-accent': animeCharacterAccent(props.player.characterId) }
  : undefined)
const flowerCount = computed(() => (props.player.melds || []).filter((m) => m.type === 'flower').length)
</script>

<template>
  <section class="player-seat" :class="[`seat-${position}`, { active, 'action-active': actionActive }]" :style="animeStyle">
    <div class="avatar-wrap">
      <span v-if="dealer" class="dealer-badge">庄</span>
      <span v-if="player.isMingLou" class="minglou-badge" title="明搂">搂</span>
      <span v-if="player.isBaoTing && !player.isMingLou" class="baoting-badge" title="报听">听</span>
      <span v-if="flowerCount > 0" class="flower-badge" :title="`花牌: ${flowerCount}张`">🌸{{ flowerCount }}</span>
      <img class="avatar" :src="avatarSrc" :alt="`${player.name}头像`" @error="onAvatarError" />
      <div class="player-info">
        <strong>{{ player.name }}</strong>
        <span>{{ player.score }}</span>
      </div>
      <slot name="footer" />
      <span v-if="active" class="turn-dot"></span>
      <Transition name="score-flow">
        <strong
          v-if="scoreDelta"
          :key="`${scoreFlowId}-${player.seat}`"
          class="score-delta"
          :class="scoreDirection(scoreDelta)"
          :data-score-direction="scoreDirection(scoreDelta)"
        >{{ scoreDelta > 0 ? '+' : '' }}{{ scoreDelta }}</strong>
      </Transition>
      <Transition name="llm-bubble">
        <div v-if="bubble" :key="bubble.id" class="llm-bubble" role="status" aria-live="polite">{{ bubble.text }}</div>
      </Transition>
    </div>
    <!-- 明搂听牌与剩余张数展示 -->
    <div v-if="player.isMingLou && mingLouWaits?.length" class="minglou-waits-card" :class="`waits-${position}`">
      <span class="minglou-waits-label">胡</span>
      <div class="minglou-waits-list">
        <div v-for="item in mingLouWaits" :key="item.tile" class="minglou-wait-tile" :class="{ exhausted: item.remaining === 0 }">
          <MahjongTile :tile="item.tile" :theme-name="themeName" small disabled />
          <span v-if="item.fan" class="minglou-wait-fan">{{ item.fan }}番</span>
          <span class="minglou-wait-remain">{{ item.remaining }}张</span>
        </div>
      </div>
    </div>
  </section>
</template>
