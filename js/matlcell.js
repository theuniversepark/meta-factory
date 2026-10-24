// 적응가공 ① 소재 식별·3D측정셀 — ID 판독 게이트 · 재질 분석(LIBS) · 3D 스캔 부스(턴테이블·저울·스캔 로봇) · 격리 랙 · 이송 6축: 공정 순서 · 측정 데이터 · 피지컬AI — DOM 없음 (헤드리스 시험 가능)
//  · 공정 순서(MATL_PLANS · 셀 진행률): 합격 = 게이트 ID 판독(팔레트 RFID · 주조 각인 DPM/OCR) → 남쪽 로봇 재질 분석 프로브 접촉 → 이송 6축이 스캔 부스 턴테이블에(무게 측정)
//    → 스캔 로봇 3D 스캔 → CAD 베스트핏 · 가공 여유 판정 → AMR 지그로 / 불합격(셀 시간 ×2): 1차 스캔 → 격리 랙에 내려놓고 같은 로트 예비 소재를 집어 → 다시 스캔 → AMR
//  · 피지컬AI(dark): ① 주조품 범용 파지(VLA · 힘 제어 끼움) ② 능동 스캔 경로(Next-Best-View — 빠진 면을 채우는 자세만, 반사면 노출 조정) ③ 주조 결함 AI(기공·균열·탕경계 이상 탐지)
//                    ④ 가공 여유 → 다음 가공셀 원점 보정·첫 절입량 전달(헛절삭 줄임 · 주물 표피 과부하 줄임) ⑤ 주조 각인 OCR · LIBS 스펙트럼 재질 판별 AI ⑥ 양팔 로봇 접촉 측정(한 손 고정 · 한 손 일정 힘 프로브)
//    자동화(smart): 티칭 파지 · 고정 12뷰 스캔 · 규칙 결함 판정(작은 결함 놓침) · 베스트핏 합불만(가공 프로그램은 고정 여유) · 바코드/RFID · 규칙 LIBS / 레거시: 작업자 · 육안 · 버니어
//  · 데이터: 가공기 감시(js/machmon.js)와 같은 묶음 → 서버 저장 · 내장 MQTT(metafactory/matl/v1/adapt/MATL) · 패킷 캡처
import { buildXferPlan } from './cmmcell.js';
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const MATL_CELL = 'MATL';
export const MATL_TOPIC = `metafactory/matl/v1/adapt/${MATL_CELL}`;
export const MATL_SPEC = {
  model: '3D 스캔 부스 (구조광 · 턴테이블 · 저울) + LIBS 재질 분석', asset: `ADP-${MATL_CELL}-SCAN`,
  // 소재: 합금 · 공칭 무게(kg) · 가공 여유 공칭(mm) · 최소(이보다 얇으면 흑피가 남음 → 불합격)
  mat: { hblock: { alloy: 'GCD450', name: '구상흑연주철', kg: 38.5, allow: 2.5, min: 1.0, faces: 6 }, rcover: { alloy: 'ADC12', name: '알루미늄 다이캐스팅', kg: 6.8, allow: 1.5, min: 0.6, faces: 4 } },
  reject: { defect: 0.008, allow: 0.006, alloy: 0.003 },   // 투입 소재 불량률 (주조 결함 · 여유 부족 · 재질 혼입)
  views: { smart: 12, nbv: [5, 9] },   // 스캔 뷰 수: 자동화 고정 프로그램 · 피지컬AI 능동 스캔
  // ④ 다음 가공셀(5축 가공 · 정밀절삭) 효과: 사이클 배율(헛절삭) · 공구 마모 배율(흑피 첫 절입 과부하)
  feed: { dark: { cut: 0.94, wear: 0.9 }, smart: { cut: 1, wear: 1 }, traditional: { cut: 1, wear: 1 } },
};
export const MATL_SENSORS = [
  { key: 'lux', label: '부스 안 조도 (외란광)', unit: 'lx', dev: '조도 센서 (차광 부스)', warn: { hi: 60 }, alarm: { hi: 120 } },
  { key: 'temp', label: '스캐너 온도', unit: '°C', dev: '스캐너 내장 온도 (보정 유효 범위)', warn: { lo: 18, hi: 30 }, alarm: { lo: 15, hi: 35 } },
  { key: 'weight', label: '소재 무게', unit: 'kg', dev: '턴테이블 로드셀' },
  { key: 'cover', label: '스캔 커버리지', unit: '%', dev: '스캔 소프트웨어 (점군 면 덮임)', warn: { lo: 97 }, alarm: { lo: 94 } },
  { key: 'libs', label: 'LIBS 판별 신뢰도', unit: '%', dev: 'LIBS 분석기 (남쪽 로봇 프로브)', warn: { lo: 90 }, alarm: { lo: 80 } },
  { key: 'force', label: '프로브 접촉 힘', unit: 'N', dev: '6축 힘·토크 센서 (남쪽 로봇 손목)', warn: { hi: 30 }, alarm: { hi: 45 } },
];

