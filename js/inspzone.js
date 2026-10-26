// 정밀검사Zone (AI정밀검사 · QMS Zone) — 오른쪽 세로 통로(x 30)와 오른쪽 벽(x 48) 사이, 뒤쪽 통로(z −32 · 출하 도크 아래)와 앞쪽 통로(z 9 · 정밀조립/적응가공 사이) 사이
// llm-wiki 「AI정밀검사(QMS) Zone 통합 시나리오 v0.3」(10/6) 기준: 공정 내 전수검사는 각 생산 존이, 샘플링 검사는 정밀검사Zone이 맡는다.
//  · 셀: 시료 접수·도킹 → ① 로봇형 비전 검사(ABIS 표면결함 · AIMAX Feature) · ② 3D 스캔·초음파 용접검사(ScanBox · UT NDT — 용접부 NDT 필수)
//        ③ O-INSPECT 정밀 재측정(정반 안착) · ④ ATOS 3D 형상편차(Point Cloud) → ⑤ AI 판정(OK · 판정 불확실 · NG) · 결과 버퍼
//  · 제품별 검사 경로 — 모든 제품이 같은 장비를 거치지 않는다 (판정 불확실 → ③ 재측정 후 재판정 · NG → 로트 봉쇄 · 처분(재작업·폐기) · 공정 보정 · 샘플링 강화 — js/serial.js)
//  · 검사 AMR 3대가 세 생산 Zone 적재장에서 N개마다 1개씩 샘플을 지그째 실어 온다 (공장 통로로 이동 — 시뮬레이션 이동체와 서로 양보)
// 시계는 정밀조립Zone 시뮬레이션과 같다 (main.js가 step/update를 부른다). 라인 전체 비상정지·보호정지 때 함께 멈춘다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KIT } from './factory.js';
import { route, moverRadius, moverWidth } from './sim.js';
import { pointAt, pathLength } from './line.js';
import { INSP_AREA, INSP_SOUTH, INSP_SERVER, INSP_CELLS, INSP_REPACK, MODE_IDX as MODE_I, cellT, zoneCtl } from './zonedefs.js';
import { makeProduct } from './zones.js';
import { PACK_BOX } from './pack.js';

const { std, emis, mesh, box, cyl, put, MAT, BELT_Y, makeRobot, makeWorker, makeCarrierAMR, makeStackLight, cellBase, idPlate, armIK } = KIT;
const PI = Math.PI;

