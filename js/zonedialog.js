// 확장 Zone(유연생산 · 적응가공 · 정밀검사) 대화 기반 지시 — 정밀조립Zone 지시(js/dialog.js · js/gate.js)와 같은 꼴로
// 해석 → 대상 확인 → 안전 규칙 → 실행 가능성 → 영향 평가를 거쳐 반영(수행)하거나 미반영(거절)하고 사유·대안을 돌려준다.
// 반영 경로: Zone 정지·재개 · 셀 정지·재개 · Zone 속도 · 투입 정지·재개 (zonedefs.js zoneCtl) · 예방정비 (sim.requestTech) · 혼류 비율 (Zone.setMix) · 상태 질의
// 내장 해석기로 알 수 없는 문장은 Agent(Claude)가 zone_command 도구로 같은 조치로 바꿔 돌려준다 (js/agentcore.js)
import { EXTRA_ZONES, INSP_CELLS } from './zonedefs.js';

export const ZONE_KEYS = ['flex', 'adapt', 'insp'];
const ZNAME = { main: '정밀조립Zone', flex: '유연생산Zone', adapt: '적응가공Zone', insp: '정밀검사Zone' };
export const zoneName = (k) => ZNAME[k] ?? k;
export const ZONE_EXAMPLES = { flex: ['유연생산 상태 어때?', '헤밍셀 예방정비', '용접셀 정지', '유연생산 속도 80%', '후드 2:1로 생산', '유연생산 투입 정지'], adapt: ['적응가공 상태 어때?', '유압블록 5축 가공셀 예방정비', '적응가공 속도 90%', '유압블록만 생산'], insp: ['정밀검사 상태 어때?', 'ATOS 셀 정지', '정밀검사 속도 120%'] };

// 문장에 Zone 이름이 있으면 그 Zone (없으면 null — 왼쪽에서 고른 Zone을 쓴다)
export function zoneOfText(text) {
  if (/유연\s*생산|flex|FLX-|후드|도어(?!\s*트림)/i.test(text)) return 'flex';
  if (/적응\s*가공|adapt|ADP-|유압\s*블록|리어\s*커버/i.test(text)) return 'adapt';
  if (/정밀\s*검사|insp|QIS-|O-?INSPECT|ATOS|시료/i.test(text)) return 'insp';
  if (/정밀\s*조립|도어\s*트림|e-?\s*axle|이\s*액슬/i.test(text)) return 'main';
  return null;
}

// Zone 문맥: 시뮬레이션의 Zone 객체 · 셀 정의 · 설비 관리 셀(건강도·정비)
export function zoneCtx(sim, key) {
  const zone = key === 'insp' ? sim.inspZone : sim.xzones?.byKey?.(key);
  const Z = key === 'insp' ? { key: 'insp', name: ZNAME.insp, cells: INSP_CELLS } : EXTRA_ZONES.find((z) => z.key === key);
  if (!Z) return null;
  const cells = Object.entries(Z.cells).map(([id, d]) => ({ id, d, run: zone?.cells?.[id] ?? null, fac: sim.zoneCell?.(key, id) ?? null }));
  return { key, name: ZNAME[key], Z, zone, cells, sim };
}

const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
// 셀 찾기: 셀 코드(C03 · HB_MILL · ATOS) · 번호("3번 셀") · 이름(가접·본용접 → "용접") · 하는 일 낱말
const CELL_WORDS = { kit: /키팅|공급/, locate: /안착|보정셀|위치\s*보정/, spot: /용접|스폿/, seal: /실링|실러/, hem: /헤밍/, mount: /장착|힌지/, vision: /치수|외관|비전/, rework: /재작업|NG\s*셀|리워크/, matid: /소재\s*식별|3D\s*측정/, mill5: /5축|가공셀|정밀\s*절삭/, deburr: /디버링|사선/, turn: /선삭|선반/, cmm: /CMM|초정밀|측정셀/, dock: /접수|도킹/, scan: /스캔|초음파/, oins: /O-?INSPECT|재측정/, atos: /ATOS|형상\s*편차/, judge: /판정|버퍼/ };
function findCell(text, ctx) {
  const t = norm(text);
  for (const c of ctx.cells) if (new RegExp(`(^|[^a-z0-9])${c.id.toLowerCase()}([^a-z0-9]|$)`).test(text.toLowerCase())) return c;
  const num = text.match(/(\d+)\s*번\s*셀|셀\s*(\d+)\s*번?|C\s*0?(\d+)/i);
  if (num) { const n = num[1] ?? num[2] ?? num[3]; const c = ctx.cells.find((x) => x.id === `C${String(n).padStart(2, '0')}` || x.d.no === n); if (c) return c; }
  const byLabel = ctx.cells.find((c) => t.includes(norm(c.d.label)) || t.includes(norm(c.d.label.replace(/셀$|\s*Cell$/i, ''))));
  if (byLabel) return byLabel;
  const hits = ctx.cells.filter((c) => CELL_WORDS[c.d.type]?.test(text));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {   // 제품 이름으로 좁힌다 (유압블록 5축 가공셀 · 리어커버 정밀절삭셀)
    const p = hits.find((c) => (/유압\s*블록/.test(text) && c.d.product === 'hblock') || (/리어\s*커버/.test(text) && c.d.product === 'rcover'));
    return p ?? hits[0];
  }
  return null;
}

