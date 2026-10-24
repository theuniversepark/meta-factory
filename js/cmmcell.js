// 적응가공 ⑥ 초정밀 측정·리워크셀 — 항온 측정실(브리지형 CMM) · 리워크 머시닝센터 · 이송 6축 · 협동로봇/양팔 로봇: 공정 순서 · 측정 데이터 · 피지컬AI — DOM 없음 (헤드리스 시험 가능)
//  · 공정 순서(CMM_PLANS · 셀 진행률): 정상품 = 에어 블로·소재 온도 측정 → 이송(AMR → 측정실 고정 지그) → CMM 측정 → 합격 DataMatrix 각인 → 이송(측정실 → AMR)
//    리워크(셀 사이클 ×2 · zonedefs rework.mul): 1차 측정 NG → mc: 리워크 머시닝센터 재가공 → 재측정 / hand: AMR 지그로 돌려놓고 남쪽 로봇이 접촉 리워크(버·표면) → 재측정
//  · 피지컬AI(dark): ① 이송 6축 범용 파지(VLA — 손목 카메라로 제품·놓인 자세 인식 → 파지 자세 후보 중 선택 · 지그 핀 끼움 힘 제어)
//                    ② 양팔 로봇 접촉 리워크(한 손 고정 · 한 손 힘 제어 연마) ④ 온도 보정 AI(가공·세척 직후 소재 온도 → 20℃ 기준 치수, 식힘 대기 없음)
//    자동화(smart): ① 제품별 티칭 파지점 · 위치 제어 끼움 ② 협동로봇 디버링 툴 ④ 열팽창 계수식 보정(선형 — 소재 속 온도 차는 못 봄) / 레거시: 작업자 · 온도 보정 없음
//  · 데이터: 가공기 감시(js/machmon.js)와 같은 묶음 → 서버 저장 · 내장 MQTT(metafactory/cmm/v1/adapt/CMM) · 패킷 캡처
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const CMM_CELL = 'CMM';
export const CMM_TOPIC = `metafactory/cmm/v1/adapt/${CMM_CELL}`;
export const CMM_SPEC = {
  model: '브리지형 CMM · 항온 측정실 (20 ± 1℃)', asset: `ADP-${CMM_CELL}-CMM`, range: '1200 × 1000 × 800 mm', mpe: 'MPE_E 1.8 + L/300 µm', room: 20,
  // 소재: 열팽창계수(µm/m·K) · 대표 길이(mm — 보어 간 거리) · 셀 도착 온도 상승(평균·표준편차 ℃ — 유압블록은 60℃ 세척 직후, 리어커버는 선삭 직후)
  mat: { hblock: { name: '구상흑연주철 GCD450', alpha: 11.0, L: 620, heat: [8.5, 1.6] }, rcover: { name: '알루미늄 다이캐스팅 ADC12', alpha: 21.0, L: 430, heat: [5.0, 1.2] } },
  rwHand: 0.35,   // 리워크 중 접촉 리워크(버 잔존·표면) 비율 — 나머지는 치수 NG라 머시닝센터 재가공
};
export const CMM_SENSORS = [
  { key: 'room', label: '측정실 온도', unit: '°C', dev: 'Pt100 4점 (항온 측정실)', warn: { lo: 19.4, hi: 20.6 }, alarm: { lo: 19, hi: 21 } },
  { key: 'grad', label: '측정실 상하 온도차', unit: '°C/m', dev: 'Pt100 상·하', warn: { hi: 0.5 }, alarm: { hi: 1 } },
  { key: 'part', label: '소재 온도', unit: '°C', dev: '접촉 온도 프로브 (남쪽 로봇 손끝)' },
  { key: 'air', label: '공기 베어링 압력', unit: 'MPa', dev: '압력 트랜스미터 (CMM 공기 베어링)', warn: { lo: 0.42 }, alarm: { lo: 0.4 } },
  { key: 'vib', label: '정반 진동', unit: 'µm/s', dev: '가속도계 (화강암 정반)', warn: { hi: 50 }, alarm: { hi: 80 } },
  { key: 'force', label: '지그 끼움 힘', unit: 'N', dev: '6축 힘·토크 센서 (이송 6축 손목)', warn: { hi: 60 }, alarm: { hi: 90 } },
];

