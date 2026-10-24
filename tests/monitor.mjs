// 설비 대시보드 (4단계) 검증 — UNS 설비 요약·이벤트 메시지(js/datahub.js), Telegraf 수집 규칙(monitoring/telegraf/telegraf.conf)이
// 앱이 실제로 내보내는 토픽·필드와 맞는지, Grafana 대시보드가 수집되는 측정·필드만 읽는지, 켜기·끄기 API(server/monitor-api.mjs)가
// 가짜 Docker로 올바른 순서(구성 복사 → .env → compose up → telegraf·grafana 다시 시작 → 준비 확인 → 토큰 어긋남이면 다시 초기화)로 도는지. 실행: npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoneLine } from '../js/line.js';
import { Simulation } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { unsTelemetry, unsEvents, unsZoneKpi } from '../js/datahub.js';
import { MON_SENSORS } from '../js/machmon.js';
import { WASH_SENSORS, WASH_TOPIC } from '../js/washer.js';
import { CMM_SENSORS, CMM_TOPIC } from '../js/cmmcell.js';
import { MATL_SENSORS, MATL_TOPIC } from '../js/matlcell.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), MON = path.join(ROOT, 'monitoring');
const match = (filter, topic) => { const f = filter.split('/'), t = topic.split('/'); if (f.at(-1) === '#') return t.length >= f.length - 1 && f.slice(0, -1).every((x, i) => x === '+' || x === t[i]); return f.length === t.length && f.every((x, i) => x === '+' || x === t[i]); };

// ── Telegraf 수집 규칙 읽기 (입력마다 토픽 · 측정 이름 · 필드 경로)
const conf = fs.readFileSync(path.join(MON, 'telegraf/telegraf.conf'), 'utf8');
const inputs = conf.split('[[inputs.mqtt_consumer]]').slice(1).map((b) => ({
  topics: JSON.parse(b.match(/topics = (\[.*\])/)[1]), meas: b.match(/measurement_name = "(\w+)"/)[1],
  fields: [...b.matchAll(/json_v2\.field\]\]\s+path = "([\w.]+)"(?:\s+rename = "(\w+)")?/g)].map((m) => ({ path: m[1], name: m[2] ?? m[1] })),
  tags: [...b.matchAll(/json_v2\.tag\]\]\s+path = "(\w+)"/g)].map((m) => m[1]),
}));
const at = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const inputOf = (topic) => inputs.filter((i) => i.topics.some((f) => match(f, topic)));

