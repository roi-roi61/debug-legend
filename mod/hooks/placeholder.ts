import type { Sprite } from '../types'

// 仮の絵（M0 のドット絵ができたら差し替える）。どちらも 16×16。

export const HERO: Sprite = {
  palette: { o: '#1b2a4a', b: '#4f8ef7', l: '#9cc4ff', w: '#ffffff', k: '#10131c', s: '#d7dde8' },
  rows: [
    '................',
    '..oooooooooo....',
    '..obbbbbbbbo....',
    '..oblllllbbo....',
    '..oblwkbwkbo...s',
    '..oblwkbwkbo..s.',
    '..obbbbbbbbo.s..',
    '..obbbkkbbbos...',
    '..obbbbbbbboo...',
    '..oooooooooo....',
    '....obbbbo......',
    '...obbbbbbo.....',
    '...obboobbo.....',
    '...ooo..ooo.....',
    '................',
    '................',
  ],
}

export const BUG: Sprite = {
  palette: { o: '#4a1010', r: '#e5484d', p: '#ff9592', y: '#ffd60a', k: '#10131c' },
  rows: [
    '................',
    '...o......o.....',
    '....o....o......',
    '.....oooo.......',
    '...oorrrroo.....',
    '..orrrrrrrro....',
    '.orpyrrrrypro...',
    '.orrkrrrrkrro...',
    'oorrrrrrrrrroo..',
    '.orrrrkkrrrro...',
    '.orrrrrrrrrro...',
    'oorrrrrrrrrroo..',
    '..orrrrrrrro....',
    '...oorrrroo.....',
    '..o..oooo..o....',
    '................',
  ],
}
