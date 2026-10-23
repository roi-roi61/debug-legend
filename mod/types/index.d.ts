/** 1 日ごとにリセットされる上限カウンター */
export type Daily = {
  /** どの日の値か（YYYY-MM-DD、DAY_START_HOUR で日付が変わる） */
  day: string
  /** 回答でたまったランプ回数 */
  turnLamps: number
  /** ツール呼び出しでもらったゴールド */
  toolGold: number
  /** トークンのおまけ（ランプ何回分か） */
  tokenBonus: number
}

export type StagePos = {
  /** 章（1〜10） */
  chapter: number
  /** 章の中のステージ（1〜10。10 はボス） */
  stage: number
  /** その前にいた面（1〜10）。ボスに負けたあとの稼ぎは面がとぶので、倒れたばかりの前の群れを出すのに使う。無ければ 1 つ前 */
  from?: number
  /** いまのステージの群れ（1〜3 匹）のうち、倒した数（端数あり） */
  kills: number
  /** ボス戦が始まってからの秒数 */
  bossTime: number
  /** 次の群れ（ボス）のところまで移動している残りの秒数（戦闘の秒数）。0 になってから戦いが始まる。無ければ 0 */
  travel?: number
}

/** 職（見習いコーダー → Lv20 で 3 系統のどれか） */
export type JobId = 'novice' | 'backend-knight' | 'frontend-mage' | 'infra-sniper'

/** 時間で進んだ戦闘のまとめ（オフライン報酬のお知らせにも使う） */
export type BattleReport = {
  /** 戦った秒数（作業中の加速込み） */
  seconds: number
  kills: number
  exp: number
  gold: number
  levels: number
  /** 進んだステージの数 */
  stages: number
  /** 倒したボスの章 */
  bossWins: number[]
  /** 負けたボスの章 */
  bossLosses: number[]
}

/** 閉じていた間のまとめ（次に開いたときにお知らせする。閉じるボタンで消す） */
export type AwayReport = BattleReport & { ms: number; at: number }

/** 装備の 6 枠 */
export type SlotId = 'weapon' | 'head' | 'body' | 'arms' | 'legs' | 'charm'

/** 装備 1 つ。rarity は 0（コモン）〜 5（ミシック） */
export type Item = {
  id: number
  slot: SlotId
  rarity: number
  /** ドロップしたときのプレイヤーの Lv */
  level: number
  power: number
  /** 名前の組み立てに使う番号（文言は texts.ts） */
  nameIndex: number
  /** 鍛冶屋での強化段階 */
  plus?: number
  /** セット装備の ID */
  set?: string
  /** ボス専用装備の ID */
  unique?: string
  /** 金の装飾を付けた */
  goldTrim?: boolean
  /** 闇市の呪い: 攻撃力が上がり、HP が下がる */
  curse?: boolean
}

/** ランプを叩いた結果 */
export type Drop = {
  item: Item
  /** equipped: 装備した / sold: 売った / pending: 手動で確認待ち */
  action: 'equipped' | 'sold' | 'pending' | 'stashed'
  /** 売ったときのゴールド（装備したときは外した装備を売った額） */
  gold: number
  at: number
}

/** 画面の言語。auto は Claude Code の言語設定に合わせる（取れなければ日本語） */
export type Language = 'auto' | 'ja' | 'en'

export type Settings = {
  /** 強ければ装備・弱ければ売却を自動で決める */
  autoJudge: boolean
  /** レア以上は自動で決めず、手動で確認する */
  manualRareUp: boolean
  /** ランプを自動で叩く */
  autoLamp: boolean
  /** エピック以上のドロップをトーストで知らせる */
  notifyEpic: boolean
  /** ボス撃破をトーストで知らせる */
  notifyBoss: boolean
  /** BGM の音量（0〜10） */
  bgmVolume: number
  /** 効果音の音量（0〜10） */
  seVolume: number
  /** 全部の音を止める */
  isMuted: boolean
  /** Windows では PowerShell を使って音を鳴らす（初期値オフ） */
  windowsSound: boolean
  /** 入力欄の上の帯を 1 行にたたむ */
  isBandFolded: boolean
  language: Language
  /** 不具合を調べるための実機の記録を取る（/dl-debuglog） */
  debugLog: boolean
  /** 新しい施設が開いた日に 1 回だけお知らせする */
  notifyUnlock: boolean
  /** 自動判断で売るレア以上の装備を鍛冶屋の倉庫に取っておく */
  keepForSmith: boolean
}

