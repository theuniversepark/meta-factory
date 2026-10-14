// 확장 Zone(유연생산 · 적응가공) 시설 검증 — Zone마다 정비실·정비 인력, 사족보행·드론 스테이션, 물류 휴머노이드가 자기 Zone 일을 맡는지. 실행: npm test
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
  check('확장 Zone 셀 14개 (유연생산 8 · 적응가공 6) 고장·정비 대상', s.zoneCells.length === 14 && s.zoneCells.filter((c) => c.zone === 'flex').length === 8);
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
console.log('== 정비 배정이 막히지 않음 (긴급수리 우선 전환 · 다른 Zone 지원)');
{ const s = new Simulation('smart', 4, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  run(s, ag, 60);
  const cells = s.zoneCells.filter((c) => c.zone === 'flex' && c.state === 'OK' && !c.request);
  // 유연생산 정비원 2명을 예지정비로 보낸 직후 다른 셀이 고장 → 가던 정비원 1명이 긴급수리로 돌아선다
  s.requestTech(cells[0], 'pm'); s.requestTech(cells[1], 'pm'); run(s, ag, 1);
  s.fail(cells[2]); run(s, ag, 30, () => !!cells[2].request?.tech);   // 자동화: 오케스트레이터 판단 지연 뒤 긴급수리 요청
  const r = cells[2].request;
  check('긴급수리: 예지정비로 가던 인력을 바로 전환 (같은 Zone)', r?.tech?.zone === 'flex' && (s.stats.techPreempt ?? 0) >= 1, `${r?.tech?.id ?? '미배정'} · 전환 ${s.stats.techPreempt ?? 0}회`);
  // 유연생산 정비원이 모두 긴급수리 중일 때 또 고장 → 20초 뒤 다른 Zone 정비원이 지원 출동
  run(s, ag, 3); s.fail(cells[3]); run(s, ag, 30, () => !!cells[3].request?.tech); s.fail(cells[4]); run(s, ag, 30, () => !!cells[4].request);
  const r2 = cells[4].request; let t = 0; run(s, ag, 60, () => { t += 0.1; return !!r2?.tech; });
  check('긴급수리: 자기 Zone 인력이 모두 작업 중이면 20초 뒤 다른 Zone 인력 지원', !!r2.tech && r2.tech.zone !== 'flex' && t >= 19, `${r2.tech?.id ?? '미배정'} · ${t.toFixed(1)}초`);
  const inc4 = s.orch.find(`fail:${cells[4].id}`), steps = inc4?.steps.map((x) => x.text) ?? [];
  check('Zone 오케스트레이터 간 지원 요청 → 승인 → 파견 (타임라인)', steps.some((x) => /오케스트레이터 → .*오케스트레이터: 정비 지원 요청/.test(x)) && steps.some((x) => /지원 승인/.test(x)) && /지원\]/.test(r2.tech?.task ?? ''), steps.filter((x) => /지원/.test(x)).slice(0, 2).join(' / ').slice(0, 120));
  // 화재 의심(P1) 보류는 같은 Zone 정비만 — 다른 Zone 예지정비는 그대로 배정
  const ev = s.injectFieldEvent('smoke', 0, 8.2); s.detectFieldEvent(ev, '시험', 0.9);
  const a2 = s.zoneCells.find((c) => c.zone === 'adapt' && c.state === 'OK' && !c.request); s.requestTech(a2, 'pm'); run(s, ag, 1);
  check('P1 대응 중에도 다른 Zone 예지정비는 배정', !!a2.request?.tech, a2.request?.tech?.id ?? '미배정');
}
console.log('== 정비 지연 사유 기록 (인시던트 타임라인 · 로그 · 셀 정보 창)');
{ const s = new Simulation('smart', 5, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  run(s, ag, 60);
  // 정밀조립 정비원(자동화 1명)이 수리 중일 때 두 번째 고장 → 배정할 인력 없음 사유가 남고, 다른 Zone 지원으로 해소
  const [A, B] = s.processing.filter((x) => x.state !== 'DOWN' && x.state !== 'MAINT' && !x.standby);
  s.fail(A); run(s, ag, 30, () => !!A.request?.tech); s.fail(B);
  let reason = ''; run(s, ag, 60, () => { reason ||= B.stallReason ?? ''; return !!B.request?.tech && B.request.tech.zone; });
  const incB = s.orch.find(`fail:${B.id}`), stepB = incB?.steps.find((x) => /정비 지연 사유/.test(x.text));
  check('정비 인력 없음 → 지연 사유 기록 후 다른 Zone 지원', /배정할 정비 인력 없음/.test(reason) && !!stepB && !!B.request?.tech?.zone, `${reason.slice(0, 40)} … → ${B.request?.tech?.id ?? '미배정'}`);
  // 전체 비상정지 중 고장 → 수리 멈춤 사유 · 해제 뒤 '지연 해소'
  const C = s.processing.find((x) => x.state !== 'DOWN' && x.state !== 'MAINT' && !x.standby && !x.request);
  s.fail(C); run(s, ag, 40, () => C.techOnSite); s.cmd.estopAll = true; run(s, ag, 12); const r1 = C.stallReason; s.cmd.estopAll = false; run(s, ag, 3);
  check('비상정지 중 수리 멈춤 사유 · 해제 뒤 지연 해소 기록', /비상정지/.test(r1 ?? '') && !C.stallReason && !!s.orch.find(`fail:${C.id}`)?.steps.some((x) => /지연 해소/.test(x.text)), r1 ?? '사유 없음');
}
console.log('== 선택 Zone 이벤트 주입 → 그 Zone 오케스트레이터 대응 (피지컬AI)');
{ const s = new Simulation('dark', 6, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  run(s, ag, 120);
  const inj = {};
  for (const z of ZK) { const c = s.zoneCells.find((x) => x.zone === z && x.state === 'OK'); s.injectFault(c); inj[z] = { fault: s.orch.find(`fail:${c.id}`), ev: s.injectZoneEvent(z, 'leak'), sup: s.disruptZoneSupply(z, 600) }; }
  run(s, ag, 1200);
  for (const z of ZK) {
    const L = [inj[z].fault, inj[z].ev?.inc, inj[z].sup].filter(Boolean), lab = z === 'flex' ? '유연생산' : '적응가공';   // 주입한 세 건 (그사이 저절로 난 고장은 제외)
    const named = L.every((i) => i.steps.some((x) => x.lane === 'orch' && x.text.includes(`${lab} `)));
    check(`${lab}: 설비 고장 · 현장 이벤트 · 자재 공급 차질 → ${lab} 오케스트레이터가 판단·명령하고 20분 안에 해결`, new Set(L.map((i) => i.type)).size === 3 && named && L.every((i) => i.status === 'resolved'), L.map((i) => `${i.type}:${i.status}`).join(' · '));
  }
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
  check('투입구 키트 → 물류 휴머노이드가 확장 선반에서 가져와 채움 (유연생산 · 적응가공)', done && ZK.every((z) => s.whZone[z].parts < parts0[z]), ZK.map((z) => `${z} 키트 ${s.zoneKits[z]} · 선반 ${parts0[z]}→${s.whZone[z].parts}`).join(' · '));
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
