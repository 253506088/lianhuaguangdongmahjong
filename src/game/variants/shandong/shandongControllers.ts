// 山东麻将控制器：人类（Promise + UI 桥接）与 AI（启发式纯决策封装）
import type { Ref } from 'vue'
import type { Meld, TileType } from '../../core/contracts/types'
import type { ActionPrompt } from '../../core/contracts/gamePort'
import type { ChiMeld } from './shandongRules'
import {
  decideClaim,
  decideRobKong,
  decideTurn,
  type ShandongClaimAction,
  type ShandongTurnDecision,
} from './shandongAi'
import { createPendingAction } from '../../shared/runtime/pendingAction'

export type { ShandongClaimAction }

export type ShandongTurnAction =
  | { kind: 'win' }
  | { kind: 'added-kong'; meldIndex: number }
  | { kind: 'concealed-kong'; tile: TileType }
  | { kind: 'discard'; handIndex: number; declareMingLou?: boolean; declareBaoTing?: boolean }

export interface ShandongTurnContext {
  hand: TileType[]
  melds: Meld[]
  isMingLou?: boolean
  isBaoTing?: boolean
  wallCount?: number
  skipDraw?: boolean
  luanJiang?: boolean
  visibleTiles?: readonly TileType[]
}

export interface ShandongHuContext {
  hand: TileType[]
  melds: Meld[]
  tile: TileType
  from: number
  canPeng: boolean
  canGang: boolean
  chiOptions: ChiMeld[]
  isMingLou?: boolean
  isBaoTing?: boolean
}

export interface ShandongClaimContext {
  hand: TileType[]
  melds: Meld[]
  canPeng: boolean
  canGang: boolean
  tile: TileType
  from: number
  chiOptions: ChiMeld[]
  isMingLou?: boolean
  isBaoTing?: boolean
}

export interface ShandongChiContext {
  hand: TileType[]
  melds: Meld[]
  tile: TileType
  from: number
  chiOptions: ChiMeld[]
}

export interface ShandongRobKongContext {
  hand: TileType[]
  melds: Meld[]
  tile: TileType
  from: number
  isBaoTing?: boolean
  luanJiang?: boolean
}

export type ShandongHuAction =
  | { kind: 'hu' }
  | { kind: 'peng' }
  | { kind: 'gang' }
  | { kind: 'chi'; meld: ChiMeld }
  | { kind: 'pass' }

export type ShandongChiAction = { kind: 'chi'; meld: ChiMeld } | { kind: 'pass' }
export type ShandongRobKongAction = 'win' | 'pass'

export interface ShandongController {
  requestTurn(ctx: ShandongTurnContext): Promise<ShandongTurnAction>
  requestHu(ctx: ShandongHuContext): Promise<ShandongHuAction>
  requestClaim(ctx: ShandongClaimContext): Promise<ShandongClaimAction>
  requestChi(ctx: ShandongChiContext): Promise<ShandongChiAction>
  requestRobKong(ctx: ShandongRobKongContext): Promise<ShandongRobKongAction>
  onDiscarded?(): void
  reset(): void
}

export interface ShandongHumanBridge {
  isTurn: Ref<boolean>
  canHu: Ref<boolean>
  canKong: Ref<TileType[]>
  canMingLou: Ref<boolean>
  canBaoTing?: Ref<boolean>
  actionPrompt: Ref<ActionPrompt | null>
  selectedIndex: Ref<number>
  drawnThisTurn: Ref<boolean>
  turnSeconds: Ref<number>
  activateTurn(): void
  activateClaim(): void
  activateChi(): void
  activateRobKong(): void
  deactivate(): void
}

export class ShandongHumanController implements ShandongController {
  private turnAction = createPendingAction<ShandongTurnAction>()
  private huAction = createPendingAction<ShandongHuAction>()
  private claimAction = createPendingAction<ShandongClaimAction>()
  private chiAction = createPendingAction<ShandongChiAction>()
  private robKongAction = createPendingAction<ShandongRobKongAction>()

  constructor(private bridge: ShandongHumanBridge) {}

  async requestTurn(ctx: ShandongTurnContext): Promise<ShandongTurnAction> {
    this.bridge.isTurn.value = true
    this.bridge.drawnThisTurn.value = !ctx.skipDraw
    this.bridge.selectedIndex.value = -1
    this.bridge.actionPrompt.value = null
    this.bridge.activateTurn()
    return this.turnAction.request()
  }

  async requestHu(ctx: ShandongHuContext): Promise<ShandongHuAction> {
    this.bridge.actionPrompt.value = {
      type: 'claim',
      tile: ctx.tile,
      from: ctx.from,
      canHu: true,
      canPeng: ctx.canPeng,
      canGang: ctx.canGang,
      chiOptions: ctx.chiOptions,
    }
    this.bridge.activateClaim()
    return this.huAction.request()
  }

  async requestClaim(ctx: ShandongClaimContext): Promise<ShandongClaimAction> {
    this.bridge.actionPrompt.value = {
      type: 'claim',
      tile: ctx.tile,
      from: ctx.from,
      canHu: false,
      canPeng: ctx.canPeng,
      canGang: ctx.canGang,
      chiOptions: ctx.chiOptions,
    }
    this.bridge.activateClaim()
    return this.claimAction.request()
  }

  async requestChi(ctx: ShandongChiContext): Promise<ShandongChiAction> {
    this.bridge.actionPrompt.value = {
      type: 'chi',
      tile: ctx.tile,
      from: ctx.from,
      chiOptions: ctx.chiOptions,
    }
    this.bridge.activateChi()
    return this.chiAction.request()
  }

