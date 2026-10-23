import type { BattleReport, JobId, SaveData } from '../types'
import { BALANCE, BATTLE, EVOLUTION, JOBS, JOB_CHANGE, TRAVEL } from './config'
import { addExp } from './level'
import { isUnlocked, READY } from './calendar'
import { buffRate, useCharge } from './buffs'
import { combatPower, hasBossGear, setCount } from './gear'
import { bossRetrySeconds as psychicRetrySeconds, hasPsychicNode, psychicBossMemory, psychicStarReward, recordPsychicProc, rememberPsychicBoss } from './psychic'
import { activePets, petBattleEffects, shareBattleExp } from './pets'
import { BOSS_STAGE, CHAPTER_COUNT, WAVE, farmStage, stageGroup } from './world'

// 時間で進む戦闘。$ を使わない純粋な関数（同じセーブと秒数なら同じ結果）。
// 雑魚: 1 ステージ = 1 つの群れ（10〜30 匹、3 匹ずつの波で戦う）。1 秒に倒せる数 = 1 秒のダメージ ÷ 雑魚の HP（1 匹あたりの最短の秒数あり）。全員倒すとステージクリア。
// ボス（各章 10 ステージ目）: 制限時間内に倒せれば次の章へ。倒せないか先に倒れたら負けて、その章の 1〜9 面をめぐって稼ぎ（面はランダム）、しばらくして再挑戦。
// 移動: 群れを全部倒す・ボスの勝ち負けが決まる・ボスに挑むたびに、次の群れ（ボス）のところまで TRAVEL.seconds 移動する。
// そのあいだは戦闘が止まっている（倒した数もボス戦の秒数も進まない）。移動の残りは stage.travel。

const B = BALANCE

/** ハード周回（docs/DAILY.md の 14 章）: 敵の HP・攻撃 3 倍、経験値・ゴールド 2.5 倍。ふつう（周回 0）は 1 倍で、計算は変わらない */
export const HARD = { enemy: 3, reward: 2.5 }
export const hardEnemy = (save: Pick<SaveData, 'hard'>): number => (save.hard.loop > 0 ? HARD.enemy : 1)
export const hardReward = (save: Pick<SaveData, 'hard'>): number => (save.hard.loop > 0 ? HARD.reward : 1)

/** 雑魚の群れを倒し切ったときの図鑑の討伐数 */
export function recordKills(save: SaveData, ids: readonly string[]): SaveData {
  const kills = { ...save.codex.kills }
  for (const id of ids) {
    kills[id] = Math.min(999_999, (kills[id] ?? 0) + 1)
  }

  return { ...save, codex: { ...save.codex, kills } }
}

/** 図鑑のボスの勝ち（回数と最短の勝ち時間） */
function recordBossWin(save: SaveData, chapter: number, seconds: number): SaveData {
  const best = save.codex.bossBest[chapter]

  return {
    ...save,
    codex: {
      ...save.codex,
      bossWins: { ...save.codex.bossWins, [chapter]: Math.min(999_999, (save.codex.bossWins[chapter] ?? 0) + 1) },
      bossBest: best === undefined || seconds < best ? { ...save.codex.bossBest, [chapter]: seconds } : save.codex.bossBest,
    },
  }
}

/** 移動の残りの秒数（戦闘の秒数） */
export const travelLeft = (save: SaveData): number => save.stage.travel ?? 0

/** 次の群れ（ボス）のところに着いたばかりの位置（ここから移動する）。from は前にいた面（面がとぶときだけ書く） */
const arrive = (chapter: number, stage: number, from?: number) => ({ chapter, stage, kills: 0, bossTime: 0, travel: TRAVEL.seconds, ...(from === undefined ? {} : { from }) })

/** 稼ぎの次の面（その章の 1〜9 面から、いまの面以外をランダムに。戦闘の秒数から決めるので、同じセーブなら同じ面） */
const farmArrive = (save: SaveData) =>
  arrive(save.stage.chapter, farmStage(save.stage.chapter, save.stage.stage, Math.round(save.battleSeconds * 1000)), save.stage.stage)

/** ステージの通し番号（第 1 章 1 ステージ目が 0） */
export const stageIndex = (chapter: number, stage: number): number => (chapter - 1) * BOSS_STAGE + (stage - 1)

