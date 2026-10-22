// 정적 파일 제공 + Claude 에이전트 프록시. CLI(server.mjs)와 맥 앱(electron/main.mjs)이 함께 쓴다.
// API 키는 서버 프로세스에만 두고 브라우저(렌더러)로는 절대 보내지 않는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, MODEL } from './llm-agent.mjs';
import { designLine, designZone } from './line-designer.mjs';
import { startMqtt, mqttStatus, mqttPublish } from './mqtt-gateway.mjs';
import { ffmpegInfo, queueConvert, convertClip, readStoredZip, framesToMp4 } from './video-convert.mjs';
import { facRoute } from './fac-api.mjs';
import { makeRcaApi } from './rca-api.mjs';
import { fork } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = ['index.html', 'css/', 'js/', 'vendor/', 'assets/'];

let client = null;

// VLA 에피소드 저장소 — 맥 앱은 사용자 데이터 폴더(METAFACTORY_DATA_DIR), CLI는 프로젝트의 data/
const DATA_DIR = () => process.env.METAFACTORY_DATA_DIR || path.join(ROOT, 'data');
const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// POST /api/episodes?robot=RB-02-1&id=ep_000012 (본문: 에피소드 zip) → data/episodes/<robot>/<id>.zip
async function saveEpisode(req, res, url) {
  const robot = url.searchParams.get('robot') ?? '', id = url.searchParams.get('id') ?? '';
  if (!SAFE.test(robot) || !SAFE.test(id)) return send(res, 400, { error: 'robot·id 형식 오류' });
  try {
    const buf = await readRaw(req, 8 * 1024 * 1024);
    const dir = path.join(DATA_DIR(), 'episodes', robot);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.zip`), buf);
    const pruned = await pruneEpisodes(robot);
    return send(res, 200, { ok: true, bytes: buf.length, pruned });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
// 에피소드 보관 한도: 로봇마다 최근 500개(METAFACTORY_EPISODE_KEEP), 전체 3GB(METAFACTORY_EPISODE_MAX_MB) — 넘으면 오래된 것부터 지운다
// 로봇별 정리는 저장할 때마다, 전체 용량 정리는 50번 저장마다(파일이 많으면 목록 읽기가 무거워서) 한다
export const EPISODE_KEEP = () => Number(process.env.METAFACTORY_EPISODE_KEEP) || 500;
export const EPISODE_MAX_BYTES = () => (Number(process.env.METAFACTORY_EPISODE_MAX_MB) || 3072) * 1024 * 1024;
let epSaves = 0;
// 파일 정리·목록은 비동기(fs.promises)로 — 맥·윈도우 앱에서는 서버가 창을 관리하는 메인 프로세스 안에서 돌아, 파일 수천 개를 동기로 훑으면 그동안 화면 입력이 멈춘다
// 같은 대상의 정리는 차례로 (겹치면 같은 파일을 두 번 지우거나 개수를 두 번 센다)
const fsp = fs.promises;
const serial = new Map();
const inTurn = (key, fn) => { const p = (serial.get(key) ?? Promise.resolve()).then(fn, fn); serial.set(key, p.catch(() => {})); return p; };
const statA = async (f) => { try { return await fsp.stat(f); } catch { return null; } };
async function zipList(d) {
  let names; try { names = (await fsp.readdir(d)).filter((f) => f.endsWith('.zip')); } catch { return []; }
  return (await Promise.all(names.map(async (f) => { const st = await statA(path.join(d, f)); return st && { f, t: st.mtimeMs, b: st.size }; }))).filter(Boolean);
}
export function pruneEpisodes(robot = null, force = false) {
  const full = force || ++epSaves % 50 === 1;
  return inTurn('episodes', async () => {
    const base = path.join(DATA_DIR(), 'episodes'); let n = 0;
    const list = async (r) => (await zipList(path.join(base, r))).map((x) => ({ r, ...x }));
    const drop = async (x) => { await fsp.rm(path.join(base, x.r, x.f), { force: true }); n++; };
    if (robot) { const l = (await list(robot)).sort((a, b) => a.t - b.t); for (const x of l.slice(0, Math.max(0, l.length - EPISODE_KEEP()))) await drop(x); }
    if (full) {
      let robots = []; try { robots = await fsp.readdir(base); } catch { return n; }
      const all = [];
      for (const r of robots) { const l = (await list(r)).sort((a, b) => a.t - b.t); for (const x of l.slice(0, Math.max(0, l.length - EPISODE_KEEP()))) await drop(x); all.push(...l.slice(Math.max(0, l.length - EPISODE_KEEP()))); }
      all.sort((a, b) => a.t - b.t);
      let total = all.reduce((a, x) => a + x.b, 0);
      for (const x of all) { if (total <= EPISODE_MAX_BYTES()) break; await drop(x); total -= x.b; }
    }
    return n;
  });
}
// GET /api/episodes → 로봇별 저장 에피소드 수·용량
async function listEpisodes(res) {
  const base = path.join(DATA_DIR(), 'episodes'), robots = {};
  let names = []; try { names = await fsp.readdir(base); } catch { /* 아직 저장된 에피소드 없음 */ }
  for (const r of names) {   // 로봇 폴더만 (.DS_Store 같은 파일이 섞여 있어도 목록이 비지 않게)
    if (!(await statA(path.join(base, r)))?.isDirectory()) continue;
    const l = await zipList(path.join(base, r));
    robots[r] = { count: l.length, bytes: l.reduce((a, x) => a + x.b, 0) };
  }
  return send(res, 200, { dir: base, robots, keep: EPISODE_KEEP(), maxBytes: EPISODE_MAX_BYTES() });
}

// CCTV 자동 녹화(NVR) 구간 저장소 — POST /api/cctv?id=run-..._cctv_0001&ext=webm|json → data/cctv/<id>.<ext>
// 보관 기간: 구간 파일이 576개(5분 구간 약 48시간)를 넘으면 오래된 것부터 지운다
// 녹화 영상 보관 한도 (종류별, 환경 변수로 변경):
//   원본 WebM 구간 수 — CCTV METAFACTORY_CCTV_KEEP · 로봇 카메라 METAFACTORY_ROBOTCAM_KEEP (기본 576구간 ≈ 5분 구간 48시간)
//   MP4(전체 + 카메라별) 구간 수 — METAFACTORY_MP4_KEEP (기본 144구간 ≈ 12시간)
//   전체 용량(WebM + MP4 + 색인) — CCTV METAFACTORY_CCTV_MAX_MB (기본 4GB) · 로봇 카메라 METAFACTORY_ROBOTCAM_MAX_MB (기본 8GB)
//   용량을 넘으면 오래된 구간의 MP4부터 지우고, 그래도 넘으면 오래된 구간을 통째로 지운다
export const VIDEO_LIMITS = () => ({
  cctv: { keep: Number(process.env.METAFACTORY_CCTV_KEEP) || 576, mp4Keep: Number(process.env.METAFACTORY_MP4_KEEP) || 144, maxBytes: (Number(process.env.METAFACTORY_CCTV_MAX_MB) || 4096) * 1048576 },
  robotcam: { keep: Number(process.env.METAFACTORY_ROBOTCAM_KEEP) || 576, mp4Keep: Number(process.env.METAFACTORY_MP4_KEEP) || 144, maxBytes: (Number(process.env.METAFACTORY_ROBOTCAM_MAX_MB) || 8192) * 1048576 },
});
// 구간 목록 (오래된 순): 원본 · 전체 MP4 · 카메라별 MP4 크기
export async function videoSegments(kind) {
  const dir = path.join(DATA_DIR(), kind); let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const have = new Set(names);
  const ids = new Set(names.filter((f) => f.endsWith('.webm') || (f.endsWith('.json') && !f.endsWith('.mp4.json'))).map((f) => f.replace(/\.(webm|json)$/, '')));
  const dsizeA = async (d) => { let fl; try { fl = await fsp.readdir(d); } catch { return { n: 0, c: 0 }; } const sz = await Promise.all(fl.map(async (f) => (await statA(path.join(d, f)))?.size ?? 0)); return { n: sz.reduce((a, b) => a + b, 0), c: fl.length }; };
  const one = async (id) => {
    const st = (f) => (have.has(f) ? statA(path.join(dir, f)) : null);   // 목록에 없는 파일은 확인하지 않는다
    const [sw, sj, sm, smj, cam] = await Promise.all([st(`${id}.webm`), st(`${id}.json`), st(`${id}.mp4`), st(`${id}.mp4.json`), have.has(id) ? dsizeA(path.join(dir, id)) : { n: 0, c: 0 }]);
    return { id, t: (sw ?? sj)?.mtimeMs ?? 0, webm: (sw?.size ?? 0) + (sj?.size ?? 0), mp4: (sm?.size ?? 0) + (smj?.size ?? 0), cam: cam.n, camFiles: cam.c, hasMp4: !!smj, capped: have.has(`${id}.nomp4`) };
  };
  const all = [...ids], out = [];
  for (let k = 0; k < all.length; k += 32) out.push(...(await Promise.all(all.slice(k, k + 32).map(one))));   // 32구간씩 — 한꺼번에 수천 개를 걸면 결과 처리로 한 번에 오래 멈춘다
  return out.sort((a, b) => a.t - b.t);
}
// MP4 지우기. 전체 용량 한도 때문에 지운 구간은 표시(<구간>.nomp4)를 남겨 시작 때 다시 변환하지 않는다 (변환 → 용량 초과로 바로 삭제의 되풀이 방지)
async function dropMp4(dir, id, capped = false) {
  await Promise.all([`${id}.mp4`, `${id}.mp4.json`].map((f) => fsp.rm(path.join(dir, f), { force: true })).concat(fsp.rm(path.join(dir, id), { recursive: true, force: true })));
  if (capped) await fsp.writeFile(path.join(dir, `${id}.nomp4`), '').catch(() => {});
}
async function dropSegment(dir, id) {
  await Promise.all([`${id}.webm`, `${id}.json`, `${id}.mp4`, `${id}.mp4.json`, `${id}.nomp4`].map((f) => fsp.rm(path.join(dir, f), { force: true })).concat(fsp.rm(path.join(dir, id), { recursive: true, force: true })));
}
export function pruneVideos(kind) { return inTurn(`video:${kind}`, () => pruneVideosNow(kind)); }
async function pruneVideosNow(kind) {
  const L = VIDEO_LIMITS()[kind], dir = path.join(DATA_DIR(), kind), out = { segments: 0, mp4: 0 };
  let segs = await videoSegments(kind);
  for (const s of segs.slice(0, Math.max(0, segs.length - L.keep))) { await dropSegment(dir, s.id); out.segments++; }   // 원본 구간 수
  segs = segs.slice(Math.max(0, segs.length - L.keep));
  const withMp4 = segs.filter((s) => s.hasMp4 || s.cam);
  for (const s of withMp4.slice(0, Math.max(0, withMp4.length - L.mp4Keep))) { await dropMp4(dir, s.id); s.mp4 = s.cam = 0; s.hasMp4 = false; out.mp4++; }   // MP4 구간 수
  let total = segs.reduce((a, s) => a + s.webm + s.mp4 + s.cam, 0);
  for (const s of segs) { if (total <= L.maxBytes) break; if (s.mp4 + s.cam > 0) { await dropMp4(dir, s.id, true); total -= s.mp4 + s.cam; s.mp4 = s.cam = 0; out.mp4++; } }   // 용량: 오래된 MP4부터
  for (const s of segs) { if (total <= L.maxBytes) break; await dropSegment(dir, s.id); total -= s.webm; out.segments++; }   // 그래도 넘으면 오래된 구간 통째로
  return out;
}
// GET /api/cctv · /api/robotcam → 실제 용량(원본 + MP4 + 카메라별) · 구간 수 · 한도
async function videoStatus(kind) {
  const segs = await videoSegments(kind), L = VIDEO_LIMITS()[kind];
  const webm = segs.reduce((a, s) => a + s.webm, 0), mp4 = segs.reduce((a, s) => a + s.mp4, 0), cam = segs.reduce((a, s) => a + s.cam, 0);
  return { dir: path.join(DATA_DIR(), kind), count: segs.length, mp4Count: segs.filter((s) => s.hasMp4).length, noMp4: segs.filter((s) => !s.hasMp4).length, camFiles: segs.reduce((a, s) => a + s.camFiles, 0),
    bytes: webm + mp4 + cam, webmBytes: webm, mp4Bytes: mp4, camBytes: cam, keep: L.keep, mp4Keep: L.mp4Keep, maxBytes: L.maxBytes, oldest: segs[0]?.t ?? null, newest: segs.at(-1)?.t ?? null };
}
// 시작 때 변환할 구간: MP4 보관 대상(최신 mp4Keep 구간) 중 MP4가 없고, 용량 한도로 MP4를 지운 표시가 없는 것 — 최신부터
// (예전에는 MP4 없는 구간 전부를 오래된 것부터 변환해, 보관 한도 밖 구간은 변환하자마자 지우기를 시작할 때마다 되풀이했다)
export async function backfillTargets(kind) {
  const dir = path.join(DATA_DIR(), kind), L = VIDEO_LIMITS()[kind];
  return (await videoSegments(kind)).slice(-L.mp4Keep).reverse().filter((s) => !s.hasMp4 && !s.capped && fs.existsSync(path.join(dir, `${s.id}.webm`)) && fs.existsSync(path.join(dir, `${s.id}.json`))).map((s) => s.id);
}
export async function backfillVideos() {
  for (const kind of ['cctv', 'robotcam']) {
    const dir = path.join(DATA_DIR(), kind);
    await pruneVideos(kind);
    if (!ffmpegInfo().available) continue;
    for (const id of await backfillTargets(kind)) queueConvert(dir, id).then(() => pruneVideos(kind)).catch(() => {});
  }
}
// GET /api/convert?kind=robotcam|cctv&id=<구간> → MP4 변환(전체 + 카메라별)이 끝날 때까지 기다렸다가 결과
async function convertApi(res, url) {
  const kind = url.searchParams.get('kind'), id = url.searchParams.get('id') ?? '';
  if (!['robotcam', 'cctv'].includes(kind) || !SAFE.test(id)) return send(res, 400, { error: 'kind·id 형식 오류' });
  if (!ffmpegInfo().available) return send(res, 503, { error: 'ffmpeg 없음' });
  try { return send(res, 200, await queueConvert(path.join(DATA_DIR(), kind), id)); } catch (e) { return send(res, 500, { error: e.message }); }
}
// VLA 에피소드 영상 변환은 동시에 2개까지 (여러 로봇이 한꺼번에 끝나도 ffmpeg가 몰리지 않게) — 녹화 구간 변환 대기열과는 따로 두어 짧은 에피소드가 긴 구간 변환 뒤에서 기다리지 않음
let vlaActive = 0; const vlaWait = [];
async function vlaSlot(fn) {
  if (vlaActive >= 2) await new Promise((r) => vlaWait.push(r));
  vlaActive++;
  try { return await fn(); } finally { vlaActive--; vlaWait.shift()?.(); }
}
// POST /api/frames-mp4?fps=5 (본문: 무압축 zip — frame_*.jpg + durations.json[초]) → MP4 (VLA 에피소드 카메라 영상)
async function framesMp4(req, res, url) {
  if (!ffmpegInfo().available) return send(res, 503, { error: 'ffmpeg 없음' });
  try {
    const z = readStoredZip(await readRaw(req, 64 * 1024 * 1024)), durs = JSON.parse(z.get('durations.json')?.toString() ?? '[]');
    const names = [...z.keys()].filter((n) => /^frame_\d+\.jpg$/.test(n)).sort();
    const mp4 = await vlaSlot(() => framesToMp4(names.map((n, i) => ({ name: n, data: z.get(n), dur: durs[i] ?? 0.2 })), Math.min(30, Math.max(1, Number(url.searchParams.get('fps')) || 5))));
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4.length }); res.end(mp4);
  } catch (e) { return send(res, 500, { error: e.message }); }
}
// POST /api/clip-mp4?fps=8 (본문: WebM) → MP4 (CCTV 정보 창 개별 녹화)
async function clipMp4(req, res, url) {
  if (!ffmpegInfo().available) return send(res, 503, { error: 'ffmpeg 없음' });
  try {
    const buf = await readRaw(req, 200 * 1024 * 1024), mp4 = await convertClip(buf, Math.min(30, Math.max(1, Number(url.searchParams.get('fps')) || 8)));
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4.length }); res.end(mp4);
  } catch (e) { return send(res, 500, { error: e.message }); }
}
async function saveCctv(req, res, url) {
  const id = url.searchParams.get('id') ?? '', ext = url.searchParams.get('ext') ?? 'webm';
  if (!SAFE.test(id) || !['webm', 'json'].includes(ext)) return send(res, 400, { error: 'id·ext 형식 오류' });
  try {
    const buf = await readRaw(req, 96 * 1024 * 1024);
    const dir = path.join(DATA_DIR(), 'cctv');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
    await pruneVideos('cctv');
    if (ext === 'json' && ffmpegInfo().available) queueConvert(dir, id).then(() => pruneVideos('cctv')).catch(() => {});   // 색인까지 받으면 MP4로 변환 (전체 + 카메라별) → 한도 정리
    return send(res, 200, { ok: true, bytes: buf.length });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
// 로봇 카메라 자동 녹화 구간 — POST /api/robotcam?id=..._robotcam_0001&ext=webm|json → data/robotcam/<id>.<ext>
async function saveRobotcam(req, res, url) {
  const id = url.searchParams.get('id') ?? '', ext = url.searchParams.get('ext') ?? 'webm';
  if (!SAFE.test(id) || !['webm', 'json'].includes(ext)) return send(res, 400, { error: 'id·ext 형식 오류' });
  try {
    const buf = await readRaw(req, 96 * 1024 * 1024), dir = path.join(DATA_DIR(), 'robotcam');
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
    await pruneVideos('robotcam');
    if (ext === 'json' && ffmpegInfo().available) queueConvert(dir, id).then(() => pruneVideos('robotcam')).catch(() => {});   // 색인까지 받으면 MP4로 변환 (전체 + 카메라별) → 한도 정리
    return send(res, 200, { ok: true, bytes: buf.length });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
// GET /videos/(cctv|robotcam)/<파일>.webm|json → 저장한 영상 파일 (AAS 영상 링크가 가리키는 주소)
function serveVideo(res, url) {
  // /videos/<kind>/<구간>.(webm|mp4|json) 또는 카메라별 /videos/<kind>/<구간>/<로봇_카메라>.mp4
  const m = url.pathname.match(/^\/videos\/(cctv|robotcam)\/(?:([A-Za-z0-9_.-]{1,64})\/)?([A-Za-z0-9_.-]{1,80})\.(webm|json|mp4)$/);
  if (!m || (m[2] && !SAFE.test(m[2])) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(m[3]) || m[3].includes('..')) return send(res, 404, { error: 'not found' });
  const f = path.join(DATA_DIR(), m[1], ...(m[2] ? [m[2]] : []), `${m[3]}.${m[4]}`);
  // 확인과 읽기 사이에 보관 정리로 지워질 수 있다 — 크기 확인 실패는 404, 읽기 오류는 연결만 끊는다 (처리 안 된 오류로 앱 메인 프로세스가 죽지 않게)
  let size; try { size = fs.statSync(f).size; } catch { return send(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'Content-Type': { webm: 'video/webm', mp4: 'video/mp4', json: 'application/json' }[m[4]], 'Content-Length': size, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
}
// GET /api/cctv → 저장된 녹화 구간 수·용량
async function listCctv(res) { return send(res, 200, await videoStatus('cctv')); }

// AIOS 운영 데이터 묶음 저장소 — POST /api/aios?id=run-..._aios_0001 (본문: 운영 데이터셋 zip) → data/aios/<id>.zip
async function saveAios(req, res, url) {
  const id = url.searchParams.get('id') ?? '';
  if (!SAFE.test(id)) return send(res, 400, { error: 'id 형식 오류' });
  try {
    const buf = await readRaw(req, 16 * 1024 * 1024);
    const dir = path.join(DATA_DIR(), 'aios');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.zip`), buf);
    return send(res, 200, { ok: true, bytes: buf.length, pruned: await pruneAios() });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
