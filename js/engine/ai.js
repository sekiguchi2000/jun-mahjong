// ai.js — COMの思考
// 入力は viewFor() が渡す「自分の手牌+公開情報」のみ。それ以外を見る手段はない。
// 方針: 牌効率(向聴数→受け入れ枚数) + リーチ者がいれば降り(現物>字牌>端牌)。

import { toCounts, isHonor, isYaochu, isDragon, KIND_COUNT } from './tiles.js';
import { shanten, waitingTiles } from './shanten.js';

export class ComActor {
  constructor(name = 'COM') { this.name = name; this.isHuman = false; }

  async onTurn(view, options) {
    const handAll = view.drawn ? [...view.hand, view.drawn] : [...view.hand];
    const meldCount = view.melds.length;

    if (options.includes('tsumo')) return { action: 'tsumo' };
    if (options.includes('kyuushu')) return { action: 'kyuushu' };

    // 暗槓: 向聴数が悪化しないなら実行
    if (options.includes('ankan')) {
      const counts = toCounts(handAll);
      for (let k = 0; k < KIND_COUNT; k++) {
        if (counts[k] === 4) {
          const before = shanten(counts, meldCount);
          counts[k] = 0;
          const after = shanten(counts, meldCount + 1);
          counts[k] = 4;
          if (after <= before) return { action: 'ankan', kind: k };
        }
      }
    }

    // 降り判定: 他家リーチ && 自分2向聴以上 → ベタ降り
    const riichiThreats = view.public.players
      .map((pl, i) => ({ pl, i }))
      .filter(x => x.i !== view.me && x.pl.riichi);
    const counts13base = toCounts(view.hand);
    const myShanten = shanten(toCounts(handAll), meldCount) ;
    if (riichiThreats.length > 0 && myShanten >= 2 && !view.riichi) {
      const idx = this.pickSafeTile(handAll, riichiThreats, view);
      if (idx >= 0) return { action: 'discard', index: idx, riichi: false };
    }

    // リーチ中は自動ツモ切り
    if (view.riichi) return { action: 'discard', index: handAll.length - 1, riichi: false };

    // 牌効率: 各打牌後の(向聴数, 受け入れ枚数)で最良を選ぶ
    const visible = this.visibleCounts(view);
    let best = { idx: handAll.length - 1, sh: 99, ukeire: -1 };
    const tried = new Set();
    for (let i = 0; i < handAll.length; i++) {
      const key = `${handAll[i].kind}:${handAll[i].red}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const rest = handAll.slice();
      rest.splice(i, 1);
      const c = toCounts(rest);
      const sh = shanten(c, meldCount);
      let ukeire = 0;
      if (sh < best.sh || sh === best.sh) {
        for (let k = 0; k < KIND_COUNT; k++) {
          if (c[k] >= 4) continue;
          c[k]++;
          if (shanten(c, meldCount) < sh) ukeire += 4 - c[k] + 1 - (visible[k] || 0);
          c[k]--;
        }
      }
      // 赤5は温存(同種の黒があれば黒を切る): redを微減点
      const redPenalty = handAll[i].red ? 0.5 : 0;
      const score = ukeire - redPenalty;
      if (sh < best.sh || (sh === best.sh && score > best.ukeire)) {
        best = { idx: i, sh, ukeire: score };
      }
    }

    // リーチ判定: 打牌後聴牌・門前・残り山4枚以上なら宣言
    let declareRiichi = false;
    if (!view.riichi && best.sh === 0 && view.melds.every(m => m.type === 'ankan') &&
        view.public.remaining >= 4) {
      const rest = handAll.slice();
      rest.splice(best.idx, 1);
      const waits = waitingTiles(toCounts(rest), meldCount);
      const liveWaits = waits.reduce((a, k) => a + Math.max(0, 4 - (visible[k] || 0) - toCounts(rest)[k]), 0);
      if (liveWaits > 0) declareRiichi = true;
    }
    return { action: 'discard', index: best.idx, riichi: declareRiichi };
  }

  async onClaim(view, offer) {
    if (offer.type === 'ron') return { action: 'ron' };
    const meldCount = view.melds.length;
    const counts = toCounts(view.hand);

    // ポン: 役牌のみ(安直に鳴いて役なしになる事故を防ぐ)
    if (offer.canPon) {
      const k = offer.tile.kind;
      const isYakuhai = isDragon(k) || k === view.seatWind || k === view.roundWind;
      if (isYakuhai) return { action: 'pon' };
      // 対々和が近い(対子4つ以上)ならポン
      const pairs = counts.filter(c => c >= 2).length;
      if (pairs >= 4 && counts[k] >= 2) return { action: 'pon' };
    }
    // チー・明槓はv1では見送り(門前重視)
    return null;
  }

  // 見えている牌(自分の手牌・全員の河・副露・ドラ表示牌)のカウント
  visibleCounts(view) {
    const c = new Array(KIND_COUNT).fill(0);
    for (const t of view.hand) c[t.kind]++;
    if (view.drawn) c[view.drawn.kind]++;
    for (const pl of view.public.players) {
      for (const d of pl.discards) c[d.tile.kind]++;
      for (const m of pl.melds) for (const t of m.tiles) c[t.kind]++;
    }
    for (const t of view.public.doraIndicators) c[t.kind]++;
    return c;
  }

  // 安全牌選び: リーチ者の現物 > 2枚以上見えてる字牌 > 端牌 > 効率最下位
  pickSafeTile(handAll, threats, view) {
    const genbutsu = new Set();
    for (const t of threats) {
      for (const d of t.pl.discards) genbutsu.add(d.tile.kind);
    }
    for (let i = 0; i < handAll.length; i++) {
      if (genbutsu.has(handAll[i].kind)) return i;
    }
    const visible = this.visibleCounts(view);
    for (let i = 0; i < handAll.length; i++) {
      if (isHonor(handAll[i].kind) && visible[handAll[i].kind] >= 3) return i;
    }
    for (let i = 0; i < handAll.length; i++) {
      if (isHonor(handAll[i].kind)) return i;
    }
    for (let i = 0; i < handAll.length; i++) {
      if (isYaochu(handAll[i].kind)) return i;
    }
    return -1; // 安牌なし → 通常の効率打ちに任せる
  }
}