console.log('== UNS 설비 요약 · 운영 이벤트 (자동화 · 확장 존 1시간)');
const s = new Simulation('smart', 4, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
for (let t = 0; t < 3600; t += 0.1) { s.step(0.1); ag.update(0.1); }
const tel = unsTelemetry(s), P = tel.map((m) => JSON.parse(m.payload));
check('메인 공정 + 확장 존 설비마다 1건 · 토픽 metafactory/telemetry/v1/{존}/{설비}', tel.length === s.processing.filter((x) => !x.standby).length + s.zoneCells.length && tel.every((m, i) => m.topic === `metafactory/telemetry/v1/${P[i].zone}/${String(P[i].asset).replace(/[^\w.-]/g, '_')}`) && ['main', 'flex', 'adapt', 'insp'].every((z) => P.some((p) => p.zone === z)), `${tel.length}건`);
check('토픽 끝마디에 MQTT 예약 문자(+ # /) 없음 · 설비 ID 중복 없음', tel.every((m) => m.topic.split('/').length === 5 && !/[+#]/.test(m.topic)) && new Set(tel.map((m) => m.topic)).size === tel.length);
check('필드 형식 — health·rul_min·risk10·cpk·util 숫자 또는 null · busy·down 0/1 · state 문자열', P.every((p) => ['health', 'rul_min', 'risk10', 'cpk', 'util'].every((k) => p[k] === null || Number.isFinite(p[k])) && [0, 1].includes(p.busy) && [0, 1].includes(p.down) && typeof p.state === 'string') && P.some((p) => p.health != null && p.rul_min != null));
s.quiet = false;   // 시험 모드(quiet)는 로그를 남기지 않는다 — 대시보드로 보낼 로그를 직접 남긴다
const before = s.logSeq; s.log('warn', '유연생산 FLX-C03 Cpk 저하'); s.log('alert', '적응가공 ADP-HB_MILL 주축 이상', { obs: '진동 7.4mm/s', dec: '정비 요청', act: 'x'.repeat(600) }); s.log('info', '정보 로그 (보내지 않음)');
const E1 = unsEvents(s, 0), E2 = unsEvents(s, E1.next);
check('운영 이벤트 — 경보·주의·조치만 · 다음 호출은 새 것만 (중복 없음)', E1.messages.length > 0 && E1.messages.every((m) => /^metafactory\/events\/v1\/(alert|warn|act)$/.test(m.topic)) && E2.messages.length === 0 && E1.next === s.logSeq && E1.messages.some((m) => m.topic.endsWith('/alert') && JSON.parse(m.payload).zone === 'adapt') && unsEvents(s, before).messages.length === 2 && unsEvents(s, before + 1).messages.length === 1, `${E1.messages.length}건`);
check('이벤트 본문 400자 이내 · 존 태그 main/flex/adapt/insp', E1.messages.map((m) => JSON.parse(m.payload)).every((p) => p.text.length <= 400 && ['main', 'flex', 'adapt', 'insp'].includes(p.zone) && p.title));

console.log('== Telegraf 수집 규칙 ↔ 앱이 보내는 메시지');
check('입력 12개 — equipment · sensor · machine · washer · cleanliness · cmm · cmm_part · matl · matl_part · event · oee · quality', inputs.map((i) => i.meas).join() === 'equipment,sensor,machine,washer,cleanliness,cmm,cmm_part,matl,matl_part,event,oee,quality');
const ZK = unsZoneKpi(s); for (let t = 0; t < 600; t += 0.1) { s.step(0.1); ag.update(0.1); }
const ZK2 = unsZoneKpi(s), oeeMsg = ZK2.filter((m) => m.topic.includes('/oee/')), qMsg = ZK2.filter((m) => m.topic.includes('/quality/'));
check('Zone OEE · 품질 표본 토픽 → oee · quality 입력에만 걸림 (평면 JSON — @this 객체 · 태그 zone/product/kind)', oeeMsg.length >= 1 && qMsg.length > 5 && oeeMsg.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'oee') && qMsg.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'quality') && qMsg.every((m) => { const p = JSON.parse(m.payload); return ['zone', 'product', 'kind'].every((k) => typeof p[k] === 'string') && Object.entries(p).every(([k, v]) => ['zone', 'product', 'kind', 'id'].includes(k) || Number.isFinite(v)); }) && ZK.length >= 1, `oee ${oeeMsg.length} · 품질 ${qMsg.length}`);
check('설비 요약 · 이벤트 토픽이 각각 정확히 한 입력에만 걸림', tel.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'equipment') && E1.messages.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'event'));
const eqIn = inputs.find((i) => i.meas === 'equipment');
check('설비 요약 — 규칙의 필드·태그가 모두 메시지에 있음', [...eqIn.fields.map((f) => f.path), ...eqIn.tags].every((k) => k in P[0]));
// 센서 묶음 · 가공기 감시 — 실제 메시지를 만들어 같은 검사
const sn = new Simulation('dark', 5, { line: zoneLine(), quiet: true, sensors: true }); sn.sensors.publish = true;
for (let t = 0; t < 30; t += 0.1) sn.step(0.1);
const sb = sn.sensors.outbox.filter((m) => !m.topic.endsWith('/birth'));
check('센서 묶음 → sensor 입력 · readings[] 각 항목에 s·m·u·v', sb.length > 0 && sb.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'sensor') && sb.flatMap((m) => JSON.parse(m.payload).readings).every((r) => r.s && r.m && 'u' in r && Number.isFinite(r.v)), `${sb.length}묶음`);
check('센서 BIRTH(retain) · 가공기 이벤트·스냅숏은 수집하지 않음 (토픽 깊이 다름)', inputOf('metafactory/sensors/v1/flex/C01/birth').length === 0 && inputOf('metafactory/machmon/v1/adapt/HB_MILL/event').length === 0 && inputOf('metafactory/machmon/v1/adapt/HB_MILL/snapshot').length === 0);
const sm = new Simulation('dark', 7, { quiet: true }), mon = sm.machmon;
const cells = { HB_MILL: { id: 'HB_MILL', def: { type: 'mill5', cycle: 16 }, state: 'BUSY', progress: 0.5, cycle: 16 } };
sm.xzones = { byKey: (k) => (k === 'adapt' ? { cells } : null) };
for (let t = 0; t < 30; t += 0.5) sm.step(0.5);
const ms = mon.outbox.filter((m) => m.kind === 'sample' && m.topic.startsWith('metafactory/machmon/')), mIn = inputs.find((i) => i.meas === 'machine');   // 같은 묶음에 세척기(js/washer.js) 샘플도 섞인다
check('가공기 감시 샘플 → machine 입력 · 필드 경로(rul.min · rul.spindleMin · tool.wear …)가 메시지에 있음', ms.length > 0 && ms.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'machine') && mIn.fields.every((f) => f.path.split('.')[0] in ms.at(-1)) && Number.isFinite(ms.at(-1).rul?.spindleMin), mIn.fields.map((f) => `${f.path}=${JSON.stringify(at(ms.at(-1), f.path))}`).join(' '));
check('가공기 측정값 v — 센서 13종이 숫자로', MON_SENSORS.every((x) => Number.isFinite(ms.at(-1).v[x.key])));
// 세척기: 공정 샘플 → washer 입력 (v 측정값 6종) · 블록별 청정도 → cleanliness 입력 (필드 경로가 메시지에) · 이벤트는 수집하지 않음
const W = sm.washer; for (let k = 0; k < 3; k++) { const it = { id: `T${k}`, product: 'hblock' }; W.plan(it); W.done(it); }
W.acc = 1; W.lastQ = -99; W.tick(0);
const ws = mon.outbox.filter((m) => m.topic === WASH_TOPIC && m.kind === 'sample'), wp = mon.outbox.filter((m) => m.topic === `${WASH_TOPIC}/part`), cIn = inputs.find((i) => i.meas === 'cleanliness');
check('세척기 샘플 → washer 입력 · 측정값 v 6종 숫자 · 단계 문자열', ws.length > 0 && ws.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'washer') && WASH_SENSORS.every((x) => Number.isFinite(ws.at(-1).v[x.key])) && typeof ws.at(-1).phase === 'string', `${ws.length}건`);
check('세척 청정도 → cleanliness 입력 · 필드 경로가 메시지에 · 이벤트는 수집 안 함', wp.length === 3 && wp.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'cleanliness') && cIn.fields.every((f) => Number.isFinite(wp[0][f.path])) && inputOf(`${WASH_TOPIC}/event`).length === 0);

