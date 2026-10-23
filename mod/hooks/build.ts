import { BUILD } from './build.generated'

// どのコードが動いているか（mod/scripts/stamp_build.py が作る build.generated.ts から）

/** 例: 1.0.1（2026-10-18T05:00:53Z・aebf0bb・7699a730） */
export const buildLabel = (): string => `${BUILD.version}（${BUILD.builtAt}・${BUILD.base}・${BUILD.code}）`

/** 開発用チート（/dl-cheat）を使えるか。環境変数は開発版（channel が dev）のときだけ効く。公開版（--public で作った版）は無視する */
export function cheatsAllowed(devCheats: boolean, channel: string, envValue: string | undefined): boolean {
  return channel === 'dev' && (devCheats || envValue === '1')
}