/** ステージの強さの基準（雑魚を倒す速さ killSpeed をかける前の、雑魚 1 匹の HP） */
const baseHp = (n: number): number => B.enemyHp * (1 + B.enemyHpPerStage * n) * Math.pow(B.enemyHpGrowth, n)
const baseExp = (n: number): number => B.expPerKill * Math.pow(B.expGrowth, n)
const baseGold = (n: number): number => B.goldPerKill * Math.pow(B.expGrowth, n)

/** 雑魚 1 匹の HP（倒す速さが 2 倍なら半分） */
export const enemyHp = (n: number): number => baseHp(n) / B.killSpeed
export const bossHp = (n: number): number => baseHp(n) * B.bossHpRate
export const bossAttack = (n: number): number => baseHp(n) * B.bossAttackRate
/** 雑魚 1 匹の経験値・ゴールド（倒す速さが 2 倍なら半分。1 秒あたりは同じ） */
export const expPerKill = (n: number): number => baseExp(n) / B.killSpeed
export const goldPerKill = (n: number): number => baseGold(n) / B.killSpeed
export const bossExp = (n: number): number => baseExp(n) * B.bossRewardRate
export const bossGold = (n: number): number => baseGold(n) * B.bossRewardRate

export type HeroStats = {
  power: number
  /** 雑魚 1 体への 1 秒のダメージ（会心込み、範囲なし） */
  mobDps: number
  /** 雑魚相手の 1 秒のダメージ（会心・範囲込み） */
  dps: number
  /** ボス相手の 1 秒のダメージ（会心込み、範囲なし） */
  bossDps: number
  hp: number
  /** 受けるダメージの倍率（騎士は小さい） */
  damageTaken: number
  /** フクロウの手伝いによるボス戦の延長 */
  bossTimeBonus: number
}

export function heroStats(save: SaveData, pet = petBattleEffects(save)): HeroStats {
  const job = JOBS[save.job]
  const power = combatPower(save)
  const iron = setCount(save, 'iron-guardian')
  const crystal = setCount(save, 'crystal-sage')
  const mithril = setCount(save, 'mithril-swift')
  const adamant = setCount(save, 'adamant-lord')
  const attackSet = (adamant >= 2 ? 0.1 : 0) + (hasBossGear(save, 'loop-ring') ? 0.05 : 0)
  const critRate = Math.min(1, job.critRate + buffRate(save, 'crit') + pet.critRate + (hasBossGear(save, 'zero-day-dagger') ? 0.08 : 0) + (hasPsychicNode(save, 'mind-3') ? 0.02 : 0))
  const critDamage = job.critDamage + (adamant >= 4 ? 0.2 : 0) + (hasPsychicNode(save, 'mind-6') ? 0.1 : 0)
  const companionBonus = hasBossGear(save, 'dependency-staff') ? 0.2 : 0
  const petAttack = pet.attackRate + companionBonus
  const psychicAttack = (hasPsychicNode(save, 'mind-1') ? 0.03 : 0) + (hasPsychicNode(save, 'mind-2') ? 0.04 : 0)
  const hit = power * B.dpsPerPower * job.attack * (1 + critRate * (critDamage - 1)) * (1 + buffRate(save, 'power') + petAttack + attackSet + psychicAttack)
  const attackSpeed = mithril >= 2 ? 1.1 : 1
  const doubleStrike = hasPsychicNode(save, 'mind-7') ? 1.1 : 1
  const hydraArea = hasBossGear(save, 'hydra-armor') ? 1.15 : 1
  const bossAttackRate = hasBossGear(save, 'daemon-helm') ? 1.125 : 1
  const meteor = hasPsychicNode(save, 'mind-5') ? hit * attackSpeed * doubleStrike * (4 / 45) : 0
  const bossDamageRate =
    1 + pet.bossRate + (hasPsychicNode(save, 'mind-8') ? 0.08 : 0) + (hasPsychicNode(save, 'future-9') ? psychicBossMemory(save, save.stage.chapter) * 0.05 : 0)
  const mobDps = hit * attackSpeed * doubleStrike + meteor
  // セット 6 個の生存効果は平均 HP、盾・鎖・外套は受けるダメージの近似値として反映する。
  const hpRate = 1 + buffRate(save, 'bossHp') + buffRate(save, 'heal') + pet.hpRate + (iron >= 2 ? 0.1 : 0) + (iron >= 6 ? 0.2 : 0) + (hasPsychicNode(save, 'future-1') ? 0.05 : 0)
  const damageRate = (iron >= 4 ? 0.9 : 1) * (hasBossGear(save, 'deadlock-chain') ? 1 / 1.15 : 1) * (hasBossGear(save, 'not-found-cloak') ? 0.9 : 1) * (hasBossGear(save, 'merge-shield') ? 0.9 : 1) * (hasPsychicNode(save, 'future-2') ? 0.96 : 1)

  return {
    power,
    mobDps,
    dps: mobDps * job.aoe * hydraArea * (hasPsychicNode(save, 'mind-4') ? 1.05 : 1),
    bossDps: (hit * attackSpeed * doubleStrike * bossAttackRate + meteor) * bossDamageRate,
    hp: power * B.hpPerPower * job.hp * hpRate,
    damageTaken: Math.max(0.1, (1 - job.defense) * (1 - pet.protectRate) * damageRate),
    bossTimeBonus: pet.bossSeconds + (crystal >= 6 ? 4 : 0) + (hasPsychicNode(save, 'future-5') ? 5 : 0) + (hasPsychicNode(save, 'future-10') ? 10 : 0),
  }
}