export const INSP = {
  key: 'insp', code: '정밀검사', uidp: 'QIS', name: '정밀검사Zone', sub: 'AI정밀검사(QMS) · 샘플링 검사',
  area: INSP_AREA,
  lane: 39.25,   // 두 셀 줄 사이 AMR 차로 (x)
  cells: INSP_CELLS,
  // 제품별 검사 경로 (접수 다음 ~ 판정 앞)
  // 제품별 검사 경로 (개봉 다음 ~ 판정 앞) — 재포장하므로 비파괴만: 도어트림(플라스틱)은 초음파 대신 검사 지그 3D 형상 + 스위치 기능 · e-axle(1m · 75kg)은 O-INSPECT 대신 ATOS·사진측량 + 누설·절연·잔류 토크
  //  유압블록은 내부 유로 교차홀 버(CT)·청정도(ISO 16232) · 리어커버는 다이캐스팅 기공(CT)·누설
  routes: { doortrim: ['VIS', 'ATOS', 'FUNC'], eaxle: ['VIS', 'ATOS', 'FUNC'], hood: ['VIS', 'SCAN'], door: ['VIS', 'SCAN'], hblock: ['OINS', 'CT', 'CLEAN'], rcover: ['ATOS', 'OINS', 'CT', 'FUNC'] },
  redo: { doortrim: 'ATOS', eaxle: 'ATOS', hood: 'SCAN', door: 'SCAN', hblock: 'OINS', rcover: 'OINS' },   // 판정 불확실 → 그 제품의 주 치수 측정 셀에서 재측정
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
// 시료: 실제 제품 모델 (정밀조립 도어트림·e-axle은 포장 상자째 — 접수에서 개봉 · 합격이면 판정 셀에서 새 포장재로 재포장) — AMR 지그 상판(BELT_Y) 기준
const productMesh = (p) => (p === 'doortrim' ? KIT.makeDoortrimPlate() : p === 'eaxle' ? KIT.makeEaxlePlate() : makeProduct(p));
const BOX_MAT = { doortrim: MAT.carton, eaxle: MAT.crate }, LID_MAT = { doortrim: std(0xb88a5c, { roughness: 0.85 }), eaxle: std(0x6d5a8a, { roughness: 0.7 }) };
function makeLid(p) { const B = PACK_BOX[p], g = new THREE.Group(); put(box(B.w + 0.01, B.lid, B.d + 0.01, LID_MAT[p]), 0, B.lid / 2, 0, g); put(box(0.14, 0.004, 0.09, std(0xf4f4f0)), B.w * 0.2, B.lid + 0.002, 0, g); return g; }
function makeSample(p) {
  const g = new THREE.Group(), prod = put(productMesh(p), 0, 0, 0, g);
  const bb = new THREE.Box3().setFromObject(prod);
  g.userData = { body: prod, prod, h: bb.max.y, product: p };
  const B = PACK_BOX[p];
  if (B) { g.userData.box = put(KIT.openBox(B, BOX_MAT[p]), 0, 0, 0, g); g.userData.lid = put(makeLid(p), 0, B.h, 0, g); g.userData.B = B; }
  return g;
}
// 포장 상태: closed = 상자·뚜껑 안에 제품 · open = 지그 위 제품만
function setPacked(m, closed) {
  const U = m.userData; if (!U.box) return;
  U.box.visible = U.lid.visible = closed; U.box.position.set(0, 0, 0); U.lid.position.set(0, U.B.h, 0); U.prod.position.set(0, closed ? 0.02 : 0, 0);
}

// ── 셀 설비 모델 (셀 중심 기준 · AMR은 동서(x) 방향으로 셀 가운데 정차) ─────────────────
// 접수·개봉 · 판정·재포장 셀 공통 배치: 고가반 6축(북쪽 x 0.3) · 임시 받침대(북서) · 포장재 랙(북동)
const XFER = { robot: { x: 0.3, z: -1.95 }, table: { x: -1.0, z: -2.0, y: 0.75 }, rack: { x: 1.6, z: -1.6, y: 0.62 } };
// 접수·개봉 셀은 남쪽에 (검사 AMR이 뒤쪽 통로 대기 줄에서 북쪽으로 들어온다 — 북쪽에 두면 들어오는 AMR·시료가 로봇·받침대에 걸린다)
const XFER_S = { robot: { x: 0.3, z: 1.95, yaw: Math.PI }, table: { x: -1.0, z: 2.0, y: 0.75 }, rack: { x: 1.6, z: 1.6, y: 0.62 } };
const xferOf = (type) => (type === 'dock' ? XFER_S : XFER);
function xferFixtures(g, rackLabel, XFER) {
  put(box(0.8, 0.75, 0.6, MAT.steel), XFER.table.x, 0.375, XFER.table.z, g);   // 임시 받침대 (제품을 잠시 내려놓는다)
  const rack = put(new THREE.Group(), XFER.rack.x, 0, XFER.rack.z, g);
  for (const y of [0.3, XFER.rack.y]) put(box(1.2, 0.04, 0.9, MAT.steel), 0, y, 0, rack);
  for (const [x, z] of [[-0.58, -0.43], [0.58, -0.43], [-0.58, 0.43], [0.58, 0.43]]) put(box(0.04, XFER.rack.y + 0.04, 0.04, MAT.steel), x, (XFER.rack.y + 0.04) / 2, z, rack);
  const stacks = { doortrim: put(new THREE.Group(), -0.3, XFER.rack.y + 0.02, 0, rack), eaxle: put(new THREE.Group(), 0.3, XFER.rack.y + 0.02, 0, rack) };   // 상자·뚜껑 더미 (제품별)
  for (const [k, st] of Object.entries(stacks)) for (let i = 0; i < 6; i++) { const B = PACK_BOX[k]; put(box(Math.min(0.55, B.w * 0.5), 0.05, Math.min(0.8, B.d), i % 2 ? LID_MAT[k] : BOX_MAT[k]), 0, 0.025 + i * 0.055, 0, st).visible = false; }
  const lab = put(textPlane([rackLabel], 1.3, 0.3), XFER.rack.x, 1.35, XFER.rack.z + Math.sign(XFER.rack.z) * 0.46, g); lab.rotation.x = 0; if (XFER.rack.z > 0) lab.rotation.y = Math.PI;
  return { stacks };
}
function buildDock(g) {
  for (const z of [-1.3, 1.3]) put(box(0.14, 2.3, 0.14, MAT.steel), -1.5, 1.15, z, g);
  put(box(0.24, 0.24, 2.74, MAT.steel), -1.5, 2.3, 0, g);
  const reader = emis(0x37e8ff, 1.2);
  for (const z of [-0.9, 0.9]) { const r = put(box(0.2, 0.16, 0.12, MAT.dark), -1.5, 2.08, z, g); put(box(0.14, 0.04, 0.02, reader, false), 0, -0.04, z > 0 ? -0.07 : 0.07, r); }
  const term = put(box(0.6, 1.2, 0.4, MAT.dark), -2.0, 0.6, 1.95, g), screen = emis(0x3ddc84, 1.2); put(box(0.46, 0.32, 0.02, screen, false), 0, 0.35, -0.21, term);   // 접수 단말 (남서)
  return { reader, screen, ...xferFixtures(g, '포장재 반납 (접어서 회수)', XFER_S) };
}
function buildVisionCell(g) {
  // ABIS 조명 터널 (AMR이 지나가는 문형 조명) · AIMAX 고정 카메라 2대 · 분광 색차계 (로봇 손목 카메라 옆)
  for (const z of [-1.3, 1.3]) put(box(0.14, 2.3, 0.14, MAT.white), 0.95, 1.15, z, g);
  put(box(0.5, 0.2, 2.74, MAT.white), 0.95, 2.3, 0, g);
  const light = emis(0xdff6ff, 0.6); put(box(0.42, 0.03, 2.4, light, false), 0.95, 2.19, 0, g);
  for (const z of [-0.8, 0.8]) { const cam = put(box(0.16, 0.12, 0.2, MAT.dark), 0.95, 2.05, z, g); cam.rotation.x = z > 0 ? 0.5 : -0.5; put(cyl(0.04, 0.04, 0.05, emis(0x37e8ff, 1.5), 10), 0, -0.07, 0, cam); }
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.9, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { light, screen };
}
function buildScanCell(g) {
  // ScanBox 프레임 (청색 조명) + 위상배열 초음파(PAUT) 탐상기 · 로봇 2대(3D 스캐너 · PAUT 프로브)
  const fr = put(new THREE.Group(), 1.55, 0, 0, g);
  for (const [x, z] of [[-0.45, -1.2], [0.45, -1.2], [-0.45, 1.2], [0.45, 1.2]]) put(box(0.1, 2.4, 0.1, MAT.steel), x, 1.2, z, fr);
  put(box(1.0, 0.1, 2.5, MAT.steel), 0, 2.4, 0, fr);
  const blue = emis(0x3a7bff, 0.4); put(box(0.9, 0.03, 2.3, blue, false), 0, 2.33, 0, fr);
  const ut = put(box(0.55, 0.45, 0.4, MAT.dark), 1.9, 0.9, 1.75, g), screen = emis(0x3ddc84, 1.2); put(box(0.4, 0.26, 0.02, screen, false), 0, 0.05, 0.21, ut);
  put(box(0.3, 0.68, 0.3, MAT.steel), 1.9, 0.34, 1.75, g);
  return { blue, screen };
}
// 안에 넣어 재는 셀 (O-INSPECT 정반 · 청정도 추출 캐비닛 · CT 턴테이블): 로봇이 AMR 지그의 시료를 집어 넣고, 끝나면 다시 AMR로
// 청정도 · CT: 로봇을 받침대(0.45m) 위 AMR 통로와 장비 사이 가운데(z −1.15)에 — 뒤로 돌아 AMR 시료를 집고 앞쪽 장비에 넣는 머신 텐딩 배치
//  (예전 자리 x −1.45 · z −0.95는 AMR이 셀 서쪽에서 들어오는 길 옆 바닥이라 AMR·장비 옆벽·CT 문과 겹쳤다) · 장비는 그만큼 뒤로 (청정도 추출대 z −2.1 · CT 턴테이블 z −2.45)
const CAB = { oins: { robot: { x: -1.45, z: -0.95 }, table: { x: 0, z: -1.75, y: 0.9 } }, clean: { robot: { x: 0, z: -1.15, y: 0.45 }, table: { x: 0, z: -2.1, y: 0.95 } }, ct: { robot: { x: 0, z: -1.15, y: 0.2 }, table: { x: 0, z: -2.35, y: 0.92 } } };   // CT 턴테이블은 차폐 본체 앞 시료실 가운데 · 받침대를 낮춰(0.2m) 넣을 때 위팔이 시료실 지붕 앞 모서리에 걸리지 않게 · 문을 받침대에서 0.68m 띄움   // CT 문(앞면 z −1.58)이 로봇 받침(−1.45)과 띄워짐
const OINS = { col: -2.7 };
// O-INSPECT: 화강암 정반 + 뒤쪽 기둥 · 앞으로 뻗은 암 · 측정 헤드(카메라·접촉 프로브)
function buildOins(g) {
  const granite = std(0x3b3f45, { roughness: 0.35, metalness: 0.1 });
  put(box(1.3, 0.8, 1.1, MAT.dark), 0, 0.4, -1.95, g);
  put(box(1.3, 0.1, 1.1, granite), 0, 0.85, -1.95, g);
  put(box(0.4, 2.1, 0.4, MAT.white), 0, 1.05, OINS.col, g);
  const carriage = put(new THREE.Group(), 0, 2.0, -2.45, g);   // 대기: 측정 헤드가 정반 뒤쪽(z −2.2) — 로봇이 시료를 놓는 자리(z −1.75) 위를 비워 둔다
  put(box(0.26, 0.2, 1.2, MAT.white), 0, 0.06, -0.3, carriage);   // 암 (기둥 → 앞)
  const quill = put(new THREE.Group(), 0, 0, 0.25, carriage);
  put(box(0.08, 0.9, 0.08, MAT.steel), 0, -0.25, 0, quill);
  const tipMat = emis(0xff4d6d, 1.5); put(mesh(new THREE.SphereGeometry(0.03, 12, 8), tipMat), 0, -0.72, 0, quill);
  put(box(0.14, 0.12, 0.14, MAT.accent), 0, -0.05, 0, quill);
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.8, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { carriage, quill, tipMat, screen };
}
function buildAtos(g) {
  // 블루라이트 3D 스캐너 거치 프레임 + 기준 마커 판 · 사진측량(TRITOP) 마커 막대 (e-axle 같은 큰 시료)
  for (const z of [-1.3, 1.3]) put(box(0.12, 0.05, 0.6, emis(0x37e8ff, 0.8), false), 1.2, 0.08, z, g);
  for (const [x, z] of [[-1.6, 1.4], [1.6, 1.4]]) { put(box(0.06, 1.6, 0.06, MAT.dark), x, 0.8, z, g); put(box(0.5, 0.04, 0.04, std(0xf4f4f0)), x, 1.62, z, g); }
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.7, 0.3, MAT.dark), 1.8, 0.35, -1.7, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.15, 0.16, ctl);
  return { screen };
}
function buildJudge(g) {
  // AI 판정 엣지 서버 + 판정 모니터 (남동) · 새 포장재 매거진(북동 — 상자·뚜껑 · 「정밀검사 합격」 라벨) · NG 격리 선반(남서, 빨강)
  const rack = put(box(0.7, 1.9, 0.7, MAT.dark), 1.7, 0.95, 1.7, g);
  const leds = [0, 1, 2, 3].map((k) => { const m = emis(0x3ddc84, 1.5); put(box(0.5, 0.03, 0.01, m, false), 0, 0.6 - k * 0.3, -0.36, rack); return m; });
  const mon = put(box(1.0, 0.6, 0.06, MAT.dark), 0.5, 1.6, 2.0, g), screen = emis(0x3ddc84, 1.2); put(box(0.92, 0.52, 0.02, screen, false), 0, 0, -0.04, mon);
  put(box(0.08, 1.3, 0.08, MAT.dark), 0.5, 0.65, 2.0, g);
  const s = put(new THREE.Group(), -0.9, 0, 1.75, g);
  for (const y of [0.35, 0.95]) put(box(1.2, 0.04, 0.6, MAT.steel), 0, y, 0, s);
  for (const [x, zz] of [[-0.58, -0.28], [0.58, -0.28], [-0.58, 0.28], [0.58, 0.28]]) put(box(0.04, 1.2, 0.04, MAT.steel), x, 0.6, zz, s);
  put(box(1.2, 0.08, 0.02, emis(0xff4d4d, 1.2), false), 0, 1.2, -0.31, s);
  const ng = [0, 1, 2, 3, 4, 5].map((i) => { const b = put(box(0.3, 0.18, 0.3, std(0xd96a6a)), -0.4 + (i % 3) * 0.4, (i < 3 ? 0.35 : 0.95) + 0.11, 0, s); b.visible = false; return b; });
  const X = xferFixtures(g, '새 포장재 매거진', XFER);
  for (const st of Object.values(X.stacks)) st.children.forEach((b) => (b.visible = true));
  return { leds, screen, shelves: { ng }, ...X };
}
// 기능·누설 시험: 스위치 작동력 시험기(로드셀 손끝) · 공기 누설 시험기(압력 게이지) · 절연저항계 · 잔류 토크 트랜스듀서 — 로봇이 시료 윗면 시험 점을 차례로 누른다
function buildFunc(g) {
  const con = put(box(0.9, 1.2, 0.5, MAT.dark), 1.55, 0.6, -1.85, g), screen = emis(0x58c4ff, 1.2); put(box(0.7, 0.36, 0.02, screen, false), 0, 0.3, 0.26, con);
  const gauge = emis(0x3ddc84, 1.0); put(cyl(0.12, 0.12, 0.04, gauge, 16), 0, -0.1, 0.27, con).rotation.x = PI / 2;
  const hipot = put(box(0.45, 0.35, 0.4, std(0xd8a032)), 1.6, 0.9, 1.85, g); put(box(0.5, 0.72, 0.45, MAT.steel), 1.6, 0.36, 1.85, g);   // 절연저항·내전압 시험기 (남동)
  const warn = emis(0xffb020, 0.4); put(box(0.3, 0.06, 0.02, warn, false), 0, 0.1, -0.21, hipot);
  const hose = put(cyl(0.02, 0.02, 1.4, std(0x2f6f8f), 8), 1.1, 1.05, -1.2, g); hose.rotation.x = PI / 2.6;
  return { screen, gauge, warn };
}
// 청정도 분석 (ISO 16232 · VDA 19): 압력 세정 추출 캐비닛(유리문 · 세정 노즐) · 진공 여과 · 필터 건조 · 자동 입자 분석 현미경 — 청정 부스(비닐 커튼)
function buildClean(g) {
  const T = CAB.clean.table;
  put(box(1.5, T.y - 0.05, 1.2, MAT.steel), T.x, (T.y - 0.05) / 2, T.z - 0.1, g);
  for (const sx of [-1, 1]) put(box(0.05, 1.3, 1.2, MAT.glass, false), T.x + sx * 0.75, T.y + 0.6, T.z - 0.1, g);
  put(box(1.5, 0.05, 1.2, MAT.steel), T.x, T.y + 1.25, T.z - 0.1, g);
  const spray = emis(0x9fd8ff, 0.3); const nozzle = put(box(0.1, 0.25, 0.1, MAT.dark), T.x, T.y + 1.05, T.z, g), jet = put(cyl(0.18, 0.02, 0.5, spray, 12, true), 0, -0.38, 0, nozzle); jet.visible = false;   // 분사 원뿔은 세정하는 동안만 (로봇이 물러난 뒤)
  const scope = put(new THREE.Group(), 1.75, 0, -1.4, g); put(box(0.6, 0.85, 0.6, MAT.steel), 0, 0.425, 0, scope); put(box(0.12, 0.5, 0.12, MAT.white), 0, 1.1, -0.15, scope); put(cyl(0.05, 0.05, 0.25, MAT.dark, 10), 0, 1.0, 0.0, scope);
  const screen = emis(0x58c4ff, 1.2); put(box(0.4, 0.28, 0.02, screen, false), 0, 1.45, 0.25, scope);
  for (const [x, z] of [[-2.1, -2.9], [2.2, -2.9]]) put(box(0.04, 2.4, 0.04, MAT.steel), x, 1.2, z, g);   // 청정 부스 뒤 커튼 (추출 캐비닛 뒤)
  put(box(4.3, 0.04, 0.04, MAT.steel), 0.05, 2.4, -2.9, g); put(box(4.3, 2.0, 0.02, std(0xdff6ff, { transparent: true, opacity: 0.18 }), false), 0.05, 1.4, -2.92, g);
  return { spray, jet, screen };
}
// 산업용 CT (225kV): 납 차폐 캐비닛 · 미닫이 문 · 턴테이블 · X선 경고등 — 문이 열려 있을 때만 로봇이 넣고 꺼낸다
function buildCt(g) {
  const T = CAB.ct.table, cab = put(new THREE.Group(), T.x, 0, T.z - 0.5, g);
  // 시료실 안쪽 폭 2.14m — 지그째 든 시료(1.1 × 0.8m)를 꺼내 AMR 쪽으로 돌 때 옆 칸막이에 닿지 않는 폭 · 문은 양쪽으로 열리는 두 짝
  put(box(2.3, 2.1, 1.3, std(0xcfd6dc, { roughness: 0.5, metalness: 0.3 })), 0, 1.05, -0.65, cab);   // 앞면(z 0)부터 문(1.02)까지가 시료실   // 차폐 본체 (뒤쪽 · 선원·검출기)
  for (const sx of [-1, 1]) put(box(0.08, 2.1, 0.9, std(0xcfd6dc)), sx * 1.11, 1.05, 0.55, cab);
  put(box(2.3, 0.12, 0.9, std(0xcfd6dc)), 0, 2.04, 0.55, cab);
  const door = put(new THREE.Group(), 0, 1.0, 1.02, cab), dm = std(0xaab4bf, { metalness: 0.4 });
  door.userData.leaves = [-1, 1].map((sx) => { const m = put(box(1.07, 1.6, 0.06, dm), sx * 0.535, 0, 0, door); m.userData.sx = sx; return m; }); door.userData.k = 1;
  const turn = put(new THREE.Group(), 0, T.y - 0.04, 0.5, cab);   // 시료가 돌아도(대각 0.9m) 본체 앞면·문과 띄움 put(cyl(0.32, 0.32, 0.06, MAT.dark, 24), 0, 0, 0, turn); put(box(0.4, 0.82, 0.4, MAT.dark), 0, -0.45, 0, turn);
  const xray = emis(0xff4d4d, 0.3); put(cyl(0.07, 0.07, 0.12, xray, 12), 0.75, 2.2, 0.9, cab);
  const sign = put(textPlane(['⚠ X선 촬영 중'], 1.0, 0.25, 'rgba(255,90,90,0.95)'), 0, 1.95, 1.06, cab); sign.rotation.x = 0;
  const screen = emis(0x58c4ff, 1.2), ctl = put(box(0.5, 0.9, 0.35, MAT.dark), 1.85, 0.45, -1.5, g); put(box(0.36, 0.25, 0.02, screen, false), 0, 0.25, 0.18, ctl);
  return { door, turn, xray, screen };
}
const BUILD = { dock: buildDock, vision: buildVisionCell, scan: buildScanCell, oins: buildOins, atos: buildAtos, judge: buildJudge, func: buildFunc, clean: buildClean, ct: buildCt };

