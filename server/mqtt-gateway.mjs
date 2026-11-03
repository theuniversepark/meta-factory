// MQTT 게이트웨이 — 내장 MQTT 브로커(aedes)로 OPC UA PubSub(JSON) · UNS 메시지를 발행한다.
// 브라우저(시뮬레이션)가 만든 메시지를 /api/mqtt/publish로 받아 브로커에 그대로 싣는다.
//   MQTT_HOST (기본 127.0.0.1) · MQTT_PORT (기본 1885 — 3d 원본의 1883과 겹치지 않게) — 외부 PC에서 받으려면 MQTT_HOST=0.0.0.0
//   외부 브로커 브리지 — 앱 UNS 탭 「MQTT 5 브로커 연결」(데이터 폴더 uns/bridge.json · 비밀번호는 키체인·DPAPI 암호화)에서 켜고 끈다.
//     환경변수 MQTT_BRIDGE_URL · MQTT_BRIDGE_VERSION(기본 5) · MQTT_BRIDGE_USER · MQTT_BRIDGE_PASSWORD가 있으면 그것이 우선(화면에서는 바꿀 수 없음)
//     MQTT 5 브리지에서는 메시지의 props를 MQTT 5 속성으로 싣는다 — Response Topic · Correlation Data · Message Expiry · Content Type · User Property
//     (내장 aedes 1.2는 MQTT 3.1.1만 받는다 — 같은 정보가 본문 필드 correlationId · responseTopic · expirySec 로도 들어 있다)
// UNS 계층별 접근 권한(ACL): server/uns-acl.mjs — 읽기는 모두, 쓰기는 역할·존별 · UNS_ACL=off로 끔 · UNS_ACL_ANON=observer|none
// Sparkplug B: server/sparkplug-edge.mjs — 설비 요약을 존별 엣지 노드가 Sparkplug로 내보내고 주 호스트가 ISA-95 트리로 옮긴다 · UNS_SPARKPLUG=off로 끔
// 외부 명령 요청: camtic/metafactory/{존}/{셀|_zone}/cmd/request (operator · zone 계정) → 대기열 → 화면이 /api/uns/commands/take로 가져가 FacOS 명령 경로로 실행
import net from 'node:net';
import { Aedes } from 'aedes';
import { makeAcl } from './uns-acl.mjs';
import { makeSparkplug } from './sparkplug-edge.mjs';
import { configFile } from './secrets.mjs';

let broker = null, tcp = null, bridge = null, unsTimer = null, acl = null, sp = null, bridgeConf = null;
const state = { listening: false, host: null, port: null, error: null, clients: 0, published: 0, bytes: 0, bridgeUrl: null, bridgeConnected: false, bridgeError: null, bridgeVersion: null, bridgeSource: null, bridgePublished: 0, bridgeReceived: 0, bridgeSince: null, startedAt: null };
// UNS (js/uns.js) 생존 관리 — 화면(시뮬레이션)은 MQTT 클라이언트가 아니라 HTTP로 발행하므로 LWT를 걸 수 없다.
// 게이트웨이가 대신 마지막 발행 시각을 보고, UNS_DEAD_S초 동안 UNS 발행이 없으면 _facos/state를 online:false(retain)로 바꾼다 (Sparkplug NDEATH · MQTT LWT와 같은 뜻).
// 다시 발행이 오면 rebirth 요청을 응답 상태에 실어, 화면이 모든 retain 상태(_meta · state · order)를 다시 발행하게 한다.
export const UNS_ROOT = 'camtic/metafactory';
const UNS_DEAD_S = Number(process.env.UNS_DEAD_S) || 15;
const uns = { root: UNS_ROOT, alive: false, lastAt: 0, deaths: 0, rebirth: true, births: 0 };   // 시작 직후는 retain 저장소가 비어 있다 — 화면이 아직 탄생 메시지를 보내지 않았으면 rebirth
// 외부 명령 요청 대기열
const CMD_REQ = /^camtic\/metafactory\/([\w.-]+)\/([\w.-]+)\/cmd\/request$/;
const RESERVED = ['camtic/metafactory/', 'spBv1.0/', 'metafactory/', 'opcua/', 'aas/', '$'];
const cmdq = { queue: [], received: 0, rejected: 0, taken: 0, expired: 0, last: null };
// UNS 메시지를 받아 볼 곳 (server/facos-store.mjs — FacOS 기록 서버 저장)
let unsTap = null;
export function setUnsTap(fn) { unsTap = fn; }
const tapUns = (m) => { if (unsTap && m.topic.startsWith(`${UNS_ROOT}/`)) { try { unsTap(m.topic, m.payload); } catch { /* 저장 실패가 발행을 막지 않게 */ } } };
const CMD_MAX = 100;