/** いまのステージの群れの数 */
export const groupSize = (save: SaveData): number => Math.max(1, stageGroup(save.stage.chapter, save.stage.stage).length)

/** まだ倒していない数 */
export const remainingFoes = (save: SaveData): number => Math.max(0, groupSize(save) - Math.floor(save.stage.kills + 1e-9))

/** いまの波（3 匹ずつ）の残り。範囲攻撃（魔導士）の条件に使う */
export function waveLeft(foes: number, kills: number): number {
  const defeated = Math.floor(kills + 1e-9)

  return Math.max(0, Math.min(foes, (Math.floor(defeated / WAVE) + 1) * WAVE) - defeated)
}

/** 1 秒に倒せる雑魚の数。範囲攻撃（魔導士）は、いまの波の残りが 2 匹以上のときだけ効く（上限もその分だけ上がる） */
export function killRate(save: SaveData): number {
  return killRateWithHero(save, heroStats(save), buffRate(save, 'killSpeed'), setCount(save, 'mithril-swift') >= 4, hasBossGear(save, 'hydra-armor'), groupSize(save))
}

function killRateWithHero(save: SaveData, hero: HeroStats, killSpeed: number, mithrilFast: boolean, hydra: boolean, foes: number): number {
  const n = stageIndex(save.stage.chapter, save.stage.stage)
  const aoe = waveLeft(foes, save.stage.kills) >= 2
    ? JOBS[save.job].aoe * (hydra ? 1.15 : 1) * (hasPsychicNode(save, 'mind-4') ? 1.05 : 1)
    : 1

  // ポップコーン（料理）: 雑魚を倒す速さ
  return Math.min((aoe * B.killSpeed) / B.minSecondsPerEnemy, (hero.mobDps * aoe) / (enemyHp(n) * hardEnemy(save))) * (1 + killSpeed) * (mithrilFast ? 1.1 : 1)
}

export type BossOutcome = { isWin: boolean; killTime: number; surviveTime: number; duration: number }

/** いまの強さでボスと戦ったらどうなるか */
export function bossOutcome(save: SaveData): BossOutcome {
  return bossOutcomeWithHero(save, heroStats(save))
}

function bossOutcomeWithHero(save: SaveData, hero: HeroStats): BossOutcome {
  const n = stageIndex(save.stage.chapter, BOSS_STAGE)
  const hard = hardEnemy(save)

  return customBossOutcome(save, hero, bossHp(n) * hard, bossAttack(n) * hard, B.bossSeconds)
}

/**
 * 強さ（HP・1 秒の攻撃・制限時間）を決めたボスと戦ったらどうなるか。本編のボス・魂の試練が同じ考え方で決める。
 * 超能力の開幕ダメージ・怒り・タイムリープも本編と同じように効く
 */