// 혼류 비율: 제품 이름·비율 → Zone.mixes 키
function findMix(text, ctx) {
  const M = ctx.Z.mixes; if (!M) return null;
  const P = Object.entries(ctx.Z.products ?? {});   // [[key, {label}], …] — 첫 제품이 비율 앞자리
  const only = P.find(([, v]) => new RegExp(`${v.label}\\s*(만|전용)`).test(text));
  if (only) return Object.entries(M).find(([, m]) => m.w[only[0]] > 0 && Object.values(m.w).filter((x) => x > 0).length === 1)?.[0] ?? null;
  const r = text.match(/(\d)\s*(?::|대|to)\s*(\d)/i);
  if (r) {
    let [a, b] = [+r[1], +r[2]];
    const i0 = text.search(new RegExp(P[0]?.[1].label ?? '#')), i1 = text.search(new RegExp(P[1]?.[1].label ?? '#'));
    if (i1 >= 0 && (i0 < 0 || i1 < i0) && i0 >= 0) [a, b] = [b, a];
    return a === b ? '1:1' : a > b ? '2:1' : '1:2';
  }
  if (/반반|균등|같은\s*비율/.test(text)) return '1:1';
  const more = P.find(([, v]) => new RegExp(`${v.label}.*(더|많이|늘)`).test(text));
  if (more) return more[0] === P[0][0] ? '2:1' : '1:2';
  return null;
}

// 같은 뜻 표현 묶음 (정밀조립 js/dialog.js와 같은 낱말 · tests/zonedialog.mjs)
const FEED = /투입|자재|재료|소재|원자재|공급/, FEED_HOLDW = /정지|중단|멈|보류|막|쉬|홀드|그만|스톱/, FEED_GOW = /재개|다시|시작|풀/;
const MAINTW = /예방\s*정비|정비|점검|손\s*(좀\s*)?(봐|보)|고장|고쳐|수리|장비\s*(확인|봐)|(기계|장비|설비).*(이상|문제|소리)/;
const pctOf = (text) => {
  const m = text.match(/(\d{2,3})\s*(%|퍼센트|프로|퍼)/) ?? (/속도|빠르게|느리게|천천히|올려|내려|낮춰|높여/.test(text) ? text.match(/(\d{2,3})\s*(?:으로|로)/) : null);
  return m ? +m[1] : /반쯤|절반\s*속도|반\s*속도/.test(text) ? 50 : null;
};