// 이송 6축 경로 (zones.js xferPose): [진행률, 자세, 그 구간 동안 소재 위치] — 자세 사이는 관절 보간 · 몸을 돌릴 때는 팔을 세워 접은 자세(tuck·)에서만
//  A: AMR 지그 (tuckA → overA → amr) · C: 측정실 고정 지그 (tuckC → midC → entC → cmm) · M: 리워크 머시닝센터 바이스 (tuckM → midM → entM → mc)
//  소재 위치: amr · hand(그리퍼) · cmm · mc — 집는 순간이 'hand' 구간의 시작
const legA = (t, s, put) => (put
  ? [[t, 'tuckA', 'hand'], [t + s, 'overA', 'hand'], [t + 2 * s, 'amr', 'amr'], [t + 3 * s, 'overA', 'amr'], [t + 4 * s, 'tuckA', 'amr']]
  : [[t, 'tuckA', 'amr'], [t + s, 'overA', 'amr'], [t + 2 * s, 'amr', 'hand'], [t + 3 * s, 'overA', 'hand'], [t + 4 * s, 'tuckA', 'hand']]);
const legS = (X, t, s, put) => {
  const T = X === 'cmm' ? 'C' : 'M', a = put ? 'hand' : X, b = put ? X : 'hand';
  return [[t, `tuck${T}`, a], [t + s, `mid${T}`, a], [t + 2 * s, `ent${T}`, a], [t + 3 * s, X, b], [t + 4 * s, `ent${T}`, b], [t + 5 * s, `mid${T}`, b], [t + 6 * s, `tuck${T}`, b]];
};
// 셀 진행률 구간: blow(에어 블로·온도 측정 — 남쪽 로봇) · meas(CMM 측정 — 문 닫힘) · mark(합격 각인) · mc(머시닝센터 재가공) · hand(남쪽 로봇 접촉 리워크)
// steps: [역(A · C · M), 시작 진행률, 놓기(1)/집기(0)] — 문은 로봇이 그 역에 드나드는 동안만 열림 (cmmDoors)
const PLAN = {
  ok: { s: 0.02, blow: [0.02, 0.13], steps: [['A', 0.14, 0], ['C', 0.25, 1], ['C', 0.76, 0], ['A', 0.91, 1]], meas: [[0.39, 0.7]], mark: [0.7, 0.745] },
  mc: { s: 0.01, blow: [0.01, 0.06], steps: [['A', 0.06, 0], ['C', 0.115, 1], ['C', 0.34, 0], ['M', 0.415, 1], ['M', 0.62, 0], ['C', 0.695, 1], ['C', 0.88, 0], ['A', 0.955, 1]], meas: [[0.19, 0.33], [0.77, 0.845]], mark: [0.845, 0.87], mc: [0.49, 0.61] },
  hand: { s: 0.01, blow: [0.01, 0.06], steps: [['A', 0.06, 0], ['C', 0.115, 1], ['C', 0.34, 0], ['A', 0.415, 1], ['A', 0.63, 0], ['C', 0.685, 1], ['C', 0.875, 0], ['A', 0.95, 1]], meas: [[0.19, 0.33], [0.76, 0.84]], mark: [0.84, 0.865], hand: [0.465, 0.62] },
};
const DOOR_LEAD = 0.012;   // 문: 접은 자세에서 내려오기 0.012 전에 열리기 시작(0.01에 다 열림) · 다시 접은 뒤 0.012에 다 닫힘
function build(P) {
  const seq = [[0, 'tuckA', 'amr']];
  for (const [st, t, put] of P.steps) seq.push(...(st === 'A' ? legA(t, P.s, put) : legS(st === 'C' ? 'cmm' : 'mc', t, P.s, put)));
  seq.push([1, 'tuckA', 'amr']);
  const doors = { cmm: [], mc: [] };
  for (const [st, t] of P.steps) if (st !== 'A') doors[st === 'C' ? 'cmm' : 'mc'].push([t - DOOR_LEAD, t + 6 * P.s + DOOR_LEAD]);
  // 브리지가 지그 위에 있는 구간 (측정 · 이어지는 각인을 한 구간으로)
  const bridge = [...P.meas, P.mark].sort((a, b) => a[0] - b[0]).reduce((o, w) => { const l = o.at(-1); if (l && w[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], w[1]); else o.push([...w]); return o; }, []);
  return { ...P, seq, doors, bridge };
}
export const CMM_PLANS = Object.fromEntries(Object.entries(PLAN).map(([k, P]) => [k, build(P)]));
export const cmmPlan = (item) => CMM_PLANS[item?.cmm?.kind ?? (item?.rework ? 'mc' : 'ok')];
export const cmmDoorK = (q, R) => Math.max(0, ...R.map(([a, b]) => Math.min(1, (q - a) / 0.01, (b - q) / 0.01)));
const inAny = (p, R) => R.some(([a, b]) => p >= a && p < b);
// 진행률 p의 셀 단계 — 정보 창 · 센서값 · 게이트 표시판
export function cmmPhase(P, p) {
  if (!P) return null;
  if (inAny(p, [P.blow])) return 'blow';
  if (inAny(p, P.meas)) return P.meas.length > 1 && p >= P.meas[1][0] ? 'remeas' : 'meas';
  if (P.mark && inAny(p, [P.mark])) return 'mark';
  if (P.mc && inAny(p, [P.mc])) return 'mc';
  if (P.hand && inAny(p, [P.hand])) return 'hand';
  return p < P.meas[0][0] ? 'load' : p >= P.mark[1] ? 'unload' : 'move';
}
export const CMM_PHASE_KO = { blow: '에어 블로·소재 온도 측정', load: '이송 6축 → 측정실 지그', meas: 'CMM 측정', remeas: '리워크 후 재측정', mark: '합격 · DataMatrix 각인', mc: '리워크 머시닝센터 재가공', hand: '접촉 리워크 (버·표면)', move: '이송 6축 이동', unload: '측정실 → AMR 지그' };
// 측정 브리지가 소재 위에 있어야 하는 구간 (측정·각인) — 그 밖은 서쪽 끝으로 비킨다 (이송 6축이 측정실에 드나듦)
export const cmmBridgeOn = (P, p) => !!P && inAny(p, P.bridge);

