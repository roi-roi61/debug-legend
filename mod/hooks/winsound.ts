import type { $ } from './persist'
import { background } from './persist'
import type { BgmTrack } from './music'
import { CROSSFADE_MS, bgmLength } from './music'

// Windows で音を鳴らす（設定「Windows で音を鳴らす」がオンで、Windows のときだけ）。
// Claude Code の $.audio.play は Windows では鳴らないので、Windows 標準の PowerShell（System.Windows.Media.MediaPlayer）に鳴らさせる。
// DESIGN.md のセキュリティ方針「外部プロセスを起動しない」の、ただ 1 つの例外。守っていること:
// - 鳴らすのは mod に同梱した決まった音のファイルだけ（下の FILES の一覧から選ぶ。外から来た値は引数に入れない）
// - 音量は 0〜1 の数字だけ、ファイルの場所は mod のフォルダ（$.plugin.root）から作り、使えない文字が入っていたら鳴らさない
// - 同時に鳴らす効果音の数・起動の間隔・1 分あたりの回数に上限。BGM は 1 つだけ、最長 10 分で自分で終わる

export const FILES = {
  'bgm-ch1': 'sounds\\bgm-ch1.mp3',
  'bgm-ch2': 'sounds\\bgm-ch2.mp3',
  'bgm-ch3': 'sounds\\bgm-ch3.mp3',
  'bgm-ch4': 'sounds\\bgm-ch4.mp3',
  'bgm-ch5': 'sounds\\bgm-ch5.mp3',
  'bgm-ch6': 'sounds\\bgm-ch6.mp3',
  'bgm-ch7': 'sounds\\bgm-ch7.mp3',
  'bgm-ch8': 'sounds\\bgm-ch8.mp3',
  'bgm-ch9': 'sounds\\bgm-ch9.mp3',
  'bgm-ch10': 'sounds\\bgm-ch10.mp3',
  'bgm-boss': 'sounds\\bgm-boss.mp3',
  'bgm-boss-final': 'sounds\\bgm-boss-final.mp3',
  'bgm-menu': 'sounds\\bgm-menu.mp3',
  'se-attack': 'sounds\\se-attack.mp3',
  'se-crit': 'sounds\\se-crit.mp3',
  'se-hit': 'sounds\\se-hit.mp3',
  'se-defeat': 'sounds\\se-defeat.mp3',
  'se-lamp': 'sounds\\se-lamp.mp3',
  'se-drop-common': 'sounds\\se-drop-common.mp3',
  'se-drop-rare': 'sounds\\se-drop-rare.mp3',
  'se-drop-epic': 'sounds\\se-drop-epic.mp3',
  'se-levelup': 'sounds\\se-levelup.mp3',
  'se-jobchange': 'sounds\\se-jobchange.mp3',
  'se-boss-appear': 'sounds\\se-boss-appear.mp3',
  'se-victory': 'sounds\\se-victory.mp3',
} as const

export type SoundFile = keyof typeof FILES
export type BgmFile = BgmTrack

export const LIMITS = {
  /** 同時に鳴らす効果音の数 */
  maxEffects: 3,
  /** 効果音を起動する最短の間隔（ミリ秒） */
  minGapMs: 150,
  /** 1 分あたりの効果音の数 */
  perMinute: 40,
  /** 効果音 1 つを鳴らし終えるまで待つ時間（ミリ秒） */
  effectMs: 2_500,
  /** BGM を起動し直す最短の間隔（ミリ秒） */
  bgmGapMs: 2_000,
  /** BGM の 1 回の起動で鳴らし続ける最長の時間（分）。過ぎたら止まり、画面が開いていればまた起動する */
  bgmMinutes: 10,
}

let isWindows = false

/** Windows かどうかを調べておく（session.start で 1 回） */
export async function detectWindows($: $): Promise<void> {
  isWindows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
}

/** 設定がオンで、Windows のときだけ true */
export const useWindowsSound = (isEnabled: boolean): boolean => isEnabled && isWindows

export const isWindowsHost = (): boolean => isWindows