export async function startMqtt({ host = process.env.MQTT_HOST || '127.0.0.1', port = Number(process.env.MQTT_PORT) || 1885, bridgeUrl = process.env.MQTT_BRIDGE_URL, aclFile = null, bridgeFile = null, sparkplug = process.env.UNS_SPARKPLUG !== 'off' } = {}) {
  if (broker) return state;
  acl = makeAcl({ file: aclFile });
  broker = await Aedes.createBroker(acl.hooks());
  const authPub = broker.authorizePublish;
  broker.authorizePublish = (client, packet, cb) => authPub(client, packet, (err) => { if (!err && client) onClientPublish(client, packet); cb(err); });
  broker.on('client', () => { state.clients = broker.connectedClients; });
  broker.on('clientDisconnect', () => { state.clients = broker.connectedClients; });
  tcp = net.createServer(broker.handle);
  await new Promise((resolve) => {
    tcp.once('error', (err) => {
      state.error = err.code === 'EADDRINUSE' ? `포트 ${port}이(가) 이미 사용 중입니다 (다른 피지컬AI 실증 메타팩토리 앱이나 브로커가 실행 중일 수 있음)` : err.message;
      // 포트가 막혀도 앱 안의 구독자(센서 서버)는 이 브로커에 붙어야 한다 — 127.0.0.1의 빈 포트로 다시 연다 (외부 클라이언트는 표시된 포트로 접속)
      if (err.code !== 'EADDRINUSE') return resolve();
      tcp = net.createServer(broker.handle);
      tcp.once('error', () => resolve());
      tcp.listen(0, '127.0.0.1', () => { Object.assign(state, { listening: true, host: '127.0.0.1', port: tcp.address().port, fallback: true, startedAt: new Date().toISOString() }); state.error += ` — 빈 포트 ${tcp.address().port}로 대신 열었습니다`; resolve(); });
    });
    tcp.listen(port, host, () => { Object.assign(state, { listening: true, host, port, startedAt: new Date().toISOString() }); resolve(); });
  });
  if (bridgeUrl) { state.bridgeSource = 'env'; await connectBridge({ url: bridgeUrl, version: Number(process.env.MQTT_BRIDGE_VERSION) || 5, username: process.env.MQTT_BRIDGE_USER ?? '', password: process.env.MQTT_BRIDGE_PASSWORD ?? '' }); }
  else if (bridgeFile) {
    bridgeConf = configFile(bridgeFile, { url: '', username: '', password: '', version: 5, enabled: false }, ['password']);
    state.bridgeSource = 'app';
    if (bridgeConf.cfg.enabled && bridgeConf.cfg.url) await connectBridge(bridgeConf.cfg);
  }
  if (sparkplug && state.listening) {
    sp = makeSparkplug({ url: () => `mqtt://127.0.0.1:${state.port}`, creds: (role, id) => acl.mint(role, id, { group: 'metafactory' }), uns: (msgs) => { for (const m of msgs) publishOne(m); } });
  }
  if (!unsTimer) { unsTimer = setInterval(unsWatch, 2000); unsTimer.unref?.(); }
  return state;
}
// ── 외부 브로커 브리지 (MQTT 5 기본) ─────────────────
async function connectBridge({ url, version = 5, username = '', password = '' }) {
  if (bridge) { const b = bridge; bridge = null; b.removeAllListeners('close'); b.end(true); }
  Object.assign(state, { bridgeUrl: url.replace(/\/\/[^@/]*@/, '//***@'), bridgeVersion: Number(version) === 4 ? 4 : 5, bridgeConnected: false, bridgeError: null, bridgeSince: null });   // 자격 증명은 상태에 노출하지 않는다
  try {
    const { connect } = await import('mqtt');
    const b = connect(url, { clientId: `metafactory-bridge-${process.pid}`, reconnectPeriod: 5000, connectTimeout: 8000, protocolVersion: state.bridgeVersion, ...(username ? { username, password } : {}) });
    bridge = b;
    b.on('connect', () => { if (bridge !== b) return; Object.assign(state, { bridgeConnected: true, bridgeError: null, bridgeSince: new Date().toISOString() }); b.subscribe(`${UNS_ROOT}/+/+/cmd/request`); });
    b.on('close', () => { if (bridge === b) state.bridgeConnected = false; });
    b.on('error', (e) => { if (bridge === b) state.bridgeError = e.code === 'ECONNREFUSED' ? `연결 거부 — ${state.bridgeUrl}에 브로커가 떠 있는지 확인` : /Bad username|Not authorized/i.test(e.message) ? '계정 또는 비밀번호 오류' : /Unsupported protocol|protocol version/i.test(e.message) ? 'MQTT 5를 받지 않는 브로커 — 버전을 3.1.1로' : e.message; });
    // 외부 브로커로 들어온 명령 요청 — 외부 브로커가 권한을 확인했다고 본다(그쪽 ACL) · MQTT 5 속성에서 상관 ID · 응답 토픽 · 만료를 읽는다
    b.on('message', (topic, payload, packet) => { state.bridgeReceived++; enqueueCmd(topic, payload, { from: 'bridge', via: 'bridge', props: packet?.properties ?? null }); });
  } catch (e) { state.bridgeError = e.message; }
}
function disconnectBridge() { if (bridge) { const b = bridge; bridge = null; b.end(true); } Object.assign(state, { bridgeConnected: false, bridgeError: null, bridgeUrl: null, bridgeSince: null }); }
// 화면 설정 — 비밀번호는 저장 여부만 돌려준다
export function unsBridgeConfig() {
  const c = bridgeConf?.cfg;
  return { source: state.bridgeSource, editable: state.bridgeSource === 'app', url: state.bridgeSource === 'env' ? state.bridgeUrl : c?.url ?? '', username: c?.username ?? '', password: !!c?.password, version: c?.version ?? state.bridgeVersion ?? 5, enabled: state.bridgeSource === 'env' ? true : !!c?.enabled,
    connected: state.bridgeConnected, error: state.bridgeError, since: state.bridgeSince, published: state.bridgePublished, received: state.bridgeReceived, embedded: { host: state.host, port: state.port } };
}
export async function unsBridgeSave(b = {}) {
  if (state.bridgeSource !== 'app' || !bridgeConf) return { code: 409, body: { error: state.bridgeSource === 'env' ? '환경변수 MQTT_BRIDGE_URL로 설정되어 있어 화면에서 바꿀 수 없습니다' : '브리지 설정 파일 없음' } };
  const c = bridgeConf.cfg;
  if (b.url != null) {
    const u = String(b.url).trim();
    if (u && !/^(mqtts?|wss?):\/\/[^\s/]+/.test(u)) return { code: 400, body: { error: 'mqtt:// · mqtts:// · ws:// · wss:// 주소를 넣으세요 (예: mqtt://127.0.0.1:1883)' } };
    try { if (u) { const x = new URL(u), p = Number(x.port || (x.protocol === 'mqtts:' ? 8883 : 1883)); if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(x.hostname) && p === state.port) return { code: 400, body: { error: `앱 내장 브로커(포트 ${state.port}) 자신에는 연결할 수 없습니다 — 메시지가 되돌아옵니다` } }; } } catch { return { code: 400, body: { error: '주소 형식 오류' } }; }
    if (u !== c.url) { c.url = u; if (!b.password) bridgeConf.forget('password'); }   // 주소를 바꾸면 저장한 비밀번호는 버린다
  }
  if (b.username != null) c.username = String(b.username).trim().slice(0, 120);
  if (b.password) c.password = String(b.password).slice(0, 200);
  if (b.clearPassword) bridgeConf.forget('password');
  if (b.version != null) c.version = Number(b.version) === 4 ? 4 : 5;
  if (b.enabled != null) c.enabled = !!b.enabled;
  if (c.enabled && !c.url) return { code: 400, body: { error: '주소를 넣어야 켤 수 있습니다' } };
  bridgeConf.save();
  if (c.enabled) await connectBridge(c); else disconnectBridge();
  return { code: 200, body: unsBridgeConfig() };
}

