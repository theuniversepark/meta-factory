// Zone 운영 분석 — 종합 설비 효율(OEE, ISO 22400-2) · 6대 손실·NG 유형 파레토 · 관리도(X̄-R / I-MR · Western Electric 규칙 1~4) · 공정–품질 상관(산점도·회귀)
//  · 셀 시간 분류 (Zone 흐름이 dt마다 알려 줌): 가동 · 고장 · 계획 정비 · 준비·교체 · 운영 정지 · 자재 대기 · 출구 막힘
//    가동률 A = 가동 가능 시간 ÷ 계획 시간 (계획 시간 = 전체 − 계획 정비 · 가동 가능 = 계획 − 고장 − 준비·교체 − 운영 정지)
//    성능 P = 처리 수 × 기준 사이클 ÷ 가동 가능 시간 (자재 대기 · 출구 막힘 · 속도 저하가 여기서 빠진다)
//    품질 Q = 양품 ÷ 판정 수 (재작업·NG 포함)  →  OEE = A × P × Q
//  · 제품 1개 = 품질 표본 1건: 공정 변수(x) + 품질 특성(y) + NG 여부·유형 — 정밀조립은 제품 계보(js/trace.js), 확장 Zone은 측정 셀에서 이 모듈이 만든다
//    (측정 모델: 셀 건강도·공구 마모·환경 온도에 따라 치우치고 흩어진다 — 흐름의 난수와 따로 돌려 Zone 흐름을 바꾸지 않는다)
import { PARAM_SPEC } from './trace.js';

export const ZONES = ['main', 'flex', 'adapt', 'insp'];
export const ZONE_NAME = { main: '정밀조립Zone', flex: '유연생산Zone', adapt: '적응가공Zone', insp: '정밀검사Zone' };
// 6대 손실 (설비 고장 · 준비·조정 · 공전·순간정지 · 속도 저하 · 공정 불량 · 초기 수율) → 시뮬레이터 셀 상태로 나눔
export const LOSS = {
  down: { label: '설비 고장', six: '설비 고장', col: '#ff5a5a' },
  setup: { label: '준비·교체 (품목 전환·공구 교환)', six: '준비·조정', col: '#f5b82e' },
  stop: { label: '운영 정지 (비상·보호·셀 정지)', six: '준비·조정', col: '#d08cff' },
  idle: { label: '자재 대기 (공전)', six: '공전·순간정지', col: '#7fb8cc' },
  blocked: { label: '출구 막힘 (다음 공정 대기)', six: '공전·순간정지', col: '#5b8fd9' },
  speed: { label: '속도 저하 (사이클 지연·재작업 사이클)', six: '속도 저하', col: '#3fc1c9' },
  defect: { label: '불량·재작업', six: '공정 불량', col: '#ff8a5c' },
};
export const PLANNED = { pm: '계획 정비 (예지정비·교정 — OEE 계획 시간에서 제외)' };
const BUCKETS = ['busy', 'down', 'pm', 'setup', 'stop', 'idle', 'blocked'];
// 품질 특성 (y) 규격 — 관리도·산점도 기준선
export const QSPEC = {
  main: {   // 제품마다 체결 규격이 다르다 (도어트림 나사 체결 · e-axle 볼트 체결) — 섞으면 관리도가 의미 없음
    dt_torque: { label: '도어트림 체결 토크', unit: 'N·m', product: 'doortrim', ...lim(PARAM_SPEC.screw.torque) }, dt_angle: { label: '도어트림 체결 각도', unit: '°', product: 'doortrim', ...lim(PARAM_SPEC.screw.angle) },
    ea_torque: { label: 'e-axle 체결 토크', unit: 'N·m', product: 'eaxle', ...lim(PARAM_SPEC.fasten.torque) }, ea_angle: { label: 'e-axle 체결 각도', unit: '°', product: 'eaxle', ...lim(PARAM_SPEC.fasten.angle) },
  },
  flex: { gap: { label: '갭', unit: 'mm', lsl: 3.5, usl: 4.5 }, flush: { label: '단차', unit: 'mm', lsl: -0.5, usl: 0.5 } },
  adapt: { bore: { label: '보어 직경 편차', unit: 'µm', lsl: -15, usl: 15 }, pos: { label: '위치도', unit: 'µm', usl: 20 } },
  insp: { dev: { label: '측정 편차 (공차 대비)', unit: '%', lsl: -100, usl: 100 }, unc: { label: '측정 불확도', unit: '%', usl: 25 } },
};
function lim(s) { return { lsl: s.lsl, usl: s.usl }; }
const clampIn = (v, S) => { if (S.usl != null && v > S.usl) v = Math.max(S.lsl ?? -Infinity, 2 * S.usl - v); if (S.lsl != null && v < S.lsl) v = Math.min(S.usl ?? Infinity, 2 * S.lsl - v); return v; };   // 규격 밖으로 나간 만큼 안쪽으로 접는다 (경계에 몰리지 않게)
const r3 = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const STATE_BUCKET = { BUSY: 'busy', DOWN: 'down', MAINT: 'pm', IDLE: 'idle', STARVED: 'idle', NOPARTS: 'idle', NOAMR: 'idle', BLOCKED: 'blocked', DONE: 'blocked', FULL: 'blocked' };

