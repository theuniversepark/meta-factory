// 출하: 구분 적재장에 포장 완제품이 쌓이면 출하 지게차가 팔레트 단위로 실어 뒷벽 출하 도크 문을 지나
// 건물 밖 트럭 야드의 화물트럭에 상차한다. 트럭이 가득 차면 출발하고, 대기하던 트럭이 빈 도크로 후진 접안하며,
// 새 트럭이 대기 자리로 들어온다. 렌더링과 분리되어 헤드리스 시뮬레이션에서도 같은 흐름으로 동작한다.

// 트럭 야드 배치 — 야드 로컬 좌표: 도크 벽 z = -20, 바깥 = −z, z -40 진출입 도로.
// 화면(월드)에는 직사각형 건물의 오른쪽 벽 위쪽에 90° 시계 방향으로 돌려 놓는다 (shipToWorld): 도크 1개 z −38 (뒷벽과 뒤쪽 통로 사이 모서리) · 트럭은 한 대만
// (출하 지게차는 정밀조립Zone 뒤 통로(z −9) → 오른쪽 세로 통로로 바로 닿는다)
// 트럭 움직임은 로컬 좌표로 계산하고(Truck.lx·lz·lh), 바깥(화면·지게차·CCTV)에는 월드 좌표(x·z·heading)로 보인다
import { BUILDING, EXTRA_ZONES, ZONE_FG_CAP, zonePack } from './zonedefs.js';
import { FG_ZONE_CAP } from './line.js';
// 확장 Zone 완제품(포장·구분 적재 팔레트) — 제품 → { 이름, 집는 자리 } (zonedefs.js zonePack)
const ZONE_FG = Object.fromEntries(EXTRA_ZONES.flatMap((Z) => (zonePack(Z) ?? []).map((q) => [q.product, { label: Z.products[q.product].label, zone: Z.code, pick: q.pick }])));
export const FG_LABEL = { doortrim: '도어트림', eaxle: 'e-axle', ...Object.fromEntries(Object.entries(ZONE_FG).map(([k, v]) => [k, v.label])) };
export const YARD = {
  wallZ: -20, bays: [20.5], enterX: 2, roadZ: -40,   // 도크 1개 (오른쪽 벽 위 모서리 · 월드 z −38) · 트럭은 도로 북쪽 끝(enterX)에서 들어온다
  truckLen: 10.5, truckW: 2.5, cap: 32,      // 트럭 길이·폭(m), 적재 용량(개 = 팔레트 4개 × 8개)
  pallet: 8,                                   // 지게차 1회 운반량 (팔레트 1개)
};
// 출하 도크 이름 — 도크가 하나면 번호 없이 '출하 도크', 여러 개면 '출하 도크 1·2…' (간판·로그·지게차 목적지 공통)
export const shipBayName = (bx) => (YARD.bays.length > 1 ? `출하 도크 ${YARD.bays.indexOf(bx) + 1}` : '출하 도크');
const DOCK_Z = YARD.wallZ - YARD.truckLen / 2 - 0.15;   // 접안 트럭 중심 (뒤쪽 끝이 벽 바로 바깥)
const FWD = 4.2, REV = 1.8;                    // 전진·후진 속도 (m/s)
// 야드 로컬 → 월드: 오른쪽 벽 x 38, 로컬 x 27.5 → 월드 z −31 (회전 −90°: 월드 = (−z, x) + 평행이동)
export const SHIP = { wallX: BUILDING.x1, zOff: -58.5 };   // 오른쪽 벽(zonedefs.js BUILDING.x1)
export const SHIP_FRAME = { x: SHIP.wallX + YARD.wallZ, z: SHIP.zOff, rot: -Math.PI / 2 };   // three.js 그룹에 그대로 쓰는 변환 (위치 + y축 회전)
export const shipToWorld = (x, z) => ({ x: SHIP_FRAME.x - z, z: x + SHIP_FRAME.z });
const FRAME = { pos: shipToWorld, dh: SHIP_FRAME.rot };

