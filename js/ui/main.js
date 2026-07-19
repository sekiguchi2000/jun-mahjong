// main.js — UIと人間プレイヤーの接続 (卓レイアウト版)
import { makeRules, RULE_SCHEMA } from '../engine/rules.js';
import { Game } from '../engine/game.js';
import { ComActor } from '../engine/ai.js';
import { toCounts, suitOf, numOf, tileName } from '../engine/tiles.js';
import { shanten, waitingTiles } from '../engine/shanten.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============ ルール設定 ============
function loadRulesOverrides() {
  try { return JSON.parse(localStorage.getItem('mahjong-rules') || '{}'); } catch { return {}; }
}
function loadRules() { return makeRules(loadRulesOverrides()); }
function saveRules(overrides) { localStorage.setItem('mahjong-rules', JSON.stringify(overrides)); }

function renderRulesScreen() {
  const list = $('#rules-list');
  list.innerHTML = '';
  const current = loadRules();
  for (const item of RULE_SCHEMA) {
    const row = document.createElement('div');
    row.className = 'rule-item';
    const label = document.createElement('label');
    label.textContent = item.label;
    row.appendChild(label);
    if (item.type === 'bool') {
      const btn = document.createElement('button');
      const paint = () => {
        btn.className = 'toggle' + (current[item.key] ? ' on' : '');
        btn.textContent = current[item.key] ? 'あり' : 'なし';
      };
      paint();
      btn.onclick = () => {
        current[item.key] = !current[item.key];
        const now = loadRulesOverrides();
        now[item.key] = current[item.key];
        saveRules(now);
        paint();
      };
      row.appendChild(btn);
    } else {
      const sel = document.createElement('select');
      for (const [val, name] of item.options) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify(val);
        opt.textContent = name;
        if (JSON.stringify(current[item.key]) === JSON.stringify(val)) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        const now = loadRulesOverrides();
        now[item.key] = JSON.parse(sel.value);
        saveRules(now);
      };
      row.appendChild(sel);
    }
    list.appendChild(row);
  }
}

// ============ 牌の描画 ============
const HONOR_CHARS = ['東', '南', '西', '北', '白', '發', '中'];
function tileEl(t, opts = {}) {
  const el = document.createElement('div');
  const suit = suitOf(t.kind);
  el.className = `tile ${suit}` + (t.red ? ' red' : '') + (opts.mini ? ' mini' : '');
  if (suit === 'z') {
    if (t.kind === 33) el.classList.add('dragon-c');
    if (t.kind === 32) el.classList.add('dragon-f');
    el.innerHTML = `<span class="num">${HONOR_CHARS[t.kind - 27]}</span>`;
  } else {
    const suitChar = { m: '萬', p: '筒', s: '索' }[suit];
    el.innerHTML = `<span class="num">${t.red ? '5' : numOf(t.kind)}</span><span class="suit">${suitChar}</span>`;
  }
  if (opts.riichi) el.classList.add('riichi-tile');
  if (opts.tsumogiri) el.classList.add('tsumogiri');
  return el;
}
function backTileEl(mini = false) {
  const el = document.createElement('div');
  el.className = 'tile back' + (mini ? ' mini' : '');
  return el;
}
// 副露の表示: 鳴いた牌を「誰から鳴いたか」の方向に横向きで置く
// (上家から=左端 / 対面から=2枚目 / 下家から=右端)
function meldEl(m, mini = false, owner = null) {
  const box = document.createElement('div');
  box.className = 'meld';
  box.style.display = 'flex';
  box.style.gap = '1px';
  box.style.alignItems = 'center';
  if (m.type === 'ankan') {
    box.appendChild(backTileEl(mini));
    box.appendChild(tileEl(m.tiles[1], { mini }));
    box.appendChild(tileEl(m.tiles[2], { mini }));
    box.appendChild(backTileEl(mini));
    return box;
  }
  const tiles = m.tiles.slice();
  const claimed = tiles.pop(); // 末尾が他家から鳴いた牌
  tiles.sort((a, b) => a.kind - b.kind);
  let pos = 0;
  if (owner !== null && m.from !== undefined) {
    const rel = (m.from - owner + 4) % 4; // 1=下家 2=対面 3=上家
    pos = rel === 3 ? 0 : rel === 2 ? 1 : tiles.length;
  }
  const seq = [...tiles.slice(0, pos), { ...claimed, __side: true }, ...tiles.slice(pos)];
  for (const t of seq) {
    const el = tileEl(t, { mini });
    if (t.__side) el.classList.add('sideways');
    box.appendChild(el);
  }
  return box;
}

