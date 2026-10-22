// 사용자 가이드 PDF 만들기: docs/USER_GUIDE.docx → assets/docs/USER_GUIDE.pdf (앱·웹 버전·공유 아티팩트에서 「📘」로 내려받는 파일)
// LibreOffice(soffice)로 변환한다. 이모지에 글꼴이 지정돼 있지 않으면 LibreOffice가 폭을 잘못 잡아 옆 글자와 겹치므로,
// 변환용 사본에서만 이모지 글자를 따로 떼어 이모지 글꼴(맥 Apple Color Emoji · 윈도우 Segoe UI Emoji)을 지정한다 — 커밋된 Word 파일은 그대로.
// 실행: npm run guide:pdf
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const ROOT = path.resolve(__dirname, '..'), SRC = path.join(ROOT, 'docs', 'USER_GUIDE.docx'), OUT = path.join(ROOT, 'assets', 'docs', 'USER_GUIDE.pdf');
const EMOJI_FONT = process.platform === 'win32' ? 'Segoe UI Emoji' : 'Apple Color Emoji';
// 본문 글꼴: Word 파일은 맑은 고딕. 맥에는 맑은 고딕이 없어 LibreOffice가 실행마다 다른 대체 글꼴(장식용 글꼴 등)을 고르므로, 변환용 사본에서는 맥에 설치된 Noto Sans CJK KR로 고정 (Apple SD Gothic Neo는 LibreOffice가 이름으로 찾지 못해 다시 대체됨)
const BODY = { from: ['Malgun Gothic', '맑은 고딕'], to: process.platform === 'darwin' ? 'Noto Sans CJK KR' : null };
const MONO = { from: ['Consolas'], to: process.platform === 'darwin' ? 'Menlo' : null };
// 이모지 한 덩어리: 그림 문자 + (변형 선택자 · 피부색 · ZWJ로 이어진 그림 문자) · 키캡
const EMOJI = /(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|[#*0-9]\uFE0F?\u20E3)/gu;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function soffice() {
  for (const c of [process.env.SOFFICE, 'soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'].filter(Boolean)) {
    try { if (spawnSync(c, ['--version'], { timeout: 20000 }).status === 0) return c; } catch { /* 다음 후보 */ }
  }
  throw new Error('LibreOffice(soffice)를 찾지 못했습니다 — 설치하거나 SOFFICE 환경변수로 경로를 지정하세요');
}

// <w:r>(<w:rPr>…</w:rPr>)?<w:t …>글자</w:t></w:r> 에서 이모지만 따로 떼어 이모지 글꼴 런으로
function splitEmojiRuns(xml) {
  let n = 0;
  const out = xml.replace(/<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t( [^>]*)?>([^<]*)<\/w:t><\/w:r>/g, (all, rpr = '', tattr = '', text) => {
    const t = unesc(text); EMOJI.lastIndex = 0; if (!EMOJI.test(t)) return all;
    const parts = []; let last = 0; EMOJI.lastIndex = 0;
    for (const m of t.matchAll(EMOJI)) { if (m.index > last) parts.push([t.slice(last, m.index), false]); parts.push([m[0], true]); last = m.index + m[0].length; }
    if (last < t.length) parts.push([t.slice(last), false]);
    const font = `<w:rFonts w:ascii="${EMOJI_FONT}" w:hAnsi="${EMOJI_FONT}" w:eastAsia="${EMOJI_FONT}" w:cs="${EMOJI_FONT}"/>`;
    const emojiPr = rpr ? (rpr.includes('<w:rFonts') ? rpr.replace(/<w:rFonts[^>]*\/>/, font) : rpr.replace('<w:rPr>', `<w:rPr>${font}`)) : `<w:rPr>${font}</w:rPr>`;
    n++;
    return parts.map(([s, e]) => `<w:r>${e ? emojiPr : rpr}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>`).join('');
  });
  return { xml: out, n };
}

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(SRC));
  let runs = 0;
  for (const name of Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))) {
    const r = splitEmojiRuns(await zip.file(name).async('string')); runs += r.n; zip.file(name, r.xml);
  }
  for (const name of Object.keys(zip.files).filter((f) => /^word\/[^/]+\.xml$/.test(f))) {   // 글꼴 이름 고정 (본문 · 고정폭)
    let x = await zip.file(name).async('string');
    for (const F of [BODY, MONO]) if (F.to) for (const f of F.from) x = x.split(`"${f}"`).join(`"${F.to}"`);
    zip.file(name, x);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metafactory-guide-')), docx = path.join(tmp, 'USER_GUIDE.docx');
  try {
    fs.writeFileSync(docx, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const r = spawnSync(soffice(), ['--headless', '--convert-to', 'pdf', '--outdir', tmp, docx], { encoding: 'utf8', timeout: 600000 });
    const pdf = path.join(tmp, 'USER_GUIDE.pdf');
    if (r.status !== 0 || !fs.existsSync(pdf)) throw new Error(`PDF 변환 실패: ${r.stderr || r.stdout || r.status}`);
    fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.copyFileSync(pdf, OUT);
    console.log(`PDF: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB) · 이모지 글꼴 지정 런 ${runs}개`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.message); process.exit(1); });
