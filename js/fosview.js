// Factory OS 계층 탭 · 존 간 메시지(A2A) 탭 — 오케스트레이터 창 (orchview.js)에서 그린다
import { OCS, ocsState, EDGE_SKILLS, MSG, epName, KIND_KO, fosClock as clk } from './factoryos.js';
import { zoneDef } from './zonedefs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
export const fosState = { flt: 'all', msg: null, zone: 'main' };
// 확장 Zone 셀 종류별 엣지 스킬
const ZSKILL = { kit: ['부품 ID 인식·혼류 판별', '키팅 (AMMR)'], locate: ['위치정합 6DoF (3D Vision–CAD)', '지그 ID 인식'], spot: ['용접 품질 추정 (전류·전압·동저항)'], seal: ['실링 비드 영상 판정·도포량 보정'], hem: ['헤밍 경로'], mount: ['파지·취부 (VLA)'], vision: ['치수·외관 판정 (갭·단차)'], rework: ['재작업 보수 (휴머노이드)'],
  matid: ['소재 판별·가공여유 3D 측정'], mill5: ['가공 진단 (주축 부하·진동)', '공구 감시'], turn: ['선삭 · AI 품질 예측', '공구 감시'], deburr: ['사선홀 디버링 경로', '공구 감시'], cmm: ['CMM 측정 판정 · 리워크 적합성'],
  dock: ['ID 리더·도킹'], scan: ['3D 스캔 · 초음파 UT'], oins: ['접촉·광학 복합 정밀측정'], atos: ['블루라이트 Point Cloud 형상편차'], judge: ['AI 판정 (OK · 불확실 · NG)'] };
const ZCOMMON = ['동작 감시 (두 번째 눈)', '설비 LLM (알람 해석)', '인터록 (규칙)'];
const tile = (k, v, sub, tone = '') => `<div class="fos-tile ${tone}"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`;
const RULES = [
  ['자율복구 한계', '셀 OCS: AI 운영 정책에 따라 재보정·자율 보정 1회 · 스스로 풀지 못하면 존(Manufacturing Agent)에 영향·증거·필요 지원 보고'],
  ['자원 점유', '정비 인력·AMR은 자기 Zone 우선 · 긴급수리 20초(예지정비·재보정 60초) 대기 뒤 공장 오케스트레이터 결정으로 Zone 간 지원'],
  ['보고 정책', '셀 → 존은 이상 이벤트만 · 안전(P1)·보안·출하품 영향은 모든 계층에 즉시 동시 통보'],
  ['재개 정책', '접수 ACK만으로 재개하지 않는다 — 결정(대상·권한자·버전·제약·재개 조건) 또는 결과 메시지 뒤'],
  ['수량 정산', '시리얼 단위: 고유 투입 = 공정중 + 합격대기 + HOLD·재작업 + 인계완료 + 폐기 — 오차 0이어야 공장이 오더 종료'],
  ['모델 변경', 'VLA·AIOS 모델: 평가 게이트·트윈 검증 → 카나리·섀도 → 배포 · 롤백 (품질 정책은 8D 승인 → 정책 이력·되돌리기)'],
];