// ============ 人間アクター ============
class HumanActor {
  constructor(ui) { this.ui = ui; this.isHuman = true; }
  async onTurn(view, options) {
    if (view.riichi && !options.includes('tsumo') && !options.includes('ankan')) {
      // リーチ中: ツモ牌を一拍見せてからツモ切り(いきなり河に飛ばない)
      return this.ui.riichiAutoTurn(view);
    }
    return this.ui.promptTurn(view, options);
  }
  async onClaim(view, offer) { return this.ui.promptClaim(view, offer); }
}

class PacedCom extends ComActor {
  // 「ツモってきて、考えて、捨てる」の間: 約1秒(ゆらぎ付き)
  async onTurn(view, options) { await sleep(850 + Math.random() * 450); return super.onTurn(view, options); }
  async onClaim(view, offer) {
    const ans = await super.onClaim(view, offer);
    if (ans) await sleep(500);
    return ans;
  }
}

// ============ UI本体 ============
const WIND_NAMES = ['東', '南', '西', '北'];
const SEAT_LABELS = ['あなた', '半蔵', 'ジョー', 'ひめ子'];

class UI {
  constructor() {
    this.myHand = [];
    this.myDrawn = null;
    this.game = null;
    this.lastDiscardPlayer = -1;
  }

  startGame() {
    const rules = loadRules();
    this.spectate = location.search.includes('spectate'); // 開発用: 全員COMの観戦モード
    this.human = new HumanActor(this);
    const seat0 = this.spectate ? new PacedCom('COM') : this.human;
    this.game = new Game(rules,
      [seat0, new PacedCom('半蔵'), new PacedCom('ジョー'), new PacedCom('ひめ子')],
      (type, data) => this.onEvent(type, data));
    show('game');
    this.game.run();
  }

  // Gameがawaitするので、Promiseを返せば進行が止まる
  onEvent(type, data) {
    switch (type) {
      case 'roundStart':
        this.lastDiscardPlayer = -1;
        this.myHand = this.game.handOf(0);
        this.myDrawn = null;
        this.renderBoard(data);
        this.renderHand();
        return this.showSplash(data);
      case 'discard':
        this.lastDiscardPlayer = data.player;
        this.renderBoard(data.state);
        if (data.riichi) this.showCallout(data.player, 'リーチ');
        return;
      case 'claim':
        // 発声→間→卓に反映、の順で「何が起きたか」を見せる
        return (async () => {
          await this.showCallout(data.player, { pon: 'ポン', chi: 'チー', minkan: 'カン' }[data.action] || data.action, 1000);
          this.renderBoard(data.state);
          await sleep(450);
        })();
      case 'kan':
        return (async () => {
          await this.showCallout(data.player, 'カン', 1000);
          this.renderBoard(data.state);
          await sleep(450);
        })();
      case 'kyuushu':
        return this.showCallout(data.player, '九種九牌');
      case 'draw':
        // ツモった本人に手番表示を移す(打牌イベントを待たない)
        this.setTurnIndicator(data.player);
        $('#center .sub .rest') && ($('#center .sub .rest').textContent = `残 ${data.remaining}`);
        return;
      case 'win': return this.showWin(data);
      case 'ryukyoku': return this.showRyukyoku(data);
      case 'nagashi': return this.showNagashi(data);
      case 'gameEnd': return this.showGameEnd(data);
    }
  }

