// 메타팩토리 확장 Zone — 서버실과 AMR 스테이션 사이, 정밀조립Zone 뒤(화면 위)에 A-1 유연생산Zone, 앞(화면 아래)에 A-2 적응가공Zone (배치: zonedefs.js).
// 셀 구성·제품·사이클·로봇은 상위 폴더의 flexible-manufacturing(유연생산Zone)·adaptive-machining(적응가공Zone) 프로젝트를 따른다.
// 두 Zone은 각자 흐름 시뮬레이션으로 돈다: 투입 → 제품별 셀 경로 → 적재. 대상물은 지그 AMR에 실려 셀 중앙에 정차하고,
// 셀 하나에는 대상물 하나만 들어간다 — 다음 셀이 차 있으면 지금 셀에서 기다린다(출구 대기). 적재 후 빈 AMR은 복귀로로 투입 대기열에 선다.
// 시계는 정밀조립Zone 시뮬레이션과 같다(배속·일시정지), 라인 전체 비상정지·보호정지 때는 함께 멈춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KIT } from './factory.js';
import { blenderOn, cloneAsset, RENDER } from './blender.js';
import { makeProductMachine } from './product-machines.js';
import { pointAt, pathLength } from './line.js';
import { EXTRA_ZONES, ZONE_FAC, zoneRobotUid, zoneAmrUid, ZONE_FG_CAP, zonePack } from './zonedefs.js';
import { BATTERY, moverRadius, moverWidth } from './sim.js';
export { EXTRA_ZONES };

const { std, emis, mesh, box, cyl, put, MAT, BELT_Y, AMMR, makeRobot, ammrContact, contactBox, pointWork, makeSparks, stepSparks, makeWorker, makeHumanoid, makeCarrierAMR, makeStackLight, cellBase, idPlate, armIK, makeArm, ARM_JOINTS, buildWeld, buildGate, buildVision } = KIT;
const PI = Math.PI;
const PC = { shared: 0x2bb3a6, hood: 0xf0a030, door: 0x9a6bff, hblock: 0xf0a030, rcover: 0x9a6bff, ng: 0xd23b3b };
const USE_CLS = { hood: 'doortrim', hblock: 'doortrim', door: 'eaxle', rcover: 'eaxle' };   // 셀 라벨 색 (주황·보라)
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const STATION_LEAD = 1;   // Zone AMR 투입 대기열: 투입존 밖에서 1대만 기다린다 (나머지는 Zone AMR 스테이션 자기 자리에서 대기)
const MODE_MUL = { traditional: 1.3, smart: 1.0, dark: 0.9 };   // 단계별 사이클 배율 (정밀조립Zone 단계와 같은 방향)
const ROBOT_SHORT = { articulated: '6축', cobot: '협동', ammr: 'AMMR', humanoid: '휴머노이드' };

// 정밀조립Zone(line.js zonePath)과 같은 셀 간 경로: 셀 중앙 → 출구 → (대각) → 다음 셀 입구, 같은 줄이면 직선
function cellPath(Z, aId, bId, a, b) {
  const via = Z.paths[`${aId}>${bId}`];
  if (via) return [{ x: a.x, z: a.z }, ...via, { x: b.x, z: b.z }];
  if (Math.abs(a.z - b.z) < 0.01) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  // 투입구(SRC)에서는 갠트리 기둥(±1.95)을 다 지난 뒤 꺾는다 — 2.3m에서 꺾으면 AMR·도어 패널이 기둥에 닿는다
  const merge = Math.abs(b.z) < 0.01, ez = merge ? Math.sign(a.z - b.z) * 0.75 : b.z, ex = b.x - 2, x0 = a.x + (aId === 'SRC' ? 3.0 : 2.3);
  // 가운데 줄 셀로 합류: 합류 차로(±0.75)에서 게이트(셀 x −1.75, 기둥 z ±1.0) 1.75m 앞에서 셀 중심선에 올라탄 뒤 곧게 들어간다 — 차로에서 비스듬히 들어가면 AMR이 게이트 기둥에 걸린다
  if (merge) return [{ x: a.x, z: a.z }, { x: x0, z: a.z }, { x: Math.max(x0, ex - 3), z: ez }, { x: b.x - 3.5, z: 0 }, { x: b.x, z: b.z }];
  return [{ x: a.x, z: a.z }, { x: x0, z: a.z }, { x: Math.max(x0, ex - 3), z: ez }, { x: ex, z: ez }, { x: b.x, z: b.z }];
}

// ── 바닥 AMR 경로 표시 (정밀조립Zone factory.js buildGuide · buildZoneDeco와 같은 모양) ─────────────────
// 유도 테이프: 두 줄(±0.5m) + 진행 방향 화살표 · 전용 차로: 점선
function trimPoly(pts, s0, s1) {   // 경로 앞 s0 · 뒤 s1만큼 잘라낸 꺾은선
  const L = pathLength(pts), e = L - s1; if (e - s0 < 0.1) return [];
  const out = [pointAt(pts, s0)]; let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (acc > s0 && acc < e) out.push({ ...pts[i] }); }
  out.push(pointAt(pts, e)); return out;
}
function guideTape(g, pts, mat) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); if (L < 0.05) continue;
    const seg = put(new THREE.Group(), (a.x + b.x) / 2, 0, (a.z + b.z) / 2, g); seg.rotation.y = Math.atan2(-dz, dx);
    for (const sd of [-0.5, 0.5]) put(new THREE.Mesh(new THREE.PlaneGeometry(L + 0.1, 0.07), mat), 0, 0.016, sd, seg).rotation.x = -PI / 2;
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.3; x += 1.6) { const ch = put(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat), x, 0.016, 0, seg); ch.rotation.x = -PI / 2; ch.rotation.z = PI / 4; ch.scale.set(1, 0.35, 1); }
  }
}
function dashLine(g, pts, mat) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.floor(L / 1.2);
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, m = put(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.1), mat), a.x + (b.x - a.x) * t, 0.016, a.z + (b.z - a.z) * t, g); m.rotation.x = -PI / 2; m.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x); }
  }
}