export function customBossOutcome(save: SaveData, hero: HeroStats, hp: number, attack: number, baseSeconds: number): BossOutcome {
  const openingDamage = hasPsychicNode(save, 'mind-10') ? 0.08 : 0
  const hpAfterOpening = hp * (1 - openingDamage)
  const hasRage = hasPsychicNode(save, 'mind-9')
  const damageBeforeRage = hasRage ? Math.max(0, hpAfterOpening - hp * 0.3) : hpAfterOpening
  const damageAfterRage = hpAfterOpening - damageBeforeRage
  const killTime = damageBeforeRage / hero.bossDps + damageAfterRage / (hero.bossDps * (hasRage ? 1.15 : 1))
  const surviveTime = hero.hp / (attack * hero.damageTaken)
  const leapSeconds = hasPsychicNode(save, 'future-10') ? 10 : 0
  const limit = Math.min(baseSeconds + hero.bossTimeBonus, surviveTime + leapSeconds)
  const isWin = killTime <= limit

  return { isWin, killTime, surviveTime, duration: isWin ? killTime : limit }
}

export const emptyReport = (): BattleReport => ({ seconds: 0, kills: 0, exp: 0, gold: 0, levels: 0, stages: 0, bossWins: [], bossLosses: [] })

/** 1 回の計算で進める最大の秒数（レベルアップを強さに反映させるため、区切って計算する） */
const STEP = 300

/**
 * seconds 秒ぶん戦う。ステージが進み、経験値・ゴールドが入り、ボス戦の勝ち負けが決まる。
 * @param now ボス戦の結果に残す時刻
 */