// 트럭: 위치(x,z)는 차체 중심, heading은 운전석이 향하는 방향 (이동체와 같은 규약: 0 = +z)
// frame이 있으면(출하 야드) 위치·방향은 야드 로컬로 움직이고 x·z·heading은 월드로 돌려준다 (입고 트럭은 frame 없음 = 월드 그대로)
export class Truck {
  constructor(id, x, z, heading, frame = null) { Object.assign(this, { id, frame, lx: x, lz: z, lh: heading, load: 0, by: {}, state: 'arrive', route: [], bay: null }); }
  get x() { return this.frame ? this.frame.pos(this.lx, this.lz).x : this.lx; } set x(v) { this.lx = v; }
  get z() { return this.frame ? this.frame.pos(this.lx, this.lz).z : this.lz; } set z(v) { this.lz = v; }
  get heading() { return this.lh + (this.frame?.dh ?? 0); } set heading(v) { this.lh = v; }
  // 경로점: { x, z, rev } — rev면 후진 (차체 방향은 진행 반대)
  go(points, state) { this.route = points.map((p) => ({ ...p })); this.state = state; }
  update(dt) {
    let rem = dt;
    while (rem > 0 && this.route.length) {
      const p = this.route[0], dx = p.x - this.lx, dz = p.z - this.lz, d = Math.hypot(dx, dz);
      const v = p.rev ? REV : FWD;
      if (d < 1e-3) { this.route.shift(); continue; }
      // 차체 방향은 진행 방향(후진이면 반대)으로 부드럽게 돈다
      const want = Math.atan2(dx, dz) + (p.rev ? Math.PI : 0);
      let dh = ((want - this.lh + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      this.lh += Math.sign(dh) * Math.min(Math.abs(dh), rem * 0.9);
      const step = Math.min(d, v * rem);
      this.lx += (dx / d) * step; this.lz += (dz / d) * step; rem -= step / v;
      if (step >= d - 1e-6) this.route.shift();
    }
    this.moving = this.route.length > 0;
    return !this.route.length;
  }
}

export class TruckYard {
  constructor(sim) {
    this.sim = sim; this.seq = 0; this.trucks = []; this.gone = 0;
    // 시작: 도크 하나에 빈 트럭 한 대만 접안 (대기 트럭 없음)
    for (const bx of YARD.bays) { const t = this.spawn(bx, DOCK_Z); t.state = 'dock'; t.bay = bx; }
  }
  spawn(x, z) { const t = new Truck(`화물트럭-${++this.seq}`, x, z, Math.PI, FRAME); this.trucks.push(t); return t; }
  docked(bx) { return this.trucks.find((t) => t.bay === bx && t.state === 'dock'); }
  // 지게차가 실을 트럭: 접안해 있고 자리가 남은 트럭 중 많이 실린 쪽 (빨리 채워 출발시킨다)
  loadable() { return this.trucks.filter((t) => t.state === 'dock' && t.load + (t.reserved ?? 0) < YARD.cap).sort((a, b) => b.load - a.load)[0] ?? null; }

  update(dt) {
    const s = this.sim;
    for (const t of this.trucks) {
      const arrived = t.update(dt);
      if (!arrived) continue;
      if (t.state === 'toDock') { t.state = 'dock'; s.log('info', `${t.id} ${shipBayName(t.bay)} 접안`, { obs: '후진 접안 완료 · 상차 대기' }); }
      else if (t.state === 'depart') { t.state = 'gone'; }
    }
    this.trucks = this.trucks.filter((t) => t.state !== 'gone');
    // 만재 트럭이 도로로 빠져나가(남쪽 +x로) 도크 앞을 비우면 다음 트럭 한 대가 도로 북쪽 끝에서 들어와 곧장 후진 접안한다 (대기 자리 없음)
    for (const bx of YARD.bays) {
      const busy = this.trucks.some((t) => (t.bay === bx && (t.state === 'dock' || t.state === 'toDock')) || (t.state === 'depart' && t.bayLeft === bx && t.lx < bx + 14));
      if (busy) continue;
      const t = this.spawn(YARD.enterX, YARD.roadZ - 1.5); t.heading = Math.PI / 2; t.bay = bx;
      t.go([{ x: bx + 7, z: YARD.roadZ - 1.5 }, { x: bx + 1.5, z: YARD.roadZ + 4, rev: true }, { x: bx, z: DOCK_Z - 6, rev: true }, { x: bx, z: DOCK_Z, rev: true }], 'toDock');
      s.log('info', `${t.id} 출하 야드 진입`, { obs: `${shipBayName(bx)} 후진 접안` });
    }
  }
  bayNo(bx) { return YARD.bays.indexOf(bx) + 1; }

  // 지게차가 팔레트를 트럭에 내려놓았을 때
  unload(t, n, product) {
    const s = this.sim;
    t.reserved = Math.max(0, (t.reserved ?? 0) - n);
    t.load += n; if (product) t.by[product] = (t.by[product] ?? 0) + n;
    for (let k = 0; k < Math.ceil(n / YARD.pallet); k++) (t.pallets ??= []).push(product ?? 'fg');   // 3D 적재함에 놓이는 팔레트 순서 (2단 운반이면 두 개)
    s.stats.shipped += n; s.fac?.ship(t, n, product);
    if (t.load >= YARD.cap) {
      const bx = t.bay;
      t.go([{ x: bx, z: YARD.roadZ + 3 }, { x: bx + 4, z: YARD.roadZ }, { x: 90, z: YARD.roadZ }], 'depart');
      t.bay = null; t.bayLeft = bx;
      s.stats.trucks = (s.stats.trucks ?? 0) + 1; s.fac?.shipDone(t);   // FAC: 출고 확정
      const mix = Object.entries(t.by).map(([k, v]) => `${FG_LABEL[k] ?? k} ${v}`).join(' · ');
      s.log('ok', `${t.id} 만재 출발`, { obs: `적재 ${t.load}/${YARD.cap}개${mix ? ` (${mix})` : ''}`, act: `${shipBayName(bx)} 비움 → 다음 트럭 진입` });
    }
  }
}

// 출하 지게차 작업 배정 — 제품 구역에 팔레트 기준 이상 쌓이면 한 팔레트씩 트럭으로 옮긴다
export function planForklift(sim, f) {
  const yard = sim.yard, m = sim.mode;
  const trigger = m.key === 'traditional' ? 16 : YARD.pallet;   // 레거시는 많이 쌓인 뒤에야 움직인다 (작업자 판단)
  let product = null, avail;
  let zfg = null;
  if (sim.zone) {
    // 정밀조립 구분 적재장 + 확장 Zone 포장·구분 적재 팔레트 중 적재 한도 대비 가장 많이 찬 쪽부터 (한쪽이 차서 라인이 서지 않게)
    // 출하 가능 = 시리얼 서비스(js/serial.js)가 출하 보류(정밀검사 샘플 로트 · 봉쇄 · 재작업)하지 않은 것만
    const zs = sim.zoneFg ?? {}, H = sim.serials, stock = (k) => (k in sim.fgBy ? sim.fgBy[k] : zs[k]), ready = (k) => (H ? Math.min(stock(k), H.shippable(k)) : stock(k)), cap = (k) => (k in sim.fgBy ? FG_ZONE_CAP : ZONE_FG_CAP);
    const p = [...Object.keys(sim.fgBy), ...Object.keys(zs)].filter((k) => ready(k) >= trigger).sort((a, b) => stock(b) / cap(b) - stock(a) / cap(a))[0];
    if (!p) return false;
    product = p; avail = ready(p); zfg = p in sim.fgBy ? null : zs;
  } else {
    if (sim.fgStock < trigger) return false;
    avail = sim.fgStock;
  }
  const t = yard.loadable(); if (!t) return false;
  const n = Math.min(avail >= 2 * YARD.pallet ? 2 * YARD.pallet : YARD.pallet, avail, YARD.cap - t.load - (t.reserved ?? 0));   // 두 팔레트 이상 쌓였으면 2단으로 한 번에
  if (n <= 0) return false;
  t.reserved = (t.reserved ?? 0) + n;
  const pick = zfg ? ZONE_FG[product].pick : product === 'eaxle' ? sim.loc.PICK_EA : sim.loc.PICK_DT;
  // 도크 앞(벽에서 2.6m)에서 트럭 쪽을 보고 서서 포크를 적재함 높이로 올린 뒤 들어가고, 내려놓으면 포크를 넣은 채 반듯이 후진해 나온 뒤 돈다
  const bx = t.bay, dock = { ...shipToWorld(bx, YARD.wallZ + 2.6), aisle: 'BB', name: shipBayName(bx) };
  const inside = { ...shipToWorld(bx, YARD.wallZ + 0.95), aisle: 'BB', name: `${t.id} 적재함` };   // 마스트(차체 앞 0.81m)·포크 캐리지는 적재함 밖(후방 범퍼 앞)에 두고 포크만 넣는다   // 도크 레벨러 끝에서 포크를 적재함에 넣어 내려놓는다
  const pName = FG_LABEL[product] ?? '완제품';
  f.setTask(`${pName} 출하 → ${t.id}`, [
    { go: pick },
    { wait: m.key === 'traditional' ? 8 : 5, done: () => {
      const H = sim.serials, okN = H && product ? H.shippable(product) : Infinity;   // 집는 순간 다시 확인 (그 사이 보류된 것은 두고 간다)
      const short = (k) => { if (k < n) t.reserved = Math.max(0, (t.reserved ?? 0) - (n - k)); };   // 예약보다 적게 실으면 남는 예약을 바로 푼다 (트럭이 예약에 묶여 서지 않게)
      if (zfg) { const k = Math.min(n, zfg[product], okN); short(k); zfg[product] -= k; f.load = { type: 'fg', n: k, product, lot: H?.take(product, k, f.id) ?? null }; return; }   // 확장 Zone 팔레트
      const k = Math.min(n, product ? sim.fgBy[product] : sim.fgStock, okN); short(k);
      if (product) sim.fgBy[product] -= k;
      sim.fgStock -= k; f.load = { type: 'fg', n: k, product, lot: H && product ? H.take(product, k, f.id) : null };   // 팔레트 SSCC ↔ 시리얼 묶음
    } },
    { go: dock },
    { go: inside, via: [] },
    { wait: m.key === 'traditional' ? 6 : 4, done: () => {
      const k = f.load?.n ?? 0, lot = f.load?.lot; f.load = null;
      if (t.state === 'dock') { yard.unload(t, k, product); sim.serials?.ship(lot, t.id); }
      else { if (zfg) zfg[product] += k; else { sim.fgStock += k; if (product) sim.fgBy[product] += k; } t.reserved = 0; sim.serials?.unload(lot); }   // 그 사이 트럭이 떠났으면 되돌린다
    } },
    { go: dock, via: [], rev: true },
    // 복귀: 도크 앞 줄을 따라 곧장 옆의 대기 자리(도크 왼쪽)로 — 통로까지 내려갔다 올라오지 않고 지나쳤다 되돌아오지도 않는다 (서면 벽 쪽을 보고 주차)
    { go: f.home, via: [] },
  ]);
  sim.log(m.agentActive ? 'act' : 'warn', `출하 지게차 배차 → ${t.id}`, {
    obs: zfg ? `${ZONE_FG[product].zone} 포장·구분 적재 ${pName} ${avail}개 (기준 ${trigger}개)` : sim.zone ? `구분 적재장 ${pName} ${avail}개 (기준 ${trigger}개)` : `완제품 ${avail}개`,
    dec: `트럭 ${t.id} 적재 ${t.load}/${YARD.cap}개`,
    act: `${f.id} 팔레트 ${n}개 → ${shipBayName(bx)}`,
  });
  return true;
}
