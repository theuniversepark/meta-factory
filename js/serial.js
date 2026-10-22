// 시리얼·마킹·출하 추적 + 샘플 NG 봉쇄·처분 (MES 시리얼 서비스) — 2단 ID
//  · WIP ID: 투입 순간 부여 (WIP-DT-YYMMDD-000123) — 공정 이력은 이 ID로 쌓는다
//  · 제품 시리얼: 최종 검사 합격 순간 중앙 발행기가 GTIN별 순차 발행 (DT-YYMMDD-000045 · 재사용 없음 · GS1 AI 21)
//      정밀조립 = 검사·포장셀(PACK) · 유연생산 = C06 치수·외관검사 (C06 NG품은 C07 재작업·재검 합격 때) · 적응가공 = CMM 초정밀 측정·리워크셀
//  · 마킹: 라벨 = QR + GS1 Digital Link (ISO/IEC 18004) · 금속 직접 각인 = GS1 DataMatrix (ISO/IEC 16022 · AIAG B-17)
//      마킹 직후 100% 판독 검증 — 등급 C 이상 합격 (라벨 ISO/IEC 15415 · 각인 ISO/IEC TR 29158), 실패 시 1회 재마킹, 다시 실패하면 부적합
//      마킹 시간은 셀 사이클 안에서 병렬 처리 (판정 순간 출력 시작) — 재마킹만 사이클에 더해진다
//  · 출하: 팔레트마다 SSCC(AI 00 · GS1-128 · ISO 15394) — 팔레트 ↔ 시리얼 묶음(EPCIS AggregationEvent) · 트럭 · 출하 시각
//  · 정밀검사 샘플링: 요청 순간 그 로트(직전 샘플 이후 같은 제품) 출하 보류 → OK면 해제 · NG면 봉쇄(로트 + 같은 시간대 ±10분) →
//    부적합품 처리 판정(MRB: 재작업 → 재검 합격 시 시리얼 유지 · 폐기 → 시리얼 폐기 기록) · 로트 선별검사 · 공정 보정 · 샘플링 강화(ISO 2859-1 까다로운 검사 단순화)
//    유연생산·적응가공은 간이 8D(D0~D8)를 여기서 연다 (정밀조립은 capa.js 8D)
// 렌더링과 분리 — 헤드리스 시험에서도 같은 흐름. 시뮬레이션 난수(sim.rand)를 쓰지 않는다 (자기 난수) — 생산 흐름이 그대로다.
import { qrMatrix, dataMatrix, FNC1, GS } from './codes.js';

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const GS1_PREFIX = '8800000';   // 가상 GS1 업체코드 (880 = 대한민국) — 시뮬레이션용
export const DL_HOST = 'https://id.meta-factory.example';   // GS1 Digital Link 도메인 (가상 — .example 예약 도메인)
// 제품 마스터: 코드 · 품목 참조(GTIN) · Zone · 마킹 방식 · 발행 셀
export const PRODUCTS = {
  doortrim: { code: 'DT', ref: '00001', zone: 'main', label: '도어트림', symbol: 'QR', cells: ['PACK'] },
  eaxle: { code: 'EA', ref: '00002', zone: 'main', label: 'e-axle', symbol: 'QR', cells: ['PACK'] },
  hood: { code: 'HD', ref: '00003', zone: 'flex', label: '후드', symbol: 'QR', cells: ['C06', 'C07'] },
  door: { code: 'DR', ref: '00004', zone: 'flex', label: '도어', symbol: 'QR', cells: ['C06', 'C07'] },
  hblock: { code: 'HB', ref: '00005', zone: 'adapt', label: '유압블록', symbol: 'DM', cells: ['CMM'] },
  rcover: { code: 'RC', ref: '00006', zone: 'adapt', label: '리어커버', symbol: 'DM', cells: ['CMM'] },
};
export const ZONE_KO = { main: '정밀조립', flex: '유연생산', adapt: '적응가공' };
export const MARK_CELL = { main: ['PACK'], flex: ['C06', 'C07'], adapt: ['CMM'] };
export const MARK_INFO = {
  QR: { name: 'QR 코드 라벨 (GS1 Digital Link)', std: 'ISO/IEC 18004 · 인쇄 품질 ISO/IEC 15415', how: '라벨 출력·자동 부착', sec: 3 },
  DM: { name: 'GS1 DataMatrix 레이저 각인 (DPM)', std: 'ISO/IEC 16022 ECC200 · 각인 판독 ISO/IEC TR 29158 · AIAG B-17', how: '레이저 직접 각인', sec: 6 },
};
const VERIFY_SEC = 1;
const GRADES = ['A', 'B', 'C', 'D', 'F'];
// 운영 단계별 판단·작업 시간 (초): 처분 판정(MRB — 레거시 품질 회의 · 자동화 규칙 · 피지컬AI Quality & Recovery Agent) · 선별검사 1개 · 재작업
export const MRB_T = { traditional: 1800, smart: 300, dark: 60 };
export const SORT_T = { traditional: 60, smart: 30, dark: 20 };
export const REWORK_T = { traditional: 900, smart: 600, dark: 480 };
export const REWORK_RATE = { main: 0.7, flex: 0.6, adapt: 0.5 };   // 처분: 재작업 가능 비율 (조립품은 분해해 부품 교체 · 용접부 보수 · 가공품은 치수 남은 것만 재가공) — 설계 가정
export const LOT_DEFECT = 0.15;      // 확장 Zone NG 로트 선별검사에서 개체별 불량 확률 — 설계 가정 (정밀조립은 실제 유출 불량을 잡는다)
export const WINDOW_S = 600;         // 봉쇄 범위: 샘플과 같은 시간대 ±10분
export const TIGHT_N = 3;            // 샘플링 강화: NG 뒤 다음 샘플 3회 N/2 · 3회 연속 OK면 정상 복귀
export const FIX_S = 3600;           // 공정 보정 효과 유지 시간 (확장 Zone)

