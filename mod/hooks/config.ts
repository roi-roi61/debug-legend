// デバッグ伝説の調整用の数値はすべてここに集める（仮の値。開発用チートで試しながら決める）。

/**
 * 開発用チート（/dl-cheat）を使えるようにするか。公開版は false。
 * 開発版（stamp_build.py で作った channel が dev）なら、環境変数 DEBUG_LEGEND_DEV=1 を付けて Claude Code を起動すれば、false のままでも使える（register.tsx）。
 * 公開版（stamp_build.py --public で channel が public）は、この環境変数を無視する。
 */
export const DEV_CHEATS = false

/** ランプ（装備ドロップ）回数 */
export const LAMP = {
  /** 回答 1 回（turn.complete）でたまる回数 */
  perTurn: 1,
  /** 回答でたまる 1 日の上限 */
  dailyTurnCap: 120,
  /** ストックの上限（これ以上はたまらない） */
  stockCap: 200,
}

/** ツール呼び出し（tool.call）が成功したときのゴールド */
export const GOLD = {
  perToolCall: 2,
  /** ツール呼び出しでもらえる 1 日の上限 */
  dailyToolCap: 600,
}

/**
 * トークンのおまけボーナス。1 回の回答のトークン数から「ランプ何回分のおまけか」を決める。
 * ボーナス = perDecade × log10(トークン ÷ floorTokens)。1 万トークンで +0.1 回、10 万でも +0.2 回。
 * 端数はためておき、1 回分たまるとランプ +1。
 */
export const TOKEN_BONUS = {
  /** これより少ないトークンはおまけなし */
  floorTokens: 1_000,
  /** トークンが 10 倍になるごとに増えるおまけ（ランプ何回分か） */
  perDecade: 0.1,
  /** 1 回の回答でもらえるおまけの上限 */
  perTurnCap: 0.3,
  /** 1 日にもらえるおまけの上限（ランプ何回分か） */
  dailyCap: 10,
}

/** 時間によるステージ進行 */
export const TIME = {
  /** 何ミリ秒ごとに進行を計算するか（セッションが開いている間） */
  tickMs: 10_000,
  /** 1 秒あたりの戦闘の秒数（何もしていないとき） */
  battleSpeed: 1,
  /** Claude が作業中（turn 実行中）の倍率 */
  workingMultiplier: 3,
  /** オフライン分をまとめて受け取れる最大時間 */
  offlineCapMs: 8 * 60 * 60 * 1000,
  /** これより長く間があいたら「オフライン報酬」として扱う（それ未満は普通の進行） */
  offlineThresholdMs: 60_000,
}

/**
 * 戦闘とステージの強さ（仮の値。目安: 最初の転職 Lv20 まで 2〜3 日、10 章クリアまで約 1 か月）。
 * n = ステージの通し番号（第 1 章 1 ステージ目が 0、第 10 章 10 ステージ目が 99）。
 * tests/pace.test.ts のシミュレーションと /dl-cheat sim で、ペースを確かめながら調整する。
 */
export const BALANCE = {
  /**
   * 雑魚を倒す速さの倍率（ベータ 2 回目で 2 倍に）。上げると、雑魚の HP・1 匹を倒す最短の秒数・1 匹の経験値とゴールドが
   * その分だけ小さくなるので、全体のペース（転職・進化・クリアまでの日数）は変わらない。ボスの強さと報酬は変わらない。
   */
  killSpeed: 2,
  /** 群れの中の 1 匹を倒すのにかかる最短の秒数（強すぎても一瞬で進まないように。killSpeed で割る） */
  minSecondsPerEnemy: 6,
  /** 戦闘力 1 あたりの 1 秒のダメージ */
  dpsPerPower: 0.5,
  /** 雑魚の HP = enemyHp ×（1 + enemyHpPerStage × n）× enemyHpGrowth ^ n ÷ killSpeed */
  enemyHp: 1000,
  enemyHpPerStage: 0.6,
  enemyHpGrowth: 1.004,
  /** ボスの HP = enemyHp ×（1 + enemyHpPerStage × n）× enemyHpGrowth ^ n × bossHpRate（killSpeed では変わらない） */
  bossHpRate: 2.4,
  /** ボス戦の制限時間（秒）。この間に倒せないか、先に倒れたら負け */
  bossSeconds: 30,
  /** ボスの 1 秒の攻撃 = enemyHp ×（1 + enemyHpPerStage × n）× enemyHpGrowth ^ n × bossAttackRate */
  bossAttackRate: 0.025,
  /** 戦闘力 1 あたりの主人公の HP */
  hpPerPower: 4,
  /** 雑魚 1 体の経験値 = expPerKill × expGrowth ^ n ÷ killSpeed。ボスは expPerKill × expGrowth ^ n × bossRewardRate */
  // 1.0.4: 群れと群れのあいだの移動（TRAVEL.seconds）で戦っている時間が減った分、1.0 → 1.1・0.2 → 0.22 に上げた
  // （/dl-cheat sim で、転職・進化・全クリアの日数が移動なしのときと同じになることを確かめた。NOTES.md）
  // 2.1.0: 群れが 1〜3 匹 → 10〜30 匹になり、移動（1.2 秒）が 10〜30 匹ごとになって戦っている時間が増えたので、1.1 → 1.0・0.22 → 0.2 に戻した
  // （/dl-cheat sim の日数が 2.0.1 と ±1 日以内。NOTES.md の 2.1.0）
  expPerKill: 1.0,
  expGrowth: 1.014,
  goldPerKill: 0.2,
  bossRewardRate: 40,
  /** ボスに負けたら 1 つ前のステージで稼ぎ、この秒数（戦闘時間）たったら自動で再挑戦 */
  bossRetrySeconds: 20 * 60,
}

