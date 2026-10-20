import { bk, BUILDING, extraCellBoxes, inBuilding, SRV, zoneServerBoxes, INSP_CELLS, camArea } from './zonedefs.js';
import { shipToWorld, SHIP_FRAME } from './shipping.js';
import { INBOUND, XRACK, WH_RACK, MINILOAD } from './receiving.js';
// CCTV — 사각지대 없는 배치. 바닥을 1m 간격 점으로 나누고, 카메라에서 각 점까지 시야가 큰 설비(셀·창고 랙·서버 랙)에
// 가리지 않는지 따져 "보이는 점"을 구한 뒤, 아직 안 보이는 점을 가장 많이 덮는 후보 자리부터 차례로 골라(탐욕적 집합 덮개)
// 모든 점이 최소 한 대에 보일 때까지 설치한다. 건물 안은 Zone별로 나눠(정밀검사 → 유연생산 → 적응가공 → 정밀조립 → 공용 시설, zonedefs.js camArea) Zone 바닥을 그 Zone 천장 카메라로만 덮고,
// 동점 처리를 바꿔 여러 번 돌린 뒤 빼도 사각지대가 안 생기는 카메라를 덜어 가장 적은 대수를 고른다 (Zone CCTV 전광판 = 그 Zone 카메라). 건물 안은 천장 돔 카메라(높이 7.5m, 반경 9m 어안),
// 입고·출하 트럭 야드는 외벽·야드 가장자리 기둥의 실외 PTZ 돔 카메라(높이 7.5m, 줌 반경 20m).
// 라인 배치(셀 위치)가 바뀌면 다시 계산하고, 같은 배치는 캐시를 쓴다. 렌더링과 분리되어 헤드리스에서도 같은 결과.
// 피지컬AI 단계에서는 CCTV 영상 AI 분석으로 현장 이벤트를 2초 안에 감지한다 (sim.updateFieldEvents).

const STEP = 1;                          // 바닥 점 간격 (m)
const EYE = 0.3;                         // 점 높이 — 바닥 가까이까지 보이는지로 판정 (엄격)
export const CCTV_SPEC = {
  dome: { label: '천장 돔 카메라 (어안 360°)', y: 7.5, R: 9 },
  outdoor: { label: '실외 PTZ 돔 카메라 (줌)', y: 7.5, R: 20 },
};
const cache = new Map();