  // --- 局開始スプラッシュ ---
  async showSplash(state) {
    const splash = $('#splash');
    const kyokuName = `${WIND_NAMES[state.roundWindIdx]}${state.kyoku + 1}局`;
    splash.innerHTML = `<div><div class="splash-text">${kyokuName}</div>` +
      `<div class="splash-sub">${state.honba > 0 ? state.honba + '本場　' : ''}親: ${SEAT_LABELS[state.kyoku]}</div></div>`;
    splash.classList.remove('hidden');
    await sleep(1200);
    splash.classList.add('hidden');
  }

  setTurnIndicator(player) {
    for (let p = 0; p < 4; p++) $(`#chip-${p}`).classList.toggle('active', p === player);
  }

  // --- リーチ中の自動ツモ切り(演出付き) ---
  async riichiAutoTurn(view) {
    this.myHand = view.hand;
    this.myDrawn = view.drawn;
    this.renderHand(false);
    this.showWaits(view.hand, view.melds.length); // 待ち牌は常時表示
    await sleep(700);
    this.myHand = [...view.hand];
    this.myDrawn = null;
    this.renderHand(false);
    return { action: 'discard', index: view.hand.length, riichi: false };
  }

  // --- 待ち牌ヒント ---
  showWaits(hand13, meldCount) {
    const waits = waitingTiles(toCounts(hand13), meldCount);
    const hint = $('#wait-hint');
    if (waits.length === 0) { hint.classList.add('hidden'); return; }
    hint.innerHTML = '<span class="lbl">待ち</span>';
    const visible = this.visibleCountsUI();
    for (const k of waits) {
      hint.appendChild(tileEl({ kind: k, red: false }, { mini: true }));
      const n = Math.max(0, 4 - (visible[k] || 0));
      hint.insertAdjacentHTML('beforeend', `<span class="cnt">${n}</span>`);
    }
    hint.classList.remove('hidden');
  }
  hideWaits() { $('#wait-hint').classList.add('hidden'); }

  // UIから見えている牌の枚数(自分の手牌+ツモ+全員の河/副露+ドラ表示牌)
  visibleCountsUI() {
    const c = {};
    const add = (t) => { c[t.kind] = (c[t.kind] || 0) + 1; };
    for (const t of this.myHand) add(t);
    if (this.myDrawn) add(this.myDrawn);
    const st = this.lastState;
    if (st) {
      for (const pl of st.players) {
        for (const d of pl.discards) add(d.tile);
        for (const m of pl.melds) for (const t of m.tiles) add(t);
      }
      for (const t of st.doraIndicators) add(t);
    }
    return c;
  }

  // --- 吹き出し ---
  async showCallout(player, text, ms = 750) {
    const el = $('#callout');
    el.textContent = text;
    // 席の方向に出す (0=下,1=右,2=上,3=左)
    const pos = [
      { left: '50%', top: '62%', transform: 'translate(-50%,-50%)' },
      { left: '74%', top: '42%', transform: 'translate(-50%,-50%)' },
      { left: '50%', top: '22%', transform: 'translate(-50%,-50%)' },
      { left: '26%', top: '42%', transform: 'translate(-50%,-50%)' },
    ][player];
    Object.assign(el.style, { left: pos.left, top: pos.top, transform: pos.transform });
    el.classList.remove('hidden');
    await sleep(ms);
    el.classList.add('hidden');
  }

