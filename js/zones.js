// 메타팩토리 확장 Zone — 서버실과 AMR 스테이션 사이, 정밀조립Zone 뒤(화면 위)에 A-1 유연생산Zone, 앞(화면 아래)에 A-2 적응가공Zone (배치: zonedefs.js).
// 셀 구성·제품·사이클·로봇은 상위 폴더의 flexible-manufacturing(유연생산Zone)·adaptive-machining(적응가공Zone) 프로젝트를 따른다.
// 두 Zone은 각자 흐름 시뮬레이션으로 돈다: 투입 → 제품별 셀 경로 → 적재. 대상물은 지그 AMR에 실려 셀 중앙에 정차하고,
// 셀 하나에는 대상물 하나만 들어간다 — 다음 셀이 차 있으면 지금 셀에서 기다린다(출구 대기). 적재 후 빈 AMR은 복귀로로 투입 대기열에 선다.
// 시계는 정밀조립Zone 시뮬레이션과 같다(배속·일시정지), 라인 전체 비상정지·보호정지 때는 함께 멈춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KIT } from './factory.js';
import { buildLoader, stepLoader, loaderRobot, visibleTop, containerSplit } from './loader.js';
import { blenderOn, cloneAsset, RENDER } from './blender.js';
import { makeProductMachine } from './product-machines.js';
import { attachSpotGun, attachSealGun, attachVacuumGripper, attachRollerHead, attachNutrunner, attachScanner, attachDeburrSpindle, attachCmmPrepTool, attachLibsProbe, holdPart, makeHose, processMarks } from './endeffectors.js';
import { pointAt, pathLength, ROBOT_KINDS, PARALLEL_GAIN } from './line.js';
import { EXTRA_ZONES, ZONE_FAC, cellT, zoneRobotUid, zoneAmrUid, ZONE_FG_CAP, zonePack, zoneCtl, cellTendQ, TEND_END } from './zonedefs.js';
import { BATTERY, moverRadius, moverWidth } from './sim.js';
import { washQ, washPhase, boothPhase } from './washer.js';
import { cmmPlan, cmmPhase, cmmDoorK, cmmBridgeOn, CMM_PHASE_KO } from './cmmcell.js';
import { matlPlan, matlPhase, MATL_PHASE_KO } from './matlcell.js';
import { KIT_PARTS, KIT_T } from './kitcell.js';
export { EXTRA_ZONES };

const { std, emis, mesh, box, cyl, put, MAT, BELT_Y, AMMR, AMMR_LEAN, makeRobot, ammrContact, contactBox, surfaceY, supportBox, pointWork, alignTool, makeSparks, stepSparks, makeWorker, workerCycle, makeHumanoid, makeCarrierAMR, makeStackLight, cellBase, idPlate, armIK, makeArm, ARM_JOINTS, buildWeld, buildGate, buildVision, heavyRobot, dockStation } = KIT;
const c0cart = (o) => !!o.cart;   // 레거시: 작업자가 대차에 싣는다 (로봇 없음)
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
  // 가운데 줄 셀로 합류: 합류 차로(±0.75)에서 게이트(셀 x −1.75, 기둥 z ±1.5 · 북서에 실이 붙은 셀은 북쪽 −1.1) 1.75m 앞에서 셀 중심선에 올라탄 뒤 곧게 들어간다 — 차로에서 비스듬히 들어가면 AMR이 게이트 기둥에 걸린다
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
// 북서에 실(스캔 부스 · 항온 측정실, 남쪽 벽 z −1.2)이 붙은 셀: 게이트 북쪽 기둥은 −1.1까지만 (남쪽은 기본 +1.5)
const GATE_BOX = [-1.1, 1.5];
function gateOf(g, x, color, zs) { const G = buildGate(g, x, color, zs); return G; }
function drawGate(gs, title, text, col) {
  const key = `${title}|${text}|${col}`; if (gs.id === key) return; gs.id = key;
  const c = gs.cv.getContext('2d'), F = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  c.fillStyle = '#071019'; c.fillRect(0, 0, 512, 128); c.fillStyle = col; c.fillRect(0, 0, 14, 128);
  c.font = `bold 30px ${F}`; c.fillStyle = '#9fb4c8'; c.fillText(title, 32, 42);
  let fs = 40; c.font = `bold ${fs}px ${F}`; c.fillStyle = col;
  while (c.measureText(text).width > 460 && fs > 22) { fs -= 2; c.font = `bold ${fs}px ${F}`; }
  c.fillText(text, 32, 98); gs.tex.needsUpdate = true;
}
// C01 공급·키팅 (셀 로컬 · +z = 남쪽): 부품 ID 판독 게이트 · 남쪽 협동로봇 2대가 라인사이드 컨베이어의 키트 트레이에서 집어 판넬에 장착
//  라인사이드 컨베이어 (z 2.2 · 윗면 0.75m): 서쪽 끝 대기 자리 2칸 → 트레이 정지 2곳(로봇 x) → 동쪽 끝 빈 트레이 회수대 · 정지 자리 남쪽에 보울 피더 2대(클립·너트)
//  키팅 구역 (z 2.6 ~ 5.1): 키트 조립대(서쪽 x −2.6) → 북쪽으로 짧은 컨베이어 · 검증대(영상 + 무게) → 라인사이드 대기 자리 / 흐름 랙 3대(남쪽 끝 · 2단) · 피킹 로봇 길(z 3.6 — 자동화 레일 협동로봇 · 피지컬AI AMMR)
//  AMR이 투입구에서 올라오는 길(셀 로컬 x −4.5)과 0.8m 넘게 · 바닥 Zone 이름 글씨(셀 로컬 z 5.9)보다 북쪽
export const KITC = {   // 키팅 구역 묶음 좌표 (양수 z = 남쪽) — 셀 로컬(로봇)은 sz(−1)를 곱한다
  sz: -1,
  conv: { z: 2.2, x0: -2.85, x1: 2.45, y: 0.75 }, stops: [-0.75, 0.95], queue: [-2.6, -2.05], ret: 2.25,
  build: { x: -2.6, z: 3.3 }, verify: { z: 2.75 }, feeder: 2.85,
  pick: { z: 3.6, place: -1.75 }, racks: [-1.6, 0, 1.6], rackZ: 4.75, rackFront: 4.45,
};
const Y_TRAY = KITC.conv.y + 0.08;   // 키트 트레이 안 부품 윗면 높이
const KIT_MAT = { conv: std(0x5a6470, { metalness: 0.5, roughness: 0.4 }), roller: std(0x9aa3ad, { metalness: 0.7, roughness: 0.3 }), tray: std(0x2f6f8f, { roughness: 0.55 }), rack: std(0xf2c230, { roughness: 0.5 }), bin: [std(0x2f6fd6), std(0xf08a24), std(0x3ddc84)] };
const KIT_PART_COL = { hood: std(0xf0a030, { metalness: 0.4, roughness: 0.4 }), door: std(0x9a6bff, { metalness: 0.4, roughness: 0.4 }) };
function kitTray(parent) {   // 키트 트레이 (0.46 × 0.32m) · 부품 4칸
  const t = put(new THREE.Group(), 0, 0, 0, parent); t.name = 'KitTray';
  put(box(0.46, 0.05, 0.32, KIT_MAT.tray), 0, 0.025, 0, t);
  for (const sx of [-1, 1]) put(box(0.02, 0.05, 0.32, KIT_MAT.tray), sx * 0.22, 0.07, 0, t);
  const parts = [0, 1, 2, 3].map((k) => { const m = put(box(0.08, 0.03, 0.12, KIT_PART_COL.hood), -0.15 + k * 0.1, 0.065, 0, t); m.name = 'KitPart'; return m; });
  t.userData.parts = parts; t.visible = false; return t;
}
function buildKit(cg) {
  // 유연생산 셀은 z를 뒤집어 놓는다(셀 그룹 scale.z = −1 · 통로 쪽 배치) — 키팅 구역은 한 번 더 뒤집은 묶음에 KITC 그대로(양수 z = 남쪽) 그린다
  const gate = gateOf(cg, -1.75, 0x33ff99), g = put(new THREE.Group(), 0, 0, 0, cg), K = KITC, C = K.conv, rollerY = C.y - 0.03; g.scale.z = -1; g.name = 'KittingArea';
  // 라인사이드 컨베이어 (서 → 동) · 키팅 구역에서 올라오는 짧은 컨베이어 (남 → 북)
  const convBelt = (x0, x1, z0, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), along = Math.abs(x1 - x0) > 1e-6, G = put(new THREE.Group(), (x0 + x1) / 2, 0, (z0 + z1) / 2, g); G.name = 'KitConveyor';
    put(box(along ? L : 0.5, 0.06, along ? 0.5 : L, KIT_MAT.conv), 0, rollerY - 0.04, 0, G);
    for (let d = -L / 2 + 0.1; d < L / 2; d += 0.16) put(cyl(0.025, 0.025, 0.44, KIT_MAT.roller, 8), along ? d : 0, rollerY, along ? 0 : d, G).rotation[along ? 'x' : 'z'] = PI / 2;
    for (let d = -L / 2 + 0.15; d <= L / 2; d += Math.max(0.8, L / 3)) for (const s2 of [-0.2, 0.2]) put(box(0.05, rollerY - 0.07, 0.05, MAT.dark), along ? d : s2, (rollerY - 0.07) / 2, along ? s2 : d, G);
  };
  convBelt(C.x0, C.x1, C.z, C.z); convBelt(K.build.x, K.build.x, K.build.z - 0.25, C.z + 0.25);
  // 트레이 정지 표시 (스토퍼) · 동쪽 빈 트레이 회수대
  for (const x of K.stops) put(box(0.04, 0.03, 0.5, emis(0xf5b82e, 0.8), false), x + 0.26, C.y - 0.02, C.z, g);   // 정지 표시 (트레이가 지나갈 때는 내려가 있음 — 윗면 아래)
  const ret = put(new THREE.Group(), K.ret, 0, C.z, g); ret.name = 'TrayReturn';
  for (let k = 0; k < 3; k++) put(box(0.46, 0.05, 0.32, KIT_MAT.tray), 0, C.y + 0.03 + k * 0.055, 0, ret);
  // 키트 조립대 · 검증대 (카메라 아치 + 저울 판)
  const bt = put(new THREE.Group(), K.build.x, 0, K.build.z + 0.15, g); bt.name = 'KitBuildTable';
  put(box(0.6, 0.06, 0.4, MAT.steel), 0, C.y - 0.06, 0.1, bt); for (const sx of [-1, 1]) put(box(0.05, C.y - 0.09, 0.05, MAT.dark), sx * 0.26, (C.y - 0.09) / 2, 0.25, bt);
  const vf = put(new THREE.Group(), K.build.x, 0, K.verify.z, g); vf.name = 'KitVerify';
  for (const sx of [-1, 1]) put(box(0.05, 0.75, 0.05, MAT.dark), sx * 0.33, C.y + 0.375, 0, vf);
  put(box(0.72, 0.06, 0.08, MAT.dark), 0, C.y + 0.75, 0, vf);
  const camMat = emis(0x37e8ff, 0.6); const cam = put(box(0.16, 0.08, 0.1, MAT.dark), 0, C.y + 0.68, 0, vf); put(cyl(0.03, 0.03, 0.02, camMat, 12), 0, -0.05, 0, cam);
  const scaleMat = emis(0x3ddc84, 0.6); put(box(0.5, 0.012, 0.012, scaleMat, false), 0, C.y + 0.01, 0.18, vf);
  // 보울 피더 2대 (트레이 정지 자리 남쪽) · 진동 트랙 → 정지 자리 위 슈트
  const feedMats = K.stops.map((x) => {
    const F = put(new THREE.Group(), x, 0, K.feeder, g); F.name = 'BowlFeeder';
    put(box(0.4, 0.55, 0.4, MAT.dark), 0, 0.275, 0, F); put(cyl(0.2, 0.15, 0.16, MAT.steel, 20), 0, 0.63, 0, F);
    const m = emis(0x3ddc84, 0.6); put(box(0.06, 0.03, 0.06, m, false), 0.16, 0.57, 0.21, F);
    const tr = put(box(0.05, 0.03, 0.42, MAT.steel), 0.12, 0.79, -0.32, F); tr.rotation.x = -0.25;   // 진동 트랙 → 슈트
    return m;
  });
  // 흐름 랙 3대 (남쪽 끝 · 북쪽을 봄 · 칸마다 표시등) · 피킹 로봇 레일
  const lights = [];
  K.racks.forEach((x, i) => {
    const R = put(new THREE.Group(), x, 0, K.rackZ, g); R.name = 'FlowRack';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.05, 1.25, 0.05, KIT_MAT.rack), sx * 0.57, 0.625, sz * 0.27, R);   // 2단 (윗면 1.1m — 피킹 로봇 팔꿈치가 위 선반 위로 넘어가지 않게)
    const L = [];
    for (let lv = 0; lv < 2; lv++) {
      const y = 0.55 + lv * 0.36, sh = put(box(1.14, 0.03, 0.6, MAT.steel), 0, y, 0, R); sh.rotation.x = -0.12;   // 앞으로 기운 선반 (흐름 랙)
      for (const bx of [-0.36, 0, 0.36]) put(box(0.32, 0.16, 0.5, KIT_MAT.bin[i]), bx, y + 0.1, 0.01, R).rotation.x = -0.12;
      const lm = emis(0xf5b82e, 0.15); put(box(1.1, 0.03, 0.02, lm, false), 0, y - 0.03, -0.31, R); L.push(lm);
    }
    lights.push(L);
  });
  put(box(4.3, 0.05, 0.14, MAT.steel), 0, 0.025, K.pick.z, g).name = 'PickerRail';
  // 트레이: 지금 판넬 키트 2개 · 다음 판넬 키트 2개 (zones.js kitAnim이 자리를 정한다)
  const trays = [0, 1, 2, 3].map(() => kitTray(g));
  return { ...gate, gateTitle: '키팅 게이트 · 부품 ID', kit: { trays, lights, feedMats, camMat, scaleMat } };
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
  // 뒤쪽 펜스 난간(정밀조립 용접셀 기준 z −1.8)은 이 셀 로봇 자리(z −1.75)를 지나 위팔에 닿는다 → 셀 뒤 끝(z −2.25)으로 물리고 양 끝에 기둥
  const rail = g.children.find((o) => o.type === 'Group')?.children.find((m) => m.geometry?.parameters?.width === 4);
  if (rail) { rail.position.z = -2.25; for (const x of [-2, 2]) put(box(0.06, 1.4, 0.06, MAT.yellow), x, 0.7, -2.25, g); }
  put(box(0.45, 0.95, 0.4, MAT.dark), -1.55, 0.48, 1.95, g); put(box(0.28, 0.12, 0.28, MAT.orange), -1.55, 1.0, 1.95, g);
  put(box(0.5, 1.5, 0.4, std(0x4a5560)), 1.6, 0.75, -2.05, g); put(box(0.3, 0.2, 0.02, emis(0x3ddc84, 1)), 1.6, 1.25, -1.84, g);
  return { ...w, dock: dockStation(g) };   // 스폿 가압력(약 3kN)을 AMR이 아니라 도킹 스테이션 바닥 블록이 받는다
}
// C04 실링: 실러 드럼·펌프 · 국소 배기 후드 · 도포 비드 입자
function buildSeal(g) {
  // 실러 디스펜서: 드럼 펌프(실러 드럼 + 램 펌프) · 계량 유닛 — 로봇 뒤쪽(로봇과 같은 편 셀 경계 안)에 두고 호스로 로봇 손목의 디스펜싱 건까지 잇는다
  put(cyl(0.3, 0.3, 0.88, MAT.yellow), 1.0, 0.44, -2.0, g); put(cyl(0.31, 0.31, 0.06, MAT.dark), 1.0, 0.9, -2.0, g);
  put(box(0.12, 0.7, 0.12, MAT.steel), 1.0, 1.28, -2.0, g); put(box(0.34, 0.16, 0.2, MAT.dark), 1.0, 1.66, -2.0, g);   // 램 펌프 기둥·모터
  put(box(0.42, 1.1, 0.4, MAT.dark), 0.3, 0.55, -2.05, g); put(box(0.3, 0.18, 0.02, emis(0x3ddc84, 1)), 0.3, 0.9, -1.84, g);   // 계량(도징) 유닛 · 표시창
  put(cyl(0.02, 0.02, 0.7, MAT.steel), 0.65, 1.66, -2.0, g).rotation.z = PI / 2;   // 펌프 → 계량 유닛 배관
  put(box(2.6, 0.32, 1.6, std(0x59636e)), 0, 3.05, 0, g); put(box(0.3, 1.0, 0.3, std(0x59636e)), 0, 3.7, 0, g);
  const lamp = emis(0xe6f2ff, 0.6); put(box(2.2, 0.03, 0.3, lamp, false), 0, 2.88, 0, g);
  return { lamp, hoseOut: { x: 0.08, y: 0.95, z: -2.05 },   // 호스 출구: 계량 유닛 로봇 쪽(−x) 옆면 — 윗면에서 올리면 펌프 배관(높이 1.66m)과 겹친다
    manualProps: [put(box(1.0, 0.8, 0.6, MAT.dark), -1.2, 0.4, 2.0, g)] };
}
// C10 정밀 장착: 토크 모니터 · 힌지/스트라이커·체결 부품 트레이
function buildMount(g) {
  const panel = put(box(0.8, 0.6, 0.08, MAT.dark), -1.85, 1.8, 1.35, g);
  const screen = emis(0x3ddc84, 1.2); put(box(0.7, 0.5, 0.02, screen, false), 0, 0, 0.05, panel);
  put(box(0.06, 1.15, 0.06, MAT.dark), -1.85, 0.95, 1.35, g);
  // 힌지·스트라이커 부품 트레이: 로봇마다 바로 뒤(같은 편 셀 경계 안) — 로봇이 점마다 하나씩 집어 도어에 놓는다
  for (const z of [-2.05, 2.05]) {
    const tb = put(new THREE.Group(), 0.35, 0, z, g);
    put(box(0.6, 0.88, 0.4, MAT.dark), 0, 0.44, 0, tb); put(box(0.6, 0.04, 0.4, MAT.steel), 0, 0.9, 0, tb);
    for (let i = 0; i < 3; i++) put(box(0.16, 0.05, 0.3, std(0x2f6fd6)), -0.19 + i * 0.19, 0.945, 0, tb);
  }
  return { screen };
}
// C05 롤러 헤밍 (혼류 소량 생산 방식): 통로 건너편(+z)에 반전 앤빌 테이블 — 가운데 판 위아래에 제품 전용 앤빌(후드 · 도어)을 달고, 제품이 바뀌면 x축으로 180° 뒤집어 그 제품 앤빌을 위로
//  핸들링 6축(진공 그리퍼)이 인너를 아우터에 결합해 둔 패널을 앤빌에 올리면(진공 흡착 고정) → 롤러 헤밍 고가반 6축(앤빌 동쪽)이 플랜지를 3번 따라가며 접고(30° → 60° → 90°)
//  → 앤빌에 묻힌 유도 코일이 헴 접착제를 가경화 → 핸들링 6축이 꺼내 AMR에 올린다
//  반전축 높이 0.67m · 반전 반지름(도어 앤빌 반폭 0.61 · 두께) 0.65m — 바닥에 닿지 않고, 받침 기둥(x ±0.95)은 롤러 로봇 받침 밖
export const HEM_ANVIL = { hood: { w: 1.72, d: 0.7 }, door: { w: 1.36, d: 1.2 }, axisY: 0.67, plate: { w: 1.76, d: 1.24 } };
function buildHem(g) {
  const pz = HEM.press.z, H = HEM_ANVIL, top = HEM.bedY, t = (top - H.axisY - 0.12) * 2;   // 가운데 판 두께 (앤빌 0.12m 위 = 베드 높이)
  for (const sx of [-1, 1]) { put(box(0.1, H.axisY + 0.1, 0.36, MAT.dark), sx * 0.95, (H.axisY + 0.1) / 2, pz, g); put(cyl(0.09, 0.09, 0.12, MAT.steel, 16), sx * 0.95, H.axisY, pz, g).rotation.z = PI / 2; }   // 반전축 받침 · 베어링
  put(box(0.3, 0.45, 0.3, MAT.dark), -1.15, 0.22, pz, g); put(cyl(0.1, 0.1, 0.2, MAT.accent, 14), -1.15, H.axisY, pz, g).rotation.z = PI / 2;   // 반전 구동 모터
  const flip = put(new THREE.Group(), 0, H.axisY, pz, g); flip.name = 'AnvilFlipTable';
  put(box(H.plate.w, t, H.plate.d, MAT.steel), 0, 0, 0, flip);
  const coilMat = emis(0xff7a2a, 0.05), anvils = {};
  Object.entries({ hood: 1, door: -1 }).forEach(([k, up]) => {
    const A = H[k], a = put(new THREE.Group(), 0, 0, 0, flip); a.name = `Anvil_${k}`; a.rotation.x = up > 0 ? 0 : PI;   // 위 면 = 후드 · 아래 면 = 도어
    put(box(A.w, 0.12, A.d, std(0x7d8994, { metalness: 0.75, roughness: 0.3 })), 0, t / 2 + 0.06, 0, a);   // 앤빌 (패널 모양 금형 · 윗면 = 베드 높이)
    for (const sz of [-1, 1]) put(box(A.w - 0.06, 0.012, 0.03, coilMat, false), 0, t / 2 + 0.121, sz * (A.d / 2 - 0.05), a);   // 유도 경화 코일 (플랜지 밑)
    for (const sx of [-1, 1]) put(box(0.03, 0.012, A.d - 0.1, coilMat, false), sx * (A.w / 2 - 0.05), t / 2 + 0.121, 0, a);
    for (const x of [-0.3, 0.3]) put(cyl(0.04, 0.04, 0.01, MAT.dark, 12), x, t / 2 + 0.125, 0, a);   // 진공 흡착 패드
    put(box(H.plate.w, 0.05, 0.012, std(PC[k], { emissive: PC[k], emissiveIntensity: 0.4 }), false), 0, up * 0.0 + t / 2 - 0.03, -H.plate.d / 2 - 0.007, a);   // 제품 색 띠 (후드 주황 · 도어 보라)
    anvils[k] = a;
  });
  // 헤밍 제어반 · 유도 경화 전원 (셀 뒤 끝 — 동쪽은 정비 자리 · 순찰 길)
  const panel = put(box(0.6, 1.5, 0.4, std(0x4a5560)), -1.9, 0.75, 3.05, g), screen = emis(0x2c7f9e, 1.2); put(box(0.4, 0.25, 0.02, screen, false), 0, 0.35, -0.21, panel);
  put(box(0.5, 1.0, 0.4, MAT.dark), -1.2, 0.5, 3.05, g); put(box(0.3, 0.12, 0.02, emis(0xff7a2a, 0.8), false), -1.2, 0.8, 2.84, g);
  return { anvil: { flip, coilMat, up: 'hood', ang: 0 }, screen };
}
// C07 NG 수리 부스 (실제 차체 수리처럼 사람 손 — 결함 자리가 매번 달라 고정 로봇으로 하지 않는다): AMR이 부스 가운데 서면 작업자(피지컬AI: 휴머노이드)가 통로 북쪽(−z)에 서서
//  천장 지브 크레인 밸런서에 매단 휴대용 스폿건 · 실러건 · 그라인더로 결함 자리를 보수 — AI 결함 위치 프로젝터가 패널 위 결함 자리를 빨갛게 비춘다
//  부스: 뒤(−z) 용접 커튼 · 국소 배기 후드(캔틸레버 2.7m) · 공구판 · 남쪽(+z) 재검 작업대(휴대용 3D 스캐너) · 격리 랙(빨강) · 출구 쪽 라벨기는 남쪽 기둥 캔틸레버 (문형 없음)
function buildRework(g) {
  put(box(1.4, 0.85, 0.7, MAT.dark), 0.2, 0.43, 2.0, g); put(box(1.3, 0.04, 0.6, MAT.steel), 0.2, 0.87, 2.0, g);
  const gauge = put(new THREE.Group(), 0.45, 0.89, 2.0, g); gauge.name = 'HandScanner'; put(box(0.12, 0.06, 0.22, MAT.white), 0, 0.03, 0, gauge); put(box(0.08, 0.04, 0.03, emis(0x37e8ff, 1.2), false), 0, 0.04, -0.12, gauge);   // 재검 휴대용 3D 스캐너
  const iso = put(new THREE.Group(), -1.6, 0, 2.0, g);
  for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) put(box(0.05, 1.5, 0.05, MAT.defect), x, 0.75, z, iso);
  put(box(1.15, 0.04, 0.75, MAT.defect), 0, 0.6, 0, iso); put(box(1.15, 0.04, 0.75, MAT.defect), 0, 1.2, 0, iso);
  // 뒤(−z) 용접 커튼 (반투명 주황) · 공구판 (그라인더 · 실러건 · 예비 팁)
  const curtain = new THREE.MeshStandardMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.35, roughness: 0.6, side: THREE.DoubleSide, depthWrite: false });
  for (const x of [-2.1, 2.1]) put(box(0.05, 2.0, 0.05, MAT.dark), x, 1.0, -2.2, g);
  put(box(4.2, 0.05, 0.05, MAT.dark), 0, 2.0, -2.2, g); put(new THREE.Mesh(new THREE.PlaneGeometry(4.1, 1.8), curtain), 0, 1.05, -2.2, g);
  const tb = put(new THREE.Group(), 1.3, 0, -2.12, g); tb.name = 'ToolBoard';
  put(box(0.9, 0.7, 0.03, std(0x4a5560)), 0, 1.25, 0, tb); put(box(0.3, 0.08, 0.08, MAT.orange), -0.2, 1.35, 0.06, tb); put(box(0.08, 0.2, 0.06, MAT.dark), 0.15, 1.3, 0.06, tb); put(box(0.06, 0.18, 0.06, MAT.yellow), 0.32, 1.2, 0.06, tb);
  // 국소 배기 후드: 뒤쪽 기둥 2개에서 통로 위로 내민 캔틸레버 (아랫면 2.65m — 작업자 머리 · AMR 위 패널 위)
  for (const x of [-1.2, 1.2]) put(box(0.1, 2.9, 0.1, MAT.steel), x, 1.45, -1.95, g);
  put(box(2.6, 0.25, 1.5, std(0x8a949e, { metalness: 0.5 })), 0, 2.78, -1.3, g); put(box(0.35, 0.6, 0.35, std(0x8a949e, { metalness: 0.5 })), 0, 3.2, -1.7, g);
  // 지브 크레인 · 밸런서 · 휴대용 스폿건 (작업자 오른쪽 위)
  put(box(0.12, 2.6, 0.12, MAT.yellow), -1.9, 1.3, -1.6, g); const boom = put(box(1.6, 0.1, 0.1, MAT.yellow), -1.15, 2.55, -1.6, g); boom.name = 'JibBoom';
  put(cyl(0.006, 0.006, 0.9, MAT.dark, 6), -0.6, 2.05, -1.6, g); put(box(0.12, 0.12, 0.12, MAT.dark), -0.6, 1.58, -1.6, g);   // 밸런서 와이어 · 본체
  const gun = put(new THREE.Group(), -0.6, 1.35, -1.6, g); gun.name = 'HandSpotGun'; put(box(0.1, 0.22, 0.1, MAT.body ?? MAT.dark), 0, 0, 0, gun); put(box(0.05, 0.05, 0.22, MAT.steel), 0, -0.1, 0.12, gun);
  // AI 결함 위치 프로젝터 (배기 후드 아래 · 결함 자리를 비춘다)
  const projMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  put(box(0.18, 0.12, 0.18, MAT.dark), 0, 2.6, -0.9, g); const beam = put(new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.66, 16, 1, true), projMat), 0, 1.9, -0.45, g); beam.rotation.x = -0.573; beam.name = 'DefectProjector';   // 빛줄기: 프로젝터(z −0.9 · 2.6m) → 패널 윗면 가운데 줄(z 0 · 1.2m)
  // 출구 라벨기 캔틸레버 (남쪽 기둥 · 문형 없음) — 라벨기·판독기는 팔 아래 (재검 합격 시 QR 라벨)
  put(box(0.12, 2.0, 0.12, MAT.dark), 1.25, 1.0, 1.55, g); put(box(0.12, 0.12, 2.4, MAT.dark), 1.25, 2.0, 0.4, g);
  return { sparks: put(makeSparks(0xffc060, 24, 0.05), 0, 0, 0, g), proj: { beam, mat: projMat } };
}
// 헤밍 셀 진행률 → 핸들링 6축 동작 진행률: 사이클 앞 HEM.win[0]에 패널을 앤빌로(동작 0 ~ 0.49), 롤러 헤밍 동안 대기(0.545), 뒤 1 − HEM.win[1]에 꺼내 AMR로(0.6 ~ 1)
const hemHandQ = (p) => { const [a, b] = HEM.win; return p < a ? (p / a) * 0.49 : p > b ? 0.6 + ((p - b) / (1 - b)) * 0.4 : 0.545; };
const sm01 = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
// 휴머노이드는 셀 바닥(0.06m)에 서서 AMR 통로 경계선(±0.78m) 바로 바깥 — 두 손이 AMR 위 대상물(폭 ±0.29m · 윗면 1.11m) 가장자리와 윗면에 닿는 거리
const HUM_SLOT_Z = 0.88;
// 확장 Zone 6축·협동로봇 접촉 작업 구간(셀 진행률)과 방식 — 헤밍 램(0.45~0.85) · CMM 탐침(0.3~0.6) · 과 겹치지 않게
const CELL_WORK = {
  kit: { from: 0.1, to: 0.85, kind: 'touch' }, locate: { from: 0.1, to: 0.85, kind: 'touch' }, spot: { from: 0.08, to: 0.9, kind: 'press' }, seal: { from: 0.1, to: 0.85, kind: 'trace' },
  hem: { from: 0.08, to: 0.42, kind: 'press' }, mount: { from: 0.1, to: 0.85, kind: 'screw' }, rework: { from: 0.1, to: 0.85, kind: 'press' },
  matid: { from: 0.02, to: 0.13, kind: 'touch' }, cmm: { from: 0.06, to: 0.28, kind: 'trace' },   // LIBS 재질 분석 프로브 접촉 · 측정 전 에어 블로 (두 셀은 실제 구간을 셀 계획에서 — js/matlcell.js · cmmcell.js)
};
// 머신텐딩 배치 (adaptive-machining TEND): 로봇 −z 1.25m (문 중심선 x −0.1 위 — 팔이 문 열림 폭 1.3m 가운데로 드나든다), 머시닝센터 −z 3.25m (통로 반대쪽, 앞면 −z 2.25m), 테이블 앞 −z 3.05m
const TEND = { robot: { x: -0.1, z: -1.25 }, mc: { z: -3.25 }, table: { x: -0.1, z: -3.05 } };
// 부품 옮겨 달기 셀의 부품함 (셀 로컬, 로봇과 같은 편): 키팅 = 로봇 옆 키트 빈(통로 쪽 첫 칸) · 정밀 장착 = 로봇 뒤쪽 힌지 트레이 윗면
// 키팅 빈은 속 부품 윗면(0.49m) 위에서 집는다 (손가락이 빈 속 부품에 들어가지 않게)
const PICK_AT = { kit: (r) => ({ x: r.slot.x, y: KITC.conv.y + 0.08, z: KITC.sz * KITC.conv.z }),   // 키트 트레이 정지 자리 (로봇 바로 뒤 · 남쪽)
  mount: (r) => ({ x: 0.35, y: 0.972, z: Math.sign(r.slot.z) * 2.05 }) };