// 시야를 가리는 큰 설비 (바닥 점유 영역 + 높이)
function obstacles(sim) {
  const ob = [];
  for (const st of sim.stations) {
    if (st.standby) continue;
    const h = st.type === 'source' ? 3.2 : st.type === 'sink' ? 2.6 : 2.9;
    ob.push({ x0: st.x - 2.3, x1: st.x + 2.3, z0: st.z - 2.3, z1: st.z + (st.type === 'source' ? 3.1 : 2.3), h, name: st.name });
  }
  const mx0 = WH_RACK.x - MINILOAD.half, mx1 = WH_RACK.x + MINILOAD.half;
  ob.push({ x0: mx0, x1: mx1, z0: WH_RACK.z - 5.1, z1: WH_RACK.z + 5.1, h: MINILOAD.top, name: '물류 선반 (미니로드 ①)' });   // 지게차 통로와 로봇 통로 사이 남북 방향 두 줄 4단 선반
  ob.push({ x0: mx0, x1: mx1, z0: XRACK.z - XRACK.len / 2, z1: XRACK.z + XRACK.len / 2, h: MINILOAD.top, name: '확장 선반 (미니로드 ②)' });   // 물류 선반 북쪽 (A-1·A-2 자재)
  ob.push({ x0: SRV.x - 0.55, x1: SRV.x + 0.55, z0: SRV.z - 2.2, z1: SRV.z + 2.2, h: 2.3, name: '정밀조립 데이터 서버 랙' });   // 왼쪽 벽 앞 (zonedefs.js SRV)
  ob.push(...zoneServerBoxes());   // A-1 · A-2 데이터 서버 랙 (뒷벽 · 오른쪽 벽 앞)
  ob.push(...Object.values(INSP_CELLS).map((c) => ({ x0: c.x - 2.3, x1: c.x + 2.3, z0: c.z - 2.3, z1: c.z + 2.3, h: 2.8, name: `정밀검사 ${c.label}` })));   // 정밀검사Zone 셀
  ob.push(...extraCellBoxes());   // 유연생산·적응가공 Zone 셀   // 중앙 관제 디스플레이 가운데 아래
  return ob;
}
// 선분(카메라→점)이 상자(바닥 영역 × 0~h)를 지나는지 — 슬래브 방식
export function blocked(c, p, ob) {
  for (const b of ob) {
    if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) continue;   // 점이 그 설비 위면 판정 제외
    let t0 = 0, t1 = 1;
    for (const [o, d, lo, hi] of [[c.x, p.x - c.x, b.x0, b.x1], [c.y, (p.y ?? EYE) - c.y, 0, b.h], [c.z, p.z - c.z, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
      let a = (lo - o) / d, e = (hi - o) / d; if (a > e) [a, e] = [e, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, e); if (t0 > t1) break;
    }
    if (t0 <= t1 && t1 > 0 && t0 < 1) return true;
  }
  return false;
}
// 한 구역: 바닥 점 · 후보 자리 → 탐욕적으로 덮기
// region.area가 있으면 Zone별로 나눠 덮는다: Zone(정밀검사·유연생산·적응가공·정밀조립) 바닥은 그 Zone 천장 카메라로만 — 카메라 하나가 한 Zone에만 속해 Zone 전광판에 그대로 건다
// 공용 시설 바닥은 Zone 카메라가 이미 보는 곳을 빼고 공용 자리 카메라로 채운다. 마지막에 빼도 사각지대가 안 생기는 카메라를 덜어 낸다(중복 정리)
const AREA_ORDER = ['insp', 'flex', 'adapt', 'main', 'shared'];
const SPACE = 40;   // 자리 다듬기: 이웃 카메라와 6m 안 거리 1m당 겹침 점수 40 (점 하나 겹침 ≈ 3~5)
function coverRegion(region, ob) {
  const pts = [];
  for (let x = region.x0; x <= region.x1 + 1e-9; x += STEP) for (let z = region.z0; z <= region.z1 + 1e-9; z += STEP) {
    if (ob.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) continue;   // 설비가 서 있는 자리는 사람이 설 수 없다
    if (region.keep && !region.keep({ x, z })) continue;   // 건물 밖 (꺾인 뒷벽 바깥)
    pts.push({ x, z, area: region.area ? region.area({ x, z }) : null });
  }
  const cands = region.cands.map((c) => (region.area ? { ...c, area: region.area(c) } : c));
  const sees = cands.map((c) => {
    const s = [];
    pts.forEach((p, i) => { if (Math.hypot(p.x - c.x, p.z - c.z) <= c.R && !blocked(c, p, ob)) s.push(i); });
    return s;
  });
  // 점 묶음(want · 이미 덮인 점 base)을 후보(allow)로 덮는다: 탐욕적 선택 + 중복 정리를 동점 처리만 바꿔 여러 번 돌려 가장 적은 대수를 고른다 (난수 씨앗 고정 — 같은 배치는 같은 결과)
  const solve = (want, allow, base) => {
    const rel = new Map();   // 후보마다 아직 덮어야 할 점만
    cands.forEach((c, k) => { if (!allow(c)) return; const r = sees[k].filter((i) => want.has(i) && !base[i]); if (r.length) rel.set(k, r); });
    const ks = [...rel.keys()], need = [...want].filter((i) => !base[i]).length;
    let best = null, seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let run = 0; run < 40; run++) {
      const cov = new Uint8Array(pts.length), pick = [], used = new Set(), jit = ks.map(() => (run ? rnd() * 0.9 : 0));
      let left = need;
      while (left > 0) {
        let bk = -1, bn = 0;
        ks.forEach((k, j) => { if (used.has(k)) return; let n = 0; for (const i of rel.get(k)) if (!cov[i]) n++; if (n && n + jit[j] > bn) { bn = n + jit[j]; bk = k; } });
        if (bk < 0) break;
        pick.push(bk); used.add(bk); for (const i of rel.get(bk)) if (!cov[i]) { cov[i] = 1; left--; }
      }
      const cnt = new Uint8Array(pts.length); for (const k of pick) for (const i of rel.get(k)) cnt[i]++;   // 덜어 내기: 맡은 점이 모두 다른 카메라로도 보이면
      for (const k of [...pick].sort((x, y) => rel.get(x).length - rel.get(y).length)) if (rel.get(k).every((i) => cnt[i] > 1)) { pick.splice(pick.indexOf(k), 1); for (const i of rel.get(k)) cnt[i]--; }
      if (!best || pick.length < best.length) best = pick;
    }
    return best;
  };
  const chosen = [];
  const cover = (want, allow, base) => { const pick = solve(want, allow, base); chosen.push(...pick); for (const k of pick) for (const i of sees[k]) if (want.has(i)) base[i] = 1; };
  if (!region.area) cover(new Set(pts.keys()), () => true, new Uint8Array(pts.length));
  else {
    for (const a of AREA_ORDER.slice(0, -1)) {   // Zone 바닥: 자기 Zone 카메라로 (못 보는 점만 다른 자리 카메라로 보충)
      const want = new Set(pts.flatMap((p, i) => (p.area === a ? [i] : []))), base = new Uint8Array(pts.length);
      cover(want, (c) => c.area === a, base); cover(want, () => true, base);
    }
    const want = new Set(pts.flatMap((p, i) => (p.area === 'shared' ? [i] : []))), base = new Uint8Array(pts.length);   // 공용 바닥: Zone 카메라가 보는 곳은 빼고
    for (const k of chosen) for (const i of sees[k]) base[i] = 1;
    cover(want, (c) => c.area === 'shared', base); cover(want, () => true, base);
  }
  // 자리 다듬기: 탐욕적 선택은 고른 카메라를 옮기지 않아, 끝자락 몇 점 때문에 고른 카메라가 이웃과 붙어 있을 수 있다(거의 같은 바닥을 함께 봄)
  // 카메라마다 같은 구역의 가까운 후보(8m 안)로 옮겨 보아 사각지대가 생기지 않고(Zone 바닥은 그 Zone 카메라로) 겹침(점마다 대수²의 합) + 이웃 근접(6m 안)이 줄면 옮긴다 — 두 번 돈다
  {
    const cnt = new Uint8Array(pts.length), zc = new Uint8Array(pts.length), mark = new Uint8Array(pts.length);
    const own = (k, i) => !region.area || pts[i].area === 'shared' || cands[k].area === pts[i].area;
    for (const k of chosen) for (const i of sees[k]) { cnt[i]++; if (own(k, i)) zc[i]++; }
    const used = new Set(chosen);
    for (let round = 0; round < 2; round++) for (let n = 0; n < chosen.length; n++) {
      const k = chosen[n], c = cands[k]; let best = -1, bd = -1;
      for (const i of sees[k]) mark[i] = 1;
      cands.forEach((d, j) => {
        if (used.has(j) || (region.area && d.area !== c.area) || Math.hypot(d.x - c.x, d.z - c.z) > 8) return;
        let delta = 0, ok = true;
        for (const i of sees[j]) mark[i] |= 2;
        for (const i of sees[k]) if (!(mark[i] & 2)) { if (cnt[i] <= 1 || (own(k, i) && region.area && pts[i].area !== 'shared' && zc[i] <= 1)) { ok = false; break; } delta += (cnt[i] - 1) ** 2 - cnt[i] ** 2; }
        if (ok) for (const i of sees[j]) if (!(mark[i] & 1)) delta += (cnt[i] + 1) ** 2 - cnt[i] ** 2;
        if (ok) for (const o of chosen) if (o !== k) delta += SPACE * (Math.max(0, 6 - Math.hypot(cands[o].x - d.x, cands[o].z - d.z)) - Math.max(0, 6 - Math.hypot(cands[o].x - c.x, cands[o].z - c.z)));   // 이웃과 6m 안으로 붙지 않게
        for (const i of sees[j]) mark[i] &= 1;
        if (ok && delta < bd) { bd = delta; best = j; }
      });
      for (const i of sees[k]) mark[i] = 0;
      if (best < 0) continue;
      for (const i of sees[k]) { cnt[i]--; if (own(k, i)) zc[i]--; }
      for (const i of sees[best]) { cnt[i]++; if (own(best, i)) zc[i]++; }
      used.delete(k); used.add(best); chosen[n] = best;
    }
    // 마지막 정리 (구역을 가로질러): 단계별 덜어 내기는 그 단계 안에서만 보므로, 다른 단계 카메라가 이미 다 보는 카메라가 남을 수 있다
    // 빼도 모든 점이 다른 카메라에 보이고 Zone 바닥은 그 Zone 카메라가 계속 보면 덜어 낸다 — 맡은 점이 적은 카메라부터
    for (const k of [...chosen].sort((a, b) => sees[a].length - sees[b].length)) {
      if (sees[k].every((i) => cnt[i] > 1 && (!own(k, i) || !region.area || pts[i].area === 'shared' || zc[i] > 1))) {
        chosen.splice(chosen.indexOf(k), 1); for (const i of sees[k]) { cnt[i]--; if (own(k, i)) zc[i]--; }
      }
    }
  }
  const count = new Uint8Array(pts.length);
  for (const k of chosen) for (const i of sees[k]) count[i]++;
  const blind = count.reduce((x, v) => x + (v ? 0 : 1), 0);
  return { pts, count, cams: chosen.map((k) => cands[k]), blind };
}

