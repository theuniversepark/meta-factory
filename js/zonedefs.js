// 메타팩토리 3 Zone 배치 — 서버실(뒤)과 AMR 스테이션(앞) 사이에 앞뒤로 세 줄:
//   뒤  ── 뒷벽 · 관제 화면 · 서버실 (z −41) — 출하 도크·트럭 야드(x 19.5 ~ 38, 뒷벽 z −20)는 그대로 (뒷벽이 x 19.5에서 꺾인다)
//         뒤쪽 시설 통로 (z −30, 관제실 · 왼쪽 세로 통로로만 연결)
//         A-1 유연생산Zone (가운데 z −20.5)
//         정밀조립Zone 뒤 통로 (z −9) · 정밀조립Zone (z 0) · 앞 통로 (z 9)
//         A-2 적응가공Zone (가운데 z 19.5)
//         앞쪽 시설 통로 (z 31)
//   앞  ── AGV 충전소 · 정비실 · 사족보행·드론 스테이션 · AMR 대기열·복귀로 (z 35 ~ 41)
// 정밀조립Zone과 그 앞뒤 통로는 그대로 두고, 뒤쪽 시설(서버실·관제)은 BACK_SHIFT만큼 뒤로, 앞쪽 시설은 FRONT_SHIFT만큼 앞으로 옮겨 두 Zone 자리를 만들었다.
// 출하 도크는 유연생산Zone 오른쪽(x 22.5 · 31.5)이라 옮기지 않는다 — 출하 지게차 동선이 길어지지 않게.
// 시설 ↔ 정밀조립Zone 이동은 좌우 끝 세로 통로(x −35.5 · 35)로 돌아간다 — 두 확장 Zone 사이를 가로지르지 않는다.
// DOM 없이 시뮬레이션(sim.js)·CCTV·5G 배치와 3D 화면(zones.js)이 함께 쓴다.

export const BACK_SHIFT = 21, FRONT_SHIFT = 22;
export const bk = (z) => z - BACK_SHIFT;    // 뒤쪽 시설 좌표 (원래 z → 옮긴 z)
export const fr = (z) => z + FRONT_SHIFT;   // 앞쪽 시설 좌표
export const BUILDING = { x0: -51, x1: 38, z0: bk(-20), z1: fr(20) };   // 건물 안쪽 (뒷벽 z −41 · 앞쪽 열린 면 z 42)
export const NOTCH_X = 19.5;   // 이 x보다 오른쪽은 뒷벽이 원래 자리(z −20) — 출하 도크·트럭 야드
export const inBuilding = (p, pad = 0) => p.x > BUILDING.x0 + pad && p.x < BUILDING.x1 - pad && p.z < BUILDING.z1 - pad && p.z > (p.x > NOTCH_X - pad ? -20 : BUILDING.z0) + pad;
// AMR 스테이션이 투입구에서 FRONT_SHIFT만큼 멀어져 빈 AMR이 편도 약 9~14초 더 달린다 — 투입 간격(7.5~9초) 기준 2대를 더 미리 부른다 (sim.js 선행 배차)
export const AMR_LEAD = 2;
// 정비실: 적응가공Zone 자리에 있던 정비실은 왼쪽 물류 확장동 앞쪽 빈 자리(정밀조립Zone 앞 통로 z 9 바로 앞)로 옮겼다 —
// 정비원·정비 휴머노이드가 확장 Zone을 돌아가지 않고 앞 통로로 바로 셀에 간다 (설비 고장 대응 시간이 원래와 비슷하게). 원래 정비실 기준 x 12.8에서 TECH_DX만큼
export const TECH_DX = -56.8;

