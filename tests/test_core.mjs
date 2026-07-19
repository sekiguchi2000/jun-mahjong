// test_core.mjs — エンジン基礎のテスト  実行: node tests/test_core.mjs
import { parseTiles, toCounts, doraFromIndicator, tileName, MAN, PIN, SOU, TON, CHUN, HAKU, PEI } from '../js/engine/tiles.js';
import { buildWall, deal, shuffle } from '../js/engine/wall.js';
import { isAgari, isChiitoi, isKokushi, decompose } from '../js/engine/agari.js';
import { shanten, waitingTiles } from '../js/engine/shanten.js';
import { makeRules } from '../js/engine/rules.js';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log(`  NG: ${label}  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`); }
}
const counts = (s) => toCounts(parseTiles(s));

// --- tiles ---
eq(parseTiles('123m').map(t => t.kind), [0, 1, 2], 'parse 123m');
eq(parseTiles('0p')[0], { kind: 13, red: true }, 'parse red 5p');
eq(tileName(33), '中', 'tileName chun');
eq(doraFromIndicator(8), 0, 'dora: 9m -> 1m');
eq(doraFromIndicator(PEI), TON, 'dora: pei -> ton');
eq(doraFromIndicator(CHUN), HAKU, 'dora: chun -> haku');

// --- wall ---
const rules = makeRules();
const wall = buildWall(rules);
eq(wall.length, 136, 'wall 136 tiles');
eq(wall.filter(t => t.red).length, 3, 'aka dora 3');
eq(buildWall(makeRules({ akaDora: 0 })).filter(t => t.red).length, 0, 'aka dora 0');
eq(buildWall(makeRules({ akaDora: 4 })).filter(t => t.red).length, 4, 'aka dora 4');
const { hands, live, deadWall } = deal(wall);
eq(hands.map(h => h.length), [13, 13, 13, 13], 'deal 13x4');
eq(live.length, 136 - 52 - 14, 'live wall 70');
eq(deadWall.length, 14, 'dead wall 14');
// 統計チェック: シャッフルが偏っていないか(先頭牌の分布)
{
  const freq = new Array(34).fill(0);
  for (let i = 0; i < 3400; i++) freq[buildWall(rules)[0].kind]++;
  const max = Math.max(...freq), min = Math.min(...freq);
  if (min > 40 && max < 200) pass++; else { fail++; console.log(`  NG: shuffle distribution min=${min} max=${max}`); }
}

// --- agari ---
eq(isAgari(counts('123456789m123p11s')), true, 'agari: ittsu-ish standard');
eq(isAgari(counts('123m123p123s12345z')), false, 'not agari: 5 lone honors');
eq(isAgari(counts('123m123p123s11z222z')), true, 'agari: with honors');
eq(isAgari(counts('123m456p789s1122z3z')), false, 'not agari: bad shape');
eq(isChiitoi(counts('1133m5577p99s1122z')), true, 'chiitoi');
eq(isChiitoi(counts('1111m5577p99s1122z')), false, 'chiitoi: 4 same not allowed');
eq(isKokushi(counts('19m19p19s12345677z')), true, 'kokushi');
eq(isKokushi(counts('19m19p19s12345667z')), true, 'kokushi 13-wait variant has pair 6z');
eq(isAgari(counts('11122233344455m')), true, 'agari: all kotsu manzu'); // 14枚
eq(decompose(counts('123m123m456p789s11z')).length >= 1, true, 'decompose finds iipeiko shape');
// 純正九蓮宝燈は9通りではなく複数分解を持つ
eq(decompose(counts('11123456789999m')).length >= 1, true, 'decompose chuuren-ish');

// --- shanten ---
eq(shanten(counts('123456789m123p11s')), -1, 'shanten: complete = -1');
eq(shanten(counts('123456789m123p1s')), 0, 'shanten: tenpai = 0'); // 13枚 単騎
eq(shanten(counts('123456789m12p11s')), 0, 'shanten: ryanmen tenpai');
eq(shanten(counts('123456789m1p2s3z')), 2, 'shanten: 3 melds + 3 floaters = 2');
eq(shanten(counts('123456789m11p2s3z')), 1, 'shanten: 3 melds + pair + 2 floaters = 1');
eq(shanten(counts('1133m5577p99s112z')), 0, 'chiitoi tenpai'); // 13枚 6対子
eq(shanten(counts('19m19p19s1234567z')), 0, 'kokushi 13-wait tenpai');
eq(shanten(counts('147m258p369s1234z')), 6, 'worst-ish hand');
eq(waitingTiles(counts('123456789m12p11s')), [11], 'wait: 3p only'); // 12p待ち→3p(kind11)…両面なら3pと表現? 12p waits on 3p only? 1p2p → waits 3p. yes
eq(waitingTiles(counts('123456789m23p11s')).sort((a,b)=>a-b), [9, 12], 'wait: 1p and 4p');
eq(waitingTiles(counts('19m19p19s1234567z')).length, 13, 'kokushi 13-sided wait');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
