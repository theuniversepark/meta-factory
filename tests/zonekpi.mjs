// Zone 운영 분석 검증 (js/zonekpi.js · js/zonedash.js · js/datahub.js unsZoneKpi) — OEE(ISO 22400-2) 계산식 · 6대 손실 파레토 · 관리도 상수·관리 한계·
// Western Electric 규칙 · 공정능력 · 상관계수 · 확장 Zone 측정 모델(건강도·공구 마모 → 품질 특성 · NG는 규격 밖) · 정밀조립 실제 시뮬레이션 · 대시보드 발행 메시지. 실행: npm test
import { zoneLine } from '../js/line.js';
import { Simulation } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { ZoneKpi, controlChart, westernElectric, pareto, pearson, topPairs, designUph, QSPEC, LOSS, interpretControl, interpretScatter } from '../js/zonekpi.js';
import { zoneDashHTML, zdState } from '../js/zonedash.js';
import { unsZoneKpi } from '../js/datahub.js';
import { EXTRA_ZONES } from '../js/zonedefs.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

console.log('== 통계 함수');
{
  const p = pareto([{ key: 'a', v: 10 }, { key: 'b', v: 30 }, { key: 'c', v: 0 }, { key: 'd', v: 60 }]);
  check('파레토 — 큰 순 · 0 제외 · 누적 % 단조 증가 → 100%', p.map((x) => x.key).join() === 'd,b,a' && near(p[0].cum, 0.6) && near(p[1].cum, 0.9) && near(p.at(-1).cum, 1));
  const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), r2 = pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), r0 = pearson([1, 1, 1], [1, 2, 3]);
  check('피어슨 상관 — 완전 양·음 상관 ±1 · 회귀 기울기 · 분산 0이면 null', near(r.r, 1) && near(r.b, 2) && near(r.a, 0) && near(r2.r, -1) && r0.r === null);
  // X̄-R: 부분군 5 · 정규분포 평균 10 σ 1 → 관리 한계 ≈ 10 ± 3/√5 · R̄ ≈ d2σ(2.326)
  const v = Array.from({ length: 500 }, () => 10 + gauss()), c = controlChart(v, { n: 5, lsl: 7, usl: 13, maxPts: 100 });
  check('X̄-R (부분군 5) — 표본 40개 이상이면 X̄-R · 최근 100군', c.type === 'xbar-r' && c.points.length === 100 && c.n === 5);
  check('X̄-R 관리 한계 = X̄̄ ± A2·R̄ (A2 0.577) · R 상한 = D4·R̄ (2.114) · σ = R̄/d2', near(c.ucl - c.cl, 0.577 * c.rcl, 1e-9) && near(c.rucl, 2.114 * c.rcl, 1e-9) && near(c.sigma, c.rcl / 2.326, 1e-9) && Math.abs(c.cl - 10) < 0.2 && Math.abs(c.sigma - 1) < 0.15, `CL ${c.cl.toFixed(3)} · σ ${c.sigma.toFixed(3)}`);
  check('공정능력 Cp ≈ (13−7)/6σ ≈ 1 · Cpk ≤ Cp', Math.abs(c.cp - 1) < 0.15 && c.cpk <= c.cp + 1e-9, `Cp ${c.cp.toFixed(2)} · Cpk ${c.cpk.toFixed(2)}`);
  const im = controlChart([5, 6, 5, 7, 6, 5, 6, 7, 6, 5], { lsl: 0, usl: 10 });
  check('표본이 적으면(8 ~ 39개) I-MR · 한계 = 평균 ± 2.66·MR̄', im.type === 'i-mr' && near(im.ucl - im.cl, 2.66 * im.rcl, 1e-9) && near(im.rucl, 3.267 * im.rcl, 1e-9));
  check('표본 8개 미만이면 그리지 않음', controlChart([1, 2, 3]).type === 'none');
  const rules = (xs) => new Set(westernElectric(xs, 0, 1).map((x) => x.rule));
  check('Western Electric — 규칙 1(3σ 밖) · 2(3점 중 2점 2σ 밖) · 3(5점 중 4점 1σ 밖) · 4(8점 같은 쪽)', rules([0, 0, 3.5]).has(1) && rules([0, 2.5, 0.2, 2.6]).has(2) && rules([0, 1.5, 1.2, 0.3, 1.4, 1.6]).has(3) && rules([0.2, 0.3, 0.1, 0.5, 0.2, 0.4, 0.3, 0.1]).has(4) && rules([0.5, -0.5, 0.4, -0.3, 0.2, -0.6, 0.1, -0.2]).size === 0);
  const shifted = [...Array.from({ length: 100 }, () => 10 + gauss() * 0.5), ...Array.from({ length: 40 }, () => 11.2 + gauss() * 0.5)];
  const cs = controlChart(shifted, { n: 5, maxPts: 28 });
  check('평균 이동(+2.4σ) 뒤 구간 — 관리도 이상 감지', cs.viol.some((x) => x.i >= 18), cs.viol.map((x) => `${x.i}:${x.rule}`).slice(-4).join(' '));
}

