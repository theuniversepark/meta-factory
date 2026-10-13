// 확장 Zone(A-1 유연생산 · A-2 적응가공) 시설 검증 — Zone마다 정비실·정비 인력, 사족보행·드론 스테이션, 물류 휴머노이드가 자기 Zone 일을 맡는지. 실행: npm test
import { zoneLine } from '../js/line.js';
import { Simulation, ZONE_KIT } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { ZONE_FAC, TECH_ROOMS, techLocal } from '../js/zonedefs.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (s, ag, sec, each) => { for (let t = 0; t < sec; t += 0.1) { s.step(0.1); ag.update(0.1); if (each?.()) return true; } return false; };
const ZK = Object.keys(ZONE_FAC);
console.log('== 구성 (피지컬AI)');
{ const s = new Simulation('dark', 2, { line: zoneLine(), quiet: true });
  for (const z of ZK) {
    const T = s.techs.filter((t) => t.zone === z), Q = s.quads.filter((q) => q.zone === z), D = s.drones.filter((d) => d.zone === z), H = s.helpers.filter((h) => h.zone === z);
    check(`${z}: 정비 2 · 사족보행 2 · 드론 2 · 물류 휴머노이드 2`, T.length === 2 && Q.length === 2 && D.length === 2 && H.length === 2, `${T.length}·${Q.length}·${D.length}·${H.length}`);
    check(`${z}: 정비 인력 대기 자리 = 자기 Zone 정비실 양쪽 끝 충전 스테이션`, T.every((t) => { const l = techLocal(t.home, TECH_ROOMS[z]); return Math.abs(l.lz + 2.5) < 1e-6; }));
    check(`${z}: 드론은 자기 Zone 이착륙장`, D.every((d, i) => d.home.x === ZONE_FAC[z].pads[i].x && d.home.z === ZONE_FAC[z].pads[i].z));
  }
  check('확장 Zone 셀 14개 (A-1 8 · A-2 6) 고장·정비 대상', s.zoneCells.length === 14 && s.zoneCells.filter((c) => c.zone === 'flex').length === 8);
}
console.log('== 셀 고장 → 자기 Zone 정비 인력 출동·수리');
for (const mode of ['smart', 'dark']) {
  const s = new Simulation(mode, 3, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  run(s, ag, 120);
  for (const z of ZK) {
    const st = s.zoneCells.find((c) => c.zone === z && c.state === 'OK' && !c.request);
    s.fail(st);
    let tech = null;
    const ok = run(s, ag, 600, () => { tech ??= st.request?.tech ?? null; return st.state === 'OK'; });
    check(`${mode} ${z}: ${st.name} 고장 → ${tech?.id ?? '?'} 출동 · 수리 완료`, ok && tech?.zone === z, `수리 ${ok ? '완료' : '미완료'} · 출동 ${tech?.id ?? '없음'}`);
  }
  check(`${mode}: 확장 Zone 고장은 정밀조립Zone 고장 실적과 따로 셈`, (s.stats.zoneFailures ?? 0) >= 2);
}
console.log('== 순찰 · 물류 (피지컬AI)');
{ const s = new Simulation('dark', 5, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  const seen = Object.fromEntries(ZK.map((z) => [z, new Set()])), wrong = [];
  run(s, ag, 1800, () => { for (const q of s.quads) if (q.zone && q.target) { if (q.target.zone !== q.zone) wrong.push(q.id); seen[q.zone].add(q.target.id); } });
  for (const z of ZK) check(`${z}: 사족보행이 자기 Zone 셀만 순찰 (30분)`, !wrong.length && seen[z].size >= 4, `순찰한 셀 ${seen[z].size}개`);
  // 투입구 부품 키트가 재주문점 아래로 떨어지면 자기 Zone 물류 휴머노이드가 확장 선반에서 가져와 채운다
  for (const z of ZK) { s.zoneKits[z] = ZONE_KIT.reorder - 1; }
  const parts0 = Object.fromEntries(ZK.map((z) => [z, s.whZone[z].parts]));
  const done = run(s, ag, 600, () => ZK.every((z) => s.zoneKits[z] > ZONE_KIT.reorder));
  check('투입구 키트 → 물류 휴머노이드가 확장 선반에서 가져와 채움 (A-1 · A-2)', done && ZK.every((z) => s.whZone[z].parts < parts0[z]), ZK.map((z) => `${z} 키트 ${s.zoneKits[z]} · 선반 ${parts0[z]}→${s.whZone[z].parts}`).join(' · '));
  check('투입은 투입구 원재료 버퍼 · 키트에서 꺼냄', (() => { const k = s.zoneKits.flex, r = s.zoneRaw.flex; return s.takeZoneStock('flex') && s.zoneKits.flex === k - 1 && s.zoneRaw.flex === r - 1; })());
  // 투입구 원재료가 줄면 Zone 전용 AGV가 확장 선반에서 실어 온다
  const V = Object.fromEntries(ZK.map((z) => [z, s.vehicles.find((v) => v.zone === z)]));
  check('Zone 전용 AGV 1대씩 (물류 AGV 4대 중 2대)', ZK.every((z) => V[z]?.kind === 'agv') && s.vehicles.filter((v) => !v.zone).length === 2);
  for (const z of ZK) s.zoneRaw[z] = 5;
  const raw0 = Object.fromEntries(ZK.map((z) => [z, s.whZone[z].raw]));
  const fed = run(s, ag, 900, () => ZK.every((z) => s.zoneRaw[z] >= 25));
  check('투입구 원재료 → Zone 전용 AGV가 확장 선반에서 실어 와 채움', fed && ZK.every((z) => s.whZone[z].raw < raw0[z]), ZK.map((z) => `${z} 투입구 ${s.zoneRaw[z]} · 선반 ${raw0[z]}→${s.whZone[z].raw}`).join(' · '));
}
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