/** 毎日の冒険（docs/DAILY.md）で、遊んだ日数で開く施設 */
export type FeatureId =
  | 'calendar'
  | 'shop'
  | 'mine'
  | 'farm'
  | 'missions'
  | 'pet'
  | 'expedition'
  | 'smith'
  | 'premium'
  | 'psychic'
  | 'goldmine'
  | 'bigfarm'
  | 'pet2'
  | 'codex'

/** 時間（戦闘の秒数）か回数で切れるバフ。power = 攻撃、exp = 経験値、gold = 雑魚のゴールド、luck = 宝箱のレア度が 1 段上がる確率。料理は killSpeed・bossHp・crit・fortune・all（攻撃・経験値・ゴールド）・heal（ボス戦 1 回の HP）も */
export type BuffKind = 'power' | 'exp' | 'gold' | 'midas' | 'luck' | 'killSpeed' | 'bossHp' | 'crit' | 'fortune' | 'all' | 'heal'
/** dish があれば料理のバフ（同時に 2 つまで。薬とは別に数える） */
export type Buff = { kind: BuffKind; rate: number; until?: number; charges?: number; dish?: string }

/** 商店（docs/DAILY.md の 3 章） */
export type ShopState = {
  /** 今日（品・入れ替え・買った数の日付） */
  day: string
  /** 今日の手動の入れ替えの回数 */
  refreshes: number
  /** 今日買った数（品 ID → 個数） */
  bought: Record<string, number>
  /** 店主ミナの好感度の点 */
  points: number
  /** 使った額の合計（物価 P の何倍か。常連ランク） */
  spent: number
  /** あいさつした日 */
  greetDay: string
  /** ミナのお守りをもらった週（月曜の日付） */
  amuletWeek: string
  /** 常連の福袋をもらった週 */
  bagWeek: string
}

/** 冒険の暦（遊んだ日数・ログインスタンプ・説明を見たか） */
export type Calendar = {
  /** 遊んだ日数（Claude が 1 回以上答え終わった日。朝 4 時で日付が変わる） */
  playedDays: number
  /** 最後に数えた日（YYYY-MM-DD。'' = まだ） */
  lastPlayedDay: string
  /** 1 日目（'' = まだ） */
  firstDay: string
  /** 説明を見終わった施設（見るまでタブに NEW の印） */
  seen: FeatureId[]
  /** 押したログインスタンプの数（14 までは最初のカード、そのあとは 28 日カードをくり返す） */
  stamps: number
  /** この版を入れたとき、もう第 3 章より先にいた（商店の先輩のおまけ） */
  isVeteran: boolean
  /** 説明のあとの最初の贈り物を受け取った施設 */
  gifted: FeatureId[]
}

/** 日課・週課 1 つ。進み具合 = missions.counts[id] - base */
export type Mission = {
  /** 数える行動の種類（kills / bossTries / chests / shopBuys / potions / mineHits / stairs） */
  id: string
  goal: number
  /** その日（週）のはじめのカウンターの値 */
  base: number
  claimed: boolean
}

/** 日課・週課・実績（版 12、docs/DAILY.md の 6 章） */
export type Missions = {
  /** 日課を選んだ日（朝 4 時で変わる） */
  day: string
  daily: Mission[]
  /** 今日、日課を入れ替えた */
  dailySwapped: boolean
  /** 3 つ全部のおまけを受け取った */
  dailyAllClaimed: boolean
  /** 週課を選んだ週（月曜の日付） */
  week: string
  weekly: Mission[]
  weeklyAllClaimed: boolean
  /** ずっとの合計（kills・bossTries・bossWins・chests・shopBuys・potions・answers と、倒した数の端数 killsFraction） */
  counts: Record<string, number>
  /** ごほうびを受け取った実績の ID */
  achievements: string[]
}