// 문장 하나 → 조치
function parseClause(text, ctx) {
  const cell = findCell(text, ctx), out = [];
  const add = (a) => out.push({ zone: ctx.key, ...a, cell: a.cell === undefined ? cell?.id ?? null : a.cell });
  const pv = pctOf(text);
  if (/상태|어때|어떻|현황|알려|보고|몇\s*개|얼마|확인해|UPH|생산량|괜찮|돌아가/i.test(text) && !/정지|멈|정비|속도|투입|재개|비율|장비|손\s*봐|고장|고쳐|수리/.test(text)) { add({ type: 'zstatus' }); return out; }
  const mix = (/비율|혼류|생산|만\s|전용|:|대\s*\d/.test(text) || /만$/.test(text)) && findMix(text, ctx);
  if (mix) { add({ type: 'zmix', mix, cell: null }); return out; }
  const feed = /투입/.test(text) || (FEED.test(text) && !cell);   // "공급·키팅 셀 정지"처럼 셀 이름에 든 '공급'은 투입 지시가 아님
  if (feed && FEED_HOLDW.test(text)) { add({ type: 'zfeed', on: true, cell: null }); return out; }
  if (feed && FEED_GOW.test(text)) { add({ type: 'zfeed', on: false, cell: null }); return out; }
  if (pv != null || /속도|빠르게|느리게|천천히|살살/.test(text)) {
    const v = pv ?? (/빠르게|올려|높여/.test(text) ? 110 : /느리게|천천히|살살|내려|낮춰/.test(text) ? 75 : /원래|정상|표준/.test(text) ? 100 : null);
    if (v != null) { add({ type: 'zspeed', pct: v }); return out; }
  }
  if (MAINTW.test(text)) { add({ type: 'zmaint' }); return out; }
  if (/재개|다시\s*(가동|돌|시작)|계속\s*(가동|돌)|가동시켜|해제|풀어/.test(text)) { add({ type: 'zrun', stop: false }); return out; }
  if (/비상\s*정지|긴급\s*정지|사이클\s*정지|일시\s*정지|멈춰|정지|세워|중지/.test(text)) { add({ type: 'zrun', stop: true, urgent: /비상|긴급/.test(text) }); return out; }
  return out;
}

export function parseZoneInstruction(text, ctx) {
  const clauses = text.split(/\s*(?:,|\.(?=\s|$)|;|\n|그리고|그 ?다음(?:에)?|이후에?|및)\s*/).map((s) => s.trim()).filter(Boolean);
  const actions = [], unknown = [];
  for (const c of clauses) { const a = parseClause(c, ctx); if (a.length) actions.push(...a.map((x) => ({ ...x, clause: c }))); else unknown.push(c); }
  return { actions, unknown };
}

const cellOf = (ctx, id) => ctx.cells.find((c) => c.id === id);
const cellName = (ctx, id) => { const c = cellOf(ctx, id); return c ? `${c.id} ${c.d.label}` : id; };
const ST = { BUSY: '가동', IDLE: '대기', BLOCKED: '출구 대기', DONE: '완료 대기', DOWN: '고장', MAINT: '정비중' };
const mixLabel = (ctx, k) => ctx.Z.mixes?.[k]?.label ?? k;
const curMix = (ctx) => { const w = ctx.zone?.mix; if (!w || !ctx.Z.mixes) return null; return Object.entries(ctx.Z.mixes).find(([, m]) => Object.entries(m.w).every(([p, v]) => (w[p] ?? 0) * Object.values(m.w).reduce((a, b) => a + b, 0) === v * Object.values(w).reduce((a, b) => a + b, 0)))?.[0] ?? null; };

export function describeZone(a, ctx) {
  const on = a.cell ? cellName(ctx, a.cell) : ctx.name;
  switch (a.type) {
    case 'zstatus': return `상태 질의 · ${on}`;
    case 'zmix': return `혼류 비율 ${mixLabel(ctx, a.mix)} · ${ctx.name}`;
    case 'zfeed': return `투입 ${a.on ? '정지' : '재개'} · ${ctx.name}`;
    case 'zspeed': return `속도 ${a.pct}% · ${on}`;
    case 'zmaint': return `예방정비 · ${on}`;
    case 'zrun': return `${a.stop ? '정지' : '재개'} · ${on}`;
  }
  return `"${a.clause ?? ''}"`;
}