export function planCCTV(sim) {
  const key = JSON.stringify(sim.stations.filter((s) => !s.standby).map((s) => [s.type, Math.round(s.x * 10), Math.round(s.z * 10)]));
  if (cache.has(key)) return cache.get(key);
  const ob = obstacles(sim);
  const grid = (x0, x1, z0, z1, step, y, R, kind, extra = {}) => { const c = []; for (let x = x0; x <= x1 + 1e-9; x += step) for (let z = z0; z <= z1 + 1e-9; z += step) c.push({ x, y, z, R, kind, ...extra }); return c; };
  const D = CCTV_SPEC.dome, O = CCTV_SPEC.outdoor;
  // 건물 안: 천장 2m 격자 후보
  const inside = coverRegion({ area: camArea, x0: -50.6, x1: BUILDING.x1 - 0.4, z0: BUILDING.z0 + 0.4, z1: BUILDING.z1 - 0.4, keep: (p) => inBuilding(p, 0.4), cands: grid(-50, BUILDING.x1 - 2, BUILDING.z0 + 2, BUILDING.z1 - 2, 2, D.y, D.R, 'dome').filter((c) => inBuilding(c, 1.5)) }, ob);   // 앞뒤로 넓힌 건물 전체 (3 Zone · 출하 도크 쪽 꺾인 뒷벽 반영)   // 왼쪽 확장동(물류존) 포함
  // 입고 트럭 야드: 왼쪽 확장동 외벽(x −51.4)과 야드 가장자리 기둥 후보
  // 입고 야드는 건물 앞쪽(왼쪽 아래): 도크(z 35.8) 위쪽 회전 구역 ~ 건물 앞쪽 진입로(z 54)
  const DZ = INBOUND.dockZ, RZ = INBOUND.roadZ, Y0 = DZ - 10.5, Y1 = RZ + 4;
  const yardIn = coverRegion({ x0: -92, x1: -52, z0: Y0, z1: Y1, cands: [
    ...grid(-51.4, -51.4, DZ - 15, BUILDING.z1 - 1, 3, O.y, O.R, 'wall', { face: -Math.PI / 2 }),
    ...grid(-92.5, -92.5, Y0, Y1, 4, O.y, O.R, 'pole'), ...grid(-91, -53, Y1 + 1, Y1 + 1, 4, O.y, O.R, 'pole'), ...grid(-91, -53, Y0 - 1.5, Y0 - 1.5, 4, O.y, O.R, 'pole'),
    ...grid(-87, -79, DZ + 7.5, DZ + 23.5, 8, O.y, O.R, 'pole')] }, []);   // 야드 서쪽 안쪽 기둥 (트럭 진출입 차로·회전 구역·대기 자리를 비켜)
  // 출하 트럭 야드: 뒷벽 바깥(z −20.4)과 야드 가장자리 기둥 후보
  // 출하 트럭 야드 (오른쪽 벽 바깥): 야드 로컬 좌표(도크 벽 z −20, 바깥 −z)로 후보를 잡아 월드로 돌린다 (shipping.js shipToWorld) — 도크 벽 바깥 카메라 · 야드 가장자리 기둥
  const toW = (c) => ({ ...c, ...shipToWorld(c.x, c.z), ...(c.face != null ? { face: c.face + SHIP_FRAME.rot } : {}) });
  const a = shipToWorld(15, -47), b = shipToWorld(52, -21);
  const yardOut = coverRegion({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), cands: [
    ...grid(16, 43, -20.4, -20.4, 3, O.y, O.R, 'wall', { face: Math.PI }),
    ...grid(53.5, 53.5, -47, -21, 4, O.y, O.R, 'pole'), ...grid(14, 14, -47, -24, 4, O.y, O.R, 'pole'), ...grid(16, 52, -48.5, -48.5, 4, O.y, O.R, 'pole')].map(toW) }, []);
  const regions = { inside, yardIn, yardOut };
  const cams = [];
  for (const [rk, r] of Object.entries(regions)) for (const c of r.cams) cams.push({ ...c, region: rk, id: `CC-${String(cams.length + 1).padStart(2, '0')}` });
  const all = Object.values(regions), P = all.reduce((a, r) => a + r.pts.length, 0);
  const seen = all.reduce((a, r) => a + r.count.reduce((x, v) => x + (v > 0 ? 1 : 0), 0), 0);
  const dbl = all.reduce((a, r) => a + r.count.reduce((x, v) => x + (v > 1 ? 1 : 0), 0), 0);
  const plan = {
    cams, regions, obstacles: ob,
    stats: { points: P, coverage: seen / P, redundancy: dbl / P, blind: P - seen, inside: inside.cams.length, outside: yardIn.cams.length + yardOut.cams.length,
      insideCoverage: inside.count.reduce((x, v) => x + (v > 0 ? 1 : 0), 0) / inside.pts.length },
  };
  cache.set(key, plan);
  return plan;
}