// CMM 셀: 측정실 샘플 → cmm 입력 (v 측정값 — 소재 온도는 소재가 있을 때만) · 소재별 기록 → cmm_part 입력
const Cm = sm.cmm; for (let k = 0; k < 3; k++) { const it = { id: `C${k}`, product: 'hblock' }; Cm.plan(it); Cm.done(it); }
Cm.acc = 1; Cm.lastQ = -99; Cm.tick(0);
const cs = mon.outbox.filter((m) => m.topic === CMM_TOPIC && m.kind === 'sample'), cp = mon.outbox.filter((m) => m.topic === `${CMM_TOPIC}/part`), cpIn = inputs.find((i) => i.meas === 'cmm_part');
check('CMM 측정실 샘플 → cmm 입력 · 측정값 v (소재 온도 빼고 숫자) · 단계 문자열', cs.length > 0 && cs.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'cmm') && CMM_SENSORS.filter((x) => x.key !== 'part').every((x) => Number.isFinite(cs.at(-1).v[x.key])) && typeof cs.at(-1).phase === 'string', `${cs.length}건`);
check('CMM 소재별 기록 → cmm_part 입력 · 필드 경로가 메시지에', cp.length === 3 && cp.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'cmm_part') && cpIn.fields.every((f) => Number.isFinite(cp[0][f.path])));