// AIOS 운영 데이터 보관 한도: 최근 1,008묶음(10분 묶음 7일 · METAFACTORY_AIOS_KEEP), 전체 1GB(METAFACTORY_AIOS_MAX_MB) — 넘으면 오래된 것부터 지운다
export const AIOS_KEEP = () => Number(process.env.METAFACTORY_AIOS_KEEP) || 1008;
export const AIOS_MAX_BYTES = () => (Number(process.env.METAFACTORY_AIOS_MAX_MB) || 1024) * 1024 * 1024;
export function pruneAios() {
  return inTurn('aios', async () => {
    const dir = path.join(DATA_DIR(), 'aios'); let n = 0;
    const files = (await zipList(dir)).sort((a, b) => a.t - b.t);
    let total = files.reduce((a, x) => a + x.b, 0), left = files.length;
    for (const x of files) { if (left <= AIOS_KEEP() && total <= AIOS_MAX_BYTES()) break; await fsp.rm(path.join(dir, x.f), { force: true }); total -= x.b; left--; n++; }
    return n;
  });
}
// GET /api/aios → 저장된 운영 데이터 묶음 수·용량
async function listAios(res) {
  const dir = path.join(DATA_DIR(), 'aios'), l = await zipList(dir);
  return send(res, 200, { dir, count: l.length, bytes: l.reduce((a, x) => a + x.b, 0), keep: AIOS_KEEP(), maxBytes: AIOS_MAX_BYTES() });
}

