// 정밀검사Zone (AI정밀검사 · QMS Zone) — 오른쪽 세로 통로(x 30)와 오른쪽 벽(x 48) 사이, 뒤쪽 통로(z −32 · 출하 도크 아래)와 앞쪽 통로(z 9 · 정밀조립/적응가공 사이) 사이
// llm-wiki 「AI정밀검사(QMS) Zone 통합 시나리오 v0.3」(10/6) 기준: 공정 내 전수검사는 각 생산 존이, 샘플링 검사는 정밀검사Zone이 맡는다.
//  · 셀: 시료 접수·도킹 → ① 로봇형 비전 검사(ABIS 표면결함 · AIMAX Feature) · ② 3D 스캔·초음파 용접검사(ScanBox · UT NDT — 용접부 NDT 필수)
//        ③ O-INSPECT 정밀 재측정(정반 안착) · ④ ATOS 3D 형상편차(Point Cloud) → ⑤ AI 판정(OK · 판정 불확실 · NG) · 결과 버퍼
//  · 제품별 검사 경로 — 모든 제품이 같은 장비를 거치지 않는다 (판정 불확실 → ③ 재측정 후 재판정 · NG → 해당 Zone 오케스트레이터에 리워크·공정 보정 요청)
//  · 검사 AMR 3대가 세 생산 Zone 적재장에서 N개마다 1개씩 샘플을 지그째 실어 온다 (공장 통로로 이동 — 시뮬레이션 이동체와 서로 양보)
// 시계는 정밀조립Zone 시뮬레이션과 같다 (main.js가 step/update를 부른다). 라인 전체 비상정지·보호정지 때 함께 멈춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KIT } from './factory.js';
import { route, moverRadius, moverWidth } from './sim.js';
import { pointAt, pathLength } from './line.js';
import { INSP_AREA, INSP_SERVER, INSP_CELLS } from './zonedefs.js';

const { std, emis, mesh, box, cyl, put, MAT, BELT_Y, makeRobot, makeWorker, makeCarrierAMR, makeStackLight, cellBase, idPlate, armIK } = KIT;
const PI = Math.PI;