console.log('== OEE 계산 (가짜 Zone — 숫자로 확인)');
{
  // 셀 1개: 계획 정비 100초 · 고장 60 · 준비 40 · 가동 600 · 자재 대기 150 · 막힘 50 = 1000초 · 처리 50개 × 기준 10초 · 양품 45 / 판정 50
  const sim = { time: 1000, xzones: { byKey: (k) => (k === 'flex' ? { Z: EXTRA_ZONES[0], cells: {}, stats: { good: { hood: 45 }, ng: 5, rework: 0 } } : null) }, zoneCell: () => ({ health: 90, x: 0, z: 0 }) };
  const K = new ZoneKpi(sim, 3), c = { id: 'C03', def: { label: '용접' }, state: 'BUSY' };
  const feed = (st, sec, extra = {}) => { for (let t = 0; t < sec; t += 1) K.acc('flex', { ...c, state: st, ...extra }, 1, { ideal: 10 }); };
  feed('MAINT', 100, { fault: 'MAINT' }); feed('DOWN', 60, { fault: 'DOWN' }); feed('BUSY', 40, { holdT: 5 }); feed('BUSY', 600); feed('IDLE', 150); feed('BLOCKED', 50);
  for (let i = 0; i < 50; i++) K.done('flex', 'C03');
  K.acc('flex', { id: 'C07', def: { label: '재작업', product: 'ng' }, state: 'IDLE' }, 500, { ideal: 120 });   // NG 재작업 셀 — Zone 합계에서 빠짐
  const o = K.oee('flex'), r = o.rows.find((x) => x.id === 'C03');
  check('셀 시간 분류 — 계획 정비·고장·준비·가동·자재 대기·막힘', r.t.pm === 100 && r.t.down === 60 && r.t.setup === 40 && r.t.busy === 600 && r.t.idle === 150 && r.t.blocked === 50, JSON.stringify(r.t));
  check('가동률 A = (900 − 60 − 40) / 900 · 성능 P = 50 × 10 / 800 · 품질 Q = 45 / 50', near(o.A, 800 / 900) && near(o.P, 500 / 800) && near(o.Q, 0.9) && near(o.OEE, (800 / 900) * (500 / 800) * 0.9), `A ${o.A.toFixed(3)} · P ${o.P.toFixed(3)} · Q ${o.Q} · OEE ${o.OEE.toFixed(3)}`);
  check('NG 재작업 셀은 표에 보이되 Zone 합계·손실에서 제외', o.rows.find((x) => x.id === 'C07')?.standby === true && near(o.A, 800 / 900));
  const L = K.lossPareto('flex', o), m = Object.fromEntries(L.map((x) => [x.key, x.v]));
  check('손실 파레토(분) — 자재 대기 150초 · 속도 저하(가동 600 − 50×10) 100초 · 고장 60 · 막힘 50 · 불량 5개×10초 · 준비 40', near(m.idle, 2.5) && near(m.speed, 100 / 60) && near(m.down, 1) && near(m.blocked, 50 / 60) && near(m.defect, 50 / 60) && near(m.setup, 40 / 60) && L[0].key === 'idle' && near(L.at(-1).cum, 1));
  check('손실 6대 손실 분류 라벨', L.every((x) => LOSS[x.key]?.six));
  K.acc('flex', { ...c, state: 'BUSY' }, 10, { held: true }); K.stopAll('flex', [{ ...c, state: 'BUSY' }], 5);
  check('운영자 셀 정지 · Zone 정지 → 운영 정지(가동률 손실)', K.cells.flex.C03.t.stop === 15);
  check('설계 UPH — 공용 셀 중 가장 느린 셀 · 제품별 전용 라인 합 중 작은 쪽', designUph(EXTRA_ZONES[0]) === Math.round(3600 / 109) && designUph(EXTRA_ZONES[1]) === Math.round(Math.min(3600 / 10, 3600 / 16 + 3600 / 18)), `유연생산 ${designUph(EXTRA_ZONES[0])} · 적응가공 ${designUph(EXTRA_ZONES[1])}`);
}