export class ZoneKpi {
  constructor(sim, seed = 1) {
    this.sim = sim; sim.zkpi = this;
    let a = (seed * 2654435761) >>> 0 || 1;   // 측정 모델 전용 난수 (Zone 흐름 난수와 따로)
    this.r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.reset();
  }
  reset() {
    this.cells = { flex: {}, adapt: {}, insp: {} };   // 확장 Zone 셀: { name, t: {busy…}, done, ideal }
    this.units = { main: [], flex: [], adapt: [], insp: [] };   // 품질 표본 (최근 600개)
    this.xl = { main: {}, flex: {}, adapt: {}, insp: {} };   // 공정 변수 이름 · 단위
    this.ngKinds = { flex: {}, adapt: {}, insp: {} };
    this.hist = []; this.lastSnap = -Infinity; this.out = [];   // 추세 (30초마다) · 설비 대시보드로 보낼 품질 표본
    this.feedOn = false; this.mainSeen = new Set();
  }
  g() { const u = Math.max(1e-9, this.r()), v = this.r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ── 셀 시간 분류 (Zone 흐름 → 매 dt) ─────────────────
  // c: Zone 흐름 셀 (state · fault · holdT) · held: 운영자 셀 정지 · ideal: 기준 사이클(초)
  acc(zone, c, dt, { held = false, ideal = null, name = null } = {}) {
    const z = this.cells[zone]; if (!z || !(dt > 0)) return;
    const k = (z[c.id] ??= { id: c.id, name: name ?? c.def?.label ?? c.id, t: Object.fromEntries(BUCKETS.map((b) => [b, 0])), done: 0, ideal: ideal ?? 0, standby: c.def?.product === 'ng' });   // NG 재작업 셀은 대기가 정상 — Zone OEE 합계에서 뺀다
    if (ideal) k.ideal = ideal;
    const b = c.fault === 'DOWN' ? 'down' : c.fault === 'MAINT' ? 'pm' : held ? 'stop' : c.state === 'BUSY' && c.holdT > 0 ? 'setup' : STATE_BUCKET[c.state] ?? 'idle';
    k.t[b] += dt;
  }
  stopAll(zone, cells, dt) { for (const c of cells) this.acc(zone, { ...c, fault: c.fault, state: c.fault ? c.state : 'STOP' }, dt, { held: !c.fault }); }   // Zone 정지 (비상·보호·운영자)
  done(zone, id) { const k = this.cells[zone]?.[id]; if (k) k.done++; }

  // ── OEE ─────────────────
  // 셀 행: { id, name, t, done, ideal, A, P, Q?, OEE } · Zone: 시간 가중 A·P × Zone 품질 Q
  cellRows(zone) {
    const s = this.sim;
    if (zone === 'main') {
      const T = Math.max(1, s.time), m = s.mode;
      return (s.processing ?? []).filter((st) => !st.standby).map((st) => {
        const c = st.c, t = { busy: c.busy ?? 0, down: c.down ?? 0, pm: c.maint ?? 0, setup: 0, stop: c.stop ?? 0, idle: c.starved ?? 0, blocked: c.blocked ?? 0 };
        const known = Object.values(t).reduce((a, b) => a + b, 0); t.idle += Math.max(0, T - known);   // 상태를 따로 세지 않는 순간(대상물 출구 대기 등)은 공전으로
        return this.row(st.id, st.name, t, c.processed ?? 0, st.def.cycle * (m.cycleMul ?? 1));
      });
    }
    return Object.values(this.cells[zone] ?? {}).map((k) => ({ ...this.row(k.id, k.name, k.t, k.done, k.ideal), standby: k.standby }));
  }
  row(id, name, t, done, ideal) {
    const tot = BUCKETS.reduce((a, b) => a + t[b], 0), plan = tot - t.pm, run = Math.max(0, plan - t.down - t.setup - t.stop);
    const A = plan > 0 ? run / plan : 1, P = run > 0 ? Math.min(1, (done * ideal) / run) : 0;
    return { id, name, t: { ...t }, tot, plan, run, done, ideal, A, P, speedLoss: Math.max(0, t.busy - done * ideal) };
  }
  quality(zone) {
    const s = this.sim;
    if (zone === 'main') { const k = s.kpi(); return { good: k.good, judged: k.out + k.rejected, Q: k.Q, label: '체결 전수 검사 양품률' }; }
    const Z = s.xzones?.byKey?.(zone);
    if (zone === 'insp') { const S = s.xzones?.insp?.stats ?? {}; const judged = (S.done ?? 0) + (S.unc ?? 0); return { good: S.done ?? 0, judged, Q: judged ? (S.done ?? 0) / judged : 1, label: '1회 판정률 (재측정 제외)' }; }
    const good = Object.values(Z?.stats?.good ?? {}).reduce((a, b) => a + b, 0), bad = (Z?.stats?.ng ?? 0) + (zone === 'adapt' ? Z?.stats?.rework ?? 0 : 0);
    return { good, judged: good + bad, Q: good + bad ? good / (good + bad) : 1, label: zone === 'flex' ? '치수·외관 1회 합격률' : 'CMM 1회 합격률' };
  }
  oee(zone) {
    const rows = this.cellRows(zone), q = this.quality(zone), R = rows.filter((r) => !r.standby);
    const plan = R.reduce((a, r) => a + r.plan, 0), run = R.reduce((a, r) => a + r.run, 0), eff = R.reduce((a, r) => a + r.done * r.ideal, 0);
    let A = plan > 0 ? run / plan : 1, P = run > 0 ? Math.min(1, eff / run) : 0, Q = q.Q;
    if (zone === 'main') { const k = this.sim.kpi(); A = k.A; P = k.P; Q = k.Q; }   // 정밀조립은 라인 OEE (KPI 화면과 같은 값)
    for (const r of rows) r.Q = Q, r.OEE = r.A * r.P * Q;
    return { zone, A, P, Q, OEE: A * P * Q, rows, quality: q, ideal: Math.max(0, ...R.map((r) => r.ideal)) };
  }
  // 손실 파레토 (분) — 셀 합계 · 불량 손실 = (판정 − 양품) × Zone 기준 사이클(가장 긴 셀)
  lossPareto(zone, o = this.oee(zone)) {
    const v = { down: 0, setup: 0, stop: 0, idle: 0, blocked: 0, speed: 0, defect: 0 };
    for (const r of o.rows.filter((x) => !x.standby)) { v.down += r.t.down; v.setup += r.t.setup; v.stop += r.t.stop; v.idle += r.t.idle; v.blocked += r.t.blocked; v.speed += r.speedLoss; }
    v.defect = Math.max(0, o.quality.judged - o.quality.good) * o.ideal;
    return pareto(Object.entries(v).map(([k, x]) => ({ key: k, label: LOSS[k].label, six: LOSS[k].six, v: x / 60 })));
  }
  ngPareto(zone) {
    const s = this.sim, m = {};
    if (zone === 'main') {
      for (const c of s.trace?.cases ?? []) { const k = String(c.inspection?.mode ?? (c.kind === 'sample' ? '정밀검사 샘플 NG' : '기타')).split(' — ')[0].replace(/\s*\(.*\)$/, ''); m[k] = (m[k] ?? 0) + 1; }
      if (s.trace?.stats.escaped) m['유출 (검사 미검출 — 출하 후 발견)'] = s.trace.stats.escaped;
    } else Object.assign(m, this.ngKinds[zone] ?? {});
    return pareto(Object.entries(m).map(([label, v]) => ({ key: label, label, v })));
  }
  // 생산 진행률: 정밀조립 = 현재 오더 · 교대(8시간) 계획 · 확장 Zone = 교대 계획(설계 UPH 기준) · 정밀검사 = 샘플 처리율
  progress(zone) {
    const s = this.sim, shift = 8 * 3600, el = Math.min(1, s.time / shift);
    if (zone === 'insp') { const S = s.xzones?.insp?.stats ?? {}; return { label: '샘플 처리율', done: S.done ?? 0, target: S.samples ?? 0, pct: S.samples ? (S.done ?? 0) / S.samples : 0, expect: null }; }
    if (zone === 'main') {
      const o = s.fos?.order, R = o ? s.fos.main?.reconcile?.(o.id) : null, ideal = s.idealCycle || 30, target = Math.round(shift / ideal);
      return { label: '교대 계획 (설계 UPH 기준)', done: s.stats.good, target, pct: s.stats.good / target, expect: el, order: o ? { id: o.id, done: R?.good ?? 0, target: o.target, due: o.due } : null };
    }
    const Z = s.xzones?.byKey?.(zone), uph = designUph(Z?.Z, (id) => Z?.cells?.[id]?.cycle), good = Object.values(Z?.stats?.good ?? {}).reduce((a, b) => a + b, 0), target = Math.round((uph * shift) / 3600);
    return { label: '교대 계획 (설계 UPH 기준)', done: good, target, pct: target ? good / target : 0, expect: el, uph };
  }
  // 추세 (30초마다 — 대시보드 시계열 · 설비 대시보드 발행)
  tick() {
    const s = this.sim; if (s.time - this.lastSnap < 30) return; this.lastSnap = s.time;
    this.collectMain();
    const snap = { t: s.time };
    for (const z of ZONES) {
      if (z !== 'main' && !s.xzones?.byKey) continue;
      const o = this.oee(z), cells = z === 'main' ? s.processing.filter((x) => !x.standby) : s.zoneCells.filter((c) => c.zone === z);
      snap[z] = { A: o.A, P: o.P, Q: o.Q, OEE: o.OEE, h: Object.fromEntries(cells.map((c) => [c.cellId ?? c.id, Math.round(c.health)])) };
    }
    this.hist.push(snap); if (this.hist.length > 960) this.hist.shift();
  }

  // ── 품질 표본 ─────────────────
  push(zone, u) {
    const L = this.units[zone]; L.push(u); if (L.length > 600) L.shift();
    if (u.ng && zone !== 'main') this.ngKinds[zone][u.kind] = (this.ngKinds[zone][u.kind] ?? 0) + 1;
    if (this.feedOn) { this.out.push({ zone, ...u }); if (this.out.length > 2000) this.out.splice(0, this.out.length - 2000); }
  }
  drain() { return this.out.splice(0); }
  label(zone, key, label, unit = '') { this.xl[zone][key] ??= { label, unit }; }
  // 정밀조립: 제품 계보(셀별 공정 측정값·건강도·드리프트·환경)를 표본으로 — 체결 전수 검사 토크·각도가 품질 특성
  collectMain() {
    const T = this.sim.trace; if (!T) return;
    for (const r of T.recent) {
      if (r.status === 'wip' || !r.inspection || this.mainSeen.has(r.item)) continue;
      this.mainSeen.add(r.item); if (this.mainSeen.size > 5000) this.mainSeen = new Set([...this.mainSeen].slice(-2500));
      const x = {};
      for (const p of r.steps) {
        if (p.result != null) continue;   // 체결 전수 검사 셀 자신의 토크·각도는 품질 특성(y)
        for (const [k, v] of Object.entries(p.params ?? {})) if (Number.isFinite(v)) { x[`${p.id}_${k}`] = v; const S = Object.values(PARAM_SPEC).find((o) => o[k])?.[k]; this.label('main', `${p.id}_${k}`, `${p.name} ${S?.label ?? k}`, S?.unit ?? ''); }
        if (Number.isFinite(p.health)) { x[`${p.id}_health`] = p.health; this.label('main', `${p.id}_health`, `${p.name} 건강도`, '%'); }
        if (Number.isFinite(p.drift)) { x[`${p.id}_drift`] = p.drift; this.label('main', `${p.id}_drift`, `${p.name} 드리프트`, ''); }
      }
      const e = r.steps.at(-1)?.env; if (e) { for (const [k, lb, un] of [['temp', '환경 온도', '°C'], ['rh', '습도', '%'], ['vib', '바닥 진동', 'mm/s']]) if (Number.isFinite(e[k])) { x[`env_${k}`] = e[k]; this.label('main', `env_${k}`, lb, un); } }
      const ng = r.inspection.result === 'NG' || r.status === 'escaped';
      this.push('main', { t: r.tEnd ?? r.inspection.t, id: r.serial ?? r.wip, product: r.product, x, y: r.product === 'eaxle' ? { ea_torque: r.inspection.torque, ea_angle: r.inspection.angle } : { dt_torque: r.inspection.torque, dt_angle: r.inspection.angle }, ng, kind: ng ? String(r.inspection.mode ?? '유출').split(' — ')[0] : null });
    }
  }
  envAt(zone, cellId) { const zc = this.sim.zoneCell?.(zone, cellId); return zc ? this.sim.trace?.env.at(zc.x, zc.z) ?? null : null; }
  health(zone, cellId) { return this.sim.zoneCell?.(zone, cellId)?.health ?? 100; }
  // 유연생산 C06 치수·외관검사: 갭(헤밍 C05 건강도가 떨어지면 벌어짐) · 단차(용접 C03 건강도가 떨어지면 커짐) · 온도가 높으면 갭 약간 증가
  flexUnit(it, ng) {
    const h2 = this.health('flex', 'C02'), h3 = this.health('flex', 'C03'), h5 = this.health('flex', 'C05'), temp = this.envAt('flex', 'C06')?.temp ?? 22;
    const s3 = (100 - h3) / 40, s5 = (100 - h5) / 40, s2 = (100 - h2) / 40;
    let gap = 4.0 + 0.07 * this.g() * (1 + 0.5 * s5) + 0.12 * s5 + 0.02 * (temp - 22), flush = 0.06 * this.g() * (1 + 0.5 * s3) + 0.1 * s3 + 0.03 * s2, kind = null;
    if (ng) {
      const w = [['단차 초과 — 용접 변형', 1 + 2 * s3], ['갭 초과 — 헤밍 편차', 1 + 2 * s5], ['외관 — 스패터·실러 흘림', 0.6], ['안착 위치 편차 — 보정 오차', 0.4 + 1.5 * s2]], tot = w.reduce((a, b) => a + b[1], 0);
      let r = this.r() * tot; kind = w.find((x) => (r -= x[1]) < 0)?.[0] ?? w[0][0];
      if (kind.startsWith('단차')) flush = 0.52 + Math.abs(this.g()) * 0.12; else if (kind.startsWith('갭')) gap = 4.52 + Math.abs(this.g()) * 0.15; else if (kind.startsWith('안착')) { flush = 0.3 + Math.abs(this.g()) * 0.15; gap = 3.45 - Math.abs(this.g()) * 0.1; }
    }
    if (!ng) { gap = clampIn(gap, QSPEC.flex.gap); flush = clampIn(flush, QSPEC.flex.flush); }   // 양품 판정 = 측정값이 규격 안
    for (const [k, lb, un] of [['C02_health', 'C02 안착·보정 건강도', '%'], ['C03_health', 'C03 용접 건강도', '%'], ['C05_health', 'C05 헤밍 건강도', '%'], ['temp', '환경 온도', '°C']]) this.label('flex', k, lb, un);
    this.push('flex', { t: this.sim.time, id: it.serial ?? it.wip ?? it.id, product: it.product, x: { C02_health: r3(h2, 1), C03_health: r3(h3, 1), C05_health: r3(h5, 1), temp: r3(temp, 1) }, y: { gap: r3(gap), flush: r3(flush) }, ng, kind });
  }
  // 적응가공: 가공 셀 끝날 때 공구·주축 상태를 제품에 기록 → CMM에서 보어 편차(공구 마모)·위치도(셀 건강도·진동)
  adaptCtx(it, c) {
    if (c.def?.type !== 'mill5' && c.def?.type !== 'turn') return;
    const s = this.sim, T = s.fos?.adapt?.tools?.[c.id], L = s.machmon?.m?.[c.id]?.latest ?? {};
    (it.qx ??= {})[c.def.type === 'turn' ? 'turn' : 'mill'] = { cell: c.id, wear: T?.wear ?? 0, vb: L.toolVB ?? null, vib: L.vibration ?? null, load: L.spindleLoad ?? null, temp: L.bearingTemp ?? null, health: this.health('adapt', c.id) };
  }
  adaptUnit(it, rework) {
    const m = it.qx?.mill ?? {}, t = it.qx?.turn ?? null, wear = Math.max(m.wear ?? 0, t?.wear ?? 0), sev = (100 - (m.health ?? 100)) / 40, vib = m.vib ?? 1;
    let bore = 2.2 * this.g() + 14 * wear - 3 + (t ? 3 * (t.wear ?? 0) : 0), pos = Math.abs(3 * this.g()) + 4 + 7 * sev + 0.8 * Math.max(0, vib - 1), kind = null;
    if (rework) {
      kind = it.toolBreak ? '공구 파손 흔적 — 표면 결함' : this.r() < 0.55 + wear * 0.3 ? '보어 직경 초과 — 공구 마모' : '위치도 초과 — 셋업·진동';
      if (kind.startsWith('보어')) bore = 15.5 + Math.abs(this.g()) * 3; else if (kind.startsWith('위치도')) pos = 20.5 + Math.abs(this.g()) * 3;
    }
    if (!rework) { bore = clampIn(bore, QSPEC.adapt.bore); pos = clampIn(pos, QSPEC.adapt.pos); }
    for (const [k, lb, un] of [['wear', '공구 마모율', ''], ['vb', '공구 플랭크 마모 VB', 'µm'], ['vib', '주축 진동 RMS', 'mm/s'], ['load', '주축 부하', '%'], ['btemp', '베어링 온도', '°C'], ['health', '가공 셀 건강도', '%']]) this.label('adapt', k, lb, un);
    this.push('adapt', { t: this.sim.time, id: it.serial ?? it.wip ?? it.id, product: it.product, x: { wear: r3(wear), vb: r3(m.vb, 1), vib: r3(m.vib, 2), load: r3(m.load, 1), btemp: r3(m.temp, 1), health: r3(m.health, 1) }, y: { bore: r3(bore, 2), pos: r3(pos, 2) }, ng: !!rework, kind });
  }
  // 정밀검사: 샘플 최종 판정 — 측정 편차(공차 대비 %) · 측정 불확도(검사 셀 건강도·온도) · NG 유형 = 시료 Zone·제품
  inspUnit(it, res, cellId, zoneLabel, productLabel) {
    const h = this.health('insp', cellId), temp = this.envAt('insp', cellId)?.temp ?? 22, sev = (100 - h) / 40;
    const unc = 8 + 6 * sev + 1.5 * Math.abs(temp - 21) + Math.abs(this.g()) * 1.5;
    let dev = 28 * this.g() * (1 + 0.3 * sev); if (res === 'ng') dev = (this.r() < 0.5 ? -1 : 1) * (102 + Math.abs(this.g()) * 15); else dev = Math.max(-92, Math.min(92, dev));
    for (const [k, lb, un] of [['health', '검사 셀 건강도', '%'], ['temp', '환경 온도', '°C'], ['re', '재측정 여부', '']]) this.label('insp', k, lb, un);
    this.push('insp', { t: this.sim.time, id: it.id, product: it.product, x: { health: r3(h, 1), temp: r3(temp, 1), re: it.rechecked ? 1 : 0 }, y: { dev: r3(dev, 1), unc: r3(unc, 1) }, ng: res === 'ng', kind: res === 'ng' ? `${zoneLabel} ${productLabel}` : null });
  }
}

// 설계 UPH: 공용 셀 중 가장 느린 셀 vs 제품별 전용 라인 합 — 작은 쪽 (병렬 셀 대수는 Zone 정의의 실효 사이클을 쓴다)
export function designUph(Z, cyc = (id) => Z?.cells?.[id]?.cycle) {
  if (!Z) return 0;
  const shared = Object.keys(Z.cells).filter((id) => Z.cells[id].product === 'shared'), slow = Math.max(0, ...shared.map(cyc));
  const lines = Object.values(Z.routes).map((r) => Math.max(0, ...r.filter((id) => Z.cells[id].product !== 'shared').map(cyc)));
  const lineRate = lines.every((x) => x > 0) ? lines.reduce((a, c) => a + 3600 / c, 0) : Infinity;
  return Math.round(Math.min(slow ? 3600 / slow : Infinity, lineRate));
}

// ── 통계 함수 (화면·시험 공용) ─────────────────
export function pareto(items) {
  const L = items.filter((x) => x.v > 0).sort((a, b) => b.v - a.v), tot = L.reduce((a, b) => a + b.v, 0); let c = 0;
  return L.map((x) => ({ ...x, pct: tot ? x.v / tot : 0, cum: tot ? (c += x.v) / tot : 0 }));
}
const A2 = { 2: 1.88, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 };
const D3 = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223 };
const D4 = { 2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777 };
const D2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.97, 10: 3.078 };
// 관리도: 부분군 n개로 8군 이상이면 X̄-R, 아니면 I-MR (최근 maxPts 점) · 관리 한계는 창 안 전체로 · 규격(lsl·usl)이 있으면 Cp·Cpk
export function controlChart(vals, { n = 5, lsl = null, usl = null, maxPts = 25 } = {}) {
  const v = vals.filter(Number.isFinite);
  if (v.length < 8) return { type: 'none', n: v.length, points: [], viol: [] };
  if (v.length >= n * 8) {
    const groups = []; for (let i = Math.max(0, v.length - n * maxPts - ((v.length - n * maxPts) % n || 0)); i + n <= v.length; i += n) groups.push(v.slice(i, i + n));
    const G = groups.slice(-maxPts), xs = G.map((g) => g.reduce((a, b) => a + b, 0) / n), rs = G.map((g) => Math.max(...g) - Math.min(...g));
    const cl = xs.reduce((a, b) => a + b, 0) / xs.length, rbar = rs.reduce((a, b) => a + b, 0) / rs.length, sigmaX = (A2[n] * rbar) / 3, sigma = rbar / D2[n];
    const pts = xs.map((x, i) => ({ i, x, r: rs[i] }));
    return finish({ type: 'xbar-r', n, points: pts, cl, ucl: cl + A2[n] * rbar, lcl: cl - A2[n] * rbar, rcl: rbar, rucl: D4[n] * rbar, rlcl: D3[n] * rbar, sigmaX, sigma, mean: cl, count: v.length }, lsl, usl);
  }
  const w = v.slice(-maxPts * 2), mr = w.slice(1).map((x, i) => Math.abs(x - w[i])), mrbar = mr.reduce((a, b) => a + b, 0) / Math.max(1, mr.length), cl = w.reduce((a, b) => a + b, 0) / w.length, sigma = mrbar / 1.128;
  return finish({ type: 'i-mr', n: 1, points: w.map((x, i) => ({ i, x, r: i ? mr[i - 1] : null })), cl, ucl: cl + 2.66 * mrbar, lcl: cl - 2.66 * mrbar, rcl: mrbar, rucl: 3.267 * mrbar, rlcl: 0, sigmaX: sigma, sigma, mean: cl, count: v.length }, lsl, usl);
}
function finish(c, lsl, usl) {
  c.viol = westernElectric(c.points.map((p) => p.x), c.cl, c.sigmaX);
  for (const p of c.points) if (p.r != null && p.r > c.rucl + 1e-12) c.viol.push({ i: p.i, rule: 'R', text: '범위(R) 관리 한계 초과 — 산포 증가' });
  c.lsl = lsl; c.usl = usl;
  if (c.sigma > 0) { c.cp = lsl != null && usl != null ? (usl - lsl) / (6 * c.sigma) : null; c.cpk = Math.min(usl != null ? (usl - c.mean) / (3 * c.sigma) : Infinity, lsl != null ? (c.mean - lsl) / (3 * c.sigma) : Infinity); if (!Number.isFinite(c.cpk)) c.cpk = null; }
  return c;
}
// Western Electric 규칙 1~4 (중심선 cl · 점의 표준편차 s)
export function westernElectric(xs, cl, s) {
  const out = []; if (!(s > 0)) return out;
  const z = xs.map((x) => (x - cl) / s), side = (k) => Math.sign(z[k]);
  for (let i = 0; i < z.length; i++) {
    if (Math.abs(z[i]) > 3) out.push({ i, rule: 1, text: '1점이 3σ 관리 한계 밖' });
    if (i >= 2) { const w = [i - 2, i - 1, i]; for (const sd of [1, -1]) if (w.filter((k) => z[k] * sd > 2).length >= 2 && z[i] * sd > 2) out.push({ i, rule: 2, text: '연속 3점 중 2점이 같은 쪽 2σ 밖' }); }
    if (i >= 4) { const w = [i - 4, i - 3, i - 2, i - 1, i]; for (const sd of [1, -1]) if (w.filter((k) => z[k] * sd > 1).length >= 4 && z[i] * sd > 1) out.push({ i, rule: 3, text: '연속 5점 중 4점이 같은 쪽 1σ 밖' }); }
    if (i >= 7) { const sd = side(i); if (sd && [0, 1, 2, 3, 4, 5, 6, 7].every((d) => side(i - d) === sd)) out.push({ i, rule: 4, text: '연속 8점이 중심선 같은 쪽' }); }
  }
  return out;
}
export function pearson(xs, ys) {
  const P = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), n = P.length;
  if (n < 3) return { n, r: null };
  const mx = P.reduce((a, p) => a + p[0], 0) / n, my = P.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of P) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return { n, r: null };
  const b = sxy / sxx; return { n, r: sxy / Math.sqrt(sxx * syy), b, a: my - b * mx, mx, my };
}
// 공정 변수 × 품질 특성 상관 — |r| 큰 순 (표본 minN개 이상)
export function topPairs(units, { minN = 12 } = {}) {
  if (!units.length) return [];
  const xk = [...new Set(units.flatMap((u) => Object.keys(u.x)))], yk = [...new Set(units.flatMap((u) => Object.keys(u.y)))], out = [];
  for (const x of xk) for (const y of yk) { const p = pearson(units.map((u) => u.x[x]), units.map((u) => u.y[y])); if (p.r != null && p.n >= minN) out.push({ x, y, ...p }); }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}