// ── 설비 모델 (유연생산Zone: flexible-manufacturing · 적응가공Zone: adaptive-machining과 같은 형상) ─────────────────
function gateOf(g, x, color) { const G = buildGate(g, x, color); return G; }
function drawGate(gs, title, text, col) {
  const key = `${title}|${text}|${col}`; if (gs.id === key) return; gs.id = key;
  const c = gs.cv.getContext('2d'), F = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  c.fillStyle = '#071019'; c.fillRect(0, 0, 512, 128); c.fillStyle = col; c.fillRect(0, 0, 14, 128);
  c.font = `bold 30px ${F}`; c.fillStyle = '#9fb4c8'; c.fillText(title, 32, 42);
  let fs = 40; c.font = `bold ${fs}px ${F}`; c.fillStyle = col;
  while (c.measureText(text).width > 460 && fs > 22) { fs -= 2; c.font = `bold ${fs}px ${F}`; }
  c.fillText(text, 32, 98); gs.tex.needsUpdate = true;
}
// C01 공급·키팅: 부품 ID 판독 게이트 + 제품별 키트 빈 (후드 +z · 도어 −z)
function buildKit(g) {
  const gate = gateOf(g, -1.75, 0x33ff99);
  [['hood', 1.15], ['door', -1.15]].forEach(([k, z]) => {
    const tones = k === 'hood' ? [0xf0a030, 0xf5b82e, 0xd98a2b] : [0x9a6bff, 0x7b5cd6, 0x2f6fd6];
    tones.forEach((c, i) => { const bin = put(box(0.42, 0.34, 0.4, std(c)), 0.45 + i * 0.47, 0.32, z, g); put(box(0.36, 0.02, 0.34, MAT.dark), 0, 0.17, 0, bin); });
  });
  return { ...gate, gateTitle: '키팅 게이트 · 부품 ID' };
}
// C02 안착·보정: 비전 포털 (기준핀·클램프는 AMR 지그에 달려 있다)
function buildLocate(g) {
  const auto = put(new THREE.Group(), 0, 0, 0, g);
  for (const z of [-1.15, 1.15]) put(box(0.14, 2.5, 0.14, MAT.steel), 0.9, 1.25, z, auto);
  put(box(0.2, 0.18, 2.45, MAT.steel), 0.9, 2.5, 0, auto);
  for (const z of [-0.5, 0.5]) { const c = put(box(0.26, 0.16, 0.2, MAT.dark), 0.9, 2.32, z, auto); put(cyl(0.05, 0.05, 0.06, emis(0x37e8ff, 1.6), 12), 0, -0.1, 0, c); }
  const scanMat = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const scan = put(new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.3), scanMat), 0, BELT_Y + 0.45, 0, auto); scan.rotation.x = PI / 2; scan.rotation.z = PI / 2;
  return { auto, scan, manualProps: [put(box(1.0, 0.8, 0.6, MAT.dark), -1.2, 0.4, 2.0, g)] };
}
// C03 가접·본용접: 용접 셀(안전 펜스·불꽃) + 팁 드레서 · 용접 타이머
function buildSpot(g) {
  const w = buildWeld(g);
  put(box(0.45, 0.95, 0.4, MAT.dark), -1.55, 0.48, 1.95, g); put(box(0.28, 0.12, 0.28, MAT.orange), -1.55, 1.0, 1.95, g);
  put(box(0.5, 1.5, 0.4, std(0x4a5560)), 1.6, 0.75, -2.05, g); put(box(0.3, 0.2, 0.02, emis(0x3ddc84, 1)), 1.6, 1.25, -1.84, g);
  return w;
}
// C04 실링: 실러 드럼·펌프 · 국소 배기 후드 · 도포 비드 입자
function buildSeal(g) {
  put(cyl(0.32, 0.32, 0.9, MAT.yellow), 1.75, 0.45, 1.9, g);
  put(box(0.45, 1.2, 0.45, MAT.dark), 1.1, 0.6, 1.95, g);
  put(cyl(0.035, 0.035, 1.4, MAT.steel), 1.1, 1.4, 1.5, g).rotation.x = PI / 2;
  put(box(2.6, 0.32, 1.6, std(0x59636e)), 0, 3.05, 0, g); put(box(0.3, 1.0, 0.3, std(0x59636e)), 0, 3.7, 0, g);
  const lamp = emis(0xe6f2ff, 0.6); put(box(2.2, 0.03, 0.3, lamp, false), 0, 2.88, 0, g);
  return { lamp, mist: put(makeSparks(0xf0c840, 40, 0.05), 0, 0, 0, g), manualProps: [put(box(1.0, 0.8, 0.6, MAT.dark), -1.2, 0.4, 2.0, g)] };
}
// C10 정밀 장착: 토크 모니터 · 힌지/스트라이커·체결 부품 트레이
function buildMount(g) {
  const panel = put(box(0.8, 0.6, 0.08, MAT.dark), -1.85, 1.8, 1.35, g);
  const screen = emis(0x3ddc84, 1.2); put(box(0.7, 0.5, 0.02, screen, false), 0, 0, 0.05, panel);
  put(box(0.06, 1.15, 0.06, MAT.dark), -1.85, 0.95, 1.35, g);
  const tb = put(new THREE.Group(), 1.85, 0, -1.35, g);
  put(box(0.7, 0.88, 0.45, MAT.dark), 0, 0.44, 0, tb); put(box(0.7, 0.04, 0.45, MAT.steel), 0, 0.9, 0, tb);
  for (let i = 0; i < 3; i++) put(box(0.2, 0.05, 0.3, std(0x2f6fd6)), -0.22 + i * 0.22, 0.945, 0, tb);
  return { screen };
}
// C05 헤밍: 통로 건너편(+z)에 전용 헤밍 프레스 (베드·문형 기둥·크라운·램)
function buildHem(g) {
  const product = makeProductMachine('oden', g, [0,0,1.9]); if (product) return product;
  const pz = 1.9;
  put(box(1.9, 0.85, 0.9, MAT.dark), 0, 0.43, pz, g); put(box(1.75, 0.06, 0.8, MAT.steel), 0, 0.88, pz, g);
  for (const x of [-1.05, 1.05]) put(box(0.22, 2.7, 0.5, MAT.accent), x, 1.35, pz, g);
  put(box(2.35, 0.4, 0.6, MAT.accent), 0, 2.85, pz, g);
  const ram = put(new THREE.Group(), 0, 2.2, pz, g);
  put(box(1.55, 0.35, 0.8, MAT.steel), 0, 0, 0, ram); put(box(1.45, 0.06, 0.74, MAT.dark), 0, -0.2, 0, ram);
  for (const x of [-1.3, 1.3]) put(box(0.06, 1.4, 0.45, MAT.yellow), x, 0.95, pz + 0.15, g);
  return { ram };
}
// C07 NG·재작업: 재작업 작업대 · 격리 랙(빨강) · 재검 게이지
function buildRework(g) {
  put(box(1.4, 0.85, 0.7, MAT.dark), 0.2, 0.43, 2.0, g); put(box(1.3, 0.04, 0.6, MAT.steel), 0.2, 0.87, 2.0, g);
  const iso = put(new THREE.Group(), -1.6, 0, 2.0, g);
  for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) put(box(0.05, 1.5, 0.05, MAT.defect), x, 0.75, z, iso);
  put(box(1.15, 0.04, 0.75, MAT.defect), 0, 0.6, 0, iso); put(box(1.15, 0.04, 0.75, MAT.defect), 0, 1.2, 0, iso);
  for (const z of [-1.0, 1.0]) put(box(0.12, 2.0, 0.12, MAT.dark), 1.25, 1.0, z, g);
  put(box(0.18, 0.16, 2.1, MAT.dark), 1.25, 2.0, 0, g);
  put(box(0.3, 0.14, 0.3, MAT.white), 1.25, 1.85, 0, g);
  return { sparks: put(makeSparks(0xffc060, 24, 0.05), 0, 0, 0, g) };
}
// 확장 Zone 6축·협동로봇 접촉 작업 구간(셀 진행률)과 방식 — 헤밍 램(0.45~0.85) · CMM 탐침(0.3~0.9) · 디버링 드릴(0.12~0.42)·세척(0.78~)과 겹치지 않게
const CELL_WORK = {
  kit: { from: 0.1, to: 0.85, kind: 'touch' }, locate: { from: 0.1, to: 0.85, kind: 'touch' }, spot: { from: 0.08, to: 0.9, kind: 'press' }, seal: { from: 0.1, to: 0.85, kind: 'trace' },
  hem: { from: 0.08, to: 0.42, kind: 'press' }, mount: { from: 0.1, to: 0.85, kind: 'screw' }, rework: { from: 0.1, to: 0.85, kind: 'press' },
  matid: { from: 0.1, to: 0.85, kind: 'touch' }, deburr: { from: 0.45, to: 0.76, kind: 'touch' }, cmm: { from: 0.06, to: 0.28, kind: 'touch' },
};
// 머신텐딩 배치 (adaptive-machining TEND): 로봇 −z 1.25m (문 중심선 x −0.1 위 — 팔이 문 열림 폭 1.3m 가운데로 드나든다), 머시닝센터 −z 3.25m (통로 반대쪽, 앞면 −z 2.25m), 테이블 앞 −z 3.05m
const TEND = { robot: { x: -0.1, z: -1.25 }, mc: { z: -3.25 }, table: { x: -0.1, z: -3.05 } };
// 머신텐딩 동작 경유점 (로봇 루트 로컬: +z = 기계 쪽, 높이는 루트 기준) — 문 밖 대기 · 문 앞 · 테이블/척 · AMR 위 · AMR 지그
// 대기(home)는 팔을 접어 TCP를 몸 앞 0.15m에 둔다 — 머시닝센터 문이 로봇 중심에서 0.53m 앞이라, 0.45m 앞에 두면 닫힌 문(가공 중)에 팔·그리퍼가 들어간다
const TEND_PTS = (() => {
  const fwd = TEND.robot.z - TEND.table.z, back = -TEND.robot.z, Y0 = 0.15;
  return { home: [0, 1.45, 0.15], entry: [0, 1.15, 0.72], table: [0, 1.05 - Y0, fwd], over: [0, 1.4, -back + 0.35], amr: [0, BELT_Y + 0.28 - Y0, -back] };
})();
// 진행률(p) 구간별 경로 — 문은 p < 0.15 · p > 0.85에만 열려 있다 (animCell): 팔은 p 0.14 전에 문 밖으로 나오고, 문이 다 열린 p 0.89 뒤에 들어간다
// 기계 쪽(J1 0) ↔ AMR 쪽(J1 π) 선회는 팔을 세워 접은 자세(tuck ↔ tuckB: 위팔 수직·아래팔 위로, 수평 반경 0.38m)에서만 한다 —
// 팔을 뻗은 채 돌면 기계 앞면(문틀·옆판)을 쓸고, 대기 자세(위팔이 뒤로 기움)로 돌면 AMR 쪽을 볼 때 위팔이 기계 쪽으로 넘어간다
// 사이클 시작·끝(= 셀 대기 자세)은 AMR 쪽을 보고 세운 자세(tuckB) — 다음 사이클 시작에서 자세가 튀지 않는다
const TEND_SEQ = [
  [0.00, 'tuckB'], [0.015, 'over'], [0.03, 'amr'], [0.045, 'over'], [0.055, 'tuckB'], [0.065, 'tuck'], [0.08, 'home'], [0.095, 'entry'], [0.11, 'table'], [0.125, 'entry'], [0.14, 'home'],
  [0.89, 'home'], [0.905, 'entry'], [0.92, 'table'], [0.935, 'entry'], [0.945, 'home'], [0.955, 'tuck'], [0.965, 'tuckB'], [0.975, 'over'], [0.985, 'amr'], [0.993, 'over'], [1.0, 'tuckB'],
];
const TEND_TUCK = [0, -0.1, -1.5, 0, -0.75, 0];   // IRB 4600 세운 자세 (관절값)
const tendJoints = (s) => Object.fromEntries(Object.entries(TEND_PTS).map(([k, [x, y, z]]) => [k, armIK(s, x, y, z)]));
// 관절 공간 보간 (J1은 기계 쪽 0 ↔ AMR 쪽 π를 늘 같은 쪽으로 돌아 간다)
// 문 인터록: 문이 95% 넘게 열리기 전에는 기계 안 경유점(entry·table)으로 가지 않고 대기(home)에서 기다리며, 팔이 안에 있는 동안(r.tendInside)은 문을 닫지 않는다 (animCell)
function tendPose(r, p, doorK = 1) {
  const targets = r.machineTargets ?? TEND_PTS;
  if (!r.tendJ) {
    const J = r.arm.native ? Object.fromEntries(Object.entries(targets).map(([k, p]) => [k, r.arm.ik(...p)])) : tendJoints(r.scale ?? 1), T = r.arm.native ? TEND_TUCK : J.home;
    r.tendJ = { ...J, tuck: T, tuckB: [PI, ...T.slice(1)] };
  }
  const J = r.tendJ;
  let i = 0; while (i < TEND_SEQ.length - 2 && p >= TEND_SEQ[i + 1][0]) i++;
  const [p0, a] = TEND_SEQ[i], [p1, b] = TEND_SEQ[i + 1], k0 = Math.min(1, Math.max(0, (p - p0) / Math.max(1e-6, p1 - p0))), k = k0 * k0 * (3 - 2 * k0);
  const inside = a === 'entry' || a === 'table' || b === 'entry' || b === 'table';
  r.tendInside = inside && doorK >= 0.95;
  if (inside && !r.tendInside) { r.arm.native ? r.arm.pose(...J.home) : r.arm.pose(J.home[0], J.home[1], J.home[2], J.home[3], 0, 0); return; }
  const A = J[a], B = J[b], yaw = (q) => (Math.abs(q) > 3 ? PI : q);
  const q = A.map((v, j) => (j === 0 ? yaw(v) + (yaw(B[0]) - yaw(v)) * k : v + (B[j] - v) * k));
  if (r.arm.native) r.arm.pose(...q); else r.arm.pose(q[0], q[1], q[2], q[3], 0, (a === 'table' || b === 'table') ? k * 0.6 : 0);
}
function mcEnclosure(g, w, d, h, z, col) {
  const G = put(new THREE.Group(), 0, 0, z, g);
  put(box(w, 0.35, d, MAT.dark), 0, 0.175, 0, G);
  put(box(w, h - 0.35, 0.1, MAT.white), 0, 0.35 + (h - 0.35) / 2, -d / 2 + 0.05, G);
  for (const sx of [-1, 1]) put(box(0.1, h - 0.35, d, MAT.white), sx * (w / 2 - 0.05), 0.35 + (h - 0.35) / 2, 0, G);
  put(box(w, 0.12, d, MAT.white), 0, h - 0.06, 0, G);
  put(box(w + 0.04, 0.1, 0.06, col), 0, h - 0.18, d / 2, G);
  for (const sx of [-1, 1]) put(box((w - 1.3) / 2, h - 0.55, 0.08, MAT.white), sx * (w / 2 - (w - 1.3) / 4), 0.35 + (h - 0.55) / 2, d / 2 - 0.04, G);
  put(box(1.3, 0.2, 0.08, MAT.white), 0, h - 0.3, d / 2 - 0.04, G);
  const door = put(new THREE.Group(), 0, 0, d / 2 + 0.02, G);
  put(box(1.3, h - 0.75, 0.05, MAT.white), 0, 0.35 + (h - 0.75) / 2, 0, door);
  put(box(0.9, 0.7, 0.06, MAT.glass, false), 0, 1.45, 0, door);
  put(box(0.06, 0.4, 0.06, MAT.steel), 0.5, 1.2, 0.04, door);
  return { G, door, d };
}
function mcExtras(E) {
  put(box(0.5, 0.4, 2.0, MAT.dark), -1.75, 0.2, 0, E.G);
  const bin = put(box(0.6, 0.55, 0.6, std(0x5a6470, { metalness: 0.4 })), -1.8, 0.28, 1.25, E.G);
  put(box(0.55, 0.06, 0.55, std(0xc9ced4, { metalness: 0.7, roughness: 0.4 })), 0, 0.3, 0, bin);
  const panel = put(box(0.55, 0.8, 0.2, MAT.dark), 1.25, 1.55, E.d / 2 + 0.2, E.G);   // 미닫이 문(앞면 +0.02, 열면 x +1.25)보다 앞에 — 문이 조작반을 뚫지 않게
  const screen = emis(0x58c4ff, 1.2); put(box(0.42, 0.3, 0.02, screen, false), 0, 0.15, 0.11, panel);
  const edge = put(box(0.28, 0.18, 0.12, std(0x111418)), -1.25, 2.35, E.d / 2 + 0.07, E.G);
  const edgeLed = emis(0x3ddc84, 2); put(box(0.2, 0.03, 0.01, edgeLed, false), 0, 0.03, 0.065, edge);
  return { screen, edgeLed };
}
// 5축 머시닝센터: 트러니언 테이블 · 스핀들 헤드 · ATC 매거진 · 칩 컨베이어 · 조작반
function buildMill5(g, cell) {
  const product = makeProductMachine('umc1250', g, [0,0,TEND.mc.z]); if (product) { product.machine.configureWorkpiece(PRODUCT_DIM[cell.product]); return product; }
  const E = mcEnclosure(g, 3.0, 2.0, 2.75, TEND.mc.z, std(PC[cell.product] ?? PC.shared, { roughness: 0.4 }));
  const tz = TEND.table.z - TEND.mc.z;
  const trun = put(new THREE.Group(), TEND.table.x, 0.62, tz, E.G);
  for (const sx of [-0.55, 0.55]) put(box(0.14, 0.45, 0.5, MAT.dark), sx, 0.1, 0, trun);
  const cradle = put(new THREE.Group(), 0, 0.28, 0, trun);
  const table = put(cyl(0.36, 0.36, 0.08, MAT.steel, 28), 0, 0, 0, cradle);
  put(box(0.7, 0.04, 0.6, MAT.dark), 0, 0.06, 0, cradle);
  const head = put(new THREE.Group(), TEND.table.x, 2.05, tz, E.G);
  put(box(0.5, 0.75, 0.5, MAT.dark), 0, 0.2, 0, head);
  const spindle = put(cyl(0.11, 0.13, 0.32, MAT.steel, 18), 0, -0.32, 0, head);
  put(cyl(0.035, 0.045, 0.22, MAT.machined, 10), 0, -0.25, 0, spindle);
  const atc = put(new THREE.Group(), 1.62, 1.55, -0.1, E.G);
  const disc = put(cyl(0.62, 0.62, 0.16, MAT.dark, 32), 0, 0, 0, atc); disc.rotation.z = PI / 2;
  for (let k = 0; k < 24; k++) { const a = (k / 24) * PI * 2; put(cyl(0.035, 0.035, 0.22, k % 6 ? MAT.steel : MAT.yellow, 8), 0.12, Math.cos(a) * 0.52, Math.sin(a) * 0.52, disc).rotation.z = PI / 2; }
  put(box(0.9, 0.5, 0.5, std(0x3a6ea5)), 0.9, 0.25, -1.2, E.G);
  return { door: E.door, head, spindle, cradle, table, tz, coolant: put(makeSparks(0x9fe8ff, 40, 0.035), 0, 0, 0, E.G), chips: put(makeSparks(0xd8dde2, 30, 0.03), 0, 0, 0, E.G), ...mcExtras(E) };
}
// 복합 터닝센터: 척 · 공구 터렛 · 주축대 · 절삭력 동력계
function buildTurn(g, cell) {
  const product = makeProductMachine('st40', g, [0,0,TEND.mc.z]); if (product) { product.machine.configureWorkpiece(PRODUCT_DIM[cell.product]); return product; }
  const E = mcEnclosure(g, 3.2, 2.0, 2.6, TEND.mc.z, std(PC[cell.product] ?? PC.shared, { roughness: 0.4 }));
  const tz = TEND.table.z - TEND.mc.z;
  const chuck = put(new THREE.Group(), TEND.table.x, 0.62, tz, E.G);
  put(cyl(0.42, 0.46, 0.3, MAT.dark, 32), 0, 0.12, 0, chuck);
  const face = put(cyl(0.4, 0.4, 0.05, MAT.steel, 32), 0, 0.3, 0, chuck);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * PI * 2; put(box(0.1, 0.08, 0.16, MAT.yellow), Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3, face).rotation.y = -a; }
  const turret = put(new THREE.Group(), TEND.table.x + 0.9, 1.25, tz, E.G);
  const tdisc = put(cyl(0.32, 0.32, 0.18, MAT.dark, 12), 0, 0, 0, turret); tdisc.rotation.z = PI / 2;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * PI * 2; put(box(0.06, 0.06, 0.14, MAT.steel), -0.05, Math.cos(a) * 0.3, Math.sin(a) * 0.3, tdisc); }
  put(box(0.5, 0.5, 0.6, MAT.dark), TEND.table.x - 1.0, 1.0, tz, E.G);
  put(box(0.18, 0.18, 0.18, std(0x2b6cb0)), TEND.table.x + 0.55, 0.62, tz + 0.45, E.G);
  return { door: E.door, chuck, turret, tz, coolant: put(makeSparks(0x9fe8ff, 40, 0.035), 0, 0, 0, E.G), chips: put(makeSparks(0xb8bec6, 30, 0.03), 0, 0, 0, E.G), ...mcExtras(E) };
}
// 사선가공·디버링: 문형 사선 드릴 헤드 + 양쪽 협동로봇 디버링 + 출구 세척·에어 블로 터널
function buildDeburr(g) {
  for (const z of [-1.5, 1.5]) put(box(0.14, 2.7, 0.14, MAT.steel), -0.35, 1.45, z, g);
  put(box(0.22, 0.22, 3.14, MAT.steel), -0.35, 2.8, 0, g);
  const head = put(new THREE.Group(), -0.35, 2.3, 0, g);
  put(box(0.3, 0.35, 0.3, MAT.accent), 0, 0.15, 0, head); put(box(0.08, 1.2, 0.08, MAT.steel), 0, 0.85, 0, head);
  // 사선 주축(헤드 바로 아래에 붙음) + 드릴: 헤드가 내려오면(y 1.85) 날 끝이 지그 위 소재 윗면(약 1.13m)에 닿는다 — 대기(y 2.3) 때는 소재 위 0.45m
  const spin = put(new THREE.Group(), 0, -0.02, 0, head); spin.rotation.z = 0.5;
  put(cyl(0.07, 0.07, 0.5, MAT.dark, 14), 0, -0.25, 0, spin);
  const bit = put(cyl(0.025, 0.04, 0.32, MAT.steel, 10), 0, -0.66, 0, spin);
  const wash = put(new THREE.Group(), 1.55, 0, 0, g);
  for (const z of [-0.9, 0.9]) put(box(0.12, 2.0, 0.12, MAT.white), 0, 1.0, z, wash);
  put(box(0.7, 0.25, 1.95, MAT.white), 0, 2.0, 0, wash);
  for (const z of [-0.5, 0, 0.5]) put(cyl(0.03, 0.05, 0.16, MAT.steel, 8), 0, 1.82, z, wash);
  const curtain = put(box(0.02, 1.2, 1.7, MAT.booth, false), 0.32, 1.25, 0, wash);
  const screen = emis(0x3ddc84, 1.2);
  const ctl = put(box(0.5, 0.7, 0.35, MAT.dark), 1.95, 0.4, 1.6, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.18, ctl);
  for (const z of [-1.0, 1.0]) { const f = put(box(0.45, 0.7, 0.4, MAT.white), -2.07, 0.35, z, g); for (let k = 0; k < 3; k++) put(cyl(0.025, 0.025, 0.18, MAT.steel, 8), -0.12 + k * 0.12, 0.44, 0, f); }   // 공구 거치대 — 디버링 협동로봇(x −1.3) 작업 반경 밖으로
  return { head, bit, curtain, screen, spray: put(makeSparks(0x9fe8ff, 60, 0.04), 0, 0, 0, g) };
}
// 소재 식별·3D측정: 입구 게이트(소재 ID · 구조광 3D 스캐너) + 제품별 지그 표지
function buildMatId(g) {
  const gate = gateOf(g, -1.75, 0x37e8ff);
  for (const z of [-0.85, 0.85]) {
    const sc = put(new THREE.Group(), -1.75, 2.1, z, g); sc.rotation.x = z > 0 ? -0.6 : 0.6;
    put(box(0.36, 0.14, 0.18, MAT.dark), 0, 0, 0, sc);
    for (const x of [-0.1, 0.1]) put(box(0.08, 0.05, 0.02, emis(0x37e8ff, 2), false), x, 0, z > 0 ? -0.1 : 0.1, sc);
  }
  [['hblock', 1.15], ['rcover', -1.15]].forEach(([k, z]) => {
    const tag = put(box(0.5, 0.22, 0.04, std(PC[k], { emissive: PC[k], emissiveIntensity: 0.6 })), 1.85, 0.75, z * 1.35, g);
    put(box(0.04, 0.5, 0.04, MAT.dark), 0, -0.35, 0, tag);
  });
  return { ...gate, gateTitle: '소재 식별 · 3D 측정' };
}
// 초정밀 측정·리워크: 판정 게이트 · 문형 CMM(AMR이 아래로 진입) · 리워크 스핀들
function buildCMM(g) {
  const gate = gateOf(g, -1.75, 0x58c4ff);
  const granite = std(0x3b3f45, { roughness: 0.35, metalness: 0.1 });
  for (const z of [-1.25, 1.25]) put(box(1.25, 0.25, 0.3, granite), 0.325, 0.125, z, g);
  const bridge = put(new THREE.Group(), 0.15, 0, 0, g);
  for (const z of [-1.2, 1.2]) put(box(0.18, 2.3, 0.22, MAT.white), 0, 1.4, z, bridge);
  put(box(0.24, 0.26, 2.6, MAT.white), 0, 2.55, 0, bridge);
  const car = put(new THREE.Group(), 0, 2.55, 0, bridge);
  put(box(0.3, 0.34, 0.3, MAT.accent), 0, 0, 0, car);
  const quill = put(new THREE.Group(), 0, 0, 0, car);
  // 프로브 램: 캐리지를 관통하는 긴 봉 (위로 0.6m) — 측정 때 0.39m 내려가도 캐리지에서 빠지지 않고, 탐침 끝이 소재 윗면(약 1.13m)에 닿는다
  put(box(0.1, 1.6, 0.1, MAT.steel), 0, -0.2, 0, quill);
  const tipMat = emis(0xff4d6d, 1.5); put(mesh(new THREE.SphereGeometry(0.03, 12, 8), tipMat), 0, -1.02, 0, quill);
  const rw = put(new THREE.Group(), 1.95, 0, -1.55, g);
  put(box(0.7, 0.9, 0.6, MAT.dark), 0, 0.45, 0, rw);
  const rwSpin = put(cyl(0.06, 0.08, 0.3, MAT.steel, 12), 0, 1.15, 0, rw);
  const rwLamp = emis(0xf5b82e, 0.3); put(box(0.5, 0.05, 0.05, rwLamp, false), 0, 0.95, 0.31, rw);
  const screen = emis(0x3ddc84, 1.2);
  const ctl = put(box(0.6, 0.45, 0.06, MAT.dark), 1.95, 1.6, 1.5, g); put(box(0.52, 0.36, 0.02, screen, false), 0, 0, 0.04, ctl);
  put(box(0.06, 1.35, 0.06, MAT.dark), 1.95, 0.68, 1.5, g);
  return { ...gate, gateTitle: 'CMM 판정', bridge, car, quill, tipMat, rwSpin, rwLamp, screen };
}
const BUILD = { kit: buildKit, locate: buildLocate, spot: buildSpot, seal: buildSeal, hem: buildHem, mount: buildMount, vision: (g) => buildVision(g), rework: buildRework, mill5: buildMill5, turn: buildTurn, deburr: buildDeburr, matid: buildMatId, cmm: buildCMM };