export function fight(input: SaveData, seconds: number, now: number): { save: SaveData; report: BattleReport } {
  const report = emptyReport()
  let save = input
  let left = Math.max(0, seconds)
  const startLevel = save.level
  const rewardedBosses = new Set(save.beatenBosses)
  // ハード周回の報酬倍率（周回は fight の中では変わらない）
  const rewardRate = hardReward(save)
  // fight 内ではセーブが毎回コピーされる。強さに関係する値とバフの有効期限だけを見て使い回す。
  // ペットの経験値は毎回変わるが、手伝いの倍率が変わるのは形態などが変わったときだけ。
  type Factors = { hero: HeroStats; killSpeed: number; mithrilFast: boolean; hydra: boolean; expMultiplier: number; goldMultiplier: number }
  // 図鑑のごほうび（戦闘力）とハードの周回も、変わったら強さを覚え直す
  let cached: { level: number; evolution: number; job: SaveData['job']; equipment: SaveData['equipment']; buffs: SaveData['buffs']; psychic: SaveData['psychic']; codexClaimed: string[]; hardLoop: number; petKey: string; validUntil: number; factors: Factors } | undefined
  const factors = (): Factors => {
    const petKey = save.pets.active.length === 0 ? '' : activePets(save).map(pet => `${pet.id}:${pet.species}:${pet.form}:${pet.affinity}:${pet.collar}`).join('|')
    if (cached !== undefined && cached.level === save.level && cached.evolution === save.evolution && cached.job === save.job &&
      cached.equipment === save.equipment && cached.buffs === save.buffs && cached.psychic === save.psychic && cached.codexClaimed === save.codex.claimed && cached.hardLoop === save.hard.loop && cached.petKey === petKey && save.battleSeconds < cached.validUntil) {
      return cached.factors
    }
    const pet = petBattleEffects(save)
    const goldRate = (setCount(save, 'copper-miner') >= 4 ? 0.1 : 0) + (hasBossGear(save, 'debt-crown') ? 0.15 : 0)
    const next: Factors = {
      hero: heroStats(save, pet),
      killSpeed: buffRate(save, 'killSpeed'),
      mithrilFast: setCount(save, 'mithril-swift') >= 4,
      hydra: hasBossGear(save, 'hydra-armor'),
      expMultiplier: 1 + buffRate(save, 'exp') + pet.expRate + (setCount(save, 'crystal-sage') >= 2 ? 0.08 : 0),
      goldMultiplier: 1 + buffRate(save, 'gold') + pet.goldRate + goldRate + (hasPsychicNode(save, 'fortune-1') ? 0.05 : 0),
    }
    const validUntil = save.buffs.reduce((until, buff) => buff.until !== undefined && buff.until > save.battleSeconds ? Math.min(until, buff.until) : until, Infinity)
    cached = { level: save.level, evolution: save.evolution, job: save.job, equipment: save.equipment, buffs: save.buffs, psychic: save.psychic, codexClaimed: save.codex.claimed, hardLoop: save.hard.loop, petKey, validUntil, factors: next }
    return next
  }
  const gain = (base: number, baseGold: number, isMob = true): void => {
    // 学びの薬・金運の薬（商店）
    const { expMultiplier, goldMultiplier } = factors()
    const exp = base * expMultiplier
    const gold = baseGold * goldMultiplier * (isMob ? 1 + buffRate(save, 'midas') : 1)
    // 雑魚 1 匹のゴールドは 1 に満たないので、端数はセーブにためて、1 になったぶんだけ足す
    const total = save.goldFraction + gold
    const whole = Math.floor(total)
    save = addExp({ ...save, gold: save.gold + whole, goldFraction: Math.min(total - whole, 0.999999) }, exp)
    save = shareBattleExp(save, exp)
    report.exp += exp
    report.gold += whole
  }

  for (let guard = 0; left > 1e-6 && guard < 100_000; guard += 1) {
    const { chapter, stage } = save.stage
    // 移動中: 戦闘は止まっている（時間だけ進む）
    const travel = travelLeft(save)
    if (travel > 1e-9) {
      const step = Math.min(left, travel)
      left -= step
      save = { ...save, stage: { ...save.stage, travel: step >= travel ? 0 : travel - step }, battleSeconds: save.battleSeconds + step }
      continue
    }
    if (stage >= BOSS_STAGE && !save.isCleared) {
      const outcome = bossOutcomeWithHero(save, factors().hero)
      const bossStart = save.stage.bossTime
      if (bossStart <= 1e-9) {
        if (hasPsychicNode(save, 'mind-10')) save = recordPsychicProc(save, 'mind-10', now)
        if (hasPsychicNode(save, 'future-5')) save = recordPsychicProc(save, 'future-5', now)
        if (hasPsychicNode(save, 'future-10')) {
          const baseBonus = factors().hero.bossTimeBonus - 10
          const wouldLose = outcome.killTime > Math.min(B.bossSeconds + baseBonus, outcome.surviveTime) + 1e-9
          if (wouldLose) save = recordPsychicProc(save, 'future-10', now)
        }
      }
      const need = Math.max(0, outcome.duration - save.stage.bossTime)
      if (left < need) {
        const meteorCount = hasPsychicNode(save, 'mind-5') ? Math.floor((bossStart + left) / 45) - Math.floor(bossStart / 45) : 0
        if (meteorCount > 0) save = recordPsychicProc(save, 'mind-5', now, meteorCount)
        save = { ...save, stage: { ...save.stage, bossTime: save.stage.bossTime + left }, battleSeconds: save.battleSeconds + left }
        left = 0
        break
      }
      left -= need
      // 薬草のおかゆ（ボス戦 1 回だけ HP 回復）は、勝ち負けが決まったら使い切る
      const meteorCount = hasPsychicNode(save, 'mind-5') ? Math.floor((bossStart + need) / 45) - Math.floor(bossStart / 45) : 0
      if (meteorCount > 0) save = recordPsychicProc(save, 'mind-5', now, meteorCount)
      save = useCharge({ ...save, battleSeconds: save.battleSeconds + need }, 'heal')
      const n = stageIndex(chapter, BOSS_STAGE)
      if (outcome.isWin) {
        report.bossWins.push(chapter)
        gain(bossExp(n) * rewardRate, bossGold(n) * rewardRate, false)
        save = recordBossWin(save, chapter, outcome.killTime)
        // 14 日目以降、本編のボスを初めて倒すとその章の魂（それより前に倒したボスは魂の試練で取る）
        if (!rewardedBosses.has(chapter) && READY.has('codex') && isUnlocked(save, 'codex') && !save.souls.includes(chapter)) {
          save = { ...save, souls: [...save.souls, chapter].sort((a, b) => a - b) }
        }
        if (hasPsychicNode(save, 'fortune-9')) {
          const baseStars = rewardedBosses.has(chapter) ? 10 : 50
          const bonus = psychicStarReward(save, baseStars) - baseStars
          if (bonus > 0) save = { ...save, wallet: { ...save.wallet, stars: save.wallet.stars + bonus } }
        }
        rewardedBosses.add(chapter)
        save = rememberPsychicBoss(save, chapter, true)
        const isLast = chapter >= CHAPTER_COUNT
        save = {
          ...save,
          isCleared: isLast,
          // 全部クリアしたら最後の章の 1〜9 面をめぐって稼ぎ続ける
          stage: isLast ? farmArrive(save) : arrive(chapter + 1, 1),
          boss: { retryAt: null, last: { chapter, won: true, at: now } },
        }
        report.stages += 1
      } else {
        report.bossLosses.push(chapter)
        save = rememberPsychicBoss(save, chapter, false)
        save = {
          ...save,
          stage: farmArrive(save),
          boss: { retryAt: save.battleSeconds + bossRetrySeconds(save), last: { chapter, won: false, at: now } },
        }
      }
      continue
    }

    const n = stageIndex(chapter, stage)
    const { hero, killSpeed, mithrilFast, hydra } = factors()
    const foes = groupSize(save)
    const rate = killRateWithHero(save, hero, killSpeed, mithrilFast, hydra, foes)
    // 次の 1 匹を倒すまで（残りの数で範囲攻撃の効き方が変わるので、1 匹ずつ区切る）
    const need = (Math.floor(save.stage.kills + 1e-9) + 1 - save.stage.kills) / rate
    const step = Math.min(left, need, STEP)
    const beforeSeconds = save.battleSeconds
    const beforeDefeated = Math.floor(save.stage.kills + 1e-9)
    const kills = rate * step
    left -= step
    report.kills += kills
    save = { ...save, stage: { ...save.stage, kills: save.stage.kills + kills }, battleSeconds: save.battleSeconds + step }
    if (hasPsychicNode(save, 'mind-5')) {
      const meteorCount = Math.floor(save.battleSeconds / 45) - Math.floor(beforeSeconds / 45)
      if (meteorCount > 0) save = recordPsychicProc(save, 'mind-5', now, meteorCount)
    }
    gain(kills * expPerKill(n) * rewardRate, kills * goldPerKill(n) * rewardRate)

    if (save.stage.kills >= foes - 1e-6) {
      // ボスに負けたあとは、再挑戦の時間までその章の 1〜9 面をランダムにめぐって稼ぐ（全部クリアしたあとも）。
      // 再挑戦の時間を過ぎていたら、どの面にいてもボスへ
      save = recordKills(save, stageGroup(chapter, stage))
      const isFarmingNow = save.isCleared || save.boss.retryAt !== null
      const isWaiting = isFarmingNow && (save.isCleared || save.battleSeconds < (save.boss.retryAt ?? 0))
      if (isWaiting) {
        save = { ...save, stage: farmArrive(save) }
      } else {
        report.stages += 1
        save = { ...save, stage: isFarmingNow ? arrive(chapter, BOSS_STAGE, stage) : arrive(chapter, stage + 1) }
      }
    } else {
      // 波（3 匹）を倒し終えたところで、ボスに負けて稼いでいて再挑戦の時間が来ていたら、面の最後まで待たずにボスへ向かう
      const defeated = Math.floor(save.stage.kills + 1e-9)
      if (defeated > beforeDefeated && defeated % WAVE === 0 && !save.isCleared && save.boss.retryAt !== null && save.battleSeconds >= save.boss.retryAt) {
        save = recordKills(save, stageGroup(chapter, stage).slice(0, defeated))
        report.stages += 1
        save = { ...save, stage: arrive(chapter, BOSS_STAGE, stage) }
      }
    }
  }

  report.seconds = seconds
  report.levels = save.level - startLevel

  return { save, report }
}