/** 音のファイルの場所。mod のフォルダ + 決まったファイル名。使えない文字が入っていたら undefined（鳴らさない） */
export function soundPath(root: string, file: SoundFile): string | undefined {
  const full = `${root.replace(/\//g, '\\').replace(/\\+$/, '')}\\${FILES[file]}`

  return /^[A-Za-z]:\\[^'"`$\r\n\0;&|<>]*\.mp3$/.test(full) ? full : undefined
}

const volume = (gain: number): string => (Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0).toFixed(2)

const open = (path: string, gain: number): string =>
  `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Volume = ${volume(gain)}; $p.Open([Uri]::new('${path}'));`

/** 効果音 1 回の PowerShell の中身 */
export const effectScript = (path: string, gain: number): string =>
  `${open(path, gain)} $p.Play(); Start-Sleep -Milliseconds ${LIMITS.effectMs}; $p.Stop(); $p.Close()`

/**
 * BGM（ループ）の PowerShell の中身。始めの 0.6 秒で音量を 0 から上げる（フェードイン）。
 * 0.1 秒ごとに再生位置を見て、曲の終わりに来たら頭に戻す（MP3 は表の長さより少し短いことがあるので、位置を見るのが確実。
 * 位置が分からないときは表の長さで戻す）。0.5 秒ごとに 1 行書くのは、止めたいときにすぐ止められるようにするため。
 */
export const bgmScript = (path: string, gain: number, loopMs: number): string =>
  `${open(path, 0)} $p.Play(); for ($v = 1; $v -le 6; $v++) { $p.Volume = ${volume(gain)} * $v / 6; Start-Sleep -Milliseconds 100 }; ` +
  `$end = (Get-Date).AddMinutes(${LIMITS.bgmMinutes}); $first = $true; $near = [TimeSpan]::FromMilliseconds(80); ` +
  `while ((Get-Date) -lt $end) { if (-not $first) { $p.Position = [TimeSpan]::Zero; $p.Play() }; $first = $false; $t = 0; ` +
  `while ($t -lt ${Math.round(loopMs)} -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 100; $t += 100; ` +
  `if ($t % 500 -eq 0) { [Console]::Out.WriteLine('.') }; ` +
  `if ($p.NaturalDuration.HasTimeSpan -and $p.Position -ge ($p.NaturalDuration.TimeSpan - $near)) { break } } }; ` +
  `$p.Stop(); $p.Close()`

export const powershell = (script: string): string[] => ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script]

// ---- 効果音 ----

let running = 0
let lastStart = 0
const recent: number[] = []

/** 効果音を 1 回鳴らす（上限を超えるときは鳴らさない） */
export async function playEffectWindows($: $, file: SoundFile, gain: number): Promise<void> {
  const now = await $.clock.now()
  while (recent.length > 0 && now - (recent[0] ?? 0) > 60_000) {
    recent.shift()
  }
  const path = soundPath($.plugin.root, file)
  if (path === undefined || running >= LIMITS.maxEffects || now - lastStart < LIMITS.minGapMs || recent.length >= LIMITS.perMinute) {
    return
  }
  running += 1
  lastStart = now
  recent.push(now)
  try {
    await $.process.run(powershell(effectScript(path, gain)), { timeoutMs: 10_000 })
  } finally {
    running -= 1
  }
}

// ---- BGM ----

let bgm: { file: BgmFile; gain: number; stop: () => void; isDone: boolean } | undefined
let lastBgmStart = 0

export function stopBgmWindows(): void {
  bgm?.stop()
  bgm = undefined
}

/** BGM を流す（同じ曲・同じ音量で流れていれば何もしない） */
export async function setBgmWindows($: $, file: BgmFile, gain: number): Promise<void> {
  if (bgm !== undefined && !bgm.isDone && bgm.file === file && bgm.gain === gain) {
    return
  }
  const now = await $.clock.now()
  const path = soundPath($.plugin.root, file)
  if (path === undefined || now - lastBgmStart < LIMITS.bgmGapMs) {
    return
  }
  // 曲を切り替えるときは、新しい曲を先に鳴らし始めて、少し重ねてから前の曲を止める（短いクロスフェード）
  const previous = bgm
  bgm = undefined
  if (previous !== undefined) {
    $.clock.after(CROSSFADE_MS, () => previous.stop())
  }
  lastBgmStart = now
  const stream = $.process.spawn({ argv: powershell(bgmScript(path, gain, bgmLength(file))) })
  const pieces = stream[Symbol.asyncIterator]()
  const handle = {
    file,
    gain,
    isDone: false,
    stop: () => {
      handle.isDone = true
      background(Promise.resolve(pieces.return?.(undefined as never)))
    },
  }
  bgm = handle
  background(
    (async () => {
      try {
        while (!handle.isDone) {
          const piece = await pieces.next()
          if (piece.done) {
            break
          }
        }
      } finally {
        handle.isDone = true
      }
    })(),
  )
}