// 투입 스테이션(AS/RS 출고 포트) · 구분 적재장 — 두 Zone 공통 간이 형상
// 자재 투입존 (정밀조립Zone 투입 스테이션과 같은 구성): 혼류 제품별로 양쪽에 따로 보관 (첫 제품 +z · 둘째 제품 −z) — 판넬(후드·도어)은 빗살 거치대에 세워 2열 × 10장,
// 주조·단조 소재(유압블록·리어커버)는 팔레트에 4 × 3 × 2단 · 가운데는 AMR 지그 투입 위치 · 직교 3축 갠트리가 다음 투입 제품 쪽에서 집어 지그에 내려놓는다
const SRC_SIDE = 20;   // 제품별 보관 칸 (sim.js ZONE_SRC.cap = 양쪽 합)
function buildPort(g, Z, kind) {
  if (kind === 'src') {
    put(box(4.2, 0.06, 6.8, MAT.dark), 0, 0.03, 0, g);
    put(box(4.2, 0.01, 1.5, MAT.lane), 0, 0.065, 0, g);
    const auto = put(new THREE.Group(), 0, 0, 0, g);
    for (const x of [-1.95, 1.95]) for (const z of [-3.15, 3.15]) put(box(0.12, 3.0, 0.12, MAT.yellow ?? MAT.accent), x, 1.5, z, auto);
    for (const z of [-3.15, 3.15]) { put(box(4.1, 0.14, 0.14, MAT.yellow ?? MAT.accent), 0, 3.0, z, auto); put(box(3.9, 0.03, 0.05, MAT.steel), 0, 3.09, z, auto); }
    const bridge = put(new THREE.Group(), 0, 3.0, 0, auto);
    put(box(0.18, 0.18, 6.5, MAT.dark), 0, 0.12, 0, bridge);
    for (const z of [-3.15, 3.15]) put(box(0.3, 0.14, 0.26, MAT.orange), 0, 0.14, z, bridge);
    const car = put(new THREE.Group(), 0, 0, 0, bridge);
    put(box(0.4, 0.3, 0.4, MAT.orange), 0, -0.05, 0, car); put(box(0.18, 0.7, 0.18, MAT.dark), 0, 0.3, 0, car);
    const lift = put(new THREE.Group(), 0, 0, 0, car);
    put(box(0.08, 2.7, 0.08, MAT.steel), 0, -0.25, 0, lift); put(box(0.5, 0.08, 0.4, MAT.dark), 0, -1.6, 0, lift);
    // 제품별 보관 구역 바닥색 · 거치대 · 바닥 이름 (혼류 구분)
    Object.keys(Z.products).forEach((k, i) => {
      const z = i ? -2.15 : 2.15, panel = k === 'hood' || k === 'door';
      const tint = put(new THREE.Mesh(new THREE.PlaneGeometry(3.9, 1.9), new THREE.MeshBasicMaterial({ color: PC[k], transparent: true, opacity: 0.32, depthWrite: false })), 0, 0.07, z, g); tint.rotation.x = -PI / 2;
      if (panel) {   // 빗살 거치대
        put(box(3.7, 0.08, 1.6, MAT.steel), 0, 0.04, z, g);
        for (const cx of [-0.95, 0.95]) for (let j = 0; j <= 10; j++) for (const x of [-0.5, 0.5]) put(box(0.02, 0.5, 0.02, MAT.accent), cx + x, 0.33, z - 0.725 + j * 0.145, g);
      } else put(box(3.6, 0.12, 1.6, MAT.pallet), 0, 0.06, z, g);
      put(textPlane([Z.products[k].label], 2.4, 0.6, hex(PC[k])), 0, 0.08, i ? -3.65 : 3.65, g);
    });
    return { auto, bridge, car, lift };
  } else if (Z.pack) {   // 포장·구분 적재: AMR 하역 자리 바닥판만 (팔레트·로봇은 ExtraZone.buildPack)
    put(box(3.2, 0.06, 2.4, MAT.dark), 0, 0.03, 0, g);
    put(box(3.2, 0.01, 1.5, MAT.lane), 0, 0.065, 0, g);
  } else {
    Object.keys(Z.products).forEach((k, i) => {
      const z = i ? -1.35 : 1.35;
      put(box(1.3, 0.12, 1.0, MAT.pallet), 0.9, 0.06, z, g);
      for (let j = 0; j < 4; j++) put(box(1.1, 0.22, 0.85, k === 'hood' || k === 'hblock' ? MAT.carton : std(0x6d5a8a)), 0.9, 0.24 + j * 0.24, z, g);
    });
  }
}

// 지그 위 제품 — Blender 모델(assets/blender/*.glb)이 있으면 그것으로, 없으면 기본 도형
const PRODUCT_DIM = { hood: [1.606, 0.555, 0.05], door: [1.25, 1.1, 0.05], hblock: [0.66, 0.62, 0.13], rcover: [0.46, 0.43, 0.19] };
function makeProduct(kind) {
  const g = new THREE.Group();
  if (blenderOn() && RENDER.assets[kind]) {
    const A = cloneAsset(kind); g.add(A.root);
    g.userData = { stage: kind === 'hood' || kind === 'door'
      ? { welds: A.find('WeldSpots'), bead: A.find('SealBead'), hem: A.find('HemEdge'), hinges: A.find('Hinges') }
      : { raw: A.find('Raw'), mac: A.find('Machined'), fin: A.find('Finish') } };
    return g;
  }
  const [L, D, H] = PRODUCT_DIM[kind];
  put(box(L, H, D, kind === 'hblock' || kind === 'rcover' ? MAT.raw : MAT.steel), 0, H / 2 + 0.04, 0, g);
  g.userData = { stage: {} };
  return g;
}
// 공정 진행에 따라 제품 모델의 공정 표시(용접점·실링 비드·헤밍·힌지 / 소재·가공면·마감)를 켠다
function styleProduct(m, item) {
  const S = m.userData.stage, d = item.done;
  const vis = (o, v) => { if (o) o.visible = v; };
  if (item.product === 'hood' || item.product === 'door') {
    vis(S.welds, d.has('C03')); vis(S.bead, d.has('C04')); vis(S.hem, d.has('C05'));
    vis(S.hinges, item.product === 'hood' ? d.has('C01') : d.has('C10'));
  } else {
    const mac = d.has('HB_MILL') || d.has('RC_MILL'), fin = d.has('HB_DEBR') || d.has('RC_TURN');
    vis(S.raw, !mac); vis(S.mac, mac); vis(S.fin, fin);
  }
}
// 레거시 단계: 셀 사이 운반은 작업자가 미는 대차
function makeCart() {
  const g = new THREE.Group();
  put(box(0.9, 0.06, 1.3, MAT.steel), 0, BELT_Y - 0.03, 0, g);
  for (const [x, z] of [[-0.4, -0.58], [0.4, -0.58], [-0.4, 0.58], [0.4, 0.58]]) { put(box(0.04, BELT_Y - 0.12, 0.04, MAT.steel), x, (BELT_Y - 0.12) / 2 + 0.1, z, g); put(cyl(0.08, 0.08, 0.06, MAT.rubber, 12), x, 0.08, z, g).rotation.z = PI / 2; }
  put(box(0.9, 0.05, 0.05, MAT.dark), 0, 1.15, -0.72, g); for (const x of [-0.42, 0.42]) put(box(0.04, 0.5, 0.04, MAT.dark), x, 0.9, -0.7, g);
  g.userData = {};
  return g;
}
function textPlane(lines, w, h, color) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const x = c.getContext('2d'), F = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color; x.font = `900 ${c.height * 0.42}px ${F}`; x.fillText(lines[0], c.width / 2, c.height * (lines[1] ? 0.36 : 0.5));
  if (lines[1]) { x.fillStyle = 'rgba(230,237,243,0.85)'; x.font = `700 ${c.height * 0.22}px ${F}`; x.fillText(lines[1], c.width / 2, c.height * 0.78); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -PI / 2; return m;
}

