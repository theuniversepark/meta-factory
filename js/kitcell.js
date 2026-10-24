// 유연생산 C01 공급·키팅 — 키팅 구역(흐름 랙 슈퍼마켓 · 피킹 로봇 · 키트 조립대 · 검증대) → 라인사이드 컨베이어(트레이 정지 2곳 · 보울 피더) → C01 협동로봇 장착 — DOM 없음 (헤드리스 시험 가능)
//  · 키트: 판넬 한 대분 부품(후드 · 도어별)을 트레이 2개(로봇마다 1개)에 나눠 담는다 — C01 사이클 동안 다음 판넬 키트를 미리 담고 검증해 컨베이어 대기 자리로 보낸다 (zones.js kitAnim)
//  · 피지컬AI(dark): ① 빈 피킹(VLA — 상자 속 섞인 부품을 비전으로 · 새 부품 무교시) ② 키트 검증 AI(영상 + 무게 — 누락·사양 오류·뒤집힘을 잡아 키팅 구역에서 다시 담음)
//                    ③ 순서 연동 선행 피킹(혼류 순서가 바뀌면 키트를 다시 짬) ④ C01 적응 장착(트레이 위 위치 편차 비전 보정 · 힘 제어 안착) ⑤ 흐름 랙 재고 비전 계수 → 칸반 보충 선요청
//                    ⑥ 보울 피더 감시(진동·레벨로 막힘을 미리 알고 쉬는 동안 처리)
//    자동화(smart): 레일 협동로봇 · 표시등 피킹(pick-to-light, 칸이 정해진 부품만) · 무게 검증(같은 무게의 다른 사양은 못 잡음 → C01에서 발견해 다시 가져옴) · 칸반 카드 보충 · 피더 막히면 멈춤
//    레거시: 작업자 키팅 · 육안 확인 · 빈 칸이 보여야 보충
//  · 데이터: 가공기 감시(js/machmon.js)와 같은 묶음 → 서버 저장 · 내장 MQTT(metafactory/kit/v1/flex/C01) · 패킷 캡처
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const KIT_CELL = 'C01';
export const KIT_TOPIC = `metafactory/kit/v1/flex/${KIT_CELL}`;
// 부품 (판넬 한 대분 · 흐름 랙 번호 · 무게 g) — 같은 무게의 다른 사양(좌/우 · 차종)이 섞여 있어 무게만으로는 못 가른다
export const KIT_PARTS = {
  hood: [['힌지 보강판 L', 0, 420], ['힌지 보강판 R', 0, 420], ['래치 브래킷', 1, 260], ['스트라이커 보강재', 1, 310], ['실러 받침 브래킷', 2, 140], ['범퍼 스토퍼 브래킷', 2, 120]],
  door: [['힌지 보강판 상', 0, 480], ['힌지 보강판 하', 0, 480], ['체크 링크 브래킷', 1, 230], ['스피커 브래킷', 1, 190], ['와이어 클립 브래킷', 2, 90], ['미러 보강판', 2, 210]],
};
export const KIT_RACKS = ['보강판 · 힌지 보강', '브래킷 (래치 · 체크 링크)', '소형 브래킷 · 클립'];
export const KIT_SPEC = {
  model: '키팅 구역 (흐름 랙 3대 · 키트 조립대 · 비전·무게 검증대) + 라인사이드 컨베이어 · 보울 피더 2대', asset: `FLX-${KIT_CELL}-KIT`,
  rackCap: 60, reorder: { dark: 0.35, smart: 0.2, traditional: 0 },   // 흐름 랙 칸당 용량 · 보충 요청 문턱 (남은 비율 — 레거시는 빈 칸이 보여야)
  pickErr: { dark: 0.004, smart: 0.015, traditional: 0.03 },   // 키트 1개당 잘못 담을 확률 (누락 · 다른 사양)
  sameWeight: 0.6,   // 잘못 담은 것 중 무게로 못 잡는 비율 (좌/우 · 사양 차이)
  missDelay: 12, jamDelay: 20, stockoutDelay: 15,   // C01에서 발견했을 때 다시 가져오는 시간 · 피더 막힘 처리 · 레거시 결품 대기 (초)
  jam: { smart: 0.006, traditional: 0.01 },   // 키트 1개당 피더 막힘 확률 (레거시는 피더 관리가 늦어 더 잦음 · 피지컬AI는 자동화와 같은 설비라 같은 확률이지만 미리 처리)
};
export const KIT_SENSORS = [
  { key: 'weight', label: '키트 무게', unit: 'g', dev: '검증대 로드셀' },
  { key: 'vision', label: '키트 영상 판정 신뢰도', unit: '%', dev: '검증대 카메라 (부품 종류·방향)', warn: { lo: 90 }, alarm: { lo: 80 } },
  { key: 'feedVib', label: '보울 피더 진동', unit: 'mm/s', dev: '가속도계 (보울 피더 2대 평균)', warn: { hi: 9 }, alarm: { hi: 12 } },
  { key: 'feedLevel', label: '보울 피더 레벨', unit: '%', dev: '레벨 센서 (클립·너트)', warn: { lo: 25 }, alarm: { lo: 10 } },
  { key: 'stock', label: '흐름 랙 최소 재고', unit: '%', dev: '랙 비전 계수 (피지컬AI) · 칸반 카드 (자동화)', warn: { lo: 25 }, alarm: { lo: 10 } },
  { key: 'grasp', label: '피킹 성공률', unit: '%', dev: '피킹 로봇 그리퍼 센서', warn: { lo: 97 }, alarm: { lo: 94 } },
];
// C01 진행률 구간 (zones.js): 트레이가 정지 자리로 (0 ~ 0.06) · 장착 (CELL_WORK 0.1 ~ 0.85) · 빈 트레이 회수 (0.86 ~ 0.95) / 키팅: 다음 키트 담기 (0.1 ~ 0.8) · 검증 (0.8 ~ 0.88) · 컨베이어 대기 자리로 (0.88 ~ 0.96)
export const KIT_T = { inEnd: 0.06, pick: [0.1, 0.8], verify: [0.8, 0.88], feed: [0.88, 0.96], out: [0.86, 0.95] };
export const kitPhase = (p) => (p < KIT_T.pick[0] ? 'present' : p < KIT_T.pick[1] ? 'mount' : p < KIT_T.verify[1] ? 'verify' : 'feed');
export const KIT_PHASE_KO = { present: '키트 트레이 정지 자리로', mount: '키트에서 집어 판넬에 장착 · 다음 키트 담는 중', verify: '다음 키트 검증 (영상 · 무게)', feed: '빈 트레이 회수 · 다음 키트 대기 자리로' };