/** 鉱山のマス 1 つ。kind = dirt/rock/hard/ore/gem/chest/monster/fossil/spring/stairs/diary、hp = 開くまでに叩く残りの回数 */
export type MineCell = {
  kind: string
  hp: number
  open: boolean
  prize?: MineHaul
  /** 負けた魔物が生きている（open のまま。もう一度押すと戦える。版 22） */
  alive?: true
}

/** 鉱山のボスと最後に戦った記録（画面で戦いを見せる用。割合は 0〜1。版 22） */
export type MineBossFight = { floor: number; won: boolean; seconds: number; limit: number; heroHpLeft: number; bossHpLeft: number; at: number }

/**
 * 離れた階の掘った跡（版 23）。マスは階の番号・周回・セーブの種から作り直せるので、触ったマスだけ持つ。
 * open = 開いて空のマス、hurt = 叩きかけの閉じたマス（番号 → 残りの回数）、alive = 生きた魔物、prizes = 賞品が置いてあるマス（番号 → 賞品）
 */
export type MineFloorRecord = { open: number[]; hurt: Record<string, number>; alive: number[]; prizes: Record<string, MineHaul> }

/** 鉱山でいちどに手に入れたもの（最後に掘った結果・自動採掘のまとめ）。flags = できごとの印（stairs / spring / win / lose / fossil-3 / diary-0 / boss-win など） */
export type MineHaul = { items: Record<string, number>; gold: number; lamps: number; exp: number; stars: number; flags: string[] }

/** 鉱山（版 13、docs/DAILY.md の 4 章） */
export type MineState = {
  /** いまの階（1 から） */
  floor: number
  /** いちばん深く降りた階 */
  deepest: number
  /** いまの階の 7 列 × 5 段 = 35 マス（空 = まだ作っていない。階の作りは階の番号とセーブの種から決まる） */
  grid: MineCell[]
  /** いまの階のできごと（''・vein・collapse・treasure・gas・diary） */
  event: string
  /** 今日、ツール成功でためたつるはしの回数（1 日 60 回まで）と、5 回に満たない端数 */
  picksToday: number
  toolsFraction: number
  /** picksToday の日付 */
  day: string
  /** つるはしの段（0 木 〜 6 星鉄） */
  pickaxe: number
  /** 爆弾モード */
  bomb: boolean
  /** 自動採掘のオン・オフと、最後に追いついた時刻 */
  auto: boolean
  autoAt: number
  /** 叩いた回数の合計（当たりの乱数の種） */
  swings: number
  /** 倒したボスの階 */
  bossesBeaten: number[]
  /** 見つけた化石の種類（1〜10）・読んだ日記の番号（0〜11） */
  fossils: number[]
  diaries: number[]
  /** 最後に掘った結果 */
  last: MineHaul | null
  /** さっきの自動採掘 */
  autoLast: { items: Record<string, number>; hits: number } | null
  /** 最後にボスと戦った記録（版 22。無ければ未設定） */
  lastBoss?: MineBossFight
  /** 作り直した回数（0 から。版 23）。全部の階を掘り終えるたびに 1 増え、階が新しくなる */
  round: number
  /** この周回で倒したボスの階（作り直しで空に戻る）。bossesBeaten は「ずっと」の記録 */
  roundBosses: number[]
  /** いまの階以外の、触ったことのある階の記録（キー = 階の番号） */
  floors: Record<string, MineFloorRecord>
}

/** 農場の区画 1 つ（版 14）。育ち具合は「from 以降」の時間から、表示のときに計算する（毎秒は書かない） */
export type FarmPlot = {
  /** 作物（carrot など） */
  crop: string
  /** まいた時刻 */
  at: number
  /** from の時点までに育った時間（ミリ秒） */
  grown: number
  /** 続きを数え始める時刻（まいた時刻。水やり・駆除・肥料のたびに進む） */
  from: number
  /** 回答の水やりで縮めた時間の合計（ミリ秒。作物ごとに 30% まで） */
  watered: number
  /** 肥料をまいた */
  fert: boolean
  /** 金色の種を使った。収穫が必ず金色になる */
  golden?: boolean
}

