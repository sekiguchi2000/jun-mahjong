# 純麻雀

牌操作なし・COM不正なしの四人打ち麻雀。PWA(Webアプリ)としてiPhoneのSafariで遊ぶ。

## 遊び方

1. `serve.cmd` をダブルクリック(PCでサーバー起動)
2. iPhone(同じWi-Fi)の Safari で `http://192.168.1.19:8642` を開く
3. 共有ボタン →「ホーム画面に追加」でアプリ化

PCブラウザなら `http://localhost:8642`。

※ オフライン動作(Service Worker)はHTTPS配信時のみ有効。GitHub Pages等に置けばWi-Fi外でも遊べる。

## 「純粋さ」の設計保証

- **シャッフル**: `js/engine/wall.js` — crypto(暗号学的乱数)のFisher-Yates一本のみ。配牌・ツモを操作するコードは存在しない
- **COMの視界**: `js/engine/game.js` の `viewFor()` — COMに渡るのは自分の手牌+全員の河・副露・ドラ表示牌のみ。他家の手牌や山を見る経路がない
- **COMの思考**: `js/engine/ai.js` — 牌効率(向聴数+受け入れ枚数)とベタ降りだけの正直な打ち手

## 構成

```
index.html / css/style.css / js/ui/main.js   … UI(スマホ縦持ち)
js/engine/
  rules.js    … 全ルール設定の一元管理(設定画面はここから自動生成)
  tiles.js    … 牌定義
  wall.js     … 山・シャッフル・配牌・王牌
  agari.js    … 和了形判定・面子分解
  shanten.js  … 向聴数・待ち牌
  yaku.js     … 役判定(通常役+役満+ドラ)
  score.js    … 符・点数・支払い
  game.js     … 対局進行(リーチ/鳴き/カン/フリテン/流局/連荘)
  ai.js       … COM思考
tests/        … node tests/test_core.mjs / test_yaku.mjs / test_game.mjs
```

## テスト

```
node tests/test_core.mjs    # 牌・山・和了判定・向聴数 (36)
node tests/test_yaku.mjs    # 役・符・点数 (55)
node tests/test_game.mjs 30 # COM4人で30半荘通し(点数保存則チェック)
```

## 実装済みルール設定

東風/東南/一荘・赤ドラ枚数・喰いタン・切り上げ満貫・一発・裏/槓ドラ・数え役満・
途中流局(九種九牌/四風連打/四家リーチ/四槓散了)・流し満貫・和了やめ・飛び・配給原点 ほか
(`js/engine/rules.js` の DEFAULT_RULES 参照)

## 既知の未実装・簡略化 (v1)

- 完全先付け(後付けなし)の厳密判定 — 現状は「役なし和了不可」のみ
- 大三元・大四喜の包(パオ)
- リーチ後の暗槓(待ち変化判定が必要なため v1 では禁止)
- COMのチー・明槓(門前重視の打ち手として意図的に見送り)
- ネットワーク対戦(第2段階で卓サーバー方式を追加予定)
