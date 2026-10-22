// 화면 보간(js/stepinterp.js) — 그리는 동안만 값을 섞고 시뮬레이션 상태는 바꾸지 않는다
//  · 트럭처럼 x·z가 계산 속성(야드 좌표 → 월드 좌표)인 객체도 월드 위치가 두 간격 사이에 오고, 되돌린 뒤 야드 좌표가 그대로
//  · 화면 루프처럼 매 간격 capture → apply → restore를 해도 시뮬레이션 결과가 보간 없이 돌린 것과 같음 (트럭이 건물 안으로 들어가던 문제)
import { StepInterp } from '../js/stepinterp.js';
import { Truck, shipToWorld, SHIP_FRAME } from '../js/shipping.js';
import { Simulation } from '../js/sim.js';
import { HybridAgent } from '../js/multiagent.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

console.log('== 계산 속성 좌표 (트럭)');
{
  const t = new Truck('화물트럭-1', 0, -30, Math.PI, { pos: shipToWorld, dh: SHIP_FRAME.rot }), I = new StepInterp();
  I.capture([t]); const w0 = { x: t.x, z: t.z };
  t.lz += 2;   // 야드 좌표로 2m 이동
  const w1 = { x: t.x, z: t.z }, l1 = { x: t.lx, z: t.lz };
  I.apply([t], 0.5);
  const mid = { x: t.x, z: t.z };
  check('그리는 동안 트럭 월드 위치가 두 간격의 가운데', Math.abs(mid.x - (w0.x + w1.x) / 2) < 1e-9 && Math.abs(mid.z - (w0.z + w1.z) / 2) < 1e-9, `(${mid.x.toFixed(2)}, ${mid.z.toFixed(2)})`);
  I.restore();
  check('되돌린 뒤 야드 좌표·월드 좌표 그대로', t.lx === l1.x && t.lz === l1.z && t.x === w1.x && t.z === w1.z);
}

console.log('== 화면 루프와 같은 순서로 2시간 — 보간이 시뮬레이션을 바꾸지 않음');
{
  const targets = (s) => [s.vehicles, s.forklifts, s.carriers, s.techs, s.helpers, s.quads, s.drones, s.workers, s.yard?.trucks, s.inbound?.trucks, s.stations].flatMap((a) => a ?? []);
  const run = (interp) => {
    const s = new Simulation('dark', 21, { quiet: true }), ag = new HybridAgent(s), I = new StepInterp();
    let minTruckX = Infinity;
    for (let i = 0; i < 72000; i++) {
      if (interp) I.capture(targets(s));
      s.step(0.1); ag.update(0.1);
      if (interp) { I.apply(targets(s), 0.37); I.restore(); }
      for (const t of s.yard?.trucks ?? []) minTruckX = Math.min(minTruckX, t.x);
    }
    const k = s.kpi();
    return { sig: JSON.stringify([s.stats.shipped, Math.round(k.uph * 1000), Math.round(k.oee * 1e6), (s.yard?.trucks ?? []).map((t) => [t.state, +t.lx.toFixed(3), +t.lz.toFixed(3)])]), minTruckX, shipped: s.stats.shipped };
  };
  const a = run(false), b = run(true);
  check('보간을 켜도 출하량·UPH·OEE·트럭 위치가 같음', a.sig === b.sig, `출하 ${a.shipped} / ${b.shipped}`);
  check('출하 트럭이 건물 오른쪽 벽(x 38) 밖에만 있음', b.minTruckX > 38, `가장 안쪽 x ${b.minTruckX.toFixed(1)}`);
}

console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
