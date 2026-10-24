// 유연생산 C01 공급·키팅 검증 (js/kitcell.js) — 셀 구성(협동로봇 2대 + 키팅 피킹 로봇: 자동화 레일 협동로봇 · 피지컬AI AMMR), 키트 구성(후드·도어 부품 · 흐름 랙),
// 피지컬AI ①~⑥이 단계별로 다르게 기록되는지(빈 피킹 · 키트 검증 · 적응 장착 · 재고 보충 문턱 · 보울 피더 막힘 예측)와 C01 대기 시간, 센서값 · 데이터(MQTT 토픽)를 확인한다
// (트레이 흐름·로봇 동작·간섭은 tools/check-sweeps.cjs). 실행: npm test
import { Simulation } from '../js/sim.js';
import { KIT_SPEC, KIT_SENSORS, KIT_TOPIC, KIT_PARTS, KIT_RACKS, KIT_T, kitPhase } from '../js/kitcell.js';
import { EXTRA_ZONES, zoneCellAux } from '../js/zonedefs.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
// 키트마다 C01 한 사이클(약 34초)씩 시간을 보내며 — 보충 요청 뒤 일정 시간이 지나야 흐름 랙이 다시 채워진다 (measure)
const run = (M, n, from = 0) => Array.from({ length: n }, (_, k) => { const it = { id: `FLX-${from + k}`, product: k % 2 ? 'door' : 'hood' }; it.extra = M.plan(it); M.done(it); M.sim.time += 34; M.measure(); return it; });
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

console.log('== 구성');
const D = EXTRA_ZONES.find((z) => z.key === 'flex').cells.C01;
check('C01: 협동로봇 2대(두 단계) + 키팅 피킹 로봇 1대(자동화 협동로봇 · 피지컬AI AMMR) · 레거시는 작업자', D.robot.join() === 'cobot,2' && D.picker?.[0] === 'cobot' && D.picker?.[2] === 'ammr' && zoneCellAux(D, 'dark') === 1 && zoneCellAux(D, 'smart') === 1 && zoneCellAux(D, 'traditional') === 0);
check('키트 부품: 후드·도어 각 6종 · 흐름 랙 3대 · 같은 무게 좌/우 사양 포함', KIT_PARTS.hood.length === 6 && KIT_PARTS.door.length === 6 && KIT_RACKS.length === 3 && KIT_PARTS.hood[0][2] === KIT_PARTS.hood[1][2]);
check('센서 6종 · C01 구간(정지 자리 → 장착 → 검증 → 회수) 순서', KIT_SENSORS.length === 6 && KIT_T.inEnd < KIT_T.pick[0] && KIT_T.pick[1] <= KIT_T.verify[0] && KIT_T.verify[1] <= KIT_T.feed[0] && kitPhase(0.02) === 'present' && kitPhase(0.5) === 'mount' && kitPhase(0.85) === 'verify' && kitPhase(0.95) === 'feed');

console.log('== 피지컬AI · 자동화 · 레거시 (키트 3000개)');
const sims = Object.fromEntries(['dark', 'smart', 'traditional'].map((m) => [m, new Simulation(m, 17, { quiet: true })]));
const sent = []; sims.dark.machmon.onItem = (x) => sent.push(x);
const R = Object.fromEntries(Object.entries(sims).map(([m, s]) => [m, run(s.kit, 3000)]));
const st = (m) => sims[m].kit.stats;
check('① 빈 피킹: 피지컬AI = VLA(신뢰도) · 자동화 = 표시등 피킹 · 레거시 = 작업자', R.dark.every((it) => it.kit.pick.method.startsWith('VLA') && it.kit.pick.conf >= 0.95) && R.smart.every((it) => it.kit.pick.method.startsWith('표시등')) && R.traditional.every((it) => it.kit.pick.method === '작업자'));
check('② 키트 검증: 피지컬AI는 잘못 담은 키트를 모두 검증에서 잡음 · 자동화는 같은 무게 사양 차이를 C01까지 놓침 · 레거시는 더 놓침',
  st('dark').errors > 0 && st('dark').missed === 0 && st('smart').missed > 0 && st('smart').caught > 0 && st('traditional').missed > st('smart').missed,
  `C01에서 발견 ${st('dark').missed}/${st('smart').missed}/${st('traditional').missed} (잘못 담음 ${st('dark').errors}/${st('smart').errors}/${st('traditional').errors})`);
check('④ 적응 장착: 피지컬AI 비전 보정·힘 제어(약 12~20N)가 자동화 위치 제어(약 25~50N)보다 낮은 힘', sum(R.dark, (x) => x.kit.mount.force) / 3000 < sum(R.smart, (x) => x.kit.mount.force) / 3000 - 8 && R.dark.every((it) => it.kit.mount.offset != null));
check('⑤ 재고 보충: 문턱이 피지컬AI(35%) > 자동화(20%) > 레거시(빈 칸) — 레거시만 결품으로 C01이 기다림', KIT_SPEC.reorder.dark > KIT_SPEC.reorder.smart && st('dark').replenish > 0 && st('smart').replenish > 0 && st('traditional').stockouts > 0 && st('dark').stockouts === 0,
  `보충 ${st('dark').replenish}/${st('smart').replenish}/${st('traditional').replenish} · 결품 ${st('dark').stockouts}/${st('smart').stockouts}/${st('traditional').stockouts}`);
check('⑥ 보울 피더: 피지컬AI는 막힘을 미리 처리(C01 안 멈춤) · 자동화·레거시는 멈춤', st('dark').jams === 0 && st('dark').jamsAvoided > 0 && st('smart').jams > 0 && st('traditional').jams > 0, `막힘 ${st('dark').jams}/${st('smart').jams}/${st('traditional').jams} · 예측 처리 ${st('dark').jamsAvoided}`);
const wait = (m) => sum(R[m], (x) => x.extra);
check('C01 대기 시간(키트 오류 발견 · 피더 막힘 · 결품): 피지컬AI < 자동화 < 레거시', wait('dark') < wait('smart') && wait('smart') < wait('traditional'), `${wait('dark')} / ${wait('smart')} / ${wait('traditional')}초`);
check('키트 기록 · MQTT (…/part · …/event) · 레거시는 전송 없음', sims.dark.kit.records.length === 60 && sent.filter((x) => x.topic === `${KIT_TOPIC}/part`).length === 3000 && sent.some((x) => x.topic === `${KIT_TOPIC}/event`) && !sims.traditional.kit.on);

console.log('== 센서값');
const s = sims.dark, it = { id: 'FLX-X', product: 'door' }; s.kit.plan(it);
const cell = { id: 'C01', state: 'BUSY', progress: 0.84, fault: null, halt: false, item: it };
s.xzones = { byKey: (k) => (k === 'flex' ? { cells: { C01: cell } } : null) };
s.kit.acc = 1; s.kit.tick(0); const v = { ...s.kit.latest };
cell.progress = 0.5; s.kit.acc = 1; s.kit.tick(0); const m = { ...s.kit.latest };
check('검증 구간: 키트 무게 = 부품 무게 합 · 영상 판정 신뢰도', v.phase === 'verify' && Math.abs(v.weight - sum(KIT_PARTS.door, (p) => p[2])) < 20 && v.vision > 95, JSON.stringify(v));
check('장착 구간: 무게 0 · 피더 레벨 · 재고 비율', m.phase === 'mount' && m.weight === 0 && m.feedLevel > 0 && m.stock >= 0 && m.stock <= 100);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