// 비전 · 3D 스캔 · 초음파 · ATOS 로봇: AMR 위 시료(c.occ.pm — 몸통 0.40 × 0.20 × 0.36m)를 실제로 훑는다 — 측정 구간(진행 0.12 ~ 0.88)만
//  views  (비전 카메라 6뷰 · ATOS 블루라이트 8뷰): 로봇 쪽 반구에서 시료 가운데를 겨누는 자리(거리 0.45 · 0.6m)로 옮겨 가(구간 30%) 멈춰 찍는다
//  raster (3D 스캐너): 윗면 0.32m 위를 진행 방향(x)으로 오가며 5줄 · ut (초음파 프로브): 윗면 로봇 쪽 가장자리·가운데 용접선 3줄에 프로브를 대고 따라간다
// 자세는 시료마다(AMR이 서는 자리가 조금씩 다르다) 그 자리에서 팔 IK로 푼다 · 측정 밖에서는 기본 자세
const INSP_WIN = [0.12, 0.88];
// 3D 스캔·초음파 셀: 스캐너가 먼저 형상을 훑고(앞 절반) 물러난 뒤 초음파 프로브가 용접선을 탐상(뒤 절반) — 두 로봇이 같은 윗면 위에서 동시에 움직이지 않게
const INSP_SUB = { views: INSP_WIN, raster: [0.12, 0.5], ut: [0.5, 0.88], touch: INSP_WIN };   // touch: 기능·누설 시험 — 시험 점을 차례로 누른다 (측정 구간 전체)
function inspPose(r, c, busy, p, mode, home) {
  const A = r.arm, amr = c.occ, pm = amr?.pm;
  const W = INSP_SUB[mode], on = busy && pm && p >= W[0] && p < W[1];
  const sm = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); }, lerp = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
  if (!on) { r.ipCur = r.ipCur ? lerp(r.ipCur, home, 0.12) : home.slice(); A.pose(...r.ipCur); r.tool?.userData?.scanOn?.(false); return; }
  const key = `${c.item?.id}:${mode}`;
  if (r.ipKey !== key) {
    pm.updateWorldMatrix(true, true); r.root.updateWorldMatrix(true, true);
    const body = pm.userData.body, bb = new THREE.Box3().setFromObject(body), C = bb.getCenter(new THREE.Vector3()), H = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const base = r.root.getWorldPosition(new THREE.Vector3()), sz = Math.sign(base.z - C.z) || 1;   // 로봇이 선 쪽 (시료에서 본 월드 z 부호)
    const L = (v) => r.root.worldToLocal(v.clone()), ik = (pt, dir) => { const a = L(pt), d = L(pt.clone().add(dir)).sub(a); return A.ik(a.x, a.y, a.z, d); };
    let pts;
    if (mode === 'views') {   // 로봇 쪽 반구 — 방위 −60° ~ +60°(로봇 쪽 정면 기준) · 높이각 35° / 65° 번갈아
      const n = c.def.type === 'atos' ? 8 : 6, R = (c.def.type === 'atos' ? 0.6 : 0.45) + Math.max(H.x, H.z) * 0.5;   // 큰 시료(후드·e-axle)는 그만큼 물러나 겨눈다
      pts = Array.from({ length: n }, (_, k) => {
        const ph = (-60 + (120 * k) / (n - 1)) * (Math.PI / 180), th = (k % 2 ? 65 : 35) * (Math.PI / 180);
        const d = new THREE.Vector3(Math.cos(th) * Math.sin(ph), Math.sin(th), sz * Math.cos(th) * Math.cos(ph));
        return ik(C.clone().addScaledVector(d, R), d);
      });
    } else if (mode === 'raster') {   // 윗면 0.32m 위 · 5줄 (로봇 쪽부터) · 줄마다 x 왼쪽 → 오른쪽 / 오른쪽 → 왼쪽
      const y = C.y + H.y + 0.32, up = new THREE.Vector3(0, 1, 0);
      pts = [];
      for (let k = 0; k < 5; k++) { const z = C.z + sz * H.z * (1 - (2 * k) / 4) * 0.9, xs = k % 2 ? [H.x, -H.x] : [-H.x, H.x]; for (const xx of xs) pts.push(ik(new THREE.Vector3(C.x + xx * 0.9, y, z), up)); }
    } else {   // 초음파: 윗면에 대고(손끝 1cm 누름) 3줄을 x로 — 줄 사이는 0.08m 들어 옮김
      const y = C.y + H.y + 0.005, up = new THREE.Vector3(0, 1, 0);
      pts = [];
      for (const fz of [0.85, 0.45, 0]) { const z = C.z + sz * H.z * fz; pts.push(ik(new THREE.Vector3(C.x - H.x * 0.9, y + 0.08, z), up), ik(new THREE.Vector3(C.x - H.x * 0.9, y, z), up), ik(new THREE.Vector3(C.x + H.x * 0.9, y, z), up), ik(new THREE.Vector3(C.x + H.x * 0.9, y + 0.08, z), up)); }
    }
    r.ipPts = pts; r.ipKey = key;
  }
  const P = r.ipPts, u = (p - W[0]) / (W[1] - W[0]);
  let q, measuring = false;
  if (mode === 'views') {
    const n = P.length, j = Math.min(n - 1, Math.floor(u * n)), f = u * n - j, from = j ? P[j - 1] : home;
    q = f < 0.3 ? lerp(from, P[j], sm(f / 0.3)) : P[j]; measuring = f >= 0.35 && f < 0.95;
    if (j === n - 1 && f > 0.85) q = lerp(P[j], home, sm((f - 0.85) / 0.15));
  } else {   // 경유점을 차례로 (첫 점까지 10% · 마지막에서 돌아오기 10%)
    const n = P.length;
    if (u < 0.1) q = lerp(home, P[0], sm(u / 0.1));
    else if (u > 0.9) q = lerp(P[n - 1], home, sm((u - 0.9) / 0.1));
    else { const w = ((u - 0.1) / 0.8) * (n - 1), j = Math.min(n - 2, Math.floor(w)); q = lerp(P[j], P[j + 1], sm(w - j)); measuring = mode === 'raster' || j % 4 === 1; }
  }
  r.ipCur = q.slice(); A.pose(...q);
  r.tool?.userData?.scanOn?.(measuring);
  if (r.ipLens) r.ipLens.emissiveIntensity = measuring ? 5 : 1.2;
}
// 로봇 손끝 목표(월드) → 관절 (툴은 아래로 세움)
const ikW = (r, v) => { const l = r.root.worldToLocal(v.clone()); return r.arm.native ? r.arm.ik(l.x, l.y, l.z, true) : armIK(r.scale ?? 1, l.x, l.y, l.z); };
const setW = (o, v) => { o.parent.updateWorldMatrix(true, false); o.position.copy(o.parent.worldToLocal(v.clone())); };
const lerpQ = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k), smq = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
// 물건 하나 옮기기 (구간 진행 f 0~1): 기본 자세 → 집을 자리 위 → 내려가 집기(0.3) → 들어 → 놓을 자리 위 → 내려놓기(0.8) → 들어 → 기본 자세 · 쥔 동안 held
const MOVE_K = [[0, 'home'], [0.12, 'aU'], [0.24, 'a'], [0.32, 'a'], [0.44, 'aU'], [0.62, 'bU'], [0.74, 'b'], [0.84, 'b'], [0.92, 'bU'], [1, 'home']];
function moveQ(J, f) {
  let i = 0; while (i < MOVE_K.length - 2 && f >= MOVE_K[i + 1][0]) i++;
  const [f0, a] = MOVE_K[i], [f1, b] = MOVE_K[i + 1];
  return { q: lerpQ(J[a], J[b], smq((f - f0) / Math.max(1e-6, f1 - f0))), held: f >= 0.3 && f < 0.8 };
}
// 넣어 재는 셀 (O-INSPECT · 청정도 · CT): AMR → 안쪽 자리 (0.05 ~ 0.1) · 측정 · 안쪽 → AMR (0.89 ~ 0.95)
const CAB_SEQ = [[0, 'home'], [0.025, 'aU'], [0.05, 'a'], [0.075, 'aU'], [0.088, 'bU'], [0.1, 'b'], [0.115, 'bU'], [0.13, 'home'], [0.86, 'home'], [0.875, 'bU'], [0.89, 'b'], [0.905, 'bU'], [0.925, 'aU'], [0.95, 'a'], [0.975, 'aU'], [1, 'home']];   // 안쪽 자리는 위(bU)에서 수직으로 넣고 뺀다
function cabPose(r, p) {
  const J = r.cabJ; if (!J) return;
  let i = 0; while (i < CAB_SEQ.length - 2 && p >= CAB_SEQ[i + 1][0]) i++;
  const [p0, a] = CAB_SEQ[i], [p1, b] = CAB_SEQ[i + 1];
  r.arm.pose(...lerpQ(J[a], J[b], smq((p - p0) / Math.max(1e-6, p1 - p0))));
}
// 넣어 재는 셀 로봇 기본 자세 — 모델 기본 자세는 손목이 AMR 쪽으로 늘어져 들어오는 시료에 닿으므로 장비 쪽으로 접어 둔다
function cabHome(r, cell) {
  if (cell.def.type !== 'clean' && cell.def.type !== 'ct') return r.arm.home?.slice();   // CT 6축 기본 자세도 손목이 시료실 옆벽에 걸린다
  const T = CAB[cell.def.type].table; cell.g.updateWorldMatrix(true, true);
  const o = r.root.getWorldPosition(new THREE.Vector3()), tb = cell.g.localToWorld(new THREE.Vector3(T.x, T.y, T.z));
  return ikW(r, o.clone().add(tb.sub(o).setY(0).setLength(cell.def.type === 'ct' ? 0.3 : 0.35)).setY(o.y + (cell.def.type === 'ct' ? 1.0 : 0.75)));   // CT는 닫힌 문(받침 앞 0.68m)에 닿지 않게 더 붙인다
}
const CAB_GRIP = 0.06;   // TCP ↔ 시료 윗면: 그리퍼 판(TCP 아래 0.055m)이 윗면에 닿는 높이
const cabWhere = (p) => (p < 0.05 || p >= 0.95 ? 'amr' : p < 0.1 || p >= 0.89 ? 'hand' : 'in');
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
    const SO = INSP_SOUTH;   // 남쪽 시험동 (앞쪽 통로 건너)
    for (let x = SO.x0; x < SO.x1; x += 1.2) { strip(x, SO.z0, Math.min(x + 0.7, SO.x1), SO.z0 + 0.1); strip(x, SO.z1 - 0.1, Math.min(x + 0.7, SO.x1), SO.z1); }
    for (let z = SO.z0; z < SO.z1; z += 1.2) { strip(SO.x0, z, SO.x0 + 0.1, Math.min(z + 0.7, SO.z1)); strip(SO.x1 - 0.1, z, SO.x1, Math.min(z + 0.7, SO.z1)); }
    // 가운데 AMR 차로 (유도 테이프) · 접수 대기 줄 · 스테이션 줄
    const guide = new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.8 });
    const gl = (x0, z0, x1, z1) => { const w = Math.abs(x1 - x0) || 0.1, d = Math.abs(z1 - z0) || 0.1; const m = put(new THREE.Mesh(new THREE.PlaneGeometry(w, d), guide), (x0 + x1) / 2, 0.018, (z0 + z1) / 2, g); m.rotation.x = -PI / 2; };
    gl(INSP.lane, INSP.cells.DOCK.z, INSP.lane, Math.max(...Object.values(INSP.cells).map((c) => c.z)));   // 남쪽 시험동까지 (앞쪽 통로를 가로지름)
    for (const c of Object.values(INSP.cells)) gl(Math.min(c.x, INSP.lane), c.z, Math.max(c.x, INSP.lane), c.z);
    gl(Math.min(INSP.station.xs[0], INSP.lane), INSP.station.z, Math.max(INSP.station.xs[2], INSP.lane), INSP.station.z);
    gl(INSP.cells.DOCK.x, INSP.entryZ, INSP.cells.DOCK.x, INSP.cells.DOCK.z);
    const ttl = put(textPlane(['정밀검사Zone · AI정밀검사(QMS)'], 13, 1.3), INSP.lane, 0.02, -10, g); ttl.rotation.z = PI / 2;
    const sub = put(textPlane(['샘플링 검사 · 개봉 → 제품별 검사 → AI 판정·보고 → 합격 재포장'], 13, 0.8, 'rgba(127,224,214,0.75)', 500), INSP.lane + 1.1, 0.02, -10, g); sub.rotation.z = PI / 2;
    const st2 = put(textPlane(['정밀검사 시험동 · 기능·누설 · 청정도 · CT'], 9, 0.9), (SO.x0 + SO.x1) / 2 - 3.6, 0.02, 25, g); st2.rotation.z = PI / 2;
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
    const W = INSP.wall, wg = put(new THREE.Group(), W.x, W.y, W.z, this.G); wg.rotation.y = W.rot; this.wallG = wg; wg.userData.zoneBoard = 'insp';   // 전광판을 누르면 Zone 대시보드 창 (main.js)
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
    // 셀 카드 (셀 수만큼 한 줄)
    const nC = this.order.length, cw = (cv.width - 60) / nC, lab = { IDLE: ['대기', '#3a4654'], BUSY: ['검사 중', '#2f9bff'], DONE: ['다음 셀 대기', '#f5b82e'], DOWN: ['고장 · 수리 대기', '#ff4d4d'], MAINT: ['정비 중', '#ffb020'] };
    this.order.forEach((c, i) => {
      const cx = 30 + i * cw, cy = 96, w = cw - 20, h = 200, st = this.halted ? ['비상정지', '#ff4d4d'] : lab[c.fault ?? c.state] ?? [c.state, '#3a4654'];
      x.fillStyle = '#121a24'; x.fillRect(cx, cy, w, h); x.fillStyle = st[1]; x.fillRect(cx, cy, w, 8);
      x.fillStyle = '#7fe0d6'; let fs = 30; do { x.font = `800 ${fs}px ${F}`; fs -= 1; } while (x.measureText(`${c.def.no} ${c.def.label}`).width > w - 24 && fs > 18); x.fillText(`${c.def.no} ${c.def.label}`, cx + 14, cy + 48);
      x.fillStyle = st[1] === '#3a4654' ? '#9fb3c8' : st[1]; x.font = `700 28px ${F}`; x.fillText(st[0], cx + 14, cy + 92);
      const it = c.item; x.fillStyle = '#e6edf3'; x.font = `600 25px ${F}`;
      x.fillText(it && c.state !== 'IDLE' ? `${zl(it.zone)} ${S.products[it.product][1]}` : '-', cx + 14, cy + 132);
      if (c.state === 'BUSY') { x.fillStyle = '#26323f'; x.fillRect(cx + 14, cy + 150, w - 28, 14); x.fillStyle = '#37e8ff'; x.fillRect(cx + 14, cy + 150, (w - 28) * c.progress, 14); }
      x.fillStyle = '#6b7c8f'; x.font = `600 20px ${F}`; x.fillText(`처리 ${c.done} · 가동 ${this.time > 0 ? Math.round((c.busy / this.time) * 100) : 0}%`, cx + 14, cy + 190);
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
    const T = { park: '대기·충전', out: '샘플 수거 이동', load: '샘플 인수', in: '정밀검사Zone으로', queue: '접수 대기', move: '셀 간 이동', work: '검사 중', ready: '다음 셀 대기', home: '스테이션 복귀', back: '합격 시료 반납 이동', unload: '합격 시료 반납' };
    this.carriers.forEach((c, i) => { x.fillStyle = '#e6edf3'; x.fillText(`${c.uid} ${T[c.state] ?? c.state}${c.item ? ` · ${zl(c.item.zone)} ${S.products[c.item.product][1]}` : ''}`, 170 + i * 520, 460); });
    x.fillStyle = '#6b7c8f'; x.font = `600 22px ${F}`; const ev = (k) => this.sim?.serials?.sampleEvery(k, S.sample[k]) ?? S.sample[k], tg = (k) => (ev(k) !== S.sample[k] ? '(강화)' : '');
    x.fillText(`샘플링: 정밀조립 ${ev('main')}개${tg('main')} · 유연생산 ${ev('flex')}개${tg('flex')} · 적응가공 ${ev('adapt')}개${tg('adapt')}마다 1개 · 요청 즉시 로트 출하 보류 · NG → 봉쇄 · 처분(재작업·폐기) · 공정 보정`, 30, 500);
    this.wallTex.needsUpdate = true;
  }
  // 새 실행마다 (main.js setup): 단계별 로봇·인력, 검사 AMR, 실적 초기화
  reset(modeKey, seed) {
    this.ctl = zoneCtl();
    this.mode = modeKey; this.rng = mulberry((seed ?? 1) * 7919 + 11); this.time = 0; this.seq = 0;
    this.queue = []; this.counts = { main: 0, flex: 0, adapt: 0 }; this.unsampled = {}; this.base = null; this.recent = [];
    this.stats = { samples: 0, done: 0, ok: 0, unc: 0, ng: 0, by: {}, rx: 0 };
    for (const p of this.packets ?? []) { p.alive = false; p.m.visible = false; }
    const legacy = modeKey === 'traditional';
    for (const c of this.order) {
      Object.assign(c, { occ: null, state: 'IDLE', progress: 0, item: null, busy: 0, done: 0, repack: false });
      c.robotsG.clear(); c.workersG.clear(); c.robots = []; c.plates = []; c.robotUids = [];
      const n = c.def.robots ?? 0, ty = c.def.type;
      if (legacy && n) { const w = makeWorker(); put(w, -0.6, 0, -1.9, c.workersG); c.rb.textContent = ty === 'dock' || ty === 'judge' ? '👷 검사원×1 · 호이스트' : '👷 검사원×1'; continue; }
      if (!n) { c.rb.textContent = ''; continue; }
      // 마주 보는 두 로봇은 x를 0.7m 엇갈려 둔다 — 같은 x면 대기·작업 자세에서 끝단 센서(스캐너·카메라 헤드)가 셀 가운데에서 서로 맞닿는다
      const slots = CAB[ty] ? [[CAB[ty].robot.x, CAB[ty].robot.z, 0]] : ty === 'dock' || ty === 'judge' ? [[xferOf(ty).robot.x, xferOf(ty).robot.z, xferOf(ty).robot.yaw ?? 0]] : [[-0.95, -1.75, 0], [-0.25, 1.75, PI]];
      for (let i = 0; i < n; i++) {
        const r = c.def.heavy ? KIT.heavyRobot(MAT.orange) : makeRobot(ty === 'clean' ? 'cobot' : 'articulated', MAT.orange), [x, z, yaw] = slots[i];
        const cob = ty === 'clean', ped = CAB[ty]?.robot.y; if (ped && !cob) put(box(0.6, ped - 0.02, 0.6, MAT.dark), x, (ped - 0.02) / 2, z, c.robotsG);   // 6축 받침대 (협동로봇은 모델에 받침대가 붙어 있다 — 0.5m 위에 루트)
        put(r.root, x, cob && ped ? 0.5 : ped ?? 0.15, z, c.robotsG); r.root.rotation.y = yaw; r.phase = i * 1.7;
        if (ty === 'scan' || ty === 'atos' || ty === 'vision') {   // 끝단 센서: 3D 스캐너(청색) · PAUT 프로브 · 비전 카메라
          const head = put(box(0.22, 0.12, 0.16, ty === 'atos' || (ty === 'scan' && i === 0) ? std(0x2b6cb0) : MAT.dark), 0, 0.06, 0, r.tip);
          const lens = emis(ty === 'atos' ? 0x5aa0ff : 0x37e8ff, 2); put(cyl(0.035, 0.035, 0.03, lens, 10), 0, 0.075, 0, head); r.ipLens = lens;   // 측정하는 동안 밝아짐 (inspPose)
        } else if (ty === 'func') {   // 끝단: 로드셀 손끝 + 누설 시험 헤드 · 토크 트랜스듀서
          const head = put(box(0.14, 0.1, 0.14, std(0xd8a032)), 0, 0.05, 0, r.tip); const lens = emis(0x3ddc84, 1.2); put(cyl(0.025, 0.025, 0.06, lens, 10), 0, 0.08, 0, head); r.ipLens = lens;
        } else put(box(0.3, 0.05, 0.22, MAT.dark), 0, 0.03, 0, r.tip);   // 진공·기계식 그리퍼
        r.wristCam = !!r.wristCameraAnchor || modeKey === 'dark';   // 피지컬AI: 손목 카메라 (로봇 비전 관제 디스플레이 영상)
        if (CAB[ty]) { const h0 = cabHome(r, c); if (h0) { r.cabJ = { home: h0 }; r.arm.pose(...h0); } }
        if (CAB[ty]) r.anim = (busy) => { if (busy) cabPose(r, c.progress); else if (c.state !== 'BUSY' && r.cabJ) r.arm.pose(...r.cabJ.home); };
        else if (ty === 'dock' || ty === 'judge') { const home = r.arm.home?.slice(); r.anim = (busy) => this.xferPose(c, r, busy, home); }
        else if (r.arm?.native) { const mode = ty === 'scan' ? (i === 0 ? 'raster' : 'ut') : ty === 'func' ? 'touch' : 'views', home = r.arm.home.slice(); r.anim = (busy, t, p) => inspPose(r, c, busy, p, mode, home); }   // 시료를 실제로 훑는다 (inspPose)
        const uid = `${INSP.uidp}-RB-${c.id}-${i + 1}`, sp = idPlate(uid); sp.position.set(0, 2.35, 0); r.root.add(sp); sp.visible = this.labelsOn; c.plates.push(sp);
        r.root.traverse((o) => { o.userData.stationId = this.sid(c); o.userData.robotIdx = i; });   // 클릭 → 셀 로봇 텔레메트리 (factory.js pick → ExtraZones.cellRobot)
        c.robots.push(r); c.robotUids.push(uid);
      }
      c.rb.textContent = c.def.heavy ? `🤖 고가반 6축×${n}` : ty === 'clean' ? `🤖 협동×${n}` : `🤖 6축×${n}`;
    }
    this.cells.JUDGE.parts.shelves.ng.forEach((b) => (b.visible = false));
    for (const k of ['doortrim', 'eaxle']) this.cells.DOCK.parts.stacks[k].children.forEach((b) => (b.visible = false));
    this.returned = { doortrim: 0, eaxle: 0 };
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
    return { c, def: c.def, state: this.halted ? 'ESTOP' : c.state, item: it ? `${zl(it.zone)} ${S.products[it.product][1]} ${it.id}${it.rechecked ? ' (재측정)' : ''}` : '-', progress: c.progress, cycle: (c.item ? c.cur : cellT(c.def, this.mode) ?? c.def.cycle) * (c.def.cycleK ?? 1), util, done: c.done,
      products: uses, robots: c.robotUids, amr: c.occ?.id ?? '-', stats: this.stats, queue: this.queue.length, recent: this.recent, mode: this.mode };
  }
  tele(c) {
    const zone = this;
    return c.tele ??= {
      id: c.id, uid: c.uid, kind: 'zoneamr', zone: 'insp', prio: 1e6, idle: false, steps: [], blockedOn: null, hzWait: false,
      get x() { return c.x; }, get z() { return c.z; }, get heading() { return c.heading; },
      get moving() { return ['out', 'in', 'move', 'home', 'back'].includes(c.state); }, get state() { return c.state; },
      get task() { return { park: '검사 AMR 스테이션 대기', out: '샘플 수거 이동', load: '샘플 인수', in: '정밀검사Zone으로 이송', move: '검사 셀 간 이동', work: '검사 중', wait: '다음 검사 셀 대기', home: '스테이션 복귀', queue: '접수 대기', back: '합격 시료 반납 이동', unload: '합격 시료 반납' }[c.state] ?? c.state; },
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
        const N = this.sim.serials?.sampleEvery(zk, INSP.sample[zk]) ?? INSP.sample[zk];   // NG 뒤 샘플링 강화(N/2) — js/serial.js
        if (this.counts[zk] >= N) {   // 이번 샘플 제품 = 그 Zone에서 마지막 샘플 뒤로 가장 많이 만든 제품 (혼류 비율대로 고르게)
          this.counts[zk] -= N;
          const U = this.unsampled[zk], q = Object.keys(U).reduce((a, b) => (U[b] > U[a] ? b : a)); U[q] = 0;
          const req = { id: `QS-${String(++this.seq).padStart(4, '0')}`, zone: zk, product: q, t0: this.time }; this.queue.push(req); this.stats.samples++;
          this.sim.fos?.sampleRequest(req);   // A2A: 생산 Zone → 정밀검사 서비스 요청 (정밀조립은 샘플 시리얼 HOLD)
          if (this.sim.fos) this.queue = this.sim.fos.inspPriority(this.queue);   // 여러 Zone 요청이 함께면 공장 오케스트레이터가 순서 결정
        }
      }
    }
  }
  nextOf(c) { const it = c.item; if (!it || it.res) return null; if (it.redo) return INSP.redo[it.product]; return INSP.routes[it.product].find((id) => !it.done.has(id)) ?? 'JUDGE'; }
  go(c, pts, state) { c.path = pts; c.s = 0; c.L = pathLength(pts); c.state = state; c.wait = 0; }
  inPath(a, b) {   // 존 안: 셀 → 가운데 차로 → 셀
    const L = INSP.lane + (b.z > a.z ? 0.6 : -0.6), pts = [{ x: a.x, z: a.z }];   // 남행 +0.6 · 북행 −0.6 (마주 오는 AMR끼리 엇갈림)
    if (Math.abs(a.z - b.z) > 0.01 || Math.sign(a.x - L) === Math.sign(b.x - L)) pts.push({ x: L, z: a.z }, { x: L, z: b.z });
    pts.push({ x: b.x, z: b.z }); return pts;
  }
  step(dt, halted) {
    if (!this.sim) return;
    const K = this.ctl ??= zoneCtl();
    this.halted = halted || K.stop; if (this.halted) { this.sim.zkpi?.stopAll('insp', this.order, dt); return; }   // 정밀조립 비상·보호정지 또는 운영자 Zone 정지(대화 지시)
    dt *= K.speed;   // 운영자 Zone 속도 (대화 지시)
    this.time += dt;
    this.sampleTick();
    for (const c of this.order) {
      // 셀 고장·정비 (sim.js 설비 관리 — 정밀검사 정비실 인력이 수리): 끝날 때까지 검사가 멈춘다 · 가동 여부를 알려 마모 계산에 쓴다
      const zc = this.sim.zoneCell?.('insp', c.id); c.fault = zc && (zc.state === 'DOWN' || zc.state === 'MAINT') ? zc.state : null;
      if (zc) zc.busy = c.state === 'BUSY';
      this.sim.zkpi?.acc('insp', c, dt, { held: K.hold.has(c.id), ideal: (cellT(c.def, this.mode) ?? c.def.cycle) * (c.def.cycleK ?? 1), name: `${c.def.no} ${c.def.label}` });   // OEE 셀 시간 분류 (js/zonekpi.js)
      if (c.fault || c.state !== 'BUSY' || K.hold.has(c.id)) continue;   // 운영자 셀 정지 (대화 지시)
      c.busy += dt; c.progress = Math.min(1, c.progress + dt / c.cur);
      if (c.progress >= 1) { c.state = 'DONE'; c.done++; this.sim.zkpi?.done('insp', c.id); }
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
      case 'out': case 'in': case 'move': case 'home': case 'back': {
        if (this.blocked(c)) { c.wait += dt; if (c.wait < 20) break; } else c.wait = 0;
        c.s = Math.min(c.L, c.s + S.amr.speed * dt);
        const p = pointAt(c.path, c.s), dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz > 1e-8) c.heading = Math.atan2(dx, dz); c.x = p.x; c.z = p.z;
        if (c.s < c.L - 1e-6) break;
        if (c.state === 'out') { c.state = 'load'; c.timer = 6; c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2; break; }
        if (c.state === 'in') { c.state = 'queue'; c.heading = PI; break; }
        if (c.state === 'home') { c.state = 'park'; c.heading = PI; break; }
        if (c.state === 'back') { c.state = 'unload'; c.timer = 6; c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2; break; }   // 합격 시료를 그 Zone 적재장에 되돌려 놓는다
        // move: 셀 도착 → 검사 시작
        c.heading = Math.sin(c.heading) >= 0 ? PI / 2 : -PI / 2;
        const cell = this.cells[c.target]; c.at = c.target;
        Object.assign(cell, { state: 'BUSY', progress: 0, item: c.item, repack: false, cur: (cellT(cell.def, this.mode, c.item.product) ?? cell.def.cycle) * (cell.def.cycleK ?? 1) * (0.9 + this.rng() * 0.2) });   // 제품마다 실제 검사 시간 (zonedefs.js INSP_CELLS T)
        if (cell.id === 'DOCK' && c.pm?.userData.box) this.planXfer(cell, c, 'unpack');   // 포장 개봉
        if (CAB[cell.def.type]) this.planCab(cell, c);
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
      case 'unload':   // 합격 시료 반납 (재포장된 상자 · 지그째) → 스테이션 복귀
        c.timer -= dt;
        if (c.timer <= 0) {
          this.detach(c); c.item = null;
          const P = S.pickup[c.back], slot = S.station.xs[c.i];
          this.go(c, [{ x: c.x, z: c.z }, ...route(P, { x: slot, z: S.station.exitZ, aisle: 'F' }), { x: slot, z: S.station.z }], 'home');
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
        if (c.at === 'JUDGE' && !cell.repack) {
          this.judge(c, cell);
          const it = c.item;
          if (it?.res === 'ok' && c.pm?.userData.box) {   // 합격 → 새 포장재로 재포장 (같은 셀 · 고가반 6축)
            Object.assign(cell, { state: 'BUSY', progress: 0, repack: true, cur: INSP_REPACK[it.product][MODE_I[this.mode] ?? 1] * (0.9 + this.rng() * 0.2) });
            this.planXfer(cell, c, 'repack'); this.sim.log('info', `정밀검사 합격 시료 재포장 — ${zl(it.zone)} ${S.products[it.product][1]} ${it.id}`, { obs: '판정 OK · 성적서 QMS 저장', act: '새 포장재 · 「정밀검사 합격」 라벨 → 적재장 반납' });
            break;
          }
        } else if (cell.repack) { cell.repack = false; cell.xfer = null; setPacked(c.pm, true); }
        if (c.state === 'work') c.state = 'ready';
        break;
      }
      case 'ready': {
        const it = c.item, cur = this.cells[c.at];
        if (it && c.at !== 'DOCK' && c.at !== 'JUDGE') it.done.add(c.at);
        if (c.at === 'DOCK' && cur.xfer) { cur.xfer = null; const p = it.product; setPacked(c.pm, false); this.returned[p] = (this.returned[p] ?? 0) + 1; this.cells.DOCK.parts.stacks[p].children.forEach((b, i) => (b.visible = i < Math.min(6, this.returned[p] * 2))); }   // 개봉한 상자·뚜껑은 반납 랙에 (접어서 회수)
        const next = this.nextOf(c);
        if (!next) {
          cur.occ = null; cur.state = 'IDLE'; cur.item = null; cur.progress = 0;
          const L = S.lane + 0.6, down = [{ x: cur.def.x, z: cur.def.z }, { x: L, z: cur.def.z }];
          if (it) {   // 합격 시료 → 그 Zone 적재장으로 반납 (남행 줄로 내려와 앞쪽 통로로)
            c.back = it.zone; this.go(c, [...down, ...route({ x: L, z: S.station.exitZ, aisle: 'F' }, S.pickup[it.zone])], 'back');
            break;
          }
          const slot = S.station.xs[c.i];   // NG 시료는 판정 셀 격리 선반에 두고 스테이션 복귀
          this.go(c, [...down, { x: L, z: S.station.z }, { x: slot, z: S.station.z }], 'home');   // 남행 줄로 내려와 자기 자리로
          break;
        }
        const nx = this.cells[next], o = nx.occ;
        if (nx.fault) break;   // 다음 검사 셀이 고장·정비 중이면 지금 자리에서 기다린다
        if (o) {   // 서로 상대 셀을 기다리면 (재측정 ↔ 판정) 자리를 맞바꾼다 — 교착 방지 (가운데 차로는 방향별 두 줄이라 엇갈려 지나간다)
          if (!(o.state === 'ready' && this.nextOf(o) === c.at)) break;
          for (const [a, from, to] of [[c, cur, nx], [o, nx, cur]]) { if (a.item?.redo && to.id === INSP.redo[a.item.product]) a.item.redo = false; to.occ = a; a.target = to.id; this.go(a, this.inPath(from.def, to.def), 'move'); }
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
    // 공정 보정 중인 Zone은 NG 확률이 낮다 (js/serial.js) · 재측정한 시료는 '판정 불확실'이 없고 NG 확률만 그대로 (불확실 구간이 NG로 떨어지면 재검 NG가 4% → 10%로 부풀었다)
    const ngP = S.judge.ng * (this.sim.serials?.ngFactor(zk) ?? 1);
    const res = it.rechecked ? (r < ngP ? 'ng' : 'ok') : r < S.judge.uncertain ? 'unc' : r < S.judge.uncertain + ngP ? 'ng' : 'ok';
    const by = (s.by[it.product] ??= { ok: 0, unc: 0, ng: 0 });
    if (res === 'unc') {
      s.unc++; by.unc++; it.rechecked = true; it.redo = true; it.done.delete(S.redo[it.product]);
      this.push(it, 'unc'); cell.flash = { col: 0xf5b82e, t: 2 };
      this.sim.log('warn', `정밀검사 판정 불확실 — ${zl(zk)} ${plabel} ${it.id}`, { obs: 'AI 판정 신뢰도 기준 미달', dec: `Quality & Recovery Agent: ${S.cells[S.redo[it.product]].label} 재측정 후 재판정`, act: `${c.id} → ${S.cells[S.redo[it.product]].no} ${S.cells[S.redo[it.product]].label}` });
      return;
    }
    s.done++; s[res]++; by[res]++; this.push(it, res);
    this.sim.zkpi?.inspUnit(it, res, cell.id, zl(zk), plabel);   // 측정 편차·불확도 → 품질 표본 (관리도·산점도)
    this.sim.fos?.sampleResult(it, res);   // 결과 → 생산 Zone · NG면 품질 알림 → 정밀조립 8D
    cell.flash = { col: res === 'ok' ? 0x3ddc84 : 0xff4d4d, t: 2 };
    if (res === 'ng') cell.parts.shelves.ng.forEach((b, i) => (b.visible = i < Math.min(6, s.ng)));   // NG 시료 격리 (처분 판정까지)
    if (res === 'ng' && this.mode !== 'traditional') this.spawnPacket(cell.sensor.getWorldPosition(new THREE.Vector3()), 0xff4d4d);   // NG 판정 → 서버 (QMS 저장 · 오케스트레이터 알림)
    if (res === 'ng') this.sim.log('warn', `정밀검사 NG — ${zl(zk)} ${plabel} ${it.id}`, { obs: `검사 경로 ${S.routes[it.product].map((id) => S.cells[id].label).join(' → ')}${it.rechecked ? ` → ${S.cells[S.redo[it.product]].label} 재측정` : ''}`, dec: 'Quality & Recovery Agent 최종 NG · QMS 저장', act: `${it.serial ? `${it.serial} · ` : ''}${zl(zk)} 로트 봉쇄(출하 보류) · 처분 판정(재작업·폐기) · 선행공정 보정 · 샘플링 강화` });
    it.res = res;
    if (res === 'ng') { this.detach(c); c.item = null; }   // 합격 시료는 재포장(포장 제품)해 그 Zone 적재장으로 되돌린다
  }
  // 포장 개봉 · 재포장 계획 (접수·판정 셀 고가반 6축): 물건마다 집을 자리 → 놓을 자리 (물건 바닥 원점의 월드 위치 · 위에서 높이 h를 잡는다)
  planXfer(cell, a, kind) {
    const m = a.pm, U = m?.userData; cell.xfer = null; if (!U?.box) return;
    const base = new THREE.Vector3(a.x, BELT_Y, a.z), B = U.B, at = (dy) => base.clone().setY(base.y + dy);   // AMR 정차 자리 (화면 AMR은 몇 프레임 늦게 따라온다)
    const XFER = xferOf(cell.def.type), Lw = (x, y, z) => cell.g.localToWorld(new THREE.Vector3(x, y, z)), tbl = Lw(XFER.table.x, XFER.table.y, XFER.table.z);
    const rk = (dy = 0) => Lw(XFER.rack.x, XFER.rack.y + 0.36 + dy, XFER.rack.z);   // 랙 더미 위 (뚜껑 먼저 · 그 위에 상자)
    cell.xfer = kind === 'unpack'
      ? [{ w: [0.06, 0.3], o: U.lid, h: B.lid, from: at(B.h), to: rk() }, { w: [0.32, 0.56], o: U.prod, h: U.h, from: at(0.02), to: tbl },
        { w: [0.58, 0.8], o: U.box, h: B.h, from: at(0), to: rk(B.lid + 0.005) }, { w: [0.82, 0.98], o: U.prod, h: U.h, from: tbl, to: at(0) }]
      : [{ w: [0.06, 0.3], o: U.prod, h: U.h, from: at(0), to: tbl }, { w: [0.32, 0.54], o: U.box, h: B.h, from: rk(B.lid + 0.005), to: at(0) },
        { w: [0.56, 0.78], o: U.prod, h: U.h, from: tbl, to: at(0.02) }, { w: [0.8, 0.98], o: U.lid, h: B.lid, from: rk(), to: at(B.h) }];
    if (kind === 'repack') { U.box.visible = U.lid.visible = true; }
    this.xferObjs(cell);
  }
  // 물건 위치: 끝난 옮기기는 놓은 자리 · 아직이면 집을 자리 · 지금 쥔 것은 손끝 아래 (AMR이 서 있는 동안 — 물건은 시료 묶음(AMR) 자식)
  xferObjs(cell, r = null, held = null) {
    const p = cell.progress, seen = new Set();
    for (const mv of cell.xfer ?? []) {
      if (held === mv && r) { const v = r.tip.getWorldPosition(new THREE.Vector3()); v.y -= mv.h + 0.01; setW(mv.o, v); seen.add(mv.o); continue; }
      const f = (p - mv.w[0]) / (mv.w[1] - mv.w[0]);   // 놓은 뒤(0.8)는 놓은 자리 · 집기 전은 집을 자리
      if (f >= 0.8) { setW(mv.o, mv.to); seen.add(mv.o); } else if (!seen.has(mv.o)) { setW(mv.o, mv.from); seen.add(mv.o); }
    }
  }
  xferPose(c, r, busy, home) {
    const X = c.xfer, p = c.progress;
    let q = null, held = null;
    if (busy && X && c.occ?.pm) {
      const mv = X.find((m) => p >= m.w[0] && p < m.w[1]);
      if (mv) {
        if (!mv.J) { const g = (v, dy) => ikW(r, v.clone().setY(v.y + mv.h + 0.01 + dy)); mv.J = { aU: g(mv.from, 0.3), a: g(mv.from, 0), bU: g(mv.to, 0.3), b: g(mv.to, 0) }; mv.J.home = home ?? mv.J.aU; }
        const m = moveQ(mv.J, (p - mv.w[0]) / (mv.w[1] - mv.w[0])); q = m.q; if (m.held) held = mv;
      }
    }
    const hq = home ?? r.xCur ?? q; if (!q) q = hq; if (!q) return;
    r.xCur = r.xCur && !busy ? lerpQ(r.xCur, q, 0.12) : q.slice(); r.arm.pose(...r.xCur);
    if (X && busy) { r.root.updateWorldMatrix(true, true); this.xferObjs(c, r, held); }
  }
  // 넣어 재는 셀: 시료 윗면을 위에서 잡는 관절 (AMR 위 · 안쪽 자리 — 시료마다)
  planCab(cell, a) {
    const T = CAB[cell.def.type], m = a.pm; if (!T || !m) return;
    const base = new THREE.Vector3(a.x, BELT_Y, a.z), h = m.userData.h, tb = cell.g.localToWorld(new THREE.Vector3(T.table.x, T.table.y, T.table.z));
    cell.cab = { a: base, b: tb, h };
    for (const r of cell.robots) { r.root.updateWorldMatrix(true, true); const g = (v, dy) => ikW(r, v.clone().setY(v.y + h + CAB_GRIP + dy)); r.cabJ = { aU: g(base, 0.35), a: g(base, 0), bU: g(tb, 0.22), b: g(tb, 0) };
      r.cabJ.home = cabHome(r, cell) ?? r.cabJ.aU; }
  }
  push(it, res) { this.recent.unshift({ id: it.id, zone: it.zone, product: it.product, res, t: this.time }); this.recent.length = Math.min(this.recent.length, 6); }
  attach(c) { const m = makeSample(c.item.product); setPacked(m, true); m.position.set(0, BELT_Y, 0); m.rotation.y = PI / 2; c.g.add(m); c.pm = m; }   // 제품 긴 쪽을 AMR 긴 쪽(진행 방향)으로 — 후드(1.6m)가 옆으로 삐져나와 셀 로봇에 닿지 않게   // 정밀조립 시료는 포장 상자째 · 유연생산·적응가공은 지그째
  detach(c) { if (c.pm) { c.g.remove(c.pm); c.pm = null; } }
  // 앞길에 다른 이동체 (시뮬레이션 이동체 · 다른 Zone AMR · 다른 검사 AMR)
  blocked(c) {
    const hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    const list = [...(this.sim.movers ?? []).filter((m) => m.state !== 'line'), ...(this.sim.extMovers ?? []).filter((m) => m.id !== c.id)];
    for (const m of list) {
      if (m.zone === 'insp' && m.id === c.id) continue;
      const rx = m.x - c.x, rz = m.z - c.z, along = rx * hx + rz * hz, lat = Math.abs(rx * hz - rz * hx);
      if (along > 0.15 && along < 0.8 + moverRadius(m) + 0.5 && lat < (0.95 + moverWidth(m)) / 2 + 0.1) {
        if (m.zone === 'insp') { const o = this.carriers.find((k) => k.id === m.id); if (o && !['out', 'in', 'move', 'home', 'back'].includes(o.state) && c.wait > 3) return false; if (o && c.i > o.i && Math.cos(o.heading - c.heading) < -0.5) return false; }
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
    if (CAB[c.def.type] && c.cab && c.occ?.pm && c.state !== 'IDLE') {   // 넣어 재는 셀: 시료가 AMR → 손 → 안쪽 자리 → 손 → AMR (CT는 턴테이블과 함께 돈다)
      const U = c.occ.pm.userData, w = c.state === 'DONE' ? 'amr' : cabWhere(p), r = c.robots[0];
      if (w === 'amr' || !r) { U.prod.position.set(0, 0, 0); U.prod.rotation.y = 0; }
      else if (w === 'hand') { r.root.updateWorldMatrix(true, true); const v = r.tip.getWorldPosition(new THREE.Vector3()); v.y -= c.cab.h + CAB_GRIP; setW(U.prod, v); U.prod.rotation.y = 0; }
      else { setW(U.prod, c.cab.b); if (c.def.type === 'ct') U.prod.rotation.y = P.turn.rotation.y; }
    }
    c.workersG.children.forEach((w) => KIT.workerCycle(w, busy, p, 3, (w.userData.baseYaw ??= w.rotation.y)));   // 레거시 검사원: 시료를 집어 보고 게이지를 대는 수작업 사이클
    switch (c.def.type) {
      case 'dock': P.reader.emissiveIntensity = busy ? 2 + Math.sin(t * 12) : 0.6; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'vision': P.light.emissiveIntensity = busy ? 2.4 : 0.5; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'scan': P.blue.emissiveIntensity = busy && Math.sin(t * 9) > -0.2 ? 2.2 : 0.3; P.screen.emissive.setHex(busy ? 0x58c4ff : 0x3ddc84); break;
      case 'atos': P.screen.emissive.setHex(busy ? 0x5aa0ff : 0x3ddc84); break;
      case 'oins': {
        const meas = busy && p > 0.16 && p < 0.84;
        P.carriage.position.z += ((meas ? -2.0 : -2.45) - P.carriage.position.z) * Math.min(1, rdt * 5);   // 헤드(캐리지 +0.25)가 시료 위(z −1.75)로
        const tq = meas ? -(0.03 + 0.08 * Math.abs(Math.sin(p * PI * 12))) : 0; P.quill.position.y += (tq - P.quill.position.y) * Math.min(1, rdt * 8);
        P.tipMat.emissiveIntensity = meas && Math.sin(p * PI * 12) > 0.9 ? 6 : 1.2; P.screen.emissive.setHex(meas ? 0x58c4ff : 0x3ddc84);
        break;
      }
      case 'func': { const on = busy && p > 0.12 && p < 0.88; P.screen.emissive.setHex(on ? 0x58c4ff : 0x3ddc84); P.gauge.emissiveIntensity = on ? 1.5 + Math.sin(t * 5) : 0.6; P.warn.emissiveIntensity = on && c.item?.product === 'eaxle' && Math.sin(t * 6) > 0 ? 2.5 : 0.3; break; }   // 누설 압력 · 절연 시험 중 경고
      case 'clean': { const on = busy && cabWhere(p) === 'in' && p > 0.15 && p < 0.6; if (P.jet) P.jet.visible = on; P.spray.emissiveIntensity = on ? 1.5 + Math.sin(t * 20) : 0.2; P.screen.emissive.setHex(busy && p >= 0.6 ? 0x58c4ff : 0x3ddc84); break; }   // 압력 세정 추출 → 여과·입자 분석
      case 'ct': {
        const scan = busy && p > 0.16 && p < 0.84, open = !busy || p < 0.13 || p > 0.86;
        const D = P.door.userData; D.k += ((open ? 1 : 0) - D.k) * Math.min(1, rdt * 3); for (const m of D.leaves) m.position.x = m.userData.sx * (0.535 + D.k * 1.07);   // 넣고 꺼낼 때만 문이 양쪽으로 열린다
        if (scan) P.turn.rotation.y += dts * 0.4; P.xray.emissiveIntensity = scan ? 3 : 0.3; P.screen.emissive.setHex(scan ? 0x58c4ff : 0x3ddc84);
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
