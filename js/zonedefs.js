// 메타팩토리 3 Zone 배치 — 서버실(뒤)과 AMR 스테이션(앞) 사이에 앞뒤로 세 줄:
//   뒤  ── 뒷벽 (z −43, 건물 전체 폭으로 곧게 — 직사각형 건물). 정밀조립 화면 3개·데이터 서버는 왼쪽 벽 안쪽 (LEFT_WALL · SRV)
//         뒤쪽 시설 통로 (z −32, 관제실) — 출하 도크는 오른쪽 벽(x 38) 위쪽, 야드는 건물 오른쪽 (shipping.js shipToWorld)
//         A-1 유연생산Zone (가운데 z −22)
//         정밀조립Zone 뒤 통로 (z −9) · 정밀조립Zone (z 0) · 앞 통로 (z 9)
//         A-2 적응가공Zone (가운데 z 19.5)
//         앞쪽 시설 통로 (z 31)
//   앞  ── 앞쪽 시설 구역 (z 35 ~ 41) — AMR 대기열·AGV 충전·사족보행·드론 스테이션은 왼쪽 확장동 위쪽(x −51 ~ −37, z −31 ~ 8)으로 옮겼다
// 정밀조립Zone과 그 앞뒤 통로는 그대로 두고, 뒤쪽 시설(서버실·관제)은 BACK_SHIFT만큼 뒤로, 앞쪽 시설은 FRONT_SHIFT만큼 앞으로 옮겨 두 Zone 자리를 만들었다.
// 출하 도크는 오른쪽 벽 위쪽(z −31 · −19)에 두어 오른쪽 세로 통로로 바로 닿는다 (shipping.js).
// 시설 ↔ 정밀조립Zone 이동은 좌우 끝 세로 통로(x −35.5 · 35)로 돌아간다 — 두 확장 Zone 사이를 가로지르지 않는다.
// DOM 없이 시뮬레이션(sim.js)·CCTV·5G 배치와 3D 화면(zones.js)이 함께 쓴다.

