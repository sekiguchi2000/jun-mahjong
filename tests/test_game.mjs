// test_game.mjs — COM4人の通し対局シミュレーション  実行: node tests/test_game.mjs [対局数]
import { Game } from '../js/engine/game.js';
import { ComActor } from '../js/engine/ai.js';
import { makeRules } from '../js/engine/rules.js';

const N = parseInt(process.argv[2] || '20', 10);
let pass = 0, fail = 0;
const stats = { wins: 0, ryukyoku: 0, riichi: 0, kan: 0, calls: 0, yakuCount: {}, maxHan: 0 };

for (let g = 0; g < N; g++) {
  const ruleVariants = [
    makeRules(),
    makeRules({ gameLength: 'tonpuu', akaDora: 0, kuitan: false }),
    makeRules({ kiriage: true, akaDora: 4 }),
  ];
  const rules = ruleVariants[g % ruleVariants.length];
  const game = new Game(rules, [new ComActor('A'), new ComActor('B'), new ComActor('C'), new ComActor('D')],
    (type, data) => {
      if (type === 'win') {
        stats.wins++;
        stats.maxHan = Math.max(stats.maxHan, data.score.han);
        for (const y of data.score.yaku) stats.yakuCount[y.name] = (stats.yakuCount[y.name] || 0) + 1;
      }
      if (type === 'ryukyoku') stats.ryukyoku++;
      if (type === 'kan') stats.kan++;
      if (type === 'claim') stats.calls++;
      if (type === 'discard' && data.riichi) stats.riichi++;
    });
  try {
    const result = await game.run();
    const total = result.points.reduce((a, b) => a + b, 0) + game.riichiSticks * 1000;
    const expected = rules.startPoints * 4;
    if (total === expected) pass++;
    else { fail++; console.log(`  NG game ${g}: points sum ${total} != ${expected}  (${result.points})`); }
  } catch (e) {
    fail++;
    console.log(`  NG game ${g}: CRASH ${e.message}\n${e.stack.split('\n').slice(0, 4).join('\n')}`);
  }
}

console.log(`\n${pass}/${N} games OK, ${fail} failed`);
console.log(`stats: wins=${stats.wins} ryukyoku=${stats.ryukyoku} riichi=${stats.riichi} kan=${stats.kan} calls=${stats.calls} maxHan=${stats.maxHan}`);
const topYaku = Object.entries(stats.yakuCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('yaku:', topYaku.map(([n, c]) => `${n}x${c}`).join(' '));
process.exit(fail ? 1 : 0);
