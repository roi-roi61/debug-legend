import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { SaveData } from '../types'
import { beginHardLoop, challengeOriginMoth, challengeSoulTrial, offerSealSoul } from './actions'
import type { $ } from './persist'
import { canChallengeTrueBoss, canStartHard, canTrial, endingRecord, hasSoul, isOffered, isSealOpen, shadowFactor, silhouetteStage, trialWaitMs, trueBossBeaten, trueBossWaitMs } from './seal'
import { T } from './texts'
import { CHAPTER_COUNT, chapterOf } from './world'
import { facilityHeader, itemIcon } from './visual-parts'
import { sealCircleSvg, trueBossReplaySvg } from './seal-art'
import { heroFigure } from './art'

// 封印の間のサブ画面（暦タブ →「封印の間」）。10 の台座・魂の試練・真のラスボス・真のエンディングの記録・ハード周回。
// 文字とボタンだけ（演出の絵・スタッフロールの見た目は Opus が後で）。

type Els = ReturnType<$['ui']['resolve']>

/** ハード周回の確認中か */
const hardConfirm = atom({ plugin: 'debug-legend', key: 'hardConfirm' } as const, false)

const minutes = (ms: number): number => Math.max(1, Math.ceil(ms / 60_000))
const bossName = (chapter: number): string => T.enemy[chapterOf(chapter).boss] ?? ''
const chapters = Array.from({ length: CHAPTER_COUNT }, (_, i) => i + 1)