export async function stopMqtt() {
  sp?.stop(); sp = null; clearInterval(unsTimer); unsTimer = null;
  bridge?.end(true); bridge = null;
  await new Promise((r) => (broker ? broker.close(() => r()) : r())); broker = null;
  await new Promise((r) => (tcp ? tcp.close(() => r()) : r())); tcp = null;
  Object.assign(state, { listening: false });
}
function unsWatch() {
  pruneExpired();
  if (!uns.alive || Date.now() - uns.lastAt < UNS_DEAD_S * 1000) return;
  uns.alive = false; uns.deaths++; uns.rebirth = true;
  const death = { topic: `${UNS_ROOT}/_facos/state`, payload: JSON.stringify({ online: false, reason: `UNS 발행 ${UNS_DEAD_S}초 없음 (게이트웨이 죽음 처리)`, ts: new Date().toISOString() }), retain: true };
  publishOne(death); tapUns(death);
  sp?.pause();   // 원천이 끊겼으니 Sparkplug 엣지도 NDEATH 후 종료 — 데이터가 다시 오면 새 bdSeq로 탄생
}

export const mqttStatus = () => ({ ...state, uns: { ...uns }, acl: acl?.status() ?? null, sparkplug: sp?.status() ?? null, commands: { pending: cmdq.queue.length, received: cmdq.received, rejected: cmdq.rejected, taken: cmdq.taken, expired: cmdq.expired, last: cmdq.last } });
export const unsAclPassword = (name) => acl?.password(name) ?? null;