// ── Zone 하나: 정적 형상 + 흐름 시뮬레이션 + 화면 동기화 ─────────────────
class ExtraZone {
  constructor(Z, root) {
    this.Z = Z; this.mix = { ...Z.mix };
    this.G = put(new THREE.Group(), Z.origin.x, 0, Z.origin.z, root);
    this.dyn = put(new THREE.Group(), 0, 0, 0, this.G);
    const acc = hex(Z.accent);
    // Zone 바닥 구역(셀 영역 테두리) · 바닥 Zone 이름 · 공중 표지
    // 바닥은 정밀조립Zone(factory.js buildZoneDeco)과 같게: 건물 바닥 그대로 + 하늘색 점선 테두리 + 셀마다 반투명 색 바닥 (공동 청록 · 제품별 주황/보라 · NG 빨강)
    const F = Z.foot, flat = (w, d, mat, x, z, y) => { const m = put(new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat), x, y, z, this.G); m.rotation.x = -PI / 2; m.receiveShadow = true; return m; };
    const edge = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.55 });
    for (let x = F.x0; x < F.x1; x += 1.6) for (const z of [F.z0, F.z1]) flat(Math.min(1.0, F.x1 - x), 0.12, edge, x + 0.5, z, 0.012);
    for (let z = F.z0; z < F.z1; z += 1.6) for (const x of [F.x0, F.x1]) flat(0.12, Math.min(1.0, F.z1 - z), edge, x, z + 0.5, 0.012);
    for (const c of Object.values(Z.cells)) flat(5.0, 4.6, new THREE.MeshStandardMaterial({ color: PC[c.product] ?? PC.shared, transparent: true, opacity: 0.3, roughness: 0.9, depthWrite: false }), c.x, c.z, 0.01);
    // Zone 이름·라인 설명: 셀·AMR 길을 비킨 빈 바닥 (Z.floor — 정밀조립Zone 바닥 글씨와 같은 꼴: 왼쪽 정렬 · 라인 색)
    const FL = Z.floor;
    this.titleAt = { x: FL.title.x, z: FL.title.z };
    put(textPlane([FL.title.text], 15, 1.5, acc), this.titleAt.x, 0.02, this.titleAt.z, this.G);
    for (const L of FL.lines) {
      const w = L.w ?? FL.w, c = document.createElement('canvas'); c.width = 1024; c.height = 128;
      const x = c.getContext('2d'); x.fillStyle = L.color; const fnt = (px) => `bold ${px}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`, px = L.size ?? FL.size;
      x.font = fnt(px); const tw = x.measureText(L.text).width; if (tw > 1000) x.font = fnt(Math.floor(px * 1000 / tw));   // 넘치면 글자를 줄여 맞춘다
      x.textBaseline = 'middle'; x.fillText(L.text, 12, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      flat(w, w / 8, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), (L.x ?? FL.x) + w / 2, L.z, 0.014);
    }
    this.cells = {}; this.order = [];
    for (const [id, c] of Object.entries(Z.cells)) {
      const g = put(new THREE.Group(), c.x, 0, c.z, this.G); g.rotation.y = c.rot ?? 0; g.scale.z = c.side ?? 1;
      g.userData.zoneCell = { zone: Z.key, cellId: id };   // 클릭 → 셀 정보 창 (factory.js pick · ui.js renderZoneCell)
      cellBase(g, 4.6);
      const equipmentRoot = put(new THREE.Group(), 0, 0, 0, g);
      const parts = BUILD[c.type](equipmentRoot, c);
      const light = put(makeStackLight(), -1.9, 0.15, -1.6, g);
      // IoT 노드 (정밀조립Zone 셀과 같은 자리·모양 — factory.js setup): 셀 데이터를 Zone 데이터 서버로 올린다
      const sensorMat = emis(0x37e8ff, 2.5), ringM = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
      const iot = put(new THREE.Group(), 1.7, 3.2, -1.4, g), sensor = put(mesh(new THREE.SphereGeometry(0.12, 12, 10), sensorMat, false), 0, 0, 0, iot);
      const pulse = put(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 24), ringM), 0, 0, 0, iot); pulse.rotation.x = -PI / 2;
      const robotsG = put(new THREE.Group(), 0, 0, 0, g), workersG = put(new THREE.Group(), 0, 0, 0, g);
      const el = document.createElement('div'); el.className = 'st-label xz';
      const no = c.no ?? id;
      el.innerHTML = `<div class="nm"><b class="no${no.length > 1 ? ' wide' : ''}">${no}</b><span>${c.label}</span><i class="uid">${Z.uidp}-${id}</i></div><div class="use u-${USE_CLS[c.product] ?? 'shared'}">${c.use}</div><div class="row"><span class="chip s-IDLE">대기</span></div><div class="rb"></div>`;
      const label = new CSS2DObject(el); label.position.set(0, 4.3, 0); g.add(label);
      const cell = { equipmentRoot, equipmentBlender: blenderOn(), id, def: c, g, parts, light, robotsG, workersG, robots: [], robotUids: [], iot, sensor, pulse, ringM, sensorMat, phase: Math.random() * 6, el, chip: el.querySelector('.chip'), rb: el.querySelector('.rb'), label, occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0 };
      this.cells[id] = cell; this.order.push(cell);
    }
    this.src = { id: 'SRC', def: Z.src, occ: null }; this.sink = { id: 'SINK', def: Z.sink, occ: null };
    for (const [n, kind] of [[this.src, 'src'], [this.sink, 'sink']]) {
      const g = put(new THREE.Group(), n.def.x, 0, n.def.z, this.G); g.rotation.y = n.def.rot ?? 0; n.port = buildPort(g, Z, kind);
      if (kind === 'src') { n.stockG = put(new THREE.Group(), 0, 0, 0, g); n.heldG = put(new THREE.Group(), 0, 0, 0, n.port.lift); }
      const el = document.createElement('div'); el.className = 'st-label xz';
      el.innerHTML = `<div class="nm"><span>${kind === 'src' ? '자재 투입 (AS/RS)' : Z.pack ? '포장·구분 적재 (제품별)' : '양품 구분 적재'}</span><i class="uid">${Z.uidp}-${kind === 'src' ? 'AS' : 'PL'}-01</i></div><div class="row"><span class="chip s-IDLE"></span></div>`;
      const label = new CSS2DObject(el); label.position.set(0, 4.0, 0); g.add(label);
      Object.assign(n, { g, el, label, chip: el.querySelector('.chip') });
    }
    if (Z.pack) this.buildPack();
    // Zone 현황판 (Zone 위 공중, 라벨과 함께 켜고 끔)
    const bel = document.createElement('div'); bel.className = 'xz-board'; bel.style.setProperty('--zc', acc);
    this.board = new CSS2DObject(bel); this.board.position.set(this.titleAt.x, 3.4, this.titleAt.z - 1.7); this.G.add(this.board); this.boardEl = bel;   // 바닥 Zone 이름 바로 뒤 위 (위에서 볼 때 이름을 가리지 않게)
    // Zone AMR 스테이션 (정밀조립Zone AMR 스테이션과 같은 구조 — zonedefs.js ZONE_FAC.station): AMR마다 자기 대기 자리(AMR i ↔ 자리 i)
    //  · 복귀: 적재 → Zone 복귀로 → 복귀 차로 → 자기 자리로 들어가 출동 차로 쪽을 보고 선다 (무선 충전)
    //  · 출동: 투입 대기열(투입구 앞 STATION_LEAD칸)이 비면 출구에 가까운 자리의 AMR부터 → 출동 차로 → 투입 진입로 → 대기열 → 투입구
    const ST = ZONE_FAC[Z.key]?.station, o = Z.origin;
    const keep = Z.ret.slice(0, -2), zr = keep[keep.length - 1].z;
    const loc = (p) => ({ x: p.x - o.x, z: p.z === 'ret' ? zr : p.z === 'src' ? Z.src.z : p.z - o.z });
    this.st = ST ? {
      keep, retZ: ST.retZ - o.z, outZ: ST.outZ - o.z, ret: ST.ret.map(loc), out: ST.out.map(loc), face: ST.outZ > ST.rowZ ? 0 : PI,
      slots: Array.from({ length: Z.amr.count }, (_, k) => ({ x: ST.x0 + ST.pitch * k - o.x, z: ST.rowZ - o.z })),
    } : null;
    this.retPath = [{ x: Z.sink.x, z: Z.sink.z }, ...Z.ret, { x: Z.src.x, z: Z.src.z }];   // 스테이션이 없을 때 (복귀로 끝 = 투입 대기열)
    const tail = this.st ? [...this.st.out, { x: Z.src.x, z: Z.src.z }] : this.retPath, rev = [...tail].reverse(), L = pathLength(rev);
    // 투입 대기열 자리: 스테이션이 있으면 투입존(투입구 ±2.1m) 밖 진입 구간부터 (투입구 중심에서 3.2m · 5.2m) — 정밀조립Zone처럼 투입존 밖에서 기다린다
    this.qSlots = []; for (let s = this.st ? 3.2 : 2.2; s < L - 1 && this.qSlots.length < (this.st ? STATION_LEAD : Z.amr.count); s += 2.0) this.qSlots.push(pointAt(rev, s));
    this.buildFloorPaths();
    this.buildWall(root);
    this.reset();
  }

  // 포장·구분 적재 (정밀조립 구분 적재장과 같은 구성 — factory.js buildSink): 제품별 적재 팔레트 · 팔레타이징 로봇(제품 색 받침) · 포장 박스 적재
  // AMR이 적재장 가운데 서면 그 제품 로봇이 지그 위 제품을 포장 박스째 집어 다음 칸에 쌓는다 → 출하 지게차가 팔레트(8개)씩 트럭으로 (shipping.js planForklift)
  buildPack() {
    const Z = this.Z, g = put(new THREE.Group(), 0, 0, 0, this.G); this.packG = g;
    this.pack = {};
    for (const q of zonePack(Z)) {
      const col = PC[q.product], { x, z } = q.pallet;
      const pad = put(new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.7), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })), x, 0.02, z, g); pad.rotation.x = -PI / 2;
      put(box(2.6, 0.12, 1.4, MAT.pallet), x, 0.12, z, g);
      const mat = std(q.product === 'hood' || q.product === 'hblock' ? 0xc9a36a : 0xb59adf, { roughness: 0.8 });
      const stack = [];
      for (let i = 0; i < ZONE_FG_CAP; i++) { const lx = i % 4, lz = Math.floor(i / 4) % 2, ly = Math.floor(i / 8); const b = put(box(0.6, 0.45, 0.6, mat), x - 0.96 + lx * 0.64, 0.41 + ly * 0.47, z - 0.32 + lz * 0.64, g); b.visible = false; stack.push(b); }
      const lab = put(textPlane([`${Z.products[q.product].label} 팔레트`], 2.4, 0.4, 'rgba(255,255,255,0.9)'), x, 0.03, z + q.sd * 1.05, g);
      put(cyl(0.55, 0.6, 0.06, std(col, { roughness: 0.5 })), q.arm.x, 0.03, q.arm.z, g);   // 로봇 받침 (제품 색)
      const idx = Object.keys(this.pack).length;
      this.pack[q.product] = { ...q, armPos: q.arm, arm: null, stack, mat, col, uid: `${Z.uidp}-RB-PL-${idx + 1}`, idx, lab };
    }
    this.packArmsG = put(new THREE.Group(), 0, 0, 0, g);
  }
  // 팔레타이징 로봇은 실행마다 새로 만든다 (Blender 모델이 늦게 들어오면 그 모델로 — 셀 로봇 buildCrew와 같음)
  packArms() {
    if (!this.pack) return;
    this.packArmsG.clear();
    for (const P of Object.values(this.pack)) {
      const arm = makeArm(std(P.col, { roughness: 0.45, metalness: 0.3 }), 1.2, 'articulated'); put(arm.root, P.armPos.x, 0.06, P.armPos.z, this.packArmsG);
      arm.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const held = put(box(0.6, 0.45, 0.6, P.mat), 0, (arm.native ? 1 : -1) * 0.25, 0, arm.tip); held.visible = false;
      arm.root.traverse((o) => { o.userData.stationId = `${this.Z.uidp}_PACK`; o.userData.robotIdx = P.idx; });
      const sp = idPlate(P.uid); sp.position.set(0, 3.0, 0); arm.root.add(sp);
      Object.assign(P, { arm, held, sp, robot: null });
    }
  }
  // 팔레타이징 로봇 자세 (진행률 u: 0 대기 → 집기 → 옮기기 → 내려놓기 → 복귀) — 정밀조립 animatePalletizers와 같은 경유점
  animPack() {
    if (!this.pack || !Object.values(this.pack)[0]?.arm) return;
    const s = 1.2, job = this.packJob, legacy = this.mode === 'traditional';
    const lerpA = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k), ease = (k) => k * k * (3 - 2 * k);
    for (const [p, P] of Object.entries(this.pack)) {
      const n = Math.min(ZONE_FG_CAP, this.fgOf(p)); P.stack.forEach((b, i) => (b.visible = i < n));
      P.arm.root.visible = !legacy; P.sp.visible = this.labelsOn !== false && !legacy;
      const A = P.armPos, rel = (x, y, z) => P.arm.native ? P.arm.ik(x - A.x, y - 0.06, z - A.z, true) : armIK(s, x - A.x, y - 0.06, z - A.z);
      const home = rel(A.x, 1.9, A.z - P.sd * 0.6);
      let q = home;
      if (job && job.product === p && !legacy) {
        const u = Math.min(1, job.u), sk = this.Z.sink, idx = Math.min(ZONE_FG_CAP - 1, n), b = P.stack[idx].position, top = BELT_Y + 0.45;
        const keys = [[0, home], [0.22, rel(sk.x, top + 0.6, sk.z)], [0.32, rel(sk.x, top, sk.z)], [0.42, rel(sk.x, top + 0.6, sk.z)], [0.7, rel(b.x, b.y + 0.95, b.z)], [0.8, rel(b.x, b.y + 0.25, b.z)], [0.9, rel(b.x, b.y + 0.95, b.z)], [1, home]];
        const i = keys.findIndex((kf) => kf[0] >= u), [t0, p0] = keys[Math.max(0, i - 1)], [t1, p1] = keys[i];
        q = lerpA(p0, p1, ease(t1 > t0 ? (u - t0) / (t1 - t0) : 1));
        P.held.visible = u >= 0.32 && u < 0.8;
        if (job.c.pm) job.c.pm.visible = u < 0.32;
      } else P.held.visible = false;
      P.arm.pose(...q);
    }
  }
  fgOf(p) { return this.sim?.zoneFg?.[p] ?? (this.fgLocal?.[p] ?? 0); }

  // 바닥 AMR 경로: ① 셀 사이 유도 테이프 (투입구 → 제품별 공정 순서 → 구분 적재장 · NG 분기) ② 스테이션 전용 차로 점선 (복귀 전용로 · 출동 차로 · 진입로)
  // ③ 스테이션 대기 자리 줄 바닥색 · 투입존 밖 대기 자리 테두리 · 바닥 글씨 — 정밀조립Zone 바닥 표시와 같은 색·모양
  buildFloorPaths() {
    const Z = this.Z, g = put(new THREE.Group(), 0, 0, 0, this.G);
    const guide = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.8 }), tape = new THREE.MeshBasicMaterial({ color: 0x7fe0d6, transparent: true, opacity: 0.7 });
    const at = (id) => (id === 'SRC' ? Z.src : id === 'SINK' ? Z.sink : Z.cells[id]);
    const edges = new Set();
    for (const r of Object.values(Z.routes)) ['SRC', ...r, 'SINK'].forEach((id, i, a) => i && edges.add(`${a[i - 1]}>${id}`));
    if (Z.ng) { edges.add(`${Z.ng.at}>${Z.ng.to}`); edges.add(`${Z.ng.to}>SINK`); }
    for (const e of edges) {
      const [aId, bId] = e.split('>'), a = at(aId), b = at(bId);
      guideTape(g, trimPoly(cellPath(Z, aId, bId, { x: a.x, z: a.z }, { x: b.x, z: b.z }), aId === 'SRC' ? 2.2 : 2.3, 0), guide);
    }
    const flatText = (text, w, x, z, rot = 0) => { const m = textPlane([text], w, w / 7, 'rgba(127,224,214,0.95)'); put(m, x, 0.02, z, g); m.rotation.z = rot; return m; };
    const S = this.st; if (!S) return;
    const sl = S.slots, first = sl[0], last = sl[sl.length - 1], rEnd = S.ret[S.ret.length - 1];
    // 복귀 전용로: 적재장 → Zone 복귀로 → 스테이션 쪽 → 복귀 차로(자리 줄 끝까지)
    const far = Math.abs(first.x - rEnd.x) > Math.abs(last.x - rEnd.x) ? first : last;
    dashLine(g, [{ x: Z.sink.x, z: Z.sink.z }, ...S.keep, ...S.ret, { x: far.x, z: S.retZ }], tape);
    // 출동 차로: 자리 줄 반대쪽 끝 → 출동 차로 → 진입로 → 투입존 앞
    const outFar = Math.abs(first.x - S.out[0].x) > Math.abs(last.x - S.out[0].x) ? first : last;
    dashLine(g, trimPoly([{ x: outFar.x, z: S.outZ }, ...S.out, { x: Z.src.x, z: Z.src.z }], 0, 2.2), tape);
    // 대기 자리 줄 바닥색 · 투입존 밖 대기 자리 테두리
    const x0 = Math.min(first.x, last.x) - 0.7, x1 = Math.max(first.x, last.x) + 0.7;
    const strip = put(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 1.9), new THREE.MeshStandardMaterial({ color: 0x2bb3a6, transparent: true, opacity: 0.22, depthWrite: false })), (x0 + x1) / 2, 0.01, first.z, g); strip.rotation.x = -PI / 2;
    for (const q of this.qSlots) {
      for (const [w, d, dx, dz] of [[1.5, 0.08, 0, -0.55], [1.5, 0.08, 0, 0.55], [0.08, 1.1, -0.75, 0], [0.08, 1.1, 0.75, 0]]) put(new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape), q.x + dx, 0.017, q.z + dz, g).rotation.x = -PI / 2;
      flatText('투입 대기', 2.0, q.x, q.z + 1.25);   // 대기 자리 테두리 바로 옆
    }
    // 바닥 글씨: 대기 자리 · 복귀 전용로 · 출동 차로 (차로 바깥쪽에)
    const side = Math.sign(S.outZ - S.retZ);   // 출동 차로가 있는 쪽 (+z/−z)
    flatText(`${Z.code} AMR 대기 자리 1 ~ ${sl.length}`, 6, (x0 + x1) / 2, first.z);
    flatText('AMR 복귀 전용로', 4.5, (x0 + x1) / 2, S.retZ - side * 0.9);
    flatText('AMR 출동 차로', 4.5, (x0 + x1) / 2, S.outZ + side * 0.9);
  }

  // Zone 전광판 · 데이터 서버 (자동화·피지컬AI — 레거시 단계는 정밀조립Zone 관제 서버처럼 숨긴다): 위치는 zonedefs.js ZONE_FAC.wall
  // 전광판: Zone 실적·UPH · 셀별 상태와 건강도 · AMR · 정비 · 사족보행 · 드론 · 확장 선반 재고 (0.5초마다 다시 그림)
  buildWall(root) {
    const W = ZONE_FAC[this.Z.key]?.wall; if (!W) return;
    const B = W.board, cv = document.createElement('canvas'); cv.width = 1800; cv.height = 400;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const g = put(new THREE.Group(), B.x, B.y, B.z, root); g.rotation.y = B.rot;
    put(box(B.w + 0.3, B.h + 0.3, 0.12, std(0x0b0d10, { roughness: 0.5, metalness: 0.4 })), 0, 0, -0.08, g);   // 테두리 판
    put(new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })), 0, 0, 0, g);
    g.traverse((o) => (o.castShadow = false));
    this.board2 = { g, cv, tex, t: 0 };
    const S = W.server, srv = put(new THREE.Group(), S.x, 0, S.z, root); srv.rotation.y = S.rot;   // 서버 랙 4대 (앞면 = 건물 안쪽)
    this.srvLeds = [];
    for (const x of [-1.65, -0.55, 0.55, 1.65]) {
      const rk = put(box(0.9, 2.3, 1.0, MAT.dark), x, 1.15, 0, srv);
      for (let k = 0; k < 6; k++) { const m = emis(k % 2 ? 0x3dff8a : 0x2aa8ff, 2); this.srvLeds.push(m); put(box(0.6, 0.04, 0.02, m, false), 0, -0.8 + k * 0.32, 0.51, rk); }
    }
    // 셀 IoT 노드 → 이 서버로 날아가는 데이터 패킷 목적지 (서버 랙 앞면 가운데, 정밀조립 factory.js serverPos와 같은 높이)
    this.serverPos = new THREE.Vector3(S.x + Math.sin(S.rot) * 0.5, 2.6, S.z + Math.cos(S.rot) * 0.5);
    this.pkG = put(new THREE.Group(), 0, 0, 0, root); this.packets = [];
    put(textPlane([`${this.Z.code} 데이터 서버`, `${this.Z.name} · MES · 셀 PLC · 영상`], 3.0, 0.6, hex(this.Z.accent)), 0, 2.72, 0.45, srv).rotation.x = 0;
    this.srv = srv;
  }
  drawWall() {
    const B = this.board2, s = this.sim; if (!B || !s) return;
    const c = B.cv.getContext('2d'), W = B.cv.width, H = B.cv.height, F = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif', Z = this.Z, acc = hex(Z.accent);
    const ST = { BUSY: ['가동', '#3ddc84'], IDLE: ['대기', '#8fb3c9'], BLOCKED: ['출구 대기', '#f5b82e'], DOWN: ['고장', '#ff5a5a'], MAINT: ['정비중', '#f5b82e'], ESTOP: ['정지', '#ff5a5a'] };
    c.fillStyle = '#04121f'; c.fillRect(0, 0, W, H);
    c.fillStyle = acc; c.fillRect(0, 0, 14, H);
    const good = this.stats.good, tot = Object.values(good).reduce((a, b) => a + b, 0), uph = this.time > 120 ? Math.round((tot / this.time) * 3600) : 0;
    c.textBaseline = 'middle'; c.fillStyle = '#e8eef4'; c.font = `800 44px ${F}`; c.fillText(`${Z.name} 운영 현황`, 36, 40);
    c.font = `700 32px ${F}`; c.fillStyle = '#c9d2dc';
    c.fillText(`${Object.entries(Z.products).map(([k, v]) => `${v.label} ${good[k] ?? 0}`).join(' · ')} · UPH ${uph} · 투입 ${this.stats.released} · ${Z.ng ? `NG ${this.stats.ng}` : `리워크 ${this.stats.rework}`} · 셀 고장 누적 ${s.zoneCells.filter((x) => x.zone === Z.key).reduce((a, x) => a + x.c.fails, 0)}건`, 640, 40);
    // 셀 타일: 이름 · 상태 · 건강도 막대
    const n = this.order.length, tw = (W - 60) / n;
    this.order.forEach((cell, i) => {
      const x = 36 + i * tw, zc = s.zoneCell(Z.key, cell.id), st = (s.cmd?.estopAll || s.cmd?.pstopAll) ? 'ESTOP' : cell.fault ?? cell.state, [lab, col] = ST[st] ?? [st, '#8fb3c9'];
      c.fillStyle = '#0c2133'; c.fillRect(x, 78, tw - 12, 150);
      c.fillStyle = col; c.fillRect(x, 78, tw - 12, 8);
      c.font = `700 26px ${F}`; c.fillStyle = '#e8eef4'; let label = `${cell.def.no ?? cell.id} ${cell.def.label}`; while (c.measureText(label).width > tw - 28 && label.length > 4) label = label.slice(0, -1);
      c.fillText(label, x + 8, 112);
      c.font = `800 30px ${F}`; c.fillStyle = col; c.fillText(lab, x + 8, 152);
      const h = zc?.health ?? 100; c.fillStyle = '#16232f'; c.fillRect(x + 8, 186, tw - 28, 18);
      c.fillStyle = h < 40 ? '#ff5a5a' : h < 60 ? '#f5b82e' : '#3ddc84'; c.fillRect(x + 8, 186, (tw - 28) * h / 100, 18);
      c.font = `600 20px ${F}`; c.fillStyle = '#8fb3c9'; c.fillText(`건강도 ${Math.round(h)}%${zc?.request ? ` · ${zc.request.kind === 'repair' ? '긴급수리' : '예지정비'}` : ''}`, x + 8, 218);
    });
    // 아래: AMR · 정비 · 순찰 로봇 · 물류
    const cs = this.carriers.reduce((a, k) => ((a[k.state] = (a[k.state] ?? 0) + 1), a), {}), legacy = this.mode === 'traditional';
    const techs = s.techs.filter((t) => t.zone === Z.key), quads = s.quads.filter((q) => q.zone === Z.key), drones = (s.drones ?? []).filter((d) => d.zone === Z.key);
    const w = s.whZone?.[Z.key], kits = s.zoneKits?.[Z.key];
    const short = (m) => (m.task ? m.task.replace(/\s*\(.*\)$/, '').slice(0, 14) : '대기');
    const rows = [
      [`${legacy ? '대차' : 'AMR'} ${this.carriers.length}대`, `스테이션 ${cs.park ?? 0} · 투입 대기 ${cs.queue ?? 0} · 운행 ${this.carriers.length - (cs.park ?? 0) - (cs.queue ?? 0)}`],
      [`정비 ${techs.length}명`, techs.map((t) => `${t.id.split(' ').pop()} ${short(t)}`).join(' · ')],
      [`순찰 로봇`, quads.length || drones.length ? [...quads.map((q) => `${q.id.split(' ').pop()} ${Math.round(q.battery)}%`), ...drones.map((d) => `드론-${d.idx + 1} ${Math.round(d.battery)}% ${d.mode === 'mission' ? '출동' : d.mode === 'patrol' ? '순찰' : '충전'}`)].join(' · ') : '피지컬AI 단계에서 운용'],
      [`물류`, w ? `투입구 원재료 ${s.zoneRaw?.[Z.key] ?? '-'}/40${kits != null ? ` · 키트 ${kits}/12` : ''} · 확장 선반 원재료 ${w.raw} · 부품 ${w.parts} · 전용 ${legacy ? '지게차' : 'AGV'} ${(() => { const v = s.vehicles.find((x) => x.zone === Z.key); return v ? (v.task ? v.task.replace(/\s*\(.*\)$/, '') : '대기') : '-'; })()}${this.starved ? ' · ⛔ 자재 대기' : ''}` : '-'],
    ];
    rows.forEach(([k, v], i) => {
      const y = 262 + i * 34;
      c.font = `800 26px ${F}`; c.fillStyle = acc; c.fillText(k, 36, y);
      c.font = `600 26px ${F}`; c.fillStyle = '#c9d2dc'; let t = v; while (c.measureText(t).width > W - 260 && t.length > 4) t = t.slice(0, -1); c.fillText(t, 220, y);
    });
    B.tex.needsUpdate = true;
  }

  // Facilities are constructed before async GLB loading. Rebuild only their visual
  // subtree when assets arrive or the renderer changes; retain cell/robot/IoT identities.
  refreshEquipment() {
    const ready = blenderOn();
    for (const c of this.order) if (c.equipmentBlender !== ready) {
      c.equipmentRoot.clear();
      c.parts = BUILD[c.def.type](c.equipmentRoot, c.def);
      c.equipmentBlender = ready;
    }
  }

  // 새 실행(단계·라인 변경)마다 처음부터
  reset(modeKey = 'smart', seed = 1) {
    this.mode = modeKey; this.rng = mulberry(seed + (this.Z.key === 'flex' ? 11 : 23));
    this.time = 0; this.seq = 0; this.mixAcc = {}; this.starved = false;
    if (this.board2) { this.board2.g.visible = this.srv.visible = this.pkG.visible = modeKey !== 'traditional'; }
    for (const c of this.order) c.iot.visible = modeKey !== 'traditional';   // 레거시: IoT 노드·데이터 수집 없음 (정밀조립Zone과 같음)
    for (const p of this.packets ?? []) { p.alive = false; p.m.visible = false; }
    this.buildSrcStock();
    this.stats = { good: {}, ng: 0, rework: 0, released: 0 };
    for (const c of this.order) Object.assign(c, { occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0 });
    this.src.occ = null; this.sink.occ = null; this.packJob = null; this.sinkFull = false; this.fgLocal = {}; this.packArms();
    this.dyn.clear();
    const legacy = modeKey === 'traditional';
    // 처음: 투입 대기열 칸만큼 대기열에, 나머지는 스테이션 대기 줄에
    this.carriers = Array.from({ length: this.Z.amr.count }, (_, i) => {
      const inQ = !this.st, q = inQ ? this.qSlots[Math.min(i, this.qSlots.length - 1)] : this.st.slots[i];   // 처음: 모두 자기 대기 자리에서 (스테이션이 없으면 투입 대기열)
      const g = legacy ? makeCart() : makeCarrierAMR(); this.dyn.add(g);
      if (!legacy) g.traverse((o) => { o.userData.moverId = `${this.Z.code}-AMR${String(i + 1).padStart(2, '0')}`; });
      return { id: `${this.Z.code}-AMR${String(i + 1).padStart(2, '0')}`, uid: zoneAmrUid(this.Z, i), i, cart: legacy, x: q.x, z: q.z, heading: this.st?.face ?? 0, state: inQ ? 'queue' : 'park', qAt: i, parkAt: i, wait: 0, path: null, s: 0, item: null, at: null, g, pm: null, timer: 0,
        slot: i, battery: 100 - ((i * 7) % 28), dist: 0, moving: false, chgNow: true, outOfService: false, task: null };
    });
    this.buildCrew(modeKey);
  }

  // 단계별 셀 인력: 레거시 = 작업자, 자동화·피지컬AI = 로봇 (피지컬AI는 AMMR·휴머노이드)
  buildCrew(modeKey) {
    const legacy = modeKey === 'traditional', dark = modeKey === 'dark';
    for (const c of this.order) {
      c.robotsG.clear(); c.workersG.clear(); c.robots = []; c.robotUids = []; c.plates = [];
      const R = c.def.robot, kind = dark && R[2] ? R[2] : R[0], count = dark && R[2] ? R[3] : R[1];
      c.cycle = c.def.cycle * (MODE_MUL[modeKey] ?? 1) * (c.def.cycleK ?? 1);   // cycleK: 공정 설계에서 바꾼 로봇 대수 효과 (js/zonerecipe.js · 기본 구성 = 1)
      if (c.parts.manualProps) c.parts.manualProps.forEach((p) => (p.visible = legacy));
      if (c.parts.auto) c.parts.auto.visible = !legacy;
      if (c.parts.manual) c.parts.manual.visible = legacy;
      if (legacy) {
        const n = Math.max(1, Math.min(2, count || 1));
        for (let i = 0; i < n; i++) { const w = makeWorker(); put(w, -0.6 + i * 1.2, 0, i ? 1.9 : -1.9, c.workersG); w.rotation.y = i ? PI : 0; }
        c.rb.textContent = `👷 작업자×${n}`;
        continue;
      }
      if (!count || kind === 'none') { c.rb.textContent = c.def.type === 'vision' ? '📷 비전·치수 게이지' : ''; continue; }
      const tend = c.def.type === 'mill5' || c.def.type === 'turn';
      const slots = tend ? [[TEND.robot.x, TEND.robot.z, PI]] : [[-0.75, -1.75, 0], [-0.75, 1.75, PI], [0.95, -1.75, 0], [0.95, 1.75, PI]];
      if (c.def.type === 'deburr') slots.forEach((s) => (s[0] = -1.3));
      for (let i = 0; i < count; i++) {
        const r = makeRobot(kind, MAT.orange);
        const [x, z, yaw] = slots[i];
        // 접촉 작업 셀의 협동로봇(UR20 도달 1.75m)은 셀 중심에서 1.25m — 툴을 세워 대상물 윗면에 손끝이 닿도록
        put(r.root, x, kind === 'ammr' ? 0.06 : kind === 'cobot' ? .5 : 0.15, kind === 'ammr' ? Math.sign(z) * AMMR.slotZ : kind === 'cobot' && CELL_WORK[c.def.type] ? Math.sign(z) * 1.25 : z, c.robotsG); r.root.rotation.y = yaw;
        if (kind === 'ammr') r.slot = { x, z: Math.sign(z) * AMMR.slotZ };   // 접촉 작업 기본 자리 (ammrContact)
        // 피지컬AI: 6축·협동로봇 손목 카메라 (정밀조립 VLA 셀 로봇과 같은 자리·모양 — factory.js placeRobots) · AMMR·휴머노이드는 모델에 카메라 4대(r.cams)
        if (dark && !r.wristCameraAnchor && (kind === 'articulated' || kind === 'cobot')) {
          const cam = put(box(0.07, 0.05, 0.06, MAT.dark), 0.07, 0.02, 0, r.tip.parent);
          put(cyl(0.018, 0.018, 0.02, emis(0x37e8ff, 1.5), 10), 0, 0.035, 0, cam); r.wristCam = true;
        }
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });   // 클릭 → 셀 로봇 텔레메트리 (factory.js pick · DataHub 자산 id와 같은 셀 키)
        r.phase = i * 1.3; c.robots.push(r); c.robotUids.push(zoneRobotUid(this.Z, c.id, i));   // 셀 로봇 고유 ID (zonedefs.js)
        // 머신텐딩: 문이 열렸을 때만 AMR 지그 ↔ 테이블(척)로 넣고 빼며, 가공 중(문 닫힘)에는 문 밖에서 기다린다 — 정지·고장 중에는 그 자세 그대로
        if (tend && r.arm && c.parts.machine?.fixture) {
          r.root.updateWorldMatrix(true, true);
          const f = c.parts.machine.fixture.getWorldPosition(new THREE.Vector3());
          const target = r.root.worldToLocal(f.clone()).toArray();
          // 머시닝센터: 작업물 중심보다 0.12m 앞(로봇 쪽)을 잡는다 — 중심을 잡으면 손목·아래팔이 스핀들 헤드 바로 밑으로 들어가 닿는다
          // 선반: 척에 세운 원판(반지름 0.215m)의 윗가장자리를 위에서 잡는다 — 원판 중심 높이를 잡으면 그리퍼·손목이 원판을 뚫는다
          if (c.def.type === 'turn') target[1] += 0.21; else target[2] -= 0.12;
          r.machineTargets = { ...TEND_PTS, table: target, entry: [target[0], target[1] + .12, Math.max(.5, target[2] - .48)] };
        }
        if (tend && r.arm) r.anim = (busy, t, p) => { const M = c.parts.machine, dk = Math.min(M?.doorK ?? c.doorK ?? 1, M?.headHome ?? 1); if (busy) tendPose(r, p, dk); else if (c.state !== 'BUSY') tendPose(r, 0, dk); };   // 문이 열리고 스핀들 헤드가 맨 위(원점)로 올라간 뒤에 들어간다
        const sp = idPlate(c.robotUids[i]); sp.position.set(0, kind === 'ammr' ? 2.55 : 2.35, 0); r.root.add(sp); sp.visible = this.labelsOn ?? true; c.plates.push(sp);   // 로봇 위 ID 명판 (정밀조립 셀 로봇과 같은 모양 · 라벨 버튼으로 켜고 끔)
      }
      c.rb.textContent = `🤖 ${ROBOT_SHORT[kind] ?? kind}×${count}`;
    }
  }

  // 자재 투입존 보관 재고 (제품별 양쪽): Blender 모델이 늦게 들어오므로 실행마다 다시 채운다 · 칸 위치는 안쪽(지그 쪽)·아래 단부터
  buildSrcStock() {
    const n = this.src; if (!n?.stockG) return;
    n.stockG.clear(); n.heldG.clear(); n.side = {};
    Object.keys(this.Z.products).forEach((k, i) => {
      const z0 = i ? -2.15 : 2.15, sg = Math.sign(z0), panel = k === 'hood' || k === 'door', D = PRODUCT_DIM[k][1], slots = [];
      if (panel) { for (let j = 0; j < 10; j++) for (const cx of [-0.95, 0.95]) slots.push({ x: cx, y: 0.14 + D / 2, z: z0 - sg * 0.65 + sg * j * 0.145 }); }
      else for (let L = 0; L < 2; L++) for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) slots.push({ x: -1.2 + c * 0.8, y: 0.12 + L * 0.32, z: z0 - sg * 0.5 + sg * r * 0.5 });
      const place = (m, p) => { if (panel) m.rotation.x = -PI / 2; m.position.set(p.x, p.y, p.z); return m; };
      const objs = slots.slice(0, SRC_SIDE).map((p) => { const m = place(makeProduct(k), p); n.stockG.add(m); return m; });
      const held = makeProduct(k); if (panel) held.rotation.x = -PI / 2; held.position.y = -1.85 - (panel ? 0 : 0.1); held.visible = false; n.heldG.add(held);
      n.side[k] = { objs, slots: slots.slice(0, SRC_SIDE), held, h: panel ? D : 0.25, panel };
    });
    n.shown = null;
  }
  // 다음 투입 제품 (평준화 누적값을 바꾸지 않고 미리 봄) — 갠트리가 그 제품 쪽 보관 구역에서 집는다
  peekNext() {
    const w = this.mix, keys = Object.keys(w).filter((k) => w[k] > 0), tot = keys.reduce((a, k) => a + w[k], 0) || 1;
    return keys.reduce((a, b) => ((this.mixAcc[b] ?? 0) + w[b] / tot > (this.mixAcc[a] ?? 0) + w[a] / tot ? b : a), keys[0]);
  }
  // 자재 투입존 화면: 투입구 원재료(sim.zoneRaw)를 혼류 비율로 양쪽에 나눠 보이고, 적재(load) 중이면 갠트리가 다음 제품 쪽 맨 위 칸에서 집어 가운데 지그로
  animSrc() {
    const n = this.src, P = n?.port, s = this.sim; if (!n?.side || !P) return;
    const keys = Object.keys(this.Z.products), w = this.mix, tot = keys.reduce((a, k) => a + (w[k] || 0), 0) || 1;
    const buf = s?.zoneRaw?.[this.Z.key] ?? SRC_SIDE * 2;
    const cnt = {}; cnt[keys[0]] = Math.min(SRC_SIDE, Math.round(buf * (w[keys[0]] || 0) / tot)); cnt[keys[1]] = Math.min(SRC_SIDE, buf - cnt[keys[0]]);
    const c = n.occ && n.occ.state === 'load' ? n.occ : null, k = c ? Math.min(1, Math.max(0, 1 - c.timer / this.Z.load)) : 0;
    let next = this.peekNext(); if (!cnt[next]) next = keys.find((x) => cnt[x] > 0) ?? next;
    const S = n.side[next], picked = c && k >= 0.36 ? 1 : 0;
    for (const key of keys) { const v = Math.max(0, cnt[key] - (key === next ? picked : 0)); n.side[key].objs.forEach((o, i) => (o.visible = i < v)); }
    const top = S.slots[Math.max(0, cnt[next] - 1)], pick = { x: top.x, z: top.z, y: top.y + S.h / 2 }, place = { x: 0, z: 0, y: BELT_Y + 0.05 + S.h / 2 }, UP = 2.45;
    // 판재(후드 1.6m)는 세워 든 채 대차(1.3m)에 내려놓으면 한쪽 끝이 대차 손잡이 가로대(높이 1.15m)를 지난다 — 손잡이 반대쪽으로 0.12m 비켜 내려놓는다
    if (c?.cart && S.panel) { const hd = P.bridge.parent.worldToLocal(c.g.localToWorld(new THREE.Vector3(0, 1.15, -0.72))); place.x -= Math.sign(hd.x - place.x) * 0.12; }
    const K = [[0, 0, 0, 0], [0.18, 1, 0, 0], [0.3, 1, 1, 0], [0.36, 1, 1, 1], [0.48, 1, 0, 1], [0.7, 0, 0, 1], [0.84, 0, 1, 1], [1, 0, 1, 1]];
    let a = K[0], b = K[0]; for (let i = 1; i < K.length; i++) if (k <= K[i][0]) { a = K[i - 1]; b = K[i]; break; }
    const f = b[0] > a[0] ? (k - a[0]) / (b[0] - a[0]) : 0, pos = c ? a[1] + (b[1] - a[1]) * f : 0, low = c ? a[2] + (b[2] - a[2]) * f : 0, held = c ? (f < 1 ? a[3] : b[3]) : 0;
    P.bridge.position.x = place.x + (pick.x - place.x) * pos; P.car.position.z = place.z + (pick.z - place.z) * pos;
    const yLow = pos > 0.5 ? pick.y : place.y; P.lift.position.y = (UP + (yLow - UP) * low) - 1.15;
    for (const key of keys) n.side[key].held.visible = !!held && key === next;
  }

  // 셀 키 (DataHub 자산 id · 텔레메트리 ref.stationId): A_1_C03
  sid(c) { return `${this.Z.uidp}_${c.id}`; }
  // 텔레메트리용 셀 보기 (정밀조립 셀 객체와 같은 이름의 값 — telemetry.js resolve)
  teleCell(c) {
    const zone = this, zc = () => zone.sim?.zoneCell(zone.Z.key, c.id);
    return c.tele ??= {
      id: this.sid(c), name: `${this.Z.code} ${c.def.label}`, type: c.def.type, zone: this.Z.key, x: this.Z.origin.x + c.def.x, z: this.Z.origin.z + c.def.z,
      get state() { return c.fault ?? c.state; }, get progress() { return c.progress; }, get health() { return zc()?.health ?? 100; },
      get item() { return c.item; }, get robotUids() { return c.robotUids; }, use: c.def.use,
    };
  }
  // 팔레타이징 로봇 텔레메트리 (factory.js pick → ExtraZones.cellRobot · 정밀조립 구분 적재장 로봇과 같은 항목)
  packRobot(idx) {
    const P = Object.values(this.pack ?? {})[idx]; if (!P) return null;
    const zone = this, job = () => zone.packJob;
    const robot = P.robot ??= { root: P.arm.root, kind: 'articulated', tip: P.arm.tip, jointDefs: ARM_JOINTS, joints: P.arm.joints, payload: P.arm.payload ?? 60, spec: P.arm.spec, wristCam: true, wristCameraAnchor: P.arm.cameraAnchor, arm: P.arm, scale: 1.2, anim() {} };
    const st = this.telePack ??= { id: `${this.Z.uidp}_PACK`, name: `${this.Z.code} 포장·구분 적재`, type: 'sink', zone: this.Z.key, x: this.Z.origin.x + this.Z.sink.x, z: this.Z.origin.z + this.Z.sink.z,
      get state() { return job() ? 'BUSY' : zone.sinkFull ? 'BLOCKED' : 'IDLE'; }, get progress() { return job()?.u ?? 0; }, health: 100, get item() { return job()?.c.item ?? null; },
      get robotUids() { return Object.values(zone.pack).map((q) => q.uid); }, use: '포장 박스째 집어 제품별 팔레트에 적재 (8개 = 팔레트 1개 → 출하 지게차)' };
    return { robot, st };
  }
  // 텔레메트리용 운반 AMR 보기: 공장 좌표 · 상태 (배터리 없음 — 정차 위치 무선 충전)
  teleCarrier(c) {
    const o = this.Z.origin, zone = this;
    return c.tele ??= {
      id: c.id, uid: c.uid, kind: 'zoneamr', zone: this.Z.key,
      prio: 1e6, idle: false, steps: [], blockedOn: null, hzWait: false,   // 시뮬레이션 이동체 양보 규칙(sim.js yieldTo)용: 정해진 길을 도는 라인 AMR — 우선순위 최고, 서 있으면 정지 장애물로 보고 돌아간다
      get x() { return c.x + o.x; }, get z() { return c.z + o.z; }, get heading() { return c.heading; },
      get moving() { return c.zoneMoving?.() ?? false; }, get state() { return c.state; },
      get task() { return { queue: '투입 대기열', park: 'Zone AMR 스테이션 대기', move: '셀 간 운반', return: '빈 AMR 복귀', toSrc: '투입 위치로 이동', work: '셀 작업 중' }[c.state] ?? c.state; },
      get payload() { const it = c.item; return it ? `${zone.Z.products[it.product]?.label ?? it.product}#${it.id ?? ''}` : 'empty'; },
    };
  }
  // 혼류 비율 변경 — 다음 투입부터 새 비율로 평준화 (진행 중인 작업물·실적은 그대로)
  setMix(w) { this.mix = { ...w }; this.mixAcc = {}; }
  nextProduct() {
    const bp = this.Z.key === 'flex' ? this.sim?.fos?.flex.productFor() : null; if (bp) return bp;   // 유연생산 전환 오더 (공장 → 전환·흐름 오케스트레이터): 품목 배치 순서
    const w = this.mix, keys = Object.keys(w).filter((k) => w[k] > 0), tot = keys.reduce((a, k) => a + w[k], 0);
    for (const k of keys) this.mixAcc[k] = (this.mixAcc[k] ?? 0) + w[k] / tot;
    const k = keys.reduce((a, b) => (this.mixAcc[b] > this.mixAcc[a] ? b : a)); this.mixAcc[k] -= 1; return k;
  }
  node(id) { return id === 'SRC' ? this.src : id === 'SINK' ? this.sink : this.cells[id]; }
  nextOf(item, fromId) {
    if (item.ngNext && fromId === this.Z.ng?.at) return this.Z.ng.to;
    if (fromId === this.Z.ng?.to) return 'SINK';
    const r = this.Z.routes[item.product], i = r.indexOf(fromId);
    return i < 0 ? r[0] : r[i + 1] ?? 'SINK';
  }
  go(c, path, state, target) { c.path = path; c.s = 0; c.L = pathLength(path); c.state = state; c.target = target; }

  // ── 흐름 시뮬레이션 (dt: 시뮬레이션 초) ─────────────────
  step(dt, halted) {
    if (halted) { for (const c of this.order) if (c.state === 'BUSY') c.halt = true; return; }
    this.time += dt;
    const Z = this.Z;
    // 셀 작업
    for (const c of this.order) {
      c.halt = false;
      // 셀 고장·정비 (sim.js 확장 Zone 셀): 수리 끝날 때까지 작업이 멈춘다 · 가동 여부를 알려 마모 계산에 쓴다
      const zc = this.sim?.zoneCell(Z.key, c.id); c.fault = zc && (zc.state === 'DOWN' || zc.state === 'MAINT') ? zc.state : null;
      if (zc) zc.busy = c.state === 'BUSY';
      if (c.fault) continue;
      if (c.state !== 'BUSY') continue;
      // 셀 OCS HOLD: 품목 전환(유연생산 CHANGEOVER) · 공구 교환(적응가공) 동안은 작업이 진행되지 않는다
      if (c.holdT > 0) { c.holdT -= dt; c.busy += dt; if (c.holdT <= 0) c.hold = null; continue; }
      c.busy += dt; c.progress = Math.min(1, c.progress + dt / c.cur);
      if (c.progress >= 1) {
        const it = c.item; it.done.add(c.id); c.done++;
        if (Z.ng && c.id === Z.ng.at && !it.ng && this.rng() < Z.ng.rate) { it.ng = true; it.ngNext = true; this.stats.ng++; }
        else it.ngNext = false;
        const O = this.sim?.fos?.[Z.key];
        if (O && Z.key === 'flex' && c.id === Z.ng?.at) O.onFirstArticle(it, !it.ngNext);   // 첫물 판정 (치수·외관검사)
        if (O && Z.key === 'adapt') { O.afterCell(c, it, this.rng); if (c.id === Z.rework?.at) O.onBranch(it.rework || it.toolBreak ? 'rework' : this.rng() < 0.02 ? 'hold' : 'ok'); }   // 공구 감시·조건 조정 · CMM 제품 분기
        c.state = 'BLOCKED';   // 다음 셀이 비기를 기다림 (비면 곧바로 출발)
      }
    }
    if (Z.key === 'adapt') this.sim?.fos?.adapt.tick(dt);   // 공구 교환 진행
    this.dispatchParked();
    for (const c of this.carriers) this.stepCarrier(c, dt);
  }
  // 자기 자리로 돌아가는 길 · 자리에서 투입 대기열로 나가는 길 (Zone 로컬)
  returnPath(c) { const S = this.st, p = S.slots[c.slot]; return [{ x: this.Z.sink.x, z: this.Z.sink.z }, ...S.keep, ...S.ret, { x: p.x, z: S.retZ }, { x: p.x, z: p.z }]; }
  outPath(c) { const S = this.st, p = S.slots[c.slot]; return [{ x: p.x, z: p.z }, { x: p.x, z: S.outZ }, ...S.out, { x: this.Z.src.x, z: this.Z.src.z }]; }
  // 스테이션 → 투입 대기열 (정밀조립Zone 선행 배차와 같은 방식): 대기열(가는 중 포함)이 STATION_LEAD보다 적으면
  // 출구에 가까운 자리(번호가 작은 자리)의 AMR부터 내보낸다 — 운행 제외 · 배터리 저전압 기준 +10% 미만인 AMR은 자기 자리에서 충전하며 기다린다
  dispatchParked() {
    if (!this.st) return;
    const ok = (c) => !c.outOfService && c.battery >= BATTERY.carrier.low + 10;
    const toQ = this.carriers.filter((c) => c.state === 'queue' || c.state === 'toQ').length;
    if (toQ >= this.qSlots.length) return;
    const c = this.carriers.filter((k) => k.state === 'park' && ok(k)).sort((a, b) => a.slot - b.slot)[0];
    if (c) this.go(c, this.outPath(c), 'toQ', 'Q');
  }
  // AMR 관제(fleet.js zflex·zadapt): 속도 배율 · 관제 정지 · 운행 제외 / 배터리: 주행 중 소모 · 정차 위치마다 무선 충전 (정밀조립Zone 운반 AMR과 같은 값)
  stepCarrier(c, dt) {
    const fz = this.fz, x0 = c.x, z0 = c.z, B = BATTERY.carrier;
    if (!(fz?.paused && ['move', 'toSrc', 'return', 'toQ', 'park', 'queue'].includes(c.state))) this.stepCarrierFlow(c, dt);
    const d = Math.hypot(c.x - x0, c.z - z0); c.dist = (c.dist ?? 0) + d; c.moving = d > 1e-6; c.chgNow = !c.moving;
    c.battery = Math.max(0, Math.min(100, (c.battery ?? 100) + (c.moving ? -B.move * Math.pow(fz?.scale ?? 1, 1.5) : B.rate) * dt));
    c.task = { park: `스테이션 ${c.slot + 1}번 자리 대기·충전`, toQ: '투입 대기열로 출동', queue: '투입 대기', toSrc: '투입 진입', load: '적재', ready: '출발 대기', move: `운반 → ${c.target}`, work: `셀 정차 · ${c.at}`, unload: '하역', return: '빈 차 복귀' }[c.state] ?? c.state;
  }
  stepCarrierFlow(c, dt) {
    const Z = this.Z, sc = this.fz?.scale ?? 1;
    switch (c.state) {
      case 'park': break;   // 자기 대기 자리 (무선 충전) — 출동은 dispatchParked
      case 'queue': {   // 투입 대기열 — 앞자리가 비면 한 칸씩 당기고, 맨 앞이면서 투입 위치가 비면 들어간다
        const k = this.carriers.filter((o) => o.state === 'queue' && o.qAt < c.qAt).length;
        const q = this.qSlots[Math.min(k, this.qSlots.length - 1)];
        if (k === 0 && !this.src.occ) { this.src.occ = c; this.go(c, [{ x: c.x, z: c.z }, { x: Z.src.x, z: Z.src.z }], 'toSrc', 'SRC'); break; }
        this.moveToward(c, q, Z.amr.ret * sc, dt);
        break;
      }
      case 'load':
        c.timer -= dt;
        if (c.timer <= 0) {
          // 물류존 확장 선반에서 원재료 1개 · 부품 키트 1개를 꺼낸다 — 모자라면 입고될 때까지 투입 대기 (sim.js takeZoneStock)
          if (this.sim && !this.sim.takeZoneStock(Z.key)) { this.starved = true; break; }
          this.starved = false;
          const p = this.nextProduct();
          c.item = { id: `${Z.code}-${String(++this.seq).padStart(4, '0')}`, product: p, done: new Set(), ng: false, t0: this.time };
          this.stats.released++; this.attachItem(c);
          c.at = 'SRC'; c.state = 'ready';
        }
        break;
      case 'ready': {   // 지금 노드 작업 끝 — 다음 노드가 비면 출발
        const nextId = this.nextOf(c.item, c.at), nx = this.node(nextId);
        if (nx.occ) break;
        nx.occ = c; const cur = this.node(c.at); cur.occ = null;
        if (cur.state === 'BLOCKED') { cur.state = 'IDLE'; cur.item = null; cur.progress = 0; }
        const a = cur.def, b = nx.def;
        this.go(c, cellPath(Z, c.at, nextId, { x: a.x, z: a.z }, { x: b.x, z: b.z }), 'move', nextId);
        break;
      }
      case 'move': case 'toSrc': case 'return': case 'toQ': {
        const sp = (c.state === 'move' ? Z.amr.speed : Z.amr.ret) * sc;
        // 앞차 간격: 같은 방향으로 1.8m 안에 다른 이동 AMR이 있으면 잠시 선다 (교차 통로에서 겹치지 않게)
        // 서로 마주 보며 막히면 번호가 빠른 쪽이 먼저 가고, 3초 넘게 막히면 그대로 지나간다 (교착 방지)
        const blocked = this.carriers.some((o) => o !== c && (o.state === 'move' || o.state === 'return' || o.state === 'toQ') && Math.hypot(o.x - c.x, o.z - c.z) < 1.8 && this.ahead(c, o) && !(this.ahead(o, c) && c.i < o.i));
        if (blocked && c.wait < 3) { c.wait += dt; break; }
        c.wait = 0;
        // 시뮬레이션 이동체(정비 인력·사족보행·물류 휴머노이드·AGV)가 앞길에 있으면 선다 — 그쪽이 Zone AMR을 보고 비켜 가므로 기다린다 (25초 넘으면 교착 방지로 출발)
        const ext = this.extAhead(c);
        if (ext) { c.extWait = (c.extWait ?? 0) + dt; if (c.extWait < 25) { c.extBlock = ext; break; } } else c.extWait = 0;
        c.extBlock = null;
        c.s = Math.min(c.L, c.s + sp * dt);
        const p = pointAt(c.path, c.s); this.face(c, p); c.x = p.x; c.z = p.z;
        if (c.state === 'return' && this.st) {   // 자기 자리 도착 → 출동 차로 쪽을 보고 대기
          if (c.s >= c.L - 1e-6) { c.state = 'park'; c.heading = this.st.face; }
          break;
        }
        if (c.state === 'toQ' || c.state === 'return') {   // 투입 대기열 끝자리 근처에 오면 대기열로 (스테이션이 없으면 복귀 = 대기열로)
          const k = this.carriers.filter((o) => o.state === 'queue').length, q = this.qSlots[Math.min(k, this.qSlots.length - 1)];
          if (Math.hypot(q.x - c.x, q.z - c.z) < 0.6 || c.s >= c.L - 0.01) { c.state = 'queue'; c.qAt = this.time + 100 + c.i * 1e-6; }
          break;
        }
        if (c.s < c.L - 1e-6) break;
        this.square(c);   // 셀·투입구·적재장 도착 → 셀 축(동서)에 반듯하게 선다 (대각 진입 방향 그대로 서지 않게)
        if (c.target === 'SRC') { c.state = 'load'; c.timer = Z.load; break; }
        if (c.target === 'SINK') { c.state = 'unload'; c.timer = Z.unload; c.at = 'SINK'; break; }
        const cell = this.cells[c.target]; c.at = c.target;
        const rw = Z.rework && cell.id === Z.rework.at && this.rng() < Z.rework.rate;
        if (rw) { c.item.rework = true; this.stats.rework++; }
        Object.assign(cell, { state: 'BUSY', progress: 0, item: c.item, cur: cell.cycle * (rw ? 1.6 : 1) * (0.92 + this.rng() * 0.16) });
        // Zone 오케스트레이터 (factoryos.js): 유연생산 = 새 품목 지그면 CHANGEOVER (전환 오더 중) · 적응가공 = 공구 교환 중이면 대기 · 절삭 조건 조정 사이클 배율
        const O = this.sim?.fos?.[Z.key];
        if (O && Z.key === 'flex') { const co = O.onCellStart(cell, c.item); if (co > 0) { cell.holdT = co; cell.hold = '품목 전환 (CHANGEOVER)'; } }
        if (O && Z.key === 'adapt') { const b = O.beforeCell(cell); cell.cur *= b.mul; if (b.hold > 0) { cell.holdT = b.hold; cell.hold = '공구 교환'; } }
        c.state = 'work';
        break;
      }
      case 'work': if (this.cells[c.at].state === 'BLOCKED') c.state = 'ready'; break;
      case 'unload':
        if (Z.pack) {   // 포장·구분 적재: 팔레트에 자리가 있으면 그 제품 로봇이 집어 쌓는다 (가득 차면 출하 지게차가 실어 갈 때까지 AMR이 기다린다)
          const p = c.item.product;
          if (!c.packing) { if (this.fgOf(p) >= ZONE_FG_CAP) { this.sinkFull = true; break; } this.sinkFull = false; c.packing = true; c.packT = c.timer = Z.unload + 1; this.packJob = { product: p, c, u: 0 }; }
          c.timer -= dt; this.packJob.u = 1 - Math.max(0, c.timer) / c.packT;
          if (c.timer > 0) break;
          c.packing = false; this.packJob = null;
          if (this.sim?.zoneFg) this.sim.zoneFg[p] = (this.sim.zoneFg[p] ?? 0) + 1; else (this.fgLocal ??= {})[p] = (this.fgLocal[p] ?? 0) + 1;
          this.sim?.fac?.produced(p);   // FAC: 생산 입고 (확장 Zone 완제품 → 출하 대기)
          this.stats.good[p] = (this.stats.good[p] ?? 0) + 1;
          this.detachItem(c); c.item = null; this.sink.occ = null;
          this.go(c, this.st ? this.returnPath(c) : this.retPath, 'return', this.st ? 'PARK' : 'Q');
          break;
        }
        c.timer -= dt;
        if (c.timer <= 0) {
          const p = c.item.product; this.stats.good[p] = (this.stats.good[p] ?? 0) + 1;
          this.detachItem(c); c.item = null; this.sink.occ = null;
          this.go(c, this.st ? this.returnPath(c) : this.retPath, 'return', this.st ? 'PARK' : 'Q');
        }
        break;
    }
  }
  // 앞길(진행 방향 반지름 합 + 0.5m · 차체 폭 합의 반 + 0.1m) 안의 시뮬레이션 이동체 — sim.js sense와 같은 판정
  extAhead(c) {
    const ms = this.sim?.movers; if (!ms) return null;
    const o = this.Z.origin, x = c.x + o.x, z = c.z + o.z, hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    for (const m of ms) {
      if (m.state === 'line') continue;
      const rx = m.x - x, rz = m.z - z, along = rx * hx + rz * hz, lat = Math.abs(rx * hz - rz * hx);
      if (along > 0.15 && along < 0.8 + moverRadius(m) + 0.5 && lat < (0.95 + moverWidth(m)) / 2 + 0.1) return m;
    }
    return null;
  }
  ahead(c, o) {   // o가 c의 진행 방향 앞쪽에 있는가
    const hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    return (o.x - c.x) * hx + (o.z - c.z) * hz > 0.3;
  }
  square(c) { c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2; }   // 가까운 쪽 동/서 방향으로 (셀 지그·투입구·적재장이 모두 동서 축)
  face(c, p) { const dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz > 1e-8) c.heading = Math.atan2(dx, dz); }
  moveToward(c, q, sp, dt) {
    const dx = q.x - c.x, dz = q.z - c.z, d = Math.hypot(dx, dz); if (d < 1e-3) return;
    const k = Math.min(1, (sp * dt) / d); this.face(c, q); c.x += dx * k; c.z += dz * k;
  }
  attachItem(c) {
    const m = makeProduct(c.item.product);
    const flex = c.item.product === 'hood' || c.item.product === 'door';
    m.position.set(0, BELT_Y + (flex ? 0.02 : 0.01), 0); if (flex) m.rotation.y = PI / 2;   // 긴 쪽을 AMR 길이 방향(로컬 z)으로
    c.g.add(m); c.pm = m;
  }
  detachItem(c) { if (c.pm) { c.g.remove(c.pm); c.pm = null; } }

  // ── 화면 동기화 (rdt: 실제 초, t: 화면 시간) ─────────────────
  sync(rdt, t, dts) {
    this.animPack();
    this.animSrc();
    if (this.board2?.g.visible) {   // 전광판 0.5초마다 · 서버 상태등 깜빡임
      this.board2.t -= rdt; if (this.board2.t <= 0) { this.board2.t = 0.5; this.drawWall(); }
      this.srvLeds.forEach((m, i) => (m.emissiveIntensity = Math.sin(t * 6 + i * 1.7) > 0.2 ? 2 : 0.4));
    }
    for (const c of this.carriers) {
      c.g.position.set(c.x, 0, c.z);
      let d = c.heading - c.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); c.g.rotation.y += d * Math.min(1, rdt * 8);
      if (c.pm && c.item) styleProduct(c.pm, c.item);
    }
    for (const c of this.order) this.animCell(c, t, rdt, dts);
    // IoT 데이터 패킷 (자동화·피지컬AI): 셀 IoT 노드 → Zone 데이터 서버, 고장은 빨강 · 정비는 주황 (정밀조립 factory.js와 같은 빈도·궤적)
    if (this.pkG?.visible) {
      for (const c of this.order) {
        const k = (t * 0.8 + c.phase) % 1; c.pulse.scale.setScalar(1 + k * 3); c.ringM.opacity = 0.6 * (1 - k);
        c.sensorMat.emissive.setHex(c.fault === 'DOWN' ? 0xff3030 : c.fault === 'MAINT' ? 0xffb020 : 0x37e8ff);
        if (Math.random() < rdt * 1.6) this.spawnPacket(c);
      }
      this.updatePackets(rdt);
    }
  }
  spawnPacket(cell) {
    let p = this.packets.find((q) => !q.alive);
    if (!p) {
      if (this.packets.length > 40) return;
      p = { m: put(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7ff3ff, toneMapped: false })), 0, 0, 0, this.pkG), alive: false };
      this.packets.push(p);
    }
    p.alive = true; p.t = 0; p.m.visible = true;
    p.a = cell.sensor.getWorldPosition(new THREE.Vector3()); p.b = this.serverPos.clone();
    p.c = p.a.clone().lerp(p.b, 0.5); p.c.y = 9;
    p.m.material.color.setHex(cell.fault === 'DOWN' ? 0xff5050 : 0x7ff3ff);
  }
  updatePackets(rdt) {
    for (const p of this.packets) {
      if (!p.alive) continue;
      p.t += rdt * 0.7;
      if (p.t >= 1) { p.alive = false; p.m.visible = false; continue; }
      const k = p.t, j = 1 - k, { a, b, c } = p;
      p.m.position.set(j * j * a.x + 2 * j * k * c.x + k * k * b.x, j * j * a.y + 2 * j * k * c.y + k * k * b.y, j * j * a.z + 2 * j * k * c.z + k * k * b.z);
    }
  }
  animCell(c, t, rdt, dts) {
    const P = c.parts, busy = c.state === 'BUSY' && !c.halt && !c.fault, p = c.progress, st = c.halt ? 'ESTOP' : c.fault ?? c.state;
    c.light.userData.set(st, t);
    // 양팔 로봇(AMMR): 대상물(셀에 선 AMR 위 제품)에 다가가 상체를 숙이고 두 손을 댄다 — 첫 대는 작업, 둘째 대는 고정 · 진행 0.88부터 물러나 AMR이 나가기 전 제자리
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const car = busy && c.robots.some((r) => r.body) ? this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm) : null;
    // 6축·협동로봇(머신텐딩 제외): 셀에 선 AMR 위 대상물 윗면의 자기 점 2~4곳에 손끝을 대고 작업 — 셀 설비가 대상물 위에서 움직이는 구간(헤밍 램 · CMM 탐침 · 디버링 드릴·세척)은 비켜 그 앞뒤에서
    const W = CELL_WORK[c.def.type], wcar = W && busy ? this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm) : null;
    c.robots.forEach((r, i) => {
      if (W && r.arm?.native && !r.machineTargets && !r.body) {
        const seed = Math.abs(Number(String(c.item?.id ?? '').replace(/\D/g, '')) || 0);
        for (const o of c.robots) o.slot ??= { x: o.root.position.x, z: o.root.position.z };
        const n = 2 + (seed * 7 + i * 2) % 3, u = wcar ? (p - W.from) / (W.to - W.from) : 0;
        // 마주 보는 로봇(통로 반대편에 같은 x 대)이 있으면 반 점씩 엇갈려 — 한쪽이 점에 내려가 있을 때 다른 쪽은 위로 옮겨 간다
        const facing = c.robots.some((o) => o !== r && o.slot && Math.sign(o.slot.z) === -Math.sign(r.slot.z) && Math.abs(o.slot.x - r.slot.x) < 0.5), d = facing ? 0.5 / 4 : 0;
        const uu = !facing ? u : r.slot.z < 0 ? u / (1 - d) : (u - d) / (1 - d);
        pointWork(r, { key: `${c.item?.id}:${i}`, box: () => wcar && contactBox(wcar.pm, r.root.parent), obj: wcar?.pm, n, kind: W.kind, u: uu, robots: c.robots });
        return;
      }
      const ap = car && r.slot ? sm(0.03, 0.1, p) * (1 - sm(0.88, 0.95, p)) : 0, box = ap > 0 ? contactBox(car.pm, r.root.parent) : null;
      if (box && ammrContact(r, { slot: r.slot, box, ap, hold: i > 0, t: t + r.phase, fixX: c.def.type === 'cmm' })) return;   // CMM: 문형 다리(z ±1.2) 사이로 옆으로 비키지 않고 곧게 다가간다
      if (r.slot && r.contactKey) { r.root.position.x = r.slot.x; r.root.position.z = r.slot.z; r.body?.pose(); }
      r.anim(busy, t + r.phase, p);
    });
    const ty = c.def.type, it = c.item, legacy = this.mode === 'traditional';
    if (P.gateSign) {
      const entering = busy && p < 0.18;
      P.scan.visible = entering; if (entering) P.scan.position.x = P.gateX + Math.sin(t * 9) * 0.12;
      const col = it ? (it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : 0xffffff;
      P.ringMat.color.setHex(col); P.ringMat.emissive?.setHex(col); P.ringMat.emissiveIntensity = entering ? 6 : it ? 1.4 : 0.4;
      const text = !it ? '대기 중' : ty === 'cmm' ? `${it.id} · ${this.Z.products[it.product].label} · ${it.rework ? '리워크 후 재측정' : p < 0.9 ? '측정 중' : '합격'}` : `${it.id} → ${this.Z.products[it.product].label} 라인`;
      drawGate(P.gateSign, P.gateTitle, text, it ? hex(it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : '#e6edf3');
    }
    if (P.machine) { P.machine.update({ busy, progress: p, time: t, rdt, dts, frozen: !!c.halt || this.halted, fault: !!c.fault, open: c.robots.some((r) => r.tendInside) || undefined }); return; }   // 팔이 기계 안에 있으면 문을 열어 둔다
    switch (ty) {
      case 'locate': P.scan.visible = busy && p < 0.6; if (P.scan.visible) P.scan.position.x = Math.sin(p * PI * 6) * 0.7; break;
      case 'spot': stepSparks(P.sparks, busy && Math.sin(t * 6) > -0.3, { x: legacy ? -0.3 : 0, y: BELT_Y + 0.45, z: 0 }, rdt, 2.2, -7); break;
      case 'seal': P.lamp.emissiveIntensity = busy ? 1.4 : 0.5; stepSparks(P.mist, busy, { x: Math.sin(t * 2.5) * 0.6, y: BELT_Y + 0.5, z: 0 }, rdt, 0.8, -1.5); break;
      case 'hem': { const k = busy && p > 0.45 && p < 0.85 ? Math.sin(((p - 0.45) / 0.4) * PI) : 0; P.ram.position.y = 2.2 - k * 1.05; break; }
      case 'mount': P.screen.emissive.setHex(busy && Math.sin(t * 10) > 0 ? 0xf5b82e : 0x3ddc84); break;
      case 'vision': { const sc = busy && !legacy; P.scan.visible = sc; if (sc) P.scan.position.x = Math.sin(p * PI * 2) * 0.6; P.ringMat.emissiveIntensity = sc && p > 0.45 && p < 0.55 ? 8 : 0.4; break; }
      case 'rework': stepSparks(P.sparks, busy && Math.sin(t * 5) > 0.2, { x: 0.2, y: 1.0, z: 2.0 }, rdt, 1.2, -6); break;
      case 'mill5': case 'turn': {
        const open = !it || p < 0.15 || p > 0.85 || c.robots.some((r) => r.tendInside) ? 1 : 0;
        c.doorK = (c.doorK ?? 0) + (open - (c.doorK ?? 0)) * Math.min(1, dts * 4); P.door.position.x = c.doorK * 1.25;
        const cut = busy && p > 0.18 && p < 0.82;
        if (ty === 'mill5') {
          if (cut) P.spindle.rotation.y += dts * 50;
          P.head.position.y += ((cut ? 1.85 + Math.sin(t * 3) * 0.05 : 2.05) - P.head.position.y) * Math.min(1, rdt * 5);
          P.head.position.x = TEND.table.x + (cut ? Math.sin(p * PI * 9) * 0.2 : 0.7 * (busy ? 1 : 0));
          P.cradle.rotation.x = cut ? Math.sin(p * PI * 4) * 0.35 : P.cradle.rotation.x * 0.9;
          if (cut) P.table.rotation.y += dts * 0.8;
        } else {
          if (cut) P.chuck.rotation.y += dts * 9;
          P.turret.position.x = TEND.table.x + 0.9 - (cut ? 0.3 + Math.sin(p * PI * 5) * 0.12 : 0);
        }
        stepSparks(P.coolant, cut, { x: TEND.table.x, y: 1.25, z: P.tz }, rdt, 1.1, -4);
        stepSparks(P.chips, cut, { x: TEND.table.x, y: 1.15, z: P.tz }, rdt, 1.6, -8);
        P.screen.emissive.setHex(cut ? 0x58c4ff : 0x3ddc84); P.edgeLed.emissive.setHex(legacy ? 0x333333 : 0x3ddc84);
        break;
      }
      case 'deburr': {
        const drill = busy && p > 0.12 && p < 0.42, wash = busy && p > 0.78;
        P.head.position.y += ((drill ? 1.85 : 2.3) - P.head.position.y) * Math.min(1, rdt * 6);
        if (drill) P.bit.rotation.y += dts * 40;
        stepSparks(P.spray, wash, { x: 1.55, y: 1.6, z: Math.sin(t * 4) * 0.4 }, rdt, 1.4, -6);
        P.curtain.visible = wash; P.screen.emissive.setHex(drill ? 0x58c4ff : wash ? 0x9fe8ff : 0x3ddc84);
        break;
      }
      case 'cmm': {
        const meas = busy && p > 0.3 && p < 0.9;
        P.bridge.position.x = 0.15 + (meas ? Math.sin(p * PI * 6) * 0.35 : 0);
        P.car.position.z = meas ? Math.cos(p * PI * 7) * 0.3 : 0;
        const tq = meas ? -(0.23 + 0.16 * Math.abs(Math.sin(p * PI * 14))) : 0;   // 탐침 끝 y 1.30 → 1.14 (소재 윗면 접촉) 반복
        P.quill.position.y += (tq - P.quill.position.y) * Math.min(1, rdt * 8);
        P.tipMat.emissiveIntensity = meas && Math.sin(p * PI * 14) > 0.9 ? 6 : 1.2;
        const rw = busy && it?.rework && p < 0.6; if (rw) P.rwSpin.rotation.y += dts * 40;
        P.rwLamp.emissiveIntensity = rw ? 3 + Math.sin(t * 12) : 0.3;
        P.screen.emissive.setHex(it?.rework ? 0xf5b82e : 0x3ddc84);
        break;
      }
    }
  }

  // 라벨·현황판 (0.25초마다)
  updateLabels(halted) {
    const lab = { BUSY: '가동', IDLE: '대기', BLOCKED: '출구 대기', ESTOP: '정지', DOWN: '고장 · 정비 출동', MAINT: '정비중' };
    for (const c of this.order) {
      const s = halted ? 'ESTOP' : c.fault ?? c.state;
      c.chip.className = 'chip s-' + s;
      c.chip.textContent = lab[s] + (c.state === 'BUSY' && c.item ? ` · ${this.Z.products[c.item.product].label}${c.item.rework ? ' (리워크)' : c.item.ng && c.id === this.Z.ng?.to ? ' (NG 보수)' : ''}` : '');
    }
    const q = this.carriers.filter((c) => c.state === 'queue' || c.state === 'toSrc').length;
    this.src.chip.className = 'chip s-' + (this.starved ? 'NOSTOCK' : this.src.occ ? 'BUSY' : 'IDLE');
    const raw = this.sim?.zoneRaw?.[this.Z.key];
    this.src.chip.textContent = this.starved ? `자재 대기 · 투입구 원재료 ${raw ?? 0}` : `${this.src.occ ? '적재 중' : '대기'} · ${this.mode === 'traditional' ? '대차' : 'AMR'} 대기 ${q}${raw != null ? ` · 원재료 ${raw}` : ''}`;
    const g = this.stats.good, ps = Object.entries(this.Z.products);
    this.sink.chip.className = 'chip s-' + (this.sink.occ ? 'BUSY' : 'IDLE');
    this.sink.chip.textContent = this.Z.pack ? `${this.sinkFull ? '적재 공간 대기 · ' : ''}${ps.map(([k, v]) => `${v.label} 팔레트 ${this.fgOf(k)}/${ZONE_FG_CAP}`).join(' · ')}` : ps.map(([k, v]) => `${v.label} ${g[k] ?? 0}`).join(' · ');
    if (this.Z.pack && this.sinkFull) this.sink.chip.className = 'chip s-BLOCKED';
    const s = this.summary();
    this.boardEl.innerHTML = `<b>${this.Z.name}</b><span>${ps.map(([k, v]) => `${v.label} <i>${g[k] ?? 0}</i>`).join(' · ')} · UPH <i>${s.uph}</i> · 가동 셀 <i>${s.busy}/${this.order.length}</i>${this.Z.ng ? ` · NG <i>${this.stats.ng}</i>` : ''}${this.Z.rework ? ` · 리워크 <i>${this.stats.rework}</i>` : ''}</span>`;
  }
  summary() {
    const good = Object.values(this.stats.good).reduce((a, b) => a + b, 0);
    return { good, uph: this.time > 120 ? Math.round((good / this.time) * 3600) : 0, busy: this.order.filter((c) => c.state === 'BUSY').length, moving: this.carriers.filter((c) => c.state === 'move').length };
  }
  setLabels(on) { this.labelsOn = on; for (const c of this.order) { c.label.visible = on; for (const sp of c.plates ?? []) sp.visible = on; } this.src.label.visible = on; this.sink.label.visible = on; this.board.visible = on; }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── 두 확장 Zone 묶음 (main.js가 만들고, 시뮬레이션 시계에 맞춰 돌린다) ─────────────────
export class ExtraZones {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.zones = EXTRA_ZONES.map((Z) => new ExtraZone(Z, this.root));
    this.t = 0; this.labelsOn = true;
  }
  // 새 실행(정밀조립Zone 시뮬레이션 시작)마다 — Blender 모델이 늦게 들어왔으면 운반체·제품도 새 모델로
  // only: 그 Zone만 다시 구성 (공정 설계에서 그 Zone 레시피를 적용했을 때 — 다른 Zone 흐름은 그대로)
  setup(sim, labelsOn = this.labelsOn, only = null) {
    this.zones.forEach((z) => { if (only && z.Z.key !== only) return; z.refreshEquipment(); z.reset(sim.mode.key, sim.seed ?? 1); });
    sim.zoneAmr = Object.fromEntries(this.zones.map((z) => [z.Z.key, z.carriers]));   // AMR·AGV 관제 창(fleet.js zflex·zadapt)이 Zone AMR을 보고 조작한다
    // 운반 AMR = Private 5G 단말 (정밀조립 운반 AMR과 같음): 위치는 Zone 원점 기준 → 공장 좌표
    sim.setExternalMovers?.(this.zones.flatMap((z) => z.carriers.map((c) => z.teleCarrier(c))));   // 시뮬레이션 이동체가 Zone AMR을 보고 양보·우회
    for (const z of this.zones) { const o = z.Z.origin; z.carriers.forEach((c) => { c.zoneMoving = () => c.state === 'move' || c.state === 'return' || c.state === 'toSrc' || c.state === 'toQ'; sim.net?.bindUE(c.id, c.uid, 'carrier', () => ({ x: c.x + o.x, y: 0.9, z: c.z + o.z, m: c }), c); }); }
    this.setLabels(labelsOn);
  }
  step(dt, sim) { const K = sim.cmd, halted = !!(K?.estopAll || K?.pstopAll); this.halted = halted; sim.zonesLive = true; sim.xzones = this; for (const z of this.zones) { z.sim = sim; z.fz = sim.fleet?.[`z${z.Z.key}`]; z.step(dt, halted); } }   // 투입 자재는 정밀조립Zone 시뮬레이션의 물류존 재고에서 꺼낸다
  update(rdt, running, speed) {
    this.t += rdt; const dts = running ? rdt * speed : 0;
    for (const z of this.zones) z.sync(rdt, this.t, dts);
  }
  updateLabels() { for (const z of this.zones) z.updateLabels(this.halted); }
  setLabels(on) { this.labelsOn = on; for (const z of this.zones) z.setLabels(on); }
  byKey(key) { return this.zones.find((z) => z.Z.key === key); }
  // 셀 로봇 찾기 (factory.js cellRobot): 셀 키(A_1_C03)와 로봇 번호 → { robot, st(텔레메트리용 셀 보기) }
  cellRobot(sid, idx) {
    for (const z of this.zones) { const c = z.order.find((x) => z.sid(x) === sid); if (c) return c.robots[idx] ? { robot: c.robots[idx], st: z.teleCell(c) } : null; if (sid === `${z.Z.uidp}_PACK`) return z.packRobot(idx); }
    return this.insp?.cellRobot(sid, idx) ?? null;   // 정밀검사존 (inspzone.js)
  }
  // 운반 AMR 찾기 (telemetry.js resolve): id(A-1-AMR01) → { mover(텔레메트리용 보기), obj(3D) }
  // 카메라 대상 (robotcam.js): 셀 로봇 [{ ref, robot(uid), st, r }] · 운반 AMR [{ id, mover(텔레메트리용 보기), c }]
  cellRobots() {
    const cells = this.zones.flatMap((z) => z.order.flatMap((c) => c.robots.map((r, idx) => ({ ref: { type: 'cell', stationId: z.sid(c), idx }, robot: c.robotUids[idx] ?? `${z.sid(c)}-${idx + 1}`, st: z.teleCell(c), r }))));
    const packs = this.zones.flatMap((z) => Object.values(z.pack ?? {}).filter((p) => p.arm).map((p) => { const f = z.packRobot(p.idx); return { ref: { type: 'cell', stationId: `${z.Z.uidp}_PACK`, idx: p.idx }, robot: p.uid, st: f.st, r: f.robot }; }));
    return [...cells, ...packs, ...(this.insp?.cellRobots() ?? [])];
  }
  carriersAll() { return this.zones.flatMap((z) => z.carriers.map((c) => ({ id: c.id, mover: z.teleCarrier(c), c }))); }
  carrier(id) {
    for (const z of this.zones) { const c = z.carriers.find((x) => x.id === id); if (c) return { mover: z.teleCarrier(c), obj: c.g }; }
    return this.insp?.carrier(id) ?? null;
  }
  summary() { return this.zones.map((z) => ({ key: z.Z.key, code: z.Z.code, name: z.Z.name, products: z.Z.products, byProduct: z.stats.good, ng: z.stats.ng, rework: z.stats.rework, cells: z.order.length, carriers: z.carriers.length, ...z.summary() })); }
}
// 카메라 바로가기 (main.js): [카메라 위치, 바라보는 점]
export const ZONE_VIEWS = {
  all: [[-1.5, 122, 108], [-1.5, 0, 0]],
  flex: [[-4, 36, 10.5], [-4, 0, -22.5]],
  precision: [[-10.5, 34, 34], [-5.5, 0, 0]],
  adapt: [[0, 34, 52], [0, 0, 19]],
  insp: [[30, 36, 14], [39.5, 0, -11.5]],
};