  // --- 卓の描画 ---
  renderBoard(state) {
    if (!state) return;
    this.lastState = state;
    if (this.spectate) { this.myHand = this.game.handOf(0); this.myDrawn = null; this.renderHand(); }

    // 中央
    $('#center').innerHTML =
      `<div class="kyoku">${WIND_NAMES[state.roundWindIdx]}${state.kyoku + 1}局</div>` +
      `<div class="sub"><span class="rest">残 ${state.remaining}</span>` +
      `<span>${state.honba}本場</span>` +
      `<span class="sticks">供託${state.riichiSticks}</span></div>` +
      `<div class="dora-row"><span class="label">ドラ</span></div>`;
    const doraRow = $('#center .dora-row');
    for (const t of state.doraIndicators) doraRow.appendChild(tileEl(t));

    // 各家: チップ(名前/点/リーチ棒/副露) + 河 + 裏手牌
    for (let p = 0; p < 4; p++) {
      const pl = state.players[p];
      const seatWind = WIND_NAMES[(p - state.kyoku + 4) % 4];
      const chip = $(`#chip-${p}`);
      chip.className = 'chip ' + ['bl', 'br', 'tr', 'tl'][p] + (state.turn === p ? ' active' : '');
      chip.innerHTML =
        `<div class="who"><span class="wind${(p - state.kyoku + 4) % 4 === 0 ? ' dealer' : ''}">${seatWind}</span>${SEAT_LABELS[p]}</div>` +
        `<div class="pts">${state.points[p]}</div>` +
        (pl.riichi ? '<div class="riichi-stick"></div>' : '');
      if (p !== 0 && pl.melds.length > 0) {
        const mbox = document.createElement('div');
        mbox.className = 'melds';
        for (const m of pl.melds) mbox.appendChild(meldEl(m, true, p));
        chip.appendChild(mbox);
      }

      // 河 (鳴かれた牌は表示から除く)
      const river = $(`#river-${p}`);
      river.innerHTML = '';
      const visibles = pl.discards.filter(d => !d.claimed);
      visibles.forEach((d, i) => {
        const el = tileEl(d.tile, { riichi: d.riichi, tsumogiri: d.tsumogiri });
        if (p === this.lastDiscardPlayer && i === visibles.length - 1) el.classList.add('last-discard');
        river.appendChild(el);
      });
    }

    // 裏向き手牌ストリップ
    const strips = { 1: $('#strip-right'), 2: $('#strip-top'), 3: $('#strip-left') };
    for (const [p, el] of Object.entries(strips)) {
      el.innerHTML = '';
      for (let i = 0; i < state.players[p].handCount; i++) {
        const b = document.createElement('div');
        b.className = 'btile';
        el.appendChild(b);
      }
    }

    // 自分の副露
    const myMelds = $('#my-melds');
    myMelds.innerHTML = '';
    for (const m of state.players[0].melds) myMelds.appendChild(meldEl(m, false, 0));
  }

  // 打牌は二段タッチ: 1タッチ目で牌が浮き、同じ牌への2タッチ目で確定。別の牌を触ると浮きが移る
  renderHand(selectable = false, riichiFilter = null, onPick = null, onLift = null) {
    const box = $('#my-hand');
    box.innerHTML = '';
    let lifted = -1;
    const els = [];
    const all = this.myDrawn ? [...this.myHand, this.myDrawn] : [...this.myHand];
    all.forEach((t, i) => {
      const el = tileEl(t);
      els.push(el);
      if (this.myDrawn && i === all.length - 1) el.classList.add('drawn');
      if (selectable) {
        const allowed = !riichiFilter || riichiFilter.includes(i);
        if (allowed) {
          el.classList.add('selectable');
          el.classList.toggle('riichi-ok', !!riichiFilter);
          el.onclick = () => {
            if (lifted === i) { onPick(i); return; }   // 2タッチ目 → 打牌
            if (lifted >= 0) els[lifted].classList.remove('lifted');
            lifted = i;
            el.classList.add('lifted');                 // 1タッチ目 → 浮かせる
            if (onLift) onLift(i);
          };
        } else {
          el.classList.add('dimmed');
        }
      }
      box.appendChild(el);
    });
  }

