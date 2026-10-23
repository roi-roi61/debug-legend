import type { JobId, SaveData } from '../types'
import { changeJob, canEvolve, evolve, fight, isJobUnlocked } from './battle'
import { TIME } from './config'
import { applyToolSuccess, applyTurn } from './fuel'
import { combatPower, pullLamp } from './gear'
import { newSave } from './save'

// 成長ペースのシミュレーション（tests/pace.test.ts と /dl-cheat sim で使う）。
// 「普通に Claude を使う人」の 1 日を仮定して、何日目に何 Lv・どの章まで行くかを計算する。

export type Profile = {
  /** Claude が作業している時間（戦闘が加速する） */
  workingHours: number
  /** セッションを開いているが作業していない時間 */
  idleHours: number
  /** 閉じている時間（受け取れるのは最大 8 時間） */
  offlineHours: number
  /** 1 日の回答の回数 */
  turns: number
  /** 1 日のツール呼び出しの回数（成功） */
  toolCalls: number
  /** 1 回の回答のトークン数 */
  tokensPerTurn: number
  /** Lv20 でどの職に転職するか */
  job: JobId
}

/** 想定する「普通の人」: 1 日 2 時間作業 + 4 時間開いたまま、夜は閉じる。回答 40 回 */
export const TYPICAL: Profile = {
  workingHours: 2,
  idleHours: 4,
  offlineHours: 18,
  turns: 40,
  toolCalls: 250,
  tokensPerTurn: 30_000,
  job: 'backend-knight',
}

export type DayLog = { day: number; level: number; chapter: number; stage: number; power: number; job: JobId; evolution: number; isCleared: boolean }

const HOUR = 3600

export function simulate(profile: Profile, days: number, start = 0): DayLog[] {
  let save: SaveData = newSave(start)
  const logs: DayLog[] = []
  const openHours = profile.workingHours + profile.idleHours
  const now = start

  const pullAll = (): void => {
    for (let pulled = pullLamp(save, now); pulled !== undefined; pulled = pullLamp(save, now)) {
      save = pulled.save
    }
    // 解放されたらすぐ転職、進化できたらすぐ進化する
    if (save.job === 'novice' && isJobUnlocked(save)) {
      save = changeJob(save, profile.job, now) ?? save
    }
    while (canEvolve(save)) {
      save = evolve(save) ?? save
    }
  }

  for (let day = 1; day <= days; day += 1) {
    const key = `day-${day}`
    // 閉じていた分（最大 8 時間、加速なし）
    save = fight(save, (Math.min(profile.offlineHours * HOUR * 1000, TIME.offlineCapMs) / 1000) * TIME.battleSpeed, now).save
    pullAll()
    for (let hour = 0; hour < openHours; hour += 1) {
      const isWorking = hour < profile.workingHours
      save = fight(save, HOUR * TIME.battleSpeed * (isWorking ? TIME.workingMultiplier : 1), now).save
      const turns = Math.round(profile.turns / openHours)
      for (let i = 0; i < turns; i += 1) {
        save = applyTurn(save, key, profile.tokensPerTurn).save
      }
      const tools = Math.round(profile.toolCalls / openHours)
      for (let i = 0; i < tools; i += 1) {
        save = applyToolSuccess(save, key).save
      }
      pullAll()
    }
    logs.push({ day, level: save.level, chapter: save.stage.chapter, stage: save.stage.stage, power: combatPower(save), job: save.job, evolution: save.evolution, isCleared: save.isCleared })
  }

  return logs
}

/** 何日目に条件を満たしたか（満たさなければ undefined） */
export const firstDay = (logs: readonly DayLog[], test: (log: DayLog) => boolean): number | undefined => logs.find(test)?.day
