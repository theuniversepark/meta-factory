// 적응가공 가공기 상태 감시 · 엣지 AI 예지보전 검증 (js/machmon.js) — 공구 마모가 오르면 VB·진동·AE가 오르고, 파손 전에 예지 교환,
// 주축 이상이면 정비 요청 + 공장 오케스트레이터 결정 요청, 판단은 A2A 상태 보고로 상위에 올라가고, 서버 묶음·AAS 환경이 만들어지는지. 실행: npm test
import { Simulation } from '../js/sim.js';
import { MON_SENSORS, machineEnvironment, machineCSV } from '../js/machmon.js';
import { toXML } from '../js/aas.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const s = new Simulation('dark', 7, { quiet: true }), mon = s.machmon, O = s.fos.adapt;
// 화면 흐름(zones.js) 대신 가공기 셀 상태만 흉내 — 가공 중(BUSY · 진행 50%)
const cells = { HB_MILL: { id: 'HB_MILL', def: { type: 'mill5', cycle: 16 }, state: 'BUSY', progress: 0.5, cycle: 16 }, RC_TURN: { id: 'RC_TURN', def: { type: 'turn', cycle: 14 }, state: 'BUSY', progress: 0.5, cycle: 14 } };
s.xzones = { byKey: (k) => (k === 'adapt' ? { cells } : null) };
console.log('== 구성');
check('가공기 4대 감시 (5축 밀링·정밀절삭·선삭·드릴 디버링) · 센서 13종', Object.keys(mon.m).join() === 'HB_MILL,RC_MILL,RC_TURN,HB_DEBR' && MON_SENSORS.length === 13);
const run = (sec) => { for (let t = 0; t < sec; t += 0.5) s.step(0.5); };
run(5);
const v0 = { ...mon.m.HB_MILL.latest };
check('새 공구 가공 중 — 정상 판단 · 진동 정상 범위', mon.m.HB_MILL.decision === 'ok' && v0.vibration < 4.5 && v0.spindleLoad > 30, `진동 ${v0.vibration} · 부하 ${v0.spindleLoad}`);
console.log('== 공구 마모 → 예지 교환 (파손 전)');
let changedAt = null, maxVB = 0;
for (let k = 0; k < 120 && changedAt == null; k++) {
  O.afterCell(cells.HB_MILL, { id: `T${k}` }, () => 0.5); run(2);
  maxVB = Math.max(maxVB, mon.m.HB_MILL.latest.toolVB);
  if (O.tools.HB_MILL.changing > 0) changedAt = { wear: mon.m.HB_MILL.records.find((r) => r.action)?.tool?.wear ?? null, k };
}
const recs = mon.m.HB_MILL.records, pre = recs.find((r) => r.action?.startsWith('예지 공구 교환'));
check('마모가 오르며 VB·판단 단계가 오름 (감시 → 교체 권고)', maxVB > 180 && recs.some((r) => r.decision === 'watch') && recs.some((r) => r.decision === 'replace' || r.decision === 'now'), `VB 최대 ${maxVB}µm · 판단 ${[...new Set(recs.map((r) => r.decision))].join('/')}`);
check('엣지 AI가 파손(마모 1.0) 전에 공구 교환 실행 — 공구 감시 기준(0.88)보다 먼저', !!pre && O.breaks === 0 && pre.tool.wear < 0.88, pre ? `교환 시 마모 ${pre.tool.wear} · 잔여 ${pre.rul.parts}개` : '교환 없음');
check('교체 기록이 정비 데이터 형태 (공구 ID · VB · 잔여 수명 · 근거 센서값 · 작업 유형)', pre?.workType === 'tool-replace' && pre.tool.id && pre.tool.VB_um > 0 && pre.rul && pre.evidence?.vibration != null);
const st = s.fos.bus.log.filter((m) => m.type === 'status' && m.body?.kind === 'pdm');
check('상위 공장 오케스트레이터에 A2A 상태 보고 (차단 없음)', st.length > 0 && st.every((m) => m.status !== 'blocked' && m.to === 'factory'), `보고 ${st.length}건`);
console.log('== 주축 이상 → 예지정비 요청 · 공장 결정');
const fac = s.zoneCell('adapt', 'RC_TURN'); fac.health = 38;
run(6);
const req = fac.request, esc = s.fos.bus.log.find((m) => m.type === 'decision.request' && m.body?.kind === 'machine-pm'), dec = s.fos.decisions.find((d) => d.kind === 'machine-pm');
check('주축 점검 판단 → 정비 인력 요청 · 결정 요청 → 공장 오케스트레이터 승인', mon.stats.spindleReq >= 1 && !!req && !!esc && dec?.verdict === '승인', `요청 ${req?.kind ?? '-'} · 결정 ${dec?.verdict ?? '-'}`);
console.log('== 서버 묶음 · AAS');
const tap = []; mon.onItem = (x) => tap.push(x); run(6); mon.onItem = null;
check('패킷 캡처 연결: 묶음에 쌓는 메시지를 같은 토픽으로 onItem에도 (pcap)', tap.length > 0 && tap.every((x) => x.topic.startsWith('metafactory/machmon/v1/adapt/') && mon.outbox.includes(x)), `${tap.length}건`);
const box = mon.take(5000);
check('서버 묶음: 측정(5초) + 판단 기록 · MQTT 토픽', box.some((x) => x.kind === 'sample' && x.topic === 'metafactory/machmon/v1/adapt/HB_MILL') && box.some((x) => x.kind === 'record'), `${box.length}건`);
const env = machineEnvironment(mon, 'HB_MILL'), xml = toXML(env), sms = env.submodels.map((x) => x.idShort);
check('AAS: 셸 1 · 서브모델 6 (명판 · 기술 데이터 · 운영 데이터 · 공구 상태 · 예지보전 · 시계열)', env.assetAdministrationShells.length === 1 && sms.join() === 'Nameplate,TechnicalData,OperationalData,ToolCondition,PredictiveMaintenance,TimeSeries' && xml.includes('<idShort>ToolCondition</idShort>') && xml.includes('FlankWearVB_um'));
check('시계열 CSV (센서 13열)', machineCSV(mon, 'HB_MILL').split('\n')[0].split(',').length === 14);
const L = new Simulation('traditional', 7, { quiet: true }); L.xzones = s.xzones; for (let t = 0; t < 5; t += 0.5) L.step(0.5);
check('레거시: 센서 없음 (수집·판단 안 함)', !L.machmon.on && L.machmon.outbox.length === 0);
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