/** 「ボスに挑む」ボタン: 負けたあと稼いでいる間に、待たずにすぐ再挑戦する */
export function challengeBoss(save: SaveData): SaveData | undefined {
  if (!isFarming(save)) {
    return undefined
  }

  return { ...save, stage: arrive(save.stage.chapter, BOSS_STAGE, save.stage.stage), boss: { ...save.boss, retryAt: null } }
}

/** 転職が解放されているか（Lv が足りているか） */
export const isJobUnlocked = (save: SaveData): boolean => save.level >= JOB_CHANGE.level

/** 次に転職できるまでの残り時間（ミリ秒）。0 ならいま転職できる */
export function jobCooldownLeft(save: SaveData, now: number): number {
  return save.jobChangedAt === null ? 0 : Math.max(0, save.jobChangedAt + JOB_CHANGE.cooldownMs - now)
}

/** いまその職に移れるか */
export const canChangeJob = (save: SaveData, now: number): boolean => isJobUnlocked(save) && jobCooldownLeft(save, now) === 0

/**
 * 転職: 3 職の間を横に移る（見習いには戻らない）。強さの合計は変わらず、得意（防御・範囲・会心）だけが変わる。
 * 進化の段階はそのまま引き継ぐ。
 */
export function changeJob(save: SaveData, job: JobId, now: number): SaveData | undefined {
  if (!canChangeJob(save, now) || job === 'novice' || job === save.job) {
    return undefined
  }

  return { ...save, job, jobChangedAt: now }
}

