// game.js — 対局進行エンジン
// COMも人間も「actor」インターフェース経由で参加する。
// actorは自分の手牌と公開情報(state)しか渡されない = COMが他家の手や山を見る経路は存在しない。
//
// actor = {
//   onTurn(view, options) -> Promise<{action:'discard',index,riichi?}|{action:'tsumo'}|{action:'ankan',kind}|{action:'kakan',kind}|{action:'kyuushu'}>
//   onClaim(view, offer) -> Promise<null | {action:'ron'}|{action:'pon'}|{action:'minkan'}|{action:'chi',tiles:[i,i]}>
// }

import { toCounts, isYaochu, TON } from './tiles.js';
import { buildWall, deal, doraIndicators, uraIndicators } from './wall.js';
import { shanten, waitingTiles } from './shanten.js';
import { scoreWin } from './score.js';

const WINDS = [TON, TON + 1, TON + 2, TON + 3];

export class Game {
  constructor(rules, actors, onEvent = () => {}) {
    this.rules = rules;
    this.actors = actors;          // [4]
    this.onEvent = onEvent;        // UI通知用 (type, data)
    this.points = [rules.startPoints, rules.startPoints, rules.startPoints, rules.startPoints];
    this.roundWindIdx = 0;         // 0=東場,1=南場...
    this.kyoku = 0;                // 0-3 (東1-東4)
    this.honba = 0;
    this.riichiSticks = 0;
    this.finished = false;
  }

  dealerOf() { return this.kyoku; }
  seatWindOf(p) { return WINDS[(p - this.kyoku + 4) % 4]; }
  roundWind() { return WINDS[this.roundWindIdx]; }

  async run() {
    while (!this.finished) {
      const result = await this.playRound();
      this.advance(result);
    }
    const ranking = [0, 1, 2, 3].sort((a, b) => this.points[b] - this.points[a]);
    this.onEvent('gameEnd', { points: this.points, ranking });
    return { points: this.points, ranking };
  }

  advance(result) {
    const maxRounds = { tonpuu: 1, tonnan: 2, issou: 4 }[this.rules.gameLength];
    // 飛び終了
    if (this.rules.tobiEnd && this.points.some(p => p < 0)) { this.finished = true; return; }

    const renchan = result.renchan;
    if (renchan) this.honba++;
    else {
      this.honba = result.ryukyoku ? this.honba + 1 : 0;
      this.kyoku++;
      if (this.kyoku === 4) { this.kyoku = 0; this.roundWindIdx++; }
    }
    const isOver = this.roundWindIdx >= maxRounds;
    if (isOver) {
      // 和了やめ/聴牌やめ: 最終局で親がトップなら終了扱いは満たされた時点でrenchanでも終わる
      this.finished = true;
    }
    // オーラス親トップ終了(和了やめ)
    if (!this.finished && renchan && this.rules.agariYame &&
        this.roundWindIdx === maxRounds - 1 && this.kyoku === 3) {
      const dealer = this.dealerOf();
      const top = [0, 1, 2, 3].sort((a, b) => this.points[b] - this.points[a])[0];
      if (dealer === top && result.winner === dealer) this.finished = true;
    }
  }