// 판정: 한 단계라도 fail이면 미반영(거절), warn은 반영하되 주의
export function evaluateZone(a, ctx) {
  const checks = [], add = (key, status, text) => checks.push({ key, status, text });
  const reject = (reason, alt) => ({ checks, verdict: 'reject', reason, alt, summary: describeZone(a, ctx) });
  if (!a || a.type === 'unknown') { add('parse', 'fail', `"${a?.clause ?? ''}" — ${ctx.name} 공정 지시로 알아듣지 못함`); return reject('지시를 해석하지 못함', `예: ${(ZONE_EXAMPLES[ctx.key] ?? []).slice(0, 3).join(' · ')}`); }
  add('parse', 'pass', `"${a.clause}" → ${describeZone(a, ctx)}`);
  const K = ctx.zone?.ctl, sim = ctx.sim, c = a.cell ? cellOf(ctx, a.cell) : null;
  if (!ctx.zone || !K) { add('target', 'fail', `${ctx.name} 화면 시뮬레이션이 없음`); return reject(`${ctx.name}은 3D 화면에서만 제어할 수 있음`, null); }
  if (a.cell && !c) { add('target', 'fail', `${ctx.name}에 "${a.cell}" 셀이 없음`); return reject('대상 셀 없음', `셀: ${ctx.cells.map((x) => x.id).join(', ')}`); }
  const zoneStopped = sim.cmd?.estopAll || sim.cmd?.pstopAll;
  if (a.type === 'zstatus') {
    add('target', 'pass', c ? `${cellName(ctx, c.id)} · ${ST[c.run?.state] ?? c.run?.state ?? '-'}` : ctx.name);
    for (const k of ['safety', 'feasible', 'impact']) add(k, 'pass', k === 'impact' ? '조회만 함 · 공정 변경 없음' : '해당 없음 (조회)');
    return { checks, verdict: 'answer', summary: describeZone(a, ctx) };
  }
  add('target', 'pass', c ? `${cellName(ctx, c.id)} · 현재 ${c.fac?.state === 'DOWN' ? '고장' : c.fac?.state === 'MAINT' ? '정비중' : ST[c.run?.state] ?? c.run?.state ?? '-'}` : `${ctx.name} 전체 (셀 ${ctx.cells.length}개)`);
  switch (a.type) {
    case 'zrun': {
      if (!a.stop && zoneStopped) { add('safety', 'fail', '공장 비상정지·보호정지 중 — 정밀조립Zone에서 해제해야 함'); return reject('공장 정지 중이라 재개 불가', '먼저 "전체 비상정지 해제" 또는 "보호정지 해제"'); }
      add('safety', 'pass', a.stop ? '정지는 항상 허용 (안전 우선)' : '인터록 통과');
      if (c) {
        const held = K.hold.has(c.id);
        if (a.stop === held) { add('feasible', 'fail', a.stop ? '이미 정지한 셀' : '정지하지 않은 셀'); return reject(`변경 없음 — ${a.stop ? '이미 정지' : '이미 가동'}`, null); }
        if (!a.stop && K.stop) { add('feasible', 'warn', `${ctx.name} 전체가 정지 중 — 셀만 풀려도 Zone 재개 전까지 멈춤`); }
        else add('feasible', 'pass', '셀 컨트롤러가 받을 수 있는 상태');
        add('impact', a.stop ? 'warn' : 'pass', a.stop ? `${c.d.label} 작업 중단 — 앞 셀은 출구 대기, 뒤 셀은 자재 대기` : '셀 작업 재개');
      } else {
        if (a.stop === K.stop) { add('feasible', 'fail', a.stop ? '이미 Zone 정지 중' : 'Zone이 정지 상태가 아님'); return reject(`변경 없음 — ${a.stop ? '이미 정지' : '이미 가동'}`, !a.stop && K.hold.size ? `정지한 셀: ${[...K.hold].join(', ')} — "셀 이름 + 재개"` : null); }
        add('feasible', 'pass', `셀 ${ctx.cells.length}개 · AMR 정지·재개 가능`);
        add('impact', a.stop ? 'warn' : 'pass', a.stop ? `${ctx.name} 모든 셀·AMR 정지 — 재개 전까지 생산 중단` : `${ctx.name} 재개`);
      }
      break;
    }
    case 'zspeed': {
      if (c) { add('feasible', 'fail', '셀 하나의 속도는 바꿀 수 없음 (Zone 전체 속도만)'); return reject('셀 단위 속도 미지원', `"${ctx.name} 속도 ${a.pct}%"`); }
      add('safety', 'pass', '정지 명령과 무관');
      const v = Math.max(30, Math.min(120, a.pct));
      if (Math.round(K.speed * 100) === v) { add('feasible', 'fail', `이미 ${v}%`); return reject('변경 없음 — 이미 같은 속도', null); }
      add('feasible', v !== a.pct ? 'warn' : 'pass', v !== a.pct ? `허용 범위 30~120% → ${v}%` : '허용 범위 30~120%');
      add('impact', v === 100 ? 'pass' : 'warn', v > 100 ? `셀 작업·AMR 이동 ${v - 100}% 빨라짐 — 설비 마모·고장 위험 증가` : v < 100 ? `처리량 약 ${100 - v}% 감소` : '표준 속도');
      a.pct = v; break;
    }
    case 'zfeed': {
      if (ctx.key === 'insp') { add('feasible', 'fail', '정밀검사Zone은 다른 Zone이 보내는 시료를 받음 — 투입 단계가 없음'); return reject('정밀검사Zone은 투입 정지 대상이 아님', '"정밀검사 정지" (검사 전체 정지)'); }
      add('safety', 'pass', '정지 명령과 무관');
      if (a.on === K.feed) { add('feasible', 'fail', a.on ? '이미 투입 정지 중' : '투입 정지 상태가 아님'); return reject('변경 없음', null); }
      add('feasible', 'pass', '투입 대기열 AMR 제어 가능');
      add('impact', a.on ? 'warn' : 'pass', a.on ? '새 투입 중단 — Zone 안 재공을 다 처리하면 셀들이 비게 됨' : '다음 AMR부터 투입 재개');
      break;
    }
    case 'zmaint': {
      if (!c) { add('target', 'fail', '정비할 셀이 지정되지 않음'); return reject('대상 셀 미지정', `예: "${ctx.cells[0]?.d.label} 예방정비"`); }
      if (!c.fac) { add('feasible', 'fail', '설비 관리 대상이 아닌 셀'); return reject('정비 대상 아님', null); }
      add('safety', zoneStopped ? 'warn' : 'pass', zoneStopped ? '공장 정지 중 — 정비 인력 이동은 해제 후 진행' : '정비 인력 출동 가능');
      if (c.fac.state === 'DOWN' || c.fac.state === 'MAINT') { add('feasible', 'fail', `이미 ${c.fac.state === 'DOWN' ? '고장 · 수리 대기' : '정비 중'}`); return reject(`${c.fac.state === 'DOWN' ? '고장 수리가 먼저 진행 중' : '이미 정비 중'}`, null); }
      if (c.fac.request) { add('feasible', 'fail', '이미 정비 요청이 걸려 있음'); return reject('이미 정비 요청됨', null); }
      add('feasible', 'pass', `건강도 ${c.fac.health.toFixed(0)}% · ${ctx.name} 정비실 인력 배정`);
      add('impact', 'warn', `${c.d.label} 정비 동안 정지 (약 ${Math.round(sim.mode?.pmTime || 90)}초) · 건강도 100% 회복`);
      break;
    }
    case 'zmix': {
      if (!ctx.Z.mixes) { add('feasible', 'fail', `${ctx.name}은 혼류 비율이 없음`); return reject('혼류 비율 없음', null); }
      add('safety', 'pass', '정지 명령과 무관 (투입 순서만 변경)');
      if (curMix(ctx) === a.mix) { add('feasible', 'fail', `이미 ${mixLabel(ctx, a.mix)}`); return reject('변경 없음 — 이미 같은 비율', null); }
      add('feasible', 'pass', '지원하는 비율');
      add('impact', 'warn', `다음 투입부터 ${mixLabel(ctx, a.mix)} · Zone 안 재공은 그대로`);
      break;
    }
    default: add('parse', 'fail', '지원하지 않는 지시'); return reject('지원하지 않는 지시', null);
  }
  return { checks, verdict: 'approve', summary: describeZone(a, ctx) };
}