export const BACK_SHIFT = 23, FRONT_SHIFT = 22;   // 뒤쪽: 21m + 바닥 격자 2칸(2m) 더 넓힘
export const bk = (z) => z - BACK_SHIFT;    // 뒤쪽 시설 좌표 (원래 z → 옮긴 z)
export const fr = (z) => z + FRONT_SHIFT;   // 앞쪽 시설 좌표
// 오른쪽 벽은 원래 x 38에서 바닥 격자 10칸(10m) 오른쪽으로 옮겨 공간을 넓혔다 — 안쪽 통로(오른쪽 세로 통로 x 35)·설비는 그대로, 벽에 붙은 것(출하 도크·야드)만 벽과 함께
export const RIGHT_SHIFT = 10;
export const BUILDING = { x0: -51, x1: 38 + RIGHT_SHIFT, z0: bk(-20), z1: fr(20) };   // 건물 안쪽 (오른쪽 벽 x 48 · 뒷벽 z −43 · 앞쪽 열린 면 z 42)
// 정밀조립 화면·서버: 왼쪽 벽(x −51) 안쪽에 건물 안(+x)을 보고 뒤(−z)부터 한 줄로 — 로봇 디스플레이(12m) → 관제 화면(18m) → CCTV 전광판(12m), 간격 0.5m (z −37.4 ~ 5.6, 벽을 보고 왼쪽 옆(앞쪽 +z)으로 바닥 격자 5칸 옮김). 서버 랙과 로고는 로봇 디스플레이 아래 벽 앞 — AMR 대기열·출동 차로(z −23 ~ 0)보다 뒤쪽
export const LEFT_WALL = { x: -50.6, robotZ: -31.4, ctrlZ: -15.9, cctvZ: -0.4 };
export const SRV = { x: -50.3, z: -29 };
export const inBuilding = (p, pad = 0) => p.x > BUILDING.x0 + pad && p.x < BUILDING.x1 - pad && p.z > BUILDING.z0 + pad && p.z < BUILDING.z1 - pad;
// 선행 배차: 빈 AMR을 2대 더 미리 불러 투입 진입로에 대기시킨다 (sim.js) — AMR 스테이션을 왼쪽 확장동 위쪽으로 옮긴 뒤 0·1·2를 비교해 처리량이 가장 높은 2를 유지
export const AMR_LEAD = 2;
// 정비실: 왼쪽 확장동 위쪽, AMR 스테이션 복귀 차로(x −45.2)와 왼쪽 세로 로봇 통로(x −36.8) 사이 — AMR 출동 차로(z 0)와 복귀 전용로(z −12.8) 사이에
// 긴 쪽을 남북으로 세우고(z −10.2 ~ −2.6, 바닥 x −43.5 ~ −39.75) 출입구가 동쪽 로봇 통로를 보도록 −90° 돌려 놓았다. 정비실 앞 짧은 통로(sim.js AISLE.T)로 왼쪽 세로 통로에 나가면 바로 정밀조립Zone 뒤 통로(B, z −9)
// 정비실 안 배치(도구 보관대·충전 스테이션·드나드는 줄)는 정비실 로컬 좌표(lx: 정비실 긴 방향, lz: 안쪽 벽 쪽 +)로 정하고 techAt으로 월드 좌표로 바꾼다
// factory.js 정비실 그룹도 같은 자리·같은 회전 (three.js y축 회전과 같은 식)
// 정비실은 Zone마다 하나씩 (같은 안쪽 배치를 자리·회전만 달리해 둔다):
//  · main(정밀조립): 위 설명 · flex(A-1 유연생산): 위쪽 뒷벽(z −43) 앞 왼쪽, 출입구가 남쪽 뒤쪽 시설 통로(BB, z −32)를 보게 180° (x −43 ~ −35.4)
//  · adapt(A-2 적응가공): 아래쪽 건물 앞면(z 42) 앞, 출입구가 북쪽 앞쪽 시설 통로(FF, z 31)를 보게 (x −15.5 ~ −7.9)
export const TECH_ROOMS = {
  main: { key: 'main', x: -43.0, z: -7.7, rot: -Math.PI / 2, aisle: 'T', label: '정비실' },
  flex: { key: 'flex', x: -37.9, z: -42.0, rot: Math.PI, aisle: 'BB', label: '유연생산 정비실' },
  adapt: { key: 'adapt', x: -13.0, z: 41.0, rot: 0, aisle: 'FF', label: '적응가공 정비실' },   // x −15.5 ~ −7.9 — 서쪽은 A-2 AMR 스테이션
};
export const TECH_ROOM = TECH_ROOMS.main;
export const techAt = (lx, lz, R = TECH_ROOM) => { const c = Math.cos(R.rot), s = Math.sin(R.rot); return { x: R.x + lx * c + lz * s, z: R.z - lx * s + lz * c }; };
export const techLocal = (p, R = TECH_ROOM) => { const c = Math.cos(R.rot), s = Math.sin(R.rot), dx = p.x - R.x, dz = p.z - R.z; return { lx: dx * c - dz * s, lz: dx * s + dz * c }; };
export const techHeading = (h, R = TECH_ROOM) => Math.atan2(Math.sin(h + R.rot), Math.cos(h + R.rot));   // 로컬 방향 → 월드 방향
// Zone별 시설 (확장 Zone: 위쪽 = A-1 유연생산 · 아래쪽 = A-2 적응가공) — 정밀조립Zone 시설과 같은 구성 (사족보행 2 · 드론 2 · 정비 2 · 물류 휴머노이드 2)
//  · quads: 사족보행 충전 스테이션 (통로를 보고 섬) · pads: 드론 이착륙·충전 패드 · station: Zone AMR 스테이션 (zones.js — 복귀로 위 일방통행 고리, 대기열이 차면 여기서 대기)
//  · kitSpot: 물류 휴머노이드가 부품 키트를 내려놓는 투입구 옆 자리 · helpers: 물류존 동쪽 물류 대기 줄의 휴머노이드 충전 도크 (북쪽 앞 통로를 봄)
//    물류 대기 줄(x −40.4 ~ −37.0)에 2칸씩 세 묶음 — 북쪽부터 A-1(z 19.4) · A-2(z 22.6) · 정밀조립(z 25.8, sim.js) — 드나들 때는 서쪽 진출입 줄(x −40.8)로 다른 묶음 앞을 비켜 간다
export const ZONE_FAC = {
  flex: {
    quads: [{ x: -49.0, z: -36.0 }, { x: -47.0, z: -36.0 }], quadHeading: 0, quadAisle: 'BB',
    pads: [{ x: -49.3, z: -40.6 }, { x: -46.9, z: -40.6 }],
    robotArea: { x0: -50.6, z0: -41.8, x1: -44.4, z1: -34.4 },
    // Zone AMR 스테이션 (정밀조립Zone AMR 스테이션과 같은 구조): AMR마다 자기 대기 자리(AMR i ↔ 자리 i)가 뒷벽 앞에 한 줄 — 줄 남쪽은 복귀 차로, 북쪽은 출동 차로
    // 복귀: Zone 복귀로(z −14.4) → 투입구 동쪽 틈(x −24.4, 투입구와 C01 셀 사이)으로 북쪽 → 복귀 차로(z −34.9)를 동쪽으로 → 자기 자리로 (북쪽을 보고 섬)
    // 출동: 자리 → 출동 차로(z −39.1)를 서쪽으로 → 진입로(x −33.6, 투입구에서 서쪽 5.6m)를 따라 남쪽 → 투입존 밖 대기열 → 투입구 · 세 차로가 서로 엇갈리지 않는다
    // 자리 15칸: x −23 ~ −3.4 (1.4m 간격, 출구 쪽 0번부터) · 투입 대기열(1대)이 비면 출구에 가까운 자리의 AMR부터 출동 (배터리·운행 제외 확인)
    station: { rowZ: -37, x0: -23.0, pitch: 1.4, retZ: -34.9, outZ: -39.1, ret: [{ x: -24.4, z: 'ret' }, { x: -24.4, z: -34.9 }], out: [{ x: -33.6, z: -39.1 }, { x: -33.6, z: 'src' }], area: { x0: -34.4, z0: -39.9, x1: -2.6, z1: -34.1 } },
    kitSpot: { x: -30.4, z: -26.2, aisle: 'BB', name: '유연생산 투입구 부품 키트 자리' },   // 투입구 서쪽 (동쪽 틈은 AMR 복귀로)
    agvDrop: { x: -26.0, z: -26.2, aisle: 'BB', name: '유연생산 자재 투입구 (원재료 하역)' },   // 투입구 북쪽(뒤쪽 시설 통로 쪽)
    helpers: [{ x: -39.55, z: 19.4 }, { x: -37.85, z: 19.4 }],
    // Zone 전광판·데이터 서버: 뒷벽(z −43) 가운데, A-1 Zone 바로 뒤 — 전광판은 벽 기둥(9m 간격) 앞 · 서버 랙 4대는 기둥 사이(x 0 · −9) 벽 앞 (안쪽 +z를 봄)
    // cams: 로봇 비전 관제 디스플레이 (12×4m) — 전광판 오른쪽(벽을 보고), 0.5m 띄워 (robotcam.js ZoneCamWall)
    wall: { board: { x: -1.5, y: 5.1, z: -42.2, rot: 0, w: 18, h: 4 }, server: { x: -4.45, z: -41.85, rot: 0 }, cams: { x: 14, y: 5.1, z: -42.2, rot: 0, w: 12, h: 4 } },
  },
  adapt: {
    quads: [{ x: -44.5, z: 36.0 }, { x: -42.5, z: 36.0 }], quadHeading: Math.PI, quadAisle: 'FF',
    pads: [{ x: -44.3, z: 40.3 }, { x: -41.9, z: 40.3 }],
    robotArea: { x0: -46.0, z0: 34.4, x1: -40.4, z1: 41.6 },
    // Zone AMR 스테이션 (정밀조립Zone과 같은 구조): 자기 대기 자리 15칸이 건물 앞쪽 시설 구역에 한 줄로 (x −36 ~ −16.4, z 36.5) — 줄 북쪽은 복귀 차로, 남쪽은 출동 차로
    // 복귀: Zone 복귀로(z 28.5)에서 x −16을 따라 남쪽 → 복귀 차로(z 34.4)를 서쪽으로 → 자기 자리 · 출동: 자리 → 출동 차로(z 38.6)를 서쪽으로 → 서쪽 끝(x −37.4)에서 북쪽 → z 33을 동쪽으로 → 진입로(x −33.6)를 따라 북쪽 → 투입존 밖 대기열
    station: { rowZ: 36.5, x0: -36.0, pitch: 1.4, retZ: 34.4, outZ: 38.6, ret: [{ x: -16.0, z: 'ret' }, { x: -16.0, z: 34.4 }], out: [{ x: -37.4, z: 38.6 }, { x: -37.4, z: 33.0 }, { x: -33.6, z: 33.0 }, { x: -33.6, z: 'src' }], area: { x0: -38.2, z0: 32.7, x1: -15.6, z1: 39.4 } },
    kitSpot: { x: -24.0, z: 15.6, aisle: 'F', name: '적응가공 투입구 부품 키트 자리' },
    agvDrop: { x: -26.0, z: 15.3, aisle: 'F', name: '적응가공 자재 투입구 (원재료 하역)' },   // 투입구 북쪽(앞 통로 쪽) — 정밀조립Zone AGV 하역 자리와 같은 거리 (투입구 중심에서 4.2m)
    helpers: [{ x: -39.55, z: 22.6 }, { x: -37.85, z: 22.6 }],
    // Zone 전광판·데이터 서버: 오른쪽 벽(x 48) 앞쪽 부분(안에서 벽을 보고 오른쪽), A-2 Zone 바로 옆 — 출하 도크 문(z −31 · −19)과 떨어짐 (안쪽 −x를 봄)
    wall: { board: { x: 47.8, y: 5.1, z: 19.5, rot: -Math.PI / 2, w: 18, h: 4 }, server: { x: 47.35, z: 19.5, rot: -Math.PI / 2 }, cams: { x: 47.8, y: 5.1, z: 35, rot: -Math.PI / 2, w: 12, h: 4 } },
  },
};
export const ZONE_LABEL = { main: '정밀조립', flex: '유연생산', adapt: '적응가공' };   // Zone별 오케스트레이터 · 정비실 이름
// 셀 위치(월드) → 어느 Zone 시설이 맡는지 (확장 Zone 영역 안이면 그 Zone, 아니면 정밀조립 main)
// Zone 서버 랙 4대 바닥 영역 (CCTV 시야 가림) — 랙 0.9 × 1.0m, 서버 기준점에서 로컬 x −1.65 ~ 1.65
export const zoneServerBoxes = () => Object.entries(ZONE_FAC).map(([k, F]) => { const S = F.wall.server, along = Math.abs(Math.sin(S.rot)) > 0.5;
  return along ? { x0: S.x - 0.5, x1: S.x + 0.5, z0: S.z - 2.1, z1: S.z + 2.1, h: 2.3, name: `${k} 데이터 서버 랙` } : { x0: S.x - 2.1, x1: S.x + 2.1, z0: S.z - 0.5, z1: S.z + 0.5, h: 2.3, name: `${k} 데이터 서버 랙` }; });
