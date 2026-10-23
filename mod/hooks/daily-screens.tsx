import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { FeatureId, SaveData, Tab } from '../types'
import { claimAchievementReward, claimMissionReward, replayIntro, seeFeature, swapDailyMission, wearTitle } from './actions'
import type { Reward } from './calendar'
import { FEATURES, FIRST_CARD, READY, ROADMAP_DAYS, isNew, isUnlocked, nextFeature, priceUnit, stampAt } from './calendar'
import type { Achievement, Scope } from './missions'
import {
  ACHIEVEMENTS,
  DAILY_ALL_STARS,
  DAILY_REWARD,
  WEEKLY_ALL_STARS,
  WEEKLY_REWARD,
  achievementProgress,
  achievementView,
  adventurerRank,
  claimableCount,
  isMissionDone,
  missionProgress,
  rollMissions,
} from './missions'
import type { $ } from './persist'
import { today } from './persist'
import type { DayCell, DayState } from './calendar-art'
import { CELL, calendarRowSvg } from './calendar-art'
import { T } from './texts'
import { itemIcon, npcPortrait } from './visual-parts'
import { weatherOn } from './farm'
import { readyToClaim } from './expedition'
import { isBlackMarketOpen } from './premium'
import { claimable, isCodexOpen } from './codex'
import { codexView } from './codex-screen'
import { sealView } from './seal-screen'

// 毎日の冒険（docs/DAILY.md）のサイド画面: 冒険の暦タブと、施設の説明（チュートリアル）の吹き出し。

type Els = ReturnType<$['ui']['resolve']>
type SvgElement = Extract<Els, { Svg: unknown }>['Svg']

/** 説明の何コマ目を見ているか（セッションの中だけ） */
const introStep = atom({ plugin: 'debug-legend', key: 'introStep' } as const, 0)

/** 暦タブで開いている節（暦・図鑑・封印の間。図鑑は 14 日目から） */
const calendarView = atom({ plugin: 'debug-legend', key: 'calendarView' } as const, 'calendar')

/** タブごとの施設（そのタブの施設が開いたばかりなら、タブに NEW の印） */
const TAB_FEATURES: Partial<Record<Tab, readonly FeatureId[]>> = { calendar: ['calendar', 'missions', 'codex'], town: ['shop', 'expedition', 'smith', 'premium'], gather: ['mine', 'farm', 'goldmine', 'bigfarm'], pets: ['pet', 'pet2'] }

export const tabHasNew = (save: SaveData, tab: Tab): boolean => (TAB_FEATURES[tab] ?? []).some(id => READY.has(id) && isNew(save, id))

/** タブに「!」の印: 受け取れる日課・週課・実績がある（説明を見ていない印の NEW とは別） */
export const tabHasNotice = (save: SaveData, tab: Tab, day: string, now: number): boolean =>
  (tab === 'calendar' && (claimableCount(save, day) > 0 || claimable(save).length > 0)) ||
  (tab === 'town' && READY.has('expedition') && isUnlocked(save, 'expedition') && readyToClaim(save, now))

/** 日課・週課・実績が遊べるか */
export const hasMissions = (save: SaveData): boolean => READY.has('missions') && isUnlocked(save, 'missions')

/** 冒険者ランクの行（暦タブとステータスタブ） */
export function rankLines(save: SaveData): string[] {
  const { rank, claimed, left } = adventurerRank(save)
  const name = T.advRankNames[rank] ?? ''
  const next = left === undefined ? T.advRankMax : T.advRankNext(left, T.advRankNames[rank + 1] ?? '')

  return [T.advRankLine(name, claimed, ACHIEVEMENTS.length), next]
}

/** ごほうびの文 */
export function rewardText(save: SaveData, rewards: readonly Reward[]): string {
  return rewards
    .map(reward => {
      if (reward.kind === 'chests') return T.reward.chests(reward.amount)
      if (reward.kind === 'gold') return T.reward.gold(priceUnit(save) * reward.times)
      if (reward.kind === 'stars') return T.reward.stars(reward.amount)
      if (reward.kind === 'psi') return T.reward.psi(reward.amount)
      if (reward.kind === 'item') return T.reward.item(T.bagItem[reward.id] ?? reward.id, reward.amount)
      return T.reward.title(T.titleName[reward.id] ?? reward.id)
    })
    .join('・')
}

