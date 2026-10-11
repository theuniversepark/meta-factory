// 메타팩토리 확장 Zone — 정밀조립Zone(가운데)을 중심으로 뒤쪽(화면 위)에 A-1 유연생산Zone, 앞쪽(화면 아래)에 A-2 적응가공Zone을 둔다.
// 셀 구성·제품·사이클·로봇은 상위 폴더의 flexible-manufacturing(유연생산Zone)·adaptive-machining(적응가공Zone) 프로젝트를 따른다.
// 두 Zone은 각자 흐름 시뮬레이션으로 돈다: 투입 → 제품별 셀 경로 → 적재. 대상물은 지그 AMR에 실려 셀 중앙에 정차하고,
// 셀 하나에는 대상물 하나만 들어간다 — 다음 셀이 차 있으면 지금 셀에서 기다린다(출구 대기). 적재 후 빈 AMR은 복귀로로 투입 대기열에 선다.
// 시계는 정밀조립Zone 시뮬레이션과 같다(배속·일시정지), 라인 전체 비상정지·보호정지 때는 함께 멈춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KIT } from './factory.js';
import { blenderOn, cloneAsset, RENDER } from './blender.js';
import { pointAt, pathLength } from './line.js';

const { std, emis, mesh, box, cyl, put, MAT, BELT_Y, AMMR, makeRobot, makeSparks, stepSparks, makeWorker, makeHumanoid, makeCarrierAMR, makeStackLight, cellBase, buildWeld, buildGate, buildVision } = KIT;
const PI = Math.PI;
const PC = { shared: 0x2bb3a6, hood: 0xf0a030, door: 0x9a6bff, hblock: 0xf0a030, rcover: 0x9a6bff, ng: 0xd23b3b };
const USE_CLS = { hood: 'doortrim', hblock: 'doortrim', door: 'eaxle', rcover: 'eaxle' };   // 셀 라벨 색 (주황·보라)
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ── Zone 정의 (Zone 로컬 좌표, origin이 Zone 가운데) ─────────────────
// robot: [레거시, 자동화, 피지컬AI] — 레거시는 작업자 수작업
const TOP = -4.6, BOT = 4.6, MID = 0;
export const EXTRA_ZONES = [
  {
    key: 'flex', code: 'A-1', name: '유연생산Zone', sub: '후드 · 도어 혼류 (삼진산업)', origin: { x: -17, z: -38 }, accent: 0x2f9bff,
    hall: { x0: -51, x1: 12, z0: -56, z1: -20 },
    products: { hood: { label: '후드', full: "LT2 후드 Ass'y" }, door: { label: '도어', full: '상용트럭 도어 Ass\'y' } },
    mix: { hood: 1, door: 1 },
    cells: {
      C01: { type: 'kit', label: '공급·키팅', product: 'shared', use: '부품 ID 인식·혼류 판별·키팅', x: -20, z: TOP, side: -1, cycle: 58, robot: ['cobot', 2, 'ammr', 2] },
      C02: { type: 'locate', label: '안착·보정', product: 'shared', use: '지그 안착·비전 6DoF 보정', x: -11, z: TOP, side: -1, cycle: 42, robot: ['articulated', 1] },
      C03: { type: 'spot', label: '가접·본용접', product: 'shared', use: '스폿용접 2대 협업', x: -2, z: TOP, side: -1, cycle: 109, robot: ['articulated', 2] },
      C04: { type: 'seal', label: '실링', product: 'shared', use: '실러 도포·비드 검사', x: 7, z: TOP, side: -1, cycle: 46, robot: ['articulated', 1] },
      C05: { type: 'hem', label: '헤밍', product: 'shared', use: '헤밍 프레스 결합', x: 16, z: TOP, side: -1, cycle: 52, robot: ['articulated', 1] },
      C10: { type: 'mount', label: '정밀 장착', product: 'door', use: '도어 전용 · 힌지·스트라이커 장착', x: 15, z: MID, rot: PI, side: -1, cycle: 102, robot: ['articulated', 2] },
      C06: { type: 'vision', label: '치수·외관검사', product: 'shared', use: '갭·단차·외관 판정 (NG → C07)', x: 7, z: BOT, rot: PI, side: -1, cycle: 30, robot: ['none', 0] },
      C07: { type: 'rework', label: 'NG·재작업', product: 'ng', use: 'NG 재용접·재도포 보수 → 재검', x: -2, z: MID, rot: PI, side: -1, cycle: 120, robot: ['articulated', 1, 'humanoid', 1] },
    },
    routes: { hood: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'], door: ['C01', 'C02', 'C03', 'C04', 'C05', 'C10', 'C06'] },
    src: { x: -28, z: 0 }, sink: { x: -14, z: BOT, rot: PI },
    // 셀 사이 AMR 경유점 (flexible-manufacturing ZONE_PATHS) — 오른쪽 통제 이송 통로 x 22, 합류 대기 차로 ±0.75m
    paths: {
      'C05>C06': [{ x: 22, z: TOP }, { x: 22, z: BOT + 0.75 }, { x: 9, z: BOT + 0.75 }],
      'C05>C10': [{ x: 22, z: TOP }, { x: 22, z: MID }, { x: 17, z: MID }],
      'C10>C06': [{ x: 12.7, z: MID }, { x: 11.2, z: BOT - 0.75 }, { x: 9, z: BOT - 0.75 }],
      'C06>SINK': [{ x: 4.7, z: BOT }, { x: 0, z: BOT + 0.75 }, { x: -12, z: BOT + 0.75 }],
      'C06>C07': [{ x: 4.7, z: BOT }, { x: 1.4, z: MID }, { x: 0, z: MID }],
      'C07>SINK': [{ x: -4.3, z: MID }, { x: -8.2, z: BOT - 0.75 }, { x: -12, z: BOT - 0.75 }],
    },
    ret: [{ x: -14, z: 7.6 }, { x: -30.6, z: 7.6 }, { x: -30.6, z: 0 }],   // 적재 → 남쪽 복귀로 → 투입 왼쪽 진입로
    ng: { at: 'C06', to: 'C07', rate: 0.07 },
    amr: { count: 7, speed: 1.1, ret: 1.5 }, load: 6, unload: 5,
  },
  {
    key: 'adapt', code: 'A-2', name: '적응가공Zone', sub: '유압블록 · 리어커버 혼류', origin: { x: 0, z: 37 }, accent: 0xff7a45,
    hall: { x0: -51, x1: 38, z0: 20, z1: 54 },
    products: { hblock: { label: '유압블록', full: '유압 매니폴드 블록' }, rcover: { label: '리어커버', full: '다이캐스팅 리어커버' } },
    mix: { hblock: 1, rcover: 1 },
    cells: {
      MATL: { no: '1', type: 'matid', label: '소재 식별·3D측정셀', product: 'shared', use: '소재 판별·가공여유 측정', x: -18, z: 0, cycle: 8, robot: ['cobot', 2, 'ammr', 2] },
      HB_MILL: { no: '2', type: 'mill5', label: '유압블록 5축 가공셀', product: 'hblock', use: '6면 밀링·드릴·탭', x: -5, z: BOT, cycle: 16, robot: ['articulated', 1] },
      HB_DEBR: { no: '3', type: 'deburr', label: '유압블록 사선·디버링셀', product: 'hblock', use: '사선홀·디버링·세척', x: 7, z: BOT, cycle: 14, robot: ['cobot', 2] },
      RC_MILL: { no: '4', type: 'mill5', label: '리어커버 정밀절삭셀', product: 'rcover', use: '5축 정밀 절삭', x: -5, z: TOP, side: -1, cycle: 18, robot: ['articulated', 1] },
      RC_TURN: { no: '5', type: 'turn', label: '리어커버 선삭·AI품질셀', product: 'rcover', use: '보어 선삭·품질예측', x: 7, z: TOP, side: -1, cycle: 14, robot: ['articulated', 1] },
      CMM: { no: '6', type: 'cmm', label: '초정밀 측정·리워크셀', product: 'shared', use: 'CMM 판정·리워크', x: 18, z: 0, cycle: 10, robot: ['cobot', 2, 'ammr', 2] },
    },
    routes: { hblock: ['MATL', 'HB_MILL', 'HB_DEBR', 'CMM'], rcover: ['MATL', 'RC_MILL', 'RC_TURN', 'CMM'] },
    src: { x: -28, z: 0 }, sink: { x: 28, z: 0 },
    paths: {},
    ret: [{ x: 31.2, z: 0 }, { x: 31.2, z: 9 }, { x: -30.6, z: 9 }, { x: -30.6, z: 0 }],   // 적재 → 동쪽 끝 → 앞쪽 복귀로 → 투입 왼쪽 진입로
    rework: { at: 'CMM', rate: 0.06 },
    amr: { count: 9, speed: 1.6, ret: 2.6 }, load: 4, unload: 4,
  },
];
const MODE_MUL = { traditional: 1.3, smart: 1.0, dark: 0.9 };   // 단계별 사이클 배율 (정밀조립Zone 단계와 같은 방향)
const ROBOT_SHORT = { articulated: '6축', cobot: '협동', ammr: 'AMMR', humanoid: '휴머노이드' };

// 정밀조립Zone(line.js zonePath)과 같은 셀 간 경로: 셀 중앙 → 출구 → (대각) → 다음 셀 입구, 같은 줄이면 직선
function cellPath(Z, aId, bId, a, b) {
  const via = Z.paths[`${aId}>${bId}`];
  if (via) return [{ x: a.x, z: a.z }, ...via, { x: b.x, z: b.z }];
  if (Math.abs(a.z - b.z) < 0.01) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  const merge = Math.abs(b.z) < 0.01, ez = merge ? Math.sign(a.z - b.z) * 0.75 : b.z, ex = b.x - 2;
  return [{ x: a.x, z: a.z }, { x: a.x + 2.3, z: a.z }, { x: ex - 3, z: ez }, { x: ex, z: ez }, { x: b.x, z: b.z }];
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
// 머신텐딩 배치 (adaptive-machining TEND): 로봇 −z 1.3m, 머시닝센터 −z 3.25m (통로 반대쪽), 테이블 앞 −z 3.05m
const TEND = { robot: { x: -0.8, z: -1.3 }, mc: { z: -3.25 }, table: { x: -0.1, z: -3.05 } };
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
  const panel = put(box(0.55, 0.8, 0.2, MAT.dark), 1.25, 1.55, E.d / 2 + 0.12, E.G);
  const screen = emis(0x58c4ff, 1.2); put(box(0.42, 0.3, 0.02, screen, false), 0, 0.15, 0.11, panel);
  const edge = put(box(0.28, 0.18, 0.12, std(0x111418)), -1.25, 2.35, E.d / 2 + 0.07, E.G);
  const edgeLed = emis(0x3ddc84, 2); put(box(0.2, 0.03, 0.01, edgeLed, false), 0, 0.03, 0.065, edge);
  return { screen, edgeLed };
}
// 5축 머시닝센터: 트러니언 테이블 · 스핀들 헤드 · ATC 매거진 · 칩 컨베이어 · 조작반
function buildMill5(g, cell) {
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
  const spin = put(new THREE.Group(), 0, -0.1, 0, head); spin.rotation.z = 0.5;
  const bit = put(cyl(0.03, 0.05, 0.5, MAT.steel, 10), 0, -0.25, 0, spin);
  const wash = put(new THREE.Group(), 1.55, 0, 0, g);
  for (const z of [-0.9, 0.9]) put(box(0.12, 2.0, 0.12, MAT.white), 0, 1.0, z, wash);
  put(box(0.7, 0.25, 1.95, MAT.white), 0, 2.0, 0, wash);
  for (const z of [-0.5, 0, 0.5]) put(cyl(0.03, 0.05, 0.16, MAT.steel, 8), 0, 1.82, z, wash);
  const curtain = put(box(0.02, 1.2, 1.7, MAT.booth, false), 0.32, 1.25, 0, wash);
  const screen = emis(0x3ddc84, 1.2);
  const ctl = put(box(0.5, 0.7, 0.35, MAT.dark), 1.95, 0.4, 1.6, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.18, ctl);
  for (const z of [-1.0, 1.0]) { const f = put(box(0.45, 0.7, 0.4, MAT.white), -1.95, 0.35, z, g); for (let k = 0; k < 3; k++) put(cyl(0.025, 0.025, 0.18, MAT.steel, 8), -0.12 + k * 0.12, 0.44, 0, f); }
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
  put(box(0.1, 1.1, 0.1, MAT.steel), 0, -0.55, 0, quill);
  const tipMat = emis(0xff4d6d, 1.5); put(mesh(new THREE.SphereGeometry(0.03, 12, 8), tipMat), 0, -1.12, 0, quill);
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
function buildPort(g, Z, kind) {
  put(box(3.6, 0.06, 3.6, MAT.dark), 0, 0.03, 0, g);
  put(box(3.6, 0.01, 1.5, MAT.lane), 0, 0.065, 0, g);
  if (kind === 'src') {
    for (const z of [-1.3, 1.3]) put(box(0.14, 3.0, 0.14, MAT.accent), 0, 1.5, z, g);
    put(box(0.2, 0.2, 2.8, MAT.accent), 0, 3.0, 0, g);
    put(box(0.4, 0.3, 0.4, MAT.orange), 0, 2.75, 0, g);
    const keys = Object.keys(Z.products);
    keys.forEach((k, i) => { const z = i ? -1.25 : 1.25; for (let j = 0; j < 3; j++) put(box(1.1, 0.3, 0.9, std(PC[k], { roughness: 0.7 })), -1.0 + (j % 2) * 0.05, 0.2 + j * 0.32, z, g); });
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
    this.Z = Z;
    this.G = put(new THREE.Group(), Z.origin.x, 0, Z.origin.z, root);
    this.dyn = put(new THREE.Group(), 0, 0, 0, this.G);
    const acc = hex(Z.accent);
    // Zone 바닥 구역(셀 영역 테두리) · 바닥 Zone 이름 · 공중 표지
    const W = 64, D = 21, frame = std(Z.accent, { emissive: Z.accent, emissiveIntensity: 0.25 });
    put(box(W, 0.01, D, std(0x3d434b, { roughness: 0.9 }), false), 0, 0.004, 0.6, this.G).receiveShadow = true;
    for (const sd of [-1, 1]) { put(box(W, 0.012, 0.14, frame, false), 0, 0.012, 0.6 + sd * D / 2, this.G); put(box(0.14, 0.012, D, frame, false), sd * W / 2, 0.012, 0.6, this.G); }
    put(textPlane([`${Z.code} ${Z.name}`, Z.sub], 15, 2.6, acc), 0, 0.02, Z.key === 'flex' ? 10.6 : 12.4, this.G);   // 셀 줄 바깥 앞쪽 바닥 (복귀로 너머)
    this.cells = {}; this.order = [];
    for (const [id, c] of Object.entries(Z.cells)) {
      const g = put(new THREE.Group(), c.x, 0, c.z, this.G); g.rotation.y = c.rot ?? 0; g.scale.z = c.side ?? 1;
      cellBase(g, 4.6);
      const parts = BUILD[c.type](g, c);
      const light = put(makeStackLight(), -1.9, 0.15, -1.6, g);
      const robotsG = put(new THREE.Group(), 0, 0, 0, g), workersG = put(new THREE.Group(), 0, 0, 0, g);
      const el = document.createElement('div'); el.className = 'st-label xz';
      const no = c.no ?? id;
      el.innerHTML = `<div class="nm"><b class="no${no.length > 1 ? ' wide' : ''}">${no}</b><span>${c.label}</span></div><div class="use u-${USE_CLS[c.product] ?? 'shared'}">${c.use}</div><div class="row"><span class="chip s-IDLE">대기</span></div><div class="rb"></div>`;
      const label = new CSS2DObject(el); label.position.set(0, 4.3, 0); g.add(label);
      const cell = { id, def: c, g, parts, light, robotsG, workersG, robots: [], el, chip: el.querySelector('.chip'), rb: el.querySelector('.rb'), label, occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0 };
      this.cells[id] = cell; this.order.push(cell);
    }
    this.src = { id: 'SRC', def: Z.src, occ: null }; this.sink = { id: 'SINK', def: Z.sink, occ: null };
    for (const [n, kind] of [[this.src, 'src'], [this.sink, 'sink']]) {
      const g = put(new THREE.Group(), n.def.x, 0, n.def.z, this.G); g.rotation.y = n.def.rot ?? 0; buildPort(g, Z, kind);
      const el = document.createElement('div'); el.className = 'st-label xz';
      el.innerHTML = `<div class="nm"><span>${kind === 'src' ? '자재 투입 (AS/RS)' : '양품 구분 적재'}</span></div><div class="row"><span class="chip s-IDLE"></span></div>`;
      const label = new CSS2DObject(el); label.position.set(0, 4.0, 0); g.add(label);
      Object.assign(n, { g, el, label, chip: el.querySelector('.chip') });
    }
    // Zone 현황판 (Zone 위 공중, 라벨과 함께 켜고 끔)
    const bel = document.createElement('div'); bel.className = 'xz-board'; bel.style.setProperty('--zc', acc);
    this.board = new CSS2DObject(bel); this.board.position.set(0, 3.2, Z.key === 'flex' ? 10.6 : 12.4); this.G.add(this.board); this.boardEl = bel;   // 바닥 Zone 이름 바로 위
    // 복귀 경로와 투입 대기열 자리 (복귀로 끝에서 거꾸로 2m 간격)
    this.retPath = [{ x: Z.sink.x, z: Z.sink.z }, ...Z.ret, { x: Z.src.x, z: Z.src.z }];
    const rev = [...this.retPath].reverse(), L = pathLength(rev);
    this.qSlots = []; for (let s = 2.2; s < L - 3 && this.qSlots.length < Z.amr.count; s += 2.0) this.qSlots.push(pointAt(rev, s));
    this.reset();
  }

  // 새 실행(단계·라인 변경)마다 처음부터
  reset(modeKey = 'smart', seed = 1) {
    this.mode = modeKey; this.rng = mulberry(seed + (this.Z.key === 'flex' ? 11 : 23));
    this.time = 0; this.seq = 0; this.mixAcc = {};
    this.stats = { good: {}, ng: 0, rework: 0, released: 0 };
    for (const c of this.order) Object.assign(c, { occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0 });
    this.src.occ = null; this.sink.occ = null;
    this.dyn.clear();
    const legacy = modeKey === 'traditional';
    this.carriers = Array.from({ length: this.Z.amr.count }, (_, i) => {
      const q = this.qSlots[Math.min(i, this.qSlots.length - 1)];
      const g = legacy ? makeCart() : makeCarrierAMR(); this.dyn.add(g);
      return { id: `${this.Z.code}-AMR${String(i + 1).padStart(2, '0')}`, i, x: q.x, z: q.z, heading: 0, state: 'queue', qAt: i, wait: 0, path: null, s: 0, item: null, at: null, g, pm: null, timer: 0 };
    });
    this.buildCrew(modeKey);
  }

  // 단계별 셀 인력: 레거시 = 작업자, 자동화·피지컬AI = 로봇 (피지컬AI는 AMMR·휴머노이드)
  buildCrew(modeKey) {
    const legacy = modeKey === 'traditional', dark = modeKey === 'dark';
    for (const c of this.order) {
      c.robotsG.clear(); c.workersG.clear(); c.robots = [];
      const R = c.def.robot, kind = dark && R[2] ? R[2] : R[0], count = dark && R[2] ? R[3] : R[1];
      c.cycle = c.def.cycle * (MODE_MUL[modeKey] ?? 1);
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
        put(r.root, x, kind === 'ammr' ? 0.06 : 0.15, kind === 'ammr' ? Math.sign(z) * AMMR.slotZ : z, c.robotsG); r.root.rotation.y = yaw;
        r.phase = i * 1.3; c.robots.push(r);
      }
      c.rb.textContent = `🤖 ${ROBOT_SHORT[kind] ?? kind}×${count}`;
    }
  }

  nextProduct() {
    const w = this.Z.mix, keys = Object.keys(w).filter((k) => w[k] > 0), tot = keys.reduce((a, k) => a + w[k], 0);
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
      if (c.state !== 'BUSY') continue;
      c.busy += dt; c.progress = Math.min(1, c.progress + dt / c.cur);
      if (c.progress >= 1) {
        const it = c.item; it.done.add(c.id); c.done++;
        if (Z.ng && c.id === Z.ng.at && !it.ng && this.rng() < Z.ng.rate) { it.ng = true; it.ngNext = true; this.stats.ng++; }
        else it.ngNext = false;
        c.state = 'BLOCKED';   // 다음 셀이 비기를 기다림 (비면 곧바로 출발)
      }
    }
    for (const c of this.carriers) this.stepCarrier(c, dt);
  }
  stepCarrier(c, dt) {
    const Z = this.Z;
    switch (c.state) {
      case 'queue': {   // 투입 대기열 — 앞자리가 비면 한 칸씩 당기고, 맨 앞이면서 투입 위치가 비면 들어간다
        const k = this.carriers.filter((o) => o.state === 'queue' && o.qAt < c.qAt).length;
        const q = this.qSlots[Math.min(k, this.qSlots.length - 1)];
        if (k === 0 && !this.src.occ) { this.src.occ = c; this.go(c, [{ x: c.x, z: c.z }, { x: Z.src.x, z: Z.src.z }], 'toSrc', 'SRC'); break; }
        this.moveToward(c, q, Z.amr.ret, dt);
        break;
      }
      case 'load':
        c.timer -= dt;
        if (c.timer <= 0) {
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
      case 'move': case 'toSrc': case 'return': {
        const sp = c.state === 'move' ? Z.amr.speed : Z.amr.ret;
        // 앞차 간격: 같은 방향으로 1.8m 안에 다른 이동 AMR이 있으면 잠시 선다 (교차 통로에서 겹치지 않게)
        // 서로 마주 보며 막히면 번호가 빠른 쪽이 먼저 가고, 3초 넘게 막히면 그대로 지나간다 (교착 방지)
        const blocked = this.carriers.some((o) => o !== c && (o.state === 'move' || o.state === 'return') && Math.hypot(o.x - c.x, o.z - c.z) < 1.8 && this.ahead(c, o) && !(this.ahead(o, c) && c.i < o.i));
        if (blocked && c.wait < 3) { c.wait += dt; break; }
        c.wait = 0;
        c.s = Math.min(c.L, c.s + sp * dt);
        const p = pointAt(c.path, c.s); this.face(c, p); c.x = p.x; c.z = p.z;
        if (c.state === 'return') {   // 복귀: 대기열 끝자리 근처에 오면 대기열로
          const k = this.carriers.filter((o) => o.state === 'queue').length, q = this.qSlots[Math.min(k, this.qSlots.length - 1)];
          if (Math.hypot(q.x - c.x, q.z - c.z) < 0.6 || c.s >= c.L - 0.01) { c.state = 'queue'; c.qAt = this.time + 100 + c.i * 1e-6; }
          break;
        }
        if (c.s < c.L - 1e-6) break;
        if (c.target === 'SRC') { c.state = 'load'; c.timer = Z.load; break; }
        if (c.target === 'SINK') { c.state = 'unload'; c.timer = Z.unload; c.at = 'SINK'; break; }
        const cell = this.cells[c.target]; c.at = c.target;
        const rw = Z.rework && cell.id === Z.rework.at && this.rng() < Z.rework.rate;
        if (rw) { c.item.rework = true; this.stats.rework++; }
        Object.assign(cell, { state: 'BUSY', progress: 0, item: c.item, cur: cell.cycle * (rw ? 1.6 : 1) * (0.92 + this.rng() * 0.16) });
        c.state = 'work';
        break;
      }
      case 'work': if (this.cells[c.at].state === 'BLOCKED') c.state = 'ready'; break;
      case 'unload':
        c.timer -= dt;
        if (c.timer <= 0) {
          const p = c.item.product; this.stats.good[p] = (this.stats.good[p] ?? 0) + 1;
          this.detachItem(c); c.item = null; this.sink.occ = null;
          this.go(c, this.retPath, 'return', 'Q');
        }
        break;
    }
  }
  ahead(c, o) {   // o가 c의 진행 방향 앞쪽에 있는가
    const hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    return (o.x - c.x) * hx + (o.z - c.z) * hz > 0.3;
  }
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
    for (const c of this.carriers) {
      c.g.position.set(c.x, 0, c.z);
      let d = c.heading - c.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); c.g.rotation.y += d * Math.min(1, rdt * 8);
      if (c.pm && c.item) styleProduct(c.pm, c.item);
    }
    for (const c of this.order) this.animCell(c, t, rdt, dts);
  }
  animCell(c, t, rdt, dts) {
    const P = c.parts, busy = c.state === 'BUSY' && !c.halt, p = c.progress, st = c.halt ? 'ESTOP' : c.state;
    c.light.userData.set(st, t);
    for (const r of c.robots) r.anim(busy, t + r.phase, p);
    const ty = c.def.type, it = c.item, legacy = this.mode === 'traditional';
    if (P.gateSign) {
      const entering = busy && p < 0.18;
      P.scan.visible = entering; if (entering) P.scan.position.x = P.gateX + Math.sin(t * 9) * 0.12;
      const col = it ? (it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : 0xffffff;
      P.ringMat.color.setHex(col); P.ringMat.emissive?.setHex(col); P.ringMat.emissiveIntensity = entering ? 6 : it ? 1.4 : 0.4;
      const text = !it ? '대기 중' : ty === 'cmm' ? `${it.id} · ${this.Z.products[it.product].label} · ${it.rework ? '리워크 후 재측정' : p < 0.9 ? '측정 중' : '합격'}` : `${it.id} → ${this.Z.products[it.product].label} 라인`;
      drawGate(P.gateSign, P.gateTitle, text, it ? hex(it.rework && ty === 'cmm' ? 0xf5b82e : PC[it.product]) : '#e6edf3');
    }
    switch (ty) {
      case 'locate': P.scan.visible = busy && p < 0.6; if (P.scan.visible) P.scan.position.x = Math.sin(p * PI * 6) * 0.7; break;
      case 'spot': stepSparks(P.sparks, busy && Math.sin(t * 6) > -0.3, { x: legacy ? -0.3 : 0, y: BELT_Y + 0.45, z: 0 }, rdt, 2.2, -7); break;
      case 'seal': P.lamp.emissiveIntensity = busy ? 1.4 : 0.5; stepSparks(P.mist, busy, { x: Math.sin(t * 2.5) * 0.6, y: BELT_Y + 0.5, z: 0 }, rdt, 0.8, -1.5); break;
      case 'hem': { const k = busy && p > 0.45 && p < 0.85 ? Math.sin(((p - 0.45) / 0.4) * PI) : 0; P.ram.position.y = 2.2 - k * 1.05; break; }
      case 'mount': P.screen.emissive.setHex(busy && Math.sin(t * 10) > 0 ? 0xf5b82e : 0x3ddc84); break;
      case 'vision': { const sc = busy && !legacy; P.scan.visible = sc; if (sc) P.scan.position.x = Math.sin(p * PI * 2) * 0.6; P.ringMat.emissiveIntensity = sc && p > 0.45 && p < 0.55 ? 8 : 0.4; break; }
      case 'rework': stepSparks(P.sparks, busy && Math.sin(t * 5) > 0.2, { x: 0.2, y: 1.0, z: 2.0 }, rdt, 1.2, -6); break;
      case 'mill5': case 'turn': {
        const open = !it || p < 0.15 || p > 0.85 ? 1 : 0;
        c.doorK = (c.doorK ?? 0) + (open - (c.doorK ?? 0)) * Math.min(1, rdt * 4); P.door.position.x = c.doorK * 1.25;
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
        const tq = meas ? -0.95 * (0.6 + 0.4 * Math.abs(Math.sin(p * PI * 14))) : 0;
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
    const lab = { BUSY: '가동', IDLE: '대기', BLOCKED: '출구 대기', ESTOP: '정지' };
    for (const c of this.order) {
      const s = halted ? 'ESTOP' : c.state;
      c.chip.className = 'chip s-' + s;
      c.chip.textContent = lab[s] + (c.state === 'BUSY' && c.item ? ` · ${this.Z.products[c.item.product].label}${c.item.rework ? ' (리워크)' : c.item.ng && c.id === this.Z.ng?.to ? ' (NG 보수)' : ''}` : '');
    }
    const q = this.carriers.filter((c) => c.state === 'queue' || c.state === 'toSrc').length;
    this.src.chip.className = 'chip s-' + (this.src.occ ? 'BUSY' : 'IDLE');
    this.src.chip.textContent = `${this.src.occ ? '적재 중' : '대기'} · ${this.mode === 'traditional' ? '대차' : 'AMR'} 대기 ${q}`;
    const g = this.stats.good, ps = Object.entries(this.Z.products);
    this.sink.chip.className = 'chip s-' + (this.sink.occ ? 'BUSY' : 'IDLE');
    this.sink.chip.textContent = ps.map(([k, v]) => `${v.label} ${g[k] ?? 0}`).join(' · ');
    const s = this.summary();
    this.boardEl.innerHTML = `<b>${this.Z.code} ${this.Z.name}</b><span>${ps.map(([k, v]) => `${v.label} <i>${g[k] ?? 0}</i>`).join(' · ')} · UPH <i>${s.uph}</i> · 가동 셀 <i>${s.busy}/${this.order.length}</i>${this.Z.ng ? ` · NG <i>${this.stats.ng}</i>` : ''}${this.Z.rework ? ` · 리워크 <i>${this.stats.rework}</i>` : ''}</span>`;
  }
  summary() {
    const good = Object.values(this.stats.good).reduce((a, b) => a + b, 0);
    return { good, uph: this.time > 120 ? Math.round((good / this.time) * 3600) : 0, busy: this.order.filter((c) => c.state === 'BUSY').length, moving: this.carriers.filter((c) => c.state === 'move').length };
  }
  setLabels(on) { for (const c of this.order) c.label.visible = on; this.src.label.visible = on; this.sink.label.visible = on; this.board.visible = on; }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── 두 확장 Zone 묶음 (main.js가 만들고, 시뮬레이션 시계에 맞춰 돌린다) ─────────────────
export class ExtraZones {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.zones = EXTRA_ZONES.map((Z) => new ExtraZone(Z, this.root));
    this.t = 0; this.labelsOn = true;
    // 정밀조립Zone ↔ 적응가공Zone 바닥 경계선 (벽 없이 노란 안전선)
    const line = std(0xf2c230, { emissive: 0x3a2e00 });
    for (let x = -50; x < 37.5; x += 2) put(box(1.2, 0.012, 0.16, line, false), x + 0.6, 0.014, 20.2, this.root);
  }
  // 새 실행(정밀조립Zone 시뮬레이션 시작)마다 — Blender 모델이 늦게 들어왔으면 운반체·제품도 새 모델로
  setup(sim, labelsOn = this.labelsOn) {
    this.zones.forEach((z) => z.reset(sim.mode.key, sim.seed ?? 1));
    this.setLabels(labelsOn);
  }
  step(dt, sim) { const K = sim.cmd, halted = !!(K?.estopAll || K?.pstopAll); this.halted = halted; for (const z of this.zones) z.step(dt, halted); }
  update(rdt, running, speed) {
    this.t += rdt; const dts = running ? rdt * speed : 0;
    for (const z of this.zones) z.sync(rdt, this.t, dts);
  }
  updateLabels() { for (const z of this.zones) z.updateLabels(this.halted); }
  setLabels(on) { this.labelsOn = on; for (const z of this.zones) z.setLabels(on); }
  summary() { return this.zones.map((z) => ({ key: z.Z.key, code: z.Z.code, name: z.Z.name, products: z.Z.products, byProduct: z.stats.good, ng: z.stats.ng, rework: z.stats.rework, cells: z.order.length, carriers: z.carriers.length, ...z.summary() })); }
}
// 카메라 바로가기 (main.js): [카메라 위치, 바라보는 점]
export const ZONE_VIEWS = {
  all: [[-6, 150, 95], [-6, 0, -2]],
  flex: [[-17, 42, -4], [-17, 0, -38]],
  precision: [[-10.5, 45, 58], [-5.5, 0, 1]],
  adapt: [[0, 40, 78], [0, 0, 37]],
};