export const INSP = {
  key: 'insp', code: '정밀검사', uidp: 'QIS', name: '정밀검사Zone', sub: 'AI정밀검사(QMS) · 샘플링 검사',
  area: INSP_AREA,
  lane: 39.25,   // 두 셀 줄 사이 AMR 차로 (x)
  cells: INSP_CELLS,
  // 제품별 검사 경로 (접수 다음 ~ 판정 앞)
  routes: { doortrim: ['VIS', 'SCAN'], eaxle: ['VIS', 'OINS'], hood: ['VIS', 'SCAN'], door: ['VIS', 'SCAN'], hblock: ['ATOS', 'OINS'], rcover: ['ATOS', 'OINS'] },
  products: { doortrim: ['main', '도어트림', 0xf0a030], eaxle: ['main', 'e-axle', 0x9a6bff], hood: ['flex', '후드', 0xf0a030], door: ['flex', '도어', 0x9a6bff], hblock: ['adapt', '유압블록', 0xf0a030], rcover: ['adapt', '리어커버', 0x9a6bff] },
  zones: { main: '정밀조립', flex: '유연생산', adapt: '적응가공' },
  sample: { main: 30, flex: 10, adapt: 20 },   // 양품 N개마다 1개 샘플 (유연생산은 용접부 NDT 대상이라 촘촘히)
  // 샘플 수거 위치 (각 Zone 적재장 옆 통로 쪽) — aisle은 공장 통로 동선 계산용 (sim.js route)
  pickup: { main: { x: 21, z: 6.8, aisle: 'F' }, flex: { x: 22.5, z: -11.6, aisle: 'B' }, adapt: { x: 18, z: 11.4, aisle: 'F' } },
  entryZ: -29.2,   // 뒤쪽 통로에서 들어와 접수 도킹 앞에서 대기하는 줄
  station: { z: 3.4, xs: [33.3, 35.2, 37.1], exitZ: 6.6 },   // 검사 AMR 대기·무선 충전 — Zone 앞쪽(남쪽) 끝 왼쪽 (앞쪽 통로로 나간다)
  // 오른쪽 벽 (적응가공Zone 전광판·CCTV 전광판과 같은 벽 · 같은 높이 · 같은 0.5m 간격): 적응가공·정밀검사 CCTV 전광판(z −2 ~ 10) 바로 왼쪽에 전광판, 그 왼쪽에 로봇 비전 관제 디스플레이
  wall: { x: 47.8, y: 5.1, z: -2 - 0.5 - 9, rot: -PI / 2, w: 18, h: 4 },
  cams: { x: 47.8, y: 5.1, z: -2 - 0.5 - 18 - 0.5 - 6, rot: -PI / 2, w: 12, h: 4 },
  amr: { count: 3, speed: 1.4 },
  judge: { uncertain: 0.06, ng: 0.04 },
};
const zl = (k) => INSP.zones[k];

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function textPlane(lines, w, h, color = 'rgba(127,224,214,0.95)', font = 700) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const x = c.getContext('2d'); x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
  const fs = Math.min(c.height / lines.length * 0.72, 120); x.font = `${font} ${fs}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  lines.forEach((l, i) => x.fillText(l, 512, (i + 0.5) * c.height / lines.length));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -PI / 2; return m;
}
function sampleMesh(color) {
  const g = new THREE.Group();
  put(box(0.5, 0.06, 0.5, MAT.dark), 0, 0.03, 0, g);                                   // 지그 판
  const body = put(box(0.4, 0.2, 0.36, std(color, { roughness: 0.45, metalness: 0.3 })), 0, 0.16, 0, g);
  put(box(0.12, 0.02, 0.08, emis(0x37e8ff, 1.5), false), 0.1, 0.27, 0.1, g);            // 샘플 ID 태그
  g.userData.body = body; return g;
}

// ── 셀 설비 모델 (셀 중심 기준 · AMR은 동서(x) 방향으로 셀 가운데 정차) ─────────────────
function buildDock(g) {
  for (const z of [-1.3, 1.3]) put(box(0.14, 2.3, 0.14, MAT.steel), -1.5, 1.15, z, g);
  put(box(0.24, 0.24, 2.74, MAT.steel), -1.5, 2.3, 0, g);
  const reader = emis(0x37e8ff, 1.2);
  for (const z of [-0.9, 0.9]) { const r = put(box(0.2, 0.16, 0.12, MAT.dark), -1.5, 2.08, z, g); put(box(0.14, 0.04, 0.02, reader, false), 0, -0.04, z > 0 ? -0.07 : 0.07, r); }
  const term = put(box(0.6, 1.2, 0.4, MAT.dark), 1.7, 0.6, 1.7, g), screen = emis(0x3ddc84, 1.2); put(box(0.46, 0.32, 0.02, screen, false), 0, 0.35, 0.21, term);
  return { reader, screen };
}
function buildVisionCell(g) {
  // ABIS 조명 터널 (AMR이 지나가는 문형 조명) · AIMAX 고정 카메라 2대
  for (const z of [-1.3, 1.3]) put(box(0.14, 2.3, 0.14, MAT.white), 0.95, 1.15, z, g);
  put(box(0.5, 0.2, 2.74, MAT.white), 0.95, 2.3, 0, g);
  const light = emis(0xdff6ff, 0.6); put(box(0.42, 0.03, 2.4, light, false), 0.95, 2.19, 0, g);
  for (const z of [-0.8, 0.8]) { const cam = put(box(0.16, 0.12, 0.2, MAT.dark), 0.95, 2.05, z, g); cam.rotation.x = z > 0 ? 0.5 : -0.5; put(cyl(0.04, 0.04, 0.05, emis(0x37e8ff, 1.5), 10), 0, -0.07, 0, cam); }
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.9, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { light, screen };
}
function buildScanCell(g) {
  // ScanBox 프레임 (청색 조명) + 초음파 탐상기 · 로봇 2대(3D 스캐너 · UT 프로브)
  const fr = put(new THREE.Group(), 1.55, 0, 0, g);
  for (const [x, z] of [[-0.45, -1.2], [0.45, -1.2], [-0.45, 1.2], [0.45, 1.2]]) put(box(0.1, 2.4, 0.1, MAT.steel), x, 1.2, z, fr);
  put(box(1.0, 0.1, 2.5, MAT.steel), 0, 2.4, 0, fr);
  const blue = emis(0x3a7bff, 0.4); put(box(0.9, 0.03, 2.3, blue, false), 0, 2.33, 0, fr);
  const ut = put(box(0.55, 0.45, 0.4, MAT.dark), 1.9, 0.9, 1.75, g), screen = emis(0x3ddc84, 1.2); put(box(0.4, 0.26, 0.02, screen, false), 0, 0.05, 0.21, ut);
  put(box(0.3, 0.68, 0.3, MAT.steel), 1.9, 0.34, 1.75, g);
  return { blue, screen };
}
// O-INSPECT: 화강암 정반 + 뒤쪽 기둥 · 앞으로 뻗은 암 · 측정 헤드(카메라·접촉 프로브) — 로봇이 AMR 지그에서 정반으로 옮겨 놓는다
const OINS = { robot: { x: -1.45, z: -0.95 }, table: { x: 0, z: -1.75 }, col: -2.7 };
function buildOins(g) {
  const granite = std(0x3b3f45, { roughness: 0.35, metalness: 0.1 });
  put(box(1.3, 0.8, 1.1, MAT.dark), 0, 0.4, -1.95, g);
  put(box(1.3, 0.1, 1.1, granite), 0, 0.85, -1.95, g);
  put(box(0.4, 2.1, 0.4, MAT.white), 0, 1.05, OINS.col, g);
  const carriage = put(new THREE.Group(), 0, 2.0, -2.45, g);   // 대기: 측정 헤드가 정반 뒤쪽(z −2.2) — 로봇이 샘플을 놓는 자리(z −1.75) 위를 비워 둔다
  put(box(0.26, 0.2, 1.2, MAT.white), 0, 0.06, -0.3, carriage);   // 암 (기둥 → 앞)
  const quill = put(new THREE.Group(), 0, 0, 0.25, carriage);
  put(box(0.08, 0.9, 0.08, MAT.steel), 0, -0.25, 0, quill);
  const tipMat = emis(0xff4d6d, 1.5); put(mesh(new THREE.SphereGeometry(0.03, 12, 8), tipMat), 0, -0.72, 0, quill);
  put(box(0.14, 0.12, 0.14, MAT.accent), 0, -0.05, 0, quill);
  const onTable = put(sampleMesh(0xffffff), OINS.table.x, 0.9, OINS.table.z, g); onTable.visible = false;
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.8, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { carriage, quill, tipMat, onTable, screen };
}
function buildAtos(g) {
  // 블루라이트 3D 스캐너 거치 프레임 + 기준 마커 판
  for (const z of [-1.3, 1.3]) put(box(0.12, 0.05, 0.6, emis(0x37e8ff, 0.8), false), 1.2, 0.08, z, g);
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.8, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { screen };
}
function buildJudge(g) {
  // AI 판정 엣지 서버 + 판정 모니터 · 결과 버퍼 선반 (OK 초록 · NG 빨강)
  const rack = put(box(0.7, 1.9, 0.7, MAT.dark), 1.6, 0.95, -1.7, g);
  const leds = [0, 1, 2, 3].map((k) => { const m = emis(0x3ddc84, 1.5); put(box(0.5, 0.03, 0.01, m, false), 0, 0.6 - k * 0.3, 0.36, rack); return m; });
  const mon = put(box(1.0, 0.6, 0.06, MAT.dark), 0.6, 1.6, -2.0, g), screen = emis(0x3ddc84, 1.2); put(box(0.92, 0.52, 0.02, screen, false), 0, 0, 0.04, mon);
  put(box(0.08, 1.3, 0.08, MAT.dark), 0.6, 0.65, -2.0, g);
  const shelves = {};
  for (const [k, z, col] of [['ok', 1.75, 0x3ddc84], ['ng', -1.75, 0xff4d4d]]) {
    const s = put(new THREE.Group(), -0.9, 0, z, g);
    for (const y of [0.35, 0.95]) put(box(1.2, 0.04, 0.6, MAT.steel), 0, y, 0, s);
    for (const [x, zz] of [[-0.58, -0.28], [0.58, -0.28], [-0.58, 0.28], [0.58, 0.28]]) put(box(0.04, 1.2, 0.04, MAT.steel), x, 0.6, zz, s);
    put(box(1.2, 0.08, 0.02, emis(col, 1.2), false), 0, 1.2, z > 0 ? 0.31 : -0.31, s);
    shelves[k] = [0, 1, 2, 3, 4, 5].map((i) => { const b = put(box(0.3, 0.18, 0.3, std(col === 0x3ddc84 ? 0xcfd6dc : 0xd96a6a)), -0.4 + (i % 3) * 0.4, (i < 3 ? 0.35 : 0.95) + 0.11, 0, s); b.visible = false; return b; });
  }
  return { leds, screen, shelves };
}
const BUILD = { dock: buildDock, vision: buildVisionCell, scan: buildScanCell, oins: buildOins, atos: buildAtos, judge: buildJudge };

// O-INSPECT 이송 로봇 경유점 (로봇 루트 로컬: 루트 회전 없음 · 높이는 루트 기준)
const OI_PTS = (() => {
  const r = OINS.robot, Y0 = 0.15, top = BELT_Y + 0.32 - Y0;
  return { home: [0.55, 1.45, 0], over: [0.9, 1.5, 0], amr: [-r.x, top, -r.z], table: [OINS.table.x - r.x, 0.9 + 0.26 + 0.06 - Y0, OINS.table.z - r.z] };
})();
const OI_SEQ = [[0, 'home'], [0.03, 'over'], [0.05, 'amr'], [0.07, 'over'], [0.1, 'table'], [0.13, 'home'], [0.86, 'home'], [0.89, 'table'], [0.92, 'over'], [0.95, 'amr'], [0.98, 'over'], [1, 'home']];
function oiPose(r, p) {
  const J = (r.oiJ ??= Object.fromEntries(Object.entries(OI_PTS).map(([k, [x, y, z]]) => [k, armIK(r.scale ?? 1, x, y, z)])));
  let i = 0; while (i < OI_SEQ.length - 2 && p >= OI_SEQ[i + 1][0]) i++;
  const [p0, a] = OI_SEQ[i], [p1, b] = OI_SEQ[i + 1], k0 = Math.min(1, Math.max(0, (p - p0) / Math.max(1e-6, p1 - p0))), k = k0 * k0 * (3 - 2 * k0);
  const A = J[a], B = J[b]; let dy = B[0] - A[0]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  r.arm.pose(A[0] + dy * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k, A[3] + (B[3] - A[3]) * k, 0, 0);
}

export class InspZone {
  constructor(scene) {
    this.Z = INSP; this.G = new THREE.Group(); scene.add(this.G);
    this.labelsOn = true; this.order = []; this.cells = {};
    this.buildFloor(); this.buildCells(); this.buildBoard();
    this.carriers = [];
    this.reset('smart', 1);
  }
  buildFloor() {
    const A = INSP.area, g = put(new THREE.Group(), 0, 0, 0, this.G);
    const tape = new THREE.MeshBasicMaterial({ color: 0x7fe0d6, transparent: true, opacity: 0.7 });
    const strip = (x0, z0, x1, z1) => { const w = Math.abs(x1 - x0) || 0.1, d = Math.abs(z1 - z0) || 0.1; const m = put(new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape), (x0 + x1) / 2, 0.016, (z0 + z1) / 2, g); m.rotation.x = -PI / 2; };
    // Zone 경계 (점선)
    for (let x = A.x0; x < A.x1; x += 1.2) { strip(x, A.z0, Math.min(x + 0.7, A.x1), A.z0 + 0.1); strip(x, A.z1 - 0.1, Math.min(x + 0.7, A.x1), A.z1); }
    for (let z = A.z0; z < A.z1; z += 1.2) { strip(A.x0, z, A.x0 + 0.1, Math.min(z + 0.7, A.z1)); strip(A.x1 - 0.1, z, A.x1, Math.min(z + 0.7, A.z1)); }
    // 가운데 AMR 차로 (유도 테이프) · 접수 대기 줄 · 스테이션 줄
    const guide = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.8 });
    const gl = (x0, z0, x1, z1) => { const w = Math.abs(x1 - x0) || 0.1, d = Math.abs(z1 - z0) || 0.1; const m = put(new THREE.Mesh(new THREE.PlaneGeometry(w, d), guide), (x0 + x1) / 2, 0.018, (z0 + z1) / 2, g); m.rotation.x = -PI / 2; };
    gl(INSP.lane, INSP.cells.DOCK.z, INSP.lane, INSP.station.z);
    for (const c of Object.values(INSP.cells)) gl(Math.min(c.x, INSP.lane), c.z, Math.max(c.x, INSP.lane), c.z);
    gl(Math.min(INSP.station.xs[0], INSP.lane), INSP.station.z, Math.max(INSP.station.xs[2], INSP.lane), INSP.station.z);
    gl(INSP.cells.DOCK.x, INSP.entryZ, INSP.cells.DOCK.x, INSP.cells.DOCK.z);
    const ttl = put(textPlane(['정밀검사Zone · AI정밀검사(QMS)'], 13, 1.3), INSP.lane, 0.02, -10, g); ttl.rotation.z = PI / 2;
    const sub = put(textPlane(['샘플링 검사 · 제품별 검사 경로 · AI 판정 → 공정 환류'], 13, 0.8, 'rgba(127,224,214,0.75)', 500), INSP.lane + 1.1, 0.02, -10, g); sub.rotation.z = PI / 2;
    // 검사 AMR 대기·충전 자리
    for (const x of INSP.station.xs) { const pad = put(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), new THREE.MeshStandardMaterial({ color: 0x2bb3a6, transparent: true, opacity: 0.3, depthWrite: false })), x, 0.012, INSP.station.z, g); pad.rotation.x = -PI / 2; }
    put(textPlane(['검사 AMR 대기·충전'], 5.2, 0.6), INSP.station.xs[1], 0.02, INSP.station.z + 1.5, g);
    for (let i = 0; i < INSP.amr.count; i++) put(textPlane(['접수 대기'], 1.6, 0.4), this.entryX(i), 0.02, INSP.entryZ - 1.05, g);
  }
  entryX(i) { return INSP.cells.DOCK.x - 1.8 + i * 1.8; }
  buildCells() {
    for (const [id, d] of Object.entries(INSP.cells)) {
      const g = put(new THREE.Group(), d.x, 0, d.z, this.G);
      cellBase(g);
      const parts = BUILD[d.type](g);
      const light = put(makeStackLight(), -1.9, 0.15, -1.6, g);
      // IoT 노드 (정밀조립·확장 Zone 셀과 같은 자리·모양): 셀 데이터를 정밀검사 데이터 서버로 올린다
      const sensorMat = emis(0x37e8ff, 2.5), ringM = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
      const iot = put(new THREE.Group(), 1.7, 3.2, -1.4, g), sensor = put(mesh(new THREE.SphereGeometry(0.12, 12, 10), sensorMat, false), 0, 0, 0, iot);
      const pulse = put(new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 24), ringM), 0, 0, 0, iot); pulse.rotation.x = -PI / 2;
      const robotsG = put(new THREE.Group(), 0, 0, 0, g), workersG = put(new THREE.Group(), 0, 0, 0, g);
      const el = document.createElement('div'); el.className = 'st-label xz';
      el.innerHTML = `<div class="nm"><b class="no">${d.no}</b><span>${d.label}</span><i class="uid">${INSP.uidp}-${id}</i></div><div class="use u-shared">${d.use}</div><div class="row"><span class="chip s-IDLE">대기</span></div><div class="rb"></div>`;
      const label = new CSS2DObject(el); label.position.set(0, 4.0, 0); g.add(label);
      g.traverse((o) => { o.userData.zoneCell = { zone: 'insp', cellId: id }; });   // 클릭 → 셀 정보 창 (main.js · ui.renderInspCell)
      const c = { id, def: d, g, parts, light, iot, sensor, pulse, ringM, phase: Math.random() * 6, robotsG, workersG, robots: [], robotUids: [], plates: [], el, chip: el.querySelector('.chip'), rb: el.querySelector('.rb'), label, occ: null, state: 'IDLE', progress: 0, cur: 0, item: null, busy: 0, done: 0 };
      this.cells[id] = c; this.order.push(c);
    }
  }
  buildBoard() {
    this.boardT = 0;   // (Zone 바닥 입간판은 없앴다 — 오른쪽 벽 전광판이 같은 내용을 크게 보여 준다)
    // 오른쪽 벽 전광판: 셀별 상태 · 판정 실적 · 제품별 결과 · 검사 AMR · 최근 판정
    const W = INSP.wall, wg = put(new THREE.Group(), W.x, W.y, W.z, this.G); wg.rotation.y = W.rot; this.wallG = wg;
    put(box(W.w + 0.3, W.h + 0.3, 0.12, std(0x14181e, { roughness: 0.6, metalness: 0.3 })), 0, 0, -0.08, wg);
    const wc = document.createElement('canvas'); wc.width = 2304; wc.height = 512; this.wallCv = wc;
    const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace; wt.anisotropy = 8; this.wallTex = wt;
    put(new THREE.Mesh(new THREE.PlaneGeometry(W.w, W.h), new THREE.MeshBasicMaterial({ map: wt, toneMapped: false })), 0, 0, 0.01, wg);
    // 정밀검사 데이터 서버: 랙 4대 (앞면 = 건물 안쪽) · 전광판 아래 — 셀 IoT 노드 · 셀 로봇 · 검사 AMR이 보내는 데이터 패킷이 여기로 (QMS · 검사 영상 · Point Cloud)
    const SV = INSP_SERVER, srv = put(new THREE.Group(), SV.x, 0, SV.z, this.G); srv.rotation.y = SV.rot; this.srvG = srv; this.srvLeds = [];
    for (const x of [-1.65, -0.55, 0.55, 1.65]) {
      const rk = put(box(0.9, 2.3, 1.0, MAT.dark), x, 1.15, 0, srv);
      for (let k = 0; k < 6; k++) { const m = emis(k % 2 ? 0x3dff8a : 0x2aa8ff, 2); this.srvLeds.push(m); put(box(0.6, 0.04, 0.02, m, false), 0, -0.8 + k * 0.32, 0.51, rk); }
    }
    const sl = put(textPlane(['정밀검사 데이터 서버', 'QMS · 검사 영상 · Point Cloud · AAS'], 3.0, 0.6, 'rgba(127,224,214,0.95)'), 0, 2.72, 0.45, srv); sl.rotation.x = 0;
    this.serverPos = new THREE.Vector3(SV.x + Math.sin(SV.rot) * 0.5, 2.6, SV.z + Math.cos(SV.rot) * 0.5);
    this.pkG = put(new THREE.Group(), 0, 0, 0, this.G); this.packets = [];
  }
  // 데이터 패킷: 보내는 쪽(셀 IoT 노드 · 로봇 · AMR) → 서버로 포물선 (정밀조립·확장 Zone 패킷과 같은 꼴) · NG 판정은 빨강
  spawnPacket(from, color = 0x7ff3ff) {
    let p = this.packets.find((q) => !q.alive);
    if (!p) { if (this.packets.length > 50) return; p = { m: put(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false })), 0, 0, 0, this.pkG), alive: false }; this.packets.push(p); }
    p.alive = true; p.t = 0; p.m.visible = true; p.m.material.color.setHex(color);
    p.a = from.clone(); p.b = this.serverPos.clone(); p.c = p.a.clone().lerp(p.b, 0.5); p.c.y = Math.max(p.a.y, p.b.y) + 4;
  }
  updatePackets(rdt) {
    for (const p of this.packets) {
      if (!p.alive) continue;
      p.t += rdt * 0.7;
      if (p.t >= 1) { p.alive = false; p.m.visible = false; this.stats.rx = (this.stats.rx ?? 0) + 1; continue; }
      const k = p.t, j = 1 - k, { a, b, c } = p;
      p.m.position.set(j * j * a.x + 2 * j * k * c.x + k * k * b.x, j * j * a.y + 2 * j * k * c.y + k * k * b.y, j * j * a.z + 2 * j * k * c.z + k * k * b.z);
    }
  }
  sendData(rdt, t) {
    const live = this.mode !== 'traditional' && !this.halted;   // 레거시: IoT 수집 없음
    this.srvG.visible = this.mode !== 'traditional';
    if (live) {
      const v = new THREE.Vector3();
      for (const c of this.order) {
        const k = (t * 0.8 + c.phase) % 1; c.pulse.scale.setScalar(1 + k * 3); c.ringM.opacity = 0.6 * (1 - k);
        if (Math.random() < rdt * (c.state === 'BUSY' ? 1.6 : 0.6)) this.spawnPacket(c.sensor.getWorldPosition(v));   // 셀 IoT 노드 (장비 상태·측정값)
        for (const r of c.robots) if (Math.random() < rdt * (c.state === 'BUSY' ? 0.8 : 0.25)) this.spawnPacket(r.tip.getWorldPosition(v), 0xb48cff);   // 셀 로봇 (관절·TCP · 손목 카메라)
      }
      for (const a of this.carriers) if (Math.random() < rdt * (a.state === 'park' ? 0.15 : 0.5)) this.spawnPacket(v.set(a.x, 1.0, a.z), 0x3ddc84);   // 검사 AMR (5G 업링크: 위치·상태·샘플)
      this.srvLeds.forEach((m, i) => (m.emissiveIntensity = Math.sin(t * 6 + i * 1.7) > 0.2 ? 2 : 0.4));
    }
    for (const c of this.order) { c.iot.visible = live || this.mode !== 'traditional'; }
    this.updatePackets(rdt);
  }
  drawWall() {
    const cv = this.wallCv, x = cv.getContext('2d'), s = this.stats, F = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif', S = INSP;
    x.fillStyle = '#0a0f15'; x.fillRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#7fe0d6'; x.font = `800 46px ${F}`; x.fillText('정밀검사Zone · AI정밀검사(QMS)', 30, 62);
    const okr = s.done ? ((s.ok / s.done) * 100).toFixed(1) : '0.0';
    x.font = `700 34px ${F}`; x.fillStyle = '#e6edf3'; x.fillText(`샘플 ${s.samples} · 판정 ${s.done} · 검사 중 ${this.carriers.filter((c) => c.item).length} · 대기 ${this.queue.length}`, 760, 62);
    x.fillStyle = '#3ddc84'; x.fillText(`OK ${s.ok}`, 1560, 62); x.fillStyle = '#f5b82e'; x.fillText(`불확실 ${s.unc}`, 1720, 62); x.fillStyle = '#ff6b6b'; x.fillText(`NG ${s.ng}`, 1920, 62);
    x.fillStyle = '#e6edf3'; x.fillText(`OK율 ${okr}%`, 2060, 62);
    // 셀 카드 6개
    const lab = { IDLE: ['대기', '#3a4654'], BUSY: ['검사 중', '#2f9bff'], DONE: ['다음 셀 대기', '#f5b82e'], DOWN: ['고장 · 수리 대기', '#ff4d4d'], MAINT: ['정비 중', '#ffb020'] };
    this.order.forEach((c, i) => {
      const cx = 30 + i * 375, cy = 96, w = 355, h = 200, st = this.halted ? ['비상정지', '#ff4d4d'] : lab[c.fault ?? c.state] ?? [c.state, '#3a4654'];
      x.fillStyle = '#121a24'; x.fillRect(cx, cy, w, h); x.fillStyle = st[1]; x.fillRect(cx, cy, w, 8);
      x.fillStyle = '#7fe0d6'; let fs = 30; do { x.font = `800 ${fs}px ${F}`; fs -= 1; } while (x.measureText(`${c.def.no} ${c.def.label}`).width > w - 24 && fs > 18); x.fillText(`${c.def.no} ${c.def.label}`, cx + 14, cy + 48);
      x.fillStyle = st[1] === '#3a4654' ? '#9fb3c8' : st[1]; x.font = `700 28px ${F}`; x.fillText(st[0], cx + 14, cy + 92);
      const it = c.item; x.fillStyle = '#e6edf3'; x.font = `600 25px ${F}`;
      x.fillText(it && c.state !== 'IDLE' ? `${zl(it.zone)} ${S.products[it.product][1]}` : '-', cx + 14, cy + 132);
      if (c.state === 'BUSY') { x.fillStyle = '#26323f'; x.fillRect(cx + 14, cy + 150, w - 28, 14); x.fillStyle = '#37e8ff'; x.fillRect(cx + 14, cy + 150, (w - 28) * c.progress, 14); }
      x.fillStyle = '#6b7c8f'; x.font = `600 22px ${F}`; x.fillText(`처리 ${c.done} · 가동 ${this.time > 0 ? Math.round((c.busy / this.time) * 100) : 0}%`, cx + 14, cy + 190);
    });
    // 제품별 결과 · 최근 판정 · 검사 AMR
    x.font = `600 25px ${F}`;
    Object.entries(S.products).forEach(([k, [zk, l]], i) => {
      const b = s.by[k] ?? { ok: 0, unc: 0, ng: 0 }, cx = 30 + (i % 3) * 470, cy = 350 + Math.floor(i / 3) * 40;
      x.font = `600 23px ${F}`; x.fillStyle = '#9fb3c8'; x.fillText(`${zl(zk)} ${l}`, cx, cy); x.fillStyle = '#e6edf3'; x.fillText(`OK ${b.ok} · 불확실 ${b.unc} · NG ${b.ng}`, cx + 185, cy);
    });
    x.fillStyle = '#9fb3c8'; x.fillText(`최근 판정 · 데이터 서버 수신 ${(s.rx ?? 0).toLocaleString('ko-KR')}건`, 1450, 350);
    this.recent.slice(0, 4).forEach((r, i) => { x.fillStyle = r.res === 'ok' ? '#3ddc84' : r.res === 'ng' ? '#ff6b6b' : '#f5b82e'; x.fillText(`${r.id} ${zl(r.zone)} ${S.products[r.product][1]} ${r.res === 'ok' ? 'OK' : r.res === 'ng' ? 'NG' : '불확실'}`, 1450 + (i % 2) * 420, 390 + Math.floor(i / 2) * 40); });
    x.fillStyle = '#9fb3c8'; x.fillText('검사 AMR', 30, 460);
    const T = { park: '대기·충전', out: '샘플 수거 이동', load: '샘플 인수', in: '정밀검사Zone으로', queue: '접수 대기', move: '셀 간 이동', work: '검사 중', ready: '다음 셀 대기', home: '스테이션 복귀' };
    this.carriers.forEach((c, i) => { x.fillStyle = '#e6edf3'; x.fillText(`${c.uid} ${T[c.state] ?? c.state}${c.item ? ` · ${zl(c.item.zone)} ${S.products[c.item.product][1]}` : ''}`, 170 + i * 520, 460); });
    x.fillStyle = '#6b7c8f'; x.font = `600 22px ${F}`; x.fillText(`샘플링: 정밀조립 ${S.sample.main}개 · 유연생산 ${S.sample.flex}개 · 적응가공 ${S.sample.adapt}개마다 1개 · 판정 불확실 → O-INSPECT 재측정 · NG → 해당 Zone 오케스트레이터 리워크·공정 보정`, 30, 500);
    this.wallTex.needsUpdate = true;
  }
  // 새 실행마다 (main.js setup): 단계별 로봇·인력, 검사 AMR, 실적 초기화
  reset(modeKey, seed) {
    this.mode = modeKey; this.rng = mulberry((seed ?? 1) * 7919 + 11); this.time = 0; this.seq = 0;
    this.queue = []; this.counts = { main: 0, flex: 0, adapt: 0 }; this.unsampled = {}; this.base = null; this.recent = [];
    this.stats = { samples: 0, done: 0, ok: 0, unc: 0, ng: 0, by: {}, rx: 0 };
    for (const p of this.packets ?? []) { p.alive = false; p.m.visible = false; }
    const legacy = modeKey === 'traditional';
    this.mul = legacy ? 1.8 : modeKey === 'dark' ? 0.85 : 1;
    for (const c of this.order) {
      Object.assign(c, { occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0 });
      c.robotsG.clear(); c.workersG.clear(); c.robots = []; c.plates = []; c.robotUids = [];
      const n = c.def.robots ?? 0;
      if (legacy && (n || c.def.type === 'dock' || c.def.type === 'judge')) { const w = makeWorker(); put(w, -0.6, 0, -1.9, c.workersG); c.rb.textContent = '👷 검사원×1'; continue; }
      if (!n) { c.rb.textContent = c.def.type === 'judge' ? '🧠 AI 판정 에이전트' : c.def.type === 'dock' ? '📡 ID 리더·도킹' : ''; continue; }
      const slots = c.def.type === 'oins' ? [[OINS.robot.x, OINS.robot.z, 0]] : [[-0.6, -1.75, 0], [-0.6, 1.75, PI]];
      for (let i = 0; i < n; i++) {
        const r = makeRobot('articulated', MAT.orange), [x, z, yaw] = slots[i];
        put(r.root, x, 0.15, z, c.robotsG); r.root.rotation.y = yaw; r.phase = i * 1.7;
        if (c.def.type === 'scan' || c.def.type === 'atos' || c.def.type === 'vision') {   // 끝단 센서: 3D 스캐너(청색) · UT 프로브 · 비전 카메라
          const head = put(box(0.22, 0.12, 0.16, c.def.type === 'atos' || (c.def.type === 'scan' && i === 0) ? std(0x2b6cb0) : MAT.dark), 0, 0.06, 0, r.tip);
          put(cyl(0.035, 0.035, 0.03, emis(c.def.type === 'atos' ? 0x5aa0ff : 0x37e8ff, 2), 10), 0, 0.075, 0, head);
        }
        r.wristCam = modeKey === 'dark';   // 피지컬AI: 손목 카메라 (로봇 비전 관제 디스플레이 영상)
        if (c.def.type === 'oins') r.anim = (busy, t, p) => { if (busy) oiPose(r, p); else if (c.state !== 'BUSY') oiPose(r, 0); };
        const uid = `${INSP.uidp}-RB-${c.id}-${i + 1}`, sp = idPlate(uid); sp.position.set(0, 2.35, 0); r.root.add(sp); sp.visible = this.labelsOn; c.plates.push(sp);
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });   // 클릭 → 셀 로봇 텔레메트리 (factory.js pick → ExtraZones.cellRobot)
        c.robots.push(r); c.robotUids.push(uid);
      }
      c.rb.textContent = `🤖 6축×${n}`;
    }
    for (const k of ['ok', 'ng']) this.cells.JUDGE.parts.shelves[k].forEach((b) => (b.visible = false));
    // 검사 AMR
    for (const c of this.carriers) this.G.remove(c.g);
    this.carriers = Array.from({ length: INSP.amr.count }, (_, i) => {
      const x = INSP.station.xs[i], z = INSP.station.z, g = makeCarrierAMR(); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); this.G.add(g);
      const c = { id: `정밀검사-AMR${String(i + 1).padStart(2, '0')}`, uid: `${INSP.uidp}-AM-${String(i + 1).padStart(2, '0')}`, i, x, z, heading: PI, state: 'park', path: null, s: 0, L: 0, wait: 0, item: null, at: null, g };
      g.traverse((o) => { o.userData.moverId = c.id; });   // 클릭 → 운반 AMR 텔레메트리 (telemetry.js → ExtraZones.carrier)
      g.position.set(x, 0, z); g.rotation.y = c.heading; return c;
    });
  }
  setup(sim, xzones, labelsOn = this.labelsOn) {
    this.sim = sim; this.xzones = xzones; this.reset(sim.mode.key, sim.seed ?? 1);
    sim.inspZone = this;   // 정밀검사 Orchestrator (factoryos.js) 기능 에이전트 집계
    sim.inspAmr = this.carriers; this.wallG.visible = sim.mode.key !== 'traditional';   // 레거시는 전광판 없음
    sim.inspCells = this.order.map((c) => ({ x: c.def.x, z: c.def.z, label: c.def.label }));   // CCTV 위치 이름 (cctvview.js place)
    sim.setExternalMovers?.([...(sim.extMovers ?? []).filter((m) => m.zone !== 'insp'), ...this.carriers.map((c) => this.tele(c))]);
    for (const c of this.carriers) sim.net?.bindUE(c.id, c.uid, 'carrier', () => ({ x: c.x, y: 0.9, z: c.z, m: c }), c);   // 검사 AMR = Private 5G 단말
    this.setLabels(labelsOn);
  }
  sid(c) { return `${INSP.uidp}_${c.id}`; }
  // 텔레메트리용 셀 보기 (telemetry.js — 확장 Zone teleCell과 같은 항목)
  teleCell(c) {
    const zone = this;
    return c.teleC ??= {
      id: this.sid(c), name: `${INSP.code} ${c.def.label}`, type: c.def.type, zone: 'insp', x: c.def.x, z: c.def.z,
      get state() { return zone.halted ? 'ESTOP' : c.state === 'DONE' ? 'BLOCKED' : c.state; }, get progress() { return c.progress; }, health: 100,
      get item() { return c.item; }, get robotUids() { return c.robotUids; }, use: c.def.use,
    };
  }
  cellRobots() { return this.order.flatMap((c) => c.robots.map((r, idx) => ({ ref: { type: 'cell', stationId: this.sid(c), idx }, robot: c.robotUids[idx], st: this.teleCell(c), r }))); }   // 로봇 비전 관제 (robotcam.js InspCamWall)
  cellRobot(sid, idx) { const c = this.order.find((x) => this.sid(x) === sid); return c ? (c.robots[idx] ? { robot: c.robots[idx], st: this.teleCell(c) } : null) : undefined; }
  carrier(id) { const c = this.carriers.find((x) => x.id === id); return c ? { mover: this.tele(c), obj: c.g } : null; }
  // 셀 정보 창 내용 (ui.renderInspCell)
  cellInfo(id) {
    const c = this.cells[id]; if (!c) return null;
    const S = INSP, it = c.item, util = this.time > 0 ? c.busy / this.time : 0;
    const uses = Object.entries(S.routes).filter(([, r]) => r.includes(id) || id === 'DOCK' || id === 'JUDGE').map(([p]) => `${zl(S.products[p][0])} ${S.products[p][1]}`);
    return { c, def: c.def, state: this.halted ? 'ESTOP' : c.state, item: it ? `${zl(it.zone)} ${S.products[it.product][1]} ${it.id}${it.rechecked ? ' (재측정)' : ''}` : '-', progress: c.progress, cycle: c.def.cycle * this.mul, util, done: c.done,
      products: uses, robots: c.robotUids, amr: c.occ?.id ?? '-', stats: this.stats, queue: this.queue.length, recent: this.recent, mode: this.mode };
  }
  tele(c) {
    const zone = this;
    return c.tele ??= {
      id: c.id, uid: c.uid, kind: 'zoneamr', zone: 'insp', prio: 1e6, idle: false, steps: [], blockedOn: null, hzWait: false,
      get x() { return c.x; }, get z() { return c.z; }, get heading() { return c.heading; },
      get moving() { return ['out', 'in', 'move', 'home'].includes(c.state); }, get state() { return c.state; },
      get task() { return { park: '검사 AMR 스테이션 대기', out: '샘플 수거 이동', load: '샘플 인수', in: '정밀검사Zone으로 이송', move: '검사 셀 간 이동', work: '검사 중', wait: '다음 검사 셀 대기', home: '스테이션 복귀', queue: '접수 대기' }[c.state] ?? c.state; },
      get payload() { const it = c.item; return it ? `${INSP.products[it.product][1]} 샘플#${it.id}` : 'empty'; },
    };
  }
  // 생산 실적 → 샘플 요청 (양품 N개마다 1개)
  goodCounts() {
    const s = this.sim, g = { main: s.stats.goodBy ?? {} };
    for (const k of ['flex', 'adapt']) g[k] = this.xzones?.byKey(k)?.stats.good ?? {};
    return g;
  }
  sampleTick() {
    const g = this.goodCounts();
    if (!this.base) { this.base = JSON.parse(JSON.stringify(g)); return; }
    for (const [zk, by] of Object.entries(g)) for (const [p, n] of Object.entries(by)) {
      if (!INSP.products[p]) continue;
      const prev = this.base[zk]?.[p] ?? 0;
      if (n > prev) {
        this.counts[zk] += n - prev; (this.base[zk] ??= {})[p] = n; (this.unsampled[zk] ??= {})[p] = (this.unsampled[zk][p] ?? 0) + n - prev;
        if (this.counts[zk] >= INSP.sample[zk]) {   // 이번 샘플 제품 = 그 Zone에서 마지막 샘플 뒤로 가장 많이 만든 제품 (혼류 비율대로 고르게)
          this.counts[zk] -= INSP.sample[zk];
          const U = this.unsampled[zk], q = Object.keys(U).reduce((a, b) => (U[b] > U[a] ? b : a)); U[q] = 0;
          const req = { id: `QS-${String(++this.seq).padStart(4, '0')}`, zone: zk, product: q, t0: this.time }; this.queue.push(req); this.stats.samples++;
          this.sim.fos?.sampleRequest(req);   // A2A: 생산 Zone → 정밀검사 서비스 요청 (정밀조립은 샘플 시리얼 HOLD)
          if (this.sim.fos) this.queue = this.sim.fos.inspPriority(this.queue);   // 여러 Zone 요청이 함께면 공장 오케스트레이터가 순서 결정
        }
      }
    }
  }
  nextOf(c) { const it = c.item; if (!it) return null; if (it.redo) return 'OINS'; return INSP.routes[it.product].find((id) => !it.done.has(id)) ?? 'JUDGE'; }
  go(c, pts, state) { c.path = pts; c.s = 0; c.L = pathLength(pts); c.state = state; c.wait = 0; }
  inPath(a, b) {   // 존 안: 셀 → 가운데 차로 → 셀
    const L = INSP.lane + (b.z > a.z ? 0.6 : -0.6), pts = [{ x: a.x, z: a.z }];   // 남행 +0.6 · 북행 −0.6 (마주 오는 AMR끼리 엇갈림)
    if (Math.abs(a.z - b.z) > 0.01 || Math.sign(a.x - L) === Math.sign(b.x - L)) pts.push({ x: L, z: a.z }, { x: L, z: b.z });
    pts.push({ x: b.x, z: b.z }); return pts;
  }
  step(dt, halted) {
    if (!this.sim) return;
    this.halted = halted; if (halted) return;
    this.time += dt;
    this.sampleTick();
    for (const c of this.order) {
      // 셀 고장·정비 (sim.js 설비 관리 — 정밀검사 정비실 인력이 수리): 끝날 때까지 검사가 멈춘다 · 가동 여부를 알려 마모 계산에 쓴다
      const zc = this.sim.zoneCell?.('insp', c.id); c.fault = zc && (zc.state === 'DOWN' || zc.state === 'MAINT') ? zc.state : null;
      if (zc) zc.busy = c.state === 'BUSY';
      if (c.fault || c.state !== 'BUSY') continue;
      c.busy += dt; c.progress = Math.min(1, c.progress + dt / c.cur);
      if (c.progress >= 1) { c.state = 'DONE'; c.done++; }
    }
    // 대기 중인 샘플 요청 → 스테이션의 빈 AMR 배차 (출구에 가까운 자리부터)
    if (this.queue.length) {
      const c = this.carriers.find((k) => k.state === 'park');
      if (c) {
        const req = this.queue.shift(), P = INSP.pickup[req.zone];
        c.item = { ...req, done: new Set(), redo: false }; c.load = false;
        this.sim.fos?.sampleAccept(req, c.id);
        const from = { x: c.x, z: INSP.station.exitZ, aisle: 'F' };
        this.go(c, [{ x: c.x, z: c.z }, ...route(from, P)], 'out');
        this.sim.log('info', `정밀검사 샘플 수거 배차 — ${zl(req.zone)} ${INSP.products[req.product][1]}`, { obs: `${zl(req.zone)} 양품 ${INSP.sample[req.zone]}개마다 1개 샘플링 (${req.id})`, act: `${c.id} → ${zl(req.zone)} 적재장` });
      }
    }
    for (const c of this.carriers) this.stepCarrier(c, dt);
  }
  stepCarrier(c, dt) {
    const S = INSP;
    switch (c.state) {
      case 'out': case 'in': case 'move': case 'home': {
        if (this.blocked(c)) { c.wait += dt; if (c.wait < 20) break; } else c.wait = 0;
        c.s = Math.min(c.L, c.s + S.amr.speed * dt);
        const p = pointAt(c.path, c.s), dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz > 1e-8) c.heading = Math.atan2(dx, dz); c.x = p.x; c.z = p.z;
        if (c.s < c.L - 1e-6) break;
        if (c.state === 'out') { c.state = 'load'; c.timer = 6; c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2; break; }
        if (c.state === 'in') { c.state = 'queue'; c.heading = PI; break; }
        if (c.state === 'home') { c.state = 'park'; c.heading = PI; break; }
        // move: 셀 도착 → 검사 시작
        c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2;
        const cell = this.cells[c.target]; c.at = c.target;
        Object.assign(cell, { state: 'BUSY', progress: 0, item: c.item, cur: cell.def.cycle * this.mul * (0.9 + this.rng() * 0.2) });
        c.state = 'work';
        break;
      }
      case 'load':
        c.timer -= dt;
        if (c.timer <= 0) {
          this.attach(c);
          this.sim.fos?.sampleHandover(c.item);   // 인계 준비 → 인수 확인 (시리얼 대조)
          this.go(c, [{ x: c.x, z: c.z }, ...route(S.pickup[c.item.zone], { x: this.entryX(c.i), z: S.entryZ, aisle: 'BB' })], 'in');
        }
        break;
      case 'queue': {   // 접수 도킹 앞 대기 → 비면 들어간다
        const dock = this.cells.DOCK; if (dock.occ || dock.fault) break;
        dock.occ = c; c.target = 'DOCK'; this.go(c, [{ x: c.x, z: c.z }, { x: c.x, z: dock.def.z - 2.6 }, { x: dock.def.x, z: dock.def.z - 1.2 }, { x: dock.def.x, z: dock.def.z }], 'move');
        break;
      }
      case 'work': {
        const cell = this.cells[c.at];
        if (cell.state !== 'DONE') break;
        if (c.at === 'JUDGE') this.judge(c, cell);
        if (c.state === 'work') c.state = 'ready';
        break;
      }
      case 'ready': {
        const it = c.item, cur = this.cells[c.at];
        if (it && c.at !== 'DOCK' && c.at !== 'JUDGE') it.done.add(c.at);
        const next = this.nextOf(c);
        if (!next) {   // 판정 끝 → 스테이션 복귀
          cur.occ = null; cur.state = 'IDLE'; cur.item = null; cur.progress = 0;
          const slot = S.station.xs[c.i];
          const L = S.lane + 0.6; this.go(c, [{ x: cur.def.x, z: cur.def.z }, { x: L, z: cur.def.z }, { x: L, z: S.station.z }, { x: slot, z: S.station.z }], 'home');   // 남행 줄로 내려와 자기 자리로
          break;
        }
        const nx = this.cells[next], o = nx.occ;
        if (nx.fault) break;   // 다음 검사 셀이 고장·정비 중이면 지금 자리에서 기다린다
        if (o) {   // 서로 상대 셀을 기다리면 (재측정 ↔ 판정) 자리를 맞바꾼다 — 교착 방지 (가운데 차로는 방향별 두 줄이라 엇갈려 지나간다)
          if (!(o.state === 'ready' && this.nextOf(o) === c.at)) break;
          for (const [a, from, to] of [[c, cur, nx], [o, nx, cur]]) { if (a.item?.redo && to.id === 'OINS') a.item.redo = false; to.occ = a; a.target = to.id; this.go(a, this.inPath(from.def, to.def), 'move'); }
          for (const k of [cur, nx]) { k.state = 'IDLE'; k.item = null; k.progress = 0; }
          break;
        }
        if (it.redo) it.redo = false;
        nx.occ = c; cur.occ = null; cur.state = 'IDLE'; cur.item = null; cur.progress = 0;
        c.target = next; this.go(c, this.inPath(cur.def, nx.def), 'move');
        break;
      }
    }
  }
  // AI 판정: OK · 판정 불확실(→ O-INSPECT 재측정 후 재판정, 한 번만) · NG(→ 해당 Zone 오케스트레이터에 리워크·공정 보정 요청)
  judge(c, cell) {
    const it = c.item, S = INSP, [zk, plabel] = S.products[it.product], r = this.rng(), s = this.stats;
    const res = !it.rechecked && r < S.judge.uncertain ? 'unc' : r < S.judge.uncertain + S.judge.ng ? 'ng' : 'ok';
    const by = (s.by[it.product] ??= { ok: 0, unc: 0, ng: 0 });
    if (res === 'unc') {
      s.unc++; by.unc++; it.rechecked = true; it.redo = true; it.done.delete('OINS');
      this.push(it, 'unc'); cell.flash = { col: 0xf5b82e, t: 2 };
      this.sim.log('warn', `정밀검사 판정 불확실 — ${zl(zk)} ${plabel} ${it.id}`, { obs: 'AI 판정 신뢰도 기준 미달', dec: 'Quality & Recovery Agent: O-INSPECT 재측정 후 재판정', act: `${c.id} → ③ O-INSPECT` });
      return;
    }
    s.done++; s[res]++; by[res]++; this.push(it, res);
    this.sim.fos?.sampleResult(it, res);   // 결과 → 생산 Zone · NG면 품질 알림 → 정밀조립 8D
    cell.flash = { col: res === 'ok' ? 0x3ddc84 : 0xff4d4d, t: 2 };
    const sh = cell.parts.shelves[res === 'ok' ? 'ok' : 'ng'], n = res === 'ok' ? s.ok : s.ng; sh.forEach((b, i) => (b.visible = i < Math.min(6, n)));
    if (res === 'ng' && this.mode !== 'traditional') this.spawnPacket(cell.sensor.getWorldPosition(new THREE.Vector3()), 0xff4d4d);   // NG 판정 → 서버 (QMS 저장 · 오케스트레이터 알림)
    if (res === 'ng') this.sim.log('warn', `정밀검사 NG — ${zl(zk)} ${plabel} ${it.id}`, { obs: `검사 경로 ${S.routes[it.product].map((id) => S.cells[id].label).join(' → ')}${it.rechecked ? ' → O-INSPECT 재측정' : ''}`, dec: 'Quality & Recovery Agent 최종 NG · QMS 저장', act: `${zl(zk)} 오케스트레이터에 리워크 Task · 선행공정 조건 보정 요청` });
    this.detach(c); c.item = null;
  }
  push(it, res) { this.recent.unshift({ id: it.id, zone: it.zone, product: it.product, res, t: this.time }); this.recent.length = Math.min(this.recent.length, 6); }
  attach(c) { const col = INSP.products[c.item.product][2], m = sampleMesh(col); m.position.set(0, BELT_Y - 0.02, 0); c.g.add(m); c.pm = m; }
  detach(c) { if (c.pm) { c.g.remove(c.pm); c.pm = null; } }
  // 앞길에 다른 이동체 (시뮬레이션 이동체 · 다른 Zone AMR · 다른 검사 AMR)
  blocked(c) {
    const hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    const list = [...(this.sim.movers ?? []).filter((m) => m.state !== 'line'), ...(this.sim.extMovers ?? []).filter((m) => m.id !== c.id)];
    for (const m of list) {
      if (m.zone === 'insp' && m.id === c.id) continue;
      const rx = m.x - c.x, rz = m.z - c.z, along = rx * hx + rz * hz, lat = Math.abs(rx * hz - rz * hx);
      if (along > 0.15 && along < 0.8 + moverRadius(m) + 0.5 && lat < (0.95 + moverWidth(m)) / 2 + 0.1) {
        if (m.zone === 'insp') { const o = this.carriers.find((k) => k.id === m.id); if (o && !['out', 'in', 'move', 'home'].includes(o.state) && c.wait > 3) return false; if (o && c.i > o.i && Math.cos(o.heading - c.heading) < -0.5) return false; }
        return true;
      }
    }
    return false;
  }
  // ── 화면 ─────────────────
  update(rdt, running, speed) {
    this.t = (this.t ?? 0) + rdt; const t = this.t, dts = running ? rdt * speed : 0;
    for (const c of this.carriers) {
      c.g.position.set(c.x, 0, c.z);
      let d = c.heading - c.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); c.g.rotation.y += d * Math.min(1, rdt * 8);
    }
    for (const c of this.order) this.animCell(c, t, rdt, dts);
    this.sendData(rdt, t);
    this.boardT -= rdt; if (this.boardT <= 0) { this.boardT = 0.5; if (this.wallG.visible) this.drawWall(); }
  }
  animCell(c, t, rdt, dts) {
    const P = c.parts, busy = c.state === 'BUSY' && !this.halted && !c.fault, p = c.progress;
    const st = this.halted ? 'ESTOP' : c.fault ?? (c.state === 'DONE' ? 'BUSY' : c.state);
    c.light.userData.set(st, t);
    for (const r of c.robots) r.anim(busy, t + r.phase, p);
    switch (c.def.type) {
      case 'dock': P.reader.emissiveIntensity = busy ? 2 + Math.sin(t * 12) : 0.6; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'vision': P.light.emissiveIntensity = busy ? 2.4 : 0.5; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'scan': P.blue.emissiveIntensity = busy && Math.sin(t * 9) > -0.2 ? 2.2 : 0.3; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'atos': P.screen.emissive.setHex(busy ? 0x5aa0ff : 0x3ddc84); break;
      case 'oins': {
        const meas = busy && p > 0.16 && p < 0.84, onT = busy && p > 0.1 && p < 0.89;
        P.onTable.visible = onT; if (onT && c.item) P.onTable.userData.body?.material.color.setHex(INSP.products[c.item.product][2]);
        const amr = c.occ; if (amr?.pm) amr.pm.visible = !onT;
        P.carriage.position.z += ((meas ? -2.0 : -2.45) - P.carriage.position.z) * Math.min(1, rdt * 5);   // 헤드(캐리지 +0.25)가 샘플 위(z −1.75)로
        const tq = meas ? -(0.03 + 0.08 * Math.abs(Math.sin(p * PI * 12))) : 0;   // 탐침 끝 y 1.25 → 1.17 (샘플 윗면 1.16 접촉) P.quill.position.y += (tq - P.quill.position.y) * Math.min(1, rdt * 8);
        P.tipMat.emissiveIntensity = meas && Math.sin(p * PI * 12) > 0.9 ? 6 : 1.2; P.screen.emissive.setHex(meas ? 0x58c4ff : 0x3ddc84);
        break;
      }
      case 'judge': {
        P.leds.forEach((m, i) => (m.emissiveIntensity = busy ? (Math.sin(t * 10 + i * 1.3) > 0 ? 2.5 : 0.4) : 1));
        if (c.flash) { c.flash.t -= rdt; P.screen.emissive.setHex(c.flash.col); if (c.flash.t <= 0) c.flash = null; } else P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84);
        break;
      }
    }
  }
  updateLabels() {
    const lab = { IDLE: '대기', BUSY: '검사 중', DONE: '다음 셀 대기', DOWN: '고장 · 수리 대기', MAINT: '정비 중' };
    for (const c of this.order) {
      const st = this.halted ? 'ESTOP' : c.fault ?? c.state;
      c.chip.className = 'chip s-' + (st === 'DONE' ? 'BLOCKED' : st);
      const it = c.item; c.chip.textContent = (this.halted ? '비상정지' : lab[c.fault ?? c.state] ?? c.state) + (it && c.state === 'BUSY' ? ` · ${zl(it.zone)} ${INSP.products[it.product][1]}` : '');
    }
  }
  setLabels(on) { this.labelsOn = on; for (const c of this.order) { c.label.visible = on; for (const sp of c.plates) sp.visible = on; } }
  summary() { return { ...this.stats, queue: this.queue.length, active: this.carriers.filter((c) => c.item).length }; }
}