/** 最後の収穫 */
export type FarmLast = { crop: string; quality: string; amount: number; isOverripe: boolean; stars: number }

/** 農場（版 14、docs/DAILY.md の 5 章） */
export type FarmState = {
  /** 6 区画（null = 空き） */
  plots: (FarmPlot | null)[]
  /** 農場の経験値（収穫でたまる。Lv は 1〜20） */
  xp: number
  /** 一度でも収穫した作物（レシピが増える） */
  harvested: string[]
  /** 駆除したバグの数 */
  bugsKilled: number
  /** 開発用チートの天気（その日だけ） */
  cheat: { day: string; weather: string } | null
  last: FarmLast | null
  /** 温室の区画（建てていなければ空。6 区画。天気の影響なし・成長 +20%） */
  greenhouse: (FarmPlot | null)[]
  /** 取り付けたスプリンクラーの数（1 台で 6 区画）と、最後に水をまいた時刻 */
  sprinklers: number
  sprinkledAt: number
  /** 家畜（牧場）。買っていない家畜は入っていない */
  animals: Record<string, Animal>
  /** 置いた飾り（かかし・花壇・噴水・風車・看板・ペットの小屋） */
  decor: string[]
  /** 看板の名前の番号（0 = 付けていない） */
  signName: number
  /** ペットの小屋で好感度を足した日 */
  petHouseDay: string
}

/** 家畜 1 匹（版 19）。fedAt = エサをあげた時刻（0 = 空腹。間隔がたつと産物がとれる）、boosted = みつばちの花で 2 倍 */
export type Animal = { affinity: number; fedAt: number; boosted: boolean; patDay: string }

export type PetSpecies = 'duck' | 'drake' | 'fox' | 'owl' | 'golem' | 'whale'
export type PetForm = 1 | 2 | 3
export type Pet = {
  id: string
  species: PetSpecies
  name: string
  level: number
  exp: number
  form: PetForm
  affinity: number
  collar: string | null
}
export type PetEgg = { species: PetSpecies; answers: number }
export type PetsState = {
  owned: Pet[]
  /** 戦闘に出す仲間（13 日目以降を見越して 2 枠） */
  active: string[]
  egg: PetEgg | null
  pats: { day: string; count: number }
  /** 13 日目の無料の卵（新しい 3 種から選ぶ）をもう選んだ */
  freeEgg: boolean
}

export type AdventurerId = 'gald' | 'rico' | 'sage' | 'luna'
export type ExpeditionLunch = 'none' | 'lunchbox' | 'dish-onigiri'
export type ExpeditionTrip = {
  chapter: number
  hours: 1 | 4 | 8
  startAt: number
  pet?: string
  lunch: ExpeditionLunch
}
export type Adventurer = {
  id: AdventurerId
  level: number
  exp: number
  trip?: ExpeditionTrip
}
export type ExpeditionState = { adventurers: Adventurer[]; contract: boolean }

/** 上級商店の週次購入記録 */
export type PremiumState = { week: string; bought: Record<string, number>; saleWeek: string }

/** 闇市の夜間購入、ノクスの好感度、読んだ話 */
export type BlackMarketState = { night: string; bought: Record<string, number>; points: number; stories: string[] }

/** 超能力（版 18）。procLog は技の発動記録、goldHandAt は宝箱技の前回時刻 */
export type PsychicProc = { id: string; at: number; count: number; total: number }
export type PsychicState = {
  nodes: string[]
  resets: number
  midasDay: string
  bossMemory: Record<number, number>
  goldHandAt: number
  procCount: number
  lastProc: string
  procAt: number
  procLog: PsychicProc[]
}

/** 金山・銀山の 1 回の回収（最後の結果） */
export type GoldMineHaul = { gold: number; silver: number; converted: number; at: number }