export const MAX_EVOLUTION = EVOLUTION.levels.length

/** 次の段階に進化できる Lv（もう最後なら undefined） */
export const nextEvolutionLevel = (save: SaveData): number | undefined => EVOLUTION.levels[save.evolution]

/** いま進化できるか（職を選んでいて、Lv が足りている） */
export function canEvolve(save: SaveData): boolean {
  const need = nextEvolutionLevel(save)

  return save.job !== 'novice' && need !== undefined && save.level >= need
}

/** 進化: 1 段階上がる（見た目・オーラ・強さが変わる） */
export function evolve(save: SaveData): SaveData | undefined {
  return canEvolve(save) ? { ...save, evolution: save.evolution + 1 } : undefined
}

/** 1 回の攻撃の長さ（秒）。Lv と進化で速くなる（見た目だけ） */
export function attackSeconds(save: SaveData): number {
  const speed = 1 + BATTLE.attackSpeedPerLevel * (save.level - 1) + BATTLE.attackSpeedPerEvolution * save.evolution

  return Math.max(BATTLE.minSeconds, Math.round((BATTLE.attackSeconds / speed) * 100) / 100)
}

/** 1 回の攻撃のダメージ（見た目の数字）。1 秒のダメージ × 1 回の攻撃の長さ */
export const hitDamage = (save: SaveData): number => Math.max(1, Math.round(heroStats(save).bossDps * attackSeconds(save)))

/** いまのステージの進み具合（0〜1）。ボス戦は制限時間のうち何割たったか */
export function stageProgress(save: SaveData): number {
  if (save.stage.stage >= BOSS_STAGE && !save.isCleared) {
    return Math.min(1, save.stage.bossTime / Math.max(1e-6, bossOutcome(save).duration))
  }

  return Math.min(1, save.stage.kills / groupSize(save))
}

/** ボスの残り HP の割合（0〜1） */
export function bossHpLeft(save: SaveData): number {
  const n = stageIndex(save.stage.chapter, BOSS_STAGE)
  return bossHpFraction(save, heroStats(save), save.stage.bossTime, bossHp(n) * hardEnemy(save))
}

function bossHpFraction(save: SaveData, hero: HeroStats, elapsed: number, hp: number): number {
  const openingDamage = hasPsychicNode(save, 'mind-10') ? 0.08 : 0
  const hasRage = hasPsychicNode(save, 'mind-9')
  const untilRage = hasRage ? Math.max(0, (0.7 - openingDamage) * hp / hero.bossDps) : Infinity
  const beforeRage = Math.min(elapsed, untilRage) * hero.bossDps
  const afterRage = Math.max(0, elapsed - untilRage) * hero.bossDps * (hasRage ? 1.15 : 1)

  return Math.max(0, 1 - openingDamage - (beforeRage + afterRage) / hp)
}

/** ボスに負けて、その章の 1〜9 面をめぐって稼いでいるところか */
export const isFarming = (save: SaveData): boolean => !save.isCleared && save.boss.retryAt !== null && save.stage.stage < BOSS_STAGE

/** 再挑戦まであと何秒（戦闘時間） */
export const retryIn = (save: SaveData): number => Math.max(0, (save.boss.retryAt ?? 0) - save.battleSeconds)

/** ボス敗北後の再挑戦待ち時間（未来視の「再起」を含む） */
export function bossRetrySeconds(save: SaveData): number {
  return psychicRetrySeconds(save, B.bossRetrySeconds)
}