export function fosHTML(sim) {
  const F = sim.fos; if (!F) return '<p class="vla-note">Factory OS 계층이 없습니다.</p>';
  const K = F.kpi(), R = K.recon, o = F.orders.find((x) => x.status === 'open' && x.evidenced !== true) ?? F.orders[0];
  const OR = o ? F.main.reconcile(o.id) : null, rate = F.rate(), eta = o && OR && rate > 0 ? sim.time + (o.target - OR.good) / rate : null;
  const tiles = `<div class="fos-tiles">
    ${tile('이상 판단 ≤ 10초', pct(K.judgeRate), K.judgeN ? `평균 ${K.judgeAvg.toFixed(1)}초 · 설비 고장·품질 불량 ${K.judgeN}건` : '아직 이상 없음', K.judgeRate != null && K.judgeRate < 0.9 ? 'warn' : '')}
    ${tile('셀 OCS 명령 검증', `${K.ocsOk} / ${K.ocsRej}`, '승인 / 거부 (정비·보정·현장 명령)')}
    ${tile('수량 정산 (정밀조립)', `오차 ${R?.err ?? '-'}`, R ? `투입 ${R.input} = 공정 ${R.wip} + 합격대기 ${R.pass} + HOLD ${R.hold} + 인계 ${R.handed} + 폐기 ${R.scrap}` : '-', R?.err ? 'bad' : '')}
    ${tile('오더', o ? `${o.id}` : '-', o && OR ? `양품 ${OR.good}/${o.target} · 납기 ${clk(o.due)}${eta ? ` · 예상 ${clk(eta)}` : ''} · 종료 ${K.orders}건` : '-', o?.risk ? 'warn' : '')}
    ${tile('A2A 메시지', K.msgs, `차단 ${K.blocked} · 시간 초과 ${K.timeouts} · 결정 ${K.decisions} · 에스컬레이션 ${K.esc}`)}
    ${tile('상위망', F.online ? '연결' : '단절', F.online ? '공장 ↔ 존 정상' : `Edge Outbox ${K.queued}건 · 승인 범위 안에서 계속`, F.online ? '' : 'bad')}</div>`;
  // 계층 구조: 공장 → 존 → (정밀조립) 셀 OCS → 엣지 스킬
  const reg = F.registry(), fac = reg.filter((r) => r.layer === 'factory'), zm = F.main.agents();
  const Z = fosState.zone, ZO = F.zones[Z];
  const zoneBox = (k, title, sub, body = '') => `<div class="fos-zone ${Z === k ? 'on' : ''}" data-fos-zone="${k}"><h5>${title}<small>${sub}</small></h5>${body}</div>`;
  const ag = (list) => `<div class="fos-agents">${list.map((a) => `<div class="fos-agent ${a.rule ? 'rule' : ''}" title="${esc(a.role)}"><b>${esc(a.name)}</b><small>${esc(a.role)}</small><i>${esc(a.stat ?? '')}</i></div>`).join('')}</div>`;
  const brief = (z) => `<small class="fos-brief">${z.agents().map((a) => esc(a.name)).join(' · ')}</small>`;
  const ocsCard = (name, uid, S, raw, c, skills) => { const last = c?.checks[0]; return `<div class="fos-cell s-${OCS[S].tone}"><div class="fos-ch"><b>${esc(name)}</b><i class="uidc">${uid}</i></div>
      <div class="fos-st"><b class="qt-chip ${OCS[S].tone}">${S}</b> ${OCS[S].ko} <small>(${esc(raw)})</small></div>
      <small>명령 검증 승인 ${c?.ok ?? 0} · 거부 ${c?.rej ?? 0}${last ? ` · 최근 ${KIND_KO[last.kind] ?? last.kind} ${last.ok ? '승인' : '거부'}${last.ok ? (last.by ? ` (${esc(last.by)})` : '') : ` — ${esc(last.reason)}`}` : ''}</small>
      <div class="fos-skills">${skills.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>`; };
  let cells;
  if (Z === 'main') cells = sim.processing.filter((st) => !st.standby).map((st) => ocsCard(st.name, st.uid ?? st.id, ocsState(st), st.state, F.ocs.get(st.id), [...(EDGE_SKILLS[st.type] ?? []), ...(st.vlaCell ? [`VLA ${sim.vla?.versionOf(st.robotUids?.[0]) ?? ''}`] : [])])).join('');
  else { const D = zoneDef(Z); cells = ZO.cells().map((zc) => { const fc = ZO.flowCell(zc.cellId), ty = D?.cells?.[zc.cellId]?.type; return ocsCard(zc.name.replace(/^\S+ /, ''), zc.uid, ZO.ocsOf(zc), fc?.hold ?? (zc.state === 'OK' ? fc?.state ?? '화면 흐름' : zc.state), F.ocs.get(zc.id), [...(ZSKILL[ty] ?? []), ...ZCOMMON.slice(0, 1)]); }).join(''); }
  const tree = `<div class="fos-tree">
    <div class="fos-lv"><em>공장</em><div class="fos-fac"><h5>공장 오케스트레이터 (FacOS) <small>총괄 · 오더·납기·Zone 간 자원·결정 · 계획 버전 ${F.planVersion}</small></h5><div class="fos-chips">${fac.slice(1).map((r) => `<span title="${esc(r.role)}">${esc(r.name)}</span>`).join('')}</div></div></div>
    <div class="fos-lv"><em>존</em><div class="fos-zones">
      ${zoneBox('main', 'Manufacturing Agent', '정밀조립 · 로컬 오케스트레이터 (계층형)', Z === 'main' ? '' : brief(F.main))}
      ${zoneBox('insp', '정밀검사 Orchestrator', '정밀검사 · 기능형 6종 · 서비스 Zone', Z === 'insp' ? '' : brief(F.insp))}
      ${zoneBox('flex', '전환·흐름 오케스트레이터', '유연생산 · thin zone · 품목 전환', Z === 'flex' ? '' : brief(F.flex))}
      ${zoneBox('adapt', '적응가공 오케스트레이터', '적응가공 · 존 ≈ 셀 · 공구·조건', Z === 'adapt' ? '' : brief(F.adapt))}</div></div>
    <div class="fos-lv"><em>존<br>에이전트</em><div>${ag(Z === 'main' ? zm : ZO.agents())}</div></div>
    <div class="fos-lv"><em>셀 OCS<br>· 엣지</em><div class="fos-cells ${Z !== 'main' ? `n${ZO.cells().length}` : ''}">${cells}</div></div></div>
    ${Z === 'main' ? '' : zonePanel(sim, F, Z)}`;
  const ords = F.orders.slice(0, 8).map((x) => { const r = x.recon ?? F.main.reconcile(x.id); return `<tr><td><b>${x.id}</b></td><td>${x.status === 'closed' ? `<b class="qt-chip good">종료</b>` : x.released ? '<b class="qt-chip info">투입 완료</b>' : '<b class="qt-chip warn">진행</b>'}</td><td>${r.good}/${x.target}</td><td>${r.input}</td><td>${r.wip + r.pass}</td><td>${r.hold}</td><td>${r.scrap}</td><td>${clk(x.due)}${x.risk ? ' ⚠' : ''}</td><td>${x.tEnd != null ? `${clk(x.tEnd)}${x.late ? ' (초과)' : ''}` : '-'}</td></tr>`; }).join('');
  const decs = F.decisions.slice(0, 8).map((d) => `<tr><td>${clk(d.t)}</td><td>${esc({ 'maint-support': '정비 지원', 'due-risk': '납기 위험', policy: '정책 승인', 'insp-priority': '검사 순서', timeout: '시간 초과' }[d.kind] ?? d.kind)}</td><td><b>${esc(d.verdict)}</b> ${esc(d.text)}</td><td>${esc(d.version)}</td><td>${esc(d.constraints || '-')}</td><td>${esc(d.resume || '-')}</td></tr>`).join('');
  return `${tiles}${tree}
    <div class="fos-grid">
      <div><h4>오더 (공장 → Manufacturing Agent) <small>양품 ${o?.target ?? 100}개 단위 · 불량 보충 투입은 같은 오더 · 존 종료 증빙(정산 오차 0) 확인 후 공장이 종료</small></h4>
        <table class="vla-t"><thead><tr><th>오더</th><th>상태</th><th>양품</th><th>고유 투입</th><th>진행</th><th>HOLD</th><th>폐기</th><th>납기</th><th>종료</th></tr></thead><tbody>${ords}</tbody></table></div>
      <div><h4>공장 결정 <small>결정 메시지 필수 필드: 대상 · 권한자 · 버전 · 제약 · 재개 조건</small></h4>
        <table class="vla-t"><thead><tr><th>시각</th><th>요청</th><th>결정</th><th>버전</th><th>제약</th><th>재개 조건</th></tr></thead><tbody>${decs || '<tr><td colspan="6">아직 결정 요청이 없습니다</td></tr>'}</tbody></table></div>
    </div>
    <h4>고정 운영 규칙 6종 <small>llm-wiki 운영 계층 — 수치는 고객 작업표준·장비 사양·계측 후 확정</small></h4>
    <table class="vla-t fos-rules">${RULES.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</table>
    <p class="vla-note">원칙: 명령은 위 → 아래(공장 → 존 → 셀 → 장비), 상태는 아래 → 위, 같은 계층은 핸드셰이크만. 에이전트는 제안하고 오케스트레이터가 권한·인터록·안전 상태를 검증해 확정하며, 안전 PLC가 최종 권한. 계층 구성은 llm-wiki 「팩토리OS 오케스트레이터·에이전트 공장·존·셀 분류」(10/15) — 존 계층·용어는 아직 미확정입니다.</p>`;
}

