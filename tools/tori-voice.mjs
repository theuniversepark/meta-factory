// 토리(공장장) 녹음 음성 만들기 — 안내 문장(js/tori.js narration())을 남성 한국어 신경망 음성으로 MP3를 만들어 assets/tori/voice/<해시>.mp3에 둔다
// 지금은 edge-tts(Edge 브라우저 읽기 기능의 ko-KR-InJoonNeural · 키 없음 · 비공식 사용)로 만든다 — 정식 서비스(Azure Speech · 네이버 클로바 보이스 · Google TTS)로 바꾸려면 synth()만 바꾼다
// 실행: npm run tori:voice   (edge-tts 필요: python3 -m venv outputs/tts-venv && outputs/tts-venv/bin/pip install edge-tts)
// 이미 있는 파일은 건너뛰고, 쓰지 않는 파일은 지운다 · 목록은 index.json (토리가 읽음)
import { narration, speakText, voiceKey } from '../js/tori.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../assets/tori/voice'), VOICE = process.env.TORI_VOICE ?? 'ko-KR-InJoonNeural';
const BIN = process.env.EDGE_TTS ?? path.resolve(import.meta.dirname, '../outputs/tts-venv/bin/edge-tts');
fs.mkdirSync(DIR, { recursive: true });
const synth = (text, out) => execFileSync(BIN, ['--voice', VOICE, '--rate', '+4%', '--text', text, '--write-media', out], { stdio: 'pipe' });

const list = [...new Set(narration())], keys = [];
let made = 0;
for (const t of list) {
  const k = voiceKey(t), f = path.join(DIR, `${k}.mp3`); keys.push(k);
  if (fs.existsSync(f) && !process.env.FORCE) continue;
  synth(speakText(t), f); made++;
  process.stdout.write(`  ${k}  ${speakText(t).slice(0, 40)}…\n`);
}
for (const f of fs.readdirSync(DIR)) if (f.endsWith('.mp3') && !keys.includes(f.slice(0, -4))) { fs.rmSync(path.join(DIR, f)); console.log('  지움', f); }
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(keys));
const bytes = fs.readdirSync(DIR).filter((f) => f.endsWith('.mp3')).reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
console.log(`문장 ${list.length}개 · 새로 만듦 ${made} · ${VOICE} · 합계 ${(bytes / 1048576).toFixed(1)}MB`);
