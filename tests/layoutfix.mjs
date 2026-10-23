// 3D 간섭 배치 보완(2026-10-23) 확인 — 레거시 지게차 충전소 간격·후진 진입 · 미니로드 출고 지게차 자리 · 사족보행 점검 자리 · 헤밍셀 정비 자리
// (화면 형상이 있어야 하는 헤밍 로봇 경로 · AMMR 선반 왕복은 tools/check-sweeps.cjs 에서 진행률 전 구간을 훑어 검사)
import { zoneLine } from '../js/line.js';
import { Simulation, Mover, chgLoc, FORK, MINILOAD_OUTS, LOC, AISLE } from '../js/sim.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const seg = (p, a, b) => { const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)); return Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t); };

console.log('== 레거시 지게차 충전소');
{
  const F = [0, 1, 2].map((i) => chgLoc(i, 'forklift')), A = [0, 1, 2, 3].map((i) => chgLoc(i, 'agv'));
  // 옆(+x)을 보고 선 지게차의 포크 끝과 옆 자리 지게차 차체(반폭 0.6m) 사이 — 3.2m 간격이면 0.7m로 들어오는 지게차가 막혀 맴돌았다
  const gap = Math.min(...F.slice(1).map((c, i) => (c.x - 0.6) - (F[i].x + FORK.reach)));
  check('지게차 충전 자리 4.4m 간격 · 옆 자리 포크 끝까지 1.5m 넘게', Math.abs(F[1].x - F[0].x - 4.4) < 1e-9 && gap > 1.5, `여유 ${gap.toFixed(2)}m`);
  check('AGV 충전 자리는 그대로 (3.2m · 기둥 z 3.9)', Math.abs(A[1].x - A[0].x - 3.2) < 1e-9 && A.every((c) => c.post === 3.9));
  const s = new Simulation('traditional', 1, { line: zoneLine(), quiet: true });
  check('레거시 지게차 3대가 새 충전 자리에서 시작', s.vehicles.every((v, i) => v.home.x === F[i].x && v.home.z === F[i].z), s.vehicles.map((v) => `${v.id} ${v.home.x}`).join(' · '));
  // 후진 진입: 충전소 쪽 차로(z 8.3)에서 통로를 보고 선 뒤 뒤로 들어간다 — 포크가 충전 기둥(z 3.7) 쪽으로 가지 않음
  const v = new Mover('시험 지게차', 'forklift', { x: -30, z: AISLE.F - 0.7, aisle: 'F', name: '통로' }, 1.5);
  v.setTask('충전', [{ go: F[1] }]);
  const tr = [];
  for (let i = 0; i < 600 && v.steps.length; i++) { v.update(0.1); tr.push({ x: v.x, z: v.z, h: v.heading }); }
  const last = tr.filter((p) => Math.abs(p.x - F[1].x) < 1e-6 && p.z < AISLE.F - 0.7 - 1e-6);
  const tip = Math.min(...tr.map((p) => (Math.abs(p.x - F[1].x) < 0.5 ? p.z + Math.cos(p.h) * FORK.reach : 99)));
  check('충전 자리 도착 · 마지막 직선은 후진 (포크가 통로 쪽)', !v.steps.length && Math.hypot(v.x - F[1].x, v.z - F[1].z) < 1e-6 && last.length > 5 && last.every((p) => Math.abs(p.h) < 1e-6), `후진 ${last.length}스텝`);
  check('진입 중 포크 끝이 충전 기둥(z 3.7 + 0.15)에 닿지 않음', tip > F[1].post + 0.15, `포크 끝 최소 z ${tip.toFixed(2)}`);
}

console.log('== 미니로드 출고 — 유인 지게차 상차 자리');
{
  const outs = [...MINILOAD_OUTS.wh, ...MINILOAD_OUTS.x].filter((o) => o.agv);
  check('AGV 상차 자리마다 지게차 자리(fork) — 포크 끝이 컨베이어 끝 5cm 앞', outs.length === 3 && outs.every((o) => o.fork && Math.abs(o.fork.x - FORK.reach - o.end - 0.05) < 1e-9 && o.fork.z === o.z));
  const s = new Simulation('traditional', 1, { line: zoneLine(), quiet: true }), fk = s.vehicles[0];
  const [at, face] = s.whPick(fk), [atA, faceA] = s.whPick({ kind: 'agv' });
  check('지게차는 자재창고 출고를 컨베이어 쪽(−x)을 보고 · AGV는 기존 자리', at.x === MINILOAD_OUTS.wh[0].fork.x && at.z === LOC.WH.z && face === -Math.PI / 2 && atA === LOC.WH && faceA === null);
  s.dispatchSupply(fk);
  check('자재 공급 작업의 상차 단계(출고 대기 · 재고 대기 · 상차)가 지게차 자리 · 컨베이어 쪽', fk.steps[0].go.x === at.x && fk.steps.slice(1, 4).every((st) => ('wait' in st || st.until) && st.face === -Math.PI / 2));
}

console.log('== 사족보행 순찰 점검 자리 (자동화 · 피지컬AI)');
for (const mode of ['smart', 'dark']) {
  const s = new Simulation(mode, 1, { line: zoneLine(), quiet: true });
  const d = s.processing.map((st) => { const p = s.patrolSpot(st); return { id: st.id, d: Math.min(...s.conveyors.flatMap((c) => c.path.slice(1).map((q, i) => seg(p, c.path[i], q)))) }; });
  const min = d.reduce((a, b) => (b.d < a.d ? b : a));
  check(`${mode}: 점검 자리가 운반 AMR 길에서 1.2m 넘게 (분류셀 출구 비스듬한 길 포함)`, min.d > 1.2, `최소 ${min.id} ${min.d.toFixed(2)}m`);
}

console.log('== 헤밍셀 정비 자리 (프레스가 셀 판 뒤로 나온 만큼 더 뒤)');
{
  const s = new Simulation('smart', 1, { line: zoneLine(), quiet: true });
  const top = s.zoneCells.filter((c) => c.zone === 'flex' && c.svc.aisle === 'BB' && Math.abs(c.svc.x - c.x - 0.9) < 1e-9);
  const hem = top.find((c) => c.cellId === 'C05'), other = top.find((c) => c.cellId !== 'C05');
  check('C05 정비 자리만 0.55m 더 뒤 (뒤쪽 시설 통로 가장자리 안) · 점검 자리는 그대로', hem && other && Math.abs((hem.svc.z - hem.z) - (other.svc.z - other.z) + 0.55) < 1e-9 && hem.svc.z > AISLE.BB + 1.3 + 0.35 && Math.abs((hem.scan.z - hem.z) - (other.scan.z - other.z)) < 1e-9, hem && `C05 정비 z ${hem.svc.z.toFixed(2)} · 점검 z ${hem.scan.z.toFixed(2)}`);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
