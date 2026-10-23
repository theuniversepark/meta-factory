// 마무리 리뷰(2026-10-23) 수정 확인 — 루프백 Host · RCA 실행 구분 · 비교 간격 · 대기열/이벤트 파일 복구 · EPCIS 처리 중 작업 · AIOS 재시도 · 센서 경보 복원 · 보간 비율 0 · 실행 ID
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { rejectReason, isLoopbackHost } from '../server/http-guard.mjs';
import { StepInterp } from '../js/stepinterp.js';
import { makeErpBridge } from '../server/erpnext-bridge.mjs';
import { makeEpcisApi } from '../server/epcis-api.mjs';
import { RcaCore } from '../js/rcacore.js';
import { DataHub } from '../js/datahub.js';
import { Simulation, SIM_DT } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { compareMode } from '../js/compare.js';
import { UI } from '../js/ui.js';
import { buildAiosZip } from '../js/aios.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-finalfix-'));

console.log('== 루프백 Host — 실제 127.x IPv4만');
{
  const req = (host) => rejectReason({ headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' } });
  check('127.attacker.example 거부', req('127.attacker.example:47625') !== null);
  check('127.0.0.1 · 127.1.2.3 · localhost · [::1] 허용', [req('127.0.0.1:47625'), req('127.1.2.3:47625'), req('localhost:47625'), req('[::1]:47625')].every((x) => x === null));
  check('127.0.0.1.nip.io 거부 · 서버 주소 판정도 같음', req('127.0.0.1.nip.io:47625') !== null && !isLoopbackHost('127.evil.example') && isLoopbackHost('127.0.0.1'));
}

console.log('== RCA — 같은 사례 번호라도 실행이 다르면 새 티켓');
{
  const core = new RcaCore(), day = '2026-10-23T00:00:00Z';
  const rep = (runId, serial) => ({ runId, caseId: 'NG-261023-0001', serial, detectedAt: 'DT_FAST', inspection: { result: 'NG' } });
  const a = core.receive(rep('run-A', 'S-A'), day), a2 = core.receive(rep('run-A', 'S-A'), day), b = core.receive(rep('run-B', 'S-B'), day);
  check('같은 실행 재전송 → 같은 티켓 (200)', a2.code === 200 && a2.body.ticket === a.body.ticket);
  check('다른 실행 → 새 티켓 (202) · 제품 식별자 보존', b.code === 202 && b.body.ticket !== a.body.ticket && core.reports.get(b.body.ticket).report.serial === 'S-B', `${a.body.ticket} / ${b.body.ticket}`);
}

console.log('== 실행 ID — 같은 초에 두 번 시작해도 다름 · 저장 ID 형식 안');
{
  const s = new Simulation('smart', 1, { quiet: true }), H = new DataHub();
  H.reset(s, null); const x = H.runId; H.reset(s, null); const y = H.runId;
  check('연속 reset의 실행 ID가 다름', x !== y, `${x} / ${y}`);
  check('서버 저장 ID 규칙(64자 · 영숫자_.-) 안', [x, `${y}_robotcam_0001`].every((v) => /^[A-Za-z0-9_.-]{1,64}$/.test(v)));
}

console.log('== 3단계 비교 — 화면과 같은 0.1초 간격');
{
  const line = undefined, r = await compareMode('smart', 20261001, line, 0.5);
  const s = new Simulation('smart', 20261001, { quiet: true }), ag = new FactoryAgent(s);
  for (let i = 0; i < Math.round(1800 / SIM_DT); i++) { s.step(SIM_DT); ag.update(SIM_DT); }
  const k = s.kpi();
  check('비교 계산 = 0.1초 간격 직접 운전 (양품 · OEE · 의사결정)', r.k.good === k.good && r.k.OEE === k.OEE && r.decisions === ag.decisions, `양품 ${r.k.good} / ${k.good}`);
  check('화면 루프 간격 상수 0.1초', SIM_DT === 0.1);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  check('ui.js에 0.25초 간격 계산이 남아 있지 않음', !/step\(0\.25\)/.test(ui));
}

console.log('== ERPNext 대기열 — 끝 줄이 깨져도 정상 줄 복구');
{
  const dir = path.join(tmp, 'erp'); fs.mkdirSync(dir);
  const good = (k) => JSON.stringify({ run: 'run-A', e: { type: 'po.create', key: k, lines: [] } });
  fs.writeFileSync(path.join(dir, 'queue.jsonl'), `${good('PO-1')}\n{broken\n${good('PO-2')}\n{"run":`);
  const erp = makeErpBridge({ dir, interval: 1e9 }), st = erp.status(); erp.close();
  check('정상 2줄 + 깨진 중간 줄 자리 = 대기 3건', st.queued === 3, `queued ${st.queued}`);
  check('복구 내용을 상태에 알림', st.recovery?.bad === 1 && !!st.recovery?.torn && /복구/.test(st.lastError ?? ''), st.lastError ?? '');
  const text = fs.readFileSync(path.join(dir, 'queue.jsonl'), 'utf8');
  check('끝 조각을 잘라 줄 경계 맞춤 · 조각은 따로 보관', text.endsWith('\n') && !text.includes('{"run":\n') && fs.existsSync(st.recovery.torn));
  const tmpLeft = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  check('임시 파일이 남지 않음', tmpLeft.length === 0);
}

console.log('== EPCIS 이벤트 파일 — 끝 조각 뒤에 붙은 새 이벤트도 다음 재시작에 남음');
{
  const dir = path.join(tmp, 'epcis'); fs.mkdirSync(dir);
  const event = (id) => ({ type: 'ObjectEvent', eventID: `urn:uuid:${id}`, eventTime: '2026-10-23T00:00:00Z', eventTimeZoneOffset: '+09:00', epcList: ['urn:epc:id:sgtin:8800000.000001.DT-261023-000001'], action: 'OBSERVE', bizStep: 'storing' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ...event('before-crash'), _seq: 1 }) + '\n{"type":');
  const api = makeEpcisApi({ dir, interval: 1e9 });
  const rec = api.status().recovery;
  await api.route('POST', '/api/epcis/v1/capture', new URLSearchParams(), JSON.stringify([event('after-restart')]));
  api.close(); await new Promise((r) => setTimeout(r, 100));
  const next = makeEpcisApi({ dir, interval: 1e9 }), ids = next.store.events.map((e) => e.eventID); next.close();
  check('재시작 뒤 두 이벤트 모두 있음', ids.includes('urn:uuid:before-crash') && ids.includes('urn:uuid:after-restart'), ids.join(', '));
  check('복구 내용을 상태에 알림', !!rec?.torn);
}

console.log('== EPCIS 외부 전송 — 처리 중인 작업은 끝날 때까지 확정하지 않음');
{
  const dir = path.join(tmp, 'epcis-fw'); fs.mkdirSync(dir);
  let running = true, captures = 0;
  const api = makeEpcisApi({ dir, interval: 1e9, fetchImpl: async (url) => {
    if (url.includes('userExtension')) return new Response('', { status: 404 });
    if (url.endsWith('/capture')) { captures++; return new Response('', { status: 202, headers: { Location: '/capture/job-1' } }); }
    return new Response(JSON.stringify(running ? { running: true } : { running: false, success: true, captureID: 'job-1', errors: [] }), { status: 200 });
  } });
  await api.route('POST', '/api/epcis/v1/config', new URLSearchParams(), JSON.stringify({ url: 'https://repository.example', enabled: true }));
  await api.route('POST', '/api/epcis/v1/capture', new URLSearchParams(), JSON.stringify([{ type: 'ObjectEvent', eventID: 'urn:uuid:fw-1', eventTime: '2026-10-23T00:00:00Z', eventTimeZoneOffset: '+09:00', epcList: ['urn:test:unit'], action: 'ADD' }]));
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };   // 조회 대기 시간만 건너뜀
  try {
    await api.pump(); const s1 = api.status().forward;
    check('처리 중 → 보낸 위치 유지 (대기 1 · 보냄 0)', s1.pending === 1 && s1.sent === 0 && !!s1.processing, s1.lastError ?? '');
    running = false;
    const realNow = Date.now; Date.now = () => realNow() + 2e9;   // 다음 주기 (처리 중 확인 간격이 지남)
    try { await api.pump(); await api.pump(); } finally { Date.now = realNow; }
    const s2 = api.status().forward;
    check('다음 주기에 같은 작업이 끝남 확인 → 확정 (다시 보내지 않음)', s2.pending === 0 && s2.sent === 1 && captures === 1 && s2.lastJob?.success === true, `capture ${captures}회`);
  } finally { globalThis.setTimeout = realTimeout; api.close(); }
}