// 위치(x,z)를 보는 카메라 (시야 가림 반영) — 현장 이벤트 AI 감지에 쓴다
export function camerasSeeing(plan, x, z) {
  return plan.cams.filter((c) => Math.hypot(x - c.x, z - c.z) <= c.R && (c.region !== 'inside' || !blocked(c, { x, z }, plan.obstacles)));
}

// ── CCTV 영상 AI 파이프라인 (피지컬AI) — 이벤트 유형별로 맞는 모델을 쓴다 ─────────────────
// 실제 공장 CCTV 분석에 쓰는 구성: 실시간 객체 검출(YOLO 계열) + 다중 객체 추적(ByteTrack) + 바닥 이상 분할(세그멘테이션)
// + 연기·화재 전용 검출 모델 + 지오펜스 침입 규칙. 이 디지털트윈에서는 장면의 실제 위치·크기를 카메라로 투영해
// 각 모델이 내놓을 출력(상자·마스크·트랙 ID·신뢰도)을 만들어 보여 준다 (렌더 영상에 신경망을 직접 돌리지는 않는다).
export const AI_MODELS = {
  detect: { name: 'YOLO11 객체 검출', desc: '사람·휴머노이드·지게차·AGV/AMR·트럭·사족보행·드론 · 640px 실시간', color: '#37e8ff' },
  track: { name: 'ByteTrack 다중 객체 추적', desc: '프레임 간 같은 객체에 같은 트랙 ID — 체류·이동 경로', color: '#8fb3c9' },
  seg: { name: 'YOLO11-seg 바닥 이상 분할', desc: '누유·이물질 영역 마스크 · 면적 추정', color: '#ff7a3d' },
  fire: { name: '연기·화재 검출 (YOLO11 · D-Fire 데이터셋 학습)', desc: '연기·불꽃 조기 경보', color: '#ff5a5a' },
  zone: { name: '지오펜스 침입 규칙', desc: '무인 구역 안 사람 검출 → 침입 경보 (로봇 작업 구역)', color: '#f5b82e' },
};
export const EVENT_MODEL = { leak: 'seg', debris: 'seg', smoke: 'fire', intrusion: 'zone' };