// 조치 실행 — 결과 한 줄 (실행 못 하면 이유)
export function applyZone(a, ctx, { onMix } = {}) {
  const K = ctx.zone?.ctl, sim = ctx.sim; if (!K) return { ok: false, text: `${ctx.name} 화면 시뮬레이션이 없음` };
  const c = a.cell ? cellOf(ctx, a.cell) : null;
  switch (a.type) {
    case 'zstatus': return { ok: true, reply: true, text: zoneStatusText(ctx, a.cell) };
    case 'zrun':
      if (c) { if (a.stop) K.hold.add(c.id); else K.hold.delete(c.id); return { ok: true, text: `${a.stop ? '⏸ 정지' : '▶ 재개'} → ${cellName(ctx, c.id)}` }; }
      K.stop = a.stop; return { ok: true, text: `${a.stop ? '⏸ 정지' : '▶ 재개'} → ${ctx.name} 전체` };
    case 'zspeed': K.speed = a.pct / 100; return { ok: true, text: `⏩ 속도 ${a.pct}% → ${ctx.name} (셀 작업·AMR 이동)` };
    case 'zfeed': K.feed = a.on; return { ok: true, text: `${a.on ? '⛔ 투입 정지' : '▶ 투입 재개'} → ${ctx.name}` };
    case 'zmaint': {
      const ok = sim.requestTech?.(c.fac, 'pm');
      return ok ? { ok: true, text: `🔧 예방정비 → ${cellName(ctx, c.id)} · 정비 인력 배정` } : { ok: false, text: `정비 인력을 배정하지 못함 (${ctx.name} 정비 인력이 모두 작업 중이거나 배터리 부족)` };
    }
    case 'zmix': ctx.zone.setMix?.(ctx.Z.mixes[a.mix].w); onMix?.(ctx.key, a.mix); return { ok: true, text: `혼류 비율 → ${Object.values(ctx.Z.products).map((p) => p.label).join(' : ')} = ${mixLabel(ctx, a.mix)} · 다음 투입부터` };
  }
  return { ok: false, text: '알 수 없는 조치' };
}