console.log('== 확장 Zone 측정 모델 (건강도·공구 마모 → 품질 특성)');
{
  const H = { C02: 95, C03: 95, C05: 95 }, sim = { time: 0, zoneCell: (z, id) => ({ health: H[id] ?? 95, x: 0, z: 0 }), trace: null };
  const K = new ZoneKpi(sim, 11);
  for (let i = 0; i < 300; i++) { H.C03 = 50 + (i % 50); H.C05 = 50 + ((i * 7) % 50); K.flexUnit({ id: `F${i}`, product: 'hood' }, i % 15 === 0); }
  const U = K.units.flex, ok = U.filter((u) => !u.ng), ng = U.filter((u) => u.ng), S = QSPEC.flex;
  const rf = pearson(ok.map((u) => u.x.C03_health), ok.map((u) => u.y.flush)).r, rg = pearson(ok.map((u) => u.x.C05_health), ok.map((u) => u.y.gap)).r;
  check('유연생산 — 용접(C03) 건강도↓ → 단차↑ · 헤밍(C05) 건강도↓ → 갭↑ (음의 상관)', rf < -0.3 && rg < -0.3, `r(C03, 단차) ${rf.toFixed(2)} · r(C05, 갭) ${rg.toFixed(2)}`);
  check('유연생산 NG — 판정한 특성이 규격 밖 또는 외관 결함 · 유형 기록', ng.every((u) => u.kind && (u.kind.startsWith('외관') || u.y.flush > S.flush.usl || u.y.gap > S.gap.usl || u.y.gap < S.gap.lsl)) && Object.values(K.ngKinds.flex).reduce((a, b) => a + b, 0) === ng.length, Object.entries(K.ngKinds.flex).map(([k, v]) => `${k} ${v}`).join(' · '));
  check('유연생산 양품 — 대부분 규격 안 (99% 이상)', ok.filter((u) => u.y.gap <= S.gap.usl && u.y.gap >= S.gap.lsl && Math.abs(u.y.flush) <= S.flush.usl).length / ok.length > 0.99);
  const tp = topPairs(U);
  check('상관 상위 쌍 — 단차·갭과 해당 셀 건강도가 위쪽', tp.slice(0, 3).some((p) => p.x === 'C03_health' && p.y === 'flush') && tp.slice(0, 3).some((p) => p.x === 'C05_health' && p.y === 'gap'), tp.slice(0, 3).map((p) => `${p.x}~${p.y} ${p.r.toFixed(2)}`).join(' | '));
  for (let i = 0; i < 300; i++) { const it = { id: `A${i}`, product: 'hblock', qx: { mill: { cell: 'HB_MILL', wear: (i % 60) / 60, vb: 50 + i % 60 * 4, vib: 1 + (i % 60) / 30, load: 50, temp: 35, health: 90 } } }; K.adaptUnit(it, i % 25 === 0); }
  const A = K.units.adapt, aok = A.filter((u) => !u.ng), ra = pearson(aok.map((u) => u.x.wear), aok.map((u) => u.y.bore)).r;
  check('적응가공 — 공구 마모↑ → 보어 직경 편차↑ (강한 양의 상관) · 리워크는 규격 밖', ra > 0.6 && A.filter((u) => u.ng).every((u) => u.y.bore > 15 || u.y.pos > 20 || u.kind.startsWith('공구')), `r(마모, 보어) ${ra.toFixed(2)}`);
  for (let i = 0; i < 100; i++) K.inspUnit({ id: `S${i}`, product: 'hood', rechecked: i % 9 === 0 }, i % 20 === 0 ? 'ng' : 'ok', 'OINS', '유연생산', '후드');
  const I = K.units.insp;
  check('정밀검사 — NG 측정 편차 |dev| > 100% · 양품 92% 이내 · NG 유형 = 시료 Zone·제품', I.filter((u) => u.ng).every((u) => Math.abs(u.y.dev) > 100) && I.filter((u) => !u.ng).every((u) => Math.abs(u.y.dev) <= 92) && K.ngKinds.insp['유연생산 후드'] === 5);
  const before = K.units.flex.length; for (let i = 0; i < 400; i++) K.flexUnit({ id: `G${i}`, product: 'door' }, false);
  check('품질 표본 최근 600개만 보관', K.units.flex.length === 600 && before === 300);
}