// 셀 진행률 구간: probe(남쪽 로봇 재질 분석 접촉) · scan(3D 스캔 — 문 닫힘) · fit(베스트핏·가공 여유 계산) — 역 S: 스캔 부스 턴테이블 · R: 격리 랙(문 없음)
const PLAN = {
  ok: { s: 0.02, probe: [0.02, 0.13], steps: [['A', 0.14, 0], ['S', 0.25, 1], ['S', 0.76, 0], ['A', 0.91, 1]], scan: [[0.39, 0.7]], fit: [0.7, 0.745] },
  reject: { s: 0.01, probe: [0.01, 0.06], steps: [['A', 0.06, 0], ['S', 0.115, 1], ['S', 0.34, 0], ['R', 0.415, 1], ['R', 0.49, 0], ['S', 0.565, 1], ['S', 0.84, 0], ['A', 0.915, 1]], scan: [[0.19, 0.33], [0.64, 0.8]], fit: [0.8, 0.83] },
};
export const MATL_PLANS = Object.fromEntries(Object.entries(PLAN).map(([k, P]) => [k, buildXferPlan(P, { S: 'scan', R: 'rack' }, ['rack'])]));
export const matlPlan = (item) => MATL_PLANS[item?.matl?.kind === 'reject' ? 'reject' : 'ok'];
const inAny = (p, R) => R.some(([a, b]) => p >= a && p < b);
export function matlPhase(P, p) {
  if (!P) return null;
  if (inAny(p, [P.probe])) return 'probe';
  if (inAny(p, P.scan)) return P.scan.length > 1 && p >= P.scan[1][0] ? 'rescan' : 'scan';
  if (inAny(p, [P.fit])) return 'fit';
  if (P.scan.length > 1 && p >= P.scan[0][1] && p < P.scan[1][0]) return 'swap';
  return p < P.scan[0][0] ? 'load' : 'unload';
}
export const MATL_PHASE_KO = { probe: '재질 분석 (LIBS 프로브 접촉)', load: '이송 6축 → 스캔 부스', scan: '3D 스캔', rescan: '예비 소재 3D 스캔', fit: 'CAD 베스트핏 · 가공 여유 판정', swap: '불합격 → 격리 랙 · 예비 소재로 교체', unload: '스캔 부스 → AMR 지그' };
export const REJECT_KO = { defect: '주조 결함 (기공·균열)', allow: '가공 여유 부족', alloy: '재질 혼입' };

