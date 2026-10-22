// Factory OS — 공장 · 존 · 셀 · 엣지 오케스트레이터 계층 (llm-wiki 「팩토리OS의 오케스트레이터·에이전트 공장·존·셀 분류」 10/15 · 「셀·존·공장 운영 계층」 Ver5 · V12)
// 1단계: 정밀조립Zone
//  · 공장 오케스트레이터 (FacOS): 오더 배정·종료(존 증빙 확인) · 결정 요청 처리(정비 인력 Zone 간 지원 · 납기 위험 · 정책 승인 · 정밀검사 우선순위 · 응답 시간 초과) · 방송
//    Agent Gateway = 가드레일(계층 권한표) · 탐색(에이전트 등록부·역량) · 라우팅. 모든 에이전트 간 메시지를 A2A 기록으로 남긴다
//  · 존 오케스트레이터 — 정밀조립 = Manufacturing Agent (로컬 오케스트레이터, 정밀조립 v3): 존 에이전트(Field Logistics · 품질 · 정비 · 흐름) 제안 승인,
//    수량 정산(고유 투입 = 공정중 + 합격대기 + HOLD·재작업 + 인계완료 + 폐기), 오더 진행·납기 위험 감시, 공장 에스컬레이션
//  · 셀 오케스트레이터 = 셀 OCS: 셀 상태머신(IDLE · READY · RUN · DONE · HOLD · RECOVER · SAFE-STOP) · 명령 검증(정비·보정·현장 명령 승인/거부 사유)
//  · 엣지 = 스킬 (VLA 파지·장착 · 위치정합 · 체결 판정 · 압입 · 동작 감시 · 설비 LLM · 인터록 규칙)
// 원칙: 명령은 위 → 아래, 상태는 아래 → 위, 같은 계층(존 ↔ 존)은 핸드셰이크·알림만 — 결정이 필요한 일은 공장으로. 접수 ACK만으로 재개하지 않는다.
// 렌더링과 분리 — 헤드리스에서도 같은 흐름. 시뮬레이션 난수를 쓰지 않는다 (기록·정산·결정 경로만 더한다).
import { ZONE_LABEL, zoneDef } from './zonedefs.js';