// messages: [{ topic, payload(문자열), retain, props? }]
export function mqttPublish(messages) {
  if (!broker) return 0;
  let n = 0;
  for (const m of messages) {
    if (typeof m?.topic !== 'string' || typeof m?.payload !== 'string' || !m.topic || m.topic.length > 512) continue;
    if (m.topic.startsWith(`${UNS_ROOT}/`)) {
      uns.lastAt = Date.now(); uns.alive = true;
      if (m.topic === `${UNS_ROOT}/_meta/namespace`) { uns.rebirth = false; uns.births++; }   // 탄생 메시지 = rebirth 끝
    }
    // 설비 요약(평면 토픽) → Sparkplug 엣지 노드 (존 = 엣지 · 셀 = 디바이스)
    if (sp) { const x = /^metafactory\/telemetry\/v1\/([\w.-]+)\/([\w.-]+)$/.exec(m.topic); if (x) { try { sp.ingest(x[1], x[2], JSON.parse(m.payload)); } catch { /* 형식 오류 무시 */ } } }
    publishOne(m); tapUns(m); n++;
  }
  return n;
}
// MQTT 5 속성 (브리지 전용) — UNS JSON에는 Content Type 기본
function v5props(m) {
  const p = m.props ?? {}, o = {};
  if (m.topic.startsWith(`${UNS_ROOT}/`) || p.contentType) o.contentType = p.contentType ?? 'application/json';
  if (p.responseTopic) o.responseTopic = p.responseTopic;
  if (p.correlationData != null) o.correlationData = Buffer.from(String(p.correlationData), 'utf8');
  if (p.messageExpiryInterval > 0) o.messageExpiryInterval = Math.round(p.messageExpiryInterval);
  if (p.userProperties) o.userProperties = Object.fromEntries(Object.entries(p.userProperties).map(([k, v]) => [k, String(v)]));
  return Object.keys(o).length ? o : undefined;
}
function publishOne(m) {
  const payload = Buffer.isBuffer(m.payload) ? m.payload : Buffer.from(m.payload, 'utf8');
  // aedes 1.2는 retain 발행을 저장만 하고 이미 구독 중인 클라이언트에는 보내지 않는다 (MQTT 3.1.1 §3.3.1.3 위반).
  // retain 메시지는 저장소에 직접 넣고(새 구독자용), 같은 내용을 일반 메시지로 발행한다(기존 구독자용).
  if (m.retain) broker.persistence.storeRetained({ cmd: 'publish', topic: m.topic, payload, qos: 0, retain: true, dup: false, brokerId: broker.id, brokerCounter: 0 }).catch(() => {});
  broker.publish({ cmd: 'publish', topic: m.topic, payload, qos: 0, retain: false, dup: false }, () => {});
  if (bridge?.connected) { bridge.publish(m.topic, payload, { qos: 0, retain: !!m.retain, ...(state.bridgeVersion === 5 ? { properties: v5props(m) } : {}) }); state.bridgePublished++; }
  state.published++; state.bytes += payload.length;
}