export class KitMonitor {
  constructor(sim) {
    this.sim = sim; this.rnd = mulberry(20261027); this.acc = 0; this.seq = 0;
    this.latest = {}; this.levels = {}; this.hist = []; this.records = []; this.events = []; this.cur = null;
    this.stock = KIT_RACKS.map(() => KIT_SPEC.rackCap); this.reqd = KIT_RACKS.map(() => false); this.feed = [0.9, 0.85]; this.feedVib = [4, 4];
    this.stats = { kits: 0, errors: 0, caught: 0, missed: 0, repick: 0, vla: 0, jams: 0, jamsAvoided: 0, replenish: 0, stockouts: 0 };
    sim.kit = this;
  }
  get mode() { return this.sim.mode?.key ?? 'smart'; }
  get on() { return this.mode !== 'traditional'; }
  get ai() { return this.mode === 'dark'; }
  cell() { return this.sim.xzones?.byKey?.('flex')?.cells?.[KIT_CELL] ?? null; }
  g() { const u = 1 - this.rnd(), v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // C01 시작(zones.js): 이 판넬의 키트를 정한다 — 반환: C01이 더 기다리는 시간(초) · 키트 오류를 C01에서 발견 · 피더 막힘 · 결품
  plan(item) {
    const S = KIT_SPEC, m = this.mode, ai = m === 'dark', parts = (KIT_PARTS[item.product] ?? KIT_PARTS.hood).map(([name, rack, g]) => ({ name, rack, g }));
    let extra = 0, repick = 0;
    // 키트 담기 (재고 소모 · 보충)
    for (const p of parts) this.stock[p.rack] = Math.max(0, this.stock[p.rack] - 1);
    let stockout = false;
    this.stock.forEach((n, k) => {
      const lim = S.rackCap * S.reorder[m];
      if (!this.reqd[k] && (m === 'traditional' ? n === 0 : n <= lim)) { this.reqd[k] = true; this.stats.replenish++; this.event('replenish', `흐름 랙 ${k + 1} (${KIT_RACKS[k]}) 보충 요청 — 남은 ${n}칸 · ${ai ? '비전 계수' : m === 'smart' ? '칸반 카드' : '빈 칸 확인'}`); this.restockAt = this.restockAt ?? []; this.restockAt[k] = this.sim.time + (ai ? 240 : m === 'smart' ? 180 : 120); }
      if (n === 0) stockout = true;
    });
    if (stockout) { this.stats.stockouts++; extra += S.stockoutDelay; }
    // 잘못 담음 → 검증 (피지컬AI: 영상 + 무게로 다 잡음 → 키팅 구역에서 다시 담음 / 자동화: 무게만 — 같은 무게면 C01에서 발견 / 레거시: 육안 절반)
    const err = this.rnd() < S.pickErr[m];
    let caught = false, missed = false;
    if (err) {
      this.stats.errors++;
      const same = this.rnd() < S.sameWeight;
      caught = ai || (m === 'smart' ? !same : this.rnd() < 0.5);
      if (caught) { this.stats.caught++; repick = 1; this.stats.repick++; } else { this.stats.missed++; missed = true; extra += S.missDelay; }
    }
    // 보울 피더 막힘
    // 보울 피더 막힘 (설비 상태는 단계와 관계없이 같은 확률 — 피지컬AI는 진동으로 미리 알아 셀이 쉬는 동안 처리)
    if (this.rnd() < (m === 'traditional' ? S.jam.traditional : S.jam.smart)) {
      if (ai) { this.stats.jamsAvoided++; this.event('jam-avoid', '보울 피더 진동 상승 — 막힘 예측 · 셀 쉬는 동안 트랙 정리'); }
      else { this.stats.jams++; extra += S.jamDelay; this.event('jam', `보울 피더 막힘 — C01 ${S.jamDelay}초 멈춤 (클립 걸림 · 작업자 처리)`); }
    }
    const w = parts.reduce((a, p) => a + p.g, 0);
    const kit = {
      id: `KIT-${String(this.seq + 1).padStart(5, '0')}`, parts: parts.map((p) => p.name), weight: r2(w + this.g() * 3, 0),
      pick: ai ? { method: 'VLA 빈 피킹', conf: r2(0.95 + this.rnd() * 0.045, 3) } : m === 'smart' ? { method: '표시등 피킹 (pick-to-light)', conf: 1 } : { method: '작업자', conf: null },
      verify: ai ? { method: '영상 + 무게 AI', conf: r2(0.96 + this.rnd() * 0.035, 3) } : m === 'smart' ? { method: '무게', conf: null } : { method: '육안', conf: null },
      err, caught, missed, repick, stockout, mount: ai ? { method: '비전 보정 · 힘 제어', offset: r2(Math.abs(this.g()) * 2.5, 1), force: r2(12 + Math.abs(this.g()) * 4, 1) } : m === 'smart' ? { method: '티칭 위치', offset: null, force: r2(25 + Math.abs(this.g()) * 10, 1) } : { method: '작업자', offset: null, force: null },
    };
    if (ai) this.stats.vla++;
    item.kit = kit; this.cur = { part: item.wip ?? item.id, product: item.product, ...kit };
    return extra;
  }
  done(item) {
    const k = item.kit; if (!k) return null;
    this.stats.kits++; this.seq++;
    const rec = { id: k.id, t: r2(this.sim.time, 1), asset: KIT_SPEC.asset, part: item.wip ?? item.id, product: item.product, parts: k.parts.length, weight_g: k.weight,
      pick: k.pick.method, verify: k.verify.method, result: k.missed ? 'C01에서 발견 · 다시 가져옴' : k.caught ? '검증에서 잡아 다시 담음' : 'OK', repick: k.repick, stockout: k.stockout, mountOffset_mm: k.mount.offset, mountForce_N: k.mount.force };
    this.records.unshift(rec); if (this.records.length > 60) this.records.pop();
    (item.qx ??= {}).kit = { err: k.err ? 1 : 0, missed: k.missed ? 1 : 0 };
    if (this.on) this.emit({ topic: `${KIT_TOPIC}/part`, kind: 'record', ...rec });
    if (k.missed && this.on) this.sim.log?.('warn', `유연생산 키트 오류 — ${rec.part}`, { obs: '무게 검증을 통과한 키트에 다른 사양 부품 (C01 로봇 비전에서 발견)', dec: `${KIT_SPEC.missDelay}초 — 키팅 구역에서 맞는 부품을 다시 가져옴`, act: '키트 검증 기준 점검', zone: 'flex' });
    if (this.cur?.part === rec.part) this.cur = null;
    return rec;
  }
  event(kind, text) {
    const ev = { t: r2(this.sim.time, 1), kind, text };
    this.events.unshift(ev); if (this.events.length > 30) this.events.pop();
    if (this.on) this.emit({ topic: `${KIT_TOPIC}/event`, kind: 'event', asset: KIT_SPEC.asset, ...ev });
  }
  measure() {
    const c = this.cell(), busy = !!c && c.state === 'BUSY' && !c.fault && !c.halt, p = busy ? c.progress : 0, k = busy ? c.item?.kit : null, n = (s) => s * this.g();
    const verifying = busy && p >= KIT_T.verify[0] && p < KIT_T.verify[1];
    // 보충: 요청 뒤 일정 시간이 지나면 칸을 다시 채운다 · 피더는 쓴 만큼 줄고 낮으면 채움 · 진동은 막힘에 가까울수록 오름
    this.stock.forEach((s, i) => { if (this.reqd[i] && this.sim.time >= (this.restockAt?.[i] ?? Infinity)) { this.stock[i] = KIT_SPEC.rackCap; this.reqd[i] = false; this.event('restocked', `흐름 랙 ${i + 1} 보충 완료`); } });
    this.feed = this.feed.map((f) => (f < 0.3 ? 0.95 : f - (busy ? 0.004 : 0)));
    this.feedVib = this.feedVib.map((v) => Math.max(3, v + n(0.15) + (this.rnd() < 0.01 ? 4 : 0) - (v > 6 ? 0.3 : 0)));
    const v = {
      weight: verifying && k ? k.weight + n(2) : 0, vision: verifying && k?.verify.conf ? k.verify.conf * 100 : 100,
      feedVib: (this.feedVib[0] + this.feedVib[1]) / 2, feedLevel: Math.min(...this.feed) * 100, stock: (Math.min(...this.stock) / KIT_SPEC.rackCap) * 100,
      grasp: this.ai ? 99.5 + n(0.2) : this.mode === 'smart' ? 98.5 + n(0.3) : 100,
    };
    for (const key of Object.keys(v)) v[key] = r2(Math.max(0, Math.min(key === 'weight' || key === 'feedVib' ? 1e6 : 100, v[key])), 1);
    return { v, ph: busy ? kitPhase(p) : null };
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
    this.levels = Object.fromEntries(KIT_SENSORS.map((s) => [s.key, this.level(s, v[s.key])]));
    if (!this.on) return;
    if ((this.hist.at(-1)?.t ?? -9) <= this.sim.time - 2) { this.hist.push(this.latest); if (this.hist.length > 900) this.hist.shift(); }
    if ((this.lastQ ?? -9) <= this.sim.time - 5) { this.lastQ = this.sim.time; this.emit({ topic: KIT_TOPIC, kind: 'sample', asset: KIT_SPEC.asset, t: r2(this.sim.time, 1), phase: ph ?? 'idle', v, levels: this.levels }); }
  }
  snapshot() {
    return { spec: KIT_SPEC, sensors: this.latest, levels: this.levels, cur: this.cur, ai: this.ai, on: this.on, stats: { ...this.stats }, records: this.records.slice(0, 20), events: this.events.slice(0, 8),
      stock: this.stock.map((n, i) => ({ rack: KIT_RACKS[i], n, pct: Math.round((n / KIT_SPEC.rackCap) * 100), req: this.reqd[i] })), feed: this.feed.map((f) => Math.round(f * 100)) };
  }
  emit(item) { if (this.sim.machmon) this.sim.machmon.emit(item); else (this.outbox ??= []).push(item); }
}
