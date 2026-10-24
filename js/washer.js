// 적응가공 유압블록 세척기 — 밀폐형 세척기(로봇 투입형) 공정 데이터 · 기술적 청정도 · 필터 정비 — DOM 없음 (헤드리스 시험 가능)
//  · 공정: (워터젯 디버링 부스에서 교차홀 버 제거 뒤) 고압 분사 세척 → 랜스 분사 세척(홀마다) → 열풍 건조. 6축 이송 로봇이 AMR → 부스 → 세척기 → AMR로 옮긴다 (zones.js)
//  · 센서(WASH_SENSORS): 고압 펌프 압력 · 세척액 온도 · 전도도(세척액 오염) · 백필터 차압 · 분사 유량 · 건조 온도
//  · 블록마다 청정도(ISO 16232 · VDA 19.1): 최대 금속 입자 크기(µm) · 잔류 오염량(mg) — 필터가 막히고 세척액이 오염될수록 나빠진다 → 규격 밖이면 한 번 더 세척(재세척)
//  · 필터 정비: 차압이 기준을 넘으면 정비 요청(sim.requestTech 'filter') → 정비 인력 출동 → 교체(셀 정지) → FAC 설비보전 기록. 세척액이 오염됐으면 그때 같이 교체
//    레거시: 차압 센서·데이터 수집이 없어 작업자가 압력계로 알아챌 때(차압 경보선) 교체
//  · 데이터: 가공기 감시(js/machmon.js)와 같은 묶음 → 서버 저장 · 내장 MQTT(metafactory/washer/v1/adapt/HB_DEBR) · 패킷 캡처
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const WASH_CELL = 'HB_DEBR';
export const WASH_SPEC = {
  model: '로봇 투입형 밀폐 세척기', process: '고압 분사 세척 → 랜스 분사 세척 → 열풍 건조 (디버링은 워터젯 부스)', asset: `ADP-${WASH_CELL}-WASH`,
  pressure: 600, temp: 60, dryTemp: 80, flow: 120,   // bar · °C · °C · L/min (정격)
  dp0: 0.3, dpPerPass: 0.006, dpRequest: 0.9, dpAlarm: 1.2,   // 백필터 차압 (bar): 새 필터 · 세척 1회당 증가 · 정비 요청(IoT) · 경보(레거시 작업자 인지)
  cond0: 350, condPerPass: 1.2, condBath: 1000,   // 전도도 (µS/cm): 새 세척액 · 1회당 · 필터 교체 때 세척액도 바꾸는 기준
  maxParticle: 400, maxResidue: 2.0,   // 청정도 규격: 최대 금속 입자 크기 µm · 잔류 오염량 mg/개 (고객 청정도 사양 · ISO 16232 / VDA 19.1 분석)
  rewashTime: 0.3,   // 재세척: 셀 사이클의 30% 추가
};
// 센서 (hi: 높으면 경보 · lo: 낮으면 경보) — 세척 중일 때만 판정하는 값은 wash: true
export const WASH_SENSORS = [
  { key: 'pressure', label: '고압 펌프 압력', unit: 'bar', dev: '압력 트랜스미터 (4–20mA)', wash: true, warn: { lo: 540 }, alarm: { lo: 480 } },
  { key: 'flow', label: '분사 유량', unit: 'L/min', dev: '전자 유량계 (IO-Link)', wash: true, warn: { lo: 105 }, alarm: { lo: 95 } },
  { key: 'temp', label: '세척액 온도', unit: '°C', dev: 'Pt100 (IO-Link)', warn: { lo: 52, hi: 66 }, alarm: { lo: 45, hi: 70 } },
  { key: 'cond', label: '세척액 전도도', unit: 'µS/cm', dev: '전도도 셀 (세척액 오염)', warn: { hi: 900 }, alarm: { hi: 1200 } },
  { key: 'dp', label: '백필터 차압', unit: 'bar', dev: '차압 트랜스미터 (필터 전·후)', warn: { hi: 0.8 }, alarm: { hi: 1.2 } },
  { key: 'dryTemp', label: '건조 열풍 온도', unit: '°C', dev: '열전대', warn: { lo: 70 }, alarm: { lo: 60 } },
];
export const WASH_TOPIC = `metafactory/washer/v1/adapt/${WASH_CELL}`;
// 셀 진행률(p) → 이송 진행률(q): 앞 절반(XFER_START)은 사선홀 머신텐딩이라 0, 그 뒤 0 ~ 1 — 이송 6축 경로(zones.js XFER_SEQ)와 같은 진행률
//  q 0.3 ~ 0.41 워터젯 디버링 부스 · 0.72 ~ 0.85 세척기 (문이 다 닫힌 뒤 · 문은 로봇이 드나드는 동안만 열림)
export const XFER_START = 0.5;
export const washQ = (p) => (p < XFER_START ? 0 : Math.min(1, (p - XFER_START) / (1 - XFER_START)));
// 세척기 안 단계 (q): 고압 분사 세척 · 랜스 세척 · 건조 / 부스 (q): 워터젯 디버링
export const washPhase = (q) => (q > 0.72 && q < 0.76 ? 'hp' : q >= 0.76 && q < 0.8 ? 'lance' : q >= 0.8 && q < 0.85 ? 'dry' : null);
export const boothPhase = (q) => (q > 0.3 && q < 0.41 ? 'wj' : null);
export const WASH_PHASE_KO = { hp: '고압 분사 세척', lance: '랜스 분사 세척', dry: '열풍 건조' };