// GS1 모듈러스 10 검사 숫자
export function gs1Check(d) { let s = 0; for (let i = d.length - 1, w = 3; i >= 0; i--, w = 4 - w) s += Number(d[i]) * w; return String((10 - (s % 10)) % 10); }
export const gtinOf = (p) => { const b = `0${GS1_PREFIX}${PRODUCTS[p]?.ref ?? '00009'}`; return b + gs1Check(b); };
export const ssccOf = (n) => { const b = `0${GS1_PREFIX}${String(n).padStart(9, '0')}`; return b + gs1Check(b); };
// 내용: QR = GS1 Digital Link (경로 01 → 10 → 21 · 생산일 11은 쿼리) · DataMatrix = FNC1 + 고정 길이 AI(01·11) 먼저, 가변 길이(21) 뒤 GS, 마지막 10
export function payloadOf(u) {
  const P = PRODUCTS[u.product], gtin = gtinOf(u.product), hri = `(01)${gtin}(11)${u.pdate}(21)${u.serial}(10)${u.plot}`;
  const data = P?.symbol === 'DM' ? `${FNC1}01${gtin}11${u.pdate}21${u.serial}${GS}10${u.plot}` : `${DL_HOST}/01/${gtin}/10/${encodeURIComponent(u.plot)}/21/${encodeURIComponent(u.serial)}?11=${u.pdate}`;
  return { symbol: P?.symbol ?? 'QR', data, hri, gtin };
}
export function matrixOf(u) { const p = payloadOf(u); return p.symbol === 'DM' ? dataMatrix(p.data) : qrMatrix(p.data); }
// SVG (어두운 모듈 = 한 경로) — 화면 창에 그대로 넣는다 (캔버스 없이 · 헤드리스에서도 만든다)
export function codeSVG(m, px = 3, quiet = 2) {
  const n = m.length, W = (n + quiet * 2) * px; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${n + quiet * 2} ${n + quiet * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export class SerialHub {
  constructor(sim, seed = 1) {
    this.sim = sim; this.r = mulberry((seed * 69069 + 17) >>> 0);
    this.ymd = sim.trace?.ymd ?? (() => { const d = new Date(); return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
    this.wipSeq = {}; this.serSeq = {}; this.palSeq = 0; this.lotSeq = 0; this.caseSeq = 0;
    this.units = []; this.byId = new Map(); this.fg = {}; this.lots = []; this.cases = []; this.pallets = []; this.events = []; this.jobs = [];
    this.byCell = {}; this.tight = {}; this.fix = {}; this.lastSample = {}; this.feed = []; this.feedOn = false;
    this.stats = { wip: 0, issued: 0, byZone: { main: 0, flex: 0, adapt: 0 }, relabel: 0, markNg: 0, shipped: 0, pallets: 0, lots: 0, held: 0, released: 0, sorted: 0, caught: 0, rework: 0, scrap: 0, recall: 0, cases: 0 };
    sim.serials = this;
  }
  get mode() { return this.sim.mode?.key ?? 'smart'; }
  now() { return this.sim.time ?? 0; }
  later(dt, fn) { this.jobs.push({ at: this.now() + dt, fn }); }
  update() { if (!this.jobs.length) return; const t = this.now(), due = this.jobs.filter((j) => j.at <= t); if (!due.length) return; this.jobs = this.jobs.filter((j) => j.at > t); for (const j of due) j.fn(); }
  // 기록 하나 (EPCIS 이벤트 ID urn:uuid 포함) — feed: 화면이 가져가 EPCIS 저장소(앱 내장 · 브라우저 메모리)로 보낸다 (js/epcis.js)
  ev(e) { const r = { t: this.now(), uid: uid(), ...e }; this.events.push(r); if (this.events.length > 4000) this.events.shift(); if (this.feedOn) { this.feed.push(r); if (this.feed.length > 20000) this.feed.shift(); } }
  drain() { const f = this.feed; this.feed = []; return f; }
  log(lv, title, x) { if (!this.sim.quiet) this.sim.log?.(lv, title, x); }
  idOf(u) { return u.serial ?? u.wip; }

  // ── 1단: WIP ID (투입) ─────────────────
  wipId(product) { const c = PRODUCTS[product]?.code ?? 'WP', n = (this.wipSeq[c] = (this.wipSeq[c] ?? 0) + 1); this.stats.wip++; return `WIP-${c}-${this.ymd}-${String(n).padStart(6, '0')}`; }
  // 정밀조립: trace.js 계보 기록(r)을 그대로 단위로 쓴다
  adopt(r, zone = 'main') { Object.assign(r, { zone, serial: null, epc: null, loc: 'line', hold: r.hold ?? null, mark: null, ship: null, disp: null }); this.add(r); return r; }
  // 유연생산·적응가공 (zones.js): 투입 순간 단위 만들기
  extRelease(zone, item, carrier = null) {
    const u = { wip: this.wipId(item.product), zone, product: item.product, item: item.id, serial: null, epc: null, t0: this.now(), tEnd: null, status: 'wip', loc: 'line', hold: null, carrier, steps: [], mark: null, ship: null, disp: null };
    item.wip = u.wip; this.add(u); return u;
  }
  add(u) {
    this.units.push(u); this.byId.set(u.wip, u);
    if (this.units.length > 6000) {   // 오래된 것부터 — 출하·폐기·격리가 끝난 것만 지운다 (재고·보류·공정 중은 남김)
      const i = this.units.findIndex((o) => (o.loc === 'shipped' || o.loc === 'scrap' || o.loc === 'quarantine') && !o.hold);
      if (i >= 0) { const [o] = this.units.splice(i, 1); this.byId.delete(o.wip); if (o.serial) this.byId.delete(o.serial); }
    }
  }
  unitOf(item) { return item ? this.byId.get(item.wip ?? item.serial) ?? null : null; }
  extEnter(item, cell, name) { const u = this.unitOf(item); if (!u) return; u.steps.push({ id: cell, name, tIn: this.now(), tOut: null }); }
  extDone(item, cell, result = null) { const u = this.unitOf(item); const p = u?.steps.findLast((x) => x.id === cell && x.tOut == null); if (!p) return; p.tOut = this.now(); p.cycle = Math.round((p.tOut - p.tIn) * 10) / 10; if (result) p.result = result; }

  // ── 2단: 제품 시리얼 (최종 검사 합격) + 마킹·판독 검증 ─────────────────
  isMarkCell(zone, cellId) { return (MARK_CELL[zone] ?? []).includes(cellId); }
  // 셀 작업 시작 때 마킹·판독 결과를 미리 정한다 (재마킹 시간만 사이클에 더함 — 첫 마킹은 판정과 병렬)
  plan(item) {
    const u = this.unitOf(item); if (!u || u.serial || u.mplan) return 0;
    const sym = PRODUCTS[u.product]?.symbol ?? 'QR', fail1 = this.r() < 0.005, fail2 = fail1 && this.r() < 0.1;
    const grade = (bad) => (bad ? (this.r() < 0.5 ? 'D' : 'F') : this.r() < 0.72 ? 'A' : this.r() < 0.8 ? 'B' : 'C');
    u.mplan = { sym, tries: fail1 ? 2 : 1, grades: fail1 ? [grade(true), grade(fail2)] : [grade(false)], ng: fail2 };
    return fail1 ? MARK_INFO[sym].sec + VERIFY_SEC : 0;
  }
  issue(item, at) {
    const u = this.unitOf(item); if (!u || u.serial) return u;
    if (!u.mplan) this.plan(item);
    const P = PRODUCTS[u.product], c = P?.code ?? 'WP', n = (this.serSeq[c] = (this.serSeq[c] ?? 0) + 1), t = this.now();
    u.serial = `${c}-${this.ymd}-${String(n).padStart(6, '0')}`;
    u.pdate = this.ymd; u.plot = `${this.ymd}${c}`; u.gtin = gtinOf(u.product);
    u.epc = `urn:epc:id:sgtin:${GS1_PREFIX}.0${P?.ref ?? '00009'}.${u.serial}`;
    u.tSerial = t; this.byId.set(u.serial, u); if (u.zone === 'main') this.sim.trace?.byId.set(u.serial, u);
    const pl = u.mplan, g = pl.grades.at(-1), sym = pl.sym;
    u.mark = { symbol: sym, at: at.cell, atName: at.name ?? at.cell, zone: u.zone, t, tries: pl.tries, grades: pl.grades, grade: g, ok: !pl.ng, ...(({ data, hri }) => ({ data, hri }))(payloadOf(u)) };
    delete u.mplan;
    this.stats.issued++; this.stats.byZone[u.zone] = (this.stats.byZone[u.zone] ?? 0) + 1; if (pl.tries > 1) this.stats.relabel++;
    const bc = (this.byCell[`${u.zone}:${at.cell}`] ??= { n: 0, relabel: 0, ng: 0, last: null, grades: {} }); bc.n++; if (pl.tries > 1) bc.relabel++; bc.last = u; bc.grades[g] = (bc.grades[g] ?? 0) + 1;
    this.ev({ type: 'commission', id: u.serial, wip: u.wip, zone: u.zone, cell: at.cell, symbol: sym, grade: g });
    if (pl.tries > 1) this.log('warn', `${ZONE_KO[u.zone]} ${at.name ?? at.cell} 판독 등급 ${pl.grades[0]} — ${sym === 'DM' ? '재각인' : '라벨 재부착'}`, { obs: `${u.serial} 첫 판독 ${pl.grades[0]} (합격 C 이상)`, act: pl.ng ? `재${sym === 'DM' ? '각인' : '부착'} 후에도 ${g} — 부적합 처리` : `재마킹 후 ${g} 합격` });
    if (pl.ng) this.markNg(u, bc);
    return u;
  }
  // 재마킹 후에도 판독 불가 — 라벨은 수작업 재부착 후 해제, 금속 각인은 재각인 불가(표면 손상) → 폐기
  markNg(u, bc) {
    this.stats.markNg++; bc.ng++; u.hold = 'mark'; u.mark.ok = false;
    this.later(MRB_T[this.mode] / 3, () => {
      if (u.hold !== 'mark') return;
      if (u.mark.symbol === 'QR') { u.hold = null; u.mark.grades.push('B'); u.mark.grade = 'B'; u.mark.ok = true; u.mark.manual = true; this.ev({ type: 'relabel', id: u.serial }); }
      else if (u.loc === 'line') u.scrapPending = '각인 판독 불가 — 재각인 시 표면 손상';   // 아직 운반 중 — 적재장에 닿으면 폐기 (재고로 잡히지 않게)
      else this.scrap(u, '각인 판독 불가 — 재각인 시 표면 손상');
    });
  }
  // 완제품 적재 (적재장·포장 팔레트 도착)
  toFG(item) {
    const u = item?.wip || item?.serial ? this.unitOf(item) : item; if (!u || u.loc === 'fg') return u;
    if (u.zone !== 'main') { u.status = 'ok'; u.tEnd = this.now(); }
    u.loc = 'fg'; (this.fg[u.product] ??= []).push(u);
    if (u.serial) this.ev({ type: 'store', id: u.serial, zone: u.zone });
    if (u.scrapPending) { const why = u.scrapPending; delete u.scrapPending; this.later(0, () => this.scrap(u, why)); }   // 다음 갱신에 (적재 수량이 먼저 올라간 뒤 뺀다)
    return u;
  }

  // ── 출하 (shipping.js): 보류 아닌 것만 · 팔레트 SSCC ─────────────────
  shippableUnits(p) { return (this.fg[p] ?? []).filter((u) => !u.hold && u.loc === 'fg' && u.status !== 'scrap' && u.status !== 'ng'); }
  shippable(p) { return this.shippableUnits(p).length; }
  heldIn(p) { return (this.fg[p] ?? []).filter((u) => u.hold).length; }
  take(p, k, by) {
    const us = this.shippableUnits(p).slice(0, k); if (!us.length) return null;
    const pal = { sscc: ssccOf(++this.palSeq), product: p, units: us.map((u) => this.idOf(u)), t: this.now(), by, truck: null };
    for (const u of us) { u.loc = 'loading'; this.unFG(u); u.ship = { sscc: pal.sscc }; }
    this.pallets.unshift(pal); if (this.pallets.length > 300) this.pallets.pop();
    this.ev({ type: 'aggregate', id: pal.sscc, children: pal.units });
    return { pal, units: us };
  }
  ship(lot, truck) {
    if (!lot) return; lot.pal.truck = truck; lot.pal.tShip = this.now(); this.stats.pallets++;
    for (const u of lot.units) { u.loc = 'shipped'; u.ship = { sscc: lot.pal.sscc, truck, t: this.now() }; this.stats.shipped++; }
    this.ev({ type: 'ship', id: lot.pal.sscc, truck, n: lot.units.length });
  }
  unload(lot) { if (!lot) return; for (const u of lot.units) { u.loc = 'fg'; u.ship = null; (this.fg[u.product] ??= []).unshift(u); } this.pallets = this.pallets.filter((x) => x !== lot.pal); }
  unFG(u) { const q = this.fg[u.product]; if (!q) return; const i = q.indexOf(u); if (i >= 0) q.splice(i, 1); }
  // 완제품 수량에서 빼기 (폐기·격리) — 정밀조립 구분 적재장 · 확장 Zone 포장 팔레트
  dropStock(u) {
    if (u.loc !== 'fg' && u.loc !== 'insp') return;
    this.unFG(u); const s = this.sim;
    if (u.zone === 'main') { if (s.fgBy?.[u.product] > 0) s.fgBy[u.product]--; if (s.fgStock > 0) s.fgStock--; }
    else if (s.zoneFg?.[u.product] > 0) s.zoneFg[u.product]--;
  }

  // ── 정밀검사 샘플링 (factoryos.js sampleRequest · inspzone.js) ─────────────────
  sampleEvery(zone, base) { return this.tight[zone] > 0 ? Math.max(1, Math.round(base / 2)) : base; }
  ngFactor(zone) { const f = this.fix[zone]; return f && f.until > this.now() ? f.ng : 1; }
  inlineMul(zone) { const f = this.fix[zone]; return f && f.until > this.now() ? f.inline : 1; }
  // 샘플 지정 + 로트 출하 보류 (요청 순간 · 판정 전 출하 금지)
  sample(req) {
    const key = `${req.zone}:${req.product}`, q = this.fg[req.product] ?? [];
    const s = q.findLast((u) => !u.hold && !u.sampled && u.zone === req.zone && (u.status === 'ok' || u.status === 'escaped'));
    if (!s) return null;
    s.sampled = req.id; s.hold = 'sample'; s.loc = 'insp';
    const t0 = this.lastSample[key] ?? -Infinity; this.lastSample[key] = this.now();
    const lotU = q.filter((u) => u !== s && u.zone === req.zone && !u.hold && (u.tSerial ?? u.tEnd ?? 0) > t0);
    for (const u of lotU) u.hold = `lot:${req.id}`;
    const shipped = this.units.filter((u) => u.zone === req.zone && u.product === req.product && u.loc === 'shipped' && (u.tSerial ?? 0) > t0).length;
    const lot = { id: req.id, zone: req.zone, product: req.product, sample: this.idOf(s), members: lotU.map((u) => this.idOf(u)), shippedBefore: shipped, t: this.now(), status: 'hold', result: null, tEnd: null, extra: [], recall: [], sorted: null };
    this.lots.unshift(lot); if (this.lots.length > 200) this.lots.pop();
    this.stats.lots++; this.stats.held += lotU.length + 1;
    this.ev({ type: 'hold', id: req.id, zone: req.zone, n: lotU.length + 1, ids: [s, ...lotU].map((u) => this.idOf(u)) });
    this.fosNote(req.zone, 'quality.hold', `샘플 ${req.id} 로트 출하 보류 ${lotU.length + 1}개 — ${PRODUCTS[req.product]?.label} (판정 전 출하 금지)`, { lot: req.id, n: lotU.length + 1 });
    return s;
  }
  lotOf(id) { return this.lots.find((l) => l.id === id) ?? null; }
  // 판정 결과 (factoryos.js sampleResult)
  result(req, res) {
    const lot = this.lotOf(req.id), s = lot ? this.byId.get(lot.sample) : null; if (!lot || lot.result) return;
    lot.result = res; const T = this.tight[lot.zone] ?? 0;
    if (res !== 'ng') {
      const n = this.releaseLot(lot); if (s && s.hold === 'sample') { s.hold = null; s.loc = s.loc === 'insp' ? 'fg' : s.loc; }
      lot.status = 'released'; lot.tEnd = this.now(); this.stats.released += n + (s ? 1 : 0);
      this.ev({ type: 'release', id: lot.id, zone: lot.zone, result: 'OK', ids: [lot.sample, ...lot.members] });
      if (T > 0) { this.tight[lot.zone] = T - 1; if (T === 1) { this.log('info', `${ZONE_KO[lot.zone]} 샘플링 정상 복귀`, { obs: `강화 검사 ${TIGHT_N}회 연속 OK`, act: '샘플링 주기 원래대로' }); this.closeCases(lot.zone); } }
      return;
    }
    // NG: 샘플 격리 · 봉쇄 범위 확대(같은 시간대 ±10분) · 출하된 것 = 유출 의심(회수 대상) · 샘플링 강화
    lot.status = 'contain'; this.tight[lot.zone] = TIGHT_N;
    if (s) { s.hold = 'sample-ng'; s.loc = s.loc === 'insp' ? 'insp' : s.loc; }
    const ts = s?.tSerial ?? this.now();
    for (const u of this.fg[lot.product] ?? []) if (!u.hold && u.zone === lot.zone && Math.abs((u.tSerial ?? 0) - ts) <= WINDOW_S) { u.hold = `lot:${lot.id}`; lot.extra.push(this.idOf(u)); }
    lot.recall = this.units.filter((u) => u.zone === lot.zone && u.product === lot.product && u.loc === 'shipped' && (u.tSerial ?? 0) > ts - WINDOW_S && (u.tSerial ?? 0) <= ts + WINDOW_S).map((u) => this.idOf(u));
    for (const id of lot.recall) { const u = this.byId.get(id); if (u && !u.recall) { u.recall = lot.id; this.stats.recall++; } }
    this.stats.held += lot.extra.length;
    if (lot.extra.length) this.ev({ type: 'hold', id: lot.id, zone: lot.zone, n: lot.extra.length, ids: lot.extra, why: `샘플 ${lot.sample} NG — 같은 시간대 ±10분 봉쇄` });
    this.fosNote(lot.zone, 'quality.hold', `샘플 ${lot.id} NG — 봉쇄 ${lot.members.length + lot.extra.length + 1}개 (±10분 ${lot.extra.length}개 추가) · 유출 의심 ${lot.recall.length}개 회수 대상`, { lot: lot.id, n: lot.members.length + lot.extra.length + 1, recall: lot.recall.length });
    if (lot.zone !== 'main') this.openCase(lot, s);
    // 처분 판정(MRB) → 샘플 처분 · 로트 선별검사
    const mrb = MRB_T[this.mode];
    this.later(mrb, () => { if (s) this.dispose(s, lot, '샘플'); this.sortLot(lot); });
  }
  releaseLot(lot) { let n = 0; for (const u of this.units) if (u.hold === `lot:${lot.id}`) { u.hold = null; n++; } return n; }
  // 선별검사(전수): 정밀조립은 실제 유출 불량(체결 검사를 빠져나간 것)을 잡는다 · 확장 Zone은 개체별 불량 확률(설계 가정)
  sortLot(lot) {
    const us = this.units.filter((u) => u.hold === `lot:${lot.id}`), dt = us.length * SORT_T[this.mode];
    lot.status = 'sorting'; lot.sortEnd = this.now() + dt;
    this.later(dt, () => {
      let ok = 0, bad = 0; const okIds = [];
      for (const u of us) {
        if (u.hold !== `lot:${lot.id}`) continue;
        const defect = u.zone === 'main' ? u.status === 'escaped' : this.r() < LOT_DEFECT;
        if (!defect) { u.hold = null; ok++; okIds.push(this.idOf(u)); continue; }
        bad++; this.stats.caught++;
        if (u.zone === 'main') this.catchEscaped(u, lot); else this.dispose(u, lot, '선별검사 불량');
      }
      this.stats.sorted += us.length; this.stats.released += ok;
      if (okIds.length) this.ev({ type: 'release', id: lot.id, zone: lot.zone, result: '선별검사 양품', ids: okIds });
      lot.sorted = { n: us.length, ok, bad, t: this.now() }; lot.status = 'done'; lot.tEnd = this.now();
      this.fosNote(lot.zone, 'quality.disposition', `로트 ${lot.id} 선별검사 ${us.length}개 — 양품 ${ok} 해제 · 불량 ${bad}`, { lot: lot.id, ok, bad });
      const c = this.cases.find((x) => x.lot === lot.id); if (c) this.step(c, 'D3', `선별검사 완료 — ${us.length}개 중 양품 ${ok}개 출하 보류 해제 · 불량 ${bad}개 처분`);
    });
  }
  // 정밀조립 유출 불량 회수 (capa.js recheck와 같은 정산 — 회수품은 NG로)
  catchEscaped(u, lot) {
    const T = this.sim.trace; this.dropStock(u);
    u.status = 'ng'; u.recovered = lot.id; u.hold = null; u.loc = 'quarantine';
    if (T) { T.stats.escaped--; T.stats.ng++; T.stats.recovered = (T.stats.recovered ?? 0) + 1; }
    this.ev({ type: 'quarantine', id: this.idOf(u), lot: lot.id });
  }
  // 처분 판정 (MRB): 재작업 → 재검 합격 시 시리얼 유지 · 폐기 → 시리얼 폐기(재사용 금지)
  dispose(u, lot, why) {
    const rw = this.r() < (REWORK_RATE[u.zone] ?? 0.5), how = { main: '분해·부품 교체', flex: '용접부 보수·재도포', adapt: '재가공 (치수 여유)' }[u.zone];
    if (!rw) { this.scrap(u, `${why} — 재작업 불가`); lot && this.caseOf(lot)?.disp.push({ id: this.idOf(u), d: 'scrap' }); return; }
    u.hold = 'rework'; u.disp = { d: 'rework', why, t: this.now() }; this.stats.rework++;
    lot && this.caseOf(lot)?.disp.push({ id: this.idOf(u), d: 'rework' });
    this.ev({ type: 'rework', id: this.idOf(u), lot: lot?.id });
    this.later(REWORK_T[this.mode], () => {
      if (u.hold !== 'rework') return;
      u.hold = null; u.disp.done = this.now(); if (u.loc === 'insp') u.loc = 'fg';
      if (u.zone === 'main' && u.status === 'escaped') { u.status = 'ok'; }   // 재작업으로 고쳤다 (정답 라벨 유지 — RCA 통계는 그대로)
      this.ev({ type: 'recheck', id: this.idOf(u), result: 'OK' });
      this.fosNote(u.zone, 'quality.disposition', `재작업 ${this.idOf(u)} (${how}) → 재검 합격 · 시리얼 유지 · 출하 보류 해제`, { id: this.idOf(u), d: 'rework' });
    });
  }
  scrap(u, why) {
    this.dropStock(u); if (u.loc !== 'shipped') u.loc = 'scrap';
    u.status = 'scrap'; u.hold = null; u.disp = { d: 'scrap', why, t: this.now() }; this.stats.scrap++;
    this.ev({ type: 'decommission', id: this.idOf(u), why });
    this.fosNote(u.zone, 'quality.disposition', `폐기 ${this.idOf(u)} — ${why} · 시리얼 폐기 기록 (재사용 금지)`, { id: this.idOf(u), d: 'scrap' });
  }
  // 오케스트레이터 메시지 (존 → 공장 · 상태 보고 이벤트)
  fosNote(zone, type, text, body = {}) { const F = this.sim.fos; if (!F?.bus) return; F.bus.send(`zone:${zone}`, 'factory', type, { body, text }); }

  // ── 확장 Zone 간이 8D (D0~D8) ─────────────────
  caseOf(lot) { return this.cases.find((c) => c.lot === lot.id) ?? null; }
  step(c, d, text) { c.steps.push({ t: this.now(), d, text }); c.stage = d; }
  openCase(lot, s) {
    const sim = this.sim, zone = lot.zone, P = PRODUCTS[lot.product];
    const c = { id: `ZQ-${this.ymd}-${String(++this.caseSeq).padStart(3, '0')}`, zone, product: lot.product, lot: lot.id, sample: lot.sample, t: this.now(), steps: [], stage: 'D0', status: 'open', cause: null, actions: [], disp: [] };
    this.cases.unshift(c); if (this.cases.length > 60) this.cases.pop(); this.stats.cases++;
    const G = { traditional: 45, smart: 8, dark: 2.5 }[this.mode] ?? 8;
    this.step(c, 'D0', `정밀검사 샘플 ${lot.sample} NG (${P?.label}) — 샘플 NG 선반 격리 · 시리얼 기록`);
    this.later(G, () => this.step(c, 'D1', `팀 구성 — ${({ traditional: '품질 반장 · 공정 담당', smart: 'MES 품질 모듈 · 공정 담당', dark: `${ZONE_KO[zone]} Zone 오케스트레이터 · Quality & Recovery Agent` })[this.mode]}`));
    this.later(G * 2, () => this.step(c, 'D2', `문제 기술: 무엇 ${lot.sample} · 어디 정밀검사Zone 판정 · 언제 ${clk(lot.t)} · 얼마나 직전 로트 ${lot.members.length + 1}개 · 출하된 같은 시간대 ${lot.recall.length}개`));
    this.later(G * 3, () => this.step(c, 'D3', `봉쇄 — 로트 ${lot.members.length + 1}개 + 같은 시간대 ±10분 ${lot.extra.length}개 출하 보류 · 유출 의심 ${lot.recall.length}개 회수 대상 · 처분 판정(MRB) ${Math.round(MRB_T[this.mode] / 60)}분 뒤`));
    // D4 근본 원인 후보: 샘플이 지난 셀 중 그 순간 건강도 낮은 셀 (가공 셀은 공구 마모 포함)
    const u = this.byId.get(lot.sample), cells = (u?.steps ?? []).map((p) => ({ p, zc: sim.zoneCell?.(zone, p.id) })).filter((x) => x.zc);
    const ad = sim.fos?.adapt, score = (x) => (100 - (x.zc.health ?? 100)) + (zone === 'adapt' && ad?.tools?.[x.p.id] ? ad.tools[x.p.id].wear * 60 : 0) + (x.p.id === 'C06' || x.p.id === 'CMM' ? 4 : 0);
    const top = cells.sort((a, b) => score(b) - score(a))[0];
    c.cause = top ? { cell: top.p.id, name: top.zc.name ?? top.p.name, health: Math.round(top.zc.health ?? 100), wear: ad?.tools?.[top.p.id] ? Math.round(ad.tools[top.p.id].wear * 100) : null } : { cell: zone === 'flex' ? 'C06' : 'CMM', name: '-', health: null };
    this.later(G * 4.5, () => this.step(c, 'D4', `근본 원인 후보: ${c.cause.name} — 건강도 ${c.cause.health ?? '-'}%${c.cause.wear != null ? ` · 공구 마모 ${c.cause.wear}%` : ''} (샘플 공정 이력 · 셀 상태 기준)`));
    // D5 대책 = 공정 보정 (실제 값 변경) + 샘플링 강화
    this.later(G * 5.5, () => {
      const acts = [];
      if (zone === 'flex') { this.fix.flex = { until: this.now() + FIX_S, ng: 0.5, inline: 1.3 }; acts.push('C06 치수·외관 검사 기준 강화 (판정 한계 축소 — 인라인 NG +30% · 정밀검사 NG 확률 절반, 1시간)'); }
      else {
        this.fix.adapt = { until: this.now() + FIX_S, ng: 0.5, inline: 1 };
        const t = ad?.tools?.[c.cause.cell];
        if (t && t.cond === 1) { t.cond = 1.06; ad.conds?.unshift({ t: this.now(), cell: c.cause.cell, tool: t.id, before: '이송 100%', after: '이송 92% (사이클 +6%)', why: `샘플 NG ${lot.sample}`, result: '공정 보정' }); }
        acts.push(`${c.cause.name} 절삭 조건 보정 (이송 −8%) · CMM 판정 한계 축소 (정밀검사 NG 확률 절반, 1시간)`);
      }
      const zc = sim.zoneCell?.(zone, c.cause.cell);
      if (zc && (zc.health ?? 100) < 70 && sim.mode?.pmEnabled && sim.requestTech) { try { if (sim.requestTech(zc, 'pm')) acts.push(`${zc.name ?? c.cause.cell} 예지정비 요청`); } catch { /* 정비 요청 불가 상태 */ } }
      acts.push(`샘플링 강화 — 다음 샘플 ${TIGHT_N}회 N/2 (${TIGHT_N}회 연속 OK면 정상 복귀)`);
      c.actions = acts; this.step(c, 'D5', `대책: ${acts.join(' · ')}`);
      this.log('act', `${ZONE_KO[zone]} 샘플 NG 대책 · ${c.id}`, { obs: `${lot.sample} NG · 원인 후보 ${c.cause.name}`, act: acts.join(' · ') });
    });
    this.later(G * 6.5, () => { if (c.status === 'open') { c.status = 'verify'; this.step(c, 'D6', `시행·검증: 강화 샘플링 ${TIGHT_N}회 결과로 효과 확인 중`); } });
    return c;
  }
  closeCases(zone) {
    for (const c of this.cases) if (c.zone === zone && (c.status === 'open' || c.status === 'verify')) {
      c.status = 'closed'; c.tEnd = this.now();
      this.step(c, 'D7', `재발 방지: 강화 샘플링 ${TIGHT_N}회 연속 OK — 관리계획에 "${c.actions[0] ?? '공정 보정'}" 등록`);
      this.step(c, 'D8', `종결 — 처분 ${c.disp.length}건 (재작업 ${c.disp.filter((x) => x.d === 'rework').length} · 폐기 ${c.disp.filter((x) => x.d === 'scrap').length})`);
    }
  }

  // ── 집계 ─────────────────
  zoneCounts(zone) {
    const k = Math.floor(this.now() * 2), C = (this.zcCache ??= {});   // 화면이 자주 부른다 — 시뮬레이션 0.5초 단위로 한 번만 센다
    if (C[zone]?.k === k && C[zone].n === this.units.length) return C[zone].v;
    let hold = 0, scrap = 0, rework = 0, shipped = 0;
    for (const u of this.units) { if (u.zone !== zone) continue; if (u.status === 'scrap') scrap++; else if (u.hold && u.loc !== 'line') hold++; if (u.disp?.d === 'rework') rework++; if (u.loc === 'shipped') shipped++; }
    const v = { hold, scrap, rework, shipped }; C[zone] = { k, n: this.units.length, v };
    return v;
  }
  cellSummary(zone, cell) { return this.byCell[`${zone}:${cell}`] ?? null; }
}
const uid = () => (globalThis.crypto?.randomUUID ? `urn:uuid:${globalThis.crypto.randomUUID()}` : `urn:uuid:${'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16))}`);   // EPCIS eventID — 시뮬레이션 난수와 무관
const clk = (t) => { const s = Math.floor(t) + 8 * 3600; return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export function serialsCSV(H) {
  const head = ['wip_id', 'serial', 'zone', 'product', 'gtin', 'lot', 'status', 'location', 'hold', 'symbol', 'mark_cell', 'verify_grade', 'mark_tries', 'serial_time_s', 'sscc', 'truck', 'disposition'];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head, ...H.units.map((u) => [u.wip, u.serial ?? '', u.zone, u.product, u.gtin ?? '', u.plot ?? '', u.status, u.loc, u.hold ?? '', u.mark?.symbol ?? '', u.mark?.at ?? '', u.mark?.grade ?? '', u.mark?.tries ?? '', u.tSerial != null ? Math.round(u.tSerial) : '', u.ship?.sscc ?? '', u.ship?.truck ?? '', u.disp?.d ?? ''])].map((r) => r.map(cell).join(',')).join('\n');
}