export class CmmCellMonitor {
  constructor(sim) {
    this.sim = sim; this.rnd = mulberry(20261025); this.acc = 0; this.seq = 0;
    this.latest = {}; this.levels = {}; this.hist = []; this.records = []; this.cur = null;
    this.stats = { parts: 0, rework: 0, hand: 0, mc: 0, comp: 0, vla: 0, forceWarn: 0 };
    sim.cmm = this;
  }
  get on() { return this.sim.mode?.key !== 'traditional'; }   // 레거시: 센서·데이터 수집 없음
  get ai() { return this.sim.mode?.key === 'dark'; }
  cell() { return this.sim.xzones?.byKey?.('adapt')?.cells?.[CMM_CELL] ?? null; }
  g() { const u = 1 - this.rnd(), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 셀 시작(zones.js): 리워크 종류 · 소재 온도 · 온도 보정 · 파지 계획 · 지그 끼움 힘을 정한다 (셀 시간은 zones.js가 정함 — 리워크 ×2)
  plan(item) {
    const S = CMM_SPEC, M = S.mat[item.product] ?? S.mat.hblock, mode = this.sim.mode?.key ?? 'smart';
    const kind = item.rework ? (this.rnd() < S.rwHand ? 'hand' : 'mc') : 'ok';
    const dT = Math.max(0.8, M.heat[0] + M.heat[1] * this.g()), temp = S.room + dT, raw = r2(M.alpha * (M.L / 1000) * dT, 1);   // 열팽창 치수 오차 (µm)
    // 남은 오차: AI(소재 표면·속 온도 차 · 형상별 열 모델) ≈ 0.4µm · 선형 계수식 ≈ 8% (속이 아직 따뜻함) · 레거시 보정 없음
    const residual = mode === 'dark' ? 0.3 + Math.abs(this.g()) * 0.25 : mode === 'smart' ? raw * (0.06 + this.rnd() * 0.04) : raw;
    const grasp = mode === 'dark'
      ? { method: 'VLA', candidates: 6 + Math.floor(this.rnd() * 7), conf: r2(0.93 + this.rnd() * 0.06, 3), pose: item.product === 'rcover' ? '플랜지 양쪽 · 보어 축 수직' : '긴 변 양쪽 · 교차홀 피함' }
      : mode === 'smart' ? { method: 'teach', candidates: 1, conf: 1, pose: '티칭 파지점 (제품별 고정)' } : { method: 'manual', candidates: 0, conf: null, pose: '작업자' };
    const force = mode === 'dark' ? 16 + Math.abs(this.g()) * 6 : mode === 'smart' ? 34 + Math.abs(this.g()) * 14 : null;   // 지그 핀 끼움 최대 힘 (N): 힘 제어는 낮고 고르게 · 위치 제어는 핀에 걸리며 튐
    item.cmm = { kind, temp: r2(temp, 2), dT: r2(dT, 2), raw, residual: r2(residual, 2), comp: mode !== 'traditional', grasp, force: force == null ? null : r2(force, 1) };
    this.cur = { id: item.serial ?? item.wip ?? item.id, product: item.product, ...item.cmm };
    return item.cmm;
  }
  // 셀 완료(zones.js): 기록 · 품질 표본 값(zonekpi adaptUnit) · 데이터
  done(item) {
    const m = item.cmm; if (!m) return null;
    const S = CMM_SPEC, sim = this.sim;
    this.stats.parts++; if (m.kind !== 'ok') { this.stats.rework++; this.stats[m.kind]++; }
    if (m.comp) this.stats.comp++; if (m.grasp.method === 'VLA') this.stats.vla++; if ((m.force ?? 0) >= 60) this.stats.forceWarn++;
    const rec = { id: `CMM-${String(++this.seq).padStart(5, '0')}`, t: r2(sim.time, 1), asset: S.asset, part: item.serial ?? item.wip ?? item.id, product: item.product,
      result: m.kind === 'ok' ? 'OK' : 'OK (리워크 후 재측정)', rework: m.kind === 'ok' ? null : m.kind, partTemp_C: m.temp, thermalErr_um: m.raw, residual_um: m.residual, comp: m.comp,
      grasp: m.grasp.method, graspConf: m.grasp.conf, insertForce_N: m.force, mat: (S.mat[item.product] ?? S.mat.hblock).name };
    this.records.unshift(rec); if (this.records.length > 60) this.records.pop();
    (item.qx ??= {}).cmm = { temp: m.temp, residual: m.residual, force: m.force, rework: m.kind };   // 품질 표본 (zonekpi adaptUnit)
    if (this.on) this.emit({ topic: `${CMM_TOPIC}/part`, kind: 'record', ...rec });
    if (this.cur?.id === rec.part) this.cur = null;
    return rec;
  }
  // 측정값 (1초): 측정실 온도는 문이 열린 동안 조금 흔들림 · 소재 온도는 남쪽 로봇이 프로브를 댄 뒤 · 끼움 힘은 이송 6축이 지그에 놓을 때
  measure() {
    const c = this.cell(), busy = !!c && c.state === 'BUSY' && !c.fault && !c.halt, P = busy ? cmmPlan(c.item) : null, ph = busy ? cmmPhase(P, c.progress) : null, n = (s) => s * this.g();
    const doorOpen = busy && P.doors.cmm.some(([a, b]) => c.progress >= a && c.progress < b), m = busy ? c.item?.cmm : null;
    const v = {
      room: 20 + (doorOpen ? 0.25 : 0.05) + n(0.06), grad: 0.18 + (doorOpen ? 0.2 : 0) + Math.abs(n(0.04)),
      part: m && ph !== 'blow' ? m.temp - (ph === 'meas' || ph === 'remeas' ? 0.3 : 0) + n(0.05) : null,
      air: 0.5 + n(0.004), vib: 12 + (ph === 'mc' ? 18 : 0) + Math.abs(n(3)),
      force: m?.force != null && ph === 'load' ? m.force + n(1.5) : 0,
    };
    for (const k of Object.keys(v)) if (v[k] != null) v[k] = r2(Math.max(0, v[k]), k === 'air' ? 3 : 2);
    return { v, ph };
  }
  level(s, x) {
    if (x == null) return 'ok';
    const hit = (b) => b && ((b.hi != null && x >= b.hi) || (b.lo != null && x <= b.lo));
    return hit(s.alarm) ? 'alarm' : hit(s.warn) ? 'warn' : 'ok';
  }
  tick(dt) {
    this.acc += dt; if (this.acc < 1 - 1e-9) return; this.acc = 0;
    const { v, ph } = this.measure();
    this.latest = { t: this.sim.time, phase: ph, ...v };
    this.levels = Object.fromEntries(CMM_SENSORS.map((s) => [s.key, this.level(s, v[s.key])]));
    if (!this.on) return;
    if ((this.hist.at(-1)?.t ?? -9) <= this.sim.time - 2) { this.hist.push(this.latest); if (this.hist.length > 900) this.hist.shift(); }
    if ((this.lastQ ?? -9) <= this.sim.time - 5) { this.lastQ = this.sim.time; this.emit({ topic: CMM_TOPIC, kind: 'sample', asset: CMM_SPEC.asset, t: r2(this.sim.time, 1), phase: ph ?? 'idle', v, levels: this.levels }); }
  }
  snapshot() {
    const recent = this.records.slice(0, 20), avg = (k) => (recent.length ? r2(recent.reduce((a, r) => a + (r[k] ?? 0), 0) / recent.length, 2) : null);
    return { spec: CMM_SPEC, sensors: this.latest, levels: this.levels, cur: this.cur, ai: this.ai, on: this.on, stats: { ...this.stats }, records: recent,
      avg: { temp: avg('partTemp_C'), raw: avg('thermalErr_um'), residual: avg('residual_um'), force: avg('insertForce_N') } };
  }
  emit(item) { if (this.sim.machmon) this.sim.machmon.emit(item); else (this.outbox ??= []).push(item); }
}
