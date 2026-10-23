# デバッグ伝説 / Debug Legend

[日本語](#日本語) | [English](#english)

---

## 日本語

Claude Code で作業するほど強くなる、放置型 RPG の mod（プラグイン）です。
Claude に答えてもらうと装備が出る「宝箱」がたまり、時間がたつと主人公が勝手にバグやエラーの敵と戦って、ステージを進んでいきます。

- 全 10 章 × 10 ステージ。各章の最後にボス（マージコンフリクト、無限ループの竜、ガベージコレクター…）
- 雑魚は各章 30 種・全 300 種。1 ステージに 10〜30 匹が 3 匹ずつ襲ってくる
- 装備 6 枠 × レア度 6 段階。強ければ自動で装備、弱ければ売却
- Lv20 で 3 系統に転職: バックエンド騎士（防御）／フロントエンド魔導士（範囲攻撃）／インフラ狙撃手（会心）。さらに 3 段階の進化
- 遊んだ日ごとに新しい施設が開く 14 日間の冒険: 商店・鉱山・農場・日課・ペット・遠征・鍛冶屋・超能力・金山・図鑑…そして真のラスボス
- 閉じていた間の分も、最大 8 時間ぶんまとめて受け取り
- 日本語 / English

紹介動画（PV・約 60 秒）: [docs/pv/debug-legend-pv.mp4](docs/pv/debug-legend-pv.mp4)

### インストール

**デスクトップアプリ**

1. 入力欄の横の **+** を押す
2. **Plugins** → **Add marketplace** で `Tomatonandesu/debug-legend` を入力
3. **Add plugin** で **debug-legend** を追加

**ターミナル**（Claude Code のプロンプトで）

```
/plugin install debug-legend --marketplace Tomatonandesu/debug-legend
```

`Add marketplace?` には `y`、スコープはそのまま Enter で選びます。シェルからなら次のとおりです。

```bash
claude plugin install debug-legend --marketplace Tomatonandesu/debug-legend
```

### 遊び方

- 入力欄の上の帯に、主人公と敵、ステージの進み具合、「宝箱 ×N」が出ます。**画面を開く**（または `/dl-open`）でサイドの広い画面が開きます。
- **戦闘**タブ: 上が戦闘、下が育成です。**宝箱を開ける**と装備が 1 つ出ます。
- **装備**タブ: いまの装備 6 枠。**職と進化**タブ: Lv20 で職を選び、進化・超能力。**街**・**採集**・**仲間**タブ: 施設（開いたものから遊べます）。**暦**タブ: 14 日間の予定・図鑑。**ステータス**タブ: 詳しい数字。**設定**タブ: 宝箱を自動で開ける・自動判断・通知・音量・帯の折りたたみ・言語。
- 燃料:
  - Claude の回答 1 回 = 宝箱 1 個（1 日の上限あり、ストックは 200 まで）
  - ツールの成功 = 少しのゴールド
  - トークン = 少しのおまけ（たくさん使っても得はしません）
  - 時間 = ステージが進む（Claude が作業中は 3 倍速）
- ボスに負けたら、その章のステージをめぐって稼ぎ、しばらくして再挑戦します（**ボスに挑む**ですぐ再挑戦も）。
- 転職・エピック以上のドロップ・ボス撃破のあとは **X でポスト**のリンクが出ます。

コマンド:

| コマンド | 内容 |
|---|---|
| `/dl` | いまの状態 |
| `/dl-open` | サイド画面を開く |
| `/dl-export` | セーブをファイルに書き出す（`~/.claude/debug-legend/exports/`） |
| `/dl-import [パス]` | 書き出したセーブを読み込む |

### プライバシー

- **プロンプトや作業の内容を外部に送りません。** mod が使うのは「回答が終わった」「ツールが成功した」「使ったトークン数」「時間」だけで、プロンプト・回答・ツールの中身は使いません（保存も送信もしません）。
- セーブはこのパソコンの中（Claude Code の設定フォルダ）にだけ保存されます。
- **X ポストはリンクを開くだけ**です。mod から X に何かを送ることはありません。本文はゲームの情報（職・Lv・戦闘力・装備・ボス）だけで、作業の内容は入りません。

### 既知の制限

- 音（BGM・効果音）は、サイド画面を開いている間だけ鳴ります。**Windows では、Claude Code の mod の音の仕組みが対応していないため、初めは鳴りません**（既定ではオフ）。設定タブの「Windows で音を鳴らす（PowerShell を使う）」をオンにすると、Windows 標準の PowerShell を起動して、mod に同梱した音のファイルだけを鳴らします（ほかのファイルは鳴らさず、外へは何も送りません）。macOS などでは設定なしで鳴ります。
- ターミナルでは文字だけの簡単な表示です。スマホ（Remote Control）向けの調整はしていません（パソコンでの利用を想定しています）。
- セーブは端末ごとです（別のパソコンとは同期しません。`/dl-export` と `/dl-import` で移せます）。

### クレジット

- ドット絵（キャラクター・敵・背景）: OpenAI Codex で生成した画像を、ドット絵に加工したもの
- BGM・効果音: Python（numpy）で合成したオリジナル
- コード: MIT ライセンス（[LICENSE](LICENSE)）

---

## English

An idle RPG mod (plugin) for Claude Code that grows stronger the more you work with Claude.
Every answer from Claude gives you a treasure chest that drops gear, and as time passes your hero fights bug-and-error monsters on its own and pushes through the stages.

- 10 chapters × 10 stages, with a boss at the end of each chapter (Merge Conflict, Infinite Loop Dragon, Garbage Collector…)
- 30 kinds of monsters per chapter, 300 in all. Each stage sends 10–30 of them at you, three at a time
- 6 gear slots × 6 rarities. Stronger gear is equipped automatically, weaker gear is sold
- Change class at Lv20: Backend Knight (defense) / Frontend Mage (area attacks) / Infra Sniper (critical hits), then rank up three times
- A 14-day adventure that opens a new place each day you play: Shop, Mine, Farm, Quests, Pets, Expeditions, Blacksmith, Psychic Powers, Gold Mines, Codex… and a true final boss
- Collect up to 8 hours of progress from while you were away
- 日本語 / English

Trailer (about 60 seconds, in Japanese): [docs/pv/debug-legend-pv.mp4](docs/pv/debug-legend-pv.mp4)

### Install

**Desktop app**

1. Click **+** next to the prompt box
2. **Plugins** → **Add marketplace**, and enter `Tomatonandesu/debug-legend`
3. **Add plugin** → **debug-legend**

**Terminal** (at the Claude Code prompt)

```
/plugin install debug-legend --marketplace Tomatonandesu/debug-legend
```

Answer `y` to `Add marketplace?` and press Enter for the scope. From a shell:

```bash
claude plugin install debug-legend --marketplace Tomatonandesu/debug-legend
```

### How to play

- The bar above the prompt shows your hero, the enemy, stage progress and "Chests ×N". Press **Open** (or `/dl-open`) for the wide side panel.
- **Battle** tab: the fight on top, your build below. **Open a chest** to get one item.
- **Gear** tab: your 6 slots. **Class & Rank** tab: choose a class at Lv20, rank up, psychic powers. **Town**, **Gather** and **Companions** tabs: the places you have opened. **Calendar** tab: the 14-day roadmap and the codex. **Status** tab: the numbers. **Settings** tab: open chests automatically, auto decide, notifications, volume, folding the bar, language.
- Fuel:
  - Each answer from Claude = 1 chest (daily cap, stock up to 200)
  - Successful tools = a little gold
  - Tokens = a small bonus (spending more does not help)
  - Time = stage progress (3× faster while Claude is working)
- Lose to a boss and you train on that chapter's stages for a while before trying again (or press **Challenge the boss**).
- After a class change, an Epic or better drop, or a boss defeat, a **Post on X** link appears.

Commands:

| Command | What it does |
|---|---|
| `/dl` | Show your progress |
| `/dl-open` | Open the side panel |
| `/dl-export` | Export your save to a file (`~/.claude/debug-legend/exports/`) |
| `/dl-import [path]` | Import an exported save |

### Privacy

- **Your prompts and work are never sent anywhere.** The mod only uses the facts that an answer finished, that a tool succeeded, how many tokens were used, and the time. It never uses the content of prompts, answers or tools (nothing is stored or sent).
- Your save stays on this computer (in Claude Code's config folder).
- **Posting on X only opens a link.** The mod sends nothing to X. The text holds game info only (class, level, power, gear, bosses), never your work.

### Known limitations

- Music and sound effects play only while the side panel is open. **On Windows nothing plays by default** (Claude Code's mod audio does not support Windows yet), and the Windows sound setting is off. If you turn on "Play sound on Windows (uses PowerShell)" in the Settings tab, the mod starts the built-in Windows PowerShell and plays only the sound files bundled with the mod (nothing else is played, and nothing is sent anywhere). On macOS and others, sound works without any setting.
- The terminal shows a simple text-only view. The screens are not tuned for phones (Remote Control); the mod is made for desktop use.
- Saves are per device (no sync; move them with `/dl-export` and `/dl-import`).

### Credits

- Pixel art (characters, enemies, backgrounds): images generated with OpenAI Codex, then converted to pixel art
- Music and sound effects: original, synthesized with Python (numpy)
- Code: MIT License ([LICENSE](LICENSE))