/** 金山・銀山（版 19、docs/DAILY.md の 12 章）。生産は実時間で「最後に回収した時刻」から計算する（毎秒は書かない） */
export type GoldMineState = {
  /** 線路の数（金・銀それぞれ 1〜4） */
  goldLines: number
  silverLines: number
  /** 速さ・容量の強化段階（0〜10）、トロッコの見た目（0 木・1 鉄・2 金） */
  speed: number
  capacity: number
  cart: number
  /** 最後に回収した時刻。0 = まだ（建てた時刻から数える） */
  collectedAt: number
  /** ゴールドラッシュ（作業中は 3 倍）のための、作業中だった時間の合計（ミリ秒）と、そこまで数えた時刻 */
  workMs: number
  workAt: number
  /** 最後に回収したときの workMs */
  collectWork: number
  /**
   * 作業中だった時間の記録（[始め, 終わり] の組。workAt までの分）。spansFrom からは、この記録で正確に分かる。
   * それより前（最後の回収から spansFrom まで）は、workMs - collectWork - 記録の合計 を平らにならして使う（古いセーブはこちら）。
   * 回収のたびに空にする。古いものから捨てるときは、先に生産を確定（settledAt）してから spansFrom を進める
   */
  workSpans: [number, number][]
  spansFrom: number
  /**
   * 確定したところ。settledAt までの生産を、線路ごとに「時間」（レートを掛ける前）で持つ（settledGold[線路の番号]・settledSilver）。
   * 作業の記録を捨てる前、トロッコで boostUntil を書き換える前に、そこまでを確定してから変える。回収で空に戻す。
   * 古いセーブには無い（無いときは 0 と collectedAt で読む）
   */
  settledAt: number
  settledGold: number[]
  settledSilver: number[]
  /** 直した脱線（イベントの印 → 直した時刻）、拾った金の塊（イベントの印）。古いものは消える */
  fixed: Record<string, number>
  nuggets: string[]
  /** 金のトロッコ（持ち物）を使って生産が 2 倍の間 */
  boostUntil: number
  last: GoldMineHaul | null
}

/** 図鑑（版 20、docs/DAILY.md の 14 章）。雑魚の討伐数・ボスの勝った回数と最短時間・集めた装備、料理、鉱石などの印と、もらった収集率のごほうび */
export type CodexState = {
  /** 雑魚の ID → 倒した数（群れを倒し切るたびに +1） */
  kills: Record<string, number>
  /** 章 → 本編のボスに勝った回数、最短の勝ち時間（秒） */
  bossWins: Record<number, number>
  bossBest: Record<number, number>
  /** 見つけたものの印（gear:スロット:名前:レア度 / set:セット:スロット / boss:ID / gold:作物 / dish:料理 / ore:ID） */
  seen: string[]
  /** もらったごほうびの ID（tier:10 など / cat:mobs など） */
  claimed: string[]
}

/** 魂の試練 1 章ぶん。best = 最短の勝ち時間（秒、0 = まだ）、readyAt = また挑める時刻（実時間） */
export type SealTrial = { best: number; readyAt: number }

/** 真のラスボスとの 1 回の戦い（段階ごとの結果） */
export type TrueBossPhase = { phase: 1 | 2 | 3; seconds: number; damage: number; heroHpLeft: number; bossHpLeft: number }
export type TrueBossLast = { won: boolean; loop: number; at: number; seconds: number; phases: TrueBossPhase[]; reason: 'win' | 'down' | 'time' }

/** 封印の魔法陣（版 20）。offered = 台座に捧げた章 */
export type SealState = {
  offered: number[]
  trials: Record<number, SealTrial>
  /** 最後の魂の試練 */
  lastTrial: { chapter: number; won: boolean; seconds: number; at: number } | null
  trueBoss: {
    /** 挑んだ回数、勝った周回の数（0 = まだ。ハードで勝つと 2…）、また挑める時刻、封印のほころび（0〜5。1 つで次の戦いの最初に HP -3%） */
    tries: number
    beaten: number
    readyAt: number
    fray: number
    /** 最短の勝ち時間（秒、0 = まだ）と最後の戦い */
    best: number
    last: TrueBossLast | null
  }
}

/** X にポストできるできごと（いちばん新しいもの 1 つ） */
export type ShareMoment =
  | { kind: 'job'; job: JobId; at: number }
  | { kind: 'evolve'; job: JobId; evolution: number; at: number }
  | { kind: 'drop'; item: Item; at: number }
  | { kind: 'boss'; chapter: number; at: number }
  | { kind: 'trueboss'; loop: number; at: number }

