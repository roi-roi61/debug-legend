import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { SaveData } from '../types'
import { activateMidasTouch, learnPsychicNode, resetPsychicTree } from './actions'
import { introBox } from './daily-screens'
import { facilityHeader } from './visual-parts'
import type { $ } from './persist'
import { weatherTomorrow } from './farm'
import { canLearnPsychic, hasPsychicNode, PSYCHIC_NODES, psychicNode } from './psychic'
import { isNew } from './calendar'
import { T } from './texts'

const selectedNode = atom({ plugin: 'debug-legend', key: 'psychicNode' } as const, '')
const confirmReset = atom({ plugin: 'debug-legend', key: 'psychicReset' } as const, false)
type Els = ReturnType<$['ui']['resolve']>

/** 職タブ内の超能力ツリー。3 系統を横に並べ、習得は選択後にもう一度確認する。 */
export async function psychicTab($: $, els: Els, save: SaveData, day: string, now: number): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const intro = isNew(save, 'psychic') ? await introBox($, els, 'psychic') : undefined
  const chosen = await read($, selectedNode)
  const node = psychicNode(chosen)
  const owned = node !== undefined && hasPsychicNode(save, node.id)
  const canLearn = node !== undefined && canLearnPsychic(save, node.id)
  const askedToReset = await read($, confirmReset)
  const resetCost = save.psychic.resets === 0 ? 0 : 100
  const forecast = hasPsychicNode(save, 'future-4') ? T.psychicWeather(T.farmWeatherName[weatherTomorrow(save, now)] ?? '') : ''
  const paths = [
    { id: 'mind', name: T.psychicPathName.mind, color: '#ff6868' },
    { id: 'future', name: T.psychicPathName.future, color: '#62a9ff' },
    { id: 'fortune', name: T.psychicPathName.fortune, color: '#ffd45a' },
  ] as const

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">{intro ?? <Box />}</Box>
      {facilityHeader(els, 'psychic') ?? <Box />}
      <Box flexDirection="row" flexWrap="wrap" gap={2}>
        <Text bold>{T.psychicTitle}</Text>
        <Text color="#ffd60a">{T.psychicPoints(save.wallet.psi)}</Text>
        <Text dimColor>{T.psychicResetNote(save.psychic.resets, resetCost)}</Text>
      </Box>
      {forecast === '' ? <Box /> : <Text color="#62a9ff">{forecast}</Text>}
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {paths.map(path => (
          <Box key={`psychic-path-${path.id}`} flexDirection="column" borderStyle="round" borderColor={path.color} paddingX={1}>
            <Text bold color={path.color}>{path.name}</Text>
            {PSYCHIC_NODES.filter(candidate => candidate.path === path.id).map(candidate => {
              const isOwned = hasPsychicNode(save, candidate.id)
              const canOpen = canLearnPsychic(save, candidate.id)
              const name = T.psychicNodeName[candidate.id] ?? candidate.id
              const status = isOwned ? T.psychicOpened : canOpen ? T.psychicReady : T.psychicLocked
              return (
                <Box key={`psychic-row-${candidate.id}`} flexDirection="column">
                  <Button
                    key={`psychic-node-${candidate.id}`}
                    label={T.psychicNodeLabel(candidate.order, name, candidate.cost, status)}
                    variant={chosen === candidate.id ? 'primary' : isOwned ? 'secondary' : undefined}
                    onPress={() => update($, selectedNode, () => candidate.id)}
                  />
                  <Text dimColor>{T.psychicNodeEffect[candidate.id] ?? ''}</Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        {node === undefined ? <Text dimColor>{T.psychicSelectNode}</Text> : (
          <Box flexDirection="column">
            <Text bold>{T.psychicNodeName[node.id] ?? node.id}</Text>
            <Text>{T.psychicNodeEffect[node.id] ?? ''}</Text>
            {owned ? <Text color="#4cc38a">{T.psychicOpened}</Text> : canLearn ? (
              <Button key="psychic-confirm-node" label={T.psychicConfirmNode(node.cost)} variant="primary" onPress={async () => {
                if (await learnPsychicNode($, node.id)) await update($, selectedNode, () => '')
              }} />
            ) : <Text dimColor>{save.wallet.psi < node.cost ? T.psychicNeedPoints : T.psychicNeedPrevious}</Text>}
          </Box>
        )}
      </Box>
      {hasPsychicNode(save, 'fortune-10') ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{T.psychicNodeName['fortune-10']}</Text>
          <Text>{T.psychicNodeEffect['fortune-10']}</Text>
          {save.psychic.midasDay === day ? <Text dimColor>{T.psychicMidasUsed}</Text> : (
            <Button key="psychic-midas" label={T.psychicMidasButton} variant="primary" onPress={() => activateMidasTouch($)} />
          )}
        </Box>
      ) : <Box />}
      {save.psychic.nodes.length > 0 ? (
        <Box flexDirection="row" gap={1}>
          {askedToReset ? (
            <Box flexDirection="row" gap={1}>
              <Text>{T.psychicResetConfirm(resetCost, save.psychic.nodes.length)}</Text>
              <Button key="psychic-reset-confirm" label={T.psychicResetDo} variant="primary" onPress={async () => {
                if (await resetPsychicTree($)) await update($, confirmReset, () => false)
              }} />
              <Button key="psychic-reset-cancel" label={T.psychicResetCancel} onPress={() => update($, confirmReset, () => false)} />
            </Box>
          ) : (
            <Button key="psychic-reset-ask" label={T.psychicResetAsk(resetCost)} onPress={() => update($, confirmReset, () => true)} />
          )}
        </Box>
      ) : <Box />}
    </Box>
  )
}