/** HP バーの動き: いまの割合 from（0〜1）のまま delay 秒（実時間、移動の残り）待ってから、seconds 秒かけて to まで減る */
export type HpBar = { from: number; to: number; seconds: number; delay?: number }

export type HpTimeline = {
  hero: HpBar
  /** 群れの先頭の敵（いま斬られている敵）。ボス戦では無し */
  front: HpBar | null
  boss: HpBar | null
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * HP バーが止まる下限（5%）。バーが 0 になるのは、本当に敵が倒れた（ボス戦なら勝ち負けが決まった）ときの描き直しで
 * バーごと消えるとき。描いた時刻と戦闘の計算が少しずれても「0 なのに倒れない」に見えないようにする安全策。
 */
export const HP_FLOOR = 0.05
const floor = (value: number): number => Math.max(HP_FLOOR, value)

/**
 * いまから先の HP の動き（描くときに 1 回だけ計算し、あとは Svg の中の動きで減らしていく。数字が変わるたびに Svg を作り直さない）。
 * 主人公の HP はボスの攻撃でだけ減る（雑魚は弱くて傷つかない）。0 になったらボス戦は負け（いままでのボス戦の仕組みと同じ）。
 * @param speed 実時間 1 秒あたりの戦闘の秒数（作業中は 3、ふだんは 1）
 */
export function hpTimeline(save: SaveData, speed: number): HpTimeline {
  const full: HpBar = { from: 1, to: 1, seconds: 0 }
  // 移動中は減らない。着いてから減り始める（secondsToNextEvent と同じく、移動の残りを先に足す）
  const delay = travelLeft(save) / Math.max(0.1, speed)
  if (save.stage.stage >= BOSS_STAGE && !save.isCleared) {
    const n = stageIndex(save.stage.chapter, BOSS_STAGE)
    const hero = heroStats(save)
    const outcome = bossOutcome(save)
    const elapsed = Math.min(save.stage.bossTime, outcome.duration)
    const left = Math.max(0, outcome.duration - elapsed) / Math.max(0.1, speed)
    const hard = hardEnemy(save)
    const heroAt = (time: number) => clamp01(1 - (time * bossAttack(n) * hard * hero.damageTaken) / hero.hp)
    const bossAt = (time: number) => clamp01(bossHpFraction(save, hero, time, bossHp(n) * hard))
    // 先に倒れて負けるなら、主人公の HP はちょうど 0 まで（計算の端数で 0.0000001 などが残らないように）
    const isDown = !outcome.isWin && outcome.surviveTime <= outcome.duration + 1e-9
    return {
      hero: { from: floor(heroAt(elapsed)), to: floor(isDown ? 0 : heroAt(outcome.duration)), seconds: left, delay },
      front: null,
      boss: { from: floor(bossAt(elapsed)), to: floor(outcome.isWin ? 0 : bossAt(outcome.duration)), seconds: left, delay },
    }
  }
  const progress = save.stage.kills - Math.floor(save.stage.kills + 1e-9)
  const rate = killRate(save)

  return { hero: full, front: { from: floor(clamp01(1 - progress)), to: HP_FLOOR, seconds: (1 - progress) / Math.max(1e-6, rate) / Math.max(0.1, speed), delay }, boss: null }
}

/** 主人公の HP の割合（いま）。帯の細いバーに使う */
export const heroHpNow = (save: SaveData): number => hpTimeline(save, 1).hero.from

/**
 * 次に戦闘の「できごと」が起きるまでの戦闘の秒数: 雑魚戦は先頭の敵が倒れるまで、ボス戦は勝ち負けが決まるまで。
 * 移動中なら、移動の残りを先に足す（移動が終わってから戦いが始まる）。
 * HP バーが 0（ボス戦は止まる位置）になるのも、ちょうどこの時刻（hpTimeline と同じ計算）。
 */
export function secondsToNextEvent(save: SaveData): number {
  const travel = travelLeft(save)
  if (save.stage.stage >= BOSS_STAGE && !save.isCleared) {
    return travel + Math.max(0, bossOutcome(save).duration - save.stage.bossTime)
  }
  const progress = save.stage.kills - Math.floor(save.stage.kills + 1e-9)

  return travel + (1 - progress) / Math.max(1e-6, killRate(save))
}