/** 封印の間 */
export async function sealView($: $, els: Els, save: SaveData, now: number, tools: { intro: RenderElement | null }): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const seal = save.seal
  const boss = seal.trueBoss
  const isHard = save.hard.loop > 0
  const confirming = await read($, hardConfirm)
  const stage = silhouetteStage(save)
  const wait = trueBossWaitMs(save, now)
  const canFight = canChallengeTrueBoss(save)
  const last = boss.last
  const trial = seal.lastTrial

  return (
    <Box flexDirection="column" gap={1}>
      {sealPicture(els, save) ?? facilityHeader(els, 'codex') ?? <Box />}
      {tools.intro}
      <Box flexDirection="column">
        <Text bold>{T.sealTitle}</Text>
        <Text>{T.sealStatus(seal.offered.length, save.souls.length)}</Text>
        <Text color="#c8a2ff">{T.sealStageText[stage] ?? ''}</Text>
        <Text dimColor>{T.hardLoops(save.hard.loop)}</Text>
      </Box>

      <Box flexDirection="column">
        {chapters.map(chapter => {
          const offered = isOffered(save, chapter)
          const owned = hasSoul(save, chapter)
          const state = offered ? 'offered' : owned ? 'soul' : 'none'
          return (
            <Box key={`seal-altar-${chapter}`} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
              {offered || owned ? (itemIcon(els, `soul-${chapter}`, 20) ?? <Box />) : <Box />}
              <Text color={offered ? '#ffd60a' : undefined} dimColor={!offered && !owned}>
                {T.sealAltar(chapter, offered || owned ? bossName(chapter) : T.codexUnknown, T.sealAltarState[state] ?? '')}
              </Text>
              {owned && !offered ? <Button key={`seal-offer-${chapter}`} label={T.sealOffer(chapter)} variant="primary" onPress={() => offerSealSoul($, chapter)} /> : <Box />}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        <Text bold>{T.trialTitle}</Text>
        <Text dimColor>{T.trialHelp}</Text>
        {chapters.map(chapter => {
          const beaten = canTrial(save, chapter)
          const left = trialWaitMs(save, chapter, now)
          const best = seal.trials[chapter]?.best ?? 0
          const state = !beaten ? 'locked' : hasSoul(save, chapter) ? 'soul' : 'ready'
          return (
            <Box key={`trial-${chapter}`} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
              <Text dimColor={!beaten}>
                {T.trialRow(chapter, beaten ? bossName(chapter) : T.codexUnknown, left > 0 ? T.trialWait(minutes(left)) : (T.trialState[state] ?? ''))}
                {best > 0 ? `　${T.trialBest(best)}` : ''}
              </Text>
              {beaten && left === 0 ? <Button key={`trial-go-${chapter}`} label={T.trialGo(chapter)} onPress={() => challengeSoulTrial($, chapter)} /> : <Box />}
            </Box>
          )
        })}
        {trial === null ? <Box /> : <Text color={trial.won ? '#8ff0a4' : '#ff8a8a'}>{T.trialLast(trial.chapter, trial.won, trial.seconds)}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold color="#c8a2ff">{isHard ? T.originMothHard : T.originTitle}</Text>
        <Text dimColor>{T.originLore}</Text>
        <Text dimColor>{T.originRule}</Text>
        {!isSealOpen(save) || seal.offered.length < CHAPTER_COUNT ? (
          <Text>{T.originLocked(seal.offered.length)}</Text>
        ) : boss.beaten > save.hard.loop ? (
          <Text color="#8ff0a4">{T.originAlready}</Text>
        ) : !save.isCleared ? (
          <Text>{T.originNeedClear}</Text>
        ) : (
          <Box />
        )}
        {seal.offered.length >= CHAPTER_COUNT ? <Text>{T.originInfo(boss.tries, boss.fray)}</Text> : <Box />}
        {canFight && wait > 0 ? <Text color="#ffb224">{T.originWait(minutes(wait))}</Text> : <Box />}
        {canFight && wait === 0 ? <Button key="origin-go" label={T.originGo} variant="primary" onPress={() => challengeOriginMoth($)} /> : <Box />}
        {last === null ? (
          <Box />
        ) : (
          <Box flexDirection="column">
            {replayPicture(els, save) ?? <Box />}
            <Text color={last.won ? '#8ff0a4' : '#ff8a8a'}>
              {T.originResult(last.won, last.seconds)}　{T.originReason[last.reason] ?? ''}
            </Text>
            {last.phases.map(phase => (
              <Text key={`origin-phase-${phase.phase}`}>
                {T.originPhaseLine(T.originPhaseName[phase.phase - 1] ?? '', phase.seconds, Math.round(phase.heroHpLeft * 100), Math.round(phase.bossHpLeft * 100))}
              </Text>
            ))}
          </Box>
        )}
        {seal.offered.length >= CHAPTER_COUNT ? (
          <Box flexDirection="column">
            <Text dimColor>{T.originShadowTitle}</Text>
            {chapters.map(chapter => (
              <Text key={`origin-shadow-${chapter}`} dimColor>
                {T.originShadow(chapter, bossName(chapter), T.shadowMove[chapter - 1] ?? '', Math.round(shadowFactor(save, chapter) * 100))}
              </Text>
            ))}
          </Box>
        ) : (
          <Box />
        )}
      </Box>

      {trueBossBeaten(save) ? endingBox(els, save) : <Box />}

      {canStartHard(save) ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#ff4d6d" paddingX={1}>
          <Text bold color="#ff4d6d">{T.hardTitle}</Text>
          <Text dimColor>{T.hardInfo}</Text>
          {confirming ? (
            <Box flexDirection="column">
              <Text>{T.hardAsk}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key="hard-go" label={T.hardGo} variant="primary" onPress={async () => {
                  await update($, hardConfirm, () => false)
                  await beginHardLoop($)
                }} />
                <Button key="hard-cancel" label={T.hardCancel} onPress={() => update($, hardConfirm, () => false)} />
              </Box>
            </Box>
          ) : (
            <Button key="hard-start" label={T.hardStart} onPress={() => update($, hardConfirm, () => true)} />
          )}
        </Box>
      ) : (
        <Box />
      )}
    </Box>
  )
}

/** 真のエンディングの記録（遊んだ日数・倒した数・掘った階・育てた作物・ペットの名前）。スタッフロールの見た目はあとで */
/** 封印の魔法陣の絵（デスクトップ・スマホ） */
function sealPicture(els: Els, save: SaveData): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const offered = save.seal.offered
  const source = sealCircleSvg(offered, silhouetteStage(save), trueBossBeaten(save))

  return <Svg key={`seal-${offered.join('.')}-${trueBossBeaten(save) ? 'b' : ''}`} source={source} alt={T.sealTitle} width={400} height={240} isInteractive />
}

/** 最後の真のラスボス戦のふり返り（戦うたびに 1 回だけ流れる） */
function replayPicture(els: Els, save: SaveData): RenderElement | null {
  const last = save.seal.trueBoss.last
  if (!('Svg' in els) || last === null) {
    return null
  }
  const { Svg } = els
  const source = trueBossReplaySvg(last, heroFigure(save.job, save.evolution), { phase: T.originPhaseName, win: T.originReplayWin, lose: T.originReplayLose })

  return <Svg key={`origin-replay-${last.at}`} source={source} alt={T.sealTitle} width={680} height={320} isInteractive />
}

function endingBox(els: Els, save: SaveData): RenderElement {
  const { Box, Text } = els
  const record = endingRecord(save)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#ffd60a" paddingX={1}>
      <Text bold color="#ffd60a">{T.endingTitle}</Text>
      {T.endingLines.map((line, i) => (
        <Text key={`ending-line-${i}`}>{line}</Text>
      ))}
      <Text bold>{T.endingRecordTitle}</Text>
      <Text>{T.endingRecord(record.days, record.kills, record.floor, record.crops)}</Text>
      <Text>{record.pets.length > 0 ? T.endingPets(record.pets.join('・')) : T.endingPetsNone}</Text>
      <Text color="#ffd60a">{T.endingTitleGot}</Text>
      <Text dimColor>{T.endingThanks}</Text>
    </Box>
  )
}