console.log('== AIOS 업로드 — 실패한 묶음은 완료로 치지 않고 다시');
{
  const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const code = source.slice(source.indexOf('function aiosUpload()'), source.indexOf('function renderAios('));
  const c = { id: 'aios_0001', t: 600 }, state = { busy: false, n: 0, bytes: 0, fail: 0, nextAt: 0, lastError: null };
  let calls = 0, ok = false, now = 0;
  const ctx = { sim: { aios: { on: true, chunks: [c], samples: [{ t: 600 }] } }, epRec: { server: true, runId: 'test' }, aiosUp: state, performance: { now: () => now },
    hub: { iso: (t) => String(t) }, AIOS_CHUNK: 60, AIOS_SAMPLE_S: 10, zipStore: () => {}, buildAiosZip: () => new Uint8Array([1]),
    fetch: async () => { calls++; return ok ? { ok: true, status: 200 } : { ok: false, status: 503 }; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const tick = async () => { vm.runInContext('aiosUpload()', ctx); for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  await tick();
  check('503 → 완료 표시 안 함 · 실패 1회', !c.up && state.fail === 1 && state.n === 0);
  await tick(); check('다시 시도 간격 전에는 보내지 않음', calls === 1);
  now = 6000; ok = true; await tick();
  check('간격 뒤 다시 보내 성공 → 완료', calls === 2 && c.up === true && state.n === 1 && state.fail === 0);
}

console.log('== 센서 서버 — 다시 켠 뒤 정상값이 오면 이전 경보 해제');
{
  const source = fs.readFileSync(path.join(root, 'server/sensor-server.mjs'), 'utf8');
  const body = source.slice(source.indexOf('const arg ='), source.indexOf('// ── MQTT 구독')).replaceAll('export function ', 'function ');
  const factory = new Function('fs', 'path', 'DatabaseSync', 'process', 'setInterval', body + '\nreturn { ingest, route, close: () => db.close() };');
  const make = () => factory(fs, path, DatabaseSync, { argv: [], env: { SENSOR_DB: path.join(tmp, 'sensors.db') } }, () => ({ unref() {} }));
  const birth = { zone: 'main', cell: 'C1', cellName: 'cell', edge: 'edge', gateway: 'gw', zoneServer: 'zone', sensors: [{ id: 'S1', type: 'temp', cat: 'env', label: 'Temp', metric: 'temp', unit: 'C', iface: 'wired', rate: 1, x: 0, z: 0, warn: { hi: 5 }, alarm: { hi: 10 } }] };
  const batch = (v, ts) => ({ spec: 'metafactory/sensor-batch/1.0', run: 't', seq: ts, zone: 'main', cell: 'C1', edge: 'edge', gateway: 'gw', zoneServer: 'zone', hops: { edge: ts, gateway: ts, zone: ts, central: ts, ingest: ts }, readings: [{ s: 'S1', m: 'temp', v, u: 'C', ts, e: 0 }] });
  let S = make(); S.ingest('metafactory/sensors/v1/main/C1/birth', JSON.stringify(birth)); S.ingest('metafactory/sensors/v1/main/C1', JSON.stringify(batch(20, 1e6))); S.close();
  S = make(); S.ingest('metafactory/sensors/v1/main/C1', JSON.stringify(batch(1, 2e6)));
  const active = S.route('GET', '/api/sensors/v1/alarms', new URLSearchParams({ active: '1' })).body.alarms; S.close();
  check('활성 경보 0', active.length === 0, `활성 ${active.length}`);
}

console.log('== 화면 보간 — 비율 0 경계에서 뒤로 튀지 않음');
{
  for (const speed of [1, 3, 10]) {
    const I = new StepInterp(), m = { x: 0, z: 0 };
    let acc = 0, last = -Infinity, back = 0;
    for (let f = 0; f < 600; f++) {
      acc += (1 / 60) * speed;
      const n = Math.floor(acc / 0.1 + 1e-9);
      for (let i = 0; i < n; i++) { if (i === n - 1) I.capture([m]); m.x += 0.1; }
      acc = Math.max(0, acc - n * 0.1);
      I.apply([m], acc / 0.1);
      if (m.x < last - 1e-9) back++;
      last = m.x; I.restore();
    }
    check(`60fps · ${speed}배속 600프레임 뒤로 간 프레임 0`, back === 0, `${back}회`);
  }
}


console.log('== EPCIS — 처리 중에 「처음부터 다시」를 눌러도 앞 이벤트를 다시 보냄');
{
  let done = true; const captures = [];
  const api = makeEpcisApi({ dir: path.join(tmp, 'epcis-rewind'), interval: 1e9, fetchImpl: async (url, opts) => {
    if (url.includes('userExtension')) return new Response('', { status: 404 });
    if (url.endsWith('/capture')) { captures.push(JSON.parse(opts.body).epcisBody.eventList.map((e) => e.eventID)); return new Response('', { status: 202, headers: { Location: '/capture/job' } }); }
    return Response.json(done ? { running: false, success: true, errors: [] } : { running: true });
  } });
  const config = (b) => api.route('POST', '/api/epcis/v1/config', new URLSearchParams(), JSON.stringify(b));
  const capture = (id) => api.route('POST', '/api/epcis/v1/capture', new URLSearchParams(), JSON.stringify([{ type: 'ObjectEvent', eventID: `urn:uuid:${id}`, eventTime: '2026-10-23T00:00:00Z', eventTimeZoneOffset: '+09:00', epcList: ['urn:test:unit'], action: 'ADD' }]));
  const realTimeout = globalThis.setTimeout, realNow = Date.now;
  globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
  try {
    await config({ url: 'https://repository.example', enabled: true });
    await capture('history'); await api.pump();
    done = false; await capture('pending'); await api.pump();
    await config({ fromStart: true });
    done = true; Date.now = () => realNow() + 2e9;
    await api.pump(); await api.pump();
    const after = api.status().forward;
    check('처음부터 다시 → 두 이벤트를 다시 보내 대기 0', after.pending === 0 && captures.length === 3 && captures[2].join() === 'urn:uuid:history,urn:uuid:pending', JSON.stringify(captures));
  } finally { globalThis.setTimeout = realTimeout; Date.now = realNow; api.close(); }
}
{
  // 보내는 도중(응답 대기)에 「처음부터 다시」 — 늦게 온 응답이 새 커서를 덮어쓰지 않음
  let release; const gate = new Promise((r) => { release = r; });
  const api = makeEpcisApi({ dir: path.join(tmp, 'epcis-race'), interval: 1e9, fetchImpl: async (url) => {
    if (url.includes('userExtension')) return new Response('', { status: 404 });
    if (url.endsWith('/capture')) { await gate; return new Response('', { status: 200 }); }
    return Response.json({ running: false, success: true });
  } });
  await api.route('POST', '/api/epcis/v1/config', new URLSearchParams(), JSON.stringify({ url: 'https://repository.example', enabled: true }));
  await api.route('POST', '/api/epcis/v1/capture', new URLSearchParams(), JSON.stringify([{ type: 'ObjectEvent', eventID: 'urn:uuid:race', eventTime: '2026-10-23T00:00:00Z', eventTimeZoneOffset: '+09:00', epcList: ['urn:test:unit'], action: 'ADD' }]));
  const p = api.pump(); await new Promise(setImmediate);
  await api.route('POST', '/api/epcis/v1/config', new URLSearchParams(), JSON.stringify({ fromStart: true }));
  release(); await p;
  check('보내는 도중 「처음부터 다시」 → 늦은 응답이 커서를 옮기지 않음', api.status().forward.pending === 1);
  api.close();
}

console.log('== 3단계 비교 — 늦게 끝난 이전 라인이 새 라인 결과를 덮어쓰지 않음');
{
  const workers = [], original = globalThis.Worker, doc = globalThis.document;
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage(m) { this.msg = m; } terminate() {}
    finish() { const n = this.msg.line.name === 'line-A' ? 11 : 22; this.onmessage({ data: { res: { decisions: n, k: { good: n, uph: n, OEE: 0.8, A: 0.9, Q: 0.99, ppm: 0, failures: 0, pm: 0, cal: 0, avgWip: 1, kwhPerUnit: 1, people: 2 } } } }); } };
  const body = { innerHTML: '' };
  globalThis.document = { getElementById: (id) => (id === 'compare' ? { classList: { remove() {} } } : body) };
  try {
    const ui = Object.create(UI.prototype), A = { name: 'line-A', stations: [] }, B = { name: 'line-B', stations: [] };
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
    ui.runCompare(1, A); ui.runCompare(1, B);
    workers.slice(3).forEach((w) => w.finish()); await flush();
    const showB = body.innerHTML.includes('line-B');
    workers.slice(0, 3).forEach((w) => w.finish()); await flush();
    check('B 결과 표시 뒤 A가 끝나도 창은 B 그대로', showB && body.innerHTML.includes('line-B') && !body.innerHTML.includes('line-A'));
    check('라인별 결과 보관 (A·B 모두 캐시)', ui.cachedCompare(1, A)?.smart.k.good === 11 && ui.cachedCompare(1, B)?.smart.k.good === 22 && !ui.comparing(1, A) && !ui.comparing(1, B));
  } finally { globalThis.Worker = original; globalThis.document = doc; }
}

console.log('== AIOS 업로드 — 다시 보낼 때도 처음 만든 본문 · 원본이 없으면 복구 불가');
{
  const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const code = source.slice(source.indexOf('function aiosUpload()'), source.indexOf('function renderAios('));
  const sim = new Simulation('dark', 1, { quiet: true }), P = sim.aios;
  P.on = true; P.chunks = [{ id: 'aios_0001', t: 600 }, { id: 'aios_0002', t: 99999 }];
  P.samples = Array.from({ length: 60 }, (_, i) => ({ t: 10 * (i + 1) }));
  P.transitions = () => [];
  const c = P.chunks[0], sent = [], state = { busy: false, n: 0, bytes: 0, fail: 0, nextAt: 0, lastError: null, lost: 0 };
  let now = 0, ok = false;
  const ctx = { sim, epRec: { server: true, runId: 'run-test' }, aiosUp: state, performance: { now: () => now }, hub: { iso: (t) => String(t) }, AIOS_CHUNK: 60, AIOS_SAMPLE_S: 10, buildAiosZip,
    zipStore: (files) => new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'meta/info.json').data)).samples)),
    fetch: async (u, o) => { sent.push(new TextDecoder().decode(o.body)); return { ok, status: ok ? 200 : 503 }; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
  vm.runInContext('aiosUpload()', ctx); await flush();
  P.samples = [{ t: 22200 }]; now = 6000; ok = true;   // 장애 중 원본이 6시간 보관 범위 밖으로 밀려남
  vm.runInContext('aiosUpload()', ctx); await flush();
  check('재시도 본문 = 처음 본문 (샘플 60개) → 성공 뒤 완료', sent.length === 2 && sent[0] === '60' && sent[1] === '60' && c.up === true && !c.zip, sent.join(' / '));
  check('원본이 이미 없는 묶음은 보내지 않고 복구 불가로 셈', P.chunks[1].lost === true && !P.chunks[1].up && state.lost === 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