  // --- 手番 ---
  promptTurn(view, options) {
    this.myHand = view.hand;
    this.myDrawn = view.drawn;
    const self = this;
    return new Promise((resolve) => {
      const bar = $('#action-bar');
      bar.innerHTML = '';
      let riichiMode = false;

      // 打牌確定と同時に手牌から即座に消してリー牌(ソート)する(エンジンの反映を待たない)
      const finish = (result) => {
        bar.innerHTML = '';
        self.hideWaits();
        if (result.action === 'discard') {
          const all = self.myDrawn ? [...self.myHand, self.myDrawn] : [...self.myHand];
          all.splice(result.index, 1);
          all.sort((a, b) => a.kind - b.kind || (a.red ? 1 : 0) - (b.red ? 1 : 0));
          self.myHand = all;
          self.myDrawn = null;
        }
        self.renderHand(false);
        resolve(result);
      };
      // 牌を浮かせたとき: その牌を切ると聴牌なら待ち牌を表示
      const onLift = (i) => {
        const all = self.myDrawn ? [...self.myHand, self.myDrawn] : [...self.myHand];
        all.splice(i, 1);
        if (shanten(toCounts(all), view.melds.length) === 0) self.showWaits(all, view.melds.length);
        else self.hideWaits();
      };
      const normalPick = () => self.renderHand(true, null, (i) => finish({ action: 'discard', index: i, riichi: false }), onLift);
      normalPick();

      if (options.includes('tsumo')) this.addBtn(bar, 'ツモ', 'danger', () => finish({ action: 'tsumo' }));
      if (options.includes('ankan')) {
        const all = this.myDrawn ? [...this.myHand, this.myDrawn] : [...this.myHand];
        const counts = toCounts(all);
        for (let k = 0; k < 34; k++) if (counts[k] === 4) {
          this.addBtn(bar, `カン ${tileName(k)}`, '', () => finish({ action: 'ankan', kind: k }));
        }
      }
      if (options.includes('kyuushu')) this.addBtn(bar, '九種九牌', 'pass', () => finish({ action: 'kyuushu' }));

      if (!view.riichi && view.melds.every(m => m.type === 'ankan') && view.drawn) {
        const all = [...this.myHand, this.myDrawn];
        const okIdx = [];
        for (let i = 0; i < all.length; i++) {
          const rest = all.slice(); rest.splice(i, 1);
          if (shanten(toCounts(rest), view.melds.length) === 0) okIdx.push(i);
        }
        if (okIdx.length > 0) {
          this.addBtn(bar, 'リーチ', 'danger', function () {
            riichiMode = !riichiMode;
            this.classList.toggle('pass', riichiMode);
            if (riichiMode) self.renderHand(true, okIdx, (i) => finish({ action: 'discard', index: i, riichi: true }), onLift);
            else normalPick();
          });
        }
      }
    });
  }

  // --- 他家の打牌への反応 (鳴きボタンは牌の絵で示す) ---
  promptClaim(view, offer) {
    this.myHand = view.hand;
    this.myDrawn = null;
    this.renderHand(false);
    this.hideWaits();
    return new Promise((resolve) => {
      const bar = $('#action-bar');
      bar.innerHTML = '';
      const finish = (result) => { bar.innerHTML = ''; resolve(result); };
      const t = offer.tile;
      if (offer.type === 'ron') {
        this.addBtn(bar, 'ロン', 'danger', () => finish({ action: 'ron' }));
      } else {
        if (offer.canPon) {
          this.addTileBtn(bar, 'ポン', [t, t, t], 1, () => finish({ action: 'pon' }));
        }
        if (offer.canKan) {
          this.addTileBtn(bar, 'カン', [t, t, t, t], 1, () => finish({ action: 'minkan' }));
        }
        if (offer.canChi) {
          for (const set of offer.canChi) {
            const seq = [...set.map(k => ({ kind: k, red: false })), { ...t }].sort((a, b) => a.kind - b.kind);
            const sideIdx = seq.findIndex(x => x.kind === t.kind);
            this.addTileBtn(bar, 'チー', seq, sideIdx, () => finish({ action: 'chi', tiles: set }));
          }
        }
      }
      this.addBtn(bar, 'スルー', 'pass', () => finish(null));
    });
  }