export function zoneStatusText(ctx, cellId) {
  const z = ctx.zone, K = z?.ctl;
  if (cellId) {
    const c = cellOf(ctx, cellId), f = c?.fac;
    return `${cellName(ctx, cellId)}: ${f?.state === 'DOWN' ? '고장' : f?.state === 'MAINT' ? '정비중' : ST[c?.run?.state] ?? c?.run?.state ?? '-'}${f ? ` · 건강도 ${f.health.toFixed(0)}%${f.request ? ' · 정비 요청됨' : ''}` : ''} · 처리 ${c?.run?.done ?? 0}개${K?.hold.has(cellId) ? ' · 운영자 정지 중' : ''}`;
  }
  const s = z?.summary?.() ?? {}, down = ctx.cells.filter((c) => c.fac?.state === 'DOWN').map((c) => c.id);
  const ctl = [K?.stop && 'Zone 정지 중', K?.hold.size && `정지한 셀 ${[...K.hold].join(', ')}`, K?.feed && '투입 정지 중', K && K.speed !== 1 && `속도 ${Math.round(K.speed * 100)}%`].filter(Boolean);
  const head = ctx.key === 'insp' ? `${ctx.name}: 판정 ${s.done ?? 0}건 · 대기 ${s.queue ?? 0} · 검사 중 ${s.active ?? 0}` : `${ctx.name}: UPH ${s.uph ?? 0} · 양품 ${Object.entries(ctx.Z.products).map(([k, p]) => `${p.label} ${z?.stats?.good?.[k] ?? 0}`).join(' · ')} · 가동 셀 ${s.busy ?? 0}/${ctx.cells.length}${z?.stats?.ng != null ? ` · NG ${z.stats.ng}` : ''}${curMix(ctx) ? ` · 혼류 ${mixLabel(ctx, curMix(ctx))}` : ''}`;
  return `${head}${down.length ? ` · 고장 ${down.join(', ')}` : ''}${ctl.length ? ` · ${ctl.join(' · ')}` : ''}`;
}

// Agent(Claude) 스냅샷용 — Zone별 셀 상태·제어 상태
export function zonesSnapshot(sim) {
  const out = {};
  for (const k of ZONE_KEYS) {
    const ctx = zoneCtx(sim, k); if (!ctx?.zone) continue;
    const K = ctx.zone.ctl;
    out[k] = { name: ctx.name, status: zoneStatusText(ctx), mixes: ctx.Z.mixes ? Object.fromEntries(Object.entries(ctx.Z.mixes).map(([m, v]) => [m, v.label])) : null, mix: curMix(ctx),
      control: { stopped: !!K?.stop, held_cells: [...(K?.hold ?? [])], feed_hold: !!K?.feed, speed_pct: Math.round((K?.speed ?? 1) * 100) },
      cells: ctx.cells.map((c) => ({ id: c.id, label: c.d.label, use: c.d.use, state: c.fac?.state === 'DOWN' || c.fac?.state === 'MAINT' ? c.fac.state : c.run?.state ?? null, health: c.fac ? Math.round(c.fac.health) : null, maint_request: !!c.fac?.request })) };
  }
  return out;
}