const clk = (t) => { const s = Math.floor(t) + 8 * 3600; return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ── 셀 OCS 상태머신 (V12) ─────────────────
export const OCS = {
  IDLE: { ko: '대기', tone: 'idle' }, READY: { ko: '준비 완료', tone: 'info' }, RUN: { ko: '실행', tone: 'good' }, DONE: { ko: '완료·인계 대기', tone: 'info' },
  HOLD: { ko: '보류', tone: 'warn' }, RECOVER: { ko: '복구', tone: 'bad' }, 'SAFE-STOP': { ko: '안전 정지', tone: 'bad' },
};
export function ocsState(st) {
  const s = st.state;
  if (s === 'ESTOP' || s === 'PSTOP') return 'SAFE-STOP';
  if (s === 'DOWN' || s === 'MAINT' || s === 'CHECK') return 'RECOVER';
  if (s === 'BUSY') return 'RUN';
  if (s === 'BLOCKED') return 'DONE';
  if (s === 'STARVED') return 'READY';
  if (['NOAMR', 'NOPARTS', 'HOLD', 'CSTOP', 'FULL', 'REFILL'].includes(s)) return 'HOLD';
  return 'IDLE';
}
// 셀 종류별 엣지 스킬 (WP8 2차 Edge Agent 10종 → 10/13 용어 기준 "스킬")
export const EDGE_SKILLS = {
  sort: ['비전 부품 인식·판별', '피킹·키팅 (VLA)'], assembly: ['협업 조립·압입 (Force)', '위치정합 (3D Vision–CAD)', '양팔·이기종 협업 결합'],
  pressfit: ['삽입·압입 (Force)'], screw: ['스크류 체결 판정 (토크·각도)'], fasten: ['너트러너 체결 판정 (토크·각도)'], pack: ['포장·라벨 (VLA)'],
  common: ['동작 감시 (두 번째 눈)', '설비 LLM (알람 해석 · 제어 안 함)', '인터록 (규칙 · AI 아님)', 'AMR 도킹·인계'],
};

// ── A2A 메시지 · Agent Gateway ─────────────────
export const MSG = {
  'order.assign': { ko: '오더 배정', cls: 'command' }, 'order.ack': { ko: '오더 수락·계획', cls: 'event' }, 'order.evidence': { ko: '종료 증빙', cls: 'event' }, 'order.close': { ko: '오더 종료', cls: 'decision' },
  'decision.request': { ko: '결정 요청', cls: 'event' }, decision: { ko: '결정', cls: 'decision' }, broadcast: { ko: '방송', cls: 'command' }, command: { ko: '명령', cls: 'command' },
  'service.request': { ko: '서비스 요청', cls: 'handshake' }, 'service.accept': { ko: '수락', cls: 'handshake' }, 'service.result': { ko: '결과', cls: 'handshake' },
  'handover.ready': { ko: '인계 준비', cls: 'handshake' }, 'handover.ack': { ko: '인수 확인', cls: 'handshake' }, 'quality.alert': { ko: '품질 알림', cls: 'notify' },
  'quality.hold': { ko: '출하 보류·봉쇄', cls: 'event' }, 'quality.disposition': { ko: '처분 결과', cls: 'event' },
  status: { ko: '상태 보고', cls: 'event' }, ack: { ko: '수신 확인', cls: 'event' },
};
const layerOf = (ep) => (ep === 'factory' ? 0 : ep.startsWith('zone:') ? 1 : 2);
const zoneOfEp = (ep) => (ep.startsWith('zone:') ? ep.slice(5) : ep.startsWith('cell:') ? 'main' : null);
// 가드레일: 계층 권한표 — 명령은 바로 아래 계층으로만, 같은 계층은 핸드셰이크·알림만
export function allowed(from, to, type) {
  const a = layerOf(from), b = layerOf(to), C = MSG[type]?.cls;
  if (type === 'ack') return true;
  if (a === b) return a === 1 && (C === 'handshake' || C === 'notify');   // 존 ↔ 존
  if (b === a + 1) return ['command', 'decision'].includes(C) || type === 'order.assign' || type === 'order.close';   // 위 → 바로 아래
  if (a === b + 1) return C === 'event';   // 아래 → 바로 위: 결정 요청·상태·증빙
  return false;   // 계층 건너뛰기 금지
}
const EP_NAME = (ep) => (ep === 'factory' ? '공장 오케스트레이터 (FacOS)' : ep === 'zone:main' ? 'Manufacturing Agent (정밀조립)' : ep === 'zone:insp' ? '정밀검사 Orchestrator' : ep.startsWith('zone:') ? `${ZONE_LABEL[ep.slice(5)]} Zone 오케스트레이터` : ep === 'cell:*' ? '정밀조립 셀 OCS 전체' : `셀 OCS ${ep.slice(5)}`);
export const epName = EP_NAME;

export class A2ABus {
  constructor(fos) { this.fos = fos; this.log = []; this.seq = 0; this.outbox = []; this.waits = []; this.stats = { sent: 0, blocked: 0, acked: 0, timeouts: 0, queued: 0, byType: {} }; }
  get sim() { return this.fos.sim; }
  // 메시지 계약: msgId · seq · corr · from · to · type · subject(serial·lot·order) · body · authority · planVersion · t · ack
  send(from, to, type, { subject = {}, body = {}, corr = null, text = '', expect = null, timeout = 0, onTimeout = null } = {}) {
    const m = { msgId: `A2A-${String(++this.seq).padStart(6, '0')}`, seq: this.seq, corr, from, to, type, subject, body, authority: layerOf(from) === 0 ? 'factory' : zoneOfEp(from) ?? from, planVersion: this.fos.planVersion, t: this.sim.time, text, status: 'sent' };
    this.stats.byType[type] = (this.stats.byType[type] ?? 0) + 1;
    if (!allowed(from, to, type)) { m.status = 'blocked'; m.why = layerOf(from) === layerOf(to) ? '같은 계층 명령 금지 (핸드셰이크·알림만)' : '계층 건너뛰기 금지'; this.stats.blocked++; this.push(m); return m; }
    if (!this.fos.online && (from === 'factory' || to === 'factory')) { m.status = 'queued'; this.outbox.push(m); this.stats.queued++; this.push(m); return m; }   // 상위망 단절: Edge Outbox에 쌓고 승인 범위 안에서 계속
    this.stats.sent++; this.push(m);
    if (expect) this.waits.push({ m, expect, until: this.sim.time + timeout, onTimeout });
    return m;
  }
  reply(m, type, opts = {}) { return this.send(m.to, m.from, type, { ...opts, corr: m.msgId, subject: opts.subject ?? m.subject }); }
  ack(m, text = '') { if (m.status === 'sent') { m.status = 'acked'; this.stats.acked++; } return this.send(m.to, m.from, 'ack', { corr: m.msgId, subject: m.subject, text }); }
  push(m) { this.log.unshift(m); if (this.log.length > 400) this.log.pop(); this.answer(m); }
  answer(m) { if (!m.corr) return; this.waits = this.waits.filter((w) => !(w.m.msgId === m.corr && w.expect.includes(m.type))); }
  flush() { const q = this.outbox.splice(0); for (const m of q) { m.status = 'sent'; m.tFlush = this.sim.time; this.stats.sent++; } return q.length; }
  update() {
    const t = this.sim.time, due = this.waits.filter((w) => t > w.until);
    if (!due.length) return;
    this.waits = this.waits.filter((w) => t <= w.until);
    for (const w of due) { w.m.status = 'timeout'; this.stats.timeouts++; w.onTimeout?.(w.m); }
  }
}

// ── 셀 OCS (정밀조립 셀마다) ─────────────────
export class CellOCS {
  constructor(st, fos) { this.st = st; this.fos = fos; this.checks = []; this.ok = 0; this.rej = 0; }
  get state() { return ocsState(this.st); }
  record(kind, ok, reason, by) { const c = { t: this.fos.sim.time, kind, ok, reason, by }; this.checks.unshift(c); if (this.checks.length > 12) this.checks.pop(); ok ? this.ok++ : this.rej++; return c; }
}
const KIND_KO = { repair: '긴급수리', pm: '예지정비', cal: '재보정', selfcal: '자율 보정', cmd: '현장 명령', changeover: '품목 전환', tool: '공구 교환', condition: '조건 조정' };

// ── 존 오케스트레이터: 정밀조립 Manufacturing Agent ─────────────────
export class ManufacturingAgent {
  constructor(fos) { this.fos = fos; this.ep = 'zone:main'; this.esc = []; this.handled = 0; }
  get sim() { return this.fos.sim; }
  get name() { return 'Manufacturing Agent'; }
  // 존 에이전트 (제안) · 규칙 — 자율운영 에이전트 구조(단일 / 혼합형 다중)에 따라
  agents() {
    const s = this.sim, A = s.zoneAgent, H = s.agentHub, car = s.carriers ?? [];
    const fl = { key: 'logistics', name: 'Field Logistics Agent', role: `운반 AMR ${car.length}대 — 셀 간 이송·대기열·충전 · 선행 배차 ${s.mode.amrStage ?? 0}대`, stat: car.length ? `운반 ${car.filter((c) => c.state === 'line').length} · 복귀 ${car.filter((c) => c.state === 'return').length} · 대기 ${car.filter((c) => c.state === 'park' || c.state === 'atSrc').length} · 배터리 평균 ${Math.round(car.reduce((a, c) => a + c.battery, 0) / car.length)}%` : '컨베이어 (AMR 없음)' };
    if (H?.agents) return [fl, ...H.agents.map((a) => ({ key: a.key, name: { maint: '정비 에이전트', quality: '품질 에이전트', flow: '흐름 에이전트' }[a.key] ?? a.label, role: { maint: '예지정비 제안 (건강도·RUL·고장확률) · 사족보행 순찰 보고', quality: 'SPC Cpk 재보정 제안 · 8D 존 분석 (품질 추적)', flow: '투입 간격·병목 고속 운전·공급 차질 대응 제안' }[a.key] ?? '', stat: `제안 ${a.proposed} · 승인 ${a.approved} · 주기 ${a.period}초` })),
      { key: 'rules', name: '반사 규칙', role: '자재 배차 · 셀 절전 · AGV 충전 · 정지 설비 앞 투입 보류 (정상 반복 = 규칙)', stat: `대기 ${H.queue?.length ?? 0} · 보류 ${H.ma?.deferred ?? 0} · 거절 ${H.ma?.rejected ?? 0}`, rule: true }];
    return [fl, { key: 'single', name: A ? A.name : '작업반장 (수동 운영)', role: '정비·품질·흐름을 한 에이전트가 판단·실행 (단일 구조 — 혼합형 다중을 고르면 도메인 에이전트로 나뉨)', stat: A ? `의사결정 ${A.decisions}건` : '-' }];
  }
  // 수량 정산 — 시리얼 단위 (오더별 또는 전체)
  reconcile(orderId = null) {
    const T = this.sim.trace; if (!T) return null;
    const rs = orderId ? T.recent.filter((r) => r.order === orderId) : T.recent;
    const o = { input: rs.length, wip: 0, pass: 0, hold: 0, handed: 0, scrap: 0, good: 0 };
    for (const r of rs) {
      if (r.status === 'ng' || r.status === 'scrap') o.scrap++;   // 체결 NG 격리 · 처분 폐기 (js/serial.js)
      else if (r.hold) o.hold++;
      else if (r.status === 'ok' || r.status === 'escaped') { o.handed++; o.good++; }
      else if (r.inspection?.result === 'OK') o.pass++;
      else o.wip++;
    }
    o.err = o.input - (o.wip + o.pass + o.hold + o.handed + o.scrap);
    return o;
  }
  // 존 → 공장 에스컬레이션 (영향·증거·필요 결정)
  escalate(kind, title, body = {}, subject = {}) {
    const m = this.fos.bus.send(this.ep, 'factory', 'decision.request', { subject, body: { kind, ...body }, text: title, ...(kind === 'policy' ? {} : { expect: ['decision'], timeout: 120, onTimeout: (x) => this.fos.timeout(x) }) });   // 정책 승인은 사람 결정 — 시간 초과 없음
    this.esc.unshift({ t: this.sim.time, kind, title, msg: m.msgId }); if (this.esc.length > 30) this.esc.pop();
    if (m.status !== 'blocked') this.fos.receive(m);
    return m;
  }
  receive(m) { this.handled++; if (m.type !== 'ack') this.fos.bus.ack(m, `${this.name} 수신`); }
}

// ── 확장 Zone 오케스트레이터 공통 (유연생산 · 적응가공 · 정밀검사) ─────────────────
// 흐름(셀 작업·운반 AMR)은 화면 쪽(zones.js · inspzone.js)이 돌리고, 판단(승인 게이트·전환·공구·검사 경로)은 여기서 한다 — 헤드리스에서도 판단을 시험할 수 있게
// 셀 OCS = sim.zoneCells(설비 관리: 건강도·고장·정비) + 화면 흐름 셀 상태(작업·인계 대기·전환·공구 교환)
class ZoneOrch {
  constructor(fos, key, name, label) { this.fos = fos; this.key = key; this.ep = `zone:${key}`; this.name = name; this.label = label; this.handled = 0; this.esc = []; this.events = []; }
  get sim() { return this.fos.sim; }
  get flow() { return this.key === 'insp' ? this.sim.inspZone : this.sim.xzones?.byKey?.(this.key); }   // 앱 화면에서만 (헤드리스는 null)
  cells() { return (this.sim.zoneCells ?? []).filter((c) => c.zone === this.key); }
  flowCell(id) { const F = this.flow; return F ? (F.cells?.[id] ?? null) : null; }
  // 셀 OCS 상태: 설비 고장·정비 → RECOVER · 전환·공구 교환 → HOLD · 흐름 셀 상태(BUSY → RUN · BLOCKED → DONE · 대기 → READY)
  ocsOf(zc) {
    if (zc.state === 'DOWN' || zc.state === 'MAINT') return 'RECOVER';
    if (this.sim.cmd?.estopAll || this.sim.cmd?.pstopAll) return 'SAFE-STOP';
    const fc = this.flowCell(zc.cellId); if (!fc) return zc.busy ? 'RUN' : 'IDLE';
    if (fc.hold) return 'HOLD';
    return fc.state === 'BUSY' ? 'RUN' : fc.state === 'BLOCKED' ? 'DONE' : this.flow?.carriers?.some((c) => c.target === zc.cellId && c.state === 'move') ? 'READY' : 'IDLE';
  }
  note(text, extra = {}) { this.events.unshift({ t: this.sim.time, text, ...extra }); if (this.events.length > 30) this.events.pop(); }
  escalate(kind, title, body = {}, subject = {}) {
    const m = this.fos.bus.send(this.ep, 'factory', 'decision.request', { subject, body: { kind, ...body }, text: title, expect: ['decision'], timeout: 120, onTimeout: (x) => this.fos.timeout(x) });
    this.esc.unshift({ t: this.sim.time, kind, title, msg: m.msgId }); if (this.esc.length > 30) this.esc.pop();
    if (m.status !== 'blocked') this.fos.receive(m);
    return m;
  }
  receive(m) { this.handled++; if (m.type === 'decision') this.onDecision?.(m); if (m.type !== 'ack') this.fos.bus.ack(m, `${this.name} 수신`); }
  reconcile() {
    const F = this.flow; if (!F?.stats) return null;
    const inflight = (F.carriers ?? []).filter((c) => c.item).length, good = Object.values(F.stats.good ?? {}).reduce((a, b) => a + b, 0);
    const h = this.sim.serials?.zoneCounts(this.key) ?? { hold: 0, scrap: 0 };   // 적재 뒤 출하 보류(샘플 로트·봉쇄·재작업) · 처분 폐기 (js/serial.js)
    return { input: F.stats.released ?? 0, wip: inflight, pass: 0, hold: h.hold, handed: good - h.hold - h.scrap, scrap: h.scrap, good: good - h.scrap, err: (F.stats.released ?? 0) - inflight - good };
  }
  update() {}
}

// ── 유연생산: 전환·흐름 오케스트레이터 (thin zone · llm-wiki 10/12 도어·후드 ASSY 전환) ─────────────────
// 평소: 혼류 — 지그 ID = 품목 ID라 셀이 도착한 지그로 레시피를 자동 선택 (전환 시간 0)
// 전환 오더(공장 → 유연생산): "도어 50대 → 후드 30대" 품목 배치 — 셀마다 Wave식 PRELOAD → LAST-JOB → CHANGEOVER → FIRST-ARTICLE → RUN
// 엣지는 지그 ID · 레시피 버전 · 툴 ID 3중 일치일 때만 동작 · 레시피·모델·감시 기준선 2슬롯 · 첫물 불합격이면 공장이 롤백 판단
export const CO_TIME = { traditional: 0.8, smart: 0.45, dark: 0.3 };   // 전환 시간 = 셀 사이클 × 배율 (툴·지그 교환·레시피 적재)
export class FlexOrch extends ZoneOrch {
  constructor(fos) { super(fos, 'flex', '전환·흐름 오케스트레이터', '유연생산 Zone 오케스트레이터 (thin zone)'); this.batch = null; this.waves = []; this.recipes = {}; this.coDone = 0; this.coSum = 0; this.faFail = 0; this.faPass = 0; this.rv = { door: 3, hood: 5 }; }
  agents() {
    const F = this.flow, car = F?.carriers ?? [], b = this.batch;
    return [
      { name: '전환 계획 에이전트', role: '셀별 전환 스케줄 (Wave · PRELOAD → LAST-JOB → CHANGEOVER → FIRST-ARTICLE) · 롤백 제안', stat: b ? `${b.id} ${b.list.map((x, i) => `${i === b.idx ? '▶' : ''}${this.pl(x.product)} ${x.done}/${x.n}`).join(' → ')}` : `혼류 (지그 ID → 레시피 자동) · 전환 ${this.coDone}회` },
      { name: '품질 연계 에이전트', role: 'C06 치수·외관 NG → C07 재작업 → 재검 · 첫물 판정 · 정밀검사 샘플 요청', stat: F ? `NG ${F.stats.ng} · 첫물 합격 ${this.faPass} · 불합격 ${this.faFail}` : '화면 흐름에서 집계' },
      { name: '지그 풀 물류 에이전트', role: `품목별 지그 + 운반 AMR ${car.length || zoneDef('flex').amr.count}대 · 지그 ID = 품목 ID`, stat: F ? `운반 ${car.filter((c) => c.state === 'move').length} · 대기 ${car.filter((c) => c.state === 'park' || c.state === 'queue').length}` : '-' },
      { name: '셀 공정관리 에이전트 ×8', role: '셀 OCS: STEP 전이 · 셀 전환 실행 · 3중 일치 인터록 (지그·레시피·툴)', stat: `전환 평균 ${this.coDone ? (this.coSum / this.coDone).toFixed(0) : '-'}초`, rule: false },
    ];
  }
  pl(p) { return zoneDef('flex').products[p]?.label ?? p; }
  // 공장 → 유연생산 전환 오더
  changeoverOrder(list = [{ product: 'door', n: 50 }, { product: 'hood', n: 30 }], by = '공장 오케스트레이터') {
    const id = `ORD-F${String((this.bseq = (this.bseq ?? 0) + 1)).padStart(2, '0')}`;
    this.batch = { id, list: list.map((x) => ({ ...x, done: 0 })), idx: 0, t0: this.sim.time };
    const m = this.fos.bus.send('factory', this.ep, 'order.assign', { subject: { order: id }, body: { batches: list }, text: `${id} 전환 오더 — ${list.map((x) => `${this.pl(x.product)} ${x.n}대`).join(' → ')}` });
    this.fos.bus.send(this.ep, 'factory', 'order.ack', { corr: m.msgId, subject: { order: id }, text: `${id} 수락 — DT 사전검증 OK · 셀별 전환 스케줄 배포 (Wave)` });
    this.note(`${id} 전환 오더 수락 (${by})`);
    return this.batch;
  }
  // 투입 제품 (zones.js nextProduct): 전환 오더가 있으면 배치 순서대로
  productFor() {
    const b = this.batch; if (!b) return null;
    let x = b.list[b.idx];
    if (x.done >= x.n) {
      if (b.idx + 1 >= b.list.length) { this.note(`${b.id} 투입 완료 — 혼류로 복귀`); this.fos.bus.send(this.ep, 'factory', 'order.evidence', { subject: { order: b.id }, body: { batches: b.list }, text: `${b.id} 투입 완료 · 전환 ${this.coDone}회 · 첫물 합격 ${this.faPass}` }); this.batch = null; return null; }
      b.idx++; x = b.list[b.idx];
      this.waves.unshift({ t: this.sim.time, to: x.product, phase: 'PRELOAD', cells: {} }); if (this.waves.length > 6) this.waves.pop();
      this.note(`Wave 전환 시작 → ${this.pl(x.product)} · PRELOAD (엣지 레시피·모델 2슬롯 사전 적재)`);
    }
    x.done++; return x.product;
  }
  // 셀에 새 품목 지그 도착 (zones.js 셀 작업 시작) → 전환 필요 여부·시간 · 3중 일치 확인
  onCellStart(cell, item) {
    const prev = this.recipes[cell.id], p = item.product; this.recipes[cell.id] = p;
    if (!prev || prev === p) return 0;
    const auto = !this.batch;   // 혼류: 지그 ID → 레시피 자동 선택 (툴 공용 · 전환 시간 없음)
    const sec = auto ? 0 : Math.round(cell.cycle * (CO_TIME[this.sim.mode.key] ?? 0.45));
    const ok = true;   // 지그 ID(품목) = 레시피(품목·버전) = 툴 ID — 전환 뒤 3중 일치
    if (!auto) {
      const w = this.waves[0]; if (w) { w.phase = 'CHANGEOVER'; w.cells[cell.id] = 'CHANGEOVER'; }
      this.coDone++; this.coSum += sec; item.firstArticle = cell.id;
      this.fos.validate({ id: `FLX-${cell.id}` }, 'changeover', ok, '', `레시피 ${this.pl(p)} v${this.rv[p]} · 지그·툴 3중 일치`);
      this.note(`${cell.id} LAST-JOB 완료 → CHANGEOVER ${sec}초 (툴·지그 교환 · 레시피 ${this.pl(p)} v${this.rv[p]} 활성) → FIRST-ARTICLE`);
    }
    return sec;
  }
  // 첫물 판정 (C06 치수·외관검사 통과 순간) — 불합격이면 공장에 롤백 결정 요청
  onFirstArticle(item, pass) {
    if (!item.firstArticle) return;
    const w = this.waves[0];
    if (pass) { this.faPass++; if (w) { w.phase = 'RUN'; w.cells[item.firstArticle] = 'RUN'; } this.note(`FIRST-ARTICLE 합격 (${item.id}) → RUN`); }
    else { this.faFail++; this.note(`FIRST-ARTICLE 불합격 (${item.id}) → 공장 롤백 판단 요청`); this.escalate('first-article', `첫물 불합격 — ${item.id} (${this.pl(item.product)}) · 레시피 롤백 판단 요청`, { product: item.product, recipe: this.rv[item.product] }, { item: item.id }); }
    item.firstArticle = null;
  }
  onDecision(m) { if (m.body?.kind === 'first-article' && m.body.verdict === '롤백') { const p = m.subject?.item; this.note(`롤백 적용 — 레시피 이전 버전 슬롯 · 다음 지그부터 (${p})`); } }
}

// ── 적응가공: 적응가공 오케스트레이터 (존 ≈ 셀 · llm-wiki 적응가공 Cell 시나리오 V1.5) ─────────────────
// 가공 진단(주축 부하·진동) · 공구 감시(마모·파손 의심 → 모바일 매니퓰레이터 공구 교환) · 조건 조정(허용 범위·승인 뒤 적용 · 전/후 기록)
// · 제품 분기(CMM OK / 판정 대기 HOLD / 리워크) · 생산 계획(공구 교환·보류 반영) — 조건 변경은 엣지가 정하지 않고 오케스트레이터 승인 게이트를 거친다
export const TOOL = { life: { mill5: 70, turn: 90, deburr: 120 }, change: { traditional: 60, smart: 30, dark: 20 } };
export class AdaptOrch extends ZoneOrch {
  constructor(fos) { super(fos, 'adapt', '적응가공 오케스트레이터', '적응가공 Zone 오케스트레이터 (존 ≈ 셀)'); this.tools = {}; this.changes = []; this.conds = []; this.branch = { ok: 0, hold: 0, rework: 0 }; this.breaks = 0; this.toolN = 0; }
  agents() {
    const T = Object.entries(this.tools);
    return [
      { name: '가공 진단 에이전트', role: '주축 부하·전류·RPM·진동을 제품·공구 ID와 연결 · 이상 시 보류', stat: T.length ? T.map(([id, t]) => `${id} 진동 ${this.vib(id).toFixed(1)}`).join(' · ') : '화면 흐름에서 집계' },
      { name: '공구 감시 에이전트', role: '정상 신호 범위·누적 이력 비교 → 마모·파손 의심 → 공구 교환 제안 (모바일 매니퓰레이터)', stat: `교환 ${this.toolN} · 파손 ${this.breaks}` },
      { name: '조건 조정 에이전트', role: '절삭 조건 변경안 — 설비 허용 범위·응답속도 확인 뒤 승인·적용 (전/후·승인·결과 기록)', stat: `조건 변경 ${this.conds.length}건` },
      { name: '제품 분기 에이전트', role: 'CMM 판정: OK → 후공정 · 판정 대기 HOLD · 리워크 적합 → 재가공 / 부적합 → 격리', stat: `OK ${this.branch.ok} · HOLD ${this.branch.hold} · 리워크 ${this.branch.rework}` },
      { name: '생산 계획 에이전트', role: '정지·공구 교환·보류품 반영해 작업 순서 조정 · 로봇·AMR 목적지 재지시', stat: `공구 교환 중 ${Object.values(this.tools).filter((t) => t.changing > 0).length}셀` },
    ];
  }
  tool(cell) { return (this.tools[cell.id] ??= { wear: 0, life: TOOL.life[cell.def?.type ?? cell.type] ?? 0, parts: 0, changing: 0, cond: 1, id: `T-${cell.id}-1`, n: 1 }); }
  vib(id) { const t = this.tools[id]; return t ? 0.8 + t.wear * 3.2 : 0; }
  machining(cell) { return !!TOOL.life[cell.def?.type ?? cell.type]; }
  // 셀 작업 시작 전: 공구 교환 중이면 대기 · 사이클 배율(조건 조정)
  beforeCell(cell) { if (!this.machining(cell)) return { hold: 0, mul: 1 }; const t = this.tool(cell); return { hold: t.changing, mul: t.cond }; }
  // 가공 1개 끝 (zones.js) — 마모 누적 · 진동 · 공구 감시 · 조건 조정 제안 → 승인 게이트
  afterCell(cell, item, rng = Math.random) {
    if (!this.machining(cell)) return null;
    const t = this.tool(cell); t.parts++;
    t.wear += (1 / t.life) * (0.8 + rng() * 0.4) * (t.cond > 1 ? 0.8 : 1);
    let out = null;
    if (t.wear >= 1) { this.breaks++; out = 'break'; this.note(`${cell.id} 공구 파손 (${t.id}) — 가공품 ${item.id} 리워크 · 긴급 공구 교환`); item.toolBreak = true; this.startChange(cell, true); return out; }
    if (t.wear >= 0.88 && !t.changing) { this.startChange(cell, false); out = 'change'; }
    else if (t.wear >= 0.6 && t.cond === 1) {
      // 조건 조정 제안 → 승인 게이트 (허용 범위: 이송 −8% · 응답 1사이클 안)
      const ok = this.sim.zoneCell?.('adapt', cell.id)?.state !== 'DOWN';
      this.fos.validate({ id: `ADP-${cell.id}` }, 'condition', ok, ok ? '' : '거부 — 셀 복구 중', '조건 조정 에이전트');
      if (ok) { t.cond = 1.06; this.conds.unshift({ t: this.sim.time, cell: cell.id, tool: t.id, before: '이송 100%', after: '이송 92% (사이클 +6%)', why: `진동 ${this.vib(cell.id).toFixed(1)}mm/s · 마모 ${(t.wear * 100).toFixed(0)}%`, result: '마모 속도 −20%' }); if (this.conds.length > 20) this.conds.pop(); this.note(`${cell.id} 절삭 조건 조정 승인 — 이송 −8% (마모 ${(t.wear * 100).toFixed(0)}%)`); out = 'cond'; }
    }
    return out;
  }
  startChange(cell, broken) {
    const t = this.tool(cell), sec = TOOL.change[this.sim.mode.key] * (broken ? 2 : 1);
    this.fos.validate({ id: `ADP-${cell.id}` }, 'tool', true, '', broken ? '긴급 공구 교환 (파손)' : '공구 감시 에이전트 제안');
    t.changing = sec; this.toolN++;
    this.changes.unshift({ t: this.sim.time, cell: cell.id, from: t.id, to: `T-${cell.id}-${t.n + 1}`, wear: Math.round(t.wear * 100), parts: t.parts, broken, sec }); if (this.changes.length > 20) this.changes.pop();
    this.note(`${cell.id} 공구 교환 ${sec}초 (${t.id} 마모 ${Math.round(t.wear * 100)}% · ${t.parts}개) — 모바일 매니퓰레이터`);
    if (this.toolN % 6 === 0) this.escalate('tool-stock', `공구 재고 보충 요청 — 교환 ${this.toolN}회 누적`, { tools: this.toolN });
  }
  tick(dt) { for (const [id, t] of Object.entries(this.tools)) if (t.changing > 0) { t.changing = Math.max(0, t.changing - dt); if (t.changing === 0) { t.wear = 0; t.parts = 0; t.cond = 1; t.n++; t.id = `T-${id}-${t.n}`; } } }
  onBranch(kind) { this.branch[kind] = (this.branch[kind] ?? 0) + 1; }
}

// ── 정밀검사: 검사 오케스트레이터 + 기능 에이전트 6종 (llm-wiki AI정밀검사(QMS) Zone 시나리오 v0.3) ─────────────────
export class InspOrch extends ZoneOrch {
  constructor(fos) { super(fos, 'insp', '정밀검사 Orchestrator', '정밀검사 Zone 오케스트레이터 (기능형 · 서비스 Zone)'); this.fb = 0; this.req = 0; }
  agents() {
    const F = this.flow, S = F?.stats, car = F?.carriers ?? [], zc = this.cells();
    const done = (id) => F?.cells?.[id]?.done ?? 0;
    return [
      { name: 'Orchestrator Agent', role: '샘플 요청 → 검사 Task 분해 · 제품별 검사 경로 · 재측정·리워크 순서', stat: S ? `요청 ${S.samples} · 대기 ${F.queue.length} · 판정 ${S.done}` : `요청 ${this.req}` },
      { name: 'Perception Agent', role: '영상·3D·센서 인식 — 비전 검사 · 3D 스캔·UT · ATOS Point Cloud', stat: F ? `비전 ${done('VIS')} · 스캔 ${done('SCAN')} · ATOS ${done('ATOS')}` : '-' },
      { name: 'Handling Agent', role: `검사 AMR ${car.length || 3}대 — 수거·도킹·셀 간 이송·정렬`, stat: F ? `이동 ${car.filter((c) => ['out', 'in', 'move'].includes(c.state)).length} · 검사 중 ${car.filter((c) => c.state === 'work').length} · 대기 ${car.filter((c) => c.state === 'park').length}` : '-' },
      { name: 'Quality & Recovery Agent', role: 'OK · 판정 불확실(O-INSPECT 재측정) · NG(공정 정지·리워크) 판단', stat: S ? `OK ${S.ok} · 불확실 ${S.unc} · NG ${S.ng}` : '-' },
      { name: 'Asset Management Agent', role: '검사 장비 가용성·교정 상태 (건강도·고장·정비)', stat: zc.length ? `가동 ${zc.filter((c) => c.state === 'OK').length}/${zc.length} · 건강도 평균 ${Math.round(zc.reduce((a, c) => a + c.health, 0) / zc.length)}%` : '-' },
      { name: 'Process Agent', role: '결과 → 생산 Zone 환류 (품질 알림 · 선행공정 조건 보정)', stat: `결과 통보 ${this.fb}` },
      { name: 'Simulation Agent', role: '검사 경로·대기 사전 검증 (다음 단계)', stat: '-', rule: true },
    ];
  }
  reconcile() { const F = this.flow; if (!F?.stats) return null; const S = F.stats, inprog = F.carriers.filter((c) => c.item).length; return { input: S.samples, wip: inprog + F.queue.length, pass: 0, hold: 0, handed: S.done, scrap: 0, good: S.ok, err: S.samples - inprog - F.queue.length - S.done }; }
}

// ── 공장 오케스트레이터 (FacOS) ─────────────────
export const ORDER_SIZE = 100;
export class FactoryOS {
  constructor(sim) {
    this.sim = sim; this.online = true; this.planVersion = 'P-1'; this.pv = 1; this.decisions = []; this.orders = []; this.oseq = 0; this.acc = 0;
    this.bus = new A2ABus(this);
    this.main = new ManufacturingAgent(this);
    this.insp = new InspOrch(this); this.flex = new FlexOrch(this); this.adapt = new AdaptOrch(this);
    this.zones = { main: this.main, insp: this.insp, flex: this.flex, adapt: this.adapt };
    this.ocs = new Map();
    for (const st of sim.processing) this.ocs.set(st.id, new CellOCS(st, this));
    for (const zc of sim.zoneCells ?? []) this.ocs.set(zc.id, new CellOCS(zc, this));   // 확장 Zone 셀 OCS (FLX-C01 · ADP-HB_MILL · QIS-VIS …)
    this.judge = { n: 0, fast: 0, sum: 0, seen: new Set() };
    sim.fos = this;
    if (sim.trace) this.issueOrder();
  }
  get name() { return '공장 오케스트레이터 (FacOS)'; }
  bump() { this.planVersion = `P-${++this.pv}`; }
  // 에이전트 등록부 (Agent Gateway 탐색) — 계층 · 소속 · 역할
  registry() {
    const s = this.sim, R = [
      { layer: 'factory', name: '공장 오케스트레이터 (FacOS)', role: '오더·납기·우선순위 · Zone 간 자원 · 전역 계획 · 결정 요청 처리 · 오더 종료' },
      { layer: 'factory', name: 'Agent Gateway', role: '가드레일(계층 권한표) · 탐색(등록부·역량) · 라우팅 · A2A 기록' },
      { layer: 'factory', name: '생산·계획 PA Agent', role: '오더 배정안 · 납기 위험 판단안 (제안)' },
      { layer: 'factory', name: 'AIOS 운영 정책 모델', role: s.aios?.on ? `오케스트레이터 운영 정책 ${s.aios.version}` : '피지컬AI 단계에서 동작' },
      { layer: 'factory', name: 'CCTV 에이전트 (공용 인지)', role: s.cctvAgent?.on ? '영상 AI 감지 → 오케스트레이터 보고' : '녹화·관제 (AI 감지 없음)' },
      { layer: 'factory', name: '보안 계층 (가드레일)', role: s.sec?.on ? 'DID 서명 · VC 권한 · OTAC 인증' : '-' },
      { layer: 'zone', zone: 'main', name: 'Manufacturing Agent', role: '정밀조립 로컬 오케스트레이터 — 존 에이전트 제안 승인 · 수량 정산 · 오더 진행 · 에스컬레이션' },
      ...this.main.agents().map((a) => ({ layer: 'zone', zone: 'main', name: a.name, role: a.role, stat: a.stat, rule: a.rule })),
      ...[this.insp, this.flex, this.adapt].flatMap((z) => [{ layer: 'zone', zone: z.key, name: z.name, role: z.label }, ...z.agents().map((a) => ({ layer: 'zone', zone: z.key, name: a.name, role: a.role, stat: a.stat, rule: a.rule }))]),
    ];
    return R;
  }

  // ── 메시지 받기 (공장) ─────────────────
  receive(m) {
    if (m.to !== 'factory') { (this.zones[zoneOfEp(m.to)] ?? null)?.receive(m); return; }
    if (m.type === 'decision.request') return this.decide(m);
    if (m.type === 'order.evidence') return this.closeOrder(m);
    if (m.type !== 'ack') this.bus.ack(m, '공장 오케스트레이터 수신');
  }
  // 결정: 대상 · 권한자 · 버전 · 제약 · 재개 조건 (결정 메시지 필수 필드)
  decision(req, verdict, text, { constraints = '', resume = '', target = null } = {}) {
    const d = { t: this.sim.time, kind: req.body.kind, verdict, text, target: target ?? req.subject, authority: '공장 오케스트레이터 (FacOS)', version: this.planVersion, constraints, resume, req: req.msgId };
    this.decisions.unshift(d); if (this.decisions.length > 40) this.decisions.pop();
    const m = this.bus.reply(req, 'decision', { body: d, text: `${verdict} — ${text}` });
    if (m.status !== 'blocked') (this.zones[zoneOfEp(req.from)] ?? null)?.receive(m);
    return d;
  }
  decide(m) {
    const k = m.body.kind;
    if (k === 'policy') { m.pendingHuman = true; return null; }   // 사람 결정(HITL) — capa.approve/hold 때 결정 메시지
    if (k === 'due-risk') { const o = this.orders.find((x) => x.id === m.subject.order); const add = Math.ceil((m.body.lateBy ?? 0) / 60) + 2; if (o) o.due += add * 60; this.bump(); return this.decision(m, '승인', `${m.subject.order} 납기 ${add}분 조정 · 우선순위 유지 (고객 협의 대상 아님)`, { constraints: `조정 1회 · ${add}분 이내`, resume: '진행률 재평가' }); }
    if (k === 'timeout') return this.decision(m, '확인', `${m.body.what ?? '응답'} 시간 초과 — 대기 연장 · 재요청 1회`, { resume: '응답 수신' });
    if (k === 'first-article') { this.bump(); return this.decision(m, '롤백', `레시피 ${m.body.product} 이전 버전 슬롯으로 롤백 · 다음 지그부터 재적용 · 첫물 재판정`, { constraints: '2슬롯 중 이전 버전 · 감시 기준선 함께', resume: '첫물 합격 보고' }); }
    if (k === 'tool-stock') return this.decision(m, '승인', `FAC 공구 발주 · 공구실 재고 보충 (교환 ${m.body.tools}회 누적)`, { constraints: '표준 공구만', resume: '입고 확인' });
    if (k === 'machine-pm') return this.decision(m, '승인', `${m.subject.cell ?? ''} 주축 예지정비 — 적응가공 정비 인력 배정 · 해당 셀 투입 보류 후 재개 (베어링 ${m.body.bearingTemp}°C · 진동 ${m.body.vibration}mm/s)`, { constraints: '정비 중 셀만 정지', resume: '정비 완료 · 진동·온도 정상' });
    if (k === 'insp-priority') return this.decision(m, '결정', m.body.mainFirst ? '정밀조립 샘플 먼저 (오더 납기 위험)' : '요청 시각 순 (FIFO) 유지', { constraints: '정밀검사 대기열 순서만' });
    return this.decision(m, '확인', '기록');
  }
  timeout(m) {
    if (m.type === 'decision.request') return;   // 결정 요청 자체가 늦으면 다시 묻지 않는다 (기록만)
    const z = this.zones[zoneOfEp(m.from)];
    if (z === this.main) this.main.escalate('timeout', `${MSG[m.type]?.ko ?? m.type} 응답 시간 초과 (${epName(m.to)})`, { what: MSG[m.type]?.ko, msg: m.msgId }, m.subject);
  }
  setOnline(on) {
    this.online = on;
    if (on) { const n = this.bus.flush(); for (const m of this.bus.log.filter((x) => x.tFlush === this.sim.time)) this.receive(m); return n; }
    return 0;
  }

  // ── 셀 OCS 명령 검증 기록 (sim.requestTech · selfCalibrate · 명령 콘솔 수신) ─────────────────
  validate(st, kind, ok, reason, by) {
    const c = this.ocs.get(st.id); if (!c) return;
    c.record(kind, ok, ok ? '승인 — 권한·인터록·안전 상태 확인' : reason, by);
  }
  // ── Zone 간 정비 지원: 요청 존 → 공장(결정 요청) → 빌려주는 존 가용 확인 → 공장 결정 → 양쪽 명령·결정 (sim.requestSupport가 같은 조건으로 판정)
  supportRequest(zk, st, kindLabel, wait) {
    return this.bus.send(`zone:${zk}`, 'factory', 'decision.request', { subject: { cell: st.uid ?? st.id }, body: { kind: 'maint-support', job: kindLabel, wait: Math.round(wait) }, text: `정비 지원 요청 — ${st.name} ${kindLabel} · 자기 Zone 정비 인력 모두 작업 중 (${Math.round(wait)}초 대기)` });
  }
  supportCheck(z, why) { return this.bus.send('factory', `zone:${z}`, 'command', { body: { kind: 'availability' }, text: `가용 확인 → ${why ?? '지원 가능'}` }); }
  supportDecide(req, ok, text, lender, tech) {
    const d = { t: this.sim.time, kind: 'maint-support', verdict: ok ? '승인' : '불가', text, target: req.subject, authority: '공장 오케스트레이터 (FacOS)', version: this.planVersion, constraints: ok ? '정비 1건 후 원 소속 복귀' : '', resume: ok ? '정비 완료 보고' : '30초 뒤 재요청' };
    this.decisions.unshift(d); if (this.decisions.length > 40) this.decisions.pop();
    if (ok) this.bus.send('factory', `zone:${lender}`, 'command', { body: { kind: 'lend', tech }, text: `${tech} 파견 지시 (${ZONE_LABEL[zoneOfEp(req.from)]} 지원)` });
    this.bus.reply(req, 'decision', { body: d, text: `${d.verdict} — ${text}` });
  }

  // ── 오더 (공장 → 정밀조립) ─────────────────
  issueOrder() {
    const s = this.sim, id = `ORD-${String(++this.oseq).padStart(3, '0')}`, cyc = s.idealCycle || 8;
    const o = { id, t0: s.time, target: ORDER_SIZE, due: s.time + ORDER_SIZE * cyc * 1.6 + 120, status: 'open', released: false, risk: false, carry: 0 };
    this.orders.unshift(o); if (this.orders.length > 20) this.orders.pop();
    const m = this.bus.send('factory', 'zone:main', 'order.assign', { subject: { order: id }, body: { target: ORDER_SIZE, due: o.due }, text: `${id} 배정 — 양품 ${ORDER_SIZE}개 · 납기 ${clk(o.due)}` });
    this.bus.send('zone:main', 'factory', 'order.ack', { corr: m.msgId, subject: { order: id }, body: { plan: '셀 능력·자재·AMR·버퍼 확인 → 투입 순서 혼류 비율대로' }, text: `${id} 수락 · 실행 계획 (투입 순서 = 혼류 비율 · 불량 보충 투입 포함)` });
    return o;
  }
  get order() { return this.orders.find((o) => o.status === 'open' && !o.released) ?? null; }
  // 투입 순간 오더 지정 (trace.release) — 남은 필요량(목표 − 양품 − 진행 중)이 없으면 다음 오더를 연다 (불량 보충 투입은 같은 오더)
  orderFor(rec) {
    let o = this.order; if (!o) o = this.issueOrder();
    const R = this.main.reconcile(o.id);
    if (R.good + R.wip + R.pass + R.hold >= o.target) { o.released = true; o = this.issueOrder(); }
    rec.order = o.id;
    return o.id;
  }
  closeOrder(m) {
    const o = this.orders.find((x) => x.id === m.subject.order); if (!o || o.status !== 'open') return;
    const R = m.body.recon, ok = R.err === 0 && R.good >= o.target;
    if (!ok) { this.bus.reply(m, 'decision', { body: { verdict: '반려' }, text: `${o.id} 증빙 반려 — 정산 오차 ${R.err}` }); return; }
    o.status = 'closed'; o.tEnd = this.sim.time; o.recon = R; o.late = o.tEnd > o.due;
    // 남은 진행 중 제품(불량 보충으로 더 넣은 몫)은 다음 오더로 넘긴다
    const T = this.sim.trace, next = this.order ?? this.issueOrder(); let n = 0;
    for (const r of T.recent) if (r.order === o.id && r.status === 'wip') { r.order = next.id; n++; }
    o.carry = n;
    this.bus.reply(m, 'order.close', { body: { recon: R, carry: n }, text: `${o.id} 종료 — 양품 ${R.good} · 폐기 ${R.scrap} · 고유 투입 ${R.input}${n ? ` · 잔여 ${n}개 ${next.id}로 이월` : ''}${o.late ? ' · 납기 초과' : ''}` });
    this.sim.log?.('ok', `오더 ${o.id} 종료`, { obs: `양품 ${R.good} · 폐기 ${R.scrap} · 투입 ${R.input} (정산 오차 0)`, act: `${this.name} 확인` });
  }

  // ── 1초마다 ─────────────────
  update(dt) {
    this.acc += dt; if (this.acc < 1) return; this.acc = 0;
    const s = this.sim;
    this.bus.update();
    if (s.xzones && !this.flex.autoIssued && s.time > 600) { this.flex.autoIssued = true; this.flex.changeoverOrder(undefined, '생산·계획 PA Agent'); }   // 유연생산 전환 오더 (앱 화면 흐름이 있을 때 · 10분 뒤 1회 — 더 보내려면 Factory OS 탭 버튼)
    if (!s.trace) return;
    // 오더 진행: 양품 목표 도달 → 존 종료 증빙 / 납기 위험 → 공장 결정 요청
    for (const o of this.orders.filter((x) => x.status === 'open')) {
      const R = this.main.reconcile(o.id);
      if (R.good >= o.target && !o.evidenced) { o.evidenced = true; const m = this.bus.send('zone:main', 'factory', 'order.evidence', { subject: { order: o.id }, body: { recon: R }, text: `${o.id} 종료 증빙 — 양품 ${R.good} · 폐기 ${R.scrap} · 진행 중 ${R.wip + R.pass} · HOLD ${R.hold} · 투입 ${R.input} (오차 ${R.err})` }); if (m.status === 'sent') this.closeOrder(m); else o.evidenced = false; continue; }
      if (!o.risk && s.time - o.t0 > 300) {
        const rate = this.rate(); if (rate <= 0) continue;
        const eta = s.time + (o.target - R.good) / rate;
        if (eta > o.due + 30) { o.risk = true; this.main.escalate('due-risk', `${o.id} 납기 위험 — 예상 완료 ${clk(eta)} > 납기 ${clk(o.due)}`, { eta, lateBy: eta - o.due, good: R.good, target: o.target }, { order: o.id }); }
      }
    }
    // 이상 판단 시간 (정밀조립 설비 고장·품질 불량 인시던트: 발생 → 판단 단계) — 운영 KPI 10초
    for (const inc of s.orch.incidents) {
      if (inc.zone !== 'main' || this.judge.seen.has(inc.id) || !['equipment', 'defect'].includes(inc.type)) continue;
      const d = inc.steps.find((x) => x.kind === 'decide'); if (!d) continue;
      this.judge.seen.add(inc.id); const dt0 = d.t - inc.t0; this.judge.n++; this.judge.sum += dt0; if (dt0 <= 10) this.judge.fast++;
    }
  }
  rate() { const T = this.sim.trace, t = this.sim.time, w = Math.min(900, t); const n = T.recent.filter((r) => (r.status === 'ok' || r.status === 'escaped') && r.tEnd > t - w).length; return n / Math.max(60, w); }

  // ── 정밀검사 샘플링 핸드셰이크 (inspzone.js — 앱 화면에서만) ─────────────────
  sampleRequest(req) {
    const zk = req.zone, T = this.sim.trace, H = this.sim.serials; let serial = null;
    if (H) { const u = H.sample(req); serial = u ? H.idOf(u) : null; }   // 적재 재고에서 샘플 시리얼 지정 + 그 로트 출하 보류 (검사 결과가 올 때까지 — 미수신 자동 OK 금지)
    else if (zk === 'main' && T) { const r = T.recent.findLast((x) => x.status === 'ok' && x.product === req.product && !x.hold && !x.sampled); if (r) { r.sampled = req.id; r.hold = 'sample'; serial = r.serial; } }
    req.serial = serial;
    const m = this.bus.send(`zone:${zk}`, 'zone:insp', 'service.request', { subject: { serial, sample: req.id }, body: { service: 'sampling-inspection', product: req.product }, text: `샘플 검사 요청 ${req.id}${serial ? ` · ${serial}` : ''}`, expect: ['service.accept'], timeout: 900, onTimeout: (x) => this.timeout(x) });
    req.msg = m.msgId; this.insp.handled++; this.insp.req++;
    return m;
  }
  sampleAccept(req, amr) { return this.bus.send('zone:insp', `zone:${req.zone}`, 'service.accept', { corr: req.msg, subject: { serial: req.serial, sample: req.id }, body: { amr }, text: `수락 — ${amr} 수거 출발` }); }
  sampleHandover(it) {
    const a = this.bus.send(`zone:${it.zone}`, 'zone:insp', 'handover.ready', { corr: it.msg, subject: { serial: it.serial, sample: it.id }, text: `인계 준비 — 적재장 샘플 ${it.id}` });
    return this.bus.send('zone:insp', `zone:${it.zone}`, 'handover.ack', { corr: a.msgId, subject: { serial: it.serial, sample: it.id }, text: '인수 확인 — 시리얼 대조' });
  }
  sampleResult(it, res) {
    const T = this.sim.trace, r = it.serial ? T?.byId.get(it.serial) : null;
    this.insp.fb++;
    this.sim.serials?.result(it, res);   // 로트 보류 해제 · NG면 봉쇄·처분(MRB)·선별검사 · 확장 Zone 간이 8D (js/serial.js)
    this.bus.send('zone:insp', `zone:${it.zone}`, 'service.result', { corr: it.msg, subject: { serial: it.serial, sample: it.id }, body: { result: res }, text: `결과 ${res === 'ng' ? 'NG' : 'OK'} — ${it.id}` });
    if (res !== 'ng') { if (r && r.hold === 'sample') r.hold = null; return; }   // (시리얼 서비스가 이미 해제 — 기본 라인 대비)
    const qa = this.bus.send('zone:insp', `zone:${it.zone}`, 'quality.alert', { corr: it.msg, subject: { serial: it.serial, sample: it.id }, body: { result: 'NG', by: 'Quality & Recovery Agent' }, text: `품질 알림 — 샘플 ${it.id} NG (Quality & Recovery Agent)` });
    const z = this.zones[it.zone]; z?.receive(qa);
    if (it.zone === 'main' && r) { r.hold = 'sample-ng'; T.openSampleCase?.(r, it); }
  }
  // 정밀검사 대기열에 여러 Zone 요청이 함께 있으면 공장이 순서를 정한다 (정밀조립 오더 납기 위험이면 정밀조립 먼저)
  inspPriority(queue) {
    const zs = new Set(queue.map((q) => q.zone)); if (zs.size < 2 || !zs.has('main') || this.prioAsked > this.sim.time - 120) return queue;
    this.prioAsked = this.sim.time;
    const mainFirst = this.orders.some((o) => o.status === 'open' && o.risk);
    const m = this.bus.send('zone:insp', 'factory', 'decision.request', { body: { kind: 'insp-priority', mainFirst, queue: queue.map((q) => q.id) }, text: `검사 대기열 여러 Zone (${[...zs].map((z) => ZONE_LABEL[z]).join('·')}) — 순서 결정 요청` });
    if (m.status === 'sent') this.decide(m);
    return mainFirst ? [...queue.filter((q) => q.zone === 'main'), ...queue.filter((q) => q.zone !== 'main')] : queue;
  }
  // ── 8D 정책 승인 (capa.js) ─────────────────
  policyRequest(k) {
    const m = this.main.escalate('policy', `${k.id} 대책 정책 반영 승인 요청 — ${k.proposal?.title ?? ''}`, { capa: k.id, proposal: k.proposal?.title }, { capa: k.id });
    k.fosReq = m;
  }
  policyDecision(k, verdict, by) {
    const m = k.fosReq; if (!m || m.status === 'blocked') return;
    this.bump();
    this.decision(m, verdict === 'approve' ? '승인' : '보류', `${k.id} ${verdict === 'approve' ? `정책 반영 — ${k.proposal?.title}` : '정책 미반영'} (${by})`, { constraints: verdict === 'approve' ? '반영 후 20분 효과 검증 · 되돌리기 가능' : '', resume: verdict === 'approve' ? 'D6 검증 결과 보고' : '' });
  }
  // KPI 요약
  kpi() {
    const R = this.main.reconcile(), J = this.judge, B = this.bus.stats, oc = [...this.ocs.values()];
    return { recon: R, judgeRate: J.n ? J.fast / J.n : null, judgeAvg: J.n ? J.sum / J.n : null, judgeN: J.n, ocsOk: oc.reduce((a, c) => a + c.ok, 0), ocsRej: oc.reduce((a, c) => a + c.rej, 0), msgs: B.sent, blocked: B.blocked, timeouts: B.timeouts, queued: this.bus.outbox.length, esc: this.main.esc.length, decisions: this.decisions.length, orders: this.orders.filter((o) => o.status === 'closed').length };
  }
}
export { KIND_KO, clk as fosClock };
export const ZONE_ORCH_KEYS = ['main', 'insp', 'flex', 'adapt'];