// 키를 바꾸면 클라이언트를 새로 만든다. 빈 값이면 환경변수(ANTHROPIC_API_KEY 등)로 되돌아간다.
export function setApiKey(key) {
  if (key) client = new Anthropic({ apiKey: key });
  else client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;
  return Boolean(client);
}
export const hasApiKey = () => Boolean(client);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// ── 적응가공 가공기 상태 감시 데이터 (js/machmon.js) ─────────────────
// 묶음: { run, items: [{ topic, kind: 'sample'|'record'|'snapshot', asset, t, … }] } → data/machmon/<run>.jsonl 에 한 줄씩 · 같은 내용을 내장 MQTT로 발행
const MM_DIR = () => path.join(DATA_DIR(), 'machmon');
const mmStat = { batches: 0, items: 0, records: 0, last: null };
async function machmonBatch(req, res) {
  try {
    const body = JSON.parse(await readBody(req, 8 * 1024 * 1024)), items = Array.isArray(body?.items) ? body.items.slice(0, 5000) : [];
    const run = SAFE.test(String(body?.run ?? '')) ? body.run : 'run';
    fs.mkdirSync(MM_DIR(), { recursive: true });
    if (items.length) fs.appendFileSync(path.join(MM_DIR(), `${run}.jsonl`), items.map((x) => JSON.stringify({ rx: new Date().toISOString(), ...x })).join('\n') + '\n');
    const published = mqttPublish(items.filter((x) => typeof x?.topic === 'string').map((x) => ({ topic: x.topic, payload: JSON.stringify(x) })));
    mmStat.batches++; mmStat.items += items.length; mmStat.records += items.filter((x) => x?.kind === 'record').length; mmStat.last = new Date().toISOString();
    return send(res, 200, { ok: true, stored: items.length, published, file: `machmon/${run}.jsonl` });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
// AASX 패키지: ?kind=robot|machine&name=<파일 이름>.aasx — 본문 그대로 저장 · 저장한 절대 경로를 돌려준다 (화면이 전송 위치로 표시)
const AASX_KINDS = new Set(['robot', 'machine', 'factory']);
async function saveAasx(req, res, url) {
  const name = url.searchParams.get('name') ?? '', kind = url.searchParams.get('kind') ?? 'robot';
  if (!AASX_KINDS.has(kind) || !/^[A-Za-z0-9_.-]{1,120}\.aasx$/.test(name)) return send(res, 400, { error: '파일 이름·종류 형식 오류' });
  try {
    const buf = await readRaw(req, 256 * 1024 * 1024), dir = path.join(DATA_DIR(), 'aasx', kind), file = path.join(dir, name);
    if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return send(res, 400, { error: 'AASX(zip) 형식이 아님' });
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf);
    return send(res, 200, { ok: true, bytes: buf.length, file, rel: `aasx/${kind}/${name}` });
  } catch (e) { return send(res, 400, { error: e.message }); }
}
function aasxList() {
  const root = path.join(DATA_DIR(), 'aasx'), out = {};
  for (const k of AASX_KINDS) { try { out[k] = fs.readdirSync(path.join(root, k)).filter((f) => f.endsWith('.aasx')).length; } catch { out[k] = 0; } }
  return { dir: root, files: out };
}
function machmonStatus() {
  let files = [];
  try { files = fs.readdirSync(MM_DIR()).filter((f) => f.endsWith('.jsonl')); } catch { /* 아직 없음 */ }
  return { ...mmStat, dir: MM_DIR(), files: files.length, mqtt: mqttStatus() };
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleAgent(req, res) {
  if (!client) return send(res, 503, { error: 'Claude API 키가 설정되어 있지 않습니다.' });
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: '잘못된 요청 본문' }); }
  if (!payload?.snapshot?.stations) return send(res, 400, { error: 'snapshot 누락' });
  const t0 = Date.now();
  try {
    const out = await runAgentTurn(client, payload);
    console.log(`[agent] ${payload.trigger?.slice(0, 40)} → 조치 ${out.actions.length}건, 거부 ${out.rejected.length}건, ${((Date.now() - t0) / 1000).toFixed(1)}s, $${out.costUSD.toFixed(4)}`);
    send(res, 200, { ...out, latencyMs: Date.now() - t0 });
  } catch (err) {
    sendApiError(res, err);
  }
}