// 확장 Zone 전용 패널: 유연생산 = 전환 오더·Wave · 적응가공 = 공구·조건 조정 · 정밀검사 = 기능 에이전트·서비스 기록
function zonePanel(sim, F, Z) {
  const O = F.zones[Z], R = O.reconcile(), ev = O.events.slice(0, 8).map((e) => `<li>${clk(e.t)} ${esc(e.text)}</li>`).join('') || '<li>아직 기록 없음</li>';
  const live = !!O.flow, rec = R ? `<p class="qt-ins">수량 정산 — 투입 ${R.input} = 진행 ${R.wip} + 완료 ${R.handed} <b>(오차 ${R.err})</b></p>` : '';
  const note = live ? '' : '<p class="vla-note">이 Zone의 셀 흐름(작업·운반 AMR)은 앱 화면에서 돌아갑니다 — 헤드리스에서는 설비 관리(셀 OCS)와 결정 경로만.</p>';
  if (Z === 'flex') {
    const b = O.batch, rv = Object.entries(O.recipes).map(([c, p]) => `<span>${c} ${esc(O.pl(p))} v${O.rv[p]}</span>`).join('');
    return `<div class="fos-grid"><div><h4>전환 오더 · Wave <small>지그 ID · 레시피 버전 · 툴 ID 3중 일치일 때만 동작 · 레시피·모델·감시 기준선 2슬롯</small></h4>
      <button type="button" class="fos-btn" data-fos-co>🔁 전환 오더 보내기 (도어 50 → 후드 30)</button>
      <p class="qt-ins">${b ? `<b>${b.id}</b> ${b.list.map((x, i) => `${i === b.idx ? '▶ ' : ''}${esc(O.pl(x.product))} ${x.done}/${x.n}`).join(' → ')}` : '혼류 운전 — 지그 ID로 레시피 자동 선택 (전환 시간 0)'} · 전환 ${O.coDone}회 · 평균 ${O.coDone ? (O.coSum / O.coDone).toFixed(0) : '-'}초 · 첫물 합격 ${O.faPass} / 불합격 ${O.faFail}</p>
      <div class="fos-chips">${rv || '<span>셀 레시피 기록 없음</span>'}</div>${rec}${note}</div>
      <div><h4>전환·흐름 기록</h4><ul class="fos-ev">${ev}</ul></div></div>`;
  }
  if (Z === 'adapt') {
    const T = Object.entries(O.tools).map(([id, t]) => `<tr><td><b>${id}</b></td><td>${t.id}</td><td><i class="fos-bar"><b style="width:${Math.min(100, t.wear * 100)}%;background:${t.wear > 0.85 ? 'var(--bad)' : t.wear > 0.6 ? 'var(--warn)' : 'var(--good)'}"></b></i> ${Math.round(t.wear * 100)}%</td><td>${t.parts}/${t.life}</td><td>${O.vib(id).toFixed(1)}</td><td>${t.cond > 1 ? '이송 92%' : '기본'}</td><td>${t.changing > 0 ? `교환 중 ${Math.ceil(t.changing)}초` : '-'}</td></tr>`).join('');
    const C = O.conds.slice(0, 6).map((c) => `<tr><td>${clk(c.t)}</td><td>${c.cell}</td><td>${esc(c.before)} → ${esc(c.after)}</td><td>${esc(c.why)}</td><td>${esc(c.result)}</td></tr>`).join('');
    return `<div class="fos-grid"><div><h4>공구 감시 <small>마모·진동 → 88%에 교환 (모바일 매니퓰레이터) · 100%면 파손 → 리워크·긴급 교환</small></h4>
      <table class="vla-t"><thead><tr><th>셀</th><th>공구</th><th>마모</th><th>가공 수</th><th>진동 mm/s</th><th>조건</th><th>상태</th></tr></thead><tbody>${T || '<tr><td colspan="7">가공 기록 없음</td></tr>'}</tbody></table>
      <p class="qt-ins">제품 분기 (CMM) — OK ${O.branch.ok} · 판정 대기 HOLD ${O.branch.hold} · 리워크 ${O.branch.rework} · 공구 교환 ${O.toolN} · 파손 ${O.breaks}</p>${rec}${note}</div>
      <div><h4>조건 변경 (전/후 · 근거 · 결과) <small>엣지가 정하지 않음 — 승인 게이트 뒤 적용</small></h4><table class="vla-t"><thead><tr><th>시각</th><th>셀</th><th>변경</th><th>근거</th><th>결과</th></tr></thead><tbody>${C || '<tr><td colspan="5">아직 조건 변경 없음</td></tr>'}</tbody></table>
      <h4>기록</h4><ul class="fos-ev">${ev}</ul></div></div>`;
  }
  const L = F.bus.log.filter((m) => m.from === 'zone:insp' || m.to === 'zone:insp').slice(0, 8).map((m) => `<li>${clk(m.t)} ${esc(MSG[m.type]?.ko ?? m.type)} — ${esc(m.text)}</li>`).join('') || '<li>아직 서비스 요청 없음</li>';
  return `<div class="fos-grid"><div><h4>서비스 Zone <small>생산 3 Zone의 샘플 요청 → 검사 Task → 결과 환류 (Process Agent) · 여러 Zone 요청이 겹치면 공장이 순서 결정</small></h4>${rec}${note}
    <p class="vla-note">검사 결과 NG → 품질 알림 → 생산 Zone (정밀조립은 불량 사례·8D) · 결과가 오기 전 샘플은 HOLD (자동 OK 금지)</p></div>
    <div><h4>서비스 메시지</h4><ul class="fos-ev">${L}</ul></div></div>`;
}