export class WasherMonitor {
  constructor(sim) {
    this.sim = sim; this.rnd = mulberry(20261024); this.acc = 0; this.seq = 0;
    this.dp = WASH_SPEC.dp0; this.cond = WASH_SPEC.cond0; this.latest = {}; this.levels = {}; this.hist = []; this.records = []; this.events = [];
    this.stats = { parts: 0, passes: 0, rewash: 0, fail: 0, filterChanges: 0, bathChanges: 0, requests: 0 };
    this.sinceChange = 0;
    sim.washer = this;
  }
  get on() { return this.sim.mode?.key !== 'traditional'; }   // 레거시: 센서·데이터 수집 없음 (세척·필터 막힘은 그대로)
  cell() { return this.sim.xzones?.byKey?.('adapt')?.cells?.[WASH_CELL] ?? null; }
  fac() { return this.sim.zoneCell?.('adapt', WASH_CELL) ?? null; }
  g() { const u = 1 - this.rnd(), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 한 번 세척했을 때의 청정도 — 필터 차압 0.5bar · 전도도 800µS/cm를 넘으면서 나빠진다 (정비 요청선 0.9bar 가까이면 재세척이 늘기 시작 · 재세척은 남은 오염의 일부만 남김)
  cleanOnce(dp, cond, rest = 1) {
    const sev = Math.max(0, dp - 0.5) / 0.4, cf = Math.max(0, cond - 800) / 700;
    const particle = Math.max(60, (170 + 55 * this.g() + 210 * sev ** 1.5 + 60 * cf) * rest);
    const residue = Math.max(0.1, (0.55 + 0.14 * this.g() + 1.2 * sev ** 1.5 + 0.4 * cf) * rest);
    return { particle: r2(particle, 0), residue: r2(residue, 2) };
  }
  // 셀 시작(zones.js): 청정도 판정을 미리 정해 재세척이면 셀 시간을 늘린다 — 반환: 추가 시간 배율
  plan(item) {
    const S = WASH_SPEC, a = this.cleanOnce(this.dp, this.cond), ok = (x) => x.particle <= S.maxParticle && x.residue <= S.maxResidue;
    let res = a, passes = 1;
    if (!ok(a)) { passes = 2; res = this.cleanOnce(this.dp + S.dpPerPass, this.cond + S.condPerPass, 0.55); }
    item.wash = { first: a, final: res, passes, pass: ok(res), dp: r2(this.dp, 3), cond: r2(this.cond, 0) };
    return passes > 1 ? S.rewashTime : 0;
  }
  // 셀 완료(zones.js): 필터·세척액 소모 · 기록 · 품질 이력 · 정비 판단
  done(item) {
    const w = item.wash; if (!w) return null;
    const S = WASH_SPEC, sim = this.sim;
    this.dp += S.dpPerPass * w.passes * (0.85 + this.rnd() * 0.3); this.cond += S.condPerPass * w.passes * (0.85 + this.rnd() * 0.3);
    this.stats.parts++; this.stats.passes += w.passes; this.sinceChange++;
    if (w.passes > 1) this.stats.rewash++;
    if (!w.pass) this.stats.fail++;
    const rec = { id: `WSH-${String(++this.seq).padStart(5, '0')}`, t: r2(sim.time, 1), asset: S.asset, part: item.serial ?? item.wip ?? item.id, product: item.product,
      passes: w.passes, rewash: w.passes > 1, pass: w.pass, maxParticle_um: w.final.particle, residue_mg: w.final.residue, firstParticle_um: w.first.particle, firstResidue_mg: w.first.residue,
      filterDp_bar: w.dp, conductivity_uScm: w.cond, spec: { maxParticle_um: S.maxParticle, maxResidue_mg: S.maxResidue, standard: 'ISO 16232 / VDA 19.1' } };
    this.records.unshift(rec); if (this.records.length > 60) this.records.pop();
    (item.qx ??= {}).wash = { dp: w.dp, cond: w.cond, particle: w.final.particle, residue: w.final.residue, passes: w.passes };   // CMM 품질 표본 (zonekpi adaptUnit)
    if (this.on) this.emit({ topic: `${WASH_TOPIC}/part`, kind: 'record', ...rec });
    if (w.passes > 1 && this.on) sim.log?.('warn', `적응가공 세척기 재세척 — ${rec.part}`, { obs: `1차 청정도 최대 입자 ${w.first.particle}µm · 잔류 ${w.first.residue}mg (규격 ${S.maxParticle}µm · ${S.maxResidue}mg)`, dec: `필터 차압 ${w.dp}bar · 전도도 ${w.cond}µS/cm`, act: '같은 자리에서 한 번 더 세척 (셀 사이클 +30%)', zone: 'adapt' });
    this.check();
    return rec;
  }
  // 필터 정비 판단: IoT(차압 센서)는 요청선에서 미리, 레거시는 경보선에서 작업자가 알아챔 — 정비 요청이 없을 때 한 번
  check() {
    const S = WASH_SPEC, fac = this.fac(), lim = this.on ? S.dpRequest : S.dpAlarm;
    if (!fac || fac.request || fac.state === 'DOWN' || fac.state === 'MAINT' || this.dp < lim) return;
    if (!this.sim.requestTech?.(fac, 'filter')) return;
    this.stats.requests++;
    const why = `백필터 차압 ${r2(this.dp, 2)}bar ≥ ${lim}bar · 교체 후 ${this.sinceChange}개 세척 · 재세척 ${this.stats.rewash}회 누적`;
    this.event('request', why);
    this.sim.log?.('plan', `적응가공 세척기 필터 교체 요청`, { obs: why, dec: this.on ? '차압 추세 — 청정도 나빠지기 전 교체' : '압력계 경보 — 작업자 확인', act: `정비 인력 요청 (FAC 설비보전)${this.cond >= S.condBath ? ' · 세척액도 교체' : ''}`, zone: 'adapt' });
    const O = this.sim.fos?.adapt; O?.note?.(`세척기 필터 교체 요청 — ${why}`);
  }
  // 정비 완료(sim.finishRepair 'filter'): 필터 새것 · 세척액 오염이 기준을 넘었으면 세척액도 교체
  maintained() {
    const S = WASH_SPEC, bath = this.cond >= S.condBath, before = r2(this.dp, 2);
    this.dp = S.dp0 + this.rnd() * 0.03; this.stats.filterChanges++; this.sinceChange = 0;
    if (bath) { this.cond = S.cond0 + this.rnd() * 20; this.stats.bathChanges++; }
    this.event('replaced', `백필터 교체 (차압 ${before} → ${r2(this.dp, 2)}bar)${bath ? ' · 세척액 교체 (전도도 기준 초과)' : ''}`);
  }
  event(kind, text) {
    const ev = { t: r2(this.sim.time, 1), kind, text, dp: r2(this.dp, 3), cond: r2(this.cond, 0) };
    this.events.unshift(ev); if (this.events.length > 30) this.events.pop();
    if (this.on) this.emit({ topic: `${WASH_TOPIC}/event`, kind: 'event', asset: WASH_SPEC.asset, ...ev });
  }
  // 측정값 (1초): 세척 단계(셀 진행률)에 따라 압력·유량·건조 온도 — 필터가 막히면 압력·유량이 떨어진다
  measure() {
    const S = WASH_SPEC, c = this.cell(), busy = !!c && c.state === 'BUSY' && !c.fault && !c.halt, q = busy ? washQ(c.progress) : 0, ph = busy ? washPhase(q) : null;
    const clog = Math.max(0, this.dp - 0.6), n = (s) => s * this.g();
    const v = {
      pressure: ph === 'hp' || ph === 'lance' ? S.pressure - 110 * clog + n(4) : 2 + Math.abs(n(0.5)),
      flow: ph === 'hp' || ph === 'lance' ? S.flow - 45 * clog + n(1.5) : 0,
      temp: S.temp + n(0.4), cond: this.cond + n(3), dp: this.dp + n(0.005),
      dryTemp: ph === 'dry' ? S.dryTemp + n(1) : 45 + n(1),
    };
    for (const k of Object.keys(v)) v[k] = r2(Math.max(0, v[k]), k === 'dp' ? 3 : 1);
    return { v, ph, q };
  }
  level(s, x, ph) {
    if (x == null || (s.wash && !(ph === 'hp' || ph === 'lance'))) return 'ok';
    if (s.key === 'dryTemp' && ph !== 'dry') return 'ok';
    const hit = (b) => b && ((b.hi != null && x >= b.hi) || (b.lo != null && x <= b.lo));
    return hit(s.alarm) ? 'alarm' : hit(s.warn) ? 'warn' : 'ok';
  }
  tick(dt) {
    this.acc += dt; if (this.acc < 1 - 1e-9) return; this.acc = 0;
    const { v, ph } = this.measure();
    this.latest = { t: this.sim.time, phase: ph, ...v };
    this.levels = Object.fromEntries(WASH_SENSORS.map((s) => [s.key, this.level(s, v[s.key], ph)]));
    if (!this.on) return;
    if ((this.hist.at(-1)?.t ?? -9) <= this.sim.time - 2) { this.hist.push(this.latest); if (this.hist.length > 900) this.hist.shift(); }
    if ((this.lastQ ?? -9) <= this.sim.time - 5) { this.lastQ = this.sim.time; this.emit({ topic: WASH_TOPIC, kind: 'sample', asset: WASH_SPEC.asset, t: r2(this.sim.time, 1), phase: ph ?? 'idle', v, levels: this.levels }); }   // v: 측정값 (가공기 감시와 같은 꼴 — Telegraf washer 입력)
  }
  // 남은 세척 횟수 (필터 요청선까지) — 최근 소모율
  remaining() { const S = WASH_SPEC, per = S.dpPerPass * (this.stats.parts ? this.stats.passes / this.stats.parts : 1); return Math.max(0, Math.floor(((this.on ? S.dpRequest : S.dpAlarm) - this.dp) / per)); }
  snapshot() {
    const S = WASH_SPEC, recent = this.records.slice(0, 20), rr = recent.length ? recent.filter((r) => r.rewash).length / recent.length : 0;
    return { spec: S, sensors: this.latest, levels: this.levels, dp: r2(this.dp, 3), cond: r2(this.cond, 0), remaining: this.remaining(), rewashRate: r2(rr * 100, 1), stats: { ...this.stats }, records: recent, events: this.events.slice(0, 10), request: this.fac()?.request ? { kind: this.fac().request.kind, tech: this.fac().request.tech?.id ?? null } : null };
  }
  // 가공기 감시 묶음과 같은 길 (서버 저장 · 내장 MQTT · 패킷 캡처) — 가공기 감시가 없으면 자체 묶음
  emit(item) { if (this.sim.machmon) this.sim.machmon.emit(item); else (this.outbox ??= []).push(item); }
}