/** 施設の説明の吹き出し（案内役の名前 → 1 コマずつ「次へ」。最後のコマで「わかった」） */
export async function introBox($: $, els: Els, id: FeatureId): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const lines = T.intro[id] ?? []
  const step = Math.min(await read($, introStep), Math.max(0, lines.length - 1))
  const isLast = step >= lines.length - 1
  const finish = async () => {
    await update($, introStep, () => 0)
    await seeFeature($, id)
  }

  // 案内役の顔を吹き出しの左に（デスクトップ・スマホ。ターミナルは文字だけ）
  const portrait = npcPortrait(els, id)

  return (
    <Box flexDirection="row" gap={1} borderStyle="round" borderColor="#ffd60a" paddingX={1} alignItems="center">
      {portrait ?? <Box />}
      <Box flexDirection="column" flexShrink={1}>
      <Text bold color="#ffd60a">
        ★ {T.introSpeaker[id] ?? ''}
      </Text>
      <Text>{lines[step] ?? ''}</Text>
      <Box flexDirection="row" gap={1}>
        {isLast ? (
          <Button key={`intro-done-${id}`} label={T.introDone} variant="primary" onPress={finish} />
        ) : (
          <Button key={`intro-next-${id}`} label={`${T.introNext}（${step + 1}/${lines.length}）`} variant="primary" onPress={() => update($, introStep, n => n + 1)} />
        )}
        {isLast ? null : <Button key={`intro-skip-${id}`} label={T.introSkip} onPress={finish} />}
      </Box>
      </Box>
    </Box>
  )
}

/** 暦の 1 マス（開いた日・今日・次の日・まだの日） */
function dayCell(els: Els, save: SaveData, feature: (typeof FEATURES)[number]) {
  const { Box, Text } = els
  const played = save.calendar.playedDays
  const isOpen = isUnlocked(save, feature.id)
  const isNext = !isOpen && feature.day === Math.max(1, played + 1)
  const name = isOpen || isNext ? (T.featureName[feature.id] ?? feature.id) : T.calLocked
  const mark = isOpen ? (READY.has(feature.id) ? (isNew(save, feature.id) ? ` ${T.unlockNew}` : ' ✓') : `（${T.calPreparing}）`) : ''
  const color = isOpen ? '#ffd60a' : isNext ? '#a0a0c0' : '#5a5a6a'

  return (
    <Box key={`day-${feature.day}`} flexDirection="column" width={16}>
      <Text bold={feature.day === played} color={color}>
        {T.calDay(feature.day)}
        {feature.day === played ? ' ◀' : ''}
      </Text>
      <Text color={color}>
        {name}
        {mark}
      </Text>
    </Box>
  )
}

/** 暦のマスの状態（絵の暦。開いた日・今日・開いたばかり・次の日・まだの日） */
export function dayCells(save: SaveData): DayCell[] {
  const played = save.calendar.playedDays
  const nextDay = nextFeature(save)?.day

  return FEATURES.map(f => {
    const isOpen = isUnlocked(save, f.id)
    const state: DayState = !isOpen ? (f.day === nextDay ? 'next' : 'locked') : READY.has(f.id) && isNew(save, f.id) && f.day > 1 ? 'fresh' : f.day === played ? 'today' : 'open'
    const name = T.featureName[f.id] ?? f.id
    const label =
      state === 'locked' ? T.calLocked : state === 'next' ? T.calInDays(f.day - played) : READY.has(f.id) ? T.featureShort[f.id] ?? name : `${T.featureShort[f.id] ?? name}…`
    return { day: f.day, feature: f.id, state, label, sub: T.calDay(f.day) }
  })
}

/** 絵の暦（7 マス × 2 段の Svg）。ターミナルでは文字の暦 */
function calendarArt(els: Els, Svg: SvgElement, save: SaveData, isWide: boolean) {
  const { Box } = els
  const cells = dayCells(save)
  const rows = [cells.slice(0, 7), cells.slice(7, ROADMAP_DAYS)]
  const scale = (isWide ? 680 : 340) / (7 * CELL.w + 6 * CELL.gap)

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        const source = calendarRowSvg(row)
        const width = 7 * CELL.w + 6 * CELL.gap
        return (
          <Box key={`cal-row-${i}-${row.map(c => c.state).join('')}`}>
            <Svg source={source} alt={T.calTitle} width={Math.round(width * scale)} height={Math.round(CELL.h * scale)} isInteractive />
          </Box>
        )
      })}
    </Box>
  )
}