// ── 존 간 메시지 (A2A 시퀀스) ─────────────────
const COLS = [['factory', '공장 (FacOS)'], ['zone:main', '정밀조립'], ['zone:insp', '정밀검사'], ['zone:flex', '유연생산'], ['zone:adapt', '적응가공'], ['cell', '정밀조립 셀 OCS']];
const colOf = (ep) => { const i = COLS.findIndex(([k]) => k === ep); return i >= 0 ? i : ep.startsWith('cell:') ? 5 : 0; };
const FLT = { all: '전체', handshake: '핸드셰이크·알림', decision: '결정 요청·결정', command: '명령·오더', blocked: '차단·시간 초과' };
const fit = (m, f) => f === 'all' || (f === 'blocked' ? m.status === 'blocked' || m.status === 'timeout' : f === 'handshake' ? ['handshake', 'notify'].includes(MSG[m.type]?.cls) : f === 'decision' ? m.type === 'decision.request' || m.type === 'decision' : f === 'command' ? m.type === 'command' || m.type.startsWith('order.') || m.type === 'broadcast' : true);
export function a2aHTML(sim) {
  const F = sim.fos; if (!F) return '';
  const st = fosState, L = F.bus.log.filter((m) => m.type !== 'ack' && fit(m, st.flt)).slice(0, 80), sel = F.bus.log.find((m) => m.msgId === st.msg) ?? L[0];
  const rows = L.map((m) => {
    const a = colOf(m.from), b = colOf(m.to), lo = Math.min(a, b), hi = Math.max(a, b), C = MSG[m.type]?.cls ?? 'event';
    const cells = COLS.map((_, i) => `<i class="${i === a ? 'from' : ''} ${i === b ? `to ${b > a ? 'r' : 'l'}` : ''} ${i > lo && i < hi ? 'span' : ''} ${i >= lo && i <= hi && a !== b ? 'on' : ''}"></i>`).join('');
    return `<div class="a2a-row c-${C} st-${m.status} ${sel === m ? 'sel' : ''}" data-fos-msg="${m.msgId}"><small>${clk(m.t)}</small><div class="a2a-lanes">${cells}</div><span><b>${MSG[m.type]?.ko ?? m.type}</b> ${esc(m.text)}${m.status === 'blocked' ? ` <em class="dn">⛔ 가드레일 차단 — ${esc(m.why)}</em>` : m.status === 'timeout' ? ' <em class="dn">⏱ 시간 초과 → 공장 에스컬레이션</em>' : m.status === 'queued' ? ' <em class="wn">📦 Outbox 대기</em>' : ''}</span></div>`;
  }).join('');
  const json = sel ? JSON.stringify((({ msgId, seq, corr, from, to, type, subject, body, authority, planVersion, t, status }) => ({ msgId, seq, corr, from, to, type, subject, body, authority, planVersion, t: clk(t), status }))(sel), null, 2) : '';
  return `<div class="a2a-bar"><div class="seg small">${Object.entries(FLT).map(([k, l]) => `<button type="button" data-fos-flt="${k}" class="${st.flt === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button type="button" data-fos-net>${F.online ? '🔌 상위망 단절 시험' : '🔗 상위망 복구 (Outbox 전송)'}</button><button type="button" data-fos-guard>🛡 가드레일 시험 (존 → 존 명령)</button><button type="button" data-fos-dl>⬇ 메시지 기록 (.jsonl)</button>
      <small>메시지 ${F.bus.stats.sent} · 차단 ${F.bus.stats.blocked} · 시간 초과 ${F.bus.stats.timeouts} · Outbox ${F.bus.outbox.length}</small></div>
    <div class="a2a-b"><div class="a2a-seq"><div class="a2a-head"><small></small><div class="a2a-lanes">${COLS.map(([, l]) => `<b>${l}</b>`).join('')}</div><span>메시지</span></div><div class="a2a-list">${rows || '<p class="vla-note">아직 메시지가 없습니다.</p>'}</div></div>
      <div class="a2a-side"><h4>메시지 계약 <small>${sel ? `${epName(sel.from)} → ${epName(sel.to)}` : ''}</small></h4><pre>${esc(json)}</pre>
        <p class="vla-note">같은 계층(존 ↔ 존)은 핸드셰이크(서비스 요청 → 수락 → 인계 → 결과)·품질 알림만 — 명령·자원 차용·우선순위는 공장 오케스트레이터 결정. Agent Gateway 가드레일이 계층 권한표를 벗어난 메시지를 막습니다. 상위망이 끊기면 공장으로 가는 메시지는 Outbox에 쌓이고 승인 범위 안에서 계속하며, 검사 결과가 오지 않은 샘플은 HOLD로 둡니다(자동 OK 금지). 정밀검사 샘플 핸드셰이크는 앱 화면(3D 정밀검사Zone)에서 동작합니다.</p></div></div>`;
}
export function fosClick(sim, e) {
  const F = sim.fos, t = e.target; if (!F) return false;
  let b;
  if ((b = t.closest('[data-fos-flt]'))) { fosState.flt = b.dataset.fosFlt; return true; }
  if ((b = t.closest('[data-fos-msg]'))) { fosState.msg = b.dataset.fosMsg; return true; }
  if ((b = t.closest('[data-fos-zone]'))) { fosState.zone = b.dataset.fosZone; return true; }
  if (t.closest('[data-fos-co]')) { F.flex.changeoverOrder(undefined, '관제 콘솔'); return true; }
  if (t.closest('[data-fos-net]')) { F.setOnline(!F.online); return true; }
  if (t.closest('[data-fos-guard]')) { F.bus.send('zone:main', 'zone:insp', 'command', { body: { code: 'SPEED', arg: 0.5 }, text: '시험: 정밀조립이 정밀검사 셀에 속도 명령' }); return true; }
  if (t.closest('[data-fos-dl]')) {
    const lines = [...F.bus.log].reverse().map((m) => JSON.stringify((({ msgId, seq, corr, from, to, type, subject, body, authority, planVersion, t, status, text }) => ({ msgId, seq, corr, from, to, type, subject, body, authority, planVersion, t, status, text }))(m))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines], { type: 'application/x-ndjson' })); a.download = `A2A_messages_${F.bus.seq}.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  return false;
}