// ── CCTV 에이전트 — 영상 감시 · 메인 오케스트레이터 보고 · 이벤트 이력 관리 ─────────────────
// 현장 이벤트를 영상 AI로 감지하면 메인 오케스트레이터에 보고하고(인시던트 생성·대응은 오케스트레이터 담당),
// 이미 다른 경로(IoT·로봇·드론)로 보고된 인시던트가 CCTV 화면에 잡히면 "영상 확보" 기록만 남긴다.
// 이력에는 감지 시각·카메라·모델·신뢰도·위치·연결 인시던트를 쓰고, 오케스트레이터가 인시던트를 닫으면 결과·소요 시간을 채운다.
export class CCTVAgent {
  constructor(sim) {
    this.sim = sim; this.history = []; this.seq = 0; this.t = 0; this.byInc = new Map();
    this.on = sim.mode.key === 'dark' && !sim.twin;
  }
  add(e) {
    const rec = { no: `EV-${String(++this.seq).padStart(4, '0')}`, t: this.sim.time, status: 'open', ...e };
    this.history.unshift(rec); if (this.history.length > 400) this.history.pop();
    if (rec.inc) this.byInc.set(rec.inc.id, [...(this.byInc.get(rec.inc.id) ?? []), rec]);
    return rec;
  }
  update(dt) {
    if (!this.on) return;
    this.t += dt; if (this.t < 0.5) return; this.t = 0;
    const s = this.sim, plan = s.cctv;
    // 1) 현장 이벤트: 영상 AI로 감지 → 메인 오케스트레이터에 보고 (2초 확인 후)
    for (const ev of s.fieldEvents ?? []) {
      if (ev.cleared || ev.cctvLogged) continue;
      const cams = camerasSeeing(plan, ev.x, ev.z); if (!cams.length) continue;
      const cam = cams.sort((a, b) => Math.hypot(a.x - ev.x, a.z - ev.z) - Math.hypot(b.x - ev.x, b.z - ev.z))[0], model = EVENT_MODEL[ev.type] ?? 'detect';
      const conf = Math.round((0.86 + ((ev.id * 7) % 10) / 100) * 100) / 100;
      if (!ev.detected && s.time - ev.t0 >= 2) {
        ev.cctv = cam.id;
        s.detectFieldEvent(ev, `CCTV 에이전트 (${cam.id})`, conf);
        ev.cctvLogged = true;
        this.add({ kind: 'report', cam: cam.id, cams: cams.map((c) => c.id), model, cls: ev.cls, label: ev.label, conf, x: ev.x, z: ev.z, inc: ev.inc, note: `${AI_MODELS[model].name} → 메인 오케스트레이터 보고` });
        s.orch.step(ev.inc, 'field', 'report', `CCTV 에이전트 보고: ${cam.id} 영상 · ${AI_MODELS[model].name} · ${ev.cls} ${conf.toFixed(2)} · 이력 등록`);
      } else if (ev.detected) {   // 다른 경로로 먼저 감지됨 → 교차 확인·영상 확보만
        ev.cctvLogged = true;
        this.add({ kind: 'verify', cam: cam.id, cams: cams.map((c) => c.id), model, cls: ev.cls, label: ev.label, conf, x: ev.x, z: ev.z, inc: ev.inc, note: `${ev.detectedBy} 감지를 영상으로 교차 확인 · 영상 확보` });
      }
    }
    // 2) 다른 인시던트(설비 고장·결품·공급 차질): 화면에 잡히면 영상 확보 기록 (보고·대응은 이미 오케스트레이터가 진행)
    for (const inc of s.orch.incidents) {
      if (inc.status !== 'open' || !inc.where || inc.type === 'field' || this.byInc.has(inc.id)) continue;
      const cams = camerasSeeing(plan, inc.where.x, inc.where.z); if (!cams.length) continue;
      this.add({ kind: 'record', cam: cams[0].id, cams: cams.map((c) => c.id), model: 'detect', cls: { equipment: '설비 정지', parts: '선반 결품', supply: '입고 지연' }[inc.type] ?? inc.type, label: inc.title, conf: null, x: inc.where.x, z: inc.where.z, inc, note: '오케스트레이터 인시던트 · 영상 기록 확보' });
    }
    // 3) 이력 상태 동기화: 오케스트레이터가 인시던트를 닫으면 결과·소요 시간 기록
    for (const r of this.history) {
      if (r.status !== 'open' || !r.inc || r.inc.status === 'open') continue;
      r.status = 'closed'; r.tEnd = r.inc.tEnd ?? s.time; r.dur = r.tEnd - r.inc.t0;
      r.result = r.inc.steps.at(-1)?.text ?? '종료';
    }
  }
  stats() {
    const h = this.history, rep = h.filter((r) => r.kind === 'report');
    return { total: h.length, reports: rep.length, verify: h.filter((r) => r.kind === 'verify').length, records: h.filter((r) => r.kind === 'record').length, open: h.filter((r) => r.status === 'open').length };
  }
}