  async requestRobKong(ctx: ShandongRobKongContext): Promise<ShandongRobKongAction> {
    this.bridge.actionPrompt.value = { type: 'rob', tile: ctx.tile, from: ctx.from, canHu: true }
    this.bridge.activateRobKong()
    return this.robKongAction.request()
  }

  onDiscarded(): void {
    this.bridge.drawnThisTurn.value = false
  }

  reset(): void {
    this.bridge.deactivate()
    this.bridge.isTurn.value = false
    this.bridge.actionPrompt.value = null
    this.bridge.selectedIndex.value = -1
    this.bridge.drawnThisTurn.value = false
    this.turnAction.clear()
    this.huAction.clear()
    this.claimAction.clear()
    this.chiAction.clear()
    this.robKongAction.clear()
  }

  hasPendingTurn() { return this.turnAction.hasPending() }
  hasPendingHu() { return this.huAction.hasPending() }
  hasPendingClaim() { return this.claimAction.hasPending() }
  hasPendingChi() { return this.chiAction.hasPending() }
  hasPendingRobKong() { return this.robKongAction.hasPending() }

  resolveDiscard(index: number, declareMingLou = false, declareBaoTing = false) {
    if (!this.turnAction.resolve({ kind: 'discard', handIndex: index, declareMingLou, declareBaoTing })) return
    this._cleanupTurn()
  }
  resolveWin() {
    if (!this.turnAction.resolve({ kind: 'win' })) return
    this._cleanupTurn()
  }
  resolveAddedKong(meldIndex: number) {
    if (!this.turnAction.resolve({ kind: 'added-kong', meldIndex })) return
    this._cleanupTurn()
  }
  resolveConcealedKong(tile: TileType) {
    if (!this.turnAction.resolve({ kind: 'concealed-kong', tile })) return
    this._cleanupTurn()
  }
  resolveHu(action: ShandongHuAction) {
    if (!this.huAction.resolve(action)) return
    this._cleanupHu()
  }
  resolveClaimPeng() {
    if (!this.claimAction.resolve({ kind: 'peng' })) return
    this._cleanupClaim()
  }
  resolveClaimGang() {
    if (!this.claimAction.resolve({ kind: 'gang' })) return
    this._cleanupClaim()
  }
  resolveClaimPass() {
    if (!this.claimAction.resolve({ kind: 'pass' })) return
    this._cleanupClaim()
  }
  resolveClaimChi(meld: ChiMeld) {
    if (!this.claimAction.resolve({ kind: 'chi', meld })) return
    this._cleanupClaim()
  }
  resolveChi(meld: ChiMeld) {
    if (!this.chiAction.resolve({ kind: 'chi', meld })) return
    this._cleanupChi()
  }
  resolveChiPass() {
    if (!this.chiAction.resolve({ kind: 'pass' })) return
    this._cleanupChi()
  }
  resolveRobKongAction(action: ShandongRobKongAction) {
    if (!this.robKongAction.resolve(action)) return
    this._cleanupRobKong()
  }

  private _cleanupTurn() {
    this.bridge.isTurn.value = false
    this.bridge.drawnThisTurn.value = false
    this.bridge.deactivate()
  }
  private _cleanupHu() {
    this.bridge.actionPrompt.value = null
    this.bridge.deactivate()
  }
  private _cleanupClaim() {
    this.bridge.actionPrompt.value = null
    this.bridge.deactivate()
  }
  private _cleanupChi() {
    this.bridge.actionPrompt.value = null
    this.bridge.deactivate()
  }
  private _cleanupRobKong() {
    this.bridge.actionPrompt.value = null
    this.bridge.deactivate()
  }
}

export class ShandongAiController implements ShandongController {
  constructor(
    private thinkMs = 850,
    private scheduler: (fn: () => void, ms: number) => void = (fn, ms) => setTimeout(fn, ms),
  ) {}

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.scheduler(resolve, ms))
  }

  async requestTurn(ctx: ShandongTurnContext): Promise<ShandongTurnAction> {
    await this.wait(this.thinkMs)
    return decideTurn(ctx)
  }

  async requestHu(ctx: ShandongHuContext): Promise<ShandongHuAction> {
    await this.wait(Math.min(this.thinkMs, 600))
    if (ctx.isMingLou || !ctx.isBaoTing) return { kind: 'pass' }
    return { kind: 'hu' }
  }

  async requestClaim(ctx: ShandongClaimContext): Promise<ShandongClaimAction> {
    await this.wait(Math.min(this.thinkMs, 600))
    return decideClaim({
      hand: ctx.hand,
      melds: ctx.melds,
      tile: ctx.tile,
      from: ctx.from,
      canHu: false,
      canPeng: ctx.canPeng,
      canGang: ctx.canGang,
      chiOptions: ctx.chiOptions,
      isMingLou: ctx.isMingLou,
      isBaoTing: ctx.isBaoTing,
    })
  }

  async requestChi(ctx: ShandongChiContext): Promise<ShandongChiAction> {
    await this.wait(Math.min(this.thinkMs, 600))
    if (ctx.chiOptions && ctx.chiOptions.length > 0) {
      return { kind: 'chi', meld: ctx.chiOptions[0] }
    }
    return { kind: 'pass' }
  }

  async requestRobKong(ctx: ShandongRobKongContext): Promise<ShandongRobKongAction> {
    await this.wait(Math.min(this.thinkMs, 500))
    if (!ctx.isBaoTing) return 'pass'
    return decideRobKong(ctx.hand, ctx.tile, ctx.melds, { luanJiang: ctx.luanJiang })
  }

  reset(): void {}
}