async function handleLine(req, res) {
  if (!client) return send(res, 503, { error: 'Claude API 키가 설정되어 있지 않습니다.' });
  let payload;
  try { payload = JSON.parse(await readBody(req, 60 * 1024 * 1024)); } catch { return send(res, 400, { error: '요청 본문이 잘못되었거나 첨부 파일이 너무 큽니다 (합계 약 40MB 이하)' }); }
  const request = String(payload?.request ?? '').trim().slice(0, 2000);
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  if (!request || !payload?.line?.stations) return send(res, 400, { error: '요청 또는 현재 라인 누락' });
  const t0 = Date.now();
  try {
    const out = await designLine(client, { line: payload.line, request, attachments });
    console.log(`[line] "${request.slice(0, 40)}" 첨부 ${attachments.length}개 → 변경 ${out.diff.length}건, ${((Date.now() - t0) / 1000).toFixed(1)}s, $${out.costUSD.toFixed(4)}`);
    send(res, 200, { ...out, latencyMs: Date.now() - t0 });
  } catch (err) {
    sendApiError(res, err);
  }
}

// Zone 셀 레시피 설계 (유연생산 · 적응가공 · 정밀검사 — 공정 설계 도크가 왼쪽에서 고른 Zone)
async function handleZoneDesign(req, res) {
  if (!client) return send(res, 503, { error: 'Claude API 키가 설정되어 있지 않습니다.' });
  let payload;
  try { payload = JSON.parse(await readBody(req, 60 * 1024 * 1024)); } catch { return send(res, 400, { error: '요청 본문이 잘못되었거나 첨부 파일이 너무 큽니다 (합계 약 40MB 이하)' }); }
  const request = String(payload?.request ?? '').trim().slice(0, 2000), attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  if (!request || !payload?.recipe?.zone || !Array.isArray(payload.recipe.cells)) return send(res, 400, { error: '요청 또는 현재 셀 레시피 누락' });
  const t0 = Date.now();
  try {
    const out = await designZone(client, { recipe: payload.recipe, mix: payload.mix ?? null, mode: payload.mode ?? 'smart', request, attachments });
    console.log(`[zone] ${payload.recipe.zone} "${request.slice(0, 40)}" → 변경 ${out.diff.length}건, ${((Date.now() - t0) / 1000).toFixed(1)}s, $${out.costUSD.toFixed(4)}`);
    send(res, 200, { ...out, latencyMs: Date.now() - t0 });
  } catch (err) { sendApiError(res, err); }
}