console.log('== 정밀조립 실제 시뮬레이션 (자동화 · 1시간)');
const s = new Simulation('smart', 4, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
for (let t = 0; t < 3600; t += 0.1) { s.step(0.1); ag.update(0.1); }
const K = s.zkpi, o = K.oee('main'), k = s.kpi();
check('정밀조립 OEE = KPI 화면 라인 OEE (A·P·Q 같은 값)', near(o.OEE, k.A * k.P * k.Q, 1e-9) && near(o.A, k.A) && near(o.Q, k.Q), `OEE ${(o.OEE * 100).toFixed(1)}%`);
check('셀 행 6개 (예비 제외) · 시간 합 = 경과 시간', o.rows.length === s.processing.filter((x) => !x.standby).length && o.rows.every((r) => near(r.tot, s.time, 1)));
K.collectMain(); const U = K.units.main;
check('품질 표본 = 체결 검사 마친 제품 · 제품별 품질 특성(도어트림 나사 · e-axle 볼트 규격 따로)', U.length > 150 && U.every((u) => (u.product === 'eaxle' ? 'ea_torque' in u.y : 'dt_torque' in u.y)) && !U.some((u) => 'ea_torque' in u.y && 'dt_torque' in u.y), `${U.length}개`);
check('검사 셀 자신의 토크·각도는 공정 변수(x)에 넣지 않음', U.every((u) => !Object.keys(u.x).some((x) => /_FAST_(torque|angle)$/.test(x))));
const cdt = controlChart(U.map((u) => u.y.dt_torque), { lsl: QSPEC.main.dt_torque.lsl, usl: QSPEC.main.dt_torque.usl });
check('도어트림 토크 관리도 — 중심선이 규격(4.0 ~ 5.0 N·m) 안', cdt.type !== 'none' && cdt.cl > 4 && cdt.cl < 5, `${cdt.type} CL ${cdt.cl?.toFixed(3)} · Cpk ${cdt.cpk?.toFixed(2)}`);
const ngp = K.ngPareto('main');
check('NG 유형 파레토 합 = 불량 사례 수 + 유출', ngp.reduce((a, x) => a + x.v, 0) === s.trace.cases.length + s.trace.stats.escaped, ngp.map((x) => `${x.label} ${x.v}`).join(' · '));
const pr = K.progress('main');
check('진행률 — 교대 계획(설계 UPH) · 현재 오더 · 경과 시간 기대치', pr.target > 0 && pr.done === s.stats.good && near(pr.expect, 3600 / 28800, 1e-3) && pr.order?.target === 100);
check('추세 기록 30초마다', K.hist.length >= 100 && K.hist.every((h) => h.main && Number.isFinite(h.main.OEE)));
for (const tab of ['live', 'oee', 'qa']) { zdState.tab = tab; zdState.zone = 'main'; const h = zoneDashHTML(s); check(`Zone 대시보드 「${tab}」 — 그려짐 · NaN/undefined 없음 · SVG 차트`, h.length > 5000 && !/NaN|undefined|Infinity/.test(h.replace(/<[^>]+>/g, ' ')) && /<svg/.test(h)); }
const M = unsZoneKpi(s), oe = M.filter((m) => m.topic === 'metafactory/oee/v1/main'), q = M.filter((m) => m.topic === 'metafactory/quality/v1/main');
const op = JSON.parse(oe[0].payload), qp = q.map((m) => JSON.parse(m.payload));
check('발행 — metafactory/oee/v1/main 1건 (oee·a·p·q·진행률·손실 7종·계획 정비)', oe.length === 1 && ['oee', 'a', 'p', 'q', 'progress', 'pm_min', 'loss_down', 'loss_setup', 'loss_stop', 'loss_idle', 'loss_blocked', 'loss_speed', 'loss_defect'].every((x) => Number.isFinite(op[x])) && near(op.oee, o.OEE, 1e-3));
check('발행 — 품질 표본은 처음 호출 뒤 새로 판정된 것만 (평면 JSON · x_* · y_* · ng 0/1 · kind)', unsZoneKpi(s).filter((m) => m.topic.includes('/quality/')).length === 0 && qp.length === 0);
for (let t = 0; t < 600; t += 0.1) { s.step(0.1); ag.update(0.1); }
const q2 = unsZoneKpi(s).filter((m) => m.topic.includes('/quality/')).map((m) => JSON.parse(m.payload));
check('… 10분 더 돌린 뒤 새 표본 발행 · 키 형식', q2.length > 20 && q2.every((p) => p.zone === 'main' && [0, 1].includes(p.ng) && typeof p.kind === 'string' && Object.keys(p).some((x) => x.startsWith('x_')) && Object.keys(p).some((x) => x.startsWith('y_')) && Object.entries(p).every(([x, v]) => !/^[xy]_/.test(x) || Number.isFinite(v))), `${q2.length}건`);

console.log('== 그래프 해석 (관리도 · 산점도)');
{
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const SP = { label: '보어', unit: 'µm', lsl: -15, usl: 15 }, txt = (I) => JSON.stringify(I);
  const stable = Array.from({ length: 30 }, (_, i) => [0.6, -0.4, 1.1, -0.9, 0.2, -1.2, 0.8, -0.1, 0.4, -0.7][i % 10] * 2), Is = interpretControl(controlChart(stable, SP), stable, SP);
  check('안정 · 중심 맞음 · Cpk 높음 → good · 「관리 상태」 · 조치 = 현 조건 유지', Is.tone === 'good' && /관리 상태/.test(txt(Is)) && /현 조건 유지/.test(Is.acts.join()), Is.head);
  const shift = [...Array.from({ length: 20 }, () => gauss()), ...Array.from({ length: 10 }, () => 6 + gauss())], Ish = interpretControl(controlChart(shift, SP), shift, SP, { label: '공구 마모', r: 0.62 });
  check('후반 평균 이동 → 평균/추세 경고 · 공구·보정 이력 조치 · 원인 후보 변수', Ish.tone !== 'good' && Ish.items.some((i) => ['평균', '추세'].includes(i.k) && i.tone !== 'good') && /공구 교체/.test(Ish.acts.join()) && /공구 마모/.test(Ish.acts.join()), Ish.head);
  const off = Array.from({ length: 30 }, () => 9 + gauss()), Io = interpretControl(controlChart(off, SP), off, SP);
  check('중심 치우침(Cp ≫ Cpk) → USL 쪽 · 중심 조정 조치', /USL 쪽/.test(txt(Io)) && /중심 조정/.test(Io.acts.join()));
  check('표본 8개 미만 → 해석 없음', interpretControl(controlChart([1, 2, 3], SP), [1, 2, 3], SP) === null);
  const U2 = Array.from({ length: 40 }, (_, i) => { const w = 10 + i * 1.5, y = -10 + 0.4 * w + gauss() * 1.2; return { id: `S${i}`, x: { vb: w }, y: { bore: y }, ng: y > 15 }; });
  const Isc = interpretScatter(U2, 'vb', 'bore', { label: '마모 VB', unit: 'µm' }, SP);
  check('강한 양의 상관 → 유의 · 기울기 · 공차 대비 영향 · USL 도달 지점 · NG가 높은 쪽에 몰림', /강한 양\(\+\)/.test(txt(Isc)) && Isc.items.some((i) => i.k === '신뢰도' && i.tone === 'good') && Isc.items.some((i) => i.k === '한계 도달') && /높은 쪽에서 NG/.test(txt(Isc)) && /관리 기준/.test(Isc.acts.join()), Isc.head);
  const U3 = Array.from({ length: 40 }, (_, i) => ({ id: `R${i}`, x: { vb: rnd() * 50 }, y: { bore: gauss() * 3 }, ng: false }));
  const Iw = interpretScatter(U3, 'vb', 'bore', { label: '마모 VB', unit: 'µm' }, SP);
  check('무관한 변수 → 관계 약함 · 다른 변수 확인 조치 · 한계 도달 없음', /관계 약함/.test(Iw.head) && /상관표/.test(Iw.acts.join()) && !Iw.items.some((i) => i.k === '한계 도달'), Iw.head);
  zdState.tab = 'qa'; zdState.zone = 'main'; const hq = zoneDashHTML(s);
  check('품질·상관 탭 — 관리도·산점도 해석 상자 2개 · NaN/undefined 없음', (hq.match(/class="zd-ins /g) ?? []).length === 2 && /관리도 해석/.test(hq) && /산점도 해석/.test(hq) && !/NaN|undefined|Infinity/.test(hq.replace(/<[^>]+>/g, ' ')));
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
