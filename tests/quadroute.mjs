// 사족보행 출동 경로 — 순찰 중(이동 중)에 현장 이벤트(연기 의심) 점검으로 출동해도
//   ① 충전 스테이션으로 곧게 되돌아가지 않는다 (사족보행 충전 도크 상자를 가로지르지 않음 — 1.0.93 이전: 75번 중 25번 도크 통과)
//   ② 현장까지 가는 시간이 줄었다 (지금 통로 자리에서 바로 출발)
import { zoneLine } from '../js/line.js';
import { Simulation } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
let hits = [], n = 0; const arr = [];
for (const seed of [3, 5]) for (const pick of [0, 4, 8]) for (const t0 of [30, 90]) {
  const s = new Simulation('dark', seed, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  const run = (sec, f) => { for (let t = 0; t < sec; t += 0.1) { s.step(0.1); ag.update(0.1); if (f?.()) return; } };
  run(t0); const cells = s.processing.filter((x) => !x.standby), st = cells[pick % cells.length];
  const ev = s.injectFieldEvent('smoke', st.x + 1.5, st.z + 2.2); if (!ev) continue; s.detectFieldEvent(ev, 'test', 0.9);
  for (let k = 0; k < 300 && !ev.responder; k++) run(0.1);
  const q = s.quads.find((k) => k.id === ev.responder); if (!q) continue; n++;
  const docks = s.quads.filter((k) => !k.zone).map((k) => ({ id: k.id, cx: k.home.x, cz: k.home.z + 1.05 }));   // 메인 도크: 로봇 뒤 1.05m · 0.7×0.28 (factory.js)
  const t1 = s.time; let hit = null;
  run(200, () => { for (const d of docks) { const dist = Math.hypot(Math.max(Math.abs(q.x - d.cx) - 0.35, 0), Math.max(Math.abs(q.z - d.cz) - 0.14, 0)); if (dist < 0.55 && !(d.id === q.id && Math.hypot(q.x - q.home.x, q.z - q.home.z) < 0.05)) hit ??= `${seed}/${pick}/${t0} ${q.id} → ${d.id} 도크 (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`; } return q.scanning; });
  if (hit) hits.push(hit);
  arr.push(s.time - t1);
}
arr.sort((a, b) => a - b);
check('출동한 사족보행이 있다', n >= 8, `${n}회`);
check('충전 도크를 가로지르지 않는다', hits.length === 0, hits[0] ?? '');
check('현장 도착 중앙값 60초 이내', arr[arr.length >> 1] <= 60, `중앙값 ${arr[arr.length >> 1]?.toFixed(0)}초 · 최대 ${arr.at(-1)?.toFixed(0)}초`);
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