// 헤밍 셀(C05): 로봇은 AMR 정차 자리(셀 가운데)와 헤밍 프레스(셀 로컬 z 1.9, 베드 윗면 0.77m) 사이 통로 쪽 받침대(0.45m) 위에서 패널을 옮긴다
// 받침대가 없으면 J1 하우징이 프레스 베이스(높이 0.65m · 앞면 z 1.1) 위를 돌며 부딪히고, 더 앞(z > 0.82)이면 받침대·J1 하우징이 베이스·기둥에 닿는다
// x는 패널 끝(±0.8m) 바깥 — 패널 길이 안쪽에 서면 프레스에 넣을 때 패널 안쪽 가장자리가 로봇 어깨·위팔 위에 걸린다
// 프레스 램은 넣고 뺄 때 0.5m 더 열리고(손목·아래팔이 다이 밑으로 들어감), 헤밍 때 다이 아래면이 패널 윗면까지 내려온다
export const HEM = { robot: { x: -1.25, z: 0.9, y: 0.5 }, press: { x: 0, z: 2.3 }, roller: { x: 1.65, z: 2.15, y: 0.5 }, win: [0.22, 0.8], bedY: 0.85, open: 0.7, dieY: 1.1, edge: 0.15, gx: 0.2, lift: 0.1, mouth: 0.75, rest: { dx: 0.05, y: 1.75, dz: -0.2 } };   // mouth: 프레스 중심 → 기둥 앞면 (ODEN 기둥 깊이 1.5m의 절반)
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
  r.tendI = i;   // 경로 구간 — 소재를 손에 든 구간 · 기계 안 구간 (animCell tendPart)
  r.tendInside = inside && doorK >= 0.95;
  if (inside && !r.tendInside) { r.arm.native ? r.arm.pose(...J.home) : r.arm.pose(J.home[0], J.home[1], J.home[2], J.home[3], 0, 0); return; }
  const A = J[a], B = J[b], yaw = (q) => (Math.abs(q) > 3 ? PI : q);
  const q = A.map((v, j) => (j === 0 ? yaw(v) + (yaw(B[0]) - yaw(v)) * k : v + (B[j] - v) * k));
  if (r.arm.native) r.arm.pose(...q); else r.arm.pose(q[0], q[1], q[2], q[3], 0, (a === 'table' || b === 'table') ? k * 0.6 : 0);
}
// 디버링셀 이송 6축 경로 (q = washQ(p) · 0 ~ 1): [진행률, 자세, 그 구간 동안 블록 위치] — 자세 사이는 관절 보간
// 몸을 돌릴 때(AMR ↔ 부스 ↔ 세척기)는 팔을 세워 접은 자세(tuck·)에서만 돈다 · 부스(q 0.3 ~ 0.41) · 세척기(q 0.72 ~ 0.85) 동안 그 앞에서 접고 기다린다
// 접은 자세 ↔ 문 앞(ent)은 로봇 가까이 문 높이로 먼저 내려(mid·) 뻗는다 — 접은 자세에서 바로 뻗으면 든 블록이 높이 지나가며 문 윗부분에 닿는다
// 블록 위치: amr(AMR 지그) · hand(그리퍼) · booth(부스 고정구) · wash(세척기 고정구) — 집는 순간이 'hand' 구간의 시작 (washer.js washPhase · boothPhase와 같은 진행률)
const XFER_SEQ = [
  [0, 'tuckA', 'amr'], [0.03, 'overA', 'amr'], [0.06, 'amr', 'hand'], [0.09, 'overA', 'hand'], [0.12, 'tuckA', 'hand'],
  [0.16, 'tuckB', 'hand'], [0.175, 'midB', 'hand'], [0.19, 'entB', 'hand'], [0.22, 'booth', 'booth'], [0.25, 'entB', 'booth'], [0.265, 'midB', 'booth'], [0.28, 'tuckB', 'booth'],
  [0.42, 'tuckB', 'booth'], [0.435, 'midB', 'booth'], [0.45, 'entB', 'booth'], [0.48, 'booth', 'hand'], [0.51, 'entB', 'hand'], [0.525, 'midB', 'hand'], [0.54, 'tuckB', 'hand'],
  [0.58, 'tuckW', 'hand'], [0.595, 'midW', 'hand'], [0.61, 'entW', 'hand'], [0.64, 'wash', 'wash'], [0.67, 'entW', 'wash'], [0.685, 'midW', 'wash'], [0.7, 'tuckW', 'wash'],
  [0.86, 'tuckW', 'wash'], [0.875, 'midW', 'wash'], [0.89, 'entW', 'wash'], [0.91, 'wash', 'hand'], [0.93, 'entW', 'hand'], [0.94, 'midW', 'hand'], [0.95, 'tuckW', 'hand'],
  [0.97, 'tuckA', 'hand'], [0.98, 'overA', 'hand'], [0.99, 'amr', 'amr'], [0.995, 'overA', 'amr'], [1, 'tuckA', 'amr'],
];
// 문은 로봇이 드나드는 동안만 열림 (부스 · 세척기) — 접은 자세에서 내려오기 전에 다 열리고, 다시 접은 뒤에 닫힌다 · 진행률로 정해 배속과 관계없다
export const XFER_DOOR = { booth: [[0.155, 0.295], [0.415, 0.555]], wash: [[0.575, 0.715], [0.855, 0.96]] };
const doorK = (q, R) => Math.max(0, ...R.map(([a, b]) => Math.min(1, (q - a) / 0.01, (b - q) / 0.01)));
// seq: 경로 (디버링셀 XFER_SEQ · CMM 셀 js/cmmcell.js CMM_PLANS[…].seq) · r.xTuck: 접은 자세 이름 → 그 역 (J1만 역 쪽으로) · r.xStations: 문 안 역
function xferPose(r, q, seq = XFER_SEQ) {
  if (!r.xJ) {
    const P = r.xferPts, ik = (p) => (r.arm.native ? r.arm.ik(...p) : armIK(r.scale ?? 1, ...p)), J = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, ik(p)]));
    const tuck = (j) => (r.arm.native ? [j[0], ...TEND_TUCK.slice(1)] : j);
    r.xJ = { ...J, ...Object.fromEntries(Object.entries(r.xTuck).map(([k, st]) => [k, tuck(J[st])])) };
  }
  let i = 0; while (i < seq.length - 2 && q >= seq[i + 1][0]) i++;
  const [q0, a, loc] = seq[i], [q1, b] = seq[i + 1], k0 = Math.min(1, Math.max(0, (q - q0) / Math.max(1e-6, q1 - q0))), k = k0 * k0 * (3 - 2 * k0);
  r.xferLoc = loc; r.xSeg = [a, b]; r.tendInside = r.xStations.includes(a) || r.xStations.includes(b);
  const A = r.xJ[a], B = r.xJ[b], j = A.map((v, n) => v + (B[n] - v) * k);
  if (r.arm.native) r.arm.pose(...j); else r.arm.pose(j[0], j[1], j[2], j[3], 0, 0);
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
// ③ 유압블록 사선·디버링셀 — 실제 라인 구성: 사선홀 머시닝센터(북쪽 · 머신텐딩 TEND 배치) ← 텐딩 6축(셀 로봇)
//   + 워터젯 디버링 부스(남서) · 밀폐 세척기(남동) ← 이송 6축(설비에 딸린 로봇 · AMR 정남쪽 0.4m 받침대)
function buildDeburr(g, def) {
  const M = buildXDrill(g, def);
  return { ...M, ...(def?.wash ? { washer: buildWasher(g), booth: buildWjBooth(g) } : {}) };
}
// 사선홀 머시닝센터: Haas VF-2(3축 수직 · 공식 사양) + 4축 틸팅 로터리 크래들 — 크래들을 기울여 블록 옆면에 사선홀을 뚫는다 (가공 중에만 기울임 · 문 열 때는 수평)
// 크래들 높이만큼 소재·집는 자리(fixture)를 올린다 — 텐딩 로봇 경유점은 고정구 위치에서 계산 (buildCrew)
function buildXDrill(g, cell) {
  const product = makeProductMachine('vf2', g, [0, 0, TEND.mc.z]);
  if (!product) return buildMill5(g, cell);   // 모델이 없으면 간이 머시닝센터
  const Mc = product.machine; Mc.configureWorkpiece(PRODUCT_DIM[cell.product]);
  const F = Mc.nodes.Fixture, part = F?.getObjectByName('ProcessWorkpiece');
  if (F && part) {
    const cradle = put(new THREE.Group(), 0, 0.07, 0, F); cradle.name = 'TiltCradle';
    for (const sx of [-1, 1]) put(box(0.05, 0.16, 0.34, MAT.dark), sx * 0.38, 0.03, 0, F);   // 틸팅 축받이 (좌우)
    put(cyl(0.16, 0.16, 0.05, MAT.steel, 20), 0, -0.02, 0, cradle);   // 로터리 원판
    cradle.add(part); cradle.add(Mc.fixture);
    Mc.cradle = cradle;
  }
  // 기계 앞면·오른쪽 옆면 (셀 로컬) — 상태 감시 센서 자리 (addCMSensors)
  g.updateWorldMatrix(true, true); const bb = new THREE.Box3().setFromObject(product.machine.root), inv = g.matrixWorld.clone().invert(); bb.applyMatrix4(inv);
  return { ...product, front: bb.max.z, side: bb.max.x };
}
// 워터젯 디버링 부스 (로봇 투입형): 밀폐 캐빈 · 롤업 셔터(동쪽 — 이송 로봇 쪽) · 회전 고정구 · 워터젯 노즐 헤드(교차홀마다 고압수로 버 제거) · 관찰창 · 미스트 집진기 · 경광등 · HMI
// + 서쪽 고압 인텐시파이어 펌프 유닛 — 셀 남서쪽 (캐빈 x −2.85 ~ −1.45, z 1.0 ~ 2.6 · 셀 로컬) · AMR 들어오는 길(z ±0.475)과 0.5m 이상
export const WJB = { fix: { x: -1.75, y: 0.98, z: 1.8 }, cab: { x: -2.15, z: 1.8, w: 1.4, d: 1.6, h: 2.5 }, door: { w: 1.1, y0: 0.5, h: 1.7 } };   // 문 위 끝 2.2m — 접은 자세에서 내려오는 든 블록이 말린 셔터 아래를 지난다
function buildWjBooth(g) {
  const C = WJB.cab, D = WJB.door, W = put(new THREE.Group(), C.x, 0, C.z, g); W.name = 'WaterjetBooth';
  const hx = C.w / 2, hz = C.d / 2, top = C.h, body = std(0xb9c3cc, { metalness: 0.55, roughness: 0.35 }), frame = std(0x2f6f8f, { metalness: 0.4, roughness: 0.45 }), wall = (w, h, d, x, y, z, m = body) => put(box(w, h, d, m), x, y, z, W);
  wall(C.w, 0.3, C.d, 0, 0.15, 0, MAT.dark);   // 받침 (배수 · 칩 받이)
  wall(0.06, top - 0.3, C.d, -hx + 0.03, 0.3 + (top - 0.3) / 2, 0);   // 서쪽 벽
  wall(C.w, top - 0.3, 0.06, 0, 0.3 + (top - 0.3) / 2, -hz + 0.03);   // 북쪽 벽
  wall(C.w, 0.6, 0.06, 0, 0.6, hz - 0.03); wall(C.w, top - 1.7, 0.06, 0, 1.7 + (top - 1.7) / 2, hz - 0.03);   // 남쪽 벽 — 가운데 관찰창
  for (const sx of [-1, 1]) wall(0.3, 0.8, 0.06, sx * (hx - 0.15), 1.3, hz - 0.03);
  put(box(C.w - 0.6, 0.8, 0.03, MAT.glass, false), 0, 1.3, hz - 0.03, W);
  wall(C.w, 0.08, C.d, 0, top - 0.04, 0);   // 지붕
  const sw = (C.d - D.w) / 2;   // 동쪽(문) 면
  for (const s of [-1, 1]) wall(0.06, top - 0.3, sw, hx - 0.03, 0.3 + (top - 0.3) / 2, s * (D.w / 2 + sw / 2));
  wall(0.06, D.y0 - 0.3, D.w, hx - 0.03, 0.3 + (D.y0 - 0.3) / 2, 0); wall(0.06, top - D.y0 - D.h, D.w, hx - 0.03, D.y0 + D.h + (top - D.y0 - D.h) / 2, 0);
  const door = put(new THREE.Group(), hx + 0.04, D.y0 + D.h, 0, W), shutter = put(new THREE.Group(), 0, 0, 0, door);   // 롤업 셔터
  put(box(0.05, D.h + 0.06, D.w + 0.06, frame), 0, -(D.h + 0.06) / 2, 0, shutter); put(box(0.02, 0.35, 0.5, MAT.glass, false), 0.03, -D.h * 0.38, 0, shutter);
  put(cyl(0.08, 0.08, D.w + 0.12, frame, 14), 0.04, top - D.y0 - D.h + 0.02, 0, door).rotation.x = PI / 2;   // 셔터 드럼: 캐빈 윗면 위
  // 회전 고정구 (블록을 놓는 자리) · 워터젯 노즐 헤드 (위에서 내려와 교차홀마다)
  const fx = WJB.fix.x - C.x, fz = WJB.fix.z - C.z;
  put(cyl(0.07, 0.09, WJB.fix.y - 0.35, MAT.steel, 12), fx, 0.3 + (WJB.fix.y - 0.35) / 2, fz, W);
  const fixture = put(new THREE.Group(), fx, WJB.fix.y, fz, W); fixture.name = 'BoothFixture';
  put(cyl(0.26, 0.26, 0.05, frame, 24), 0, -0.025, 0, fixture);
  const head = put(new THREE.Group(), fx - 0.1, 1.85, fz, W); put(box(0.14, 0.18, 0.14, MAT.accent), 0, 0, 0, head);
  const nozzle = put(new THREE.Group(), 0, -0.09, 0, head); put(cyl(0.012, 0.02, 0.32, MAT.steel, 8), 0, -0.16, 0, nozzle);
  put(box(0.06, 0.5, 0.06, MAT.steel), 0, 0.33, 0, head);   // 노즐 상하축
  const lightMat = emis(0x9fe8ff, 0.2); put(box(0.8, 0.03, 0.25, lightMat, false), 0, top - 0.12, 0, W);
  const spray = put(makeSparks(0xc8f3ff, 90, 0.03), 0, 0, 0, W);
  const mc = put(new THREE.Group(), -0.2, top, -0.3, W); put(box(0.6, 0.4, 0.5, frame), 0, 0.2, 0, mc);   // 미스트 집진기
  const lamp = put(new THREE.Group(), hx - 0.12, top, -hz + 0.12, W); put(cyl(0.02, 0.02, 0.3, MAT.dark, 6), 0, 0.15, 0, lamp);
  const lampMats = [0x3ddc84, 0xf5b82e, 0xff5a5a].map((c, k) => { const m = emis(c, 0.25); put(cyl(0.05, 0.05, 0.09, m, 12), 0, 0.34 + k * 0.095, 0, lamp); return m; });
  const screen = emis(0x3ddc84, 1.2), hmi = put(new THREE.Group(), hx + 0.12, 1.4, hz - 0.12, W); hmi.rotation.y = PI / 2;   // 동쪽 면 남쪽 끝 (문 옆)
  put(box(0.36, 0.3, 0.14, MAT.dark), 0, 0, 0, hmi); put(box(0.3, 0.22, 0.02, screen, false), 0, 0.01, 0.08, hmi);
  // 고압 인텐시파이어 펌프 유닛 (서쪽 · 캐빈과 배관)
  const U = put(new THREE.Group(), -hx - 0.45, 0, 0, W); U.name = 'WaterjetPump';
  put(box(0.7, 1.0, 1.1, std(0x3c6e9e, { metalness: 0.3, roughness: 0.5 })), 0, 0.5, 0, U);
  put(cyl(0.09, 0.09, 0.7, MAT.steel, 12), 0, 1.15, -0.2, U).rotation.x = PI / 2;   // 증압 실린더
  const gaugeMat = emis(0x3ddc84, 1.2), gauge = put(new THREE.Group(), 0.36, 0.8, 0.3, U); put(cyl(0.06, 0.06, 0.04, MAT.dark, 14), 0, 0, 0, gauge).rotation.z = PI / 2; put(box(0.01, 0.08, 0.08, gaugeMat, false), 0.025, 0, 0, gauge);
  return { root: W, door, shutter, fixture, head, nozzle, lightMat, spray, lampMats, screen, gaugeMat, doorK: 0 };
}
// 밀폐 세척기 (로봇 투입형 — 고압 분사 세척 · 랜스 분사 세척 · 열풍 건조 · 디버링은 워터젯 부스) + 동쪽 탱크·필터 유닛 · 지붕 미스트 집진기 · 경광등 · HMI
// 셀 남동쪽(캐빈 x 1.5 ~ 3.7, z 1.1 ~ 3.1 · 셀 로컬): 문(서쪽 · 폭 1.8m)이 위로 열리면 이송 로봇이 고정구에 블록을 넣고 뺀다
// 이송 로봇(WASH.robot)은 AMR 정남쪽 1.5m · 0.4m 받침대 위 — 받침 가장자리가 AMR 통로(±0.475m)에서 0.7m · AMR 블록(뒤 · 북쪽) · 부스(서쪽 1.8m) · 세척기(동쪽 1.9m)를 돌아 가며
export const WASH = { robot: { x: 0, z: 1.5, y: 0.4 }, fix: { x: 1.8, y: 0.98, z: 2.1 }, cab: { x: 2.6, z: 2.1, w: 2.2, d: 2.0, h: 2.4 }, door: { w: 1.8, y0: 0.45, h: 1.5 } };   // 문 폭 1.8m — 로봇이 문을 18° 비스듬히 보아 든 블록 모서리가 옆판 쪽으로 쓸린다
const WASH_MAT = { body: std(0xc9ced4, { metalness: 0.6, roughness: 0.35 }), frame: std(0x5a6470, { metalness: 0.5, roughness: 0.4 }), tank: std(0x3c6e9e, { metalness: 0.3, roughness: 0.5 }) };
function buildWasher(g) {
  const C = WASH.cab, D = WASH.door, W = put(new THREE.Group(), C.x, 0, C.z, g); W.name = 'Washer';
  const hx = C.w / 2, hz = C.d / 2, top = C.h, wall = (w, h, d, x, y, z, m = WASH_MAT.body) => put(box(w, h, d, m), x, y, z, W);
  wall(C.w, 0.3, C.d, 0, 0.15, 0, MAT.dark);   // 받침 (배수 팬 · 칩 받이)
  wall(0.06, top - 0.3, C.d, hx - 0.03, 0.3 + (top - 0.3) / 2, 0);   // 동쪽 벽
  wall(C.w, top - 0.3, 0.06, 0, 0.3 + (top - 0.3) / 2, -hz + 0.03);   // 북쪽 벽
  // 남쪽 벽 (통로 쪽) — 가운데 관찰창
  wall(C.w, 0.6, 0.06, 0, 0.6, hz - 0.03); wall(C.w, top - 1.75, 0.06, 0, 1.75 + (top - 1.75) / 2, hz - 0.03);
  wall(0.5, 0.85, 0.06, -hx + 0.25, 1.325, hz - 0.03); wall(0.5, 0.85, 0.06, hx - 0.25, 1.325, hz - 0.03);
  put(box(C.w - 1.0, 0.85, 0.03, MAT.glass, false), 0, 1.325, hz - 0.03, W);
  wall(C.w, 0.08, C.d, 0, top - 0.04, 0);   // 지붕
  // 서쪽(문) 면: 문 열림 폭 D.w · 높이 D.y0 ~ D.y0 + D.h 둘레 판
  const sw = (C.d - D.w) / 2;
  for (const s of [-1, 1]) wall(0.06, top - 0.3, sw, -hx + 0.03, 0.3 + (top - 0.3) / 2, s * (D.w / 2 + sw / 2));
  wall(0.06, D.y0 - 0.3, D.w, -hx + 0.03, 0.3 + (D.y0 - 0.3) / 2, 0); wall(0.06, top - D.y0 - D.h, D.w, -hx + 0.03, D.y0 + D.h + (top - D.y0 - D.h) / 2, 0);
  // 수직 셔터 문 (닫힘: 문 열림을 막음 · 열림: 위로 D.h) · 관찰창
  // 롤업 셔터: 위쪽 드럼에 말려 올라간다 (열면 셔터 높이 → 5%) — 캐빈 위로 나오지 않게
  const door = put(new THREE.Group(), -hx - 0.04, D.y0 + D.h, 0, W);
  const shutter = put(new THREE.Group(), 0, 0, 0, door);
  put(box(0.05, D.h + 0.06, D.w + 0.06, WASH_MAT.frame), 0, -(D.h + 0.06) / 2, 0, shutter); put(box(0.02, 0.4, 0.7, MAT.glass, false), -0.03, -D.h * 0.38, 0, shutter);
  put(cyl(0.09, 0.09, D.w + 0.12, WASH_MAT.frame, 14), -0.04, top - D.y0 - D.h + 0.02, 0, door).rotation.x = PI / 2;   // 셔터 드럼: 캐빈 윗면 위 (문 위에 두면 든 블록을 접어 올릴 때 스친다)
  // 고정구 (세척 지그 테이블 — 블록을 놓는 자리) · 회전 고압 노즐 헤드 · 랜스 3개
  const fx = WASH.fix.x - C.x, fz = WASH.fix.z - C.z;
  put(cyl(0.08, 0.1, WASH.fix.y - 0.35, MAT.steel, 12), fx, 0.3 + (WASH.fix.y - 0.35) / 2, fz, W);
  const fixture = put(box(0.5, 0.05, 0.5, WASH_MAT.frame), fx, WASH.fix.y - 0.025, fz, W); fixture.name = 'WashFixture';   // 문 면에서 0.3m 안
  const nozzle = put(new THREE.Group(), fx, 1.95, fz, W); put(cyl(0.05, 0.05, 0.4, MAT.steel, 10), 0, 0.2, 0, nozzle);
  const hp = put(new THREE.Group(), 0, 0, 0, nozzle); for (let k = 0; k < 3; k++) { const a = put(cyl(0.015, 0.015, 0.22, MAT.steel, 6), 0, -0.02, 0, hp); a.rotation.z = 0.5; a.rotation.y = (k * 2 * PI) / 3; }
  const lance = put(new THREE.Group(), fx + 0.5, 1.9, fz, W);   // 랜스: 블록 옆에서 내려와 홀마다 찌른다
  for (const z of [-0.18, 0, 0.18]) put(cyl(0.012, 0.012, 0.7, MAT.steel, 6), 0, -0.35, z, lance);
  put(box(0.12, 0.08, 0.5, WASH_MAT.frame), 0, 0.02, 0, lance);
  const lightMat = emis(0x9fe8ff, 0.2); put(box(1.2, 0.03, 0.3, lightMat, false), 0, top - 0.12, 0, W);   // 실내 조명 (세척 중 밝아짐)
  const spray = put(makeSparks(0x9fe8ff, 80, 0.035), 0, 0, 0, W), steam = put(makeSparks(0xe6edf3, 40, 0.05), 0, 0, 0, W);
  // 지붕 미스트 집진기 + 덕트
  const mc = put(new THREE.Group(), 0.35, top, -0.3, W); put(box(0.8, 0.45, 0.6, WASH_MAT.frame), 0, 0.225, 0, mc); put(cyl(0.12, 0.12, 0.35, MAT.steel, 10), -0.55, 0.15, 0, mc).rotation.z = PI / 2;
  // 경광등 (북서 모서리 위) · HMI (남쪽 벽 서쪽 끝 바깥)
  const lamp = put(new THREE.Group(), -hx + 0.15, top, -hz + 0.15, W); put(cyl(0.02, 0.02, 0.3, MAT.dark, 6), 0, 0.15, 0, lamp);
  const lampMats = [0x3ddc84, 0xf5b82e, 0xff5a5a].map((c, k) => { const m = emis(c, 0.25); put(cyl(0.05, 0.05, 0.09, m, 12), 0, 0.34 + k * 0.095, 0, lamp); return m; });
  const screen = emis(0x3ddc84, 1.2), hmi = put(new THREE.Group(), -hx + 0.45, 1.45, hz + 0.12, W);
  put(box(0.5, 0.4, 0.18, MAT.dark), 0, 0, 0, hmi); put(box(0.42, 0.3, 0.02, screen, false), 0, 0.02, 0.1, hmi);
  // 동쪽 탱크·필터 유닛 (세척액 탱크 · 고압 펌프·모터 · 백필터 하우징 2개 · 차압계) — 배관으로 캐빈에
  const U = put(new THREE.Group(), hx + 0.5, 0, 0, W); U.name = 'WashFilterUnit';
  put(box(0.85, 0.9, 1.5, WASH_MAT.tank), 0, 0.45, 0, U);
  const pump = put(cyl(0.14, 0.14, 0.45, std(0x2b6cb0, { metalness: 0.4 }), 12), 0.05, 1.05, -0.45, U); pump.rotation.x = PI / 2;
  for (const z of [0.15, 0.5]) { put(cyl(0.14, 0.14, 0.6, MAT.steel, 14), 0.05, 1.2, z, U); put(cyl(0.16, 0.16, 0.06, MAT.dark, 14), 0.05, 1.52, z, U); }
  const gaugeMat = emis(0x3ddc84, 1.2), gauge = put(new THREE.Group(), -0.2, 1.2, 0.33, U); put(cyl(0.07, 0.07, 0.04, MAT.dark, 14), 0, 0, 0, gauge).rotation.x = PI / 2; put(box(0.1, 0.1, 0.01, gaugeMat, false), 0, 0, 0.025, gauge);
  for (const y of [0.75, 1.05]) put(cyl(0.03, 0.03, 0.5, MAT.steel, 8), -0.42, y, -0.2, U).rotation.z = PI / 2;   // 캐빈 ↔ 유닛 배관
  return { root: W, door, shutter, fixture, nozzle, hp, lance, lightMat, spray, steam, lampMats, screen, gaugeMat, doorK: 1 };
}
// 소재 식별·3D측정셀 (셀 로컬) — CMM 셀과 같은 꼴: 이송 6축은 AMR 정북 1.5m · 0.4m 받침대 위에서 AMR(남쪽)을 보고 선다
//  입구 ID 판독 게이트: 팔레트 RFID 안테나(기둥) · 주조 각인 판독 카메라 2대(DPM · OCR — 링 조명)
//  북서 3D 스캔 부스 (x −3.95 ~ −1.5, z −3.6 ~ −1.2 · 높이 2.6m): 차광 벽 · 동쪽 롤업 셔터 · 턴테이블(로드셀 저울 내장 · 문 면 0.55m 안) · 서쪽 받침대 위 스캔 로봇(협동 6축 + 구조광 스캐너)
//    지붕은 틀만 (위에서 안이 보이게) · 북동 모서리 밖 엣지 서버(CAD 베스트핏·가공 여유)
//  북동 격리 랙 (x 1.3 ~ 2.5): 위 칸 = 교체 작업대(불합격 소재를 놓고 같은 로트 예비 소재를 집는 자리) · 아래 칸 예비 소재 · 옆 빨간 격리 통
//    AMR이 x +2.3에서 두 가공 줄로 대각선으로 갈라져 나가므로 랙은 그 길에서 0.6m 넘게 떨어져 있다
//  남쪽 LIBS 재질 분석기 (x −1.3, z 2.3) — 남쪽 로봇(협동로봇 프로브 / 양팔 로봇)이 소재 윗면에 분석 프로브를 댄다
export const MATC = {
  robot: { x: 0, z: -1.5, y: 0.4 },
  booth: { x: -2.725, z: -2.4, w: 2.45, d: 2.4, h: 2.6 }, fix: { x: -2.05, y: 0.98, z: -2.2 }, door: { w: 1.8, y0: 0.45, h: 1.5 },   // 턴테이블은 문 면에서 0.55m 안 — 원소재(가공 전 블록)가 돌 때 문 밖으로 나오지 않게
  bot: { x: -3.3, z: -2.2, y: 0.8 },   // 스캔 로봇 루트 (부스 바닥 받침 0.3m + 협동로봇 받침대 0.5m 위 · 동쪽을 봄)
  rack: { x: 1.9, z: -2.3, y: 0.98 }, bin: { x: 1.9, z: -3.15 },
};
const MATL_MAT = { wall: std(0x39414b, { metalness: 0.3, roughness: 0.6 }), frame: std(0x8a96a3, { metalness: 0.6, roughness: 0.35 }), rack: std(0x2f6f8f, { metalness: 0.4, roughness: 0.45 }), red: std(0xd23b3b, { roughness: 0.6 }) };
function buildMatId(g) {
  const gate = gateOf(g, -1.75, 0x37e8ff, GATE_BOX);
  // 주조 각인 판독 카메라 2대 (게이트 윗보 · 링 조명) · 팔레트 RFID 안테나 (게이트 기둥 안쪽)
  for (const z of [-0.85, 0.85]) {
    const sc = put(new THREE.Group(), -1.75, 2.1, z, g); sc.rotation.x = z > 0 ? -0.6 : 0.6; sc.name = 'DpmReader';
    put(box(0.2, 0.14, 0.18, MAT.dark), 0, 0, 0, sc);
    put(new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), emis(0x37e8ff, 2)), 0, -0.08, z > 0 ? -0.04 : 0.04, sc).rotation.x = PI / 2;
  }
  for (const z of GATE_BOX) put(box(0.04, 0.4, 0.3, std(0xe9ecef, { roughness: 0.5 })), -1.75, 1.0, z - Math.sign(z) * 0.23, g).name = 'RfidAntenna';
  // 3D 스캔 부스: 차광 벽 · 지붕 틀 · 롤업 셔터 (동쪽)
  const B = MATC.booth, F = MATC.fix, W = put(new THREE.Group(), B.x, 0, B.z, g); W.name = 'ScanBooth';
  const dz = F.z - B.z, cab = cabin(W, B, MATC.door, 1, dz, { body: MATL_MAT.frame, wall: MATL_MAT.wall, frame: MATL_MAT.frame, roof: false, drumIn: true });   // 드럼은 부스 안 — 원소재(유압블록)를 든 채 접을 때 문 위를 지난다
  for (const sz of [-1, 1]) put(box(B.w, 0.06, 0.06, MATL_MAT.frame), 0, B.h - 0.03, sz * (cab.hz - 0.03), W);
  for (const sx of [-1, 1]) put(box(0.06, 0.06, B.d, MATL_MAT.frame), sx * (cab.hx - 0.03), B.h - 0.03, 0, W);
  put(box(1.2, 0.5, 0.03, MAT.glass, false), -0.2, 1.35, cab.hz + 0.01, W);   // 남쪽 관찰창 (차광 필름)
  const lightMat = emis(0xdff3ff, 0.35); put(box(1.0, 0.03, 0.2, lightMat, false), -0.2, B.h - 0.1, 0, W);
  // 턴테이블 (로드셀 저울 내장) — 위 원판이 돌며 소재를 보인다
  const fx = F.x - B.x;
  put(box(0.6, 0.35, 0.6, MAT.dark), fx, 0.3 + 0.175, dz, W);
  put(cyl(0.22, 0.24, 0.06, MAT.steel, 20), fx, 0.68, dz, W).name = 'LoadCell';
  put(cyl(0.07, 0.09, F.y - 0.05 - 0.71, MAT.steel, 12), fx, 0.71 + (F.y - 0.05 - 0.71) / 2, dz, W);
  const fixture = put(new THREE.Group(), fx, F.y, dz, W); fixture.name = 'ScanTable';
  put(cyl(0.3, 0.3, 0.05, MATL_MAT.rack, 28), 0, -0.025, 0, fixture);
  for (let k = 0; k < 3; k++) { const a = (k * 2 * PI) / 3; put(cyl(0.012, 0.012, 0.03, std(0xc8743a, { metalness: 0.8 }), 8), Math.cos(a) * 0.22, -0.01, Math.sin(a) * 0.22, fixture); }   // 기준 핀 (윗면에서 5mm만 — 소재 기준 구멍에 들어가는 높이)
  // 엣지 서버 (CAD 베스트핏 · 가공 여유 · 결함 AI) — 부스 북동 모서리 밖 · 경광등
  const srv = put(new THREE.Group(), cab.hx + 0.3, 0, -cab.hz + 0.3, W); srv.name = 'EdgeFitServer';
  put(box(0.45, 1.5, 0.5, MAT.dark), 0, 0.75, 0, srv); const screen = emis(0x3ddc84, 1.2); put(box(0.02, 0.32, 0.42, screen, false), 0.235, 1.25, 0, srv);
  const leds = emis(0x37e8ff, 1.5); for (let k = 0; k < 4; k++) put(box(0.02, 0.03, 0.3, leds, false), 0.235, 0.35 + k * 0.18, 0, srv);
  const lamp = put(new THREE.Group(), cab.hx - 0.12, B.h, -cab.hz + 0.12, W); put(cyl(0.02, 0.02, 0.3, MAT.dark, 6), 0, 0.15, 0, lamp);
  const lampMats = [0x3ddc84, 0xf5b82e, 0xff5a5a].map((c, k) => { const m = emis(c, 0.25); put(cyl(0.05, 0.05, 0.09, m, 12), 0, 0.34 + k * 0.095, 0, lamp); return m; });
  // 격리 랙: 위 칸 교체 작업대(RackShelf) · 아래 칸 예비 소재 · 옆 빨간 격리 통 (격리된 소재 수만큼 상자)
  const R = put(new THREE.Group(), MATC.rack.x, 0, MATC.rack.z, g); R.name = 'QuarantineRack';
  for (const sx of [-1, 1]) put(box(0.05, 1.3, 0.05, MATL_MAT.rack), sx * 0.57, 0.65, -0.42, R);   // 캔틸레버 랙: 기둥은 뒤(북쪽)에만 — 이송 6축이 앞(남서)에서 원소재(약 0.7m)를 넣고 뺀다
  put(box(1.14, 0.05, 0.05, MATL_MAT.rack), 0, 1.3, -0.42, R);
  put(box(1.14, 0.04, 0.84, MATL_MAT.rack), 0, 0.42, 0, R);
  const shelf = put(box(1.14, 0.05, 0.84, MATL_MAT.rack), 0, MATC.rack.y - 0.025, 0, R); shelf.name = 'RackShelf';
  for (const sx of [-0.22, 0.22]) put(box(0.36, 0.13, 0.3, MAT.raw), sx, 0.505, 0, R);   // 예비 소재
  put(box(1.14, 0.06, 0.04, emis(0xf5b82e, 0.6), false), 0, 1.36, -0.42, R);   // 교체 작업대 표시등
  const bin = put(new THREE.Group(), MATC.bin.x, 0, MATC.bin.z, g); bin.name = 'QuarantineBin';
  put(box(0.8, 0.06, 0.5, MATL_MAT.red), 0, 0.03, 0, bin);
  for (const sx of [-1, 1]) put(box(0.04, 0.5, 0.5, MATL_MAT.red), sx * 0.38, 0.28, 0, bin);
  for (const sz of [-1, 1]) put(box(0.8, 0.5, 0.04, MATL_MAT.red), 0, 0.28, sz * 0.23, bin);
  const qBoxes = [0, 1, 2, 3].map((k) => { const m = put(box(0.3, 0.12, 0.2, MAT.raw), (k % 2 ? 0.17 : -0.17), 0.12 + Math.floor(k / 2) * 0.13, 0, bin); m.visible = false; return m; });
  // LIBS 재질 분석기 (남쪽) — 분석기 본체 · 화면 · 프로브 케이블 거치대
  const L = put(new THREE.Group(), -1.3, 0, 2.3, g); L.name = 'LibsAnalyzer';
  put(box(0.6, 1.0, 0.5, std(0xe9ecef, { roughness: 0.45 })), 0, 0.5, 0, L); const libsScr = emis(0x58c4ff, 1.2); put(box(0.4, 0.26, 0.02, libsScr, false), 0, 0.82, -0.26, L);
  put(box(0.12, 0.3, 0.12, MAT.dark), 0.2, 1.15, 0, L);
  return { ...gate, gateTitle: '소재 식별 · 3D 측정', scanBooth: { root: W, door: cab.door, shutter: cab.shutter, doorK: 0, fixture, lightMat, lampMats, screen, leds }, qrack: { root: R, fixture: shelf, qBoxes }, libsScr };
}
// 초정밀 측정·리워크셀 (셀 로컬) — 디버링셀 이송 6축 자리를 남북으로 뒤집은 꼴: 이송 6축은 AMR 정북 1.5m · 0.4m 받침대 위에서 AMR(남쪽)을 보고 선다
//  북서 항온 측정실 (x −3.95 ~ −1.5, z −3.6 ~ −1.2): 유리벽 · 동쪽 면 롤업 셔터 · 화강암 정반 위 브리지형 CMM(브리지 x · 캐리지 z · 램 y) · 고정 지그(문 면 0.3m 안)
//    게이트 기둥(x −1.75, z −1.1)과 0.03m · 서쪽 바깥 정밀 공조기 · 북동 모서리 밖 CMM 제어반 — 측정·각인 때만 브리지가 지그 위로, 그 밖은 서쪽 끝(park)
//  북동 리워크 머시닝센터 (x 1.5 ~ 3.7, z −3.2 ~ −1.2): 서쪽 면 자동 셔터 · 바이스(고정구) · 주축 머리 · 동쪽 칩 컨베이어 — AMR 나가는 길(z 0)에서 1.2m
export const CMMC = {
  robot: { x: 0, z: -1.5, y: 0.4 },
  room: { x: -2.725, z: -2.4, w: 2.45, d: 2.4, h: 2.6 }, fix: { x: -1.8, y: 0.98, z: -2.2 }, door: { w: 1.8, y0: 0.45, h: 1.5 },
  mc: { x: 2.6, z: -2.2, w: 2.2, d: 2.0, h: 2.4 }, mcFix: { x: 1.8, y: 0.98, z: -2.2 }, mcDoor: { w: 1.8, y0: 0.45, h: 1.5 },
  park: -3.3,   // 브리지 비킨 자리 (셀 로컬 x) — 이송 6축이 드나드는 동안
};
// 상자형 실·외함: 받침 · 문 반대 벽 · 북·남 벽 · 지붕 · 문 면(face +1 동쪽 / −1 서쪽)의 문 열림(D.w × D.h, 아래 D.y0 · 가운데 z dz) · 롤업 셔터(위 드럼에 말림)
function cabin(W, C, D, face, dz, m) {
  const hx = C.w / 2, hz = C.d / 2, top = C.h, wall = (w, h, d, x, y, z, mm = m.body, name) => { const o = put(box(w, h, d, mm, mm !== MAT.glass), x, y, z, W); if (name) o.name = name; return o; };
  wall(C.w, 0.3, C.d, 0, 0.15, 0, MAT.dark);
  wall(0.06, top - 0.3, C.d, -face * (hx - 0.03), 0.3 + (top - 0.3) / 2, 0, m.wall, m.wallName);
  for (const s of [-1, 1]) wall(C.w, top - 0.3, 0.06, 0, 0.3 + (top - 0.3) / 2, s * (hz - 0.03), m.wall, m.wallName);
  const fx = face * (hx - 0.03), z0 = dz - D.w / 2, z1 = dz + D.w / 2;
  wall(0.06, top - 0.3, z0 + hz, fx, 0.3 + (top - 0.3) / 2, (z0 - hz) / 2, m.wall, m.wallName); wall(0.06, top - 0.3, hz - z1, fx, 0.3 + (top - 0.3) / 2, (z1 + hz) / 2, m.wall, m.wallName);
  wall(0.06, D.y0 - 0.3, D.w, fx, 0.3 + (D.y0 - 0.3) / 2, dz, m.frame); wall(0.06, top - D.y0 - D.h, D.w, fx, D.y0 + D.h + (top - D.y0 - D.h) / 2, dz, m.frame);
  if (m.roof !== false) wall(C.w, 0.08, C.d, 0, top - 0.04, 0, m.roof ?? m.body);
  const door = put(new THREE.Group(), face * (hx + 0.04), D.y0 + D.h, dz, W), shutter = put(new THREE.Group(), 0, 0, 0, door);
  put(box(0.05, D.h + 0.06, D.w + 0.06, m.frame), 0, -(D.h + 0.06) / 2, 0, shutter); put(box(0.02, 0.4, 0.7, MAT.glass, false), face * 0.03, -D.h * 0.38, 0, shutter);
  put(cyl(0.09, 0.09, D.w + 0.12, m.frame, 14), m.drumIn ? -face * 0.2 : face * 0.04, m.drumIn ? top - D.y0 - D.h - 0.17 : top - D.y0 - D.h + 0.02, 0, door).rotation.x = PI / 2;   // 셔터 드럼: 바깥이면 외함 윗면 위 (문 위에 두면 든 소재를 접어 올릴 때 스친다) · drumIn: 벽 안쪽 위
  return { door, shutter, hx, hz, top };
}
const CMM_MAT = { frame: std(0x8a96a3, { metalness: 0.6, roughness: 0.35 }), granite: std(0x3b3f45, { roughness: 0.35, metalness: 0.1 }), bridge: std(0xe4e8ec, { roughness: 0.35, metalness: 0.2 }), vmc: std(0xd9dde2, { roughness: 0.4, metalness: 0.3 }), vmcTrim: std(0x2f6f8f, { metalness: 0.4, roughness: 0.45 }) };
function buildCMM(g) {
  const gate = gateOf(g, -1.75, 0x58c4ff, GATE_BOX), R = CMMC.room, F = CMMC.fix;
  // 항온 측정실: 유리벽(알루미늄 기둥) · 동쪽 롤업 셔터 · 지붕은 틀만 (위에서 안이 보이게) · 실내 조명 · 공조 덕트
  const W = put(new THREE.Group(), R.x, 0, R.z, g); W.name = 'MetrologyRoom';
  const dz = F.z - R.z, cab = cabin(W, R, CMMC.door, 1, dz, { body: CMM_MAT.frame, wall: MAT.glass, wallName: 'RoomGlass', frame: CMM_MAT.frame, roof: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.06, R.h - 0.3, 0.06, CMM_MAT.frame), sx * (cab.hx - 0.03), 0.3 + (R.h - 0.3) / 2, sz * (cab.hz - 0.03), W);
  for (const sz of [-1, 1]) put(box(R.w, 0.06, 0.06, CMM_MAT.frame), 0, R.h - 0.03, sz * (cab.hz - 0.03), W);
  for (const sx of [-1, 1]) put(box(0.06, 0.06, R.d, CMM_MAT.frame), sx * (cab.hx - 0.03), R.h - 0.03, 0, W);
  const lightMat = emis(0xdff3ff, 0.35); put(box(1.0, 0.03, 0.2, lightMat, false), -0.3, R.h - 0.08, 0, W);
  // 정밀 공조기 (서쪽 바깥 · 20 ± 1℃) + 천장 덕트
  const ac = put(new THREE.Group(), -cab.hx - 0.3, 0, -0.2, W); ac.name = 'PrecisionAC';
  put(box(0.5, 1.9, 1.0, std(0xc9ced4, { metalness: 0.3, roughness: 0.5 })), 0, 0.95, 0, ac); put(box(0.02, 0.5, 0.7, MAT.dark), -0.26, 1.3, 0, ac);
  put(box(0.3, 0.25, 1.0, CMM_MAT.frame), 0.45, R.h + 0.05, 0, ac);
  // 화강암 정반 (지그 x에서 서쪽으로) · 받침 · 정반 양옆 가이드 · 고정 지그(제로점 팔레트 · 기준 핀) · 기준구(점검용)
  const fx = F.x - R.x, tx0 = fx - 1.85, tx1 = fx + 0.2, tw = tx1 - tx0, tc = (tx0 + tx1) / 2;
  put(box(tw - 0.15, 0.55, 0.9, MAT.dark), tc, 0.275, dz, W);
  put(box(tw, 0.25, 1.1, CMM_MAT.granite), tc, 0.675, dz, W);
  for (const sz of [-1, 1]) put(box(tw, 0.04, 0.08, MAT.steel), tc, 0.82, dz + sz * 0.5, W);
  put(cyl(0.08, 0.1, F.y - 0.05 - 0.8, MAT.steel, 14), fx, 0.8 + (F.y - 0.05 - 0.8) / 2, dz, W);
  const fixture = put(box(0.5, 0.05, 0.45, CMM_MAT.frame), fx, F.y - 0.025, dz, W); fixture.name = 'CmmFixture';
  const pinMat = std(0xc8743a, { metalness: 0.8, roughness: 0.3 }); for (const sx of [-1, 1]) put(cyl(0.012, 0.012, 0.03, pinMat, 8), sx * 0.2, 0.015, 0.17 * sx, fixture);   // 기준 핀 (윗면에서 5mm)
  const ref = put(new THREE.Group(), tx0 + 0.18, 0.8, dz - 0.3, W); ref.name = 'ReferenceSphere'; put(cyl(0.015, 0.02, 0.14, MAT.steel, 8), 0, 0.07, 0, ref); put(mesh(new THREE.SphereGeometry(0.0125, 12, 8), MAT.machined), 0, 0.155, 0, ref);
  // 브리지 (x로 움직임) · 다리 z ±0.5 (정반 가장자리 가이드) · 윗보 2.12m · 캐리지 (z) · 램(y) · 터치 프로브
  const bridge = put(new THREE.Group(), CMMC.park - R.x, 0, dz, W); bridge.name = 'CmmBridge';
  for (const sz of [-1, 1]) put(box(0.14, 1.26, 0.12, CMM_MAT.bridge), 0, 0.8 + 0.63, sz * 0.5, bridge);
  put(box(0.18, 0.2, 1.24, CMM_MAT.bridge), 0, 2.12, 0, bridge);
  const car = put(new THREE.Group(), 0, 2.12, 0, bridge); put(box(0.26, 0.3, 0.22, MAT.accent), 0, 0, 0, car);
  const quill = put(new THREE.Group(), 0, 0.25, 0, car); quill.name = 'Quill';
  put(box(0.08, 1.0, 0.08, MAT.steel), 0, -0.45, 0, quill); put(box(0.06, 0.08, 0.06, MAT.dark), 0, -0.99, 0, quill);
  const tipMat = emis(0xff4d6d, 1.5); put(cyl(0.004, 0.004, 0.05, MAT.steel, 6), 0, -1.055, 0, quill); put(mesh(new THREE.SphereGeometry(0.01, 10, 8), tipMat), 0, -1.08, 0, quill);   // 탐침 끝 = 캐리지 − 0.83m (램 원점 +0.25)
  // CMM 제어반·측정 PC (측정실 북동 모서리 밖) · 실 온도 표시
  const ctl = put(new THREE.Group(), cab.hx + 0.3, 0, -cab.hz + 0.3, W); ctl.name = 'CmmController';
  put(box(0.45, 1.5, 0.5, MAT.dark), 0, 0.75, 0, ctl); const screen = emis(0x3ddc84, 1.2); put(box(0.02, 0.32, 0.42, screen, false), 0.235, 1.25, 0, ctl);
  const tempMat = emis(0x58c4ff, 1.2); put(box(0.02, 0.12, 0.3, tempMat, false), cab.hx + 0.01, R.h - 0.25, dz, W);
  const lamp = put(new THREE.Group(), cab.hx - 0.12, R.h, -cab.hz + 0.12, W); put(cyl(0.02, 0.02, 0.3, MAT.dark, 6), 0, 0.15, 0, lamp);
  const lampMats = [0x3ddc84, 0xf5b82e, 0xff5a5a].map((c, k) => { const m = emis(c, 0.25); put(cyl(0.05, 0.05, 0.09, m, 12), 0, 0.34 + k * 0.095, 0, lamp); return m; });
  return { ...gate, gateTitle: 'CMM 판정', room: { root: W, door: cab.door, shutter: cab.shutter, doorK: 0, fixture, lightMat, lampMats, tempMat }, bridge, car, quill, tipMat, screen, rwMc: buildReworkMC(g) };
}
const MC_HEAD_UP = 2.15;   // 주축 머리 원점 높이 (공구 끝 1.79m — 이송 6축 손목이 바이스 위로 들어와도 닿지 않게)
// 리워크 머시닝센터 (로봇 투입형 소형 수직 머시닝센터): 서쪽 자동 셔터 · 바이스(고정구) · 컬럼·주축 머리(동쪽에서 바이스 위로) · 관찰창 · 칩 컨베이어 · 절삭유 탱크 · 경광등 · CNC 조작반
function buildReworkMC(g) {
  const C = CMMC.mc, D = CMMC.mcDoor, W = put(new THREE.Group(), C.x, 0, C.z, g); W.name = 'ReworkVMC';
  const cab = cabin(W, C, D, -1, 0, { body: CMM_MAT.vmc, wall: CMM_MAT.vmc, frame: CMM_MAT.vmcTrim });
  put(box(C.w - 0.9, 0.7, 0.03, MAT.glass, false), 0, 1.35, cab.hz + 0.01, W);   // 남쪽 관찰창
  const fx = CMMC.mcFix.x - C.x;
  put(box(0.7, CMMC.mcFix.y - 0.35 - 0.12, 0.6, MAT.dark), fx + 0.1, 0.35 + (CMMC.mcFix.y - 0.47) / 2, 0, W);   // 테이블 받침 (새들)
  put(box(0.8, 0.07, 0.55, MAT.steel), fx + 0.1, CMMC.mcFix.y - 0.085, 0, W);   // 테이블
  const fixture = put(box(0.5, 0.05, 0.4, CMM_MAT.vmcTrim), fx, CMMC.mcFix.y - 0.025, 0, W); fixture.name = 'McFixture';   // 바이스 (블록·커버를 놓는 자리)
  const col = put(box(0.5, C.h - 0.5, 0.6, CMM_MAT.vmcTrim), cab.hx - 0.4, 0.35 + (C.h - 0.5) / 2, 0, W); col.name = 'McColumn';
  const head = put(new THREE.Group(), fx, MC_HEAD_UP, 0, W); head.name = 'McHead';
  put(box(1.2, 0.28, 0.32, CMM_MAT.vmcTrim), 0.5, 0, 0, head); put(box(0.26, 0.34, 0.26, MAT.dark), 0, -0.05, 0, head);   // 컬럼 앞 Z축 슬라이드에서 바이스 위로 · 주축 하우징
  const spindle = put(new THREE.Group(), 0, -0.22, 0, head); put(cyl(0.05, 0.05, 0.08, MAT.steel, 12), 0, 0, 0, spindle); put(cyl(0.012, 0.012, 0.1, MAT.machined, 8), 0, -0.09, 0, spindle);   // 공구 끝 = 머리 − 0.36m
  const coolant = put(makeSparks(0x9fe8ff, 40, 0.035), 0, 0, 0, W), chips = put(makeSparks(0xd8dde2, 30, 0.03), 0, 0, 0, W);
  const conv = put(new THREE.Group(), cab.hx + 0.3, 0, 0.2, W); conv.name = 'ChipConveyor';
  put(box(0.5, 0.5, 1.2, std(0x5a6470, { metalness: 0.4 })), 0, 0.25, 0, conv); put(box(0.4, 0.6, 0.3, MAT.dark), 0, 0.75, -0.55, conv);
  put(box(0.5, 0.45, 0.6, std(0x3c6e9e, { metalness: 0.3, roughness: 0.5 })), cab.hx + 0.3, 0.225, -0.6, W);   // 절삭유 탱크
  const screen = emis(0x58c4ff, 1.2), hmi = put(new THREE.Group(), cab.hx - 0.35, 1.45, cab.hz + 0.12, W);
  put(box(0.5, 0.45, 0.18, MAT.dark), 0, 0, 0, hmi); put(box(0.42, 0.32, 0.02, screen, false), 0, 0.02, 0.1, hmi);
  const lamp = put(new THREE.Group(), -cab.hx + 0.15, C.h, -cab.hz + 0.15, W); put(cyl(0.02, 0.02, 0.3, MAT.dark, 6), 0, 0.15, 0, lamp);
  const lampMats = [0x3ddc84, 0xf5b82e, 0xff5a5a].map((c, k) => { const m = emis(c, 0.25); put(cyl(0.05, 0.05, 0.09, m, 12), 0, 0.34 + k * 0.095, 0, lamp); return m; });
  return { root: W, door: cab.door, shutter: cab.shutter, doorK: 0, fixture, head, spindle, coolant, chips, screen, lampMats, fx };
}
// 적응가공 가공기 상태 감시 장비 (js/machmon.js 센서와 같은 구성): 공구 검사 카메라 · 3축 가속도계·AE·베어링 온도(주축 머리) · 절삭유 유량계
// · 레이저 공구 측정기 · 엣지 AI 박스(IPC — 이상 점수·RUL 계산 → 존 서버 · 공장 오케스트레이터) — 셀 설비 부모 기준
const CM_MAT = { body: std(0x1d2733, { metalness: 0.4 }), led: emis(0x37e8ff, 2.2), lens: std(0x0a0f14, { metalness: 0.9, roughness: 0.15 }), sensor: std(0xd8a13a, { metalness: 0.6 }), pipe: std(0x2b6cb0) };
function addCMSensors(g, def, parts) {
  const M = put(new THREE.Group(), 0, 0, 0, g); M.name = 'ConditionMonitoring';
  const dev = (parent, x, y, z) => { const o = put(new THREE.Group(), x, y, z, parent); return o; };
  const sensorPod = (parent, x, y, z) => { const o = dev(parent, x, y, z); put(cyl(0.025, 0.025, 0.05, CM_MAT.sensor, 10), 0, 0, 0, o); put(cyl(0.006, 0.006, 0.12, CM_MAT.body, 6), 0, 0.08, 0, o); return o; };   // 가속도계·AE·온도: 금색 센서 + 케이블
  const front = parts?.front ?? (def.type === 'mill5' ? -1.78 : def.type === 'turn' ? -2.08 : 0), side = parts?.side ?? (def.type === 'mill5' ? 1.85 : 2.01);   // 디버링셀 VF-2는 모델에서 잰 값 (buildXDrill)   // 기계 앞면(문) z · 오른쪽 옆면 x (UMC-1250 · ST-40 모델 실측, 셀 로컬)
  // 공구 검사 카메라: 문 위 앞판에서 안쪽 아래(공구 교환 위치)를 본다 · 링 조명
  const cam = dev(M, -1.25, def.type === 'turn' ? 2.2 : 2.55, front + 0.09);   // 문(x −0.55~0.65 · 열리면 오른쪽) 왼쪽 위 — 로봇이 드나드는 문 앞을 비운다
  put(box(0.12, 0.09, 0.16, CM_MAT.body), 0, 0, 0, cam); const ln = put(cyl(0.03, 0.03, 0.04, CM_MAT.lens, 12), 0, -0.05, 0.05, cam); ln.rotation.x = -0.6;
  put(new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16), CM_MAT.led), 0, -0.07, 0.07, cam).rotation.x = Math.PI / 2 - 0.6;
  // 주축 머리 센서: 머시닝센터 Head · 선반 Turret · 디버링 head (없으면 기계 위 앞쪽)
  const head = parts?.head ?? parts?.machine?.nodes?.Head ?? parts?.turret ?? parts?.machine?.nodes?.Turret ?? null;
  if (head) { sensorPod(head, 0.12, 0.05, 0.12); sensorPod(head, -0.12, 0.05, 0.12); sensorPod(head, 0, 0.12, -0.12); }
  else for (const x of [-0.3, 0, 0.3]) sensorPod(M, x, 2.2, front - 0.3);
  {
    // 절삭유 유량계 (기계 왼쪽 아래 배관) · 레이저 공구 측정기 (테이블 옆 — 문 안쪽)
    const fl = dev(M, -1.6, 0.35, front + 0.1); put(box(0.14, 0.14, 0.14, CM_MAT.pipe), 0, 0, 0, fl); put(cyl(0.025, 0.025, 0.5, std(0x9aa3ad, { metalness: 0.7 }), 8), 0, 0, 0, fl).rotation.z = Math.PI / 2; put(box(0.06, 0.04, 0.01, CM_MAT.led, false), 0, 0.04, 0.075, fl);
    const ls = dev(M, -1.25, 1.0, front + 0.06);   // 레이저 공구 측정기 (앞면 왼쪽 · 공구 교환 위치와 같은 높이 표시) put(box(0.08, 0.12, 0.06, CM_MAT.body), 0, 0, 0, ls); put(box(0.08, 0.12, 0.06, CM_MAT.body), 0.2, 0, 0, ls); put(box(0.2, 0.004, 0.004, emis(0xff3030, 3), false), 0.1, 0.03, 0, ls);   // 송·수광부 + 레이저 빔
  }
  // 엣지 AI 박스 (IPC): 기계 오른쪽 옆면 · 상태 LED · 안테나 (5G 모뎀)
  const ipc = dev(M, side + 0.07, 1.3, front - 0.8);   // 오른쪽 옆면
  ipc.rotation.y = Math.PI / 2;   // 옆면에 붙여 바깥을 봄
  put(box(0.24, 0.3, 0.12, CM_MAT.body), 0, 0, 0, ipc); put(box(0.18, 0.04, 0.01, CM_MAT.led, false), 0, 0.08, 0.065, ipc); put(cyl(0.006, 0.006, 0.16, CM_MAT.body, 6), 0.08, 0.23, 0, ipc);
  return M;
}
const CM_TYPES = new Set(['mill5', 'turn', 'deburr']);
// 시리얼 마킹 장비 (js/serial.js) — 마킹 순간 표시등(markMat)이 밝아진다
//  label: 라벨 프린터·부착기(탬프 패드) + 2D 코드 판독기 — 문형 빔(셀 로컬 x · y)에 매단다 / laser: CMM 브리지 캐리지 옆 레이저 각인 헤드 + 판독기
const MARK_MAT = () => emis(0x37e8ff, 0.35);
function addLabeler(parent, x, y, zPrint, zRead) {
  const markMat = MARK_MAT();
  const pr = put(new THREE.Group(), x, y, zPrint, parent); pr.name = 'LabelPrintApply';
  put(box(0.28, 0.26, 0.3, MAT.white), 0, 0, 0, pr); put(box(0.2, 0.03, 0.01, markMat, false), 0, 0.05, 0.155, pr);
  put(cyl(0.015, 0.015, 0.18, MAT.steel, 8), 0, -0.22, 0, pr); put(box(0.12, 0.02, 0.09, MAT.dark), 0, -0.32, 0, pr);   // 탬프 실린더 · 패드
  const rd = put(new THREE.Group(), x, y, zRead, parent); rd.name = 'CodeReader';
  put(box(0.12, 0.1, 0.16, MAT.dark), 0, 0, 0, rd); put(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), markMat), 0, -0.06, 0, rd).rotation.x = Math.PI / 2;
  return markMat;
}
function addLaser(car) {
  const markMat = emis(0xff3b3b, 0.35);
  const lz = put(new THREE.Group(), 0.24, -0.06, 0, car); lz.name = 'LaserMarker';
  put(box(0.12, 0.2, 0.12, MAT.dark), 0, 0, 0, lz); put(cyl(0.025, 0.025, 0.04, MAT.steel, 10), 0, -0.12, 0, lz); put(box(0.04, 0.01, 0.04, markMat, false), 0, -0.145, 0, lz);
  return markMat;
}
const BUILD = { kit: buildKit, locate: buildLocate, spot: buildSpot, seal: buildSeal, hem: buildHem, mount: buildMount,
  vision: (g) => { const P = buildVision(g); return { ...P, markMat: addLabeler(P.auto, 0, 2.17, -0.72, 0.72) }; },   // C06 치수·외관검사 — 합격 즉시 QR 라벨
  rework: (g) => { const P = buildRework(g); return { ...P, markMat: addLabeler(g, 1.25, 1.79, -0.62, 0.55) }; },   // C07 재작업·재검 — 재검 합격 시 QR 라벨
  mill5: buildMill5, turn: buildTurn, deburr: buildDeburr, matid: buildMatId,
  cmm: (g) => { const P = buildCMM(g); return { ...P, markMat: addLaser(P.car) }; } };   // CMM 합격 즉시 DataMatrix 레이저 각인