  // 牌の絵入りボタン。sideIdxの牌(=鳴く対象の牌)を強調表示
  addTileBtn(bar, label, tiles, sideIdx, onClick) {
    const b = document.createElement('button');
    b.className = 'act-btn tile-btn';
    const lab = document.createElement('span');
    lab.className = 'tb-label';
    lab.textContent = label;
    b.appendChild(lab);
    const row = document.createElement('span');
    row.className = 'tb-tiles';
    tiles.forEach((t, i) => {
      const el = tileEl(t, { mini: true });
      if (i === sideIdx) el.classList.add('claim-target');
      row.appendChild(el);
    });
    b.appendChild(row);
    b.onclick = () => onClick();
    bar.appendChild(b);
    return b;
  }

  addBtn(bar, label, extraClass, onClick) {
    const b = document.createElement('button');
    b.className = 'act-btn ' + extraClass;
    b.textContent = label;
    b.onclick = function () { onClick.call(this); };
    bar.appendChild(b);
    return b;
  }

  // --- 結果オーバーレイ (Promiseを返して進行を止める) ---
  showOverlayAwait(html, btnId = 'btn-next') {
    return new Promise((resolve) => {
      $('#overlay-content').innerHTML = html;
      $('#overlay').classList.remove('hidden');
      const done = () => { $('#overlay').classList.add('hidden'); resolve(); };
      $(`#${btnId}`).onclick = done;
      if (this.spectate) setTimeout(done, 2000); // 観戦モードは自動送り
    });
  }

  transferHtml(points, deltas) {
    let html = '<div class="transfer">';
    for (let p = 0; p < 4; p++) {
      const d = deltas[p];
      const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : 'zero';
      const sign = d > 0 ? '+' : '';
      html += `<div class="row"><span class="name">${SEAT_LABELS[p]}</span>` +
              `<span class="diff ${cls}">${d === 0 ? '—' : sign + d}</span>` +
              `<span class="now">${points[p]}</span></div>`;
    }
    return html + '</div>';
  }

  // 和了カットイン: 結果画面の前に一呼吸の演出
  async showCutin(text, sub, cls) {
    const el = $('#cutin');
    el.innerHTML = `<div class="cutin-band ${cls}"><div class="big">${text}</div>` +
      (sub ? `<div class="who">${sub}</div>` : '') + '</div>';
    el.classList.remove('hidden');
    await sleep(1400);
    el.classList.add('hidden');
  }

  async showWin(data) {
    this.renderBoard(data.state);
    this.hideWaits();
    const { winner, loser, score, deltas } = data;
    const who = SEAT_LABELS[winner];
    const how = loser === null ? 'ツモ' : 'ロン';
    await this.showCutin(`${how}！`, winner === 0 ? null : who, loser === null ? 'cut-tsumo' : 'cut-ron');
    if (score.yakumanCount > 0) await this.showCutin('役　満', null, 'cut-yakuman');
    let html = `<h2>${how}</h2><div class="win-sub">${who}${loser !== null ? `　←　${SEAT_LABELS[loser]}` : ''}</div>`;
    html += `<div class="win-hand" id="win-hand-box"></div>`;
    html += `<div class="dora-line" id="dora-line-box"></div>`;
    for (const y of score.yaku) {
      html += `<div class="yaku-line"><span>${y.name}</span><span class="han">${y.yakuman ? (y.yakuman >= 2 ? 'ダブル役満' : '役満') : y.han + '翻'}</span></div>`;
    }
    if (score.limitName) html += `<div class="limit-name">${score.limitName}</div>`;
    html += `<div class="score-total">${score.total}点</div>`;
    if (!score.yakumanCount) html += `<div class="fu-han">${score.fu}符 ${score.han}翻</div>`;
    html += this.transferHtml(data.state.points, deltas);
    html += `<button class="btn primary big" id="btn-next">次へ</button>`;

    const done = this.showOverlayAwait(html);
    // 手牌+和了牌
    const handBox = $('#win-hand-box');
    const tiles = [...data.hand].sort((a, b) => a.kind - b.kind);
    for (const t of tiles) handBox.appendChild(tileEl(t));
    for (const m of data.melds) { const gap = document.createElement('span'); gap.style.width = '8px'; handBox.appendChild(gap); handBox.appendChild(meldEl(m, false, data.winner)); }
    if (data.winTile) {
      const wt = document.createElement('div');
      wt.className = 'win-tile-box';
      wt.innerHTML = `<span class="lbl">${how}</span>`;
      wt.appendChild(tileEl(data.winTile));
      handBox.appendChild(wt);
    }
    // ドラ表示
    const dl = $('#dora-line-box');
    dl.insertAdjacentHTML('beforeend', '<span class="lbl">ドラ表示</span>');
    for (const t of data.doraInd || []) dl.appendChild(tileEl(t));
    if ((data.uraInd || []).length > 0) {
      dl.insertAdjacentHTML('beforeend', '<span class="lbl" style="margin-left:8px">裏</span>');
      for (const t of data.uraInd) dl.appendChild(tileEl(t));
    }
    await done;
  }