  // 1局を回す。返り値 { renchan, ryukyoku, winner? }
  async playRound() {
    const R = this.rules;
    const wall = buildWall(R);
    const { hands, live, deadWall } = deal(wall);
    const dealer = this.dealerOf();

    const st = this.st = {
      players: [0, 1, 2, 3].map(p => ({
        hand: hands[p], melds: [], discards: [],
        riichi: false, doubleRiichi: false, ippatsu: false,
        furiten: false, furitenTemp: false,
        anyCalled: false,   // 自分の捨て牌が鳴かれた(流し満貫用)
      })),
      live, deadWall, kanCount: 0,
      turn: dealer, firstGoAround: true, turnCount: 0,
      lastDiscard: null, lastKanTile: null,
      riichiThisTurn: -1,
    };
    // 手牌ソート(表示・思考用)
    for (const pl of st.players) pl.hand.sort((a, b) => a.kind - b.kind || (a.red ? 1 : 0) - (b.red ? 1 : 0));

    await this.onEvent('roundStart', this.publicState());

    let pendingRinshan = false;
    while (true) {
      const p = st.turn;
      const pl = st.players[p];

      // --- ツモ ---
      if (st.live.length === 0) return await this.ryukyoku();
      const drawn = pendingRinshan ? st.deadWall[st.kanCount - 1] : st.live.shift();
      if (pendingRinshan) st.deadWall.push(st.live.pop()); // 王牌補充
      const isRinshan = pendingRinshan;
      pendingRinshan = false;
      pl.furitenTemp = false;
      this.onEvent('draw', { player: p, tile: this.actors[p].isHuman ? drawn : null, remaining: st.live.length });

      // --- 手番の選択肢を構築 ---
      let turnDecision;
      while (true) {
        const options = this.turnOptions(p, drawn, isRinshan);
        turnDecision = await this.actors[p].onTurn(this.viewFor(p, drawn), options);
        if (options.includes(turnDecision.action) || turnDecision.action === 'discard') break;
      }

      // --- 九種九牌 ---
      if (turnDecision.action === 'kyuushu') {
        this.onEvent('kyuushu', { player: p });
        return await this.ryukyoku(true);
      }

      // --- ツモ和了 ---
      if (turnDecision.action === 'tsumo') {
        const win = this.tryWin(p, drawn, { tsumo: true, rinshan: isRinshan, haitei: st.live.length === 0 });
        if (win) return await this.applyWin(p, null, win, drawn);
      }

      // --- 暗槓・加槓 ---
      if (turnDecision.action === 'ankan' || turnDecision.action === 'kakan') {
        const kind = turnDecision.kind;
        if (turnDecision.action === 'ankan') {
          const tiles = [];
          pl.hand = pl.hand.concat([drawn]).filter(t => {
            if (t.kind === kind && tiles.length < 4) { tiles.push(t); return false; }
            return true;
          });
          pl.melds.push({ type: 'ankan', tiles });
        } else {
          // 加槓: 既存ポンに足す → 槍槓チェック
          const meld = pl.melds.find(m => m.type === 'pon' && m.tiles[0].kind === kind);
          const handAll = pl.hand.concat([drawn]);
          const idx = handAll.findIndex(t => t.kind === kind);
          const added = handAll.splice(idx, 1)[0];
          pl.hand = handAll;
          const chankanWin = await this.checkChankan(p, added);
          if (chankanWin) return chankanWin;
          meld.type = 'minkan';
          meld.tiles.push(added);
        }
        st.kanCount++;
        for (const q of st.players) q.ippatsu = false;
        st.firstGoAround = false;
        this.onEvent('kan', { player: p, kind, kanCount: st.kanCount, state: this.publicState() });
        if (st.kanCount > 4 || (st.kanCount === 4 && R.tochuRyukyoku &&
            new Set(st.players.flatMap((q, i) => q.melds.filter(m => m.type.includes('kan')).map(() => i))).size > 1)) {
          return await this.ryukyoku(true); // 四槓散了
        }
        pendingRinshan = true;
        continue; // 同プレイヤーが嶺上ツモ
      }

      // --- 打牌 ---
      const handAll = pl.hand.concat([drawn]);
      let discIdx = turnDecision.index;
      if (discIdx < 0 || discIdx >= handAll.length) discIdx = handAll.length - 1;
      const discarded = handAll.splice(discIdx, 1)[0];
      pl.hand = handAll.sort((a, b) => a.kind - b.kind || (a.red ? 1 : 0) - (b.red ? 1 : 0));

      // リーチ後、次の自分の打牌で一発権は消える(この打牌が宣言牌の場合を除く)
      const wasRiichi = pl.riichi;
      // リーチ宣言
      let declaredRiichi = false;
      if (turnDecision.riichi && !pl.riichi) {
        const counts = toCounts(pl.hand);
        if (pl.melds.every(m => m.type === 'ankan') && shanten(counts, pl.melds.length) === 0 &&
            (this.points[p] >= 1000 || R.riichiBelow1000)) {
          pl.riichi = true;
          pl.doubleRiichi = st.firstGoAround && pl.discards.length === 0 && !st.players.some(q => q.anyCalled);
          pl.ippatsu = true;
          declaredRiichi = true;
          this.points[p] -= 1000;
          this.riichiSticks++;
        }
      }
      if (wasRiichi) pl.ippatsu = false;
      const tsumogiri = discIdx === handAll.length; // spliceで1減った後なので length===元の最後
      pl.discards.push({ tile: discarded, riichi: declaredRiichi, tsumogiri });
      st.lastDiscard = { player: p, tile: discarded };
      this.onEvent('discard', { player: p, tile: discarded, riichi: declaredRiichi, state: this.publicState() });

      // リーチ後のフリテン確定用に待ちを記録
      if (pl.riichi && !pl.waits) pl.waits = waitingTiles(toCounts(pl.hand), pl.melds.length);

      // --- 他家の反応 (ロン > ポン/カン > チー)。鳴き→打牌→さらに鳴き…の連鎖をループで処理 ---
      let curClaim = await this.collectClaims(p, discarded);
      let curDiscarder = p, curTile = discarded;
      let claimed = false, ronResult = null;
      while (curClaim) {
        if (curClaim.action === 'ron') { ronResult = curClaim.result; break; }
        claimed = true;
        const q = st.players[curClaim.player];
        st.players[curDiscarder].anyCalled = true;
        st.players[curDiscarder].discards[st.players[curDiscarder].discards.length - 1].claimed = true;
        for (const r of st.players) r.ippatsu = false;
        st.firstGoAround = false;
        if (curClaim.action === 'pon' || curClaim.action === 'minkan') {
          const need = curClaim.action === 'pon' ? 2 : 3;
          const taken = [];
          q.hand = q.hand.filter(t => (t.kind === curTile.kind && taken.length < need) ? (taken.push(t), false) : true);
          q.melds.push({ type: curClaim.action, tiles: [...taken, curTile], from: curDiscarder });
        } else { // chi
          const taken = [];
          for (const k of curClaim.tiles) {
            const i = q.hand.findIndex(t => t.kind === k && !taken.includes(t));
            taken.push(q.hand.splice(i, 1)[0]);
          }
          q.melds.push({ type: 'chi', tiles: [...taken, curTile], from: curDiscarder });
        }
        this.onEvent('claim', { player: curClaim.player, action: curClaim.action, tile: curTile, state: this.publicState() });
        st.turn = curClaim.player;
        st.turnCount++;
        if (curClaim.action === 'minkan') {
          st.kanCount++;
          pendingRinshan = true;
          curClaim = null; // 外ループで嶺上ツモへ
          break;
        }
        // 鳴いた人が打牌
        const decision = await this.actors[curClaim.player].onTurn(this.viewFor(curClaim.player, null), ['discard']);
        let di = decision.index;
        if (di < 0 || di >= q.hand.length) di = q.hand.length - 1;
        const d2 = q.hand.splice(di, 1)[0];
        q.hand.sort((a, b) => a.kind - b.kind);
        q.discards.push({ tile: d2, riichi: false, tsumogiri: false });
        st.lastDiscard = { player: curClaim.player, tile: d2 };
        this.onEvent('discard', { player: curClaim.player, tile: d2, riichi: false, state: this.publicState() });
        curDiscarder = curClaim.player;
        curTile = d2;
        curClaim = await this.collectClaims(curDiscarder, d2);
        if (!curClaim) st.turn = (curDiscarder + 1) % 4;
      }
      if (ronResult) return ronResult;
      if (claimed || pendingRinshan) continue;

      // 四風連打
      if (R.tochuRyukyoku && st.firstGoAround && st.players.every(q => q.discards.length >= 1)) {
        const firsts = st.players.map(q => q.discards[0].tile.kind);
        if (firsts.every(k => k === firsts[0] && k >= 27 && k <= 30)) return await this.ryukyoku(true);
        st.firstGoAround = false;
      }
      // 四家リーチ
      if (R.tochuRyukyoku && st.players.every(q => q.riichi)) return await this.ryukyoku(true);

      st.turn = (p + 1) % 4;
      st.turnCount++;
    }
  }