// 소재 식별셀: 스캔 부스 샘플 → matl 입력 · 소재별 기록 → matl_part 입력
const Mt = sm.matl; for (let k = 0; k < 3; k++) { const it = { id: `M${k}`, product: 'hblock' }; Mt.plan(it); Mt.done(it); }
Mt.acc = 1; Mt.lastQ = -99; Mt.tick(0);
const ms2 = mon.outbox.filter((m) => m.topic === MATL_TOPIC && m.kind === 'sample'), mp = mon.outbox.filter((m) => m.topic === `${MATL_TOPIC}/part`), mpIn = inputs.find((i) => i.meas === 'matl_part');
check('소재 식별셀 샘플 → matl 입력 · 측정값 v 숫자 · 단계 문자열', ms2.length > 0 && ms2.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'matl') && MATL_SENSORS.every((x) => Number.isFinite(ms2.at(-1).v[x.key])) && typeof ms2.at(-1).phase === 'string', `${ms2.length}건`);
check('소재별 기록 → matl_part 입력 · 필드 경로가 메시지에', mp.length === 3 && mp.every((m) => inputOf(m.topic).map((i) => i.meas).join() === 'matl_part') && mpIn.fields.every((f) => Number.isFinite(mp[0][f.path])));

console.log('== Grafana 대시보드 ↔ 수집되는 측정·필드');
const dash = fs.readdirSync(path.join(MON, 'grafana/dashboards')).filter((f) => f.endsWith('.json')).map((f) => ({ f, j: JSON.parse(fs.readFileSync(path.join(MON, 'grafana/dashboards', f), 'utf8')) }));
const fieldsOf = { equipment: new Set(eqIn.fields.map((f) => f.name)), machine: new Set([...mIn.fields.map((f) => f.name), ...MON_SENSORS.map((x) => x.key)]), sensor: new Set(['v']), washer: new Set(['phase', ...WASH_SENSORS.map((x) => x.key)]), cleanliness: new Set(cIn.fields.map((f) => f.name)), cmm: new Set(['phase', ...CMM_SENSORS.map((x) => x.key)]), cmm_part: new Set(cpIn.fields.map((f) => f.name)), matl: new Set(['phase', ...MATL_SENSORS.map((x) => x.key)]), matl_part: new Set(mpIn.fields.map((f) => f.name)), event: new Set(['title', 'text']), oee: new Set(Object.keys(JSON.parse(oeeMsg[0].payload)).filter((k) => k !== 'zone')), quality: new Set(qMsg.flatMap((m) => Object.keys(JSON.parse(m.payload)))) };
const queries = dash.flatMap(({ f, j }) => [...j.panels.flatMap((p) => (p.targets ?? []).map((t) => ({ f, q: t.query, ds: t.datasource?.uid ?? p.datasource?.uid }))), ...j.annotations.list.filter((a) => a.target).map((a) => ({ f, q: a.target.query, ds: a.datasource?.uid }))]);
check('대시보드 5종 (개요 · 건강도·RUL · 가공기 · 센서 · Zone 운영 분석) · uid 고정 · 홈 mf-overview', dash.map((d) => d.j.uid).sort().join() === 'mf-health,mf-machine,mf-overview,mf-sensors,mf-zone');
const zd = dash.find((d) => d.j.uid === 'mf-zone').j;
check('Zone 운영 분석 — OEE·A·P·Q · 진행률 · 손실/NG 파레토 · I-MR 관리도 · 산점도 · Zone/x/y 변수', ['stat', 'gauge', 'barchart', 'xychart', 'timeseries'].every((t) => zd.panels.some((p) => p.type === t)) && zd.panels.filter((p) => p.type === 'barchart').length === 2 && zd.templating.list.map((v) => v.name).join() === 'zone,yvar,xvar' && zd.panels.some((p) => /2\.66 \* m/.test(p.targets[0].query)));
check('모든 질의가 mf-influx 데이터 원본 · raw/agg_1m 버킷만', queries.length > 20 && queries.every((x) => x.ds === 'mf-influx' && [...x.q.matchAll(/bucket: "(\w+)"/g)].every((m) => ['raw', 'agg_1m'].includes(m[1]))), `${queries.length}개 질의`);
const bad = queries.flatMap((x) => { const meas = [...x.q.matchAll(/_measurement == "(\w+)"/g)].map((m) => m[1]); return [...x.q.matchAll(/_field == "(\w+)"/g)].filter((m) => !meas.some((ms_) => fieldsOf[ms_]?.has(m[1]))).map((m) => `${x.f}:${m[1]}`); });
check('질의가 읽는 측정·필드가 모두 Telegraf가 실제로 쓰는 것', bad.length === 0, bad.join(' '));
const prov = fs.readFileSync(path.join(MON, 'grafana/provisioning/datasources/influxdb.yml'), 'utf8'), cmp = fs.readFileSync(path.join(MON, 'compose.yml'), 'utf8');
check('데이터 원본 uid mf-influx · Flux · 토큰은 환경 변수로 (파일에 비밀 없음)', /uid: mf-influx/.test(prov) && /Flux/.test(prov) && /\$\{?MF_INFLUX_TOKEN/.test(prov) && !/token: [A-Za-z0-9_-]{20,}/.test(prov));
check('compose — 포트는 127.0.0.1에만 · host.docker.internal → host-gateway · 이미지 버전 고정', [...cmp.matchAll(/- "?([\d.]+):\$?\{?\w*:?-?\d*\}?:\d+/g)].every((m) => m[1] === '127.0.0.1') && /127\.0\.0\.1:/.test(cmp) && /host\.docker\.internal:host-gateway/.test(cmp) && [...cmp.matchAll(/image: (\S+)/g)].every((m) => /:\d/.test(m[1]) && !/:latest/.test(m[1])));
const init = fs.readFileSync(path.join(MON, 'influxdb/init/10-downsample.sh'), 'utf8');
check('보관 — raw 7일(compose) · agg_1m 90일 · 1분 평균 작업', /DOCKER_INFLUXDB_INIT_RETENTION[=:]\s*"?7d/.test(cmp) && /agg_1m/.test(init) && /90d|2160h|7776000/.test(init) && /every: 1m/.test(init));

console.log('== 켜기·끄기 API (가짜 Docker)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-mon-')), dir = path.join(tmp, 'data'), log = path.join(tmp, 'docker.log');
const fake = path.join(tmp, 'docker'), engine = path.join(tmp, 'engine-up'), fakeColima = path.join(tmp, 'colima');
fs.writeFileSync(engine, '');   // 엔진 켜짐 (뒤에서 끄고 Colima 자동 켜기를 본다)
fs.writeFileSync(fake, `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in\n  --version) echo "Docker version 99.0.0";;\n  "compose version --short") echo "2.99.0";;\n  "info --format {{.ServerVersion}}") [ -f "${engine}" ] || exit 1; echo "99.0.0";;\n  *" ps --format json") echo '{"Service":"grafana","State":"running","Status":"Up"}';;\nesac\nexit 0\n`, { mode: 0o755 });
fs.writeFileSync(fakeColima, `#!/bin/sh\necho "colima $*" >> "${log}"\n[ "$1" = start ] && : > "${engine}"\nexit 0\n`, { mode: 0o755 });
process.env.DOCKER_BIN = fake; process.env.COLIMA_BIN = fakeColima;
const { makeMonitorApi } = await import('../server/monitor-api.mjs');
let influxAuth = 401;   // 첫 켜기: 기존 저장 공간과 토큰이 어긋난 상황 (.env 분실) → 데이터를 지우지 않고 멈춰야 함
const fetchImpl = async (u, o = {}) => {
  if (/\/api\/health$|\/health$/.test(u)) return { ok: true, status: 200 };
  if (/\/api\/v2\/buckets/.test(u)) return { ok: influxAuth === 200, status: influxAuth };
  if (/\/api\/v2\/query/.test(u)) return { ok: true, status: 200, text: async () => '#datatype,string,long,string,long\n,result,table,_measurement,_value\n,_result,0,equipment,120\n,_result,1,event,3\n' };
  return { ok: false, status: 404 };
};
const api = makeMonitorApi({ dir, src: MON, mqttPort: () => 1999, fetchImpl });
const waitJob = async () => { for (let k = 0; k < 200 && api._rt.job?.running; k++) await new Promise((r) => setTimeout(r, 20)); return api._rt.job; };
const r1 = await api.route('POST', '/api/monitor/v1/start'); const j1 = await waitJob();
const calls = () => fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('compose -p')).map((l) => l.replace(/^compose -p metafactory-mon --env-file \.env -f compose\.yml /, ''));
check('켜기 202 · 구성 복사(compose · telegraf · 대시보드 · 초기화 스크립트 실행 권한)', r1.code === 202 && fs.existsSync(path.join(dir, 'compose.yml')) && fs.existsSync(path.join(dir, 'grafana/dashboards/mf-machine.json')) && (fs.statSync(path.join(dir, 'influxdb/init/10-downsample.sh')).mode & 0o111) !== 0, j1.error ?? j1.step);
check('토큰 401 → 실패로 멈춤 · 데이터 볼륨 삭제(down -v) 없음 · 안내 문구 (Codex 검수 1)', j1.ok === false && j1.authMismatch === true && /지우지 않고/.test(j1.error) && calls().join(' | ') === 'up -d | restart telegraf grafana', calls().join(' | '));
fs.writeFileSync(log, '');
const rx = await api.route('POST', '/api/monitor/v1/reset');
check('데이터 초기화 — 확인값 없으면 400 · 아무 명령도 안 보냄', rx.code === 400 && rx.body.ok === false && calls().length === 0);
influxAuth = 200;   // 볼륨을 지우고 새로 켜면 지금 .env 토큰으로 초기화된다
const rr = await api.route('POST', '/api/monitor/v1/reset', new URLSearchParams({ confirm: 'metafactory-mon' })); const jr = await waitJob();
check('데이터 초기화 — 확인값 있으면 down -v → up -d → restart → 완료 · 초기화 표시', rr.code === 202 && jr.ok === true && jr.reset === true && calls().join(' | ') === 'down -v | up -d | restart telegraf grafana', calls().join(' | '));
const env1 = fs.readFileSync(path.join(dir, '.env'), 'utf8'), tok1 = env1.match(/MF_INFLUX_TOKEN=(.*)/)[1];
check('.env — 무작위 토큰·비밀번호 · 브로커 포트 반영 · 권한 600', tok1.length >= 40 && /MF_MQTT_PORT=1999/.test(env1) && /MF_GRAFANA_PASSWORD=\S{15,}/.test(env1) && (os.platform() === 'win32' || (fs.statSync(path.join(dir, '.env')).mode & 0o777) === 0o600));
fs.writeFileSync(log, '');
await api.route('POST', '/api/monitor/v1/start'); const j2 = await waitJob();
check('다시 켜기 — 토큰 유지 · 토큰 맞으면 초기화 안 함', j2.ok && !j2.reset && fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/MF_INFLUX_TOKEN=(.*)/)[1] === tok1 && calls().join(' | ') === 'up -d | restart telegraf grafana');
const st = (await api.route('GET', '/api/monitor/v1/status')).body;
check('상태 — Docker · 컨테이너 · Grafana/InfluxDB 응답 · 최근 1분 건수(측정별) · 주소', st.docker?.compose === '2.99.0' && st.containers[0]?.service === 'grafana' && st.grafana && st.influx && st.counts?.equipment === 120 && st.counts?.event === 3 && st.url === 'http://127.0.0.1:3300/', JSON.stringify(st.counts));
check('상태 응답·작업 기록에 토큰·비밀번호 없음', !JSON.stringify(st).includes(tok1) && !JSON.stringify(st).includes(env1.match(/MF_GRAFANA_PASSWORD=(.*)/)[1]));
fs.writeFileSync(log, ''); fs.rmSync(engine);
await api.route('POST', '/api/monitor/v1/start'); const j3 = await waitJob();
check('엔진 꺼짐 + Colima 설치 → colima start로 켠 뒤 계속 진행', j3.ok && j3.colimaStarted === true && fs.readFileSync(log, 'utf8').split('\n').filter((l) => /^colima start$|^compose -p /.test(l)).map((l) => l.replace(/^compose -p metafactory-mon --env-file \.env -f compose\.yml /, '')).join(' | ') === 'colima start | up -d | restart telegraf grafana', j3.error ?? j3.step);
fs.writeFileSync(log, '');
const sp = await api.route('POST', '/api/monitor/v1/stop');
check('끄기 — compose stop (데이터 남김 · down 아님)', sp.body.ok && calls().join() === 'stop');
check('모르는 경로는 null (다른 API로 넘김)', (await api.route('GET', '/api/monitor/v1/nope')) === null);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