function sendApiError(res, err) {
  let status = 502, msg = err.message;
  if (err instanceof Anthropic.AuthenticationError) { status = 401; msg = 'API 키 인증 실패 — 키를 확인하세요'; }
  else if (err instanceof Anthropic.RateLimitError) { status = 429; msg = '요청 한도 초과 — 잠시 후 재시도'; }
  else if (err instanceof Anthropic.BadRequestError) { status = 400; msg = `잘못된 API 요청: ${err.message}`; }
  else if (err instanceof Anthropic.APIConnectionError) { msg = 'Claude API 연결 실패 — 네트워크를 확인하세요'; }
  else if (err instanceof Anthropic.APIError) { status = err.status ?? 502; }
  console.error('[api] 오류:', status, err.message);
  send(res, status, { error: msg });
}

export async function startServer({ port = 8780, host = '127.0.0.1' } = {}) {
  if (!client) setApiKey(null);
  await startMqtt();
  const rca = makeRcaApi({ publish: mqttPublish });   // 분석 결과는 내장 MQTT 브로커로도 발행
  // 센서 서버 (별도 프로세스 · 별도 DB): 내장 브로커의 센서 묶음을 구독해 SQLite에 저장 — 앱 서버는 /api/sensors/v1/를 그 프로세스로 중계한다
  const mq = mqttStatus(), sensor = { port: null, db: null, pid: null, error: null };
  try {
    const child = fork(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sensor-server.mjs'), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SENSOR_PORT: '0', SENSOR_DB: path.join(DATA_DIR(), 'sensors', 'sensors.db'), SENSOR_MQTT: `mqtt://127.0.0.1:${mq.port ?? 1885}` }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    sensor.pid = child.pid;
    child.on('message', (m) => { if (m?.ready) { sensor.port = m.port; sensor.db = m.db; } });
    child.stderr.on('data', (d) => { sensor.error = String(d).slice(-400); });
    child.on('exit', (code) => { sensor.port = null; sensor.error ??= `센서 서버 종료 (코드 ${code})`; });
    process.on('exit', () => child.kill());
  } catch (e) { sensor.error = e.message; }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/status') return send(res, 200, { llm: hasApiKey(), model: MODEL, episodes: true, aios: true, cctv: true, robotcam: true, dataDir: DATA_DIR(), ffmpeg: ffmpegInfo() });
    if (url.pathname === '/api/cctv' && req.method === 'POST') return saveCctv(req, res, url);
    if (url.pathname === '/api/cctv') return listCctv(res);
    if (url.pathname === '/api/robotcam' && req.method === 'POST') return saveRobotcam(req, res, url);
    if (url.pathname === '/api/robotcam') return send(res, 200, await videoStatus('robotcam'));
    if (url.pathname.startsWith('/videos/')) return serveVideo(res, url);
    if (url.pathname === '/api/convert') return convertApi(res, url);
    if (url.pathname === '/api/clip-mp4' && req.method === 'POST') return clipMp4(req, res, url);
    if (url.pathname === '/api/frames-mp4' && req.method === 'POST') return framesMp4(req, res, url);
    if (url.pathname === '/api/episodes' && req.method === 'POST') return saveEpisode(req, res, url);
    if (url.pathname === '/api/episodes') return listEpisodes(res);
    if (url.pathname === '/api/aios' && req.method === 'POST') return saveAios(req, res, url);
    if (url.pathname === '/api/aios') return listAios(res);
    if (url.pathname === '/api/agent' && req.method === 'POST') return handleAgent(req, res);
    if (url.pathname === '/api/line' && req.method === 'POST') return handleLine(req, res);
    if (url.pathname === '/api/zone-design' && req.method === 'POST') return handleZoneDesign(req, res);
    // OPC UA PubSub(JSON) over MQTT — 내장 브로커로 발행
    // 적응가공 가공기 상태 감시 (js/machmon.js): 측정·예지보전 묶음 저장(JSONL) + MQTT 발행 · AAS 파일 저장 · 상태 조회
    if (url.pathname === '/api/machmon/v1/batch' && req.method === 'POST') return machmonBatch(req, res);
    if (url.pathname === '/api/machmon/v1/status') return send(res, 200, machmonStatus());
    // AASX 패키지 저장 (로봇 정보 창 · 가공기 정보 창): 화면이 내려받기와 함께 올린다 → data/aasx/<kind>/<파일>
    if (url.pathname === '/api/aasx/v1' && req.method === 'POST') return saveAasx(req, res, url);
    if (url.pathname === '/api/aasx/v1') return send(res, 200, aasxList());
    if (url.pathname === '/api/mqtt/status') return send(res, 200, mqttStatus());
    if (url.pathname === '/api/mqtt/publish' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 16 * 1024 * 1024));
        return send(res, 200, { published: mqttPublish(Array.isArray(body?.messages) ? body.messages : []), status: mqttStatus() });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    // FAC API (FACOS 업무 기록: 발주·재고·설비보전) — 화면이 /api/fac/push로 올리고, 외부는 조회·이벤트를 GET으로 읽는다
    if (url.pathname === '/api/fac' || url.pathname.startsWith('/api/fac/')) {
      try {
        const r = facRoute(req.method, url.pathname, url.searchParams, req.method === 'POST' ? await readBody(req, 8 * 1024 * 1024) : '');
        if (r) return send(res, r.code, r.body);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    // 센서 서버 중계 (별도 프로세스 — server/sensor-server.mjs)
    if (url.pathname.startsWith('/api/sensors/v1')) {
      if (!sensor.port) return send(res, 503, { error: '센서 서버가 아직 준비되지 않았습니다', detail: sensor.error });
      const up = http.request({ host: '127.0.0.1', port: sensor.port, path: url.pathname + url.search, method: req.method, headers: { accept: req.headers.accept ?? '*/*' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', (e) => send(res, 502, { error: `센서 서버 연결 실패: ${e.message}` }));
      return req.pipe(up);
    }
    // RCA 전담 서버 (더미) — 메인 서버(화면 FACOS 품질 모듈)가 불량 판정 리포트를 올리고 분석 결과·종결을 주고받는다 (server/rca-api.mjs)
    if (url.pathname.startsWith('/api/rca/v1')) {
      try {
        const r = rca.route(req.method, url.pathname, url.searchParams, req.method === 'POST' ? await readBody(req, 16 * 1024 * 1024) : '');
        if (r) return send(res, r.code, r.body);
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    // 경로를 먼저 정리(.. 제거)한 뒤 공개 폴더인지 본다 — 정리 전에 보면 /assets/..%2f.env 같은 주소가 공개 폴더 검사를 지나 비공개 파일로 풀렸다
    let dec; try { dec = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request', 'text/plain'); }
    if (dec.includes('\\') || dec.includes('\0')) return send(res, 404, 'Not found', 'text/plain');   // 윈도우 경로 구분자·NUL은 받지 않음
    const rel = path.posix.normalize(dec).replace(/^\/+/, '') || 'index.html';
    const pub = (r) => PUBLIC.some((p) => r === p || r.startsWith(p));
    if (!pub(rel)) return send(res, 404, 'Not found', 'text/plain');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !pub(path.relative(ROOT, file).split(path.sep).join('/'))) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, data, MIME[path.extname(file)] ?? 'application/octet-stream');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { setTimeout(async () => { try { await pruneEpisodes(null, true); await pruneAios(); await backfillVideos(); } catch { /* 무시 */ } }, 3000); resolve({ server, port: server.address().port }); });   // 시작 3초 뒤 쌓여 있던 에피소드·AIOS 데이터·녹화 영상 정리 (MP4 없는 구간 변환)
  });
}