  turnOptions(p, drawn, isRinshan) {
    const st = this.st, pl = st.players[p], R = this.rules;
    const options = ['discard'];
    const counts = toCounts(pl.hand.concat([drawn]));
    // ツモ和了可能?
    if (this.tryWin(p, drawn, { tsumo: true, rinshan: isRinshan, haitei: st.live.length === 0, dryRun: true })) options.push('tsumo');
    // 暗槓/加槓
    if (st.live.length > 0 && !pl.riichi) { // リーチ後暗槓は待ち変化判定が必要なので v1 は禁止
      for (let k = 0; k < 34; k++) {
        if (counts[k] === 4) options.push('ankan');
        if (pl.melds.some(m => m.type === 'pon' && m.tiles[0].kind === k) && counts[k] >= 1) options.push('kakan');
      }
    }
    // 九種九牌
    if (R.tochuRyukyoku && st.firstGoAround && pl.discards.length === 0 && pl.melds.length === 0) {
      const kinds = new Set(pl.hand.concat([drawn]).filter(t => isYaochu(t.kind)).map(t => t.kind));
      if (kinds.size >= 9) options.push('kyuushu');
    }
    return options;
  }

  // ロン/ポン/チーの募集。ロン優先。
  async collectClaims(discarder, tile) {
    const st = this.st;
    const houtei = st.live.length === 0;
    // ロン (頭ハネ: 下家優先)
    for (let d = 1; d <= 3; d++) {
      const p = (discarder + d) % 4;
      const pl = st.players[p];
      if (pl.furiten || pl.furitenTemp) continue;
      const win = this.tryWin(p, tile, { tsumo: false, houtei, dryRun: true });
      if (!win) continue;
      const ans = await this.actors[p].onClaim(this.viewFor(p, null), { type: 'ron', tile, from: discarder });
      if (ans && ans.action === 'ron') {
        const result = await this.applyWin(p, discarder, this.tryWin(p, tile, { tsumo: false, houtei }), tile);
        return { action: 'ron', player: p, result };
      }
      // ロン見逃し → 同巡フリテン(リーチ中なら永久)
      pl.furitenTemp = true;
      if (pl.riichi) pl.furiten = true;
    }
    if (houtei) return null;
    // ポン/明槓
    for (let d = 1; d <= 3; d++) {
      const p = (discarder + d) % 4;
      const pl = st.players[p];
      if (pl.riichi) continue;
      const same = pl.hand.filter(t => t.kind === tile.kind).length;
      if (same >= 2) {
        const offer = { type: 'call', tile, from: discarder, canPon: true, canKan: same >= 3 && st.live.length > 0 };
        const ans = await this.actors[p].onClaim(this.viewFor(p, null), offer);
        if (ans && (ans.action === 'pon' || (ans.action === 'minkan' && offer.canKan))) {
          return { action: ans.action, player: p };
        }
      }
    }
    // チー (下家のみ)
    const p = (discarder + 1) % 4;
    const pl = st.players[p];
    if (!pl.riichi && tile.kind < 27) {
      const chiSets = [];
      const has = (k) => pl.hand.some(t => t.kind === k);
      const n = tile.kind % 9, base = tile.kind - n;
      if (n >= 2 && has(tile.kind - 2) && has(tile.kind - 1)) chiSets.push([tile.kind - 2, tile.kind - 1]);
      if (n >= 1 && n <= 7 && has(tile.kind - 1) && has(tile.kind + 1)) chiSets.push([tile.kind - 1, tile.kind + 1]);
      if (n <= 6 && has(tile.kind + 1) && has(tile.kind + 2)) chiSets.push([tile.kind + 1, tile.kind + 2]);
      if (chiSets.length > 0) {
        const ans = await this.actors[p].onClaim(this.viewFor(p, null), { type: 'call', tile, from: discarder, canChi: chiSets });
        if (ans && ans.action === 'chi') return { action: 'chi', player: p, tiles: ans.tiles || chiSets[0] };
      }
    }
    return null;
  }