/** 時間を進める役（同じセーブを使うセッションのうち 1 つだけ。hooks/lease.ts） */
export type TimeLease = {
  /** 役を持っているセッション */
  owner: string
  /** そのセッションで動いているコード（ビルド識別子のハッシュと、ビルド時刻） */
  build: string
  builtAt: string
  /** この時刻までに更新されなければ、ほかのセッションが引き継ぐ */
  until: number
  /** そのセッションでサイド画面が開いているか */
  isWatching: boolean
}

/** あるセッションの作業中（3 倍速）の印 */
export type BusyMark = {
  owner: string
  from: number
  /** 終わった時刻（作業中なら null） */
  to: number | null
  /** 作業中だと最後に確かめた時刻（閉じられたセッションの印は、ここから 30 秒で切れる） */
  seen: number
}

/** $.store に保存するセーブデータ（版 19） */
export type SaveData = {
  version: 23
  createdAt: number
  /** 最後に時間の進行を計算した時刻 */
  lastTickAt: number
  level: number
  exp: number
  gold: number
  /** ゴールドの端数（0 以上 1 未満）。雑魚 1 匹のゴールドは 1 に満たないので、ためて 1 になったぶんを gold に足す */
  goldFraction: number
  /** ランプ（装備ドロップ）のストック回数 */
  lamps: number
  /** トークンのおまけの端数（1 になるとランプ +1） */
  bonusFraction: number
  stage: StagePos
  daily: Daily
  totals: {
    turns: number
    toolCalls: number
    tokens: number
    offlineMs: number
    drops: number
  }
  equipment: Record<SlotId, Item | null>
  /** 鍛冶屋の装備倉庫（最大 60 個） */
  stash: Item[]
  /** 鍛冶屋の好感度と保護石の週次受取 */
  smith: { zeal: number; points: number; guardWeek: string }
  /** 手動で確認待ちの装備（あるあいだはランプを叩けない） */
  pending: Item | null
  lastDrop: Drop | null
  /** 乱数の状態（再読み込みでドロップを引き直せないように、セーブに持つ） */
  rng: number
  nextItemId: number
  settings: Settings
  job: JobId
  /** 進化の段階（0 = まだ、1 = シニア、2 = スタッフ、3 = プリンシパル）。転職しても引き継ぐ */
  evolution: number
  /** 最後に転職した時刻（次に転職できるまでの待ち時間に使う。null = まだ転職していない） */
  jobChangedAt: number | null
  /** 通算の戦闘の秒数（ボスの再挑戦の時計） */
  battleSeconds: number
  boss: {
    /** ボスに負けたあと、この battleSeconds になったら自動で再挑戦（null: 負けていない） */
    retryAt: number | null
    /** 最後のボス戦 */
    last: { chapter: number; won: boolean; at: number } | null
  }
  /** 第 10 章のボスを倒した */
  isCleared: boolean
  away: AwayReport | null
  /** X にポストできるできごと（ポストするか閉じるまで出しておく） */
  share: ShareMoment | null
  /** 時間を進める役（null: まだ誰も持っていない） */
  clock: TimeLease | null
  /** 作業中の印（どのセッションの作業でも 3 倍速） */
  busy: BusyMark[]
  /**
   * 書いた変更（ランプ・装備・設定など）の印。新しいものから 64 個まで。
   * ほかのプロセスの書き込みで自分の変更が消えたかを、ここに自分の印が残っているかで見分ける（hooks/persist.ts）
   */
  applied: string[]
  /** 冒険の暦（版 10） */
  calendar: Calendar
  /** 素材・消耗品の持ち物（アイテム ID → 個数。装備は equipment / pending） */
  bag: Record<string, number>
  /** 星のかけら（上級商店の通貨）と超能力ポイント */
  wallet: { stars: number; psi: number }
  /** 持っている称号と、付けている称号 */
  titles: { owned: string[]; current: string | null }
  /** 商店（版 11） */
  shop: ShopState
  /** 効いている薬など */
  buffs: Buff[]
  /** 日課・週課・実績（版 12） */
  missions: Missions
  /** 鉱山（版 13） */
  mine: MineState
  /** 農場（版 14） */
  farm: FarmState
  /** 仲間（版 15） */
  pets: PetsState
  /** 遠征（版 15） */
  expedition: ExpeditionState
  /** 上級商店（版 17） */
  premium: PremiumState
  /** 闇市（版 17） */
  blackMarket: BlackMarketState
  psychic: PsychicState
  /** 本編で倒したボスの章（14 日目の魂にも使う） */
  beatenBosses: number[]
  /** 金山・銀山（版 19） */
  goldMine: GoldMineState
  /** 図鑑（版 20） */
  codex: CodexState
  /** 手に入れたボスの魂（章の番号） */
  souls: number[]
  /** 封印の魔法陣・真のラスボス（版 20） */
  seal: SealState
  /** ハード周回の数（0 = ふつう）。1 以上で敵の強さ 3 倍・報酬 2.5 倍 */
  hard: { loop: number }
}

