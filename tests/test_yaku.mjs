// test_yaku.mjs — 役判定・点数計算のテスト  実行: node tests/test_yaku.mjs
import { parseTiles, TON, NAN } from '../js/engine/tiles.js';
import { evaluateWin } from '../js/engine/yaku.js';
import { basePoints, payment, scoreWin } from '../js/engine/score.js';
import { makeRules } from '../js/engine/rules.js';

let pass = 0, fail = 0;
function check(cond, label, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  NG: ${label} ${detail}`); }
}

const R = makeRules();

// ctx組み立てヘルパ: hand文字列は和了牌を含む14枚相当(副露除く)。最後の牌を和了牌とみなすのではなく winTile 指定
function ctx(handStr, winStr, opts = {}) {
  const all = parseTiles(handStr);
  const win = parseTiles(winStr)[0];
  // handからwinTileを1枚除く
  const idx = all.findIndex(t => t.kind === win.kind && t.red === win.red);
  if (idx < 0) throw new Error(`winTile ${winStr} not in hand ${handStr}`);
  const hand = all.slice();
  hand.splice(idx, 1);
  return {
    hand, melds: [], winTile: win, tsumo: false,
    riichi: false, doubleRiichi: false, ippatsu: false, rinshan: false,
    chankan: false, haitei: false, houtei: false, tenhou: false, chihou: false,
    seatWind: NAN, roundWind: TON, doraIndicators: [], uraIndicators: [],
    ...opts,
  };
}
const names = (r) => r.yaku.map(y => y.name);

// --- 基本役 ---
{
  const r = evaluateWin(ctx('234567m234567p66s', '2m', { tsumo: true }), R);
  check(r && names(r).includes('断么九') && names(r).includes('門前清自摸和') && names(r).includes('平和'),
    'tanyao+tsumo+pinfu', JSON.stringify(r?.yaku));
  check(r && r.fu === 20, 'pinfu tsumo = 20fu', `fu=${r?.fu}`);
}
{
  const r = evaluateWin(ctx('234567m234567p66s', '2m'), R);
  check(r && r.fu === 30, 'pinfu ron = 30fu', `fu=${r?.fu}`);
  check(r && r.han === 2, 'pinfu+tanyao = 2han', `han=${r?.han}`);
}
{ // 役なしロン → null
  const r = evaluateWin(ctx('123m456p789s11z234s', '2s'), R);
  check(r === null, 'yakuless ron is null', JSON.stringify(r?.yaku));
}
{ // リーチのみ
  const r = evaluateWin(ctx('123m456p789s11z234s', '2s', { riichi: true }), R);
  check(r && r.han === 1 && names(r).includes('リーチ'), 'riichi only', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('123m456p789s777z22z', '9s'), R);
  check(r && names(r).some(n => n.startsWith('役牌 中')), 'yakuhai chun', JSON.stringify(r?.yaku));
}
{ // 自風・場風ダブ東(東家・東場)
  const r = evaluateWin(ctx('123m456p789s111z22z', '9s', { seatWind: TON, roundWind: TON }), R);
  check(r && names(r).includes('場風 東') && names(r).includes('自風 東'), 'double east', JSON.stringify(r?.yaku));
}
// --- 七対子 ---
{
  const r = evaluateWin(ctx('1133m5577p99s1122z', '1m'), R);
  check(r && names(r).includes('七対子') && r.fu === 25, 'chiitoi 25fu', JSON.stringify(r?.yaku));
}
{ // 七対子+断么+清一色は複合しない形で混一色確認
  const r = evaluateWin(ctx('1133557799m11z22z', '1m'), R);
  check(r && names(r).includes('七対子') && names(r).includes('混一色'), 'chiitoi+honitsu', JSON.stringify(r?.yaku));
}
// --- 一盃口・二盃口 ---
{
  const r = evaluateWin(ctx('112233m456p789s55s', '1m'), R);
  check(r && names(r).includes('一盃口'), 'iipeiko', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('112233m667788p55s', '1m'), R);
  check(r && names(r).includes('二盃口'), 'ryanpeiko', JSON.stringify(r?.yaku));
  // 二盃口(3)+平和(1) — 七対子(2)より高く採用されること
  check(r && r.han >= 4, 'ryanpeiko beats chiitoi', `han=${r?.han}`);
}
// --- 三色・一気通貫 ---
{
  const r = evaluateWin(ctx('123m123p123s456m11z', '1m'), R);
  check(r && names(r).includes('三色同順'), 'sanshoku', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('123456789m456p11z', '1m'), R);
  check(r && names(r).includes('一気通貫'), 'ittsu', JSON.stringify(r?.yaku));
}
// --- 対々和・三暗刻 ---
{ // ツモ単騎なら四暗刻単騎(ダブル)
  const r = evaluateWin(ctx('111m222p333s444m55z', '5z', { tsumo: true }), R);
  check(r && names(r).includes('四暗刻単騎') && r.yakumanCount === 2, 'suuankou tanki tsumo double', JSON.stringify(r?.yaku));
}
{ // ツモなら四暗刻
  const r = evaluateWin(ctx('111m222p333s444m55z', '4m', { tsumo: true }), R);
  check(r && names(r).includes('四暗刻'), 'suuankou tsumo', JSON.stringify(r?.yaku));
}
{ // ロンで完成した刻子は明刻 → 三暗刻+対々和
  const r = evaluateWin(ctx('111m222p333s444m55z', '4m', { tsumo: false }), R);
  check(r && names(r).includes('三暗刻') && names(r).includes('対々和'), 'ron kotsu = minko → sanankou+toitoi', JSON.stringify(r?.yaku));
}
{ // 四暗刻単騎はダブル
  const r = evaluateWin(ctx('111m222p333s444m55z', '5z', { tsumo: false }), R);
  check(r && r.yakumanCount === 2 && names(r).includes('四暗刻単騎'), 'suuankou tanki double', JSON.stringify(r?.yaku));
}
// --- 役満いろいろ ---
{
  const r = evaluateWin(ctx('19m19p19s12345677z', '7z'), R);
  check(r && r.yakumanCount >= 1 && names(r)[0].startsWith('国士'), 'kokushi', JSON.stringify(r?.yaku));
}
{ // 13面待ちダブル
  const r = evaluateWin(ctx('19m19p19s12345667z', '6z'), R);
  check(r && r.yakumanCount === 2, 'kokushi 13-wait double', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('555z666z777z123m44m', '4m'), R);
  check(r && names(r).includes('大三元'), 'daisangen', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('111z222z333z444z55z', '5z', { tsumo: true }), R);
  check(r && names(r).includes('大四喜') && names(r).includes('字一色'), 'daisuushi+tsuuiisou', JSON.stringify(r?.yaku));
  check(r && r.yakumanCount >= 3, 'daisuushi(2)+tsuuiisou(1)+suuankou(1)... count', `count=${r?.yakumanCount}`);
}
{
  const r = evaluateWin(ctx('11123456789999m', '5m'), R); // 純正ではない(5m和了だが待ち形は?)
  check(r && names(r).some(n => n.includes('九蓮')), 'chuuren', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('22334466688s888m', '8m'), R);
  check(r === null || !names(r).includes('緑一色'), 'not ryuuiisou (8m)', '');
}
{
  const r = evaluateWin(ctx('223344666888s66z', '6z'), R);
  check(r && names(r).includes('緑一色'), 'ryuuiisou', JSON.stringify(r?.yaku));
}
// --- チャンタ・純チャン・混老頭 ---
{
  const r = evaluateWin(ctx('123m789p123s111z99m', '9m'), R);
  check(r && names(r).includes('混全帯么九'), 'chanta', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('123m789p123s999s11m', '1m'), R);
  check(r && names(r).includes('純全帯么九'), 'junchan', JSON.stringify(r?.yaku));
}
{
  // ロンで111mが明刻扱い→四暗刻を外して混老頭+対々和+三暗刻で見る
  const r = evaluateWin(ctx('111m999m111p999s11z', '1m', { tsumo: false }), R);
  check(r && names(r).includes('混老頭') && names(r).includes('対々和'), 'honroutou+toitoi', JSON.stringify(r?.yaku));
}
// --- 染め手 ---
{
  const r = evaluateWin(ctx('123456789m111m22m', '2m'), R);
  check(r && names(r).includes('清一色'), 'chinitsu', JSON.stringify(r?.yaku));
}
{
  const r = evaluateWin(ctx('123456789m111z22m', '2m'), R);
  check(r && names(r).includes('混一色'), 'honitsu', JSON.stringify(r?.yaku));
}
// --- ドラ ---
{
  // ドラ表示牌1m → ドラ2m。手に2mが2枚
  const c = ctx('223344m567p678s88s', '2m', { riichi: true, doraIndicators: [0] });
  const r = evaluateWin(c, R);
  check(r && r.yaku.find(y => y.name === 'ドラ')?.han === 2, 'dora 2', JSON.stringify(r?.yaku));
}
{
  // 赤5入り: 234m 567p(赤5) 678s 888s 44m
  const c3 = ctx('234m067p678s888s44m', '4m', { riichi: true });
  const r3 = evaluateWin(c3, R);
  check(r3 && r3.yaku.find(y => y.name === '赤ドラ')?.han === 1, 'aka dora 1', JSON.stringify(r3?.yaku));
}
// --- 喰いタン設定 ---
{
  // 副露あり断么: 手=234m 567m 234p 66s +ポン888p、和了2m
  const all = parseTiles('234567m234p66s');
  const win = all[0];
  const hand = all.slice(1);
  const c = { ...ctx('234567m234p66s', '2m'), hand, winTile: win, melds: [{ type: 'pon', tiles: parseTiles('888p') }] };
  const rOn = evaluateWin(c, makeRules({ kuitan: true }));
  const rOff = evaluateWin(c, makeRules({ kuitan: false }));
  check(rOn && names(rOn).includes('断么九'), 'kuitan on', JSON.stringify(rOn?.yaku));
  check(rOff === null, 'kuitan off → yakuless null', JSON.stringify(rOff?.yaku));
}
// --- 点数テーブル ---
check(basePoints(1, 30, 0, R) === 240, '1han30fu base240');
check(payment(240, false, false, 0).payments.ron === 1000, '1han30fu ron 1000');
check(payment(240, true, false, 0).payments.ron === 1500, 'dealer 1han30fu ron 1500');
check(payment(basePoints(3, 30, 0, R), false, false).payments.ron === 3900, '3han30fu = 3900');
check(payment(basePoints(4, 30, 0, R), false, false).payments.ron === 7700, '4han30fu = 7700');
check(payment(basePoints(4, 30, 0, makeRules({ kiriage: true })), false, false).payments.ron === 8000, 'kiriage 4han30fu = 8000');
check(payment(basePoints(4, 25, 0, R), false, false).payments.ron === 6400, 'chiitoi 4han25fu = 6400');
check(payment(basePoints(5, 30, 0, R), false, false).payments.ron === 8000, 'mangan 8000');
check(payment(basePoints(6, 30, 0, R), false, false).payments.ron === 12000, 'haneman 12000');
check(payment(basePoints(8, 30, 0, R), false, false).payments.ron === 16000, 'baiman 16000');
check(payment(basePoints(11, 30, 0, R), false, false).payments.ron === 24000, 'sanbaiman 24000');
check(payment(basePoints(13, 30, 0, R), false, false).payments.ron === 32000, 'kazoe yakuman 32000');
check(payment(basePoints(13, 30, 0, makeRules({ kazoeYakuman: false })), false, false).payments.ron === 24000, 'no kazoe → sanbaiman');
check(payment(basePoints(0, 0, 1, R), true, false).payments.ron === 48000, 'dealer yakuman 48000');
{ // 非親ツモ満貫 2000/4000
  const p = payment(2000, false, true, 0).payments;
  check(p.othersPay === 2000 && p.dealerPay === 4000, 'mangan tsumo 2000/4000', JSON.stringify(p));
}
{ // 30符1翻 非親ツモ 300/500
  const p = payment(basePoints(1, 30, 0, R), false, true, 0).payments;
  check(p.othersPay === 300 && p.dealerPay === 500, '1han30fu tsumo 300/500', JSON.stringify(p));
}
{ // 40符2翻 親ツモ 1300all
  const p = payment(basePoints(2, 40, 0, R), true, true, 0).payments;
  check(p.othersPay === 1300, '2han40fu dealer tsumo 1300all', JSON.stringify(p));
}
// --- 符計算の代表例 ---
{
  // 暗刻(么九)入りロン: 123m 456p 789s 111z(暗刻) 22m 和了3m(両面...123mの3)
  // 20 + 10(門前ロン) + 8(字牌暗刻) = 38 → 40符
  const r = evaluateWin(ctx('123m456p789s111z22m', '3m', { riichi: true }), R);
  check(r && r.fu === 40, 'fu: menzen ron with honor anko = 40', `fu=${r?.fu}`);
}
{
  // カンチャン待ち: 20+10+2 = 32 → 40符
  const r = evaluateWin(ctx('123m456p78s9s55z777p', '8s', { riichi: true }), R);
  // 手構成: 123m 456p 789s 777p 55z 和了8s(カンチャン 7_9)
  check(r && r.fu === 40, 'fu: kanchan wait 40', `fu=${r?.fu}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