  async checkChankan(kanPlayer, tile) {
    for (let d = 1; d <= 3; d++) {
      const p = (kanPlayer + d) % 4;
      const pl = this.st.players[p];
      if (pl.furiten || pl.furitenTemp) continue;
      const win = this.tryWin(p, tile, { tsumo: false, chankan: true, dryRun: true });
      if (!win) continue;
      const ans = await this.actors[p].onClaim(this.viewFor(p, null), { type: 'ron', tile, from: kanPlayer, chankan: true });
      if (ans && ans.action === 'ron') {
        return await this.applyWin(p, kanPlayer, this.tryWin(p, tile, { tsumo: false, chankan: true }), tile);
      }
    }
    return null;
  }

  // 和了判定+点数。dryRun時も同じ計算(見えてよい情報しか使わない)。
  tryWin(p, tile, { tsumo, rinshan = false, haitei = false, houtei = false, chankan = false, dryRun = false }) {
    const st = this.st, pl = st.players[p];
    // フリテン(ロンのみ)
    if (!tsumo) {
      const waits = waitingTiles(toCounts(pl.hand), pl.melds.length);
      if (!waits.includes(tile.kind)) return null;
      if (waits.some(w => pl.discards.some(d => d.tile.kind === w))) return null;
    }
    const ctx = {
      hand: pl.hand, melds: pl.melds, winTile: tile, tsumo,
      riichi: pl.riichi, doubleRiichi: pl.doubleRiichi, ippatsu: pl.ippatsu,
      rinshan, chankan, haitei, houtei,
      tenhou: tsumo && p === this.dealerOf() && pl.discards.length === 0 && st.players.every(q => q.melds.length === 0),
      chihou: tsumo && p !== this.dealerOf() && pl.discards.length === 0 && st.players.every(q => q.melds.length === 0) && st.firstGoAround,
      seatWind: this.seatWindOf(p), roundWind: this.roundWind(),
      doraIndicators: doraIndicators(st.deadWall, st.kanCount).map(t => t.kind),
      uraIndicators: pl.riichi ? uraIndicators(st.deadWall, st.kanCount).map(t => t.kind) : [],
    };
    return scoreWin(ctx, this.rules, {
      isDealer: p === this.dealerOf(),
      honba: this.honba,
      riichiSticks: this.riichiSticks,
    });
  }