/** ドット絵: 1 文字が 1 ドット。palette にない文字（'.' など）は透明 */
export type Sprite = {
  rows: string[]
  palette: Record<string, string>
}

/** art/export から取り込んだ絵（mod/scripts/sync_art.py が作る） */
export type Art = Sprite & {
  id: string
  name: string
  w: number
  h: number
}

/** サイド画面の下部タブ */
export type Tab = 'battle' | 'gear' | 'job' | 'town' | 'gather' | 'pets' | 'calendar' | 'status' | 'settings'

declare module 'claude-code' {
  interface PluginState {
    'debug-legend': {
      /** 描画用のセーブデータの写し（null: まだ読み込んでいない） */
      save: SaveData | null
      /** セーブが新しい版で読めないなど、ゲームを止めている理由 */
      problem: string | null
      /** サイド画面で開いているタブ */
      tab: Tab
      /** 転職タブで「これにする」を押した職（もう一度押して決定） */
      jobChoice: JobId | null
      /** Claude が作業中か（戦闘が 3 倍速になる。HP バーの減る速さに使う） */
      isWorking: boolean
      /** 施設の説明の、いま見ているコマ（0 始まり） */
      introStep: number
      /** 鉱山のボス戦の画面を出しているか */
      mineBossShown: boolean
      /** 街タブで開いている施設 */
      townView: 'shop' | 'expedition' | 'smith' | 'premium' | 'blackMarket'
      /** 闇市の説明を表示するコマ（0 始まり） */
      noxIntroStep: number
      /** 鍛冶屋で選んだ装備の合成・継承対象 */
      smithCombineChoice: number[]
      smithInheritSource: number | null
      smithInheritTarget: number | null
      /** 鍛冶屋で選んだセットと部位 */
      smithSetChoice: string
      smithSlotChoice: SlotId
      /** 採集タブで開いている施設 */
      gatherView: 'mine' | 'goldmine' | 'farm' | 'kitchen' | 'ranch'
      /** 農場で見ている畑のページ（0〜2 = 畑 1〜3、3 = 温室） */
      farmPage: number
      expeditionChapter: number
      expeditionHours: 1 | 4 | 8
      expeditionPet: string | null
      expeditionLunch: 'none' | 'lunchbox' | 'dish-onigiri'
      /** 鉱山で読んでいる日記の番号（-1 = 閉じている） */
      mineDiary: number
      /** 職タブで開いている節 */
      jobSection: 'job' | 'psychic'
      /** 超能力ツリーで選んだノード */
      psychicNode: string
      /** 超能力の振り直しの確認中か */
      psychicReset: boolean
      /** 暦タブで開いている節 */
      calendarView: 'calendar' | 'codex' | 'seal'
      /** 図鑑で開いている欄 */
      codexSection: string
      /** 図鑑の雑魚の欄で開いている章（"" = いまの章。"3" など） */
      codexMobChapter: string
      /** 図鑑で読んでいる読み物（'' = 閉じている。mine:3 など） */
      codexRead: string
      /** ハード周回の確認中か */
      hardConfirm: boolean
    }
  }
}