// 투입 스테이션(투입 로봇셀) · 구분 적재장 — 두 Zone 공통 간이 형상
// 자재 투입존 (정밀조립Zone 투입 스테이션과 같은 구성): 혼류 제품별로 양쪽에 따로 보관 (첫 제품 +z · 둘째 제품 −z) — 판넬(후드·도어)은 빗살 거치대에 세워 2열 × 10장,
// 주조·단조 소재(유압블록·리어커버)는 팔레트에 4 × 3 × 2단 · 가운데는 AMR 지그 투입 위치 · 직교 3축 갠트리가 다음 투입 제품 쪽에서 집어 지그에 내려놓는다
// 자재 투입 로봇셀 배치 (js/loader.js · 셀 로컬 · AMR 정차 = 원점): 실제 라인처럼 자재를 용기째 공급 — 원자재 하역(지게차 · 북쪽) 쪽 북쪽(side −1) 한 줄에 제품마다 용기 2자리(쓰는 중 · 대기)
//  · 유연생산 후드 · 도어: 전용 패널 랙(철제 · 빗살 칸에 세워 10장 · 칸 14cm — 후드 판 두께 약 0.12m) · 랙 받침(0.55m) 위 · 앞 칸이 레일에서 1m
//    첫 셀(C01)이 북쪽 줄이라 AMR이 투입구를 나가 북동쪽으로 간다 — 랙 4자리를 서쪽(x −4.5 ~ 1.9)에 · 서쪽 끝은 Zone AMR 출동 차로(x −5.6)에서 1m
//  · 적응가공 유압블록(알루미늄 소재 큐브) · 리어커버(다이캐스팅 소재): 포켓 트레이 적층 팔레트 — 블록 2 × 2 × 3층 · 커버 3 × 2 × 2층 (12개)
//    층이 비면 로봇이 빈 트레이를 서쪽 끝 빈 트레이 스택으로 옮긴다 (스택은 지게차가 회수)
export const SRC_GEO = {
  side: -1, rackY: 0.55, z: 2.8,
  dx: (Z) => (Z.key === 'flex' ? -1.6 : 0),   // 레일·바닥 기준 (용기 자리는 conts가 따로)
  rail: (Z) => (Z.key === 'flex' ? [-3.75, 1.4] : [-1.6, 3.5]),
  stack: { x: -3.35 },   // 적응가공 빈 트레이 스택 (서쪽 끝 — 동쪽은 소재 식별셀 스캔 부스)
  // 제품 k(i번째)의 용기 2자리: { x, z, slots(채우는 순서 · 꺼내는 것은 마지막), per(층당) , trays(층마다 트레이 높이) , C }
  conts(k, i) {
    const sd = SRC_GEO.side, [L, D, H] = PRODUCT_DIM[k];
    if (k === 'hood' || k === 'door') {
      const xs = k === 'hood' ? [-3.75, -1.85] : [-0.1, 1.4];
      return xs.map((x) => { const slots = []; for (let r = 9; r >= 0; r--) slots.push({ x, y: SRC_GEO.rackY + 0.14 + D / 2, z: sd * (2.5 + r * 0.14) }); return { x, z: sd * 3.13, w: L + 0.2, slots, per: 0, C: 10, panel: true, h: H }; });   // 랙 안쪽 폭 = 판 길이 + 8cm (기둥 사이로 뽑는다)
    }
    const T = k === 'hblock' ? { xs: [-1.6, 0.0], nx: 2, nz: 2, ly: 3 } : { xs: [1.75, 3.5], nx: 3, nz: 2, ly: 2 };
    const px = L + 0.08, pz = D + 0.08, lp = 0.05 + H + 0.02, base = 0.15, per = T.nx * T.nz;
    return T.xs.map((x) => {
      const slots = [], trays = [];
      for (let l = 0; l < T.ly; l++) { trays.push(base + l * lp + 0.025); for (let rz = 0; rz < T.nz; rz++) for (let cx = 0; cx < T.nx; cx++) slots.push({ x: x + (cx - (T.nx - 1) / 2) * px, y: base + l * lp + 0.05, z: sd * (SRC_GEO.z + ((T.nz - 1) / 2 - rz) * pz) }); }   // 층마다 먼 줄부터
      return { x, z: sd * SRC_GEO.z, w: T.nx * px + 0.06, d: T.nz * pz + 0.06, slots, per, trays, C: per * T.ly, panel: false, h: H + 0.04 };
    });
  },
};
const SRC_SIDE = 20;   // 제품별 투입구 재고 상한 (sim.js ZONE_SRC.cap = 두 제품 합) — 용기 2자리에 나눠 보인다
function buildPort(g, Z, kind) {
  if (kind === 'src') {   // 자재 투입 로봇셀 (js/loader.js · 배치는 SRC_GEO): 북쪽 한 줄에 제품마다 용기 2자리 · 그 앞 주행 레일 위 고가반 6축 · 남쪽은 비움(라이트커튼)
    const panel = !!(Z.products.hood || Z.products.door), sd = SRC_GEO.side, R = SRC_GEO.rail(Z), x0 = R[0] - (panel ? 1.2 : 2.85), x1 = R[1] + (panel ? 1.1 : 1.1), cx = (x0 + x1) / 2, W = x1 - x0;
    put(box(W, 0.06, 7.2, MAT.dark), cx, 0.03, sd * 1.2, g);
    put(box(W, 0.01, 1.5, MAT.lane), cx, 0.065, 0, g);
    const L = buildLoader(g, KIT, { side: sd, changer: false, railX: R, tools: [{ key: 'tool', kind: panel ? 'vacuum' : 'jaw' }] });
    for (const x of [x0 + 0.1, x1 - 0.1]) { put(box(0.07, 1.5, 0.07, MAT.yellow ?? MAT.accent), x, 0.85, -sd * 0.95, g); put(box(0.02, 1.4, 0.02, emis(0xff3b3b, 0.6), false), x, 0.85, -sd * 0.9, g); }   // 남쪽(열린 면) 라이트커튼 송·수광기
    const frame = std(0x6b7782, { metalness: 0.5, roughness: 0.4 }), trayMat = std(0x2f5d8a, { roughness: 0.6 }), conts = {};
    Object.keys(Z.products).forEach((k, i) => {
      conts[k] = SRC_GEO.conts(k, i).map((C) => {
        const tint = put(new THREE.Mesh(new THREE.PlaneGeometry(C.w + 0.1, 1.7), new THREE.MeshBasicMaterial({ color: PC[k], transparent: true, opacity: 0.32, depthWrite: false })), C.x, 0.07, C.z, g); tint.rotation.x = -PI / 2;
        const out = { ...C, trayM: [] };
        if (C.panel) {   // 전용 패널 랙: 받침(0.55m · 위치 핀) · 철제 틀 · 빗살 칸 · 포크 포켓
          const RY = SRC_GEO.rackY;
          put(box(C.w, RY, 1.5, frame), C.x, RY / 2, C.z, g); put(box(C.w, 0.04, 1.5, MAT.steel), C.x, RY + 0.06, C.z, g);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const h = sz === sd ? 1.25 : 0.35; put(box(0.05, h, 0.05, MAT.dark), C.x + sx * (C.w / 2 - 0.03), RY + 0.04 + h / 2, C.z + sz * 0.72, g); }   // 뒤 기둥은 높게 · 앞(로봇 쪽) 기둥은 빗살 높이까지 — 뽑는 판재가 지나간다
          put(box(C.w, 0.05, 0.05, MAT.dark), C.x, RY + 1.28, C.z + sd * 0.72, g);   // 뒤 가로대 (앞은 열림 — 로봇이 꺼냄)
          for (const x of [-C.w / 2 + 0.05, C.w / 2 - 0.05]) { put(box(0.05, 0.06, 1.45, MAT.dark), C.x + x, RY + 0.11, C.z, g); for (let j = 0; j <= 10; j++) put(box(0.02, 0.3, 0.012, MAT.accent), C.x + x, RY + 0.23, C.z - 0.7 + j * 0.14, g); }
        } else {   // 포켓 트레이 적층 팔레트
          put(box(C.w, 0.15, C.d, MAT.pallet), C.x, 0.075, C.z, g);
          out.trayM = C.trays.map((y) => put(box(C.w, 0.05, C.d, trayMat), C.x, y, C.z, g));
        }
        return out;
      });
      put(textPlane([Z.products[k].label], 1.8, 0.45, hex(PC[k])), (conts[k][0].x + conts[k][1].x) / 2, 0.08, sd * 4.2, g);
    });
    let pile = null;
    if (!panel) {   // 빈 트레이 스택 (서쪽 끝)
      const S = SRC_GEO.stack; put(box(1.75, 0.15, 1.55, MAT.pallet), S.x, 0.075, sd * SRC_GEO.z, g);
      pile = Array.from({ length: 6 }, (_, j) => { const m = put(box(1.68, 0.05, 1.5, trayMat), S.x, 0.175 + j * 0.052, sd * SRC_GEO.z, g); m.visible = false; return m; });
      put(textPlane(['빈 트레이'], 1.5, 0.38, 'rgba(230,237,243,0.9)'), S.x, 0.08, sd * 4.2, g);
    }
    return { auto: L.auto, loader: L, conts, pile };
  }
  if (Z.pack) {   // 포장·구분 적재: AMR 하역 자리 바닥판만 (팔레트·로봇은 ExtraZone.buildPack)
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
export const PRODUCT_DIM = { hood: [1.606, 0.555, 0.05], door: [1.25, 1.1, 0.05], hblock: [0.66, 0.62, 0.13], rcover: [0.46, 0.43, 0.19] };
export function makeProduct(kind) {
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
    // C06 NG 결함 자리 표시 (빨간 마커 — C07 보수가 끝나면 사라짐): 판넬 길이 방향(월드 x — C07 로봇이 보수하는 축과 같다)으로 u · 판넬 윗면 가운데 줄
    const D = item.ngDefect, mk0 = m.userData.ngMark;
    if (D && !D.fixed) {
      const mk = mk0 ?? (m.userData.ngMark = put(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14), new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 1.2 })), 0, 0, 0, m));
      mk.visible = false; m.updateWorldMatrix(true, true); const bb = new THREE.Box3().setFromObject(m);
      mk.position.copy(m.worldToLocal(new THREE.Vector3(bb.min.x + (bb.max.x - bb.min.x) * D.u, bb.max.y + 0.006, (bb.min.z + bb.max.z) / 2))); mk.visible = true;
    } else if (mk0) mk0.visible = false;
    const L = m.userData.marks;   // 로봇이 실제로 작업한 자리에 남긴 용접 자국·실러 비드가 있으면 모델의 표시 대신 그것을 둔다 (레거시 수작업은 모델 표시)
    vis(S.welds, d.has('C03') && !L?.nuggets); vis(S.bead, d.has('C04') && !L?.bead.count); vis(S.hem, d.has('C05'));
    vis(S.hinges, (item.product === 'hood' ? d.has('C01') : d.has('C10')) && !L?.placed);
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
    for (const c of Object.values(Z.cells)) { const m = c.type === 'cmm', mi = c.type === 'matid', ki = c.type === 'kit';   // CMM 셀: 측정실(서쪽 x −4.0) · 머시닝센터 칩 컨베이어(동쪽 x 4.2) · 북쪽 z −3.7 · 남쪽 로봇 z 2.6 / 소재 식별셀: 스캔 부스(x −4.0) · 격리 랙(x 2.4) · LIBS(z 2.6)
      flat(m ? 8.2 : mi ? 6.6 : ki ? 6.2 : 5.0, m || mi ? 6.3 : ki ? 7.5 : c.type === 'deburr' ? 6.0 : 4.6, new THREE.MeshStandardMaterial({ color: PC[c.product] ?? PC.shared, transparent: true, opacity: 0.3, roughness: 0.9, depthWrite: false }), c.x + (m ? 0.1 : mi ? -0.75 : ki ? -0.2 : 0), c.z + (m || mi ? -0.55 : ki ? 1.45 : 0), 0.01); }   // C01: 남쪽 키팅 구역까지 (흐름 랙 z 5.05)
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
      if (Z.key === 'adapt' && CM_TYPES.has(c.type)) addCMSensors(equipmentRoot, c, parts);   // 가공기 상태 감시 장비 (js/machmon.js)
      const box2 = c.type === 'cmm' || c.type === 'matid', kit = c.type === 'kit', light = put(makeStackLight(), box2 ? -2.3 : kit ? -2.05 : -1.9, 0.15, box2 ? 1.3 : kit ? -1.95 : -1.6, g);   // CMM 측정실 · 소재 식별셀 스캔 부스가 북서를 차지 — 셀 경광등은 남서 (게이트 기둥 밖) · C01은 게이트 기둥(±1.5) 바깥 모서리
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
      if (kind === 'src') n.stockG = put(new THREE.Group(), 0, 0, 0, g);
      const el = document.createElement('div'); el.className = 'st-label xz';
      el.innerHTML = `<div class="nm"><span>${kind === 'src' ? '자재 투입 로봇셀' : Z.pack ? '포장·구분 적재 (제품별)' : '양품 구분 적재'}</span><i class="uid">${Z.uidp}-${kind === 'src' ? 'AS' : 'PL'}-01</i></div><div class="row"><span class="chip s-IDLE"></span></div>`;
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
      const stack = [], panel = q.product === 'hood' || q.product === 'door';
      let rack = null;
      if (panel) {
        // 외판(후드·도어)은 긁히지 않게 세워서 수직 슬롯 랙에 — 팔레트 위 랙(슬롯 24칸 · 간격 5cm · 패널 긴 쪽 = x) · 먼 쪽(북)부터 로봇 쪽으로 채운다 · 지게차가 랙째 출하
        const [L, H] = PRODUCT_DIM[q.product], pmat = std(PC[q.product], { metalness: 0.45, roughness: 0.4 }), z0 = z + q.sd * 0.6, dz = -q.sd * 0.05, RH = H + 0.25;
        // 랙 기둥: 먼 쪽(북) 두 개는 패널 높이까지 + 위 가로대 · 로봇 쪽은 낮게(0.45m — 팔레타이징 로봇 팔꿈치가 위로 지나간다, 로봇 쪽은 넣고 빼는 열린 면)
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const far = sz === q.sd, h = far ? RH : 0.45; put(box(0.06, h, 0.06, MAT.yellow ?? MAT.accent), x + sx * (L / 2 + 0.14), 0.18 + h / 2, z + sz * 0.66, g); }
        put(box(L + 0.34, 0.06, 0.06, MAT.yellow ?? MAT.accent), x, 0.18 + RH, z + q.sd * 0.66, g);
        for (const sx of [-1, 1]) put(box(0.08, 0.04, 1.3, MAT.dark), x + sx * (L / 2 + 0.04), 0.2, z, g);   // 바닥 슬롯 레일
        const tine = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.22, 0.008), MAT.dark, 50); let n = 0;
        for (let i = 0; i <= ZONE_FG_CAP; i++) for (const sx of [-1, 1]) tine.setMatrixAt(n++, new THREE.Matrix4().makeTranslation(x + sx * (L / 2 + 0.04), 0.33, z0 + (i - 0.5) * dz));   // 슬롯 빗살 (패널 양 끝)
        tine.count = n; g.add(tine);
        for (let i = 0; i < ZONE_FG_CAP; i++) { const b = put(box(L, H, 0.012, pmat), x, 0.22 + H / 2, z0 + i * dz, g); b.visible = false; stack.push(b); }
        rack = { L, H, mat: pmat };
      } else for (let i = 0; i < ZONE_FG_CAP; i++) { const lx = i % 4, lz = Math.floor(i / 4) % 2, ly = Math.floor(i / 8); const b = put(box(0.6, 0.45, 0.6, mat), x - 0.96 + lx * 0.64, 0.41 + ly * 0.47, z - 0.32 + lz * 0.64, g); b.visible = false; stack.push(b); }
      const lab = put(textPlane([`${Z.products[q.product].label} ${panel ? '슬롯 랙' : '팔레트'}`], 2.4, 0.4, 'rgba(255,255,255,0.9)'), x, 0.03, z + q.sd * 1.05, g);
      put(cyl(0.55, 0.6, 0.06, std(col, { roughness: 0.5 })), q.arm.x, 0.03, q.arm.z, g);   // 로봇 받침 (제품 색)
      const idx = Object.keys(this.pack).length;
      this.pack[q.product] = { ...q, armPos: q.arm, arm: null, stack, mat, col, rack, uid: `${Z.uidp}-RB-PL-${idx + 1}`, idx, lab };
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
      const held = P.rack ? put(box(P.rack.L, 0.012, P.rack.H, P.rack.mat), 0, 0, 0, this.packG) : put(box(0.6, 0.45, 0.6, P.mat), 0, (arm.native ? 1 : -1) * 0.25, 0, arm.tip); held.visible = false;   // 패널: 손끝 아래 (animPack이 눕힘 → 세움)
      arm.root.traverse((o) => { o.userData.stationId = `${this.Z.uidp}_PACK`; o.userData.robotIdx = P.idx; });
      const sp = idPlate(P.uid); sp.position.set(0, 3.0, 0); arm.root.add(sp);
      if (P.held && P.held !== held) P.held.removeFromParent();
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
        const u = Math.min(1, job.u), sk = this.Z.sink, idx = Math.min(ZONE_FG_CAP - 1, n), b = P.stack[idx].position, R = P.rack, top = BELT_Y + 0.45, up = R ? R.H / 2 + 0.01 : 0.25, app = R ? R.H / 2 + 0.55 : 0.95;   // 패널: 슬롯 위에서 세운 채 내려 끼운다
        const keys = [[0, home], [0.22, rel(sk.x, top + 0.6, sk.z)], [0.32, rel(sk.x, top, sk.z)], [0.42, rel(sk.x, top + 0.6, sk.z)], [0.7, rel(b.x, b.y + app, b.z)], [0.8, rel(b.x, b.y + up, b.z)], [0.9, rel(b.x, b.y + app, b.z)], [1, home]];
        const i = keys.findIndex((kf) => kf[0] >= u), [t0, p0] = keys[Math.max(0, i - 1)], [t1, p1] = keys[i];
        q = lerpA(p0, p1, ease(t1 > t0 ? (u - t0) / (t1 - t0) : 1));
        P.held.visible = u >= 0.32 && u < 0.8;
        if (R && P.held.visible) {   // 진공 그리퍼로 눕혀 집은 패널을 옮기는 동안(0.42 ~ 0.66) 세운다 — 손끝 바로 아래 · 긴 쪽 = x
          P.arm.pose(...q); const k = ease(Math.min(1, Math.max(0, (u - 0.42) / 0.24))), tp = this.packG.worldToLocal(P.arm.tip.getWorldPosition(new THREE.Vector3()));
          P.held.position.set(tp.x, tp.y - 0.006 - k * (R.H / 2), tp.z); P.held.rotation.set(k * PI / 2, 0, 0);
        }
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
    g.userData.zoneBoard = this.Z.key;   // 전광판을 누르면 Zone 대시보드 창 (main.js)
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
    const KP = s.zkpi; if (KP) {   // Zone 운영 분석 요약 (js/zonekpi.js) — 자세히는 전광판을 눌러 Zone 대시보드 창
      const o = KP.oee(Z.key), pr = KP.progress(Z.key), p = (v) => Math.round(v * 100);
      c.textAlign = 'right'; c.font = `700 30px ${F}`; c.fillStyle = o.OEE >= 0.65 ? '#3ddc84' : o.OEE >= 0.45 ? '#f5b82e' : '#ff8a5c';
      c.fillText(`OEE ${p(o.OEE)}%  (가동 ${p(o.A)} · 성능 ${p(o.P)} · 품질 ${p(o.Q)})  ·  교대 진행 ${p(pr.pct)}%`, W - 30, 40); c.textAlign = 'left';
    }
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
      if (this.Z.key === 'adapt' && CM_TYPES.has(c.def.type)) addCMSensors(c.equipmentRoot, c.def, c.parts);
      c.equipmentBlender = ready;
    }
  }

  // 새 실행(단계·라인 변경)마다 처음부터
  reset(modeKey = 'smart', seed = 1) {
    this.ctl = zoneCtl();   // 운영자 대화 지시 제어 (정지 · 셀 정지 · 속도 · 투입 정지) — 단계를 바꾸면 처음으로
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
      const T = cellT(c.def, modeKey);
      if (T != null) c.cycle = T * (c.def.cycleK ?? 1);   // 실제 작업 시간 (zonedefs.js T) — 로봇 대수 효과(cycleK)만 곱한다
      else if (this.Z.parallel) {   // 유연생산: 레시피 사이클(로봇 1대 기준) × 로봇 종류 배율 ÷ 대수 병렬 이득 — 레거시는 작업자(최대 2명)
        const n = legacy ? Math.max(1, Math.min(2, R[1] || 1)) : count, kf = legacy || !count || kind === 'none' ? 1 : ROBOT_KINDS[kind]?.factor ?? 1;
        c.cycle = (c.def.cycle * (MODE_MUL[modeKey] ?? 1) * kf) / (1 + PARALLEL_GAIN * Math.max(0, n - 1));
      } else c.cycle = c.def.cycle * (MODE_MUL[modeKey] ?? 1) * (c.def.cycleK ?? 1);   // cycleK: 공정 설계에서 바꾼 로봇 대수 효과 (js/zonerecipe.js · 기본 구성 = 1)
      if (c.parts.manualProps) c.parts.manualProps.forEach((p) => (p.visible = legacy));
      if (c.parts.auto) c.parts.auto.visible = !legacy;
      if (c.parts.manual) c.parts.manual.visible = legacy;
      if (legacy) {
        const n = Math.max(1, Math.min(2, count || 1));
        for (let i = 0; i < n; i++) { const w = makeWorker(); put(w, -0.6 + i * 1.2, 0, i ? 1.9 : -1.9, c.workersG); w.rotation.y = i ? PI : 0; }
        c.rb.textContent = `👷 작업자×${n}`;
        continue;
      }
      if ((!count || kind === 'none') && c.def.crew === 'repair') {   // C07 수리 부스: 통로 북쪽(−z)에 수리 작업자 1명 — AMR 위 패널 쪽을 보고 결함 자리로 옆걸음 (animCell)
        const w = makeWorker(); put(w, 0, 0, -1.05, c.workersG); w.userData.repair = true; c.rb.textContent = '👷 수리 작업자 · AI 결함 위치'; continue;
      }
      if (!count || kind === 'none') { c.rb.textContent = c.def.type === 'vision' ? '📷 비전·치수 게이지' : ''; continue; }
      const tend = c.def.type === 'mill5' || c.def.type === 'turn' || c.def.type === 'deburr';   // 머신텐딩 (디버링셀: 사선홀 머시닝센터)
      // CMM · 소재 식별셀: 남쪽 도킹 정면(x 0) 1대 — 북쪽은 이송 6축 · 측정실·리워크 머시닝센터 / 스캔 부스·격리 랙
      const slots = tend ? [[TEND.robot.x, TEND.robot.z, PI]] : c.def.type === 'cmm' || c.def.type === 'matid' ? [[0, 1.75, PI]] : c.def.type === 'kit' ? [[KITC.stops[0], KITC.sz * 1.75, 0], [KITC.stops[1], KITC.sz * 1.75, 0]] : [[-0.75, -1.75, 0], [-0.75, 1.75, PI], [0.95, -1.75, 0], [0.95, 1.75, PI]];
      if (c.def.type === 'hem') { slots[0] = [HEM.robot.x, HEM.robot.z, 0]; slots[1] = [HEM.roller.x, HEM.roller.z, PI]; }   // 둘째 대: 롤러 헤밍 고가반 6축 (앤빌 동쪽)
      if (c.def.type === 'hem') { put(box(0.45, HEM.robot.y - 0.06, 0.45, MAT.dark), HEM.robot.x, (HEM.robot.y + 0.06) / 2, HEM.robot.z, c.robotsG); put(box(0.75, HEM.roller.y - 0.06, 0.75, MAT.dark), HEM.roller.x, (HEM.roller.y + 0.06) / 2, HEM.roller.z, c.robotsG); }   // 롤러 로봇 받침대 (0.5m — 위팔이 앤빌 위 패널 모서리 위로 지나가게)   // 헤밍 로봇 받침대   // 헤밍: 프레스 앞(통로 쪽) 비스듬히 — AMR 위 패널과 프레스 베드 양쪽에 닿는 자리 (프레스 기둥 사이 앞쪽으로 팔이 들어간다)
      for (let i = 0; i < count; i++) {
        const roller = c.def.type === 'hem' && i === 1, r = roller ? heavyRobot(MAT.orange) : makeRobot(kind, MAT.orange);   // 롤러 헤밍 하중(약 1kN)·도달 거리 — 고가반 6축
        const [x, z, yaw] = slots[i];
        // 접촉 작업 셀의 협동로봇(UR20 도달 1.75m)은 셀 중심에서 1.25m — 툴을 세워 대상물 윗면에 손끝이 닿도록
        put(r.root, x, roller ? HEM.roller.y : c.def.type === 'hem' ? HEM.robot.y : kind === 'ammr' || kind === 'humanoid' ? 0.06 : kind === 'cobot' ? .5 : 0.15, kind === 'ammr' ? Math.sign(z) * AMMR.slotZ : kind === 'humanoid' ? Math.sign(z) * HUM_SLOT_Z : kind === 'cobot' && CELL_WORK[c.def.type] ? Math.sign(z) * 1.25 : z, c.robotsG); r.root.rotation.y = yaw;
        if (kind === 'ammr') r.slot = { x, z: Math.sign(z) * AMMR.slotZ };   // 접촉 작업 기본 자리 (ammrContact)
        if (r.arm?.native && !legacy) {   // 유연생산 공정 툴: 스폿용접 C건 · 실러 디스펜싱 건(+디스펜서까지 호스) · 패널 진공 그리퍼
          if (c.def.type === 'spot') { r.tool = attachSpotGun(r.arm); r.pwHomeAt = { x: x + 0.35, y: 1.35, z: Math.sign(z) * 0.85 }; }   // 대기: 자기 쪽 통로 경계 위 — 마주 보는 로봇과 용접 건이 셀 가운데 위에서 만나지 않고, 더 뒤로 접으면 위팔이 뒤쪽 펜스 난간(1.4m)에 닿는다
          else if (c.def.type === 'seal') { const s = attachSealGun(r.arm); if (s) { r.tool = s.tool; r.hoseFit = s.fitting; r.hose = makeHose(r.root); } }   // 호스는 로봇에 딸린 것 (로봇 로컬로 그린다)
          else if (roller) { r.tool = attachRollerHead(r.arm); r.roller = true; }
          else if (c.def.type === 'hem') r.tool = attachVacuumGripper(r.arm);
          else if (c.def.type === 'rework') { const s2 = attachSealGun(r.arm); if (s2) { r.tool = s2.tool; r.hoseFit = s2.fitting; r.hose = makeHose(r.root); } }   // NG 보수: 보수 토치·실러 노즐 (결함 자리에 대고 재용접 · 재도포 · 재헤밍)
          else if (c.def.type === 'kit') { r.held = holdPart(r.tip, 'bracket'); r.tool = r.held; }   // 키팅: 기본 그리퍼로 브래킷을 하나씩
          else if (c.def.type === 'matid') r.tool = attachLibsProbe(r.arm);   // 적응가공 소재 식별: LIBS 재질 분석 프로브 (3D 스캔은 스캔 부스 로봇)
          else if (c.def.type === 'cmm') r.tool = attachCmmPrepTool(r.arm);   // 측정 전 에어 블로·소재 온도 측정 · 1차 NG 접촉 리워크 (디버링 스핀들)
          else if (c.def.type === 'mount') { attachNutrunner(r.arm); r.held = holdPart(r.tip, 'hinge'); r.tool = r.held; }   // 정밀 장착: 그리퍼 + 너트러너 — 힌지를 놓고 그 자리에서 체결
        }
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
        if (tend && r.arm) r.anim = (busy, t, p) => { const M = c.parts.machine, dk = Math.min(M?.doorK ?? c.doorK ?? 1, M?.headHome ?? 1); if (busy) tendPose(r, cellTendQ(c.def.type, p), dk); else if (c.state !== 'BUSY') tendPose(r, 0, dk); };   // 디버링셀은 앞부분(TEND_END)에 머신텐딩   // 문이 열리고 스핀들 헤드가 맨 위(원점)로 올라간 뒤에 들어간다
        const sp = idPlate(c.robotUids[i]); sp.position.set(0, kind === 'ammr' ? 2.55 : 2.35, 0); r.root.add(sp); sp.visible = this.labelsOn ?? true; c.plates.push(sp);   // 로봇 위 ID 명판 (정밀조립 셀 로봇과 같은 모양 · 라벨 버튼으로 켜고 끔)
      }
      // 셀 설비에 딸린 이송 6축 (레시피 대수와 따로 · zonedefs aux): 받침대 위에서 AMR을 보고 서서, 팔을 세워 접은 자세(tuck·)로 몸을 돌려 역마다 드나든다 (xferPose)
      //  디버링셀: AMR 정남쪽 — AMR 지그 → 워터젯 부스(서쪽) → 세척기(동쪽) → AMR 지그 (XFER_SEQ)
      //  CMM 셀: AMR 정북쪽 — AMR 지그 → 측정실 지그(북서) → (리워크: 머시닝센터 바이스(북동) → 측정실) → AMR 지그 (js/cmmcell.js CMM_PLANS)
      const XS = c.parts.washer && c.parts.booth ? { A: WASH.robot, st: { booth: [c.parts.booth.fixture, WJB.fix.y, 'B'], wash: [c.parts.washer.fixture, WASH.fix.y, 'W'] } }
        : c.parts.room && c.parts.rwMc ? { A: CMMC.robot, st: { cmm: [c.parts.room.fixture, CMMC.fix.y, 'C'], mc: [c.parts.rwMc.fixture, CMMC.mcFix.y, 'M'] } }
        : c.parts.scanBooth && c.parts.qrack ? { A: MATC.robot, st: { scan: [c.parts.scanBooth.fixture, MATC.fix.y, 'S'], rack: [c.parts.qrack.fixture, MATC.rack.y, 'R'] } } : null;
      if (c.def.aux && XS) {
        const i = c.robots.length, r = makeRobot(c.def.aux[0], MAT.orange), A = XS.A;
        put(box(0.62, A.y, 0.62, MAT.dark), A.x, A.y / 2, A.z, c.robotsG);   // 받침대
        put(r.root, A.x, A.y, A.z, c.robotsG); r.root.rotation.y = Math.atan2(-A.x, -A.z);   // AMR 쪽을 본다
        r.root.updateWorldMatrix(true, true);
        // 경유점 (로봇 루트 기준): 집는 곳은 소재 가운데보다 로봇 쪽 G m (팔을 덜 뻗게 · 든 소재는 손끝에서 그만큼 바깥에 그린다 — tendPart와 같은 gripOff)
        // 높이는 머신텐딩(루트 0.15m)과 같은 공장 높이 — 받침대만큼 낮춘다 · 역 고정구는 윗면 + 블록 높이 0.13 + 2cm
        const G = 0.22, dy = A.y - 0.15, loc = (o) => r.root.worldToLocal(o.getWorldPosition(new THREE.Vector3())), toward = (v, k) => { const d = Math.hypot(v.x, v.z); return [v.x * (d - k) / d, v.z * (d - k) / d]; };
        const av = r.root.worldToLocal(c.robotsG.localToWorld(new THREE.Vector3(0, 0, 0))), [ax, az] = toward(av, G), [ox, oz] = toward(av, G + 0.35);
        // 문 앞(ent)은 고정구에서 0.75m — 든 블록(가로 0.66m)이 문 밖으로 다 나온 뒤에 팔을 접어 올린다 (0.48m면 블록 끝이 문 안에 걸린 채 올라가 문 윗부분에 닿는다)
        const st = (fix, fy) => { const v = loc(fix), d = Math.hypot(v.x, v.z), [tx, tz] = toward(v, G), [ex, ez] = toward(v, G + 0.75), y = fy + 0.025 + 0.15 - A.y; return { at: [tx, y, tz], ent: [ex, y + 0.12, ez], mid: [(v.x / d) * 0.7, y + 0.37, (v.z / d) * 0.7] }; };   // mid: 로봇에서 0.7m — 든 블록 끝이 문 면에서 떨어진 채 올라간다
        r.xferPts = { amr: [ax, TEND_PTS.amr[1] - dy, az], overA: [ox, TEND_PTS.over[1] - dy, oz] }; r.xTuck = { tuckA: 'amr' };
        for (const [k, [fix, fy, T]] of Object.entries(XS.st)) { const S = st(fix, fy); Object.assign(r.xferPts, { [k]: S.at, [`ent${T}`]: S.ent, [`mid${T}`]: S.mid }); r.xTuck[`tuck${T}`] = k; }
        r.xStations = Object.keys(XS.st);
        r.gripOff = G; r.swing = 0.12; r.xfer = true; r.kind ??= c.def.aux[0];
        r.anim = c.parts.washer ? (busy, t, p) => { if (busy) xferPose(r, washQ(p)); else if (c.state !== 'BUSY') xferPose(r, 0); }
          : (busy, t, p) => { const S = (c.parts.room ? cmmPlan : matlPlan)(c.item).seq; if (busy) xferPose(r, p, S); else if (c.state !== 'BUSY') xferPose(r, 0, S); };
        if (dark && !r.wristCameraAnchor && r.tip) { const cam = put(box(0.07, 0.05, 0.06, MAT.dark), 0.07, 0.02, 0, r.tip.parent); put(cyl(0.018, 0.018, 0.02, emis(0x37e8ff, 1.5), 10), 0, 0.035, 0, cam); r.wristCam = true; }
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });
        r.phase = i * 1.3; c.robots.push(r); c.robotUids.push(zoneRobotUid(this.Z, c.id, i));
        const sp = idPlate(c.robotUids[i]); sp.position.set(0, 2.35, 0); r.root.add(sp); sp.visible = this.labelsOn ?? true; c.plates.push(sp);
      }
      // 소재 식별셀 스캔 부스 로봇 (설비에 딸림 · zonedefs aux2): 부스 서쪽 받침대 위 협동로봇 + 구조광 스캐너 — 턴테이블 위 소재를 둘러 뷰마다 스캔 (scanBotPose)
      if (c.def.aux2 && c.parts.scanBooth) {
        const i = c.robots.length, r = makeRobot(c.def.aux2[0], MAT.orange), M2 = MATC.bot;
        put(r.root, M2.x, M2.y, M2.z, c.robotsG); r.root.rotation.y = PI / 2;   // 동쪽(턴테이블)을 본다
        if (r.arm?.native) r.tool = attachScanner(r.arm);
        r.scanBot = true; r.kind ??= c.def.aux2[0];
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });
        r.phase = i * 1.3; c.robots.push(r); c.robotUids.push(zoneRobotUid(this.Z, c.id, i));
        const sp = idPlate(c.robotUids[i]); sp.position.set(0, 1.9, 0); r.root.add(sp); sp.visible = this.labelsOn ?? true; c.plates.push(sp);
      }
      // C01 키팅 구역 피킹 로봇 (설비에 딸림 · zonedefs picker): 자동화 = 레일 위 협동로봇 · 피지컬AI = AMMR — 흐름 랙에서 다음 판넬 키트를 조립대 트레이에 담는다 (kitPickerPose)
      const PK = c.def.picker;
      if (PK && c.parts.kit) {
        const i = c.robots.length, pk = dark && PK[2] ? PK[2] : PK[0], r = makeRobot(pk, MAT.orange), ammr = pk === 'ammr';
        put(r.root, KITC.pick.place, ammr ? 0.06 : 0.6, KITC.sz * KITC.pick.z, c.robotsG); r.root.rotation.y = PI;   // 남쪽(흐름 랙)을 본다 (셀 로컬 −z)
        if (!ammr) put(box(0.6, 0.1, 0.5, MAT.dark), 0, -0.55, 0, r.root);   // 레일 캐리지 (협동로봇 받침대 아래)
        else r.slot = { x: KITC.pick.place, z: KITC.sz * KITC.pick.z };
        if (r.arm?.native || r.arms) r.held = holdPart(r.tip, 'bracket');   // 집은 브래킷 (AMMR은 왼손)
        r.kitPicker = true; r.kind ??= pk;
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });
        r.phase = i * 1.3; c.robots.push(r); c.robotUids.push(zoneRobotUid(this.Z, c.id, i));
        const sp = idPlate(c.robotUids[i]); sp.position.set(0, ammr ? 2.55 : 1.9, 0); r.root.add(sp); sp.visible = this.labelsOn ?? true; c.plates.push(sp);
      }
      c.rb.textContent = `🤖 ${ROBOT_SHORT[kind] ?? kind}×${count}${[c.def.aux && XS ? c.def.aux : null, c.def.aux2 && c.parts.scanBooth ? c.def.aux2 : null, PK && c.parts.kit ? [dark && PK[2] ? PK[2] : PK[0], 1, PK[4]] : null].filter(Boolean).map((A) => ` + ${ROBOT_SHORT[A[0]] ?? A[0]}×${A[1]} (${A[2]})`).join('')}`;
    }
  }

  // 자재 투입 로봇셀 용기 속 자재 (제품마다 용기 2자리): Blender 모델이 늦게 들어오므로 실행마다 다시 채운다 · 주물은 가공 전 소재 모양(Raw)만
  buildSrcStock() {
    const n = this.src; if (!n?.stockG) return;
    n.stockG.clear(); n.side = {}; n.split = {}; n.padDone = new Set(); n.padPending = null;
    const L = n.port.loader; for (const h of Object.values(L.held)) h.removeFromParent(); if (!L.r.arm.native && blenderOn()) loaderRobot(L); L.held = {};   // 실물 로봇 모델이 늦게 들어오면 그것으로
    const rawOnly = (m) => { const S = m.userData.stage; if (S?.raw) { S.raw.visible = true; if (S.mac) S.mac.visible = false; if (S.fin) S.fin.visible = false; } return m; };
    Object.keys(this.Z.products).forEach((k) => {
      const C = n.port.conts[k];
      for (const c of C) c.objs = c.slots.map((p) => { const m = rawOnly(makeProduct(k)); if (c.panel) m.rotation.x = SRC_GEO.side < 0 ? PI / 2 : -PI / 2; m.position.set(p.x, p.y, p.z); n.stockG.add(m); return m; });   // 판재: 윗면이 로봇(통로) 쪽을 보게 세움
      const held = rawOnly(makeProduct(k)), top = visibleTop(held); L.setHeld(k, held, top);
      if (!C[0].panel) L.setHeld(`pad:${k}`, box(C[0].w, 0.05, C[0].d, std(0x2f5d8a, { roughness: 0.6 })), 0.05);   // 빈 트레이
      n.side[k] = { C, top, panel: C[0].panel, h: C[0].h }; n.split[k] = {};
    });
    n.shown = null;
  }
  // 투입 로봇이 아직 적재 준비가 안 됨 — 화면(실물 로봇 모델 · 역기구학)이 있고 자동화·피지컬AI 단계일 때만 (헤드리스 시뮬레이션·레거시는 기다리지 않는다)
  loaderBusy() {
    const L = this.src?.port?.loader; if (!L?.r?.arm?.ik || this.mode === 'traditional' || !L.auto.visible) return false;
    return L.state !== 'ready';
  }
  // 다음 투입 제품 (평준화 누적값을 바꾸지 않고 미리 봄) — 로봇이 그 제품 자재에서 집는다
  peekNext() {
    const w = this.mix, keys = Object.keys(w).filter((k) => w[k] > 0), tot = keys.reduce((a, k) => a + w[k], 0) || 1;
    return keys.reduce((a, b) => ((this.mixAcc[b] ?? 0) + w[b] / tot > (this.mixAcc[a] ?? 0) + w[a] / tot ? b : a), keys[0]);
  }
  // 자재 투입 로봇셀 화면: 투입구 원재료(sim.zoneRaw)를 혼류 비율로 나눠 제품마다 용기 2자리(쓰는 중 · 대기)에 보이고, 로봇이 쓰는 용기에서 미리 꺼내 AMR 위에서 기다리다 적재(load) 동안 지그에 수평으로 내려놓는다
  //  적응가공 트레이 한 층이 비면 꺼내기 전에 빈 트레이를 스택으로 옮긴다
  animSrc(dts = 0) {
    const n = this.src, L = n?.port?.loader, s = this.sim; if (!n?.side || !L) return;
    const keys = Object.keys(this.Z.products), w = this.mix, tot = keys.reduce((a, k) => a + (w[k] || 0), 0) || 1;
    const buf = s?.zoneRaw?.[this.Z.key] ?? SRC_SIDE * 2;
    const cnt = {}; cnt[keys[0]] = Math.min(SRC_SIDE, Math.round(buf * (w[keys[0]] || 0) / tot)); cnt[keys[1]] = Math.min(SRC_SIDE, buf - cnt[keys[0]]);
    const c = n.occ && n.occ.state === 'load' && !c0cart(n.occ) ? n.occ : null, k = c ? Math.min(1, Math.max(0, 1 - c.timer / this.Z.load)) : null;
    let next = this.peekNext(); if (!cnt[next]) next = keys.find((x) => cnt[x] > 0) ?? null;
    const hold0 = L.holding, sp = {}; for (const p of keys) sp[p] = containerSplit(n.split[p], cnt[p] - (hold0 === p ? 1 : 0), n.side[p].C[0].C);
    const padKey = (p, j, m) => `${p}:${j}:${m}`;
    const pick = (p) => {
      const D = n.side[p], S = sp[p], j = S.act, m = S.c[j], cont = D.C[j], v = cont.slots[m - 1]; if (!v) return null;
      if (D.panel) return { x: v.x, y: v.y, z: v.z - SRC_GEO.side * D.top, kind: 'panel', rise: 0.38 };   // 빗살(0.3m) 위로 뽑는 높이
      const o = { x: v.x, y: v.y + D.h, z: v.z, kind: 'lying', rise: 0.4 };
      if (m < cont.C && m % cont.per === 0 && !n.padDone.has(padKey(p, j, m))) {   // 위 층 트레이가 비었음 → 먼저 빈 트레이 스택으로
        const y = cont.trays[m / cont.per], S2 = SRC_GEO.stack;
        o.pad = { key: `pad:${p}`, from: new THREE.Vector3(cont.x, y + 0.025, cont.z), to: new THREE.Vector3(S2.x, 0.2 + n.padDone.size * 0.052, SRC_GEO.side * SRC_GEO.z) }; n.padPending = padKey(p, j, m);
      }
      return o;
    };
    const moved0 = L.padMoved ?? 0;
    const held = stepLoader(L, { next, pick, placeY: (p) => BELT_Y + 0.05 + (n.side[p]?.panel ? 0.16 : n.side[p]?.h ?? 0.2), placeK: k == null ? (L.state === 'ready' && L.placeT ? 1 : null) : Math.min(1, k / 0.9), dt: dts, frozen: this.halted || this.ctl?.stop, legacy: this.mode === 'traditional' });
    L.placeT = k != null;
    if ((L.padMoved ?? 0) > moved0 && n.padPending) { n.padDone.add(n.padPending); n.padPending = null; }
    for (const p of keys) {
      const D = n.side[p], S = containerSplit(n.split[p], cnt[p] - (held === p ? 1 : 0), D.C[0].C);
      D.C.forEach((cont, j) => {
        const m = S.c[j]; cont.objs.forEach((o, i) => (o.visible = i < m));
        for (const key of [...n.padDone]) { const [pp, jj, mm] = key.split(':'); if (pp === p && +jj === j && +mm < m) n.padDone.delete(key); }   // 보충된 팔레트 — 빈 트레이 기록 지움
        cont.trayM?.forEach((t, l) => { t.visible = l === 0 || m > l * cont.per || (m === l * cont.per && !n.padDone.has(padKey(p, j, m)) && L.padHeld == null); });
      });
    }
    n.port.pile?.forEach((t, i) => (t.visible = i < n.padDone.size));
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
    const K = this.ctl ??= zoneCtl();
    if (halted || K.stop) { for (const c of this.order) if (c.state === 'BUSY') c.halt = true; this.sim?.zkpi?.stopAll(this.Z.key, this.order, dt); return; }   // 정밀조립 비상·보호정지 또는 운영자 Zone 정지(대화 지시) — OEE 운영 정지 시간
    dt *= K.speed;   // 운영자 Zone 속도 (대화 지시 · 셀 작업과 AMR 이동 모두)
    this.time += dt;
    const Z = this.Z, KP = this.sim?.zkpi;
    // 셀 작업
    for (const c of this.order) {
      c.halt = false;
      // 셀 고장·정비 (sim.js 확장 Zone 셀): 수리 끝날 때까지 작업이 멈춘다 · 가동 여부를 알려 마모 계산에 쓴다
      const zc = this.sim?.zoneCell(Z.key, c.id); c.fault = zc && (zc.state === 'DOWN' || zc.state === 'MAINT') ? zc.state : null;
      if (zc) zc.busy = c.state === 'BUSY';
      KP?.acc(Z.key, c, dt, { held: K.hold.has(c.id), ideal: c.cycle, name: `${c.def.no ?? c.id} ${c.def.label}` });   // OEE 셀 시간 분류 (js/zonekpi.js)
      if (c.fault) continue;
      if (K.hold.has(c.id)) { if (c.state === 'BUSY') c.halt = true; continue; }   // 운영자 셀 정지 (대화 지시) — 다시 지시할 때까지 그 자리
      if (c.state !== 'BUSY') continue;
      // 셀 OCS HOLD: 품목 전환(유연생산 CHANGEOVER) · 공구 교환(적응가공) 동안은 작업이 진행되지 않는다
      if (c.holdT > 0) { c.holdT -= dt; c.busy += dt; if (c.holdT <= 0) c.hold = null; continue; }
      c.busy += dt; c.progress = Math.min(1, c.progress + dt / c.cur);
      if (c.progress >= 1) {
        const it = c.item; it.done.add(c.id); c.done++;
        if (c.def.wash && it.wash) this.sim?.washer?.done(it);   // 세척 기록 · 필터·세척액 소모 · 필터 정비 판단 (js/washer.js)
        if (c.def.type === 'cmm') this.sim?.cmm?.done(it);
        if (c.def.type === 'kit') this.sim?.kit?.done(it);   // 키트 기록 (js/kitcell.js)
        if (c.def.type === 'matid') this.sim?.matl?.done(it);   // 소재 식별 기록 · 격리 · 가공 여유 (js/matlcell.js)   // 측정 기록 · 소재 온도·보정 · 끼움 힘 (js/cmmcell.js — 품질 표본보다 먼저)
        if (Z.ng && c.id === Z.ng.at && !it.ng && this.rng() < Z.ng.rate * (this.sim?.serials?.inlineMul(Z.key) ?? 1)) { it.ng = true; it.ngNext = true; this.stats.ng++; }   // 정밀검사 NG 공정 보정 중이면 검사 기준 강화 (js/serial.js)
        else it.ngNext = false;
        // NG 판정 내용 (치수·외관검사 C06): 결함 종류(용접 · 실러 · 헤밍)와 자리(판넬 길이 방향 0~1) — C07 로봇이 그 자리를 보수한다 (난수 흐름을 바꾸지 않게 대상물 번호로)
        if (it.ngNext && !it.ngDefect) { const h = Math.abs(Number(String(it.id).replace(/\D/g, '')) || 0); it.ngDefect = { kind: ['spot', 'seal', 'hem'][h % 3], u: 0.15 + ((h * 0.618034) % 1) * 0.7, fixed: false }; }
        if (Z.ng && c.id === Z.ng.to && it.ngDefect) it.ngDefect.fixed = true;
        KP?.done(Z.key, c.id);
        if (KP && Z.ng && c.id === Z.ng.at) KP.flexUnit(it, it.ngNext);   // 치수·외관검사 측정값 → 품질 표본 (관리도·산점도)
        if (KP && Z.key === 'adapt') { KP.adaptCtx(it, c); if (c.id === Z.rework?.at) KP.adaptUnit(it, !!(it.rework || it.toolBreak)); }   // 가공 셀 공구·주축 상태 → CMM 측정값
        // 2단 ID: 최종 검사 합격 → 제품 시리얼 발행 · 마킹(유연생산 C06·C07 QR 라벨 · 적응가공 CMM DataMatrix 각인) · 판독 검증 (js/serial.js)
        const H = this.sim?.serials;
        if (H) { H.extDone(it, c.id, Z.ng && c.id === Z.ng.at ? (it.ngNext ? 'NG' : 'OK') : null); if (H.isMarkCell(Z.key, c.id) && !it.ngNext && H.issue(it, { cell: c.id, name: Z.cells[c.id]?.label ?? c.id })?.mark) c.markT = this.time; }
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
        if (k === 0 && !this.src.occ && !this.ctl?.feed) { this.src.occ = c; this.go(c, [{ x: c.x, z: c.z }, { x: Z.src.x, z: Z.src.z }], 'toSrc', 'SRC'); break; }   // 투입 정지(대화 지시) 중에는 대기열에서 기다린다
        this.moveToward(c, q, Z.amr.ret * sc, dt);
        break;
      }
      case 'load':
        if (!c.cart && !c.loadGo) { if (this.loaderBusy()) break; c.loadGo = true; }   // 투입 로봇이 다음 자재를 들고 AMR 위에 와 있어야 적재 시작 (트레이 옮기기 · 꺼내는 중이면 AMR이 기다린다) — 시작한 적재는 끝까지
        c.timer -= dt;
        if (c.timer <= 0) {
          // 물류존 확장 선반에서 원재료 1개 · 부품 키트 1개를 꺼낸다 — 모자라면 입고될 때까지 투입 대기 (sim.js takeZoneStock)
          if (this.sim && !this.sim.takeZoneStock(Z.key)) { this.starved = true; break; }
          this.starved = false;
          const p = this.nextProduct();
          c.item = { id: `${Z.code}-${String(++this.seq).padStart(4, '0')}`, product: p, done: new Set(), ng: false, t0: this.time };
          this.stats.released++; this.attachItem(c);
          this.sim?.serials?.extRelease(Z.key, c.item, c.uid ?? c.id);   // 1단: WIP ID
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
        if (c.target === 'SRC') { c.state = 'load'; c.timer = Z.load; c.loadGo = false; break; }
        if (c.target === 'SINK') { c.state = 'unload'; c.timer = Z.unload; c.at = 'SINK'; break; }
        const cell = this.cells[c.target]; c.at = c.target;
        const rw = Z.rework && cell.id === Z.rework.at && this.rng() < Z.rework.rate;
        if (rw) { c.item.rework = true; this.stats.rework++; }
        Object.assign(cell, { state: 'BUSY', progress: 0, item: c.item, cur: cell.cycle * (rw ? Z.rework.mul ?? 1.6 : 1) * (0.92 + this.rng() * 0.16) });
        if (cell.def.type === 'cmm') this.sim?.cmm?.plan(c.item);
        if (cell.def.type === 'kit' && this.sim?.kit) cell.cur += this.sim.kit.plan(c.item);   // 키트 (오류를 C01에서 발견 · 보울 피더 막힘 · 결품이면 더 기다림 — js/kitcell.js)
        if (cell.def.type === 'matid' && this.sim?.matl) cell.cur *= this.sim.matl.plan(c.item);   // ID 판독 · 재질 · 결함 · 가공 여유 (불합격이면 예비 소재로 바꿔 다시 스캔 — 셀 시간 2배 · js/matlcell.js)
        if (cell.def.type === 'mill5' && c.item.matl?.cutMul) cell.cur *= c.item.matl.cutMul;   // ④ 소재 식별셀 가공 여유 → 원점 보정·첫 절입량 (피지컬AI: 헛절삭 줄어 사이클 −6%)   // 리워크 종류(재가공·접촉) · 소재 온도·보정 · 파지 계획 (js/cmmcell.js — 이송 순서가 따름)
        if (cell.def.wash && this.sim?.washer) cell.cur += cell.cycle * this.sim.washer.plan(c.item);   // 세척 청정도 규격 밖이면 재세척 (js/washer.js)
        const SH = this.sim?.serials;   // 공정 이력 (WIP ID) · 마킹 셀은 판독 실패 시 재마킹 시간만 더한다 (첫 마킹은 판정과 병렬)
        if (SH) { SH.extEnter(c.item, cell.id, Z.cells[cell.id]?.label ?? cell.id); if (SH.isMarkCell(Z.key, cell.id) && (cell.id !== Z.ng?.to || c.item.ng)) cell.cur += SH.plan(c.item); }
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
          this.sim?.serials?.toFG(c.item);   // 시리얼 단위 출하 대기 재고
          this.detachItem(c); c.item = null; this.sink.occ = null;
          this.go(c, this.st ? this.returnPath(c) : this.retPath, 'return', this.st ? 'PARK' : 'Q');
          break;
        }
        c.timer -= dt;
        if (c.timer <= 0) {
          const p = c.item.product; this.stats.good[p] = (this.stats.good[p] ?? 0) + 1;
          this.sim?.serials?.toFG(c.item);
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
    this.animSrc(dts);
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
  // 용접 불꽃·용접 자국 · 실러 비드: 툴 끝(TCP)이 대상물에 닿아 작업하는 동안만 그 자리에서 (pointWork r.pwContact)
  toolMarks(c, r, pm, rdt) {
    const tcp = r.tip.getWorldPosition(new THREE.Vector3());
    if (c.def.type === 'spot') {
      r.sparks ??= put(makeSparks(0xffe08a, 110, 0.026), 0, 0, 0, c.g);
      r.flash ??= put(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })), 0, 0, 0, c.g);   // 통전 섬광 (전극 접점)
      const on = !!r.pwContact; r.weldOn = on; r.sparkAt = c.g.worldToLocal(tcp.clone());
      r.flash.visible = on; if (on) { r.flash.position.copy(r.sparkAt); r.flash.scale.setScalar(0.7 + Math.random() * 0.8); r.flash.material.opacity = 0.55 + Math.random() * 0.4; }
      if (on) { r.weldT = (r.weldT ?? 0) + rdt; r.weldP = pm.worldToLocal(tcp.clone()); }
      else { if (r.weldT > 0.05 && r.weldP) processMarks(pm).nugget(r.weldP.setY(r.weldP.y + 0.011)); r.weldT = 0; r.weldP = null; }   // 통전이 끝난 점에 너깃 자국 (팁이 1cm 눌렀던 자리 → 윗면)
    } else if (c.def.type === 'matid') { r.tool.userData.flash?.(!!r.pwContact && Math.random() < 0.5); if (c.parts.libsScr) c.parts.libsScr.emissive.setHex(r.pwContact ? 0xff9a3d : 0x58c4ff); }   // LIBS: 프로브가 닿아 있는 동안 레이저 플라스마 섬광 · 분석기 화면
    else if (c.def.type === 'deburr' || c.def.type === 'cmm') {   // 디버링 칩 · 에어 블로 물안개 — 툴 끝이 닿아 있는 동안 그 자리에서 (CMM: 접촉 리워크 구간은 칩)
      const on = !!r.pwContact, chip = c.def.type === 'deburr' || cmmPhase(cmmPlan(c.item), c.progress) === 'hand'; if (on && chip) r.tool.userData.spin?.(rdt);
      r.fx ??= put(makeSparks(0xe8f4ff, 50, 0.03), 0, 0, 0, c.g); r.fxChip ??= put(makeSparks(0xc8ccd2, 50, 0.018), 0, 0, 0, c.g);
      const at = c.g.worldToLocal(tcp.clone());
      stepSparks(r.fx, on && !chip, at, rdt, 0.7, -1.5); stepSparks(r.fxChip, on && chip, at, rdt, 1.1, -9);
    } else if (r.held) {   // 키팅·정밀 장착: 집은 부품을 손끝에 · 내려놓는 순간 그 자리에 부품을 남긴다
      if (r.wasHeld && !r.pwHeld && r.pwContact) processMarks(pm).place(pm.worldToLocal(tcp.clone()), c.def.type === 'mount' ? 'hinge' : 'bracket');
      r.held.visible = !!r.pwHeld; r.wasHeld = !!r.pwHeld;
    } else if (c.def.type === 'seal') {
      const m = processMarks(pm);
      if (r.pwContact) m.beadTo(pm.worldToLocal(tcp.clone()).setY(pm.worldToLocal(tcp.clone()).y - 0.004)); else m.lift();
    }
  }
  // 실러 호스: 계량 유닛 출구 → 위로 → 로봇 어깨 위 → 팔꿈치 → 손목 → 건 뒤 피팅 (팔을 따라 늘어진 모양)
  sealHose(c, r) {
    const L = (o) => r.root.worldToLocal(o.getWorldPosition(new THREE.Vector3())), A = r.arm, o = c.parts.hoseOut;
    const out = r.root.worldToLocal(c.g.localToWorld(new THREE.Vector3(o.x, o.y, o.z))), sh = L(A.pivots[1]), el = L(A.pivots[2]), wr = L(A.pivots[4]), fit = L(r.hoseFit);
    r.hose.update([out, out.clone().add(r.root.worldToLocal(c.g.localToWorld(new THREE.Vector3(o.x - 0.2, o.y + 0.45, o.z))).sub(out)), sh.clone().setY(sh.y + 0.3), el.clone().setY(el.y + 0.16), wr.clone().setY(wr.y + 0.12), fit]);
  }
  // 헤밍 로봇: 진공 그리퍼로 AMR 위 패널(로봇 쪽 가장자리)을 잡아 들어 → 반 바퀴 돌려 프레스 앞 → 밀어 넣어 베드에 내려놓고 물러남 → 헤밍 → 다시 잡아 꺼내 AMR에 원래대로 올림
  // 패널은 그리퍼에 붙어 같이 움직인다(그리퍼 기준 상대 자세 고정) — 손목(J6)으로 패널 방향을 잡아 프레스에서는 반 바퀴 돌아간 자세(긴 쪽이 베드 긴 쪽)
  hemWork(c, r, car, p) {
    if (c.halt || c.fault || this.halted) return;   // 정지·고장: 팔·패널 모두 그 자리
    const A = r.arm, P = r.root.parent, V = (x, y, z) => new THREE.Vector3(x, y, z), pm = car?.pm;
    const ik = (v) => { const l = r.root.worldToLocal(P.localToWorld(v.clone())); return A.ik(l.x, l.y, l.z, true); };
    // 대기: 받침 위로 팔을 세워 접는다 (통로 쪽으로 조금 — AMR·패널 위 1.75m) · 롤러 헤밍 동안 앤빌 위 패널에서 떨어져 있다
    r.hemRest ??= ik(V(HEM.robot.x + HEM.rest.dx, HEM.rest.y, HEM.robot.z + HEM.rest.dz));
    const restore = () => { const h = r.hemPm; if (h?.userData.home) { h.position.copy(h.userData.home.p); h.quaternion.copy(h.userData.home.q); } r.hemPm = null; };
    if (!pm || c.state !== 'BUSY' || !c.item) { restore(); r.hemKey = null; r.hemCur = r.hemCur ? r.hemCur.map((v, k) => v + (r.hemRest[k] - v) * 0.15) : r.hemRest.slice(); A.pose(...r.hemCur); return; }
    if (r.hemPm && r.hemPm !== pm) restore();
    pm.userData.home ??= { p: pm.position.clone(), q: pm.quaternion.clone() };
    if (r.hemKey !== c.item.id) {
      pm.position.copy(pm.userData.home.p); pm.quaternion.copy(pm.userData.home.q);
      const b = contactBox(pm, P); if (!b) return;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, sz = Math.sign(HEM.robot.z - cz) || 1, gx = cx - HEM.gx, gz = cz + sz * HEM.edge;
      pm.updateWorldMatrix(true, false);
      const d0w = V(1, 0, 0).transformDirection(pm.matrixWorld).setY(0).normalize(), dl = P.worldToLocal(P.getWorldPosition(V()).add(d0w)).sub(P.worldToLocal(P.getWorldPosition(V()))).setY(0).normalize(), pl = V(-dl.z, 0, dl.x);
      // 잡는 높이: 흡착컵 4개(긴 쪽 ±0.23 · 짧은 쪽 ±0.13) 아래 패널 윗면 중 가장 높은 곳 + 3mm — 휜 패널에서 컵·프레임이 패널 속으로 들어가지 않게
      const cupY = [-1, 1].flatMap((a) => [-1, 1].map((c2) => surfaceY(pm, P, null, gx + dl.x * 0.23 * a + pl.x * 0.13 * c2, gz + dl.z * 0.23 * a + pl.z * 0.13 * c2, b.max[1])));
      const gy = Math.max(surfaceY(pm, P, null, gx, gz, b.max[1]), ...cupY) + 0.003, off = V(gx - cx, 0, gz - cz);
      const G1 = V(gx, gy, gz), G2 = V(HEM.press.x - off.x, HEM.bedY + (gy - b.min[1]), HEM.press.z - off.z);   // 프레스에서는 반 바퀴 돈 자세 — 잡은 점이 프레스 앞(통로) 쪽
      const A1 = G1.clone().setY(gy + 0.42),   // 들어 올려 옮기는 높이 — 낮으면 반 바퀴 도는 동안 위팔(J2 링크)이 패널 안쪽 가장자리를 스친다
         hd = (b.max[2] - b.min[2]) / 2, I2 = G2.clone().setY(G2.y + HEM.lift), E = V(G2.x, G2.y + HEM.lift, G2.z - (hd + HEM.mouth + 0.05));   // 프레스 입구: 패널 뒤쪽 가장자리가 기둥 앞면보다 5cm 앞 — 반 바퀴를 다 돌고 똑바로 밀어 넣는다 (기둥 사이에서 옆으로 움직이면 패널 모서리가 기둥에 닿는다)
      // 반 바퀴 옮기는 길: 로봇 축에서 같은 반지름·높이의 호 위 두 점을 지난다 — 관절 보간만 하면 손목이 안쪽으로 당겨져 패널 안쪽 가장자리가 J1·J2 링크를 스친다
      const bx = HEM.robot.x, bz = HEM.robot.z, ang = (v) => Math.atan2(v.z - bz, v.x - bx), rad = (v) => Math.hypot(v.x - bx, v.z - bz);
      let a1 = ang(A1), aE = ang(E); if (aE - a1 > PI) aE -= 2 * PI; if (a1 - aE > PI) aE += 2 * PI;
      const R0 = Math.max(rad(A1), rad(E)) + 0.05, Hc = Math.max(A1.y, E.y) + 0.05, arcP = (k) => { const a = a1 + (aE - a1) * k; return V(bx + Math.cos(a) * R0, Hc, bz + Math.sin(a) * R0); }, arc = (k) => ik(arcP(k));
      const Q = { A1: ik(A1), G1: ik(G1), E: ik(E), I2: ik(I2), G2: ik(G2), R: r.hemRest, M1: arc(1 / 3), M2: arc(2 / 3) };   // 프레스가 누르는 동안(0.49 ~ 0.6)은 대기 자세로 물러나 있다
      // 손목 방향 기준: 잡을 때 플랜지 x축을 패널 긴 쪽(패널 로컬 x)에 맞춘다
      pm.updateWorldMatrix(true, false);
      const d0 = V(1, 0, 0).transformDirection(pm.matrixWorld).setY(0).normalize();
      r.hemPlan = { Q, d0, L: new Map([[Q.E, E], [Q.I2, I2], [Q.M2, arcP(2 / 3)]]), topY: G2.y + (b.max[1] - gy) };
      A.pose(...this.hemAlign(r, Q.G1.slice(), d0)); pm.updateWorldMatrix(true, false);
      const fl = A.flange; fl.updateWorldMatrix(true, false);
      r.hemRel = fl.matrixWorld.clone().invert().multiply(pm.matrixWorld);
      A.pose(...this.hemAlign(r, Q.G2.slice(), d0.clone().negate())); fl.updateWorldMatrix(true, false);
      r.hemPress = fl.matrixWorld.clone().multiply(r.hemRel);
      r.hemKey = c.item.id; c.hemTopY = r.hemPlan.topY;
    }
    const { Q, d0 } = r.hemPlan, sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const K = [[0, Q.R], [0.06, Q.R], [0.12, Q.A1], [0.15, Q.G1], [0.17, Q.G1], [0.21, Q.A1], [0.24, Q.M1], [0.27, Q.M2], [0.3, Q.E], [0.34, Q.I2], [0.36, Q.G2], [0.37, Q.G2], [0.39, Q.I2], [0.43, Q.E], [0.49, Q.R],
      [0.6, Q.R], [0.66, Q.E], [0.7, Q.I2], [0.72, Q.G2], [0.735, Q.G2], [0.75, Q.I2], [0.79, Q.E], [0.82, Q.M2], [0.845, Q.M1], [0.87, Q.A1], [0.9, Q.G1], [0.91, Q.G1], [0.94, Q.A1], [1, Q.R]];
    let j = K.findIndex((k) => k[0] > p); if (j < 0) j = K.length - 1; if (j === 0) j = 1;
    const [t0, a] = K[j - 1], [t1, bq] = K[j], e = sm(t0, t1, p);
    // 호 끝 → 입구 → 베드 위: 관절 보간 대신 직선 (IK) — 기둥 사이 여유가 한쪽 12cm뿐이라 곡선으로 들어가면 패널이 기둥을 스치고, 입구로 내려올 때 곡선이면 패널이 위팔 쪽으로 당겨진다
    const L = r.hemPlan.L, q = L.has(a) && L.has(bq) ? ik(L.get(a).clone().lerp(L.get(bq), e)) : a.map((v, n) => v + (bq[n] - v) * e);
    // 패널 방향: 잡은 뒤 프레스 앞까지 반 바퀴(0 → π), 꺼낸 뒤 AMR 위까지 되돌림 — 그 밖에서는 손목을 대기 자세 그대로
    const phi = PI * (sm(0.21, 0.3, p) - sm(0.79, 0.87, p)), grip = p > 0.12 && p < 0.94;
    const want = d0.clone().applyAxisAngle(V(0, 1, 0), phi);
    const out = grip ? this.hemAlign(r, q, want) : q; A.pose(...out); r.hemCur = out.slice();
    // 패널: 그리퍼에 붙음 (0.16 ~ 0.365 · 0.73 ~ 0.905) · 프레스 베드 (0.365 ~ 0.73) · 그 밖에는 AMR 지그 위 원래 자리
    const held = (p > 0.16 && p < 0.365) || (p > 0.73 && p < 0.905), inPress = p >= 0.365 && p <= 0.73;
    if (held || inPress) {
      const fl = A.flange; fl.updateWorldMatrix(true, false);
      const Mw = inPress ? r.hemPress : fl.matrixWorld.clone().multiply(r.hemRel), Ml = pm.parent.matrixWorld.clone().invert().multiply(Mw), sc = V();
      Ml.decompose(pm.position, pm.quaternion, sc); r.hemPm = pm;
    } else restore();
  }
  // 플랜지 x축(진공 그리퍼 긴 쪽)을 수평 방향 want에 맞추도록 J6을 돌린다 (factory.js alignTool)
  hemAlign(r, q, want) { return alignTool(r, q, new THREE.Vector3(1, 0, 0), want); }
  // 안착·보정(C02): 패널은 지그에 1~2cm · 1° 남짓 비뚤게 들어온다 → 비전 포털이 훑어 편차를 잰 뒤(0.05 ~ 0.45) 로봇이 로봇 쪽 가장자리를 잡고
  // 1.5cm 들어 올려 기준 자세로 옮겨 내려놓는다(0.48 ~ 0.78) — 패널은 그동안 그리퍼와 함께 움직이고, 끝나면 지그 기준 자리에 정확히 놓인다
  locateWork(c, r, car, p) {
    if (c.halt || c.fault || this.halted) return;
    const A = r.arm, P = r.root.parent, V = (x, y, z) => new THREE.Vector3(x, y, z), pm = car?.pm;
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const home = r.locHome ??= A.home.slice();
    const restore = () => { const h = r.locPm; if (h?.userData.home) { h.position.copy(h.userData.home.p); h.quaternion.copy(h.userData.home.q); } r.locPm = null; };
    if (!pm || c.state !== 'BUSY' || !c.item) { restore(); r.locKey = null; r.locCur = r.locCur ? r.locCur.map((v, k) => v + (home[k] - v) * 0.15) : home.slice(); A.pose(...r.locCur); return; }
    if (r.locPm && r.locPm !== pm) restore();
    pm.userData.home ??= { p: pm.position.clone(), q: pm.quaternion.clone() };
    if (r.locKey !== c.item.id) {
      pm.position.copy(pm.userData.home.p); pm.quaternion.copy(pm.userData.home.q); pm.updateWorldMatrix(true, true);
      const b = contactBox(pm, P); if (!b) return;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, f = Math.sign(r.slot.z - cz) || 1, gz = (f > 0 ? b.max[2] : b.min[2]) - f * 0.07, gx = Math.max(b.min[0] + 0.15, Math.min(b.max[0] - 0.15, r.slot.x));
      const gy = surfaceY(pm, P, null, gx, gz, b.max[1]);
      const seed = Math.abs(Number(String(c.item.id).replace(/\D/g, '')) || 1);
      r.locGrip = pm.worldToLocal(P.localToWorld(V(gx, gy, gz)));   // 패널 로컬 잡는 점 (패널과 함께 움직인다)
      r.locErr = { dx: ((seed * 7) % 5 - 2) * 0.007, dz: (seed % 2 ? 1 : -1) * 0.014, yaw: ((seed * 3) % 5 - 2) * 0.008 };   // 들어올 때 비뚤어진 정도 (지그 로컬)
      r.locKey = c.item.id;
    }
    // 패널 자세: 편차(e) — 보정 구간(0.6 ~ 0.7)에 0으로 · 들림(0.56 ~ 0.74)
    const e = 1 - sm(0.6, 0.7, p), lift = 0.015 * sm(0.55, 0.58, p) * (1 - sm(0.7, 0.74, p)), E = r.locErr, H = pm.userData.home;
    pm.position.set(H.p.x + E.dx * e, H.p.y + lift, H.p.z + E.dz * e); pm.quaternion.copy(H.q).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), E.yaw * e)); r.locPm = pm;
    pm.updateWorldMatrix(true, false);
    const g = r.root.worldToLocal(pm.localToWorld(r.locGrip.clone())), ik = (dy) => A.ik(g.x, g.y + dy, g.z, true);
    // 로봇: 비전 측정 동안 잡는 점 0.3m 위에서 대기 → 내려가 잡고(0.52 ~ 0.56) → 패널과 함께 들고 옮겨 내려놓음 → 놓고(0.78) 올라감 → 대기 자세
    const q = p < 0.08 ? home.map((v, k) => v + (ik(0.3)[k] - v) * sm(0.02, 0.08, p)) : p < 0.45 ? ik(0.3) : p < 0.52 ? ik(0.3 * (1 - sm(0.45, 0.52, p))) : p < 0.78 ? ik(0) : p < 0.86 ? ik(0.3 * sm(0.78, 0.86, p)) : ik(0.3).map((v, k) => v + (home[k] - v) * sm(0.86, 0.96, p));
    A.pose(...q); r.locCur = q.slice(); r.pwContact = p >= 0.52 && p < 0.78;
  }
  // 디버링셀 부스·세척기 (이송 진행률 q = washQ(p)): 문은 로봇이 드나드는 동안만 열림(XFER_DOOR) · 정지·고장 중에는 그 자리
  //  부스(q 0.3 ~ 0.41): 고정구 회전 · 워터젯 노즐 헤드가 교차홀을 따라 움직이며 고압수 · 실내 조명 · 펌프 압력계
  //  세척기(q 0.72 ~ 0.85): 고압 분사(노즐 회전) → 랜스 → 건조 김 · 필터 교체(정비) 중 경광등 노랑 · 차압 경보면 빨강
  animXfer(c, P, busy, p, t, rdt, dts) {
    const W = P.washer, B = P.booth, q = busy ? washQ(p) : c.state === 'BUSY' ? null : 0, ph = q != null && busy ? washPhase(q) : null, wj = q != null && busy && boothPhase(q);
    if (q != null) { W.doorK = doorK(q, XFER_DOOR.wash); B.doorK = doorK(q, XFER_DOOR.booth); }
    W.shutter.scale.y = 1 - 0.95 * W.doorK; B.shutter.scale.y = 1 - 0.95 * B.doorK;   // 롤업 셔터 (위 드럼 쪽으로 말림)
    // 워터젯 부스
    const bf = { x: WJB.fix.x - WJB.cab.x, z: WJB.fix.z - WJB.cab.z }, u = wj ? (q - 0.3) / 0.11 : 0;
    B.head.position.set(bf.x - 0.1 + (wj ? Math.sin(u * PI * 4) * 0.18 : 0), wj ? 1.5 + Math.abs(Math.sin(u * PI * 8)) * 0.1 : 1.85, bf.z + (wj ? Math.cos(u * PI * 3) * 0.18 : 0));
    if (wj) { B.fixture.rotation.y += dts * 1.2; B.nozzle.rotation.y += dts * 40; }
    stepSparks(B.spray, !!wj, { x: B.head.position.x, y: WJB.fix.y + 0.2, z: B.head.position.z }, rdt, 2.2, -9);
    B.lightMat.emissiveIntensity = wj ? 2.4 : 0.25; B.screen.emissive.setHex(wj ? 0x9fe8ff : 0x3ddc84); B.gaugeMat.emissive.setHex(wj ? 0x58c4ff : 0x3ddc84);
    B.lampMats.forEach((m, k) => (m.emissiveIntensity = k === (wj ? 1 : 0) ? 2.5 : 0.25));
    // 세척기
    if (ph === 'hp') W.hp.rotation.y += dts * 30;
    const ly = ph === 'lance' ? -0.55 + Math.abs(Math.sin(t * 5)) * 0.15 : 0; W.lance.position.y += (1.9 + ly - W.lance.position.y) * Math.min(1, rdt * 8);
    const f = { x: WASH.fix.x - WASH.cab.x, z: WASH.fix.z - WASH.cab.z };
    stepSparks(W.spray, ph === 'hp' || ph === 'lance', { x: f.x + (ph === 'lance' ? 0.3 : Math.sin(t * 7) * 0.2), y: WASH.fix.y + 0.35, z: f.z + Math.cos(t * 6) * 0.2 }, rdt, 1.6, -7);
    stepSparks(W.steam, ph === 'dry', { x: f.x, y: WASH.fix.y + 0.3, z: f.z }, rdt, 0.6, 1.2);
    W.lightMat.emissiveIntensity = ph ? 2.2 : 0.25;
    const S = this.sim?.washer, fac = this.sim?.zoneCell?.(this.Z.key, c.id), lv = S?.levels?.dp, maint = fac?.state === 'MAINT' && fac.maintKind === 'filter';
    const lamp = lv === 'alarm' ? 2 : maint || lv === 'warn' ? 1 : 0;
    W.lampMats.forEach((m, k) => (m.emissiveIntensity = k === lamp ? (lamp === 2 ? 2.5 + Math.sin(t * 8) * 1.5 : 2.5) : 0.25));
    W.screen.emissive.setHex(maint ? 0xf5b82e : ph === 'dry' ? 0xffb070 : ph ? 0x9fe8ff : 0x3ddc84);
    W.gaugeMat.emissive.setHex(lv === 'alarm' ? 0xff5a5a : lv === 'warn' ? 0xf5b82e : 0x3ddc84);
  }
  // C01 키트 부품 수: 로봇마다 장착 점 수 (pointWork n과 같은 식 — 셀 대상물 번호로 정함)
  kitCounts(c) { const seed = Math.abs(Number(String(c.item?.id ?? '').replace(/\D/g, '')) || 0); return [0, 1].map((i) => 2 + (seed * 7 + i * 2) % 3); }
  // C01 키트 트레이 흐름 (셀 진행률): 지금 판넬 키트 2개 = 대기 자리 → 정지 자리(0 ~ 0.06) → 로봇이 집어 감 → 동쪽 회수대(0.86 ~ 0.95)
  //  다음 판넬 키트 2개 = 조립대에서 담기(로봇 ② 몫 0.1 ~ 0.45 · 로봇 ① 몫 0.47 ~ 0.8) → 검증대(영상 · 무게) → 라인사이드 대기 자리 — 판넬마다 두 쌍이 번갈아 쓰인다
  kitAnim(c, K, busy, p, t) {
    const C = KITC.conv, Y = C.y, sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const n = this.kitCounts(c), base = (c.done % 2) * 2, cur = [K.trays[base], K.trays[base + 1]], nxt = [K.trays[2 - base], K.trays[3 - base]], it = c.item;
    const col = KIT_PART_COL[it?.product] ?? KIT_PART_COL.hood, at = (tr, x, z) => { tr.position.set(x, Y, z); tr.visible = true; };
    const fill = (tr, k) => tr.userData.parts.forEach((m, j) => { m.visible = j < k; m.material = col; });
    if (!it || c.state !== 'BUSY') {   // 대기: 다음 키트가 대기 자리에 준비돼 있다
      at(nxt[0], KITC.queue[0], C.z); at(nxt[1], KITC.queue[1], C.z); fill(nxt[0], 3); fill(nxt[1], 3); cur.forEach((tr) => (tr.visible = false));
      K.lights.flat().forEach((m) => (m.emissiveIntensity = 0.15)); return;
    }
    // 지금 키트 (로봇 ① = 서쪽 정지 · ② = 동쪽 정지 — ②의 트레이가 앞장)
    const kin = sm(0, KIT_T.inEnd, p), kout = sm(KIT_T.out[0], KIT_T.out[1], p);
    const xs = [KITC.queue[0] + (KITC.stops[0] - KITC.queue[0]) * kin, KITC.queue[1] + (KITC.stops[1] - KITC.queue[1]) * kin];
    cur.forEach((tr, i) => { const x = xs[i] + (KITC.ret - xs[i]) * kout; at(tr, x, C.z); tr.visible = p < KIT_T.out[1]; const taken = c.robots.filter((r) => !r.kitPicker && !r.xfer)[i]?.kitTaken ?? 0; fill(tr, Math.max(0, n[i] - taken)); });
    // 다음 키트: ② 몫 먼저 담고 검증대 → 대기 자리 1(동쪽) · ① 몫은 그다음 → 대기 자리 0(서쪽)
    const B = KITC.build, VZ = KITC.verify.z, path = (tr, t0, t1, tq, qx, kn, done) => {
      if (p < t0) { tr.visible = false; return; }
      if (p < t1) { at(tr, B.x, B.z + 0.25); fill(tr, Math.min(kn, Math.floor(((p - t0) / (t1 - t0)) * kn + 1e-9))); return; }
      fill(tr, kn); const u = (k0, k1) => sm(k0, k1, p);
      const z = B.z + 0.25 + (VZ - B.z - 0.25) * u(t1, t1 + 0.04) + (C.z - VZ) * u(tq, tq + 0.04), x = B.x + (qx - B.x) * u(tq + 0.04, tq + 0.08);
      at(tr, x, z);
    };
    path(nxt[1], KIT_T.pick[0], 0.45, 0.53, KITC.queue[1], n[1]); path(nxt[0], 0.47, KIT_T.pick[1], KIT_T.verify[1], KITC.queue[0], n[0]);
    // 검증대 섬광 (영상 판정 · 무게) · 보울 피더 (트레이가 정지 자리에 있을 때 공급) · 흐름 랙 표시등 (자동화: 지금 집는 칸)
    const ver = (p > 0.49 && p < 0.53) || (p > KIT_T.verify[0] + 0.04 && p < KIT_T.verify[1]);
    K.camMat.emissiveIntensity = ver ? 4 + Math.sin(t * 40) * 2 : 0.6; K.scaleMat.emissiveIntensity = ver ? 2.5 : 0.6;
    K.feedMats.forEach((m) => (m.emissiveIntensity = p > KIT_T.inEnd && p < KIT_T.pick[0] + 0.05 ? 3 : 0.6));
    const pj = this.kitPickIndex(c, p), lit = this.mode === 'smart' && pj ? pj.rack * 2 + pj.lv : -1;
    K.lights.flat().forEach((m, k) => (m.emissiveIntensity = k === lit ? 3 : 0.15));
  }
  // 키팅 피킹 순번 (셀 진행률 → 지금 담는 부품 j · 그 부품의 흐름 랙 · 칸 · 구간 진행 f) — 로봇 ② 몫 n1개 다음 ① 몫 n0개
  kitPickIndex(c, p) {
    const n = this.kitCounts(c), win = [[KIT_T.pick[0], 0.45, n[1], 0], [0.47, KIT_T.pick[1], n[0], n[1]]].find(([a, b]) => p >= a && p < b); if (!win) return null;
    const [a, b, cnt, off] = win, s = ((p - a) / (b - a)) * cnt, k = Math.min(cnt - 1, Math.floor(s)), j = off + k, parts = KIT_PARTS[c.item?.product] ?? KIT_PARTS.hood, pt = parts[j % parts.length];
    return { j, f: s - k, rack: pt[1], lv: 1, bx: [-0.36, 0, 0.36][(j + pt[1]) % 3], tray: off ? 0 : 1, slot: k };   // 윗단 피킹 면에서 위로 집음 (아랫단은 예비 상자 — 팔이 선반 사이로 들어가지 않게)
  }
  // 키팅 피킹 로봇: 부품마다 흐름 랙 칸 앞으로 가서 집고 조립대 쪽으로 돌아와 트레이에 내려놓는다 — 협동로봇은 팔을 접은 채 레일로 옮겨 간 뒤 팔을 뻗는다 (접힘 0 ~ 25% · 집기 25 ~ 60% · 돌아옴 60 ~ 82% · 놓기 82 ~ 100%)
  //  자동화 = 레일 위 협동로봇(캐리지가 x로 움직이고 팔은 칸·트레이 자세 사이 관절 보간) · 피지컬AI = AMMR(바퀴로 움직이며 몸을 돌려 두 손으로 집고 놓는다)
  kitPickerPose(c, r, busy, p, t) {
    const pj = busy ? this.kitPickIndex(c, p) : null, sm = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); }, X0 = KITC.pick.place;
    const rackX = pj ? KITC.racks[pj.rack] + pj.bx : X0, f = pj?.f ?? 0;
    const amm = !!r.body, xAt = !pj ? X0 : amm ? (f < 0.3 ? X0 + (rackX - X0) * sm(f / 0.3) : f < 0.55 ? rackX : f < 0.85 ? rackX + (X0 - rackX) * sm((f - 0.55) / 0.3) : X0)
      : f < 0.25 ? X0 + (rackX - X0) * sm(f / 0.25) : f < 0.6 ? rackX : f < 0.82 ? rackX + (X0 - rackX) * sm((f - 0.6) / 0.22) : X0;   // 협동로봇: 팔을 접은 채로만 레일 이동
    if (!c.halt && !c.fault) r.root.position.x = xAt;
    if (r.body) {   // AMMR: 랙을 볼 때 0 · 조립대(북서)를 볼 때 몸을 돌림 · 한 팔(IK)로 윗단 상자 속 부품을 집어 조립대 트레이 칸에 놓음 · 다른 팔은 접음
      const face = !pj ? 0 : f < 0.55 ? 0 : sm((f - 0.55) / 0.3), yaw = PI + face * 1.975;   // 랙(셀 로컬 −z) PI → 조립대(북서) 쪽
      if (!c.halt && !c.fault) r.root.rotation.y = yaw;
      const rest = (r.kpRest ??= r.arms.map((a, k) => { a.pose((k ? -1 : 1) * 0.3, 0.85, 1.25, 0.75, 0, 0); return a.joints(); }));
      if (pj && r.arms[0].ik && !c.halt && !c.fault) {
        const key = `${c.item?.id}:${pj.j}`;
        if (r.kpAKey !== key) {   // 집는 자리(랙 앞 · 랙을 봄)와 놓는 자리(조립대 앞 · 돌아섬)에서 왼팔 IK — 몸을 숙여 닿게
          r.kpAKey = key; const P = r.root.parent, up = new THREE.Vector3(0, 1, 0), keepX = r.root.position.x, keepR = r.root.rotation.y;
          const at = (x, yw) => { r.root.position.x = x; r.root.rotation.y = yw; r.body.pose(...AMMR_LEAN.map((v) => v * 0.6)); r.root.updateWorldMatrix(true, true); };
          const ik = (x, y, z) => { const T = new THREE.Vector3(x, y, KITC.sz * z), L = r.root.worldToLocal(P.localToWorld(T.clone())), d = r.root.worldToLocal(P.localToWorld(T.clone().add(up))).sub(L); return r.arms[0].ik(L.x, L.y, L.z, d); };
          const y = 0.55 + pj.lv * 0.36 + 0.17 + 0.07;
          at(rackX, PI); const bA = ik(rackX, y + 0.22, KITC.rackFront + 0.12), bIn = ik(rackX, y, KITC.rackFront + 0.12);
          at(X0, PI + 1.975); const tx = KITC.build.x - 0.15 + pj.slot * 0.1, tA = ik(tx, Y_TRAY + 0.28, KITC.build.z + 0.25), tIn = ik(tx, Y_TRAY + 0.08, KITC.build.z + 0.25);
          r.root.position.x = keepX; r.root.rotation.y = keepR; r.body.pose(); r.kpAQ = { bA, bIn, tA, tIn };
        }
        const Q = r.kpAQ, L = (a, b, k) => a.map((v, j) => v + (b[j] - v) * sm(k)), R0 = rest[0];
        const qw = f < 0.3 ? R0 : f < 0.36 ? L(R0, Q.bA, (f - 0.3) / 0.06) : f < 0.42 ? L(Q.bA, Q.bIn, (f - 0.36) / 0.06) : f < 0.48 ? Q.bIn : f < 0.55 ? L(Q.bIn, R0, (f - 0.48) / 0.07)
          : f < 0.85 ? R0 : f < 0.9 ? L(R0, Q.tA, (f - 0.85) / 0.05) : f < 0.95 ? L(Q.tA, Q.tIn, (f - 0.9) / 0.05) : L(Q.tIn, R0, (f - 0.95) / 0.05);
        const leanK = f < 0.3 ? 0 : f < 0.36 ? (f - 0.3) / 0.06 : f < 0.48 ? 1 : f < 0.55 ? 1 - (f - 0.48) / 0.07 : f < 0.85 ? 0 : f < 0.9 ? (f - 0.85) / 0.05 : f < 0.95 ? 1 : 1 - (f - 0.95) / 0.05;
        r.body.pose(...AMMR_LEAN.map((v) => v * 0.6 * leanK));
        r.arms.forEach((a, k) => a.nativePose(...(k === 0 ? qw : rest[k])));
      } else if (!c.halt && !c.fault) { r.body.pose(); r.arms.forEach((a, k) => (a.nativePose ? a.nativePose(...rest[k]) : a.pose())); }
      if (r.held) r.held.visible = !!pj && f >= 0.45 && f < 0.95;
      return;
    }
    const A = r.arm; if (!A?.native) return;
    const P = r.root.parent, SZ = KITC.sz, loc = (x, y, z) => r.root.worldToLocal(P.localToWorld(new THREE.Vector3(x, y, SZ * z)));   // z는 키팅 구역 좌표(양수 = 남쪽)
    r.kpHome ??= (() => { const v = loc(X0, 1.25, KITC.pick.z + 0.2); return A.ik(v.x, v.y, v.z, true); })();
    let q = r.kpHome;
    if (pj) {
      const y = 0.55 + pj.lv * 0.36 + 0.17, bin = (dy) => { const v = loc(rackX, y + dy, KITC.rackFront + 0.12); return A.ik(v.x, v.y, v.z, true); };   // 윗단 상자 앞쪽을 위에서 (툴 수직)
      const tray = (dy) => { const v = loc(KITC.build.x - 0.15 + pj.slot * 0.1, Y_TRAY + dy, KITC.build.z + 0.25); return A.ik(v.x, v.y, v.z, true); };
      const key = `${c.item?.id}:${pj.j}`; if (r.kpKey !== key) { r.kpKey = key; r.kpQ = { appr: bin(0.3), in: bin(0.0), up: tray(0.25), dn: tray(0.03) }; }   // 상자 위 0.3m → 상자 안
      const Q = r.kpQ, lerp = (a, b, k) => a.map((v, j) => v + (b[j] - v) * sm(k));
      q = f < 0.25 ? r.kpHome : f < 0.32 ? lerp(r.kpHome, Q.appr, (f - 0.25) / 0.07) : f < 0.42 ? lerp(Q.appr, Q.in, (f - 0.32) / 0.1) : f < 0.52 ? lerp(Q.in, Q.appr, (f - 0.42) / 0.1) : f < 0.6 ? lerp(Q.appr, r.kpHome, (f - 0.52) / 0.08)
        : f < 0.82 ? r.kpHome : f < 0.9 ? lerp(r.kpHome, Q.up, (f - 0.82) / 0.08) : f < 0.95 ? lerp(Q.up, Q.dn, (f - 0.9) / 0.05) : lerp(Q.dn, r.kpHome, (f - 0.95) / 0.05);
    }
    if (!c.halt && !c.fault) A.pose(...q);
    if (r.held) r.held.visible = !!pj && f >= 0.42 && f < 0.95;
  }
  // 소재 식별셀 스캔 부스 로봇: 스캔 구간에 턴테이블 위 소재를 둘러 뷰마다 스캐너를 겨눈다 (뷰 수 = 피지컬AI 능동 스캔 5~9 · 자동화 고정 12 — js/matlcell.js)
  // 뷰마다 앞 30%는 옮겨 가고 나머지는 멈춰 패턴 빛을 쏜다 · 스캔 밖에서는 받침대 위로 접어 둔다 (이송 6축이 턴테이블에 드나듦)
  scanBotPose(c, r, busy, p) {
    const A = r.arm; if (!A?.native) return;
    const Pl = matlPlan(c.item), it = c.item, sw = busy ? Pl.scan.find(([a, b]) => p >= a && p < b) : null, P = r.root.parent;
    const loc = (v) => r.root.worldToLocal(P.localToWorld(v.clone()));
    r.sbHome ??= (() => { const v = loc(new THREE.Vector3(MATC.bot.x + 0.35, MATC.bot.y + 0.95, MATC.bot.z)); return A.ik(v.x, v.y, v.z, true); })();
    const key = `${it?.id}:${it?.matl?.views}`;
    if (sw && r.sbKey !== key) {   // 뷰 자세: 소재 가운데에서 0.55m · 로봇 쪽(서쪽) ±70° · 높이각 35°/60° 번갈아 · 툴 축이 가운데를 본다
      const n = Math.max(3, it?.matl?.views || 12), cy = MATC.fix.y + (PRODUCT_DIM[it?.product]?.[2] ?? 0.13) / 2, C = new THREE.Vector3(MATC.fix.x, cy, MATC.fix.z);
      r.sbViews = Array.from({ length: n }, (_, k) => {
        const ph = (-70 + (140 * k) / Math.max(1, n - 1)) * (PI / 180), th = (k % 2 ? 60 : 35) * (PI / 180);
        const d = new THREE.Vector3(-Math.cos(th) * Math.cos(ph), Math.sin(th), Math.cos(th) * Math.sin(ph)), at = C.clone().addScaledVector(d, 0.55), L = loc(at), dl = loc(at.clone().add(d)).sub(L);
        return A.ik(L.x, L.y, L.z, dl);
      });
      r.sbKey = key;
    }
    let q, on = false;
    if (sw && r.sbViews) {
      const n = r.sbViews.length, u = (p - sw[0]) / (sw[1] - sw[0]), j = Math.min(n - 1, Math.floor(u * n)), f = u * n - j, e = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
      const from = j ? r.sbViews[j - 1] : r.sbCur ?? r.sbHome, to = r.sbViews[j];
      q = f < 0.3 ? from.map((v, i) => v + (to[i] - v) * e(f / 0.3)) : to; on = f >= 0.3;
      if (f >= 0.3) r.sbCur = to.slice();
    } else { const cur = r.sbCur ?? r.sbHome; q = cur.map((v, i) => v + (r.sbHome[i] - v) * (busy || c.state !== 'BUSY' ? 0.15 : 0)); r.sbCur = q.slice(); }
    if (!c.halt && !c.fault) A.pose(...q);
    r.tool?.userData.scanOn?.(on && busy);
  }
  // 이송 6축이 든 소재 (xferPose r.xferLoc): 그리퍼 끝(hand) · 역 고정구(부스 booth · 세척기 wash · 측정실 cmm · 머시닝센터 mc) 위에 복제본을 둔다 — AMR 위에 없으면 true (tendPart가 지그만 남김)
  chainPart(c, P, r) {
    const car = this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm), loc = c.state === 'BUSY' && car ? r.xferLoc ?? 'amr' : 'amr';
    const FIX = /^(Jig_|Clamp_)/, holder = (pm) => { let h = null; pm.traverse((o) => { if (!h && o.children.some((ch) => FIX.test(ch.name))) h = o; }); return h; };
    if (car?.pm && r.tendHeldKey !== car.item?.id) {   // 대상물마다 소재만 든 복제본 (지그·클램프는 AMR에 남는다) — 운반체 그룹 기준
      r.tendHeld?.removeFromParent();
      const cl = car.pm.clone(true), h = holder(car.pm), src = h ? h.children.filter((o) => !FIX.test(o.name)) : [car.pm];
      cl.traverse((o) => { if (FIX.test(o.name)) o.visible = false; }); cl.visible = false; car.pm.parent.add(cl);
      const bb = new THREE.Box3(); for (const o of src) bb.expandByObject(o); bb.applyMatrix4(car.pm.parent.matrixWorld.clone().invert());
      r.tendHeld = cl; r.tendHeldKey = car.item?.id; r.tendTop = bb.isEmpty() ? 0.1 : bb.max.y - car.pm.position.y; r.tendBot = bb.isEmpty() ? 0 : bb.min.y - car.pm.position.y;
    }
    const H = r.tendHeld, par = car?.pm?.parent;
    if (H && par && loc === 'hand') {   // 손끝 아래 · 로봇 쪽을 잡은 만큼(gripOff) 바깥에 — tendPart와 같은 식
      const tip = par.worldToLocal(r.tip.getWorldPosition(new THREE.Vector3())), base = par.worldToLocal(r.root.getWorldPosition(new THREE.Vector3()));
      const h = new THREE.Vector3(tip.x - base.x, 0, tip.z - base.z), rad = h.length(), k = 1 - Math.min(1, Math.max(0, (rad - 0.75) / 0.42));
      if (rad > 1e-3) h.multiplyScalar(((r.swing ?? 0.32) * k * k * (3 - 2 * k) + (r.gripOff ?? 0)) / rad);
      H.position.set(tip.x + h.x, tip.y - 0.02 - r.tendTop, tip.z + h.z); H.quaternion.copy(car.pm.quaternion);
    }
    const FX = { booth: P.booth, wash: P.washer, cmm: P.room, mc: P.rwMc, scan: P.scanBooth, rack: P.qrack }[loc]?.fixture;
    if (H && par && FX) {   // 고정구 윗면에 놓인 채로
      const f = par.worldToLocal(FX.getWorldPosition(new THREE.Vector3()));
      H.position.set(f.x, f.y + (FX.name === 'ScanTable' ? 0 : 0.025) - r.tendBot, f.z); H.quaternion.copy(car.pm.quaternion);   // 고정구 윗면 = 중심 + 2.5cm (턴테이블은 원점이 윗면)
      if (FX.name === 'ScanTable' && FX.rotation.y) H.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FX.rotation.y));   // 스캔 턴테이블이 돌면 소재도 함께 (스캔이 끝나면 0으로 돌아옴)
    }
    const away = !!car && loc !== 'amr';
    if (H) H.visible = away;
    return away;
  }
  // 머신텐딩 소재 옮기기 (로봇 경로 구간 r.tendI — TEND_SEQ): 2~7 AMR에서 집어 들고 감 · 8~12 기계 안(척·테이블) · 13~18 꺼내 들고 옴 · 그 밖 AMR 지그 위
  // 대상물(AMR 위 제품)은 손에 들거나 기계 안에 있는 동안 지그에서 숨기고, 그리퍼 끝에 복제본을, 기계 안에는 기계 작업물을 보인다
  // hide: 다른 로봇(디버링셀 이송 6축)이 대상물을 가져가 있음 — 대상물은 숨기고 지그만 남긴다
  tendPart(c, P, { r = c.robots[0], hide = false } = {}) {
    const car = this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm), wp = P.machine ? (c.mcWp ??= P.machine.root.getObjectByName('ProcessWorkpiece')) : null;
    const i = c.state === 'BUSY' && car && r ? r.tendI ?? 0 : 0, held = (i >= 2 && i <= 7) || (i >= 13 && i <= 18), inMc = i >= 8 && i <= 12;
    // 대상물 모델에서 소재만 (지그 판·레일·클램프는 AMR에 남는다)
    const FIX = /^(Jig_|Clamp_)/, holder = (pm) => { let h = null; pm.traverse((o) => { if (!h && o.children.some((ch) => FIX.test(ch.name))) h = o; }); return h; };   // 지그 부품이 달린 노드 (모델마다 깊이가 다름)
    const parts = (pm) => { const h = holder(pm); return h ? h.children.filter((o) => !FIX.test(o.name)) : [pm]; };
    if (c.tendPm && c.tendPm !== car?.pm) { c.tendPm.visible = true; c.tendJig?.removeFromParent(); c.tendJig = null; c.tendPm = null; }   // AMR가 떠났으면(빠른 배속에서 한 프레임에 끝나도) 대상물을 다시 보인다
    if (r && car?.pm && r.tendHeldKey !== car.item?.id) {   // 대상물마다 그리퍼가 든 소재 복제본 — 운반체 그룹에 두고 매 프레임 손끝 아래에 수평으로 매단다 (머신텐딩은 툴 축이 수직이 아니라 손목에 붙이면 기울어 손목과 겹친다)
      r.tendHeld?.removeFromParent();
      const cl = car.pm.clone(true), src = parts(car.pm);   // 그리퍼가 든 복제본은 지그를 뺀 소재만
      cl.traverse((o) => { if (FIX.test(o.name)) o.visible = false; });
      cl.visible = false; car.pm.parent.add(cl);
      const bb = new THREE.Box3(); for (const o of src) bb.expandByObject(o);   // 소재 윗면 (운반체 그룹 기준)
      const inv = car.pm.parent.matrixWorld.clone().invert(); bb.applyMatrix4(inv);
      r.tendHeld = cl; r.tendHeldKey = car.item?.id; r.tendTop = bb.isEmpty() ? 0.1 : bb.max.y - car.pm.position.y; r.tendBot = bb.isEmpty() ? 0 : bb.min.y - car.pm.position.y;
    }
    if (r?.tendHeld && held && car) {   // 손가락 끝이 윗면에 닿게 수평으로 매단다 (윗면 = 손끝 2cm 아래)
      // 팔을 세워 접고 선회하는 동안(손끝이 로봇 축 0.75m 안 · 1.17m까지 줄여 감)은 아래팔(J4)이 소재 옆으로 들어가지 않게 소재를 로봇 바깥쪽으로 비켜 든다 — 집는 곳(AMR · 1.25m)·기계 테이블(1.7m)에서는 손끝 바로 아래
      const par = car.pm.parent, tip = par.worldToLocal(r.tip.getWorldPosition(new THREE.Vector3())), base = par.worldToLocal(r.root.getWorldPosition(new THREE.Vector3()));
      const h = new THREE.Vector3(tip.x - base.x, 0, tip.z - base.z), rad = h.length(), k = 1 - Math.min(1, Math.max(0, (rad - 0.75) / 0.42));
      if (rad > 1e-3) h.multiplyScalar(((r.swing ?? 0.32) * k * k * (3 - 2 * k) + (r.gripOff ?? 0)) / rad);   // gripOff: 소재 가운데보다 로봇 쪽을 잡은 거리 · swing: 접을 때 비켜 드는 거리 (세척기 이송은 앞이 세척기 벽이라 작게)
      r.tendHeld.position.set(tip.x + h.x, tip.y - 0.02 - r.tendTop, tip.z + h.z); r.tendHeld.quaternion.copy(car.pm.quaternion);
    }
    if (car?.pm) {   // 소재를 든·기계에 넣은 동안은 대상물을 숨기고 같은 자리에 지그(판·레일·클램프)만 남긴 복제본을 둔다 — 대상물 모델의 공정 표시는 매 프레임 다시 켜지므로 그룹째 숨긴다
      if (!c.tendJig || c.tendJig.userData.of !== car.pm) {
        c.tendJig?.removeFromParent(); const j = car.pm.clone(true); j.userData.of = car.pm;
        const h = holder(j); if (h) for (const o of h.children) o.visible = FIX.test(o.name); else j.visible = false;
        car.pm.parent.add(j); c.tendJig = j;
      }
      car.pm.visible = !(held || inMc || hide); c.tendJig.visible = held || inMc || hide; c.tendJig.position.copy(car.pm.position); c.tendJig.quaternion.copy(car.pm.quaternion); c.tendPm = car.pm;
    }
    if (r?.tendHeld) r.tendHeld.visible = held && !!car;
    if (wp) wp.visible = inMc;
  }
  // C07 NG 보수 (6축 · 자동화): C06이 기록한 결함(it.ngDefect — 종류 · 판넬 길이 방향 자리 u)을 로봇 쪽 가장자리에서 보수
  //  용접(spot): 결함 자리 양옆 두 점을 재용접(토치를 대고 불꽃) · 실러(seal): 결함 구간 0.3m를 따라 재도포 · 헤밍(hem): 결함 구간을 눌러 펴며 따라감
  //  작업 구간 진행 0.1 ~ 0.85: 대기 → 시작점 위 → 내려가 대기 → 보수 → 들어 → 대기 자세. 자리는 대상물마다 그 윗면에서 잰다
  reworkWork(c, r, car, p, rdt) {
    const A = r.arm, P = r.root.parent, d = c.item.ngDefect, sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); }, L = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
    r.slot ??= { x: r.root.position.x, z: r.root.position.z };
    const home = (r.rwHome ??= A.home.slice());
    if (r.rwKey !== c.item.id) {
      const bx = contactBox(car.pm, P); if (!bx) return;
      const [x0, , z0] = bx.min, [x1, y1, z1] = bx.max, f = Math.sign((z0 + z1) / 2 - r.slot.z) || 1, zE = (f > 0 ? z0 : z1) + f * 0.04;   // 로봇 쪽 가장자리 4cm 안
      const xd = x0 + (x1 - x0) * d.u, span = d.kind === 'spot' ? 0.06 : 0.15, xs = [Math.max(x0 + 0.05, xd - span), Math.min(x1 - 0.05, xd + span)];
      const loc = (x, y, z) => r.root.worldToLocal(P.localToWorld(new THREE.Vector3(x, y, z))), ik = (x, y, z) => { const v = loc(x, y, z); return A.ik(v.x, v.y, v.z, true); };
      const yAt = (x) => surfaceY(car.pm, P, null, x, zE, y1);
      const pts = d.kind === 'spot' ? xs.flatMap((x) => [ik(x, yAt(x) + 0.12, zE), ik(x, yAt(x) + 0.01, zE), ik(x, yAt(x) + 0.12, zE)])
        : Array.from({ length: 7 }, (_, k) => { const x = xs[0] + ((xs[1] - xs[0]) * k) / 6; return ik(x, yAt(x) + (d.kind === 'hem' ? 0.0 : 0.012), zE); });
      r.rwPts = { above: ik(xs[0], yAt(xs[0]) + 0.2, zE), pts }; r.rwKey = c.item.id;
    }
    const W = [0.1, 0.85], u = (p - W[0]) / (W[1] - W[0]), R = r.rwPts;
    let q = home, on = false;
    if (c.state === 'BUSY' && u >= 0 && u < 1) {
      if (u < 0.12) q = L(home, R.above, sm(0, 0.12, u));
      else if (u < 0.18) q = L(R.above, R.pts[0], sm(0.12, 0.18, u));
      else if (u < 0.86) { const n = R.pts.length, w = ((u - 0.18) / 0.68) * (n - 1), j = Math.min(n - 2, Math.floor(w)); q = L(R.pts[j], R.pts[j + 1], sm(0, 1, w - j)); on = d.kind === 'spot' ? j % 3 === 1 || (w - j < 0.4 && j % 3 === 0) : true; }
      else if (u < 0.93) q = L(R.pts.at(-1), R.above, sm(0.86, 0.93, u));
      else q = L(R.above, home, sm(0.93, 1, u));
    } else q = r.rwCur ? L(r.rwCur, home, 0.15) : home;
    A.pose(...q); r.rwCur = q.slice();
    r.reworkOn = on; r.reworkSpark = on && d.kind === 'spot';
  }
  // 롤러 헤밍 로봇 (고가반 6축 · 롤러 헤드): 핸들링 6축이 패널을 앤빌에 내려놓고 물러난 동안(HEM.win) — 패널 둘레 플랜지(가장자리 2.5cm 안)를 3번 돌며 접는다
  //  1패스 프리헤밍 30° (플랜지 윗면 1.4cm 위) → 2패스 60° (0.7cm) → 3패스 최종 90° (판 윗면) · 패스 사이에 시작점 위로 들었다 다시 내려간다 · 끝나면 위로 빠져 대기 자세
  rollerWork(c, r, car, p) {
    if (c.halt || c.fault || this.halted) return;
    const A = r.arm, P = r.root.parent, V = (x, y, z) => new THREE.Vector3(x, y, z), pm = car?.pm, L = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k), sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const ik = (x, y, z) => { const l = r.root.worldToLocal(P.localToWorld(V(x, y, z))); return A.ik(l.x, l.y, l.z, true); };
    r.rlHome ??= ik(HEM.roller.x - 0.2, 1.75, HEM.roller.z + 0.25);   // 대기: 받침 위로 팔을 세워 접는다 (앤빌·핸들링 로봇 쪽으로 뻗지 않게)
    const [w0, w1] = HEM.win, u = (p - w0) / (w1 - w0), go = (q) => { r.rlCur = r.rlCur ? L(r.rlCur, q, 0.15) : q.slice(); A.pose(...r.rlCur); };
    if (c.state !== 'BUSY' || !c.item || !pm || u <= 0 || u >= 1) { r.rollOn = false; r.rlPass = 0; go(r.rlHome); return; }
    if (r.rlKey !== c.item.id) {
      const b = contactBox(pm, P); if (!b) return;
      const e = 0.025, [x0, , z0] = b.min, [x1, y1, z1] = b.max, ring = [], step = 0.08;
      const corner = [[x0 + e, z0 + e], [x1 - e, z0 + e], [x1 - e, z1 - e], [x0 + e, z1 - e], [x0 + e, z0 + e]];   // 동쪽 아래(로봇 가까운 쪽)부터 한 바퀴
      const start = corner.findIndex(([x, z]) => x > (x0 + x1) / 2 && z < (z0 + z1) / 2), C = [...corner.slice(start, 4), ...corner.slice(0, start), corner[start]];
      for (let k = 1; k < C.length; k++) { const [ax, az] = C[k - 1], [bx, bz] = C[k], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step)); for (let j = 0; j < n; j++) ring.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]); }
      ring.push(C[C.length - 1]);
      const yAt = (x, z) => surfaceY(pm, P, null, x, z, y1);
      r.rlPlan = { passes: [0.014, 0.007, 0].map((o) => ring.map(([x, z]) => ik(x, yAt(x, z) + o, z))), above: ik(ring[0][0], y1 + 0.25, ring[0][1]) };
      r.rlKey = c.item.id;
    }
    const R = r.rlPlan, S = [0.06, 0.34, 0.62, 0.9];   // 패스마다 u 구간 (내려감 8% · 굴림 82% · 들어 올림 10%)
    let q = R.above, on = false, pass = 0;
    if (u < S[0]) q = L(r.rlHome, R.above, sm(0, S[0], u));
    else if (u >= S[3]) q = L(R.above, r.rlHome, sm(S[3], 1, u));
    else {
      const k = S.findIndex((s0, i) => i < 3 && u >= s0 && u < S[i + 1]), v = (u - S[k]) / (S[k + 1] - S[k]), pts = R.passes[k];
      if (v < 0.08) q = L(R.above, pts[0], sm(0, 0.08, v));
      else if (v < 0.9) { const w = ((v - 0.08) / 0.82) * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(w)); q = L(pts[j], pts[j + 1], w - j); on = true; pass = k + 1; }
      else q = L(pts[pts.length - 1], R.above, sm(0.9, 1, v));
    }
    A.pose(...q); r.rlCur = q.slice(); r.rollOn = on; r.rlPass = pass;
  }
  // 반전 앤빌 테이블: 다음 패널 제품의 앤빌이 위가 되도록 사이클 시작(패널을 앤빌로 옮기기 전 · 진행 0 ~ 0.08)에 180° 뒤집는다 · 헤밍이 끝나면 유도 코일이 경화(밝아짐)
  anvilAnim(c, busy, p, rdt) {
    const A = c.parts.anvil, want = c.item?.product === 'door' ? PI : 0;
    if (busy && p < 0.09) A.ang += Math.sign(want - A.ang) * Math.min(Math.abs(want - A.ang), (PI / (0.08 * c.cur || 4)) * (rdt || 0));
    else if (!busy && !c.item) { /* 대기: 그대로 */ }
    else A.ang = want;
    A.flip.rotation.x = A.ang;
    const [w0, w1] = HEM.win, cure = busy ? sm01((p - (w0 + (w1 - w0) * 0.9)) / 0.04) * (1 - sm01((p - w1 - 0.02) / 0.02)) : 0, rl = c.robots.find((r) => r.roller);
    A.coilMat.emissiveIntensity = 0.05 + cure * 3;
    c.parts.screen?.emissive?.setHex(rl?.rollOn ? 0xf5b82e : cure > 0.1 ? 0xff7a2a : 0x2c7f9e);
  }
  animCell(c, t, rdt, dts) {
    const P = c.parts, busy = c.state === 'BUSY' && !c.halt && !c.fault, p = c.progress, st = c.halt ? 'ESTOP' : c.fault ?? c.state;
    c.light.userData.set(st, t);
    // 양팔 로봇(AMMR): 대상물(셀에 선 AMR 위 제품)에 다가가 상체를 숙이고 두 손을 댄다 — 첫 대는 작업, 둘째 대는 고정 · 진행 0.88부터 물러나 AMR이 나가기 전 제자리
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const car = busy && c.robots.some((r) => r.body) ? this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm) : null;
    // 6축·협동로봇(머신텐딩 제외): 셀에 선 AMR 위 대상물 윗면의 자기 점 2~4곳에 손끝을 대고 작업 — 셀 설비가 대상물 위에서 움직이는 구간(헤밍 램 · CMM 탐침 · 디버링 드릴·세척)은 비켜 그 앞뒤에서
    const W = CELL_WORK[c.def.type], wcar = W && busy ? this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm) : null;
    // CMM: 남쪽 로봇 작업 구간 = 에어 블로·소재 온도 측정(측정 전) · 접촉 리워크(1차 측정 NG — 이송 6축이 AMR 지그에 돌려놓은 뒤) — js/cmmcell.js CMM_PLANS
    // 소재 식별셀: 남쪽 로봇 작업 구간 = LIBS 재질 분석 프로브 접촉 (이송 6축이 집기 전) — js/matlcell.js MATL_PLANS
    const Pl = c.def.type === 'cmm' ? cmmPlan(c.item) : c.def.type === 'matid' ? matlPlan(c.item) : null, win = Pl ? (Pl.hand && p >= Pl.hand[0] - 0.005 ? Pl.hand : Pl.blow ?? Pl.probe) : W ? [W.from, W.to] : null;
    const crew = c.robots.filter((o) => !o.xfer);   // 셀 이송 6축(설비에 딸림)은 접촉 작업 자리 나누기에서 뺀다
    c.robots.forEach((r, i) => {
      if (r.xfer) { r.anim(busy, t + r.phase, p); return; }
      if (r.scanBot) { this.scanBotPose(c, r, busy, p); return; }
      if (r.kitPicker) { this.kitPickerPose(c, r, busy, p, t); return; }
      if (r.roller) { this.rollerWork(c, r, wcar, p); return; }   // 롤러 헤밍: 앤빌 위 패널 플랜지를 3번 따라가며 접는다
      if (c.def.type === 'hem' && r.tool && P.anvil) { this.hemWork(c, r, wcar, hemHandQ(p)); return; }   // 헤밍: AMR 위 패널을 앤빌에 올리고 헤밍 뒤 꺼내 AMR에 다시 올림
      if (c.def.type === 'locate' && r.arm?.native && !r.body) { r.slot ??= { x: r.root.position.x, z: r.root.position.z }; this.locateWork(c, r, wcar, p); return; }   // 안착·보정: 비전 측정 → 패널을 잡아 살짝 들어 기준핀 자리로 옮겨 내려놓음
      if (c.def.type === 'rework' && r.arm?.native && !r.body && wcar && c.item?.ngDefect) { this.reworkWork(c, r, wcar, p, rdt); return; }   // C07: C06이 찾은 결함 자리를 보수
      if (W && r.arm?.native && !r.machineTargets && !r.body) {
        const seed = Math.abs(Number(String(c.item?.id ?? '').replace(/\D/g, '')) || 0);
        for (const o of crew) o.slot ??= { x: o.root.position.x, z: o.root.position.z };
        const n = W.kind === 'trace' || W.kind === 'scan' ? 8 : 2 + (seed * 7 + i * 2) % 3, u = wcar ? (p - win[0]) / (win[1] - win[0]) : 0;   // 따라 긋기·스캔은 경유점을 촘촘히 (관절 보간으로 점 사이에서 툴 끝이 처지지 않게)
        // 마주 보는 로봇(통로 반대편에 같은 x 대)이 있으면 반 점씩 엇갈려 — 한쪽이 점에 내려가 있을 때 다른 쪽은 위로 옮겨 간다
        const facing = crew.some((o) => o !== r && o.slot && Math.sign(o.slot.z) === -Math.sign(r.slot.z) && Math.abs(o.slot.x - r.slot.x) < 0.5), d = facing ? 0.5 / 4 : 0;
        let uu = !facing ? u : r.slot.z < 0 ? u / (1 - d) : (u - d) / (1 - d);
        // 용접: 두 로봇이 같은 짧은 끝(후드 — 긴 가장자리 밑은 지그라 아래 전극이 못 들어감)을 용접하면 앞 절반 · 뒤 절반을 나눠 차례로 — 동시에 끝 가운데로 오면 아래팔(J4)끼리 닿는다
        if (c.def.type === 'spot' && facing && r.pwEnd && r.pwKey === `${c.item?.id}:${i}`) uu = r.slot.z < 0 ? u * 2 : (u - 0.5) * 2;
        const pick = r.held ? PICK_AT[c.def.type]?.(r) : null;   // 부품함 (키팅 빈 · 힌지 트레이)
        pointWork(r, { key: `${c.item?.id}:${i}`, box: () => wcar && contactBox(wcar.pm, r.root.parent), obj: wcar?.pm, n, kind: W.kind, u: uu, robots: crew, align: c.def.type === 'spot', pick, spin: c.def.type === 'mount', vertical: ['matid', 'deburr', 'cmm'].includes(c.def.type),
          support: c.def.type === 'spot' ? () => wcar && supportBox(wcar.g, r.root.parent, wcar.pm, (contactBox(wcar.pm, r.root.parent)?.min[1] ?? BELT_Y) - 0.15) : null });   // 용접: 판 밑 지그 — 아래 전극이 들어갈 가장자리 고르기
        if (r.tool && wcar?.pm) this.toolMarks(c, r, wcar.pm, rdt);   // 용접 불꽃·자국 · 실러 비드 · 스캔 빛 · 디버링 칩은 툴 끝이 대상물에 닿아(스캔은 위를 지나) 있는 동안 그 자리에
        else if (r.tool) { r.tool.userData.scanOn?.(false); for (const f of [r.fx, r.fxChip]) if (f) stepSparks(f, false, { x: 0, y: 0, z: 0 }, rdt); }   // 대상물이 없으면 스캔 빛·칩·물안개 끔
        if (r.held) r.held.visible = !!r.pwHeld && !!wcar;
        if (c.def.type === 'kit') { if (r.kitKey !== c.item?.id) { r.kitKey = c.item?.id; r.kitTaken = 0; } if (r.pwHeld && r.pwIdx >= 0) r.kitTaken = Math.max(r.kitTaken, r.pwIdx + 1); }   // 키트 트레이에서 집어 간 부품 수 (kitAnim)   // 용접 불꽃·자국 · 실러 비드는 툴 끝이 대상물에 닿아 있는 동안 그 자리에
        return;
      }
      // CMM: 작업 구간(win)의 앞 1/4에 다가가 숙이고 뒤 1/4에 물러난다 — 이송 6축이 AMR 지그에 오기 전에 제자리
      const wl = win ? (win[1] - win[0]) / 4 : 0, [a0, a1, b0, b1] = Pl ? [win[0], win[0] + wl, win[1] - wl, win[1]] : [0.03, 0.1, 0.88, 0.95];
      const ap = car && r.slot ? sm(a0, a1, p) * (1 - sm(b0, b1, p)) : 0, box = ap > 0 ? contactBox(car.pm, r.root.parent) : null;
      if (box && ammrContact(r, { slot: r.slot, box, ap, hold: i > 0, t: t + r.phase, fixX: !!Pl, holdArm: Pl ? 0 : undefined })) return;   // CMM · 소재 식별셀: 도킹 정면에서 곧게 다가가 한 손(왼팔)은 소재를 누르고 다른 손으로 작업 (접촉 리워크 · 재질 프로브)
      if (r.slot && r.contactKey) { r.root.position.x = r.slot.x; r.root.position.z = r.slot.z; r.body?.pose(); }
      // C07 휴머노이드(피지컬AI): 결함 자리 앞으로 옆걸음해 두 손을 댄다 (왼손 누름 · 오른손 보수 툴)
      if (c.def.type === 'rework' && r.humanoidArms) {
        r.hx0 ??= r.root.position.x; const d = c.item?.ngDefect, on = busy && d ? sm(0.05, 0.12, p) * (1 - sm(0.83, 0.9, p)) : 0;
        let tx = r.hx0; if (d && car?.pm) { const bx = contactBox(car.pm, r.root.parent); if (bx) tx = Math.max(r.hx0 - 0.45, Math.min(r.hx0 + 0.45, bx.min[0] + (bx.max[0] - bx.min[0]) * d.u)); }
        r.root.position.x = r.hx0 + (tx - r.hx0) * on;
      }
      r.anim(busy, t + r.phase, p);
    });
    // 디버링셀 이송 6축: AMR 지그 → 그리퍼 → 부스 → 세척기 → AMR 지그 / 머신텐딩: AMR 지그 → 그리퍼 → 기계 → 그리퍼 → AMR 지그 (지그·클램프는 AMR에 남는다)
    c.workersG.children.forEach((w, i) => workerCycle(w, busy, p, 3, (w.userData.baseYaw ??= w.rotation.y), { binSide: i ? -1 : 1 }));   // 레거시 작업자: 부품함 ↔ 대상물 수작업 사이클
    if (P.proj) {   // C07 수리 부스: AI 프로젝터가 결함 자리를 비추고, 수리 작업자는 그 앞으로 옆걸음해 보수 (스폿 결함은 휴대용 스폿건 불꽃)
      const d = c.item?.ngDefect, rc = busy && d ? this.carriers.find((k) => k.at === c.id && k.state === 'work' && k.pm) : null, bx = rc ? contactBox(rc.pm, c.robotsG) : null;
      const on = bx ? sm(0.05, 0.12, p) * (1 - sm(0.83, 0.9, p)) : 0, dx = bx ? bx.min[0] + (bx.max[0] - bx.min[0]) * d.u : 0;
      for (const w of c.workersG.children) if (w.userData.repair) { w.userData.x0 ??= w.position.x; w.position.x = w.userData.x0 + (Math.max(-0.9, Math.min(0.9, dx)) - w.userData.x0) * on; }
      P.proj.beam.position.x = dx; P.proj.mat.opacity = bx && !d.fixed ? 0.3 * on : 0;
      P.repairAt = bx && on > 0.9 && d.kind === 'spot' && c.workersG.children.some((w) => w.userData.repair) && Math.sin(t * 5) > 0 ? { x: dx, y: bx.max[1] + 0.02, z: 0 } : null;
    }
    const xr = P.washer || P.room || P.scanBooth ? c.robots.find((x) => x.xfer) : null, away = xr ? this.chainPart(c, P, xr) : false;
    if ((c.def.type === 'mill5' || c.def.type === 'turn' || c.def.type === 'deburr') && P.machine) this.tendPart(c, P, { hide: away });
    else if (xr) this.tendPart(c, P, { r: null, hide: away });   // CMM · 소재 식별셀: 소재가 측정실·머시닝센터 / 스캔 부스·교체 작업대·그리퍼에 있는 동안 AMR에는 지그만
    const ty = c.def.type, it = c.item, legacy = this.mode === 'traditional';
    if (P.gateSign) {
      const entering = busy && p < 0.18;
      P.scan.visible = entering; if (entering) P.scan.position.x = P.gateX + Math.sin(t * 9) * 0.12;
      const col = it ? (it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : 0xffffff;
      P.ringMat.color.setHex(col); P.ringMat.emissive?.setHex(col); P.ringMat.emissiveIntensity = entering ? 6 : it ? 1.4 : 0.4;
      const cph = ty === 'cmm' && it ? cmmPhase(cmmPlan(it), p) : null, mph = ty === 'matid' && it ? matlPhase(matlPlan(it), p) : null;
      const text = !it ? '대기 중' : ty === 'cmm' ? `${it.id} · ${this.Z.products[it.product].label} · ${cph === 'move' && it.rework ? 'NG → 리워크' : CMM_PHASE_KO[cph] ?? '합격'}` : ty === 'matid' && mph ? `${it.id} · ${this.Z.products[it.product].label} · ${MATL_PHASE_KO[mph]}` : `${it.id} → ${this.Z.products[it.product].label} 라인`;
      drawGate(P.gateSign, P.gateTitle, text, it ? hex(it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : '#e6edf3');
    }
    if (P.markMat) P.markMat.emissiveIntensity = c.markT != null && this.time - c.markT < 1.2 ? 6 : 0.35;   // 시리얼 마킹·판독 순간
    if (ty === 'hem' && P.anvil) { if (!c.halt && !this.halted) this.anvilAnim(c, busy && !c.fault, p, dts); return; }
    // 디버링셀은 앞부분(TEND_END)만 머시닝센터 가공 — 진행률을 나눠 주고, 틸팅 크래들은 가공 중에만 기울인다 · 그 뒤 부스·세척기 (animXfer)
    const tq = cellTendQ(ty, p), tb = busy && (ty !== 'deburr' || p < TEND_END);
    if (P.machine) {
      P.machine.update({ busy: tb, progress: tq, time: t, rdt, dts, frozen: !!c.halt || this.halted, fault: !!c.fault, open: c.robots.some((r) => r.tendInside && !r.xfer) || undefined });   // 팔이 기계 안에 있으면 문을 열어 둔다
      if (P.machine.cradle && !c.halt) P.machine.cradle.rotation.x = P.machine.cutting ? Math.sin(tq * PI * 4) * 0.3 : 0;
      if (P.washer && P.booth) this.animXfer(c, P, busy, p, t, rdt, dts);
      return;
    }
    switch (ty) {
      case 'kit': if (P.kit) this.kitAnim(c, P.kit, busy, p, t); break;
      case 'locate': P.scan.visible = busy && p > 0.05 && p < 0.45; if (P.scan.visible) P.scan.position.x = Math.sin(p * PI * 6) * 0.7; break;   // 비전 측정 → 로봇 보정 (locateWork)
      case 'spot': if (P.dock) P.dock.set(P.dock.k + ((busy && p > 0.03 && p < 0.97 ? 1 : 0) - P.dock.k) * Math.min(1, rdt * 4));
        stepSparks(P.sparks, legacy && busy && Math.sin(t * 6) > -0.3, { x: -0.3, y: BELT_Y + 0.45, z: 0 }, rdt, 2.2, -7); for (const r of c.robots) { if (r.sparks) stepSparks(r.sparks, !!r.weldOn && busy, r.sparkAt, rdt, 1.5, -9); if (r.flash && !busy) r.flash.visible = false; } break;   // 수작업(레거시)만 셀 가운데 — 로봇은 툴 끝 (toolMarks)
      case 'seal': P.lamp.emissiveIntensity = busy ? 1.4 : 0.5; for (const r of c.robots) if (r.hose) this.sealHose(c, r); break;
      case 'mount': P.screen.emissive.setHex(busy && Math.sin(t * 10) > 0 ? 0xf5b82e : 0x3ddc84); break;
      case 'vision': { const sc = busy && !legacy; P.scan.visible = sc; if (sc) P.scan.position.x = Math.sin(p * PI * 2) * 0.6; P.ringMat.emissiveIntensity = sc && p > 0.45 && p < 0.55 ? 8 : 0.4; break; }
      case 'rework': { const r0 = c.robots.find((o) => o.reworkOn); const tp = r0 ? P.sparks.parent.worldToLocal(r0.tip.getWorldPosition(new THREE.Vector3())) : P.repairAt; stepSparks(P.sparks, !!tp && (r0 ? r0.reworkSpark : true), tp ?? { x: 0, y: 0, z: 0 }, rdt, 1.2, -6); break; }   // 보수 용접 불꽃은 토치 끝에서
      case 'mill5': case 'turn': case 'deburr': {   // 간이 머시닝센터 (모델이 없을 때) — 디버링셀은 tq · tb (앞부분만 가공)
        const open = !it || tq < 0.15 || tq > 0.85 || c.robots.some((r) => r.tendInside && !r.xfer) ? 1 : 0;
        c.doorK = (c.doorK ?? 0) + (open - (c.doorK ?? 0)) * Math.min(1, dts * 4); P.door.position.x = c.doorK * 1.25;
        const cut = tb && tq > 0.18 && tq < 0.82;
        if (ty !== 'turn') {
          if (cut) P.spindle.rotation.y += dts * 50;
          P.head.position.y += ((cut ? 1.85 + Math.sin(t * 3) * 0.05 : 2.05) - P.head.position.y) * Math.min(1, rdt * 5);
          P.head.position.x = TEND.table.x + (cut ? Math.sin(tq * PI * 9) * 0.2 : 0.7 * (tb ? 1 : 0));
          P.cradle.rotation.x = cut ? Math.sin(tq * PI * 4) * 0.35 : P.cradle.rotation.x * 0.9;
          if (cut) P.table.rotation.y += dts * 0.8;
        } else {
          if (cut) P.chuck.rotation.y += dts * 9;
          P.turret.position.x = TEND.table.x + 0.9 - (cut ? 0.3 + Math.sin(tq * PI * 5) * 0.12 : 0);
        }
        stepSparks(P.coolant, cut, { x: TEND.table.x, y: 1.25, z: P.tz }, rdt, 1.1, -4);
        stepSparks(P.chips, cut, { x: TEND.table.x, y: 1.15, z: P.tz }, rdt, 1.6, -8);
        P.screen.emissive.setHex(cut ? 0x58c4ff : 0x3ddc84); P.edgeLed.emissive.setHex(legacy ? 0x333333 : 0x3ddc84);
        if (P.washer && P.booth) this.animXfer(c, P, busy, p, t, rdt, dts);
        break;
      }
      case 'matid': {
        // 스캔 부스 문은 이송 6축이 드나드는 동안만 열림 · 스캔 중에는 턴테이블이 한 바퀴 돌고 실내 조명을 끈다(구조광 대비) · 정지·고장 중에는 그 자리
        const Pl = matlPlan(it), Sb = P.scanBooth, q = busy ? p : c.state === 'BUSY' ? null : 0;
        if (q != null) Sb.doorK = cmmDoorK(q, Pl.doors.scan);
        Sb.shutter.scale.y = 1 - 0.95 * Sb.doorK;
        const ph = busy ? matlPhase(Pl, p) : null, scanning = ph === 'scan' || ph === 'rescan', sw = scanning ? Pl.scan.find(([a, b]) => p >= a && p < b) : null;
        if (q != null && !c.halt && !c.fault) Sb.fixture.rotation.y = sw ? ((p - sw[0]) / (sw[1] - sw[0])) * PI * 2 : 0;
        Sb.lightMat.emissiveIntensity = scanning ? 0.06 : 0.35;
        const rej = it?.matl?.kind === 'reject' && (ph === 'swap' || (Pl.scan[1] && p < Pl.scan[1][0] && p >= Pl.scan[0][1]));
        Sb.screen.emissive.setHex(rej ? 0xff5a5a : ph === 'fit' ? 0x58c4ff : 0x3ddc84); Sb.leds.emissiveIntensity = ph === 'fit' ? 3 + Math.sin(t * 20) : 1.2;
        Sb.lampMats.forEach((m, k) => (m.emissiveIntensity = k === (c.fault || rej ? 2 : Sb.doorK > 0.05 ? 1 : 0) && (c.fault || rej || Sb.doorK > 0.05 || scanning) ? 2.5 : 0.25));
        const nq = Math.min(4, this.sim?.matl?.stats.reject ?? 0); P.qrack.qBoxes.forEach((b, k) => (b.visible = k < nq));   // 격리 통: 격리된 소재 (최대 4개 표시)
        break;
      }
      case 'cmm': {
        // 측정실·머시닝센터 문은 이송 6축이 드나드는 동안만 열림 · 브리지는 측정·각인 동안만 지그 위 (그 밖은 서쪽 끝) — 진행률로 정해 배속과 관계없음 · 정지·고장 중에는 그 자리
        const Pl = cmmPlan(it), Rm = P.room, M = P.rwMc, q = busy ? p : c.state === 'BUSY' ? null : 0;
        if (q != null) { Rm.doorK = cmmDoorK(q, Pl.doors.cmm); M.doorK = cmmDoorK(q, Pl.doors.mc); }
        Rm.shutter.scale.y = 1 - 0.95 * Rm.doorK; M.shutter.scale.y = 1 - 0.95 * M.doorK;
        const ph = busy ? cmmPhase(Pl, p) : null, meas = ph === 'meas' || ph === 'remeas', top = CMMC.fix.y + (PRODUCT_DIM[it?.product]?.[2] ?? 0.13);
        const mw = meas ? Pl.meas.find(([a, b]) => p >= a && p < b) : null, u = mw ? (p - mw[0]) / (mw[1] - mw[0]) : 0, fxL = CMMC.fix.x - CMMC.room.x, parkL = CMMC.park - CMMC.room.x;
        if (q != null && !c.halt && !c.fault) {
          const k = Math.max(0, ...Pl.bridge.map(([a, b]) => sm(a, a + 0.008, q) * (1 - sm(b - 0.006, b, q))));   // 문이 다 닫힌 뒤 들어가고, 문이 열리기 전에 비킨다
          P.bridge.position.x = parkL + (fxL - parkL) * k + (meas ? (Math.sin(u * PI * 3) * 0.2 - 0.06) * k : 0);   // 지그 −0.26 ~ +0.14 — 브리지 다리가 동쪽 유리벽(지그 +0.27)에 닿지 않게
          P.car.position.z = meas ? Math.sin(u * PI * 6) * 0.25 : 0;
        }
        const tap = meas ? Math.abs(Math.sin(u * PI * 7)) : 0, qy = 0.25 - (0.25 - (top - 1.04)) * tap;   // 탐침 끝 = 캐리지 + 램 − 1.08m → 소재 윗면에 닿을 때 램 top − 1.04
        P.quill.position.y += (qy - P.quill.position.y) * Math.min(1, rdt * 8);
        P.tipMat.emissiveIntensity = tap > 0.95 ? 6 : 1.2;
        if (ph === 'mark' && P.markMat) P.markMat.emissiveIntensity = 4 + Math.sin(t * 30) * 2;   // DataMatrix 레이저 각인 (브리지 캐리지 옆 헤드)
        const lv = this.sim?.cmm?.levels?.room, doorOpen = Rm.doorK > 0.05;
        Rm.lightMat.emissiveIntensity = meas ? 1.1 : 0.35; Rm.tempMat.emissive.setHex(lv === 'alarm' ? 0xff5a5a : lv === 'warn' ? 0xf5b82e : 0x58c4ff);
        Rm.lampMats.forEach((m, k) => (m.emissiveIntensity = k === (c.fault ? 2 : doorOpen ? 1 : 0) && (c.fault || doorOpen || meas) ? 2.5 : 0.25));
        P.screen.emissive.setHex(it?.rework && (!Pl.meas[1] || p < Pl.meas[1][0]) ? 0xf5b82e : meas ? 0x58c4ff : 0x3ddc84);
        // 리워크 머시닝센터: 문이 닫힌 뒤 주축 머리가 내려와 바이스 위 소재 윗면을 따라 재가공 · 절삭유·칩
        const cut = ph === 'mc', mu = cut ? (p - Pl.mc[0]) / (Pl.mc[1] - Pl.mc[0]) : 0, bl = cut ? Math.min(1, mu * 8, (1 - mu) * 8) : 0;
        if (!c.halt && !c.fault) { M.head.position.y = MC_HEAD_UP + (top + 0.35 - MC_HEAD_UP) * bl + (cut ? Math.abs(Math.sin(mu * PI * 6)) * 0.02 : 0); M.head.position.x = M.fx + Math.sin(mu * PI * 4) * 0.15 * bl; }
        if (cut) M.spindle.rotation.y += dts * 60;
        const at = { x: M.head.position.x, y: top + 0.05, z: 0 };
        stepSparks(M.coolant, cut && bl > 0.9, at, rdt, 1.1, -4); stepSparks(M.chips, cut && bl > 0.9, at, rdt, 1.6, -8);
        M.screen.emissive.setHex(cut ? 0x58c4ff : 0x3ddc84);
        M.lampMats.forEach((m, k) => (m.emissiveIntensity = k === (c.fault ? 2 : cut ? 0 : M.doorK > 0.05 ? 1 : -1) ? 2.5 : 0.25));
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
    this.boardEl.innerHTML = `<b>${this.Z.name}</b><span>${ps.map(([k, v]) => `${v.label} <i>${g[k] ?? 0}</i>`).join(' · ')} · UPH <i>${s.uph}</i> · 가동 셀 <i>${s.busy}/${this.order.length}</i>${this.Z.ng ? ` · NG <i>${this.stats.ng}</i>` : ''}${this.Z.rework ? ` · 리워크 <i>${this.stats.rework}</i>` : ''}${(() => { const H = this.sim?.serials; if (!H) return ''; const k = H.zoneCounts(this.Z.key); return ` · 시리얼 <i>${H.stats.byZone[this.Z.key] ?? 0}</i>${k.hold ? ` · 출하 보류 <i>${k.hold}</i>` : ''}${k.scrap ? ` · 폐기 <i>${k.scrap}</i>` : ''}`; })()}</span>`;
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