  async applyWin(winner, loser, score, winTile) {
    const dealer = this.dealerOf();
    const before = [...this.points];
    if (loser !== null) {
      this.points[loser] -= score.payments.ron;
      this.points[winner] += score.payments.ron;
    } else {
      for (let q = 0; q < 4; q++) {
        if (q === winner) continue;
        const pay = (q === dealer) ? (score.payments.dealerPay ?? score.payments.othersPay) : score.payments.othersPay;
        this.points[q] -= pay;
        this.points[winner] += pay;
      }
    }
    this.points[winner] += this.riichiSticks * 1000;
    this.riichiSticks = 0;
    const st = this.st;
    const winnerRiichi = st.players[winner].riichi;
    await this.onEvent('win', {
      winner, loser, score, winTile,
      deltas: this.points.map((v, i) => v - before[i]),
      hand: st.players[winner].hand, melds: st.players[winner].melds,
      doraInd: doraIndicators(st.deadWall, st.kanCount).map(t => ({ ...t })),
      uraInd: winnerRiichi && this.rules.uraDora ? uraIndicators(st.deadWall, st.kanCount).map(t => ({ ...t })) : [],
      state: this.publicState(),
    });
    return { renchan: winner === dealer, ryukyoku: false, winner };
  }

  async ryukyoku(tochu = false) {
    const st = this.st, R = this.rules;
    const dealer = this.dealerOf();
    if (tochu) {
      await this.onEvent('ryukyoku', { tochu: true, tenpai: [], deltas: [0, 0, 0, 0], revealed: [], state: this.publicState() });
      return { renchan: true, ryukyoku: true };
    }
    const before = [...this.points];
    // 流し満貫
    if (R.nagashiMangan) {
      for (let p = 0; p < 4; p++) {
        const pl = st.players[p];
        if (pl.discards.length > 0 && pl.discards.every(d => isYaochu(d.tile.kind)) && !pl.anyCalled) {
          const isDealer = p === dealer;
          for (let q = 0; q < 4; q++) {
            if (q === p) continue;
            const pay = isDealer ? 4000 : (q === dealer ? 4000 : 2000);
            this.points[q] -= pay;
            this.points[p] += pay;
          }
          await this.onEvent('nagashi', {
            player: p,
            deltas: this.points.map((v, i) => v - before[i]),
            state: this.publicState(),
          });
          return { renchan: p === dealer || (R.tenpaiRenchan && this.isTenpai(dealer)), ryukyoku: true };
        }
      }
    }
    const tenpai = [0, 1, 2, 3].filter(p => this.isTenpai(p));
    if (tenpai.length > 0 && tenpai.length < 4) {
      const payTotal = 3000;
      const receive = payTotal / tenpai.length;
      const pay = payTotal / (4 - tenpai.length);
      for (let p = 0; p < 4; p++) {
        this.points[p] += tenpai.includes(p) ? receive : -pay;
      }
    }
    await this.onEvent('ryukyoku', {
      tochu: false, tenpai,
      deltas: this.points.map((v, i) => v - before[i]),
      revealed: tenpai.map(p => ({ player: p, hand: st.players[p].hand.map(t => ({ ...t })), melds: st.players[p].melds })),
      state: this.publicState(),
    });
    const renchan = R.tenpaiRenchan ? tenpai.includes(dealer) : false;
    return { renchan, ryukyoku: true };
  }