// ── 외부 명령 요청 ─────────────────
function onClientPublish(client, packet) {
  if (CMD_REQ.test(packet.topic)) enqueueCmd(packet.topic, packet.payload, { from: client.uns?.name ?? client.id, role: client.uns?.role ?? null, via: 'embedded' });
}
function rejectCmd(base, corr, reason, resp) {
  cmdq.rejected++; cmdq.last = { at: new Date().toISOString(), result: 'rejected', reason, correlationId: corr };
  const body = JSON.stringify({ correlationId: corr, state: 'rejected', result: 'rejected', reason, ts: new Date().toISOString() });
  publishOne({ topic: `${base}/cmd/done`, payload: body, props: { correlationData: corr } });
  if (resp) publishOne({ topic: resp, payload: body, props: { correlationData: corr } });
}
const safeResp = (t) => typeof t === 'string' && t.length > 0 && t.length <= 200 && !/[+#]/.test(t) && !RESERVED.some((r) => t.startsWith(r));
function enqueueCmd(topic, payload, { from, role = null, via, props = null }) {
  const x = CMD_REQ.exec(topic); if (!x) return;
  const base = `${UNS_ROOT}/${x[1]}/${x[2]}`;
  cmdq.received++;
  let b; try { b = JSON.parse(Buffer.from(payload).toString('utf8')); } catch { return rejectCmd(base, null, '본문이 JSON이 아님', null); }
  const corr = String(props?.correlationData ? Buffer.from(props.correlationData).toString('utf8') : (b.correlationId ?? `EXT-${cmdq.received}`)).slice(0, 80);
  const resp = props?.responseTopic ?? b.responseTopic ?? null;
  if (resp != null && !safeResp(resp)) return rejectCmd(base, corr, `응답 토픽 사용 불가 (${String(resp).slice(0, 60)}) — 와일드카드·UNS·Sparkplug 예약 영역 금지`, null);
  if (typeof b.code !== 'string') return rejectCmd(base, corr, '명령 코드(code) 없음', resp);
  const expirySec = Math.min(300, Math.max(1, Number(props?.messageExpiryInterval ?? b.expirySec) || 30));
  if (cmdq.queue.length >= CMD_MAX) return rejectCmd(base, corr, '명령 대기열이 가득 참', resp);
  cmdq.queue.push({ zone: x[1], cell: x[2], code: b.code, arg: b.arg ?? null, reason: String(b.reason ?? '').slice(0, 200), correlationId: corr, responseTopic: resp, from, role, via, receivedAt: Date.now(), expirySec });
}
function pruneExpired() {
  const now = Date.now(), keep = [];
  for (const q of cmdq.queue) {
    if (now - q.receivedAt > q.expirySec * 1000) { cmdq.expired++; rejectCmd(`${UNS_ROOT}/${q.zone}/${q.cell}`, q.correlationId, `만료 (${q.expirySec}초 안에 FacOS가 받지 못함 — 시뮬레이션이 실행 중인지 확인)`, q.responseTopic); }
    else keep.push(q);
  }
  cmdq.queue = keep;
}
// 화면이 가져간다 (2초마다) — 가져간 뒤의 실행·거부는 화면(FacOS)이 UNS 명령 4단으로 발행
export function unsTakeCommands() { pruneExpired(); const q = cmdq.queue.splice(0); cmdq.taken += q.length; return q; }
export const _sparkplug = () => sp;   // 시험용
