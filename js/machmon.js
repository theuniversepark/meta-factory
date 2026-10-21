// 적응가공Zone 가공기 상태 감시 (CM: Condition Monitoring) · 공구 상태 · 존 엣지 AI 예지보전 — DOM 없음 (헤드리스 시험 가능)
//  · 가공기 4대: 유압블록 5축 가공(밀링·드릴) · 리어커버 정밀절삭(5축) · 리어커버 선삭 · 유압블록 사선·디버링(드릴)
//  · 센서(MON_SENSORS): 주축 부하·전류·전력·회전수(CNC·CT·전력계) · 3축 진동 RMS·첨도(가속도계 · 엣지 특징값) · 음향방출(AE)
//    · 주축 베어링 온도(Pt100) · 절삭유 온도·유량 · 공구 검사 카메라(플랭크 마모 VB · 치핑) · 레이저 공구 측정기(길이 편차)
//  · 값은 시뮬레이션 상태에서 만든다 — 공구 마모(적응가공 오케스트레이터 tools) · 가공 중 여부(셀 BUSY) · 설비 건강도(sim.zoneCells)
//  · 엣지 AI(1초): 정상 기준선 대비 이상 점수 · 공구 마모 추세 → 잔여 수명(RUL, 개·분) · 판단(정상/감시/교체 권고/즉시 교체 · 주축 점검)
//    → 존에서 바로 실행(예지 공구 교환 · 주축 예지정비 요청) → 상위 공장 오케스트레이터(FacOS)에 상태 보고(A2A status) · 주축 정비는 결정 요청
//  · 서버 전송: 묶음(outbox)을 앱 서버 /api/machmon/v1으로 (main.js) · AAS 환경(machineEnvironment): 명판·기술 데이터·운영 데이터·공구 상태·예지보전·시계열
import { EXTRA_ZONES } from './zonedefs.js';
import { MACHINE_SPECS, MACHINE_BY_TYPE } from './machine-specs.js';

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// 감시 대상 가공기 (적응가공Zone 셀 id → 공정)
export const MON_MACHINES = {
  HB_MILL: { proc: '5축 밀링·드릴·탭', rpm: 12000, tool: '초경 엔드밀 Ø10 · 드릴 Ø6.8' },
  RC_MILL: { proc: '5축 정밀 절삭', rpm: 15000, tool: '초경 볼엔드밀 Ø8' },
  RC_TURN: { proc: '보어 선삭', rpm: 3200, tool: 'CNMG 인서트 (보링바)' },
  HB_DEBR: { proc: '사선홀 드릴·디버링', rpm: 9000, tool: '초경 드릴 Ø5 · 챔퍼 버' },
};
// 센서 (hi: 높으면 경보 · lo: 낮으면 경보) — 진동 경보는 ISO 10816-3 등급 C/D, 공구 마모 VB 300µm는 ISO 3685 공구 수명 기준
export const MON_SENSORS = [
  { key: 'spindleLoad', label: '주축 부하', unit: '%', dev: 'CNC 주축 드라이브 (MTConnect)', warn: { hi: 85 }, alarm: { hi: 95 } },
  { key: 'spindleCurrent', label: '주축 전류', unit: 'A', dev: 'CT 클램프 전류 센서 (홀 · 4–20mA)', warn: { hi: 38 }, alarm: { hi: 44 } },
  { key: 'power', label: '가공 전력', unit: 'kW', dev: '전력 미터 (Modbus TCP)', warn: { hi: 18 }, alarm: { hi: 22 } },
  { key: 'rpm', label: '주축 회전수', unit: 'rpm', dev: 'CNC (MTConnect)' },
  { key: 'vibration', label: '주축 진동 RMS', unit: 'mm/s', dev: '3축 가속도계 (IEPE 25.6kHz → 엣지 RMS)', warn: { hi: 4.5 }, alarm: { hi: 7.1 } },
  { key: 'kurtosis', label: '진동 첨도', unit: '', dev: '엣지 특징값 (충격·치핑)', warn: { hi: 4.5 }, alarm: { hi: 6 } },
  { key: 'ae', label: '음향방출 AE', unit: 'dB', dev: 'AE 센서 (100–900kHz · 공구 접촉·파손)', warn: { hi: 72 }, alarm: { hi: 80 } },
  { key: 'bearingTemp', label: '주축 베어링 온도', unit: '°C', dev: 'Pt100 (IO-Link)', warn: { hi: 55 }, alarm: { hi: 65 } },
  { key: 'coolantTemp', label: '절삭유 온도', unit: '°C', dev: '열전대 (IO-Link)', warn: { hi: 30 }, alarm: { hi: 35 } },
  { key: 'coolantFlow', label: '절삭유 유량', unit: 'L/min', dev: '전자 유량계 (IO-Link)', warn: { lo: 12 }, alarm: { lo: 8 } },
  { key: 'toolVB', label: '공구 플랭크 마모 VB', unit: 'µm', dev: '공구 검사 카메라 (5MP · 링 조명 · 공구 교환 위치)', warn: { hi: 200 }, alarm: { hi: 300 } },
  { key: 'toolChip', label: '공구 치핑 점수', unit: '', dev: '공구 카메라 비전 AI', warn: { hi: 0.5 }, alarm: { hi: 0.8 } },
  { key: 'toolLength', label: '공구 길이 편차', unit: 'µm', dev: '레이저 공구 측정기 (비접촉)', warn: { hi: 20 }, alarm: { hi: 40 } },
];
export const MON_TOPIC = (cell) => `metafactory/machmon/v1/adapt/${cell}`;
export const DECISION = { ok: '정상', watch: '감시', replace: '공구 교체 권고', now: '즉시 공구 교체', changing: '공구 교환 중', spindle: '주축 점검·정비 권고', repair: '설비 정비 중' };