/** 冒険の暦タブ: 説明（はじめて）・14 日のロードマップ・スタンプ・持ち物・称号 */
export async function calendarTab($: $, els: Els, save: SaveData, view: { Svg?: SvgElement; isWide: boolean } = { isWide: false }): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const calendar = save.calendar
  // 14 日目から、暦・図鑑・封印の間の 3 つの節（図鑑と封印の間は文字の画面）
  const hasCodex = isCodexOpen(save)
  const viewChoice = hasCodex ? await read($, calendarView) : 'calendar'
  const sections = hasCodex ? (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {(['calendar', 'codex', 'seal'] as const).map(id => (
        <Button
          key={`cal-view-${id}`}
          label={`${T.calViews[id] ?? id}${id === 'codex' && isNew(save, 'codex') ? ` ${T.unlockNew}` : ''}`}
          variant={viewChoice === id ? 'primary' : 'secondary'}
          onPress={() => update($, calendarView, () => id)}
        />
      ))}
    </Box>
  ) : null
  if (hasCodex && (viewChoice === 'codex' || viewChoice === 'seal')) {
    const codexIntro = isNew(save, 'codex') ? await introBox($, els, 'codex') : null
    const clock = await $.clock.now()

    return (
      <Box flexDirection="column" gap={1}>
        {sections}
        {viewChoice === 'codex'
          ? await codexView($, els, save, { rewardText, intro: codexIntro })
          : await sealView($, els, save, clock, { intro: codexIntro })}
      </Box>
    )
  }
  const intro = isNew(save, 'calendar') ? await introBox($, els, 'calendar') : null
  const next = nextFeature(save)
  const day = await today($)
  const now = await $.clock.now()
  const nextLine = next === undefined ? T.calAllOpen : T.calNext(next.day - calendar.playedDays, T.featureName[next.id] ?? next.id)
  const weatherLine = READY.has('farm') && isUnlocked(save, 'farm') ? T.farmTodayWeather(T.farmWeatherName[weatherOn(save, day)] ?? weatherOn(save, day)) : null
  const marketOpen = isBlackMarketOpen(save, now)
  // 日数は来たが、まだ作っている施設
  const preparing = FEATURES.filter(f => isUnlocked(save, f.id) && !READY.has(f.id)).map(f => T.featureName[f.id] ?? f.id)

  // スタンプ: 最初の 14 マス、そのあとは 28 日カード
  const isFirst = calendar.stamps <= FIRST_CARD.length
  const size = isFirst ? FIRST_CARD.length : 28
  const done = isFirst ? calendar.stamps : stampAt(calendar.stamps).cell
  const stamps = `${'●'.repeat(done)}${'○'.repeat(Math.max(0, size - done))}`
  const isStampedToday = calendar.lastPlayedDay !== '' && calendar.lastPlayedDay === day
  const todayLine = isStampedToday && calendar.stamps > 0 ? T.stampToday(rewardText(save, stampAt(calendar.stamps).rewards)) : T.stampNotYet

  const bag = Object.entries(save.bag).filter(([, count]) => count > 0)
  const owned = save.titles.owned
  // 日課・週課・実績（5 日目から）。説明は暦の説明が終わってから
  const missions = hasMissions(save) ? await missionsSection($, els, save, day, intro === null) : null

  return (
    <Box flexDirection="column" gap={1}>
      {sections}
      {intro}
      <Box flexDirection="column">
        <Text bold>
          {T.calTitle}　{calendar.playedDays > 0 ? T.calPlayed(calendar.playedDays) : T.calNotYet}
        </Text>
        <Text dimColor>{nextLine}</Text>
        {weatherLine === null ? null : <Text>{weatherLine}</Text>}
        <Box>{marketOpen ? <Text color="#c8a2ff">{T.blackMarketOpen}</Text> : <Box />}</Box>
        {preparing.length > 0 ? <Text dimColor>{T.calPreparingLine(preparing.join('・'))}</Text> : null}
      </Box>
      {view.Svg === undefined ? (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            {FEATURES.slice(0, 7).map(f => dayCell(els, save, f))}
          </Box>
          <Box flexDirection="row" flexWrap="wrap">
            {FEATURES.slice(7, ROADMAP_DAYS).map(f => dayCell(els, save, f))}
          </Box>
        </Box>
      ) : (
        calendarArt(els, view.Svg, save, view.isWide)
      )}
      {missions}
      <Box flexDirection="column">
        <Text bold>{T.stampTitle(isFirst ? 'first' : 'month', done, size)}</Text>
        <Text color="#ffd60a">{stamps}</Text>
        <Text>{todayLine}</Text>
        <Text dimColor>{T.stampNext(rewardText(save, stampAt(calendar.stamps + 1).rewards))}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.bagTitle}</Text>
        <Text>{T.walletLine(save.wallet.stars, save.wallet.psi)}</Text>
        {bag.length === 0 ? (
          <Text dimColor>{T.bagEmpty}</Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {bag.map(([id, count]) => (
              <Box key={`bag-${id}`} flexDirection="row" gap={1} alignItems="center">
                {itemIcon(els, id, 20) ?? <Box />}
                <Text>{T.reward.item(T.bagItem[id] ?? id, count)}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <Text>{save.titles.current === null ? T.titleNone : T.titleLine(T.titleName[save.titles.current] ?? save.titles.current)}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {owned
            .filter(id => id !== save.titles.current)
            .map(id => (
              <Button key={`title-${id}`} label={T.titleWear(T.titleName[id] ?? id)} onPress={() => wearTitle($, id)} />
            ))}
          {save.titles.current === null ? null : <Button key="title-off" label={T.titleOff} onPress={() => wearTitle($, null)} />}
        </Box>
      </Box>
      <Text dimColor>{T.calRule}</Text>
      {intro === null ? <Button key="intro-again" label={T.introAgain} onPress={() => replayIntro($, 'calendar')} /> : null}
    </Box>
  )
}

// ---- 日課・週課・実績（5 日目） ----

/** 日課・週課 1 行（名前・進み具合・受け取る / 受け取り済み・入れ替え） */
function missionRow($: $, els: Els, save: SaveData, scope: Scope, index: number) {
  const { Box, Button, Text } = els
  const mission = (scope === 'daily' ? save.missions.daily : save.missions.weekly)[index]
  if (mission === undefined) {
    return null
  }
  const have = missionProgress(save, mission)
  const isDone = isMissionDone(save, mission)
  const name = (T.goalName[mission.id] ?? (() => mission.id))(mission.goal)
  const canSwap = scope === 'daily' && !mission.claimed && !save.missions.dailySwapped

  return (
    <Box key={`mission-${scope}-${index}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text color={!mission.claimed && isDone ? '#ffd60a' : undefined} dimColor={mission.claimed}>
        {`${mission.claimed ? '✓ ' : isDone ? '★ ' : '・'}${name}　${T.missionProgress(have, mission.goal)}`}
      </Text>
      {mission.claimed ? (
        <Text dimColor>{T.missionClaimed}</Text>
      ) : isDone ? (
        <Button key={`claim-${scope}-${index}`} label={T.missionClaim} variant="primary" onPress={() => claimMissionReward($, scope, index)} />
      ) : null}
      {canSwap ? <Button key={`swap-daily-${index}`} label={T.missionSwap} onPress={() => swapDailyMission($, index)} /> : null}
    </Box>
  )
}

/** 実績 1 行 */
function achievementRow($: $, els: Els, save: SaveData, a: Achievement, isReady: boolean) {
  const { Box, Button, Text } = els
  const name = (T.goalName[a.kind] ?? (() => a.kind))(a.goal)

  return (
    <Box key={`ach-${a.id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text color={isReady ? '#ffd60a' : undefined}>{`${isReady ? '★ ' : '・'}${name}　${T.missionProgress(achievementProgress(save, a), a.goal)}`}</Text>
      <Text dimColor>{`（${rewardText(save, a.reward)}）`}</Text>
      {isReady ? <Button key={`claim-ach-${a.id}`} label={T.missionClaim} variant="primary" onPress={() => claimAchievementReward($, a.id)} /> : null}
    </Box>
  )
}

/** 暦タブの「日課・週課・実績」の節。日課・週課は今日のもの（セーブの日付が古くても今日のものを出す） */
async function missionsSection($: $, els: Els, saved: SaveData, day: string, isIntroTurn: boolean): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const save = rollMissions(saved, day)
  const intro = isIntroTurn && isNew(save, 'missions') ? await introBox($, els, 'missions') : null
  const view = achievementView(save)
  const lines = rankLines(save)

  return (
    <Box flexDirection="column" gap={1}>
      {intro}
      <Box flexDirection="column">
        <Text bold>{T.dailyTitle}</Text>
        {save.missions.daily.length === 0 ? <Text dimColor>{T.missionNone}</Text> : save.missions.daily.map((_, i) => missionRow($, els, save, 'daily', i))}
        <Text dimColor>{T.dailyRewardLine(rewardText(save, DAILY_REWARD), T.dailyAllReward(DAILY_ALL_STARS))}</Text>
        {save.missions.dailySwapped ? <Text dimColor>{T.missionSwapUsed}</Text> : null}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.weeklyTitle}</Text>
        {save.missions.weekly.length === 0 ? <Text dimColor>{T.missionNone}</Text> : save.missions.weekly.map((_, i) => missionRow($, els, save, 'weekly', i))}
        <Text dimColor>{T.weeklyRewardLine(rewardText(save, WEEKLY_REWARD), T.weeklyAllReward(WEEKLY_ALL_STARS))}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.achTitle}</Text>
        <Text color="#7fd1ff">{lines[0]}</Text>
        <Text dimColor>{lines[1]}</Text>
        {view.ready.length > 0 ? <Text bold>{T.achReady}</Text> : null}
        {view.ready.map(a => achievementRow($, els, save, a, true))}
        {view.near.length > 0 ? <Text bold>{T.achNear}</Text> : null}
        {view.near.map(a => achievementRow($, els, save, a, false))}
        <Text dimColor>{T.achDone(view.claimed, ACHIEVEMENTS.length)}</Text>
      </Box>
      {intro === null && isIntroTurn ? <Button key="intro-again-missions" label={T.missionsAgain} onPress={() => replayIntro($, 'missions')} /> : null}
    </Box>
  )
}
