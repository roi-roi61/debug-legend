// このファイルは mod/scripts/sync_art.py が art/export/*.json から作る。手で書き換えない。
// 絵は art-part-*.generated.ts に分けてある（1 ファイル 1 MiB までのため）。
import type { Art } from '../types'
import { PART as P1 } from './art-part-1.generated'
import { PART as P2 } from './art-part-2.generated'
import { PART as P3 } from './art-part-3.generated'
import { PART as P4 } from './art-part-4.generated'

export const ART: Record<string, Art> = { ...P1, ...P2, ...P3, ...P4 }