export const zoneAt = (x, z, pad = 2) => EXTRA_ZONES.find((Z) => { const r = zoneRect(Z, pad); return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1; })?.key ?? 'main';
// Zone 관할 구역 (CCTV 전광판 분할 — cctvview.js): Zone 셀 영역(바깥 벽까지) + 그 Zone 시설(정비실 · 사족보행·드론 스테이션 · Zone AMR 스테이션 · 전광판·데이터 서버 벽 앞)
// 그 밖(정밀조립 셀 · 물류존 · 정밀조립 정비실·AMR 스테이션 · 입고·출하 야드 등 공용 시설)은 정밀조립Zone(main)
const box = (pts, pad) => ({ x0: Math.min(...pts.map((p) => p.x)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad, z0: Math.min(...pts.map((p) => p.z)) - pad, z1: Math.max(...pts.map((p) => p.z)) + pad });
export const zoneAreas = (key) => {
  const Z = EXTRA_ZONES.find((z) => z.key === key), F = ZONE_FAC[key], R = TECH_ROOMS[key], W = F.wall;
  const wallPts = [W.board, W.cams].flatMap((b) => [-1, 1].map((k) => ({ x: b.x + Math.cos(b.rot) * k * b.w / 2, z: b.z - Math.sin(b.rot) * k * b.w / 2 })));
  const inward = { x: Math.sin(W.board.rot) * 3.5, z: Math.cos(W.board.rot) * 3.5 };   // 벽에서 건물 안쪽으로 3.5m
  // Zone 셀 영역을 그 Zone 폭 그대로 바깥 벽까지 (A-1: 뒤쪽 시설 통로·Zone AMR 스테이션·뒷벽 · A-2: 앞쪽 시설 통로·스테이션·건물 앞면)
  const r = zoneRect(Z, 1), ext = key === 'flex' ? { ...r, z0: BUILDING.z0 } : { ...r, z1: BUILDING.z1 };
  return [ext, F.robotArea, F.station.area, box([-2.6, 5.2].flatMap((lx) => [-3.6, 0.4].map((lz) => techAt(lx, lz, R))), 0.3),
    box([...wallPts, ...wallPts.map((p) => ({ x: p.x + inward.x, z: p.z + inward.z }))], 0.3)];
};
export const areaZone = (p) => ['flex', 'adapt'].find((k) => zoneAreas(k).some((r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1)) ?? 'main';

const TOP = -4.6, BOT = 4.6, MID = 0, PI = Math.PI;
// 셀 구성·제품·사이클·로봇은 상위 폴더 flexible-manufacturing(유연생산Zone)·adaptive-machining(적응가공Zone) 프로젝트를 따른다
// 좌표는 Zone 로컬 (origin = Zone 가운데). robot: [자동화 종류, 대수, 피지컬AI 종류, 대수] — 레거시는 작업자
export const EXTRA_ZONES = [
  {
    key: 'flex', code: '유연생산', uidp: 'FLX', name: '유연생산Zone', sub: '후드 · 도어 혼류 (삼진산업)', origin: { x: -1.5, z: -22 }, accent: 0x2f9bff,   // 투입구 x −28 (정밀조립Zone과 같은 줄) · 진입로 x −33.6 · 정밀조립Zone 뒤 보행로(z −11.2)와 셀 영역 사이에 AMR 복귀 전용로(z −12.8)가 지나도록 1.5m 뒤로
    products: { hood: { label: '후드', full: "LT2 후드 Ass'y" }, door: { label: '도어', full: '상용트럭 도어 Ass\'y' } },
    mix: { hood: 1, door: 1 },
    // 혼류 비율 (flexible-manufacturing ZONE_MIXES) — 왼쪽 패널 Zone 카드에서 고른다
    mixes: { dt: { label: '후드만', w: { hood: 1, door: 0 } }, '2:1': { label: '2 : 1', w: { hood: 2, door: 1 } }, '1:1': { label: '1 : 1', w: { hood: 1, door: 1 } }, '1:2': { label: '1 : 2', w: { hood: 1, door: 2 } }, ea: { label: '도어만', w: { hood: 0, door: 1 } } },
    // 왼쪽 패널 셀 목록: 셀 id 또는 분기 [{ product, title, cells }] (flexible-manufacturing renderZoneCard와 같은 묶음)
    card: ['C01', 'C02', 'C03', 'C04', 'C05', [{ product: 'door', title: '도어만 · 확장 셀', cells: ['C10'] }], 'C06', [{ product: 'ng', title: 'NG 분기 · 재검 포함', cells: ['C07'] }]],
    flow: '투입 → C01 키팅 → C02 보정 → C03 용접 → C04 실링 → C05 헤밍 → <span class="t-ea">(도어) C10 장착</span> → C06 검사 → <span class="t-ng">(NG) C07 재작업</span> → 구분 적재',
    // 출하 도크(x 22.5) 왼쪽, 왼쪽 세로 통로(x −35.5) 오른쪽에 들어가도록 셀 간격을 9m → 8.5m로 좁혔다 (flexible-manufacturing과 셀 순서·흐름 동일)
    cells: {
      C01: { type: 'kit', label: '공급·키팅', product: 'shared', use: '부품 ID 인식·혼류 판별·키팅', x: -19, z: TOP, side: -1, cycle: 58, robot: ['cobot', 2, 'ammr', 2] },
      C02: { type: 'locate', label: '안착·보정', product: 'shared', use: '지그 안착·비전 6DoF 보정', x: -10.5, z: TOP, side: -1, cycle: 42, robot: ['articulated', 1] },
      C03: { type: 'spot', label: '가접·본용접', product: 'shared', use: '스폿용접 2대 협업', x: -2, z: TOP, side: -1, cycle: 109, robot: ['articulated', 2] },
      C04: { type: 'seal', label: '실링', product: 'shared', use: '실러 도포·비드 검사', x: 6.5, z: TOP, side: -1, cycle: 46, robot: ['articulated', 1] },
      C05: { type: 'hem', label: '헤밍', product: 'shared', use: '헤밍 프레스 결합', x: 15, z: TOP, side: -1, cycle: 52, robot: ['articulated', 1] },
      C10: { type: 'mount', label: '정밀 장착', product: 'door', use: '도어 전용 · 힌지·스트라이커 장착', x: 14, z: MID, rot: PI, side: -1, cycle: 102, robot: ['articulated', 2] },
      C06: { type: 'vision', label: '치수·외관검사', product: 'shared', use: '갭·단차·외관 판정 (NG → C07)', x: 6.5, z: BOT, rot: PI, side: -1, cycle: 30, robot: ['none', 0] },
      C07: { type: 'rework', label: 'NG·재작업', product: 'ng', use: 'NG 재용접·재도포 보수 → 재검', x: -2, z: MID, rot: PI, side: -1, cycle: 120, robot: ['articulated', 1, 'humanoid', 1] },
    },
    routes: { hood: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'], door: ['C01', 'C02', 'C03', 'C04', 'C05', 'C10', 'C06'] },
    src: { x: -26.5, z: 0 }, sink: { x: -13.5, z: BOT, rot: PI },
    // 셀 사이 AMR 경유점 (flexible-manufacturing ZONE_PATHS와 같은 모양) — 오른쪽 통제 이송 통로 x 20.5, 합류 대기 차로 ±0.75m
    paths: {
      'C05>C06': [{ x: 20.5, z: TOP }, { x: 20.5, z: BOT + 0.75 }, { x: 8.5, z: BOT + 0.75 }],
      'C05>C10': [{ x: 20.5, z: TOP }, { x: 20.5, z: MID }, { x: 16, z: MID }],
      'C10>C06': [{ x: 11.7, z: MID }, { x: 10.4, z: BOT - 0.75 }, { x: 8.5, z: BOT - 0.75 }],
      'C06>SINK': [{ x: 4.2, z: BOT }, { x: 0, z: BOT + 0.75 }, { x: -11.5, z: BOT + 0.75 }],
      'C06>C07': [{ x: 4.2, z: BOT }, { x: 1.4, z: MID }, { x: 0, z: MID }],
      'C07>SINK': [{ x: -4.3, z: MID }, { x: -8.2, z: BOT - 0.75 }, { x: -11.5, z: BOT - 0.75 }],
    },
    ret: [{ x: -13.5, z: 7.6 }, { x: -32.1, z: 7.6 }, { x: -32.1, z: 0 }],   // 적재 → 정밀조립Zone 쪽 복귀로(z 7.6) → 투입 왼쪽 진입로 (x −33.6 — 스테이션이 있으면 끝 두 점 대신 스테이션 고리)
    ng: { at: 'C06', to: 'C07', rate: 0.07 },
    amr: { count: 15, speed: 1.1, ret: 1.5 }, load: 6, unload: 5,
    foot: { x0: -32.6, x1: 21.0, z0: -7.2, z1: 8.2 },   // 셀·AMR 차로가 차지하는 영역 (로컬)
  },
  {
    key: 'adapt', code: '적응가공', uidp: 'ADP', name: '적응가공Zone', sub: '유압블록 · 리어커버 혼류', origin: { x: 0, z: 19.5 }, accent: 0xff7a45,
    products: { hblock: { label: '유압블록', full: '유압 매니폴드 블록' }, rcover: { label: '리어커버', full: '다이캐스팅 리어커버' } },
    mix: { hblock: 1, rcover: 1 },
    mixes: { '1:1': { label: '1 : 1', w: { hblock: 1, rcover: 1 } }, '2:1': { label: '2 : 1', w: { hblock: 2, rcover: 1 } }, '1:2': { label: '1 : 2', w: { hblock: 1, rcover: 2 } }, hb: { label: '유압블록만', w: { hblock: 1, rcover: 0 } }, rc: { label: '리어커버만', w: { hblock: 0, rcover: 1 } } },
    card: ['MATL', [{ product: 'hblock', title: '유압블록 라인 · 대승정밀', cells: ['HB_MILL', 'HB_DEBR'] }, { product: 'rcover', title: '리어커버 라인 · 대승정밀', cells: ['RC_MILL', 'RC_TURN'] }], 'CMM'],
    flow: '투입 → ①소재 식별·3D측정 → <span class="t-dt">유압블록 ②5축 가공 → ③사선·디버링</span> / <span class="t-ea">리어커버 ④정밀절삭 → ⑤선삭</span> → ⑥CMM 판정 (NG → 리워크) → 합격품 적재',
    // 왼쪽 정렬: 자재 투입존(투입구 x −28)을 정밀조립Zone · A-1 유연생산Zone 투입구와 같은 세로줄에 맞춘다 · 진입로는 투입구 서쪽 5.6m(x −33.6) — 대기열은 투입존 밖
    // 셀 전체를 왼쪽으로 2.5m — ①소재 식별셀(x −19)을 투입구(x −28)에서 9m, 정밀조립Zone 부품분류셀과 같은 세로줄·같은 간격으로 (AMR 투입 → 첫 셀 동선 단축)
    // 오른쪽 끝(자체 복귀로 x 21)은 정밀조립Zone AMR 복귀로(x 26.2)와 5.2m 띄운다 · 셀 중심 간격 9 ~ 10m
    cells: {
      MATL: { no: '1', type: 'matid', label: '소재 식별·3D측정셀', product: 'shared', use: '소재 판별·가공여유 측정', x: -19, z: 0, cycle: 8, robot: ['cobot', 2, 'ammr', 2] },
      HB_MILL: { no: '2', type: 'mill5', label: '유압블록 5축 가공셀', product: 'hblock', use: '6면 밀링·드릴·탭', x: -9, z: BOT, cycle: 16, robot: ['articulated', 1] },
      HB_DEBR: { no: '3', type: 'deburr', label: '유압블록 사선·디버링셀', product: 'hblock', use: '사선홀·디버링·세척', x: 1, z: BOT, cycle: 14, robot: ['cobot', 2] },
      RC_MILL: { no: '4', type: 'mill5', label: '리어커버 정밀절삭셀', product: 'rcover', use: '5축 정밀 절삭', x: -9, z: TOP, side: -1, cycle: 18, robot: ['articulated', 1] },
      RC_TURN: { no: '5', type: 'turn', label: '리어커버 선삭·AI품질셀', product: 'rcover', use: '보어 선삭·품질예측', x: 1, z: TOP, side: -1, cycle: 14, robot: ['articulated', 1] },
      CMM: { no: '6', type: 'cmm', label: '초정밀 측정·리워크셀', product: 'shared', use: 'CMM 판정·리워크', x: 10, z: 0, cycle: 10, robot: ['cobot', 2, 'ammr', 2] },
    },
    routes: { hblock: ['MATL', 'HB_MILL', 'HB_DEBR', 'CMM'], rcover: ['MATL', 'RC_MILL', 'RC_TURN', 'CMM'] },
    src: { x: -28, z: 0 }, sink: { x: 18, z: 0 },
    paths: {},
    ret: [{ x: 21, z: 0 }, { x: 21, z: 9 }, { x: -33.6, z: 9 }, { x: -33.6, z: 0 }],   // 적재 → 동쪽 끝 → 앞쪽(시설 통로 쪽) 복귀로 → 투입 왼쪽 진입로
    rework: { at: 'CMM', rate: 0.06 },
    amr: { count: 15, speed: 1.6, ret: 2.6 }, load: 4, unload: 4,
    foot: { x0: -34.1, x1: 21.6, z0: -7.2, z1: 9.6 },
  },
];

// 확장 Zone 셀·차로 영역 (월드 좌표) — 현장 이벤트·비켜서기 자리·CCTV 장애물 판정에 쓴다
export const zoneRect = (Z, pad = 0) => ({ x0: Z.origin.x + Z.foot.x0 - pad, x1: Z.origin.x + Z.foot.x1 + pad, z0: Z.origin.z + Z.foot.z0 - pad, z1: Z.origin.z + Z.foot.z1 + pad });
export const inExtraZone = (p, pad = 0) => EXTRA_ZONES.some((Z) => { const r = zoneRect(Z, pad); return p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1; });
// 셀 바닥(4.6m 정사각형)의 월드 영역 + 설비 높이 — CCTV 시야 가림·5G 안테나 후보 제외
export const extraCellBoxes = () => EXTRA_ZONES.flatMap((Z) => Object.entries(Z.cells).map(([id, c]) => {
  const x = Z.origin.x + c.x, z = Z.origin.z + c.z, h = c.type === 'mill5' || c.type === 'turn' ? 2.8 : c.type === 'seal' ? 3.9 : c.type === 'hem' ? 3.1 : 2.6;
  return { x0: x - 2.3, x1: x + 2.3, z0: z - (c.type === 'mill5' || c.type === 'turn' ? 4.3 : 2.3), z1: z + (c.type === 'mill5' || c.type === 'turn' ? 4.3 : 2.3), h, name: `${Z.code} ${c.label}` };
}));

// 확장 Zone 셀 로봇 · 운반 AMR 고유 ID (정밀조립 RB-셀-번호 · AM-번호와 같은 꼴, Zone 코드 접두) — 3D 화면(zones.js)·DataHub·Odoo가 같은 규칙을 쓴다
// 셀 로봇 수는 단계마다 다르다: robot [종류, 대수, 피지컬AI 종류, 피지컬AI 대수] — 레거시는 작업자라 로봇이 없다
export const zoneCellRobots = (c, modeKey) => (modeKey === 'traditional' ? { kind: null, count: 0 } : modeKey === 'dark' && c.robot[2] ? { kind: c.robot[2], count: c.robot[3] } : { kind: c.robot[0], count: c.robot[0] === 'none' ? 0 : c.robot[1] });
export const zoneRobotUid = (Z, cellId, i) => `${Z.uidp}-RB-${cellId}-${i + 1}`;   // 설비 고유 ID는 영문 (FLX 유연생산 · ADP 적응가공)
export const zoneAmrUid = (Z, i) => `${Z.uidp}-AM-${String(i + 1).padStart(2, '0')}`;