  isTenpai(p) {
    const pl = this.st.players[p];
    if (!this.rules.tenpaiRyukyoku && !pl.riichi) {
      // 形式聴牌なし: リーチ者のみ聴牌扱い…は過激なので、役の有無は問わず形だけで判定に留める
    }
    return shanten(toCounts(pl.hand), pl.melds.length) === 0;
  }

  // 本人のUI表示用(人間プレイヤーの自席手牌のみ参照する想定)
  handOf(p) { return this.st ? this.st.players[p].hand.map(t => ({ ...t })) : []; }

  // --- 情報公開制御 ---
  // publicState: 全員に見えるもののみ
  publicState() {
    const st = this.st;
    return {
      points: [...this.points],
      kyoku: this.kyoku, roundWindIdx: this.roundWindIdx, honba: this.honba,
      riichiSticks: this.riichiSticks,
      turn: st.turn, remaining: st.live.length,
      doraIndicators: doraIndicators(st.deadWall, st.kanCount).map(t => ({ ...t })),
      players: st.players.map(pl => ({
        discards: pl.discards.map(d => ({ tile: { ...d.tile }, riichi: d.riichi, tsumogiri: !!d.tsumogiri, claimed: !!d.claimed })),
        melds: pl.melds.map(m => ({ type: m.type, tiles: m.tiles.map(t => ({ ...t })) })),
        riichi: pl.riichi,
        handCount: pl.hand.length,
      })),
    };
  }

  // viewFor: 本人の手牌+公開情報のみ。他家の手牌・山・王牌(表示牌以外)は絶対に含めない。
  viewFor(p, drawn) {
    return {
      me: p,
      hand: this.st.players[p].hand.map(t => ({ ...t })),
      drawn: drawn ? { ...drawn } : null,
      melds: this.st.players[p].melds.map(m => ({ type: m.type, tiles: m.tiles.map(t => ({ ...t })) })),
      seatWind: this.seatWindOf(p), roundWind: this.roundWind(),
      isDealer: p === this.dealerOf(),
      riichi: this.st.players[p].riichi,
      public: this.publicState(),
    };
  }
}