export class MachineMonitor {
  constructor(sim) {
    this.sim = sim; this.rnd = mulberry(20261021); this.acc = 0; this.seq = 0;
    this.Z = EXTRA_ZONES.find((z) => z.key === 'adapt');
    this.m = {}; for (const id of Object.keys(MON_MACHINES)) if (this.Z?.cells[id]) this.m[id] = { id, latest: {}, hist: [], rate: 0, lastWear: 0, lastParts: 0, decision: 'ok', anomaly: 0, rul: null, records: [], spindle: { heat: 0 } };
    this.outbox = []; this.sent = { batches: 0, records: 0, last: null, err: null };
    this.stats = { preventive: 0, spindleReq: 0, reports: 0 };
    sim.machmon = this;
  }
  get on() { return this.sim.mode?.key !== 'traditional'; }   // 레거시: 센서·데이터 수집 없음
  has(id) { return !!this.m[id]; }
  tool(id) { return this.sim.fos?.adapt?.tools?.[id] ?? null; }
  g() { const u = 1 - this.rnd(), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 측정값 (1초) — 가공 중이면 공구 마모에 따라 부하·전류·진동·AE가 오르고, 설비 건강도가 낮으면 베어링 온도·진동이 오른다
  measure(M, dt) {
    const sim = this.sim, cell = sim.xzones?.byKey?.('adapt')?.cells?.[M.id], fac = sim.zoneCell?.('adapt', M.id), T = this.tool(M.id), spec = MON_MACHINES[M.id];
    const cut = !!cell && cell.state === 'BUSY' && !cell.fault && !(cell.holdT > 0) && cell.progress > 0.18 && cell.progress < 0.82;
    const w = T ? Math.min(1.05, T.wear) : 0, h = fac ? fac.health / 100 : 1, bad = Math.max(0, 0.6 - h) / 0.6, cond = T?.cond ?? 1;
    M.spindle.heat += ((cut ? 1 : 0) - M.spindle.heat) * Math.min(1, dt / 90);   // 주축 열 (가공하면 천천히 오름)
    const n = (s) => s * this.g();
    const L = cut ? 48 + 30 * w * w + 6 * bad + n(2.5) : 4 + n(0.6);
    const v = {
      spindleLoad: L / (cond > 1 ? 1.04 : 1), rpm: cut ? spec.rpm * (cond > 1 ? 0.92 : 1) + n(spec.rpm * 0.003) : 0,
      vibration: (cut ? 1.4 + 3.4 * w * w : 0.35) + 4.5 * bad * bad + n(0.12),
      kurtosis: 3 + (cut ? 2.6 * Math.max(0, w - 0.7) / 0.3 : 0) + 2.5 * bad * bad + n(0.15),
      ae: cut ? 58 + 18 * w * w + n(1.5) : 41 + n(1),
      bearingTemp: 31 + 14 * M.spindle.heat + 26 * bad * bad + n(0.3),
      coolantTemp: 23 + 4 * M.spindle.heat + n(0.2), coolantFlow: cut ? 18 + n(0.4) : 0.8 + Math.abs(n(0.3)),
      toolVB: T ? 25 + 300 * w ** 1.3 + n(4) : 0, toolChip: T ? Math.min(1, Math.max(0, 3.2 * Math.max(0, w - 0.75) + n(0.03))) : 0,
      toolLength: T ? 2 + 32 * w ** 1.6 + n(1.2) : 0,
    };
    v.spindleCurrent = 6 + 0.36 * v.spindleLoad + n(0.4); v.power = 0.9 + 0.2 * v.spindleLoad + n(0.15);
    for (const k of Object.keys(v)) v[k] = r2(Math.max(0, v[k]), k === 'rpm' ? 0 : 2);
    return { v, cut, w, h, T, fac };
  }
  level(s, x) {
    if (x == null) return 'ok';
    const hit = (b) => b && ((b.hi != null && x >= b.hi) || (b.lo != null && x <= b.lo));
    return hit(s.alarm) ? 'alarm' : hit(s.warn) ? 'warn' : 'ok';
  }

  tick(dt) {
    if (!this.on || !this.sim.fos?.adapt) return;
    this.acc += dt; if (this.acc < 1) return; const step = this.acc; this.acc = 0;
    for (const M of Object.values(this.m)) this.edge(M, step);
  }
  // 엣지 AI: 이상 점수 · 공구 RUL · 판단 → 존에서 실행 · 상위 보고 · 서버 묶음
  edge(M, dt) {
    const sim = this.sim, O = sim.fos.adapt, { v, cut, w, h, T, fac } = this.measure(M, dt);
    M.latest = { t: sim.time, ...v };
    M.levels = Object.fromEntries(MON_SENSORS.map((s) => [s.key, s.key === 'coolantFlow' && !cut ? 'ok' : this.level(s, v[s.key])]));   // 절삭유는 가공 중에만 판정
    if ((M.hist.at(-1)?.t ?? -9) <= sim.time - 2) { M.hist.push(M.latest); if (M.hist.length > 900) M.hist.shift(); }
    // 공구 마모 속도 (개당) — 지수 평균 · 교환 뒤 다시 학습
    if (T) {
      if (T.parts < M.lastParts) { M.lastWear = 0; M.lastParts = 0; }
      if (T.parts > M.lastParts) { const r = (T.wear - M.lastWear) / (T.parts - M.lastParts); M.rate = M.rate ? M.rate * 0.7 + r * 0.3 : r; M.lastWear = T.wear; M.lastParts = T.parts; }
    }
    const cyc = sim.xzones?.byKey?.('adapt')?.cells?.[M.id]?.cycle ?? this.Z.cells[M.id].cycle;
    const rulParts = T && M.rate > 0 ? Math.max(0, Math.floor((0.88 - T.wear) / M.rate)) : null;
    M.rul = { parts: rulParts, min: rulParts != null ? r2((rulParts * cyc * 1.6) / 60, 1) : null, spindleMin: fac ? Math.max(0, Math.round((fac.health - 30) / 0.35)) : null };
    // 이상 점수: 경보 기준 대비 정규화 초과량 최대 (0 정상 · 1 경고선 · 2 경보선)
    M.anomaly = r2(Math.max(0, ...MON_SENSORS.filter((s) => s.warn?.hi && v[s.key] != null).map((s) => Math.max(0, (v[s.key] - s.warn.hi * 0.7) / ((s.alarm?.hi ?? s.warn.hi * 1.3) - s.warn.hi * 0.7) * 2))), 2);
    // 판단
    const spindleBad = fac && fac.state === 'OK' && ((M.levels.bearingTemp === 'alarm') || (M.levels.vibration !== 'ok' && w < 0.5) || fac.health < 45);
    let d = 'ok';
    if (fac && (fac.state === 'DOWN' || fac.state === 'MAINT')) d = 'repair';
    else if (T?.changing > 0) d = 'changing';
    else if (spindleBad) d = 'spindle';
    else if (T && (M.levels.toolChip === 'alarm' || M.levels.toolVB === 'alarm')) d = 'now';
    else if (T && (M.levels.toolVB === 'warn' || (rulParts != null && rulParts <= 3))) d = 'replace';
    else if (T && w >= 0.55) d = 'watch';
    // 존에서 실행 (예지보전): 공구는 파손 전에 교환 · 주축은 정비 인력 요청 · 공장 오케스트레이터에 결정 요청
    let action = null;
    if ((d === 'now' || (d === 'replace' && w >= 0.72)) && T && !(T.changing > 0)) {
      const cell = sim.xzones?.byKey?.('adapt')?.cells?.[M.id] ?? { id: M.id, def: this.Z.cells[M.id] };
      O.startChange(cell, false); this.stats.preventive++; action = `예지 공구 교환 (${T.id} · VB ${v.toolVB}µm · 잔여 ${rulParts ?? '-'}개)`; d = 'changing';
    } else if (d === 'spindle' && fac && M.spEsc !== fac.c.fails + fac.c.maint) {   // 주축 이상 한 번에 한 번: 정비 인력이 아직 없으면 요청(이미 IoT 예지정비가 걸렸으면 그대로) · 공장 오케스트레이터 결정 요청
      M.spEsc = fac.c.fails + fac.c.maint;
      const asked = !fac.request && sim.requestTech?.(fac, 'pm');
      this.stats.spindleReq++; action = `주축 예지정비 ${asked ? '요청' : '확인 (정비 요청 진행 중)'} (베어링 ${v.bearingTemp}°C · 진동 ${v.vibration}mm/s · 건강도 ${Math.round(fac.health)}%)`;
      O.escalate('machine-pm', `${this.Z.cells[M.id].label} 주축 예지정비 — ${action}`, { cell: M.id, health: Math.round(fac.health), bearingTemp: v.bearingTemp, vibration: v.vibration }, { cell: `ADP-${M.id}` });
    }
    if (d !== M.decision || action) this.record(M, d, v, T, action);
    M.decision = d;
    // 서버 묶음 (5초마다 · 가공기별)
    if ((M.lastQ ?? -9) <= sim.time - 5) { M.lastQ = sim.time; this.emit({ topic: MON_TOPIC(M.id), kind: 'sample', asset: `ADP-${M.id}`, t: r2(sim.time, 1), decision: d, anomaly: M.anomaly, rul: M.rul, tool: T ? { id: T.id, wear: r2(T.wear, 3), parts: T.parts } : null, v }); }
  }
  // 판단 기록(정비·교체 데이터) → 존 로그 · 상위 오케스트레이터 상태 보고 · 서버 묶음
  record(M, d, v, T, action) {
    const sim = this.sim, O = sim.fos.adapt, label = this.Z.cells[M.id].label;
    const ev = Object.fromEntries(['spindleLoad', 'vibration', 'kurtosis', 'ae', 'bearingTemp', 'toolVB', 'toolChip', 'toolLength'].map((k) => [k, v[k]]));
    const why = d === 'ok' ? '정상 범위' : d === 'watch' ? `공구 마모 ${Math.round((T?.wear ?? 0) * 100)}% — 추세 감시` : d === 'replace' ? `VB ${v.toolVB}µm · 잔여 ${M.rul.parts ?? '-'}개 (${M.rul.min ?? '-'}분)` : d === 'now' ? `치핑 ${v.toolChip} · VB ${v.toolVB}µm — 파손 위험` : d === 'spindle' ? `베어링 ${v.bearingTemp}°C · 진동 ${v.vibration}mm/s` : d === 'changing' ? `${T?.id ?? ''} 교환` : '설비 고장·정비';
    const rec = { id: `PDM-${String(++this.seq).padStart(5, '0')}`, t: r2(sim.time, 1), asset: `ADP-${M.id}`, machine: label, decision: d, decisionKo: DECISION[d], reason: why, action,
      workType: d === 'replace' || d === 'now' || (d === 'changing' && action) ? 'tool-replace' : d === 'spindle' ? 'spindle-maintenance' : null,
      tool: T ? { id: T.id, wear: r2(T.wear, 3), parts: T.parts, life: T.life, VB_um: v.toolVB, chipping: v.toolChip, lengthDev_um: v.toolLength } : null,
      rul: M.rul, anomaly: M.anomaly, evidence: ev, reportedTo: 'factory' };
    M.records.unshift(rec); if (M.records.length > 40) M.records.pop();
    this.emit({ topic: `${MON_TOPIC(M.id)}/event`, kind: 'record', ...rec });
    if (d !== 'ok' && d !== 'changing' || action) {
      O.note(`${M.id} 예지보전 · ${DECISION[d]} — ${why}${action ? ` → ${action}` : ''}`);
      sim.fos.bus.send(O.ep, 'factory', 'status', { subject: { cell: `ADP-${M.id}`, tool: T?.id }, body: { kind: 'pdm', record: rec }, text: `${label} 예지보전 보고 — ${DECISION[d]} · ${why}` });
      this.stats.reports++;
      if (action || d === 'now' || d === 'spindle') sim.log(action ? 'plan' : 'warn', `적응가공 ${label} · ${DECISION[d]}`, { obs: why, dec: `엣지 AI 이상 점수 ${M.anomaly} · 잔여 ${M.rul.parts ?? '-'}개`, act: action ?? '상위 보고', zone: 'adapt' });
    }
  }
  // 서버 묶음에 쌓고, 같은 메시지를 패킷 캡처(main.js onItem → pcap)에도 — 서버가 내장 MQTT로 발행하는 것과 같은 토픽·페이로드
  emit(item) { this.outbox.push(item); if (this.outbox.length > 2000) this.outbox.splice(0, this.outbox.length - 2000); this.onItem?.(item); }
  take(n = 500) { return this.outbox.splice(0, n); }
  snapshot(id) {
    const M = this.m[id]; if (!M) return null; const T = this.tool(id);
    return { asset: `ADP-${id}`, machine: this.Z.cells[id].label, proc: MON_MACHINES[id].proc, t: r2(this.sim.time, 1), decision: M.decision, decisionKo: DECISION[M.decision], anomaly: M.anomaly, rul: M.rul,
      tool: T ? { id: T.id, wear: r2(T.wear, 3), parts: T.parts, life: T.life, changing: T.changing > 0 } : null, sensors: M.latest, levels: M.levels, records: M.records.slice(0, 10) };
  }
}

// ── AAS 환경 (가공기 1대): 명판 · 기술 데이터 · 운영 데이터(최신 센서) · 공구 상태 · 예지보전(판단 기록) · 시계열(IDTA 02008) ─────────────────
const BASE = 'https://metafactory.camtic.or.kr/aas';
const ext = (value) => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] });
const XS = (v) => (typeof v === 'number' ? 'xs:double' : typeof v === 'boolean' ? 'xs:boolean' : 'xs:string');
const P = (idShort, value, desc) => ({ modelType: 'Property', idShort, ...(desc ? { description: [{ language: 'ko', text: desc }] } : {}), valueType: XS(value), ...(value != null ? { value: String(value) } : {}) });
const C = (idShort, value) => ({ modelType: 'SubmodelElementCollection', idShort, value });
const safe = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_');
export function machineEnvironment(mon, id, { iso = (t) => new Date(Date.UTC(2026, 9, 21, 8) + t * 1000).toISOString(), recent = 120 } = {}) {
  const M = mon.m[id]; if (!M) return null;
  const snap = mon.snapshot(id), aid = `ADP-${id}`, spec = MACHINE_SPECS[MACHINE_BY_TYPE[mon.Z.cells[id].type]] ?? {};
  const sm = (n) => `${BASE}/${aid}/sm/${n}`, names = ['Nameplate', 'TechnicalData', 'OperationalData', 'ToolCondition', 'PredictiveMaintenance', 'TimeSeries'];
  const shell = { modelType: 'AssetAdministrationShell', idShort: `AAS_${safe(aid)}`, id: `${BASE}/${aid}`, description: [{ language: 'ko', text: `${snap.machine} — ${snap.proc}` }],
    assetInformation: { assetKind: 'Instance', globalAssetId: `${BASE}/asset/${aid}`, assetType: 'MachiningCenter' }, submodels: names.map((n) => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value: sm(n) }] })) };
  const S = (n, sem, els) => ({ modelType: 'Submodel', idShort: n, id: sm(n), kind: 'Instance', semanticId: ext(sem), submodelElements: els });
  const sens = MON_SENSORS.map((s) => P(s.key, snap.sensors?.[s.key] ?? null, `${s.label}${s.unit ? ` [${s.unit}]` : ''} · ${s.dev}`));
  const recs = M.hist.slice(-recent);
  const submodels = [
    S('Nameplate', 'https://admin-shell.io/zvei/nameplate/2/0/Nameplate', [P('ManufacturerName', spec.manufacturer ?? '-'), P('ManufacturerProductDesignation', spec.model ?? snap.machine), P('SerialNumber', aid), P('YearOfConstruction', '2026')]),
    S('TechnicalData', 'https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2', [P('Process', snap.proc), P('RatedSpindleSpeed_rpm', MON_MACHINES[id].rpm), P('Tooling', MON_MACHINES[id].tool),
      C('ConditionMonitoringSensors', MON_SENSORS.map((s) => C(s.key, [P('Label', s.label), P('Unit', s.unit), P('Device', s.dev), ...(s.warn ? [P('Warning', s.warn.hi ?? s.warn.lo), P('Alarm', s.alarm?.hi ?? s.alarm?.lo ?? null)] : [])])))]),
    S('OperationalData', 'https://admin-shell.io/idta/OperationalData/1/0', [P('Timestamp', iso(snap.t)), ...sens, P('AnomalyScore', snap.anomaly, '엣지 AI 이상 점수 (0 정상 · 1 경고선 · 2 경보선)')]),
    S('ToolCondition', 'https://metafactory.camtic.or.kr/sem/ToolCondition/1/0', snap.tool ? [P('ToolId', snap.tool.id), P('WearRatio', snap.tool.wear), P('PartsMachined', snap.tool.parts), P('NominalLifeParts', snap.tool.life),
      P('FlankWearVB_um', snap.sensors?.toolVB), P('ChippingScore', snap.sensors?.toolChip), P('LengthDeviation_um', snap.sensors?.toolLength), P('RemainingParts', snap.rul?.parts), P('RemainingMinutes', snap.rul?.min), P('InChange', snap.tool.changing)] : [P('ToolId', null)]),
    S('PredictiveMaintenance', 'https://metafactory.camtic.or.kr/sem/PredictiveMaintenance/1/0', [P('Decision', snap.decisionKo), P('SpindleRemainingMinutes', snap.rul?.spindleMin), P('Model', '엣지 AI — 기준선 이상 점수 + 마모 추세 회귀'),
      C('Recommendations', M.records.slice(0, 20).map((r) => C(safe(r.id), [P('Time', iso(r.t)), P('Decision', r.decisionKo), P('WorkType', r.workType), P('Reason', r.reason), P('Action', r.action), P('ReportedTo', '공장 오케스트레이터 (FacOS)')])))]),
    S('TimeSeries', 'https://admin-shell.io/idta/TimeSeries/1/1', [C('Segments', [C('InternalSegment', [P('RecordCount', recs.length), P('StartTime', recs[0] ? iso(recs[0].t) : null), P('EndTime', recs.at(-1) ? iso(recs.at(-1).t) : null),
      C('Records', recs.map((h, k) => C(`Record${k + 1}`, [P('Time', iso(h.t)), ...MON_SENSORS.map((s) => P(s.key, h[s.key] ?? null))])))])])]),
  ];
  return { assetAdministrationShells: [shell], submodels, conceptDescriptions: [] };
}
export function machineCSV(mon, id) {
  const M = mon.m[id]; if (!M) return '';
  return ['t_sim_s,' + MON_SENSORS.map((s) => s.key).join(','), ...M.hist.map((h) => [h.t, ...MON_SENSORS.map((s) => h[s.key] ?? '')].join(','))].join('\n');
}