  async showRyukyoku(data) {
    this.renderBoard(data.state);
    let html = `<h2>流局</h2>`;
    if (data.tochu) html += `<div class="win-sub">途中流局</div>`;
    else if (data.tenpai.length === 0) html += `<div class="win-sub">全員ノーテン</div>`;
    else html += `<div class="win-sub">聴牌: ${data.tenpai.map(p => SEAT_LABELS[p]).join('、')}</div>`;
    if ((data.revealed || []).length > 0) {
      html += '<div class="reveal" id="reveal-box"></div>';
    }
    html += this.transferHtml(data.state.points, data.deltas);
    html += `<button class="btn primary big" id="btn-next">次へ</button>`;
    const done = this.showOverlayAwait(html);
    const rv = $('#reveal-box');
    if (rv) {
      for (const r of data.revealed) {
        const row = document.createElement('div');
        row.className = 'rv-row';
        row.innerHTML = `<span class="nm">${SEAT_LABELS[r.player]}</span>`;
        for (const t of [...r.hand].sort((a, b) => a.kind - b.kind)) row.appendChild(tileEl(t));
        for (const m of r.melds || []) row.appendChild(meldEl(m, true, r.player));
        rv.appendChild(row);
      }
    }
    await done;
  }

  async showNagashi(data) {
    let html = `<h2>流し満貫</h2><div class="win-sub">${SEAT_LABELS[data.player]}</div>`;
    html += this.transferHtml(data.state.points, data.deltas);
    html += `<button class="btn primary big" id="btn-next">次へ</button>`;
    await this.showOverlayAwait(html);
  }

  async showGameEnd(data) {
    const rules = loadRules();
    let html = `<h2>終局</h2>`;
    data.ranking.forEach((p, rank) => {
      const uma = rules.uma[rank] * 1000;
      const oka = rank === 0 ? (rules.returnPoints - rules.startPoints) * 4 : 0;
      const finalPt = data.points[p] - rules.returnPoints + uma + oka;
      html += `<div class="rank-line"><span>${rank + 1}位 ${SEAT_LABELS[p]}</span>` +
              `<span class="pt">${data.points[p]}点 (${finalPt >= 0 ? '+' : ''}${Math.round(finalPt / 1000)})</span></div>`;
    });
    html += `<button class="btn primary big" id="btn-title">タイトルへ</button>`;
    await this.showOverlayAwait(html, 'btn-title');
    show('title');
  }
}

// ============ 画面遷移 ============
function show(name) {
  for (const s of ['title', 'rules', 'game']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
}

const uiInstance = new UI();
$('#btn-start').onclick = () => uiInstance.startGame();
$('#btn-rules').onclick = () => { renderRulesScreen(); show('rules'); };
$('#btn-rules-done').onclick = () => show('title');
show('title');

// 開発用: ?autostart で即対局開始(スクリーンショット検品用)
if (location.search.includes('autostart')) uiInstance.startGame();
