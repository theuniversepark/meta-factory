// 코드 리뷰 지적 회귀 검증 — 정적 파일 경로 우회 차단 · 없는 영상 요청에도 서버 유지 · 보관 정리로 지운 MP4를 「변환 완료」로 돌려주지 않음
// · 카메라 칸 좌표 0 보존(첫 칸이 x=2부터 잘리지 않음) · 시작 때 보관 한도 밖 구간은 변환하지 않음. 실행: npm test
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metafactory-review-')); process.env.METAFACTORY_DATA_DIR = dir;
const { startServer } = await import('../server/app-server.mjs');
const { findFfmpeg } = await import('../server/video-convert.mjs');
const { port, server } = await startServer({ port: 0 }), base = `http://127.0.0.1:${port}`;
console.log('== 정적 파일 경로');
const code = async (p) => (await fetch(base + p)).status;
check('공개 파일은 그대로 (index.html · js/)', (await code('/')) === 200 && (await code('/js/pcap.js')) === 200);
const esc = await Promise.all(['/assets/..%2f.env', '/assets/..%2fpackage.json', '/js/..%2f..%2fetc%2fpasswd', '/assets/..%2fserver%2fapp-server.mjs', '/css/..%5cpackage.json', '/%E0%A4%A'].map(code));
check('공개 폴더 밖으로 풀리는 주소는 막음 (..%2f · 역슬래시 · 잘못된 인코딩)', esc.every((c) => c === 404 || c === 403 || c === 400), esc.join(','));
console.log('== 영상 제공');
check('없는 영상은 404, 서버는 계속 응답', (await code('/videos/robotcam/none_robotcam_0001.mp4')) === 404 && (await code('/api/status')) === 200);
console.log('== 변환 결과 캐시');
const rc = path.join(dir, 'robotcam'); fs.mkdirSync(rc, { recursive: true });
const id = 'run-x_robotcam_0001', done = path.join(rc, `${id}.mp4.json`);
fs.writeFileSync(done, JSON.stringify({ segment: id, mp4: `${id}.mp4`, cameras: [] }));
if (!findFfmpeg()) console.log('  SKIP  ffmpeg 없음 — 변환 캐시 시험 건너뜀');
else {
  const a = await fetch(`${base}/api/convert?kind=robotcam&id=${id}`);
  fs.rmSync(done);   // 보관 정리로 지워진 상태
  const b = await fetch(`${base}/api/convert?kind=robotcam&id=${id}`);
  check('지운 MP4는 다시 요청하면 「변환 완료」가 아니라 다시 변환 시도 (원본이 없어 실패)', a.status === 200 && b.status !== 200, `${a.status} → ${b.status}`);
  // 카메라 칸 좌표 0: 왼쪽 반은 흰색, 오른쪽 반은 검정 영상에서 x=0 칸을 자르면 첫 열이 흰색이어야 한다
  const ff = findFfmpeg(), cv = path.join(dir, 'cctv'); fs.mkdirSync(cv, { recursive: true });
  const cid = 'run-x_cctv_0001';
  spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=4x16:r=2:d=2', '-f', 'lavfi', '-i', 'color=c=black:s=60x16:r=2:d=2', '-filter_complex', 'hstack', '-c:v', 'libvpx-vp9', path.join(cv, `${cid}.webm`)]);
  fs.writeFileSync(path.join(cv, `${cid}.json`), JSON.stringify({ segment: cid, fps: 2, index: [{ id: 'CC-01', rect: [0, 0, 16, 16] }] }));
  const r = await fetch(`${base}/api/convert?kind=cctv&id=${cid}`), j = await r.json();
  const raw = spawnSync(ff, ['-v', 'error', '-i', path.join(cv, j.cameras?.[0]?.file ?? 'x'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout ?? Buffer.alloc(0);
  check('카메라 칸 x=0은 0부터 자름 (첫 칸이 오른쪽으로 밀리지 않음)', r.ok && raw.length >= 16 && raw[0] > 200 && raw[1] > 200, `첫 픽셀 ${raw[0]}·${raw[1]}`);
}
console.log('== 시작 때 변환 대상');
const { VIDEO_LIMITS } = await import('../server/app-server.mjs');
check('MP4 보관 한도 < 원본 보관 한도 (시작 변환은 최신 MP4 보관 구간만)', VIDEO_LIMITS().robotcam.mp4Keep < VIDEO_LIMITS().robotcam.keep);
server?.close?.(); fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