export class MatlCellMonitor {
  constructor(sim) {
    this.sim = sim; this.rnd = mulberry(20261026); this.acc = 0; this.seq = 0;
    this.latest = {}; this.levels = {}; this.hist = []; this.records = []; this.cur = null; this.quarantine = [];
    this.stats = { parts: 0, reject: 0, defect: 0, allow: 0, alloy: 0, missed: 0, views: 0, nbv: 0, vla: 0, feed: 0, ocrAi: 0, ocrManual: 0 };
    sim.matl = this;
  }
  get on() { return this.sim.mode?.key !== 'traditional'; }
  get ai() { return this.sim.mode?.key === 'dark'; }
  cell() { return this.sim.xzones?.byKey?.('adapt')?.cells?.[MATL_CELL] ?? null; }
  g() { const u = 1 - this.rnd(), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 셀 시작(zones.js): 이 소재의 ID 판독 · 재질 · 결함 · 가공 여유 · 스캔 뷰 · 파지를 정한다 — 반환: 셀 시간 배율 (불합격이면 예비 소재로 바꿔 다시 스캔 → 2배)
  plan(item) {
    const S = MATL_SPEC, M = S.mat[item.product] ?? S.mat.hblock, mode = this.sim.mode?.key ?? 'smart', ai = mode === 'dark', R = S.reject;
    // 들어온 소재의 실제 상태 (단계와 관계없이 같은 확률)
    const u = this.rnd(), truth = u < R.defect ? 'defect' : u < R.defect + R.allow ? 'allow' : u < R.defect + R.allow + R.alloy ? 'alloy' : null;
    // 판정: 피지컬AI는 다 잡음 · 자동화는 작은 주조 결함 절반을 놓침 (규칙 판정 문턱) · 레거시는 재질 혼입·결함을 놓치고 여유 부족만 버니어로
    const caught = !truth ? null : ai ? truth : mode === 'smart' ? (truth === 'defect' && this.rnd() < 0.5 ? null : truth) : truth === 'allow' ? truth : null;
    const views = ai ? S.views.nbv[0] + Math.floor(this.rnd() * (S.views.nbv[1] - S.views.nbv[0] + 1)) : mode === 'smart' ? S.views.smart : 0;
    const faces = Array.from({ length: M.faces }, () => r2(Math.max(0.2, M.allow + 0.45 * this.g()), 2));
    if (truth === 'allow') faces[Math.floor(this.rnd() * M.faces)] = r2(M.min * (0.4 + this.rnd() * 0.4), 2);
    const minA = Math.min(...faces), shift = { x: r2(0.35 * this.g(), 2), y: r2(0.35 * this.g(), 2), z: r2(0.2 * this.g(), 2) };   // 베스트핏 원점 이동 (mm)
    const feed = (S.feed[mode] ?? S.feed.smart);
    const ocr = ai ? { method: 'AI OCR', conf: r2(0.95 + this.rnd() * 0.045, 3), manual: false } : mode === 'smart' ? (() => { const c = r2(0.78 + this.rnd() * 0.2, 3); return { method: '규칙 OCR', conf: c, manual: c < 0.85 }; })() : { method: '작업자', conf: null, manual: true };
    const libs = !this.on ? null : { alloy: truth === 'alloy' ? (item.product === 'rcover' ? 'AC4C' : 'FC250') : M.alloy, conf: r2(ai ? 0.96 + this.rnd() * 0.035 : 0.86 + this.rnd() * 0.1, 3), method: ai ? 'AI 스펙트럼 분류' : '규칙 (특성선 비율)' };
    item.matl = {
      kind: caught ? 'reject' : 'ok', reason: caught, missed: !!truth && !caught, lot: `L${String(1 + Math.floor(this.rnd() * 40)).padStart(3, '0')}`, heat: `H${Math.floor(10000 + this.rnd() * 89999)}`,
      ocr, libs, views, coverage: views ? r2(ai ? 99 + this.rnd() * 0.8 : 95.5 + this.rnd() * 2.5, 1) : null, weight: r2(M.kg * (1 + 0.01 * this.g()) * (truth === 'defect' ? 0.985 : 1), 2),
      defect: !this.on ? null : r2(caught === 'defect' ? 0.82 + this.rnd() * 0.15 : this.rnd() * (ai ? 0.18 : 0.3), 2), faces, minAllow: minA, shift,
      offset: ai && !caught, cutMul: caught ? 1 : feed.cut, wearMul: caught ? 1 : feed.wear,
      grasp: ai ? { method: 'VLA', candidates: 6 + Math.floor(this.rnd() * 7), conf: r2(0.92 + this.rnd() * 0.07, 3) } : mode === 'smart' ? { method: 'teach', candidates: 1, conf: 1 } : { method: 'manual', candidates: 0, conf: null },
      force: ai ? r2(8 + Math.abs(this.g()) * 3, 1) : mode === 'smart' ? r2(18 + Math.abs(this.g()) * 8, 1) : null,
    };
    if (caught) this.quarantine.unshift({ t: r2(this.sim.time, 1), part: item.wip ?? item.id, product: item.product, reason: caught, lot: item.matl.lot });
    if (this.quarantine.length > 30) this.quarantine.pop();
    this.cur = { id: item.wip ?? item.id, product: item.product, ...item.matl };
    return caught ? 2 : 1;
  }
  done(item) {
    const m = item.matl; if (!m) return null;
    const S = MATL_SPEC, st = this.stats;
    st.parts++; if (m.kind === 'reject') { st.reject++; st[m.reason]++; } if (m.missed) st.missed++;
    st.views += m.views; if (this.ai) st.nbv++; if (m.grasp.method === 'VLA') st.vla++; if (m.offset) st.feed++; if (m.ocr.method === 'AI OCR') st.ocrAi++; if (m.ocr.manual) st.ocrManual++;
    const rec = { id: `MAT-${String(++this.seq).padStart(5, '0')}`, t: r2(this.sim.time, 1), asset: S.asset, part: item.wip ?? item.id, product: item.product, lot: m.lot, heat: m.heat,
      result: m.kind === 'reject' ? `불합격 → 예비 소재로 교체 (${REJECT_KO[m.reason]})` : 'OK', reason: m.reason, ocr: m.ocr.method, ocrConf: m.ocr.conf, alloy: m.libs?.alloy ?? null, libsConf: m.libs?.conf ?? null,
      views: m.views, coverage_pct: m.coverage, weight_kg: m.weight, defectScore: m.defect, minAllow_mm: m.minAllow, offset: m.offset, cutMul: m.cutMul, wearMul: m.wearMul, grasp: m.grasp.method, probeForce_N: m.force };
    this.records.unshift(rec); if (this.records.length > 60) this.records.pop();
    (item.qx ??= {}).matl = { minAllow: m.minAllow, weight: m.weight, offset: m.offset };   // 품질 표본 (zonekpi adaptUnit)
    if (this.on) this.emit({ topic: `${MATL_TOPIC}/part`, kind: 'record', ...rec });
    if (m.kind === 'reject' && this.on) this.sim.log?.('warn', `적응가공 소재 격리 — ${rec.part}`, { obs: `${REJECT_KO[m.reason]} · 로트 ${m.lot} · 히트 ${m.heat}`, dec: m.reason === 'allow' ? `최소 가공 여유 ${m.minAllow}mm < ${(S.mat[item.product] ?? S.mat.hblock).min}mm` : m.reason === 'alloy' ? `LIBS ${m.libs?.alloy} (규격 ${(S.mat[item.product] ?? S.mat.hblock).alloy})` : `결함 점수 ${m.defect}`, act: '격리 랙 · 같은 로트 예비 소재로 교체 · 공급사 품질 통보', zone: 'adapt' });
    if (this.cur?.id === rec.part) this.cur = null;
    return rec;
  }
  measure() {
    const c = this.cell(), busy = !!c && c.state === 'BUSY' && !c.fault && !c.halt, P = busy ? matlPlan(c.item) : null, ph = busy ? matlPhase(P, c.progress) : null, m = busy ? c.item?.matl : null, n = (s) => s * this.g();
    const doorOpen = busy && P.doors.scan.some(([a, b]) => c.progress >= a && c.progress < b);
    const v = {
      lux: (doorOpen ? 85 : 6) + Math.abs(n(2)), temp: 23 + n(0.2), weight: m && ['scan', 'rescan', 'fit'].includes(ph) ? m.weight + n(0.01) : 0,
      cover: m?.coverage != null && ['scan', 'rescan', 'fit'].includes(ph) ? m.coverage : 100, libs: m?.libs ? m.libs.conf * 100 : 100, force: m?.force != null && ph === 'probe' ? m.force + n(0.8) : 0,
    };
    for (const k of Object.keys(v)) v[k] = r2(Math.max(0, v[k]), k === 'weight' ? 2 : 1);
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
    // 문이 열린 동안의 외란광은 스캔하지 않으므로 경보에서 뺀다
    this.levels = Object.fromEntries(MATL_SENSORS.map((s) => [s.key, s.key === 'lux' && !['scan', 'rescan'].includes(ph) ? 'ok' : this.level(s, v[s.key])]));
    if (!this.on) return;
    if ((this.hist.at(-1)?.t ?? -9) <= this.sim.time - 2) { this.hist.push(this.latest); if (this.hist.length > 900) this.hist.shift(); }
    if ((this.lastQ ?? -9) <= this.sim.time - 5) { this.lastQ = this.sim.time; this.emit({ topic: MATL_TOPIC, kind: 'sample', asset: MATL_SPEC.asset, t: r2(this.sim.time, 1), phase: ph ?? 'idle', v, levels: this.levels }); }
  }
  snapshot() {
    const recent = this.records.slice(0, 20), avg = (k) => (recent.length ? r2(recent.reduce((a, r) => a + (r[k] ?? 0), 0) / recent.length, 2) : null);
    return { spec: MATL_SPEC, sensors: this.latest, levels: this.levels, cur: this.cur, ai: this.ai, on: this.on, stats: { ...this.stats }, records: recent, quarantine: this.quarantine.slice(0, 8),
      avg: { views: avg('views'), cover: avg('coverage_pct'), minAllow: avg('minAllow_mm'), force: avg('probeForce_N') } };
  }
  emit(item) { if (this.sim.machmon) this.sim.machmon.emit(item); else (this.outbox ??= []).push(item); }
}