const TOP = -4.6, BOT = 4.6, MID = 0, PI = Math.PI;
// 셀 구성·제품·사이클·로봇은 상위 폴더 flexible-manufacturing(유연생산Zone)·adaptive-machining(적응가공Zone) 프로젝트를 따른다
// 좌표는 Zone 로컬 (origin = Zone 가운데). robot: [자동화 종류, 대수, 피지컬AI 종류, 대수] — 레거시는 작업자
export const EXTRA_ZONES = [
  {
    key: 'flex', code: 'A-1', name: '유연생산Zone', sub: '후드 · 도어 혼류 (삼진산업)', origin: { x: -3.5, z: -20.5 }, accent: 0x2f9bff,
    products: { hood: { label: '후드', full: "LT2 후드 Ass'y" }, door: { label: '도어', full: '상용트럭 도어 Ass\'y' } },
    mix: { hood: 1, door: 1 },
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
    ret: [{ x: -13.5, z: 7.6 }, { x: -29.1, z: 7.6 }, { x: -29.1, z: 0 }],   // 적재 → 정밀조립Zone 쪽 복귀로(z 7.6) → 투입 왼쪽 진입로
    ng: { at: 'C06', to: 'C07', rate: 0.07 },
    amr: { count: 7, speed: 1.1, ret: 1.5 }, load: 6, unload: 5,
    foot: { x0: -29.6, x1: 21.0, z0: -7.2, z1: 8.2 },   // 셀·AMR 차로가 차지하는 영역 (로컬)
  },
  {
    key: 'adapt', code: 'A-2', name: '적응가공Zone', sub: '유압블록 · 리어커버 혼류', origin: { x: 0, z: 19.5 }, accent: 0xff7a45,
    products: { hblock: { label: '유압블록', full: '유압 매니폴드 블록' }, rcover: { label: '리어커버', full: '다이캐스팅 리어커버' } },
    mix: { hblock: 1, rcover: 1 },
    // 정밀조립Zone AMR 출동로(x −30.6)·복귀로(x 31.2)가 옆으로 지나가도록 셀 간격을 정밀조립Zone보다 조금 좁혀 x −27.6 ~ 28 안에 둔다
    cells: {
      MATL: { no: '1', type: 'matid', label: '소재 식별·3D측정셀', product: 'shared', use: '소재 판별·가공여유 측정', x: -16, z: 0, cycle: 8, robot: ['cobot', 2, 'ammr', 2] },
      HB_MILL: { no: '2', type: 'mill5', label: '유압블록 5축 가공셀', product: 'hblock', use: '6면 밀링·드릴·탭', x: -4.5, z: BOT, cycle: 16, robot: ['articulated', 1] },
      HB_DEBR: { no: '3', type: 'deburr', label: '유압블록 사선·디버링셀', product: 'hblock', use: '사선홀·디버링·세척', x: 6.5, z: BOT, cycle: 14, robot: ['cobot', 2] },
      RC_MILL: { no: '4', type: 'mill5', label: '리어커버 정밀절삭셀', product: 'rcover', use: '5축 정밀 절삭', x: -4.5, z: TOP, side: -1, cycle: 18, robot: ['articulated', 1] },
      RC_TURN: { no: '5', type: 'turn', label: '리어커버 선삭·AI품질셀', product: 'rcover', use: '보어 선삭·품질예측', x: 6.5, z: TOP, side: -1, cycle: 14, robot: ['articulated', 1] },
      CMM: { no: '6', type: 'cmm', label: '초정밀 측정·리워크셀', product: 'shared', use: 'CMM 판정·리워크', x: 16, z: 0, cycle: 10, robot: ['cobot', 2, 'ammr', 2] },
    },
    routes: { hblock: ['MATL', 'HB_MILL', 'HB_DEBR', 'CMM'], rcover: ['MATL', 'RC_MILL', 'RC_TURN', 'CMM'] },
    src: { x: -25, z: 0 }, sink: { x: 25, z: 0 },
    paths: {},
    ret: [{ x: 28, z: 0 }, { x: 28, z: 9 }, { x: -27.6, z: 9 }, { x: -27.6, z: 0 }],   // 적재 → 동쪽 끝 → 앞쪽(시설 통로 쪽) 복귀로 → 투입 왼쪽 진입로
    rework: { at: 'CMM', rate: 0.06 },
    amr: { count: 9, speed: 1.6, ret: 2.6 }, load: 4, unload: 4,
    foot: { x0: -28.6, x1: 28.6, z0: -7.2, z1: 9.6 },
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