/**
 * 職ごとの特徴（騎士 = 防御・粘り、魔導士 = 範囲攻撃、狙撃手 = 会心）。
 * 転職は横に移るだけ（強くはならない）なので、3 職とも「強さの合計」がだいたい同じになるように、得意の分だけ攻撃を少し下げている。
 */
export const JOBS = {
  novice: { attack: 1, hp: 1, defense: 0, aoe: 1, critRate: 0.05, critDamage: 2 },
  'backend-knight': { attack: 0.9, hp: 1.5, defense: 0.4, aoe: 1, critRate: 0.05, critDamage: 2 },
  'frontend-mage': { attack: 0.9, hp: 0.9, defense: 0, aoe: 1.3, critRate: 0.05, critDamage: 2 },
  'infra-sniper': { attack: 0.9, hp: 0.95, defense: 0, aoe: 1, critRate: 0.25, critDamage: 2.3 },
}

/**
 * 転職: Lv がここまで来たら 3 職のどれかを選べる（目安: 約 1 週間）。そのあとは自由に移れる。
 * cooldownMs: 一度移ったら、次に移れるまでの時間。
 */
export const JOB_CHANGE = { level: 20, cooldownMs: 30 * 60 * 1000 }

/**
 * 進化: シニア → スタッフ → プリンシパル（目安: 約 10 日・20 日・30 日）。
 * levels[i] = i+1 段目に進化できる Lv。powerRate[i] = i 段目の戦闘力の倍率（0 段目 = まだ進化していない）。
 * 段階は転職しても引き継ぐ。
 */
export const EVOLUTION = { levels: [24, 34, 44], powerRate: [1, 1.35, 1.8, 2.4] }

/** レベルと戦闘力（仮の式） */
export const LEVEL = {
  max: 200,
  /** Lv n → n+1 に必要な経験値 = base × n ^ exponent */
  expBase: 40,
  expExponent: 1.6,
  /** 戦闘力 = powerBase + Lv × powerPerLevel + 装備の強さの合計 */
  powerBase: 100,
  powerPerLevel: 55,
}

/** 1 日の区切り（ローカル時刻の何時に日付が変わるか） */
export const DAY_START_HOUR = 4

/** 装備とランプ（仮の値） */
export const GEAR = {
  /** レア度ごとの出やすさ（コモン〜ミシック、合計は 100 でなくてよい） */
  rarityWeights: [50, 28, 14, 6, 1.6, 0.4],
  /** レア度ごとの強さの倍率 */
  rarityPower: [1, 1.4, 2, 3, 4.5, 7],
  /** 枠ごとの基本の強さ */
  slotPower: { weapon: 30, head: 14, body: 20, arms: 14, legs: 14, charm: 18 },
  /** ドロップ時の Lv が 1 上がるごとに強さが何割増えるか */
  perLevel: 0.12,
  /** 強さのぶれ（±何割） */
  spread: 0.15,
  /** 売ったときのゴールド = 強さ × これ × (レア度 + 1) */
  sellRate: 0.5,
  /** 「レア以上は手動で確認」のレア（0 始まりの番号） */
  manualFrom: 2,
  /** 自動ランプが 1 回のタイマーで叩く最大回数 */
  autoLampPerTick: 3,
}

/**
 * 戦闘画面の見た目（仮の値）。攻撃の速さは見た目だけで、進み方（1 秒のダメージ）は変わらない。
 * 1 回の攻撃の長さ = attackSeconds ÷（1 + perLevel ×（Lv − 1）+ perEvolution × 進化の段階）、ただし minSeconds より短くしない。
 */
export const BATTLE = {
  /** 最初の 1 回の攻撃の長さ（秒）。ベータ 1 回目の 2.4 秒の 3 倍の速さ */
  attackSeconds: 0.8,
  attackSpeedPerLevel: 0.012,
  attackSpeedPerEvolution: 0.25,
  /** いちばん速いときの 1 回の攻撃の長さ（秒） */
  minSeconds: 0.32,
  /** 敵を倒すまでの攻撃回数（演出だけ。実際の進行は時間で決まる） */
  hitsToDefeat: 3,
  /** 何回に 1 回会心が出るか（演出） */
  critEvery: 3,
}

/**
 * 移動（キノコ伝説ふう）: 群れを全部倒して次の群れが出るたびに、主人公がその場で走り、背景が左へ流れ、
 * 次の群れが右から歩いて入ってくる。そのあいだ戦闘は止まっている（戦闘の秒数で数える。作業中の 3 倍速なら 1/3 の長さ）。
 * ステージが変わるときは、移動の途中で暗転して「STAGE x-y」（章が変わるときは章の名前）が出る。
 */
export const TRAVEL = {
  /** 移動の長さ（戦闘の秒数）。ここだけ変えれば、戦闘の計算・予約・HP バー・画面の動きがそろって変わる */
  seconds: 1.2,
}

/** X ポスト */
export const SHARE = {
  /** 配布ページの URL（まだ無いので空。空ならポストに付けない） */
  pageUrl: '',
  /** X の投稿画面を開くリンク */
  intentUrl: 'https://x.com/intent/post',
}

/** 音（BGM はサイド画面が表示されている間だけ流れる） */
export const SOUND = {
  /** サイド画面が表示されているかを確かめる間隔（ミリ秒） */
  checkMs: 3_000,
}

/** セーブの書き出し / 読み込み */
export const SAVE_FILES = {
  /** 読み込むファイル（または貼り付けた JSON）の大きさの上限。これより大きいものは読まない */
  importMaxBytes: 1_000_000,
  /** 同じ名前のファイルがあったとき、-2, -3 … と番号を付けて試す最大の数 */
  maxNameTries: 100,
}

