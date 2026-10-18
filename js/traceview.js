// 품질 추적 창 — 제품 추적(시리얼·계보) · 불량 분석(AI 원인 분석 · 데이터 내려받기) · 8D 흐름(Zone·총괄 오케스트레이터 스윔레인) · 운영 정책 · 표준·솔루션
import { ENV_SPEC, ENV_KEYS, ENV_NODES, FACTOR, PARAM_SPEC } from './trace.js';
import { D8, CAPA_LANES, VERIFY_S } from './capa.js';
import { QHOST, QTOPIC } from './qcomm.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clk = (t) => { if (t == null) return '-'; const s = Math.floor(t) + 8 * 3600; return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const pct = (v, d = 1) => `${((v ?? 0) * 100).toFixed(d)}%`;
const PRODUCT = { doortrim: '도어트림', eaxle: 'e-axle' };
const STATUS = { wip: ['생산 중', 'info'], ok: ['양품', 'good'], ng: ['NG 격리', 'bad'], escaped: ['양품 판정(유출)', 'good'] };
const CAPA_ST = { open: ['진행 중', 'info'], approval: ['정책 결정 대기', 'warn'], verify: ['효과 검증 중', 'info'], closed: ['종결', 'good'], held: ['보류 종결', 'muted'] };
const TABS = { trace: '🔖 제품 추적', ng: '✖ 불량 분석', comm: '📡 보고·통신', capa: '🧭 8D 흐름', policy: '📜 운영 정책', std: '📚 표준·솔루션' };
export const traceState = { tab: 'ng', serial: null, caseId: null, capaId: null, q: '' };

const chip = (t, tone = '') => `<b class="qt-chip ${tone}">${t}</b>`;
const envChips = (e) => ENV_KEYS.map((k) => { const S = ENV_SPEC[k], v = e?.[k]; const bad = v != null && ((S.hi != null && v > S.hi) || (S.lo != null && v < S.lo)); return `<span class="qt-env ${bad ? 'bad' : ''}" title="${S.label} (기준 ${S.hi != null ? `≤${S.hi}` : `≥${S.lo}`}${S.unit})">${S.label.replace(/ .*/, '')} <b>${v ?? '-'}</b>${S.unit}</span>`; }).join('');

export function traceHTML(sim) {
  const T = sim.trace, C = sim.capa; if (!T) return '<p class="vla-note">제품 추적이 없습니다.</p>';
  const st = traceState, S = T.stats, A = T.env.avg(), E = T.env.exc;
  const tiles = `<div class="imp-tiles qt-tiles">
    ${tile('투입 (시리얼 부여)', S.released.toLocaleString('ko-KR'), `양품 ${S.ok} · 생산 중 ${S.released - S.ok - S.ng - S.escaped}`)}
    ${tile('불량 판정 (NG)', S.ng, `유출 ${S.escaped} · 최근 1시간 불량률 ${pct(T.ngRate(sim.time - 3600), 2)}`)}
    ${tile('AI 원인 분석 적중', S.cases ? pct(S.top1 / S.cases, 0) : '-', `1순위 셀 = 정답 ${S.top1}/${S.cases} · 3순위 내 ${S.top3}`)}
    ${tile('8D CAPA', C?.open.length ?? 0, `정책 결정 대기 ${C?.pending.length ?? 0} · 종결 ${C?.list.filter((k) => k.status === 'closed').length ?? 0}`)}
    ${tile('정밀조립 환경 (평균)', `${A.temp}°C · ${A.rh}%`, E ? `<em class="dn">⚠ ${esc(E.label)} (${E.id})</em>` : `진동 ${A.vib}mm/s · PM2.5 ${A.pm} · ${A.lux}lx`)}</div>`;
  const tabs = `<div class="seg qt-tabs">${Object.entries(TABS).map(([k, l]) => `<button data-qt-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}${k === 'capa' && C?.pending.length ? ` <i class="qt-badge">${C.pending.length}</i>` : ''}</button>`).join('')}</div>`;
  const body = st.tab === 'trace' ? traceTab(sim) : st.tab === 'ng' ? ngTab(sim) : st.tab === 'comm' ? commTab(sim) : st.tab === 'capa' ? capaTab(sim) : st.tab === 'policy' ? policyTab(sim) : stdTab();
  return `${tiles}${tabs}${body}`;
}
const tile = (k, v, sub) => `<div class="imp-tile"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`;

// ── 제품 추적 ─────────────────
function traceTab(sim) {
  const T = sim.trace, st = traceState, q = st.q.trim().toUpperCase();
  const list = (q ? T.recent.filter((r) => r.serial.includes(q) || r.epc.toUpperCase().includes(q) || (r.amr ?? '').includes(q) || r.lot.includes(q)) : T.recent).slice(-40).reverse();
  const sel = (st.serial && T.byId.get(st.serial)) || list.find((r) => r.status !== 'wip') || list[0];   // 기본 = 가장 최근 완료 제품 (계보가 다 찬)
  const rows = list.map((r) => { const [l, tone] = STATUS[r.status]; return `<tr data-qt-serial="${r.serial}" class="${sel === r ? 'sel' : ''}"><td><b class="uidc">${r.serial}</b></td><td>${PRODUCT[r.product] ?? r.product ?? '-'}</td><td>${chip(l, tone)}</td><td>${clk(r.t0)}</td><td>${r.tEnd != null ? `${Math.round(r.tEnd - r.t0)}초` : '-'}</td><td>${r.amr ?? '-'}</td><td title="${r.lot}">…${r.lot.slice(-10)}</td></tr>`; }).join('');
  return `<div class="qt-split">
    <div><div class="qt-search"><input id="qtSearch" type="search" placeholder="시리얼 · EPC · AMR · 로트 검색 (예: DT-, AM-03)" value="${esc(st.q)}" /></div>
      <table class="vla-t qt-list"><thead><tr><th>시리얼</th><th>제품</th><th>상태</th><th>투입</th><th>리드타임</th><th>AMR</th><th>원자재 로트</th></tr></thead><tbody>${rows || '<tr><td colspan="7">해당 제품 없음</td></tr>'}</tbody></table></div>
    <div>${sel ? genealogyHTML(sim, sel) : '<p class="vla-note">제품이 아직 없습니다.</p>'}</div></div>`;
}
function genealogyHTML(sim, r) {
  const [l, tone] = STATUS[r.status], ins = r.inspection;
  const steps = r.steps.map((p, i) => {
    const params = Object.entries(p.params).map(([k, v]) => { const S = (PARAM_SPEC[p.type] ?? {})[k] ?? PARAM_SPEC.fasten[k]; const out = S && ((S.lsl != null && v < S.lsl) || (S.usl != null && v > S.usl)); return `<span class="${out ? 'bad' : ''}">${S?.label ?? k} <b>${v}</b>${S?.unit ?? ''}</span>`; }).join('');
    return `<li class="${p.result === 'NG' ? 'ng' : ''}"><div class="qt-st"><b>${i + 1}. ${esc(p.name)}</b> <i class="uidc">${p.st}</i> ${p.result ? chip(`판정 ${p.result}`, p.result === 'NG' ? 'bad' : 'good') : ''}<small>${clk(p.tIn)} → ${clk(p.tOut)} · 사이클 ${p.cycle ?? '-'}초</small></div>
      <div class="qt-kv"><span>로봇 <b>${p.robots.length ? p.robots.join(' · ') : p.robotKind === 'human' ? '작업자' : '-'}</b></span>${p.operators.length ? `<span>작업자 <b>${p.operators.join(' · ')}</b></span>` : ''}${p.vla ? `<span>VLA <b>${p.vla}</b></span>` : ''}
        <span>운반 <b>${p.amr ?? '컨베이어'}</b>${p.amrBattery != null ? ` (${p.amrBattery}%)` : ''}</span><span>건강도 <b>${p.health}%</b></span><span>드리프트 <b>${(p.drift * 100).toFixed(1)}%</b></span><span>Cpk <b>${p.cpk}</b></span></div>
      <div class="qt-kv qt-par">${params}</div><div class="qt-envs">${p.env.node} ${envChips(p.env)}</div></li>`;
  }).join('');
  return `<div class="qt-gen"><h4>${r.serial} ${chip(l, tone)} <small>${PRODUCT[r.product] ?? ''} · EPC ${r.epc} · 원자재 ${r.lot} · 운반 ${r.amr ?? '컨베이어'} · ${clk(r.t0)} 투입</small></h4>
    ${ins ? `<p class="qt-ins">체결 전수 검사 <b>${ins.result}</b> — 토크 ${ins.torque} N·m (규격 ${ins.spec.torque.join('~')}) · 각도 ${ins.angle}° (규격 ${ins.spec.angle.join('~')})${ins.mode ? ` · <em class="dn">${esc(ins.mode)}</em>` : ''}</p>` : ''}
    <ol class="qt-steps">${steps || '<li>아직 셀에 들어가지 않음</li>'}</ol>
    <p class="vla-note">계보 = ISA-95 Equipment · Personnel · Material Actual. 단계마다 그 순간 설비·로봇·운반 AMR·환경(가장 가까운 환경 센서)을 남깁니다. 전체 이벤트는 불량 분석 탭에서 EPCIS 2.0 JSON-LD로 내려받습니다.</p></div>`;
}

// ── 보고·통신 (불량 판정 리포트 → 메인 서버 → RCA 서버 · pcap) ─────────────────
const QST = { sent: ['메인 서버 전송', 'info'], received: ['RCA 접수', 'info'], analyzed: ['분석 완료', 'warn'], actioned: ['조치 지시·확인', 'good'], closed: ['8D 종결 보고', 'muted'] };
const ipS = (ip) => ip.join('.');
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');   // 화면 시계와 같은 한국 시각 (MM-DD HH:MM)
function commTab(sim) {
  const Q = sim.qcomm, T = sim.trace, st = traceState, shared = !!globalThis.window?.METAFACTORY_SHARED; if (!Q) return '<p class="vla-note">품질 통신이 없습니다.</p>';
  const S = Q.stats, list = Q.order.slice().reverse().map((id) => Q.cases.get(id)).filter(Boolean);
  const cm = Q.cases.get(st.caseId) ?? list[0];
  const live = Q.live ? `<b class="qt-chip good">실서버 연결</b> 앱 서버 <code>/api/rca/v1</code>에 같은 리포트 전송 · 성공 ${S.liveOk} · 실패 ${S.liveFail}` : '<b class="qt-chip muted">시뮬레이션</b> 서버가 없는 화면(웹·공유 페이지)이라 RCA 서버 처리를 화면 안에서 같은 코드(js/rcacore.js)로 재현';
  const arch = `<div class="qt-arch">
    <span><b>① 검사셀 엣지</b><small>10.20.1.41 · .42 (체결셀) · .60 (정밀검사)</small></span><i>MQTT 3.1.1 QoS 1<br>CloudEvents JSON</i>
    <span><b>MQTT 브로커</b><small>${ipS(QHOST.broker.ip)}:${QHOST.broker.port}</small></span><i>구독 전달</i>
    <span><b>② 메인 서버</b><small>FACOS 품질 모듈 ${ipS(QHOST.main.ip)}</small></span><i>HTTP/1.1 REST<br>POST /api/rca/v1/reports</i>
    <span><b>③ RCA 서버 (더미)</b><small>${ipS(QHOST.rca.ip)}:${QHOST.rca.port}</small></span></div>
    <p class="vla-note">③ 분석 결과는 MQTT <code>${QTOPIC.result('{사례}')}</code>로 메인 서버에 · ④ 봉쇄 조치 지시 <code>${QTOPIC.action('{셀}')}</code> → 셀 수신 확인 <code>${QTOPIC.ack('{사례}')}</code> · ⑤ 8D 종결 보고 HTTP <code>POST …/{티켓}/close</code>. ${live}</p>`;
  const tiles = `<div class="imp-tiles">${tile('리포트 전송', S.reports, `MQTT ${S.mqtt}건 · HTTP ${S.http}건`)}${tile('RCA 분석 완료', S.results, `조치 지시 ${S.actions} · 종결 보고 ${S.closed}`)}${tile('품질 통신 데이터', `${(S.bytes / 1024).toFixed(1)}KB`, `패킷 ${Q.cap.stats.packets.toLocaleString('ko-KR')}개 (TCP 세그먼트·ACK 포함)`)}${tile('RCA 서버 티켓', Q.core.reports.size, Object.entries(Q.core.stats().byPriority).map(([k, v]) => `${k} ${v}`).join(' · ') || '-')}</div>`;
  const dl = `<div class="qt-dl"><button data-qt-dl="qpcap" ${!cm || shared ? 'disabled' : ''}>⬇ 이 사례 통신 (.pcap)</button><button data-qt-dl="qpcapall" ${!list.length || shared ? 'disabled' : ''}>⬇ 전체 품질 통신 (.pcap)</button><button data-qt-dl="qjson" ${!cm || shared ? 'disabled' : ''}>⬇ 이 사례 리포트·RCA 결과 (.json)</button><span class="vla-note">${shared ? '공유 페이지에서는 내려받을 수 없습니다. ' : ''}Wireshark 필터: <code>mqtt.topic contains "quality"</code> · <code>http.request.uri contains "/api/rca"</code> · <code>ip.addr == 10.20.0.30</code></span></div>`;
  if (!cm) return `${tiles}${arch}${dl}<p class="vla-note">아직 불량 판정이 없습니다. NG가 나오면 검사셀 엣지가 리포트를 메인 서버로 보내고, 메인 서버가 RCA 서버로 넘겨 분석·조치·종결까지 주고받습니다.</p>`;
  const rows = list.slice(0, 40).map((x) => { const [l, tone] = QST[x.status]; return `<tr data-qt-case="${x.id}" class="${x === cm ? 'sel' : ''}"><td><b>${x.id}</b></td><td class="uidc">${x.serial}</td><td>${x.ticket ?? '-'}</td><td>${chip(l, tone)}</td><td>${x.result?.priority ?? '-'}</td><td>${x.msgs.length}</td></tr>`; }).join('');
  const seq = cm.msgs.map((m, i) => `<tr><td>${i + 1}</td><td>${clk(m.t)}</td><td>${esc(m.from)} → ${esc(m.to)}</td><td>${chip(m.proto, m.proto === 'HTTP' ? 'warn' : 'info')}</td><td><code>${esc(m.ref)}</code></td><td>${m.bytes.toLocaleString('ko-KR')}B</td><td>${esc(m.note)}</td></tr>`).join('');
  const R = cm.result, L = cm.live;
  const res = R ? `<div class="qt-case"><h4>RCA 서버 결과 · ${R.ticket} <small>${esc(R.engine)}</small></h4>
      <p class="qt-ins">우선순위 <b>${R.priority}</b> · 근본 원인 <b>${esc(R.rootCause?.label ?? '-')}</b> (${R.rootCause?.status ?? '-'} · 신뢰도 ${pct(R.rootCause?.confidence ?? 0, 0)})${R.alternative ? ` · 대안 ${esc(R.alternative.label)}` : ''} · 같은 원인 ${R.recurrence}건째${R.related.length ? ` (${R.related.join(', ')})` : ''}</p>
      <p class="qt-ins">봉쇄: ${R.containment.map(esc).join(' · ')}</p>
      <p class="qt-ins">대책: ${R.actions.map((a) => `${a.d} ${esc(a.text)} — ${esc(a.owner)} · 기한 ${kst(a.due)}`).join(' / ')}</p>
      ${L ? `<p class="qt-ins">실서버: ${L.error ? `<em class="dn">${esc(L.error)}</em>` : `${L.ticket} · ${L.status}${L.result ? ` · ${L.result.priority} · ${esc(L.result.rootCause?.label ?? '')}` : ''}`}</p>` : ''}</div>` : '<p class="vla-note">RCA 서버 분석 중…</p>';
  return `${tiles}${arch}${dl}<div class="qt-commlist"><table class="vla-t qt-list"><thead><tr><th>사례</th><th>시리얼</th><th>RCA 티켓</th><th>상태</th><th>우선</th><th>메시지</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h4 class="qt-h">${cm.id} 메시지 흐름</h4><table class="vla-t"><thead><tr><th>#</th><th>시각</th><th>보낸 곳 → 받는 곳</th><th>방식</th><th>토픽 · 경로</th><th>크기</th><th>내용</th></tr></thead><tbody>${seq}</tbody></table>${res}`;
}

// ── 불량 분석 ─────────────────
function ngTab(sim) {
  const T = sim.trace, st = traceState, shared = !!globalThis.window?.METAFACTORY_SHARED;
  const c = T.cases.find((x) => x.id === st.caseId) ?? T.cases[0];
  const rows = T.cases.slice(0, 40).map((x) => `<tr data-qt-case="${x.id}" class="${x === c ? 'sel' : ''}"><td><b>${x.id}</b></td><td class="uidc">${x.serial}</td><td>${clk(x.t)}</td><td>${esc(x.detectedName)}</td><td>${esc(x.rca.top?.label ?? '-')}</td><td>${x.capa ? `${x.capa.id}` : '-'}</td></tr>`).join('');
  const dl = `<div class="qt-dl"><button data-qt-dl="case" ${!c || shared ? 'disabled' : ''}>⬇ 이 사례 RCA 데이터 (.zip)</button><button data-qt-dl="all" ${!T.recent.length || shared ? 'disabled' : ''}>⬇ 전체 데이터셋 (.zip)</button><span class="vla-note">${shared ? '공유 페이지에서는 내려받을 수 없습니다 (맥 앱·웹 버전에서). ' : ''}EPCIS 2.0 이벤트 · ISA-95 계보 · 특징 표(CSV, label_ng · 원인 셀 정답) · 환경 시계열 · 설비 상태 · 인과 그래프 · 8D · LLM 분석 요청문</span></div>`;
  if (!c) return `${dl}<p class="vla-note">아직 불량 판정이 없습니다. 체결셀 토크·각도 전수 검사에서 NG가 나오면 여기에 사례가 생기고 AI 원인 분석·8D가 시작됩니다. (불량은 설비 열화·공정 드리프트·환경 이상에서 생깁니다 — 설비 고장 주입이나 환경 이상 구간에서 늘어납니다)</p>`;
  const R = c.rca, max = R.causes[0]?.score || 1;
  const causes = R.causes.map((x, i) => `<div class="qt-cause ${i === 0 ? 'top' : ''}"><div class="qt-cl"><b>${i + 1}</b> ${FACTOR[x.factor]?.icon ?? ''} ${esc(x.label)}<em>${pct(x.score, 0)}</em></div><i style="width:${(x.score / max) * 100}%"></i><small>${x.evidence.map(esc).join(' · ')}</small></div>`).join('');
  const ex = c.excursions.length ? c.excursions.map((e) => `${e.id} ${esc(e.label)} (${e.node} ${clk(e.t0)}~${clk(e.t1)})`).join(' · ') : '없음';
  const sus = c.suspects.length ? c.suspects.map((x) => `<span class="uidc ${x.status === 'ng' ? 'bad' : ''}" title="${x.via.join(', ')}">${x.serial}</span>`).join(' ') : '없음';
  return `${dl}<div class="qt-split ng">
    <div><table class="vla-t qt-list"><thead><tr><th>사례</th><th>시리얼</th><th>판정</th><th>검사셀</th><th>AI 1순위 원인</th><th>8D</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="qt-case"><h4>${c.id} · <span class="uidc">${c.serial}</span> <small>${PRODUCT[c.product] ?? ''} · ${clk(c.t)} · ${esc(c.detectedName)} · 운영 ${({ traditional: '레거시', smart: '자동화', dark: '피지컬AI' })[c.mode]}</small> <button data-qt-goto="${c.serial}" class="qt-link">계보 보기 ›</button></h4>
      <p class="qt-ins">판정 <b class="dn">NG</b> — ${esc(c.inspection?.mode ?? '')} · 토크 ${c.inspection?.torque} N·m (규격 ${c.inspection?.spec.torque.join('~')}) · 각도 ${c.inspection?.angle}° (규격 ${c.inspection?.spec.angle.join('~')})</p>
      <h5>AI 원인 분석 <small>${esc(R.model)} · 신뢰도 ${pct(R.confidence, 0)}</small></h5>${causes}
      <h5>5 Why</h5><ol class="qt-why">${R.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <h5>봉쇄 범위 <small>원인 후보 셀을 앞뒤 10분 안에 지난 제품 — 출하 보류·재검 대상 ${c.suspects.length}개</small></h5><div class="qt-sus">${sus}</div>
      <h5>그 시간대 환경 이상</h5><p class="vla-note">${ex}</p>
      ${c.capa ? `<p class="qt-ins">8D <button data-qt-capa="${c.capa.id}" class="qt-link">${c.capa.id} · ${CAPA_ST[c.capa.status][0]} · ${c.capa.stage} ›</button></p>` : ''}</div></div>`;
}

// ── 8D 흐름 (스윔레인) ─────────────────
function capaTab(sim) {
  const C = sim.capa, st = traceState; if (!C) return '';
  const k = C.list.find((x) => x.id === st.capaId) ?? C.pending[0] ?? C.list[0];
  const rows = C.list.slice(0, 30).map((x) => { const [l, tone] = CAPA_ST[x.status]; return `<tr data-qt-capa="${x.id}" class="${x === k ? 'sel' : ''}"><td><b>${x.id}</b></td><td>${chip(l, tone)}</td><td>${x.stage}</td><td>${x.cases.length}</td><td>${esc(x.cause.label)}</td></tr>`; }).join('');
  const auto = `<label class="qt-auto"><input type="checkbox" data-qt-auto ${C.auto ? 'checked' : ''}/> 자동 반영 (총괄 오케스트레이터가 대책을 바로 승인)</label>`;
  if (!k) return `${auto}<p class="vla-note">진행 중인 8D가 없습니다. 불량 판정이 나오면 정밀조립 Zone 오케스트레이터가 8D를 열고 총괄 오케스트레이터에 Quality Alert를 올립니다.</p>`;
  const si = D8.findIndex((d) => d.key === k.stage);
  const prog = `<div class="qt-prog">${D8.map((d, i) => `<span class="${i < si || k.status === 'closed' ? 'done' : i === si ? 'now' : ''}"><b>${d.key}</b>${d.label}</span>`).join('')}</div>`;
  // 스윔레인: 행 = 레인(현장 · Zone 오케스트레이터 · 총괄 · 정책), 열 = 8D 단계 — 단계 순서 번호로 흐름을 따라간다
  // 같은 칸에 단계가 여러 개면(같은 원인 추가 NG · 문제 기술 갱신) 처음과 마지막만 보이고 나머지는 개수로
  const node = (lane, x, i) => `<div class="qt-node ${lane}" title="${esc(x.text)}"><i>${i + 1}</i><small>${clk(x.t)}</small>${esc(x.text)}</div>`;
  const cell = (lane, d) => { const xs = k.steps.map((x, i) => [x, i]).filter(([x]) => x.lane === lane && x.d === d); return xs.length <= 2 ? xs.map(([x, i]) => node(lane, x, i)).join('') : `${node(lane, ...xs[0])}<div class="qt-more">… ${xs.length - 2}개 더</div>${node(lane, ...xs.at(-1))}`; };
  const grid = `<div class="qt-swim" style="grid-template-columns: 150px repeat(${D8.length}, minmax(96px, 1fr))"><div class="qt-sh"></div>${D8.map((d, i) => `<div class="qt-sh ${i === si ? 'now' : ''}">${d.key}<small>${d.label}</small></div>`).join('')}
    ${CAPA_LANES.map((L) => `<div class="qt-lane"><b>${L.label}</b><small>${L.sub}</small></div>${D8.map((d) => `<div class="qt-cell">${cell(L.key, d.key)}</div>`).join('')}`).join('')}</div>`;
  const P = k.proposal;
  const decide = k.status === 'approval' ? `<div class="qt-decide"><b>정책 반영하시겠습니까?</b> ${esc(P.title)} <small>${esc(P.desc)}</small><span><button data-qt-approve="${k.id}" class="primary">✔ 정책 반영</button><button data-qt-hold="${k.id}">보류</button></span></div>` : '';
  const fm = k.fmea ? `<table class="vla-t"><thead><tr><th>FMEA (AIAG-VDA)</th><th>심각도 S</th><th>발생도 O</th><th>검출도 D</th><th>AP</th><th>관리 방법</th></tr></thead><tbody><tr><td>${esc(k.fmea.failureMode)}<br><small>${esc(k.fmea.cause)}</small></td><td>${k.fmea.S}</td><td>${k.fmea.O[0]} → <b>${k.fmea.O[1]}</b></td><td>${k.fmea.D}</td><td>${k.fmea.AP[0]} → <b>${k.fmea.AP[1]}</b></td><td>${esc(k.fmea.control)}</td></tr></tbody></table>` : '';
  const eff = k.effect ? `<p class="qt-ins">효과 검증 (${VERIFY_S / 60}분): 불량률 ${pct(k.effect.before, 2)} → <b>${pct(k.effect.after, 2)}</b></p>` : k.status === 'verify' ? `<p class="vla-note">효과 검증 중 — 반영 후 ${Math.max(0, Math.ceil((k.tApply + VERIFY_S - sim.time) / 60))}분 남음</p>` : '';
  return `<div class="qt-capa"><div class="qt-capa-top"><div class="qt-capa-list">${auto}<table class="vla-t qt-list"><thead><tr><th>8D</th><th>상태</th><th>단계</th><th>건수</th><th>원인</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div><h4>${k.id} · ${esc(k.title)} <small>${clk(k.t0)} 착수 · 사례 ${k.cases.length}건 (${k.cases.slice(0, 3).join(', ')}${k.cases.length > 3 ? ' …' : ''})</small></h4>${prog}${decide}${eff}</div></div>
    <div class="qt-case">${grid}${fm}
      ${k.horizontal.length ? `<p class="vla-note">수평 전개 (총괄 오케스트레이터 → 다른 Zone 같은 유형 공정 점검): ${k.horizontal.map(esc).join(' · ')}</p>` : ''}
      <p class="vla-note">흐름: 검사셀 NG → 정밀조립 Zone 오케스트레이터(8D 수행) → 총괄 오케스트레이터(Quality Alert · 승인 · 수평 전개) → 운영 정책(반영 · FMEA · 관리계획). 번호는 일어난 순서입니다.</p></div></div>`;
}

// ── 운영 정책 ─────────────────
function policyTab(sim) {
  const C = sim.capa; if (!C) return '';
  const cur = C.current().map(([k, v]) => `<tr><td>${k}</td><td><b>${esc(v)}</b></td></tr>`).join('');
  const hist = C.policies.map((p) => `<tr><td><b>${p.id}</b></td><td>${clk(p.t)}</td><td>${esc(p.title)}</td><td>${(p.capas ?? [p.capa]).filter(Boolean).join(', ') || '-'}</td><td>${esc(p.by)}</td><td>${p.status === 'applied' ? chip(p.applied ? '적용 중' : '기준 개정', 'good') : chip('되돌림', 'muted')}</td><td>${p.effect ? `${pct(p.effect.before, 2)} → ${pct(p.effect.after, 2)}` : p.status === 'applied' ? '검증 중' : '-'}</td><td>${p.status === 'applied' && p.applied ? `<button data-qt-revert="${p.id}">되돌리기</button>` : ''}</td></tr>`).join('');
  return `<div class="qt-grid2"><div><h4>현재 품질 운영 정책</h4><table class="vla-t">${cur}</table>
      <p class="vla-note">8D D5 대책이 바꾸는 값: 설비 열화 → 예지정비 착수 건강도 · 공정 드리프트 → 재보정 시작 Cpk · 환경 → 환경 인터록(기준 이탈 동안 민감 공정 시간 +12%, 불량 영향 85% 감소). AMR·로트·레거시는 기준 개정(문서)으로 남습니다.</p></div>
    <div><h4>정책 이력</h4><table class="vla-t"><thead><tr><th>ID</th><th>시각</th><th>정책</th><th>8D</th><th>결정</th><th>상태</th><th>불량률 (전 → 후)</th><th></th></tr></thead><tbody>${hist || '<tr><td colspan="8">아직 반영한 정책이 없습니다</td></tr>'}</tbody></table></div></div>`;
}

// ── 표준·솔루션 ─────────────────
function stdTab() {
  const row = (a, b, c, d) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`;
  return `<div class="qt-std"><table class="vla-t"><thead><tr><th>영역</th><th>표준·오픈소스</th><th>이 시뮬레이터 적용</th><th>비고</th></tr></thead><tbody>
    ${row('제품 ID · 추적 이벤트', 'GS1 EPCIS 2.0 / CBV 2.0 (2022, JSON-LD · REST)', '시리얼 + SGTIN EPC · ObjectEvent(bizStep commissioning·sorting·assembling·inspecting·packing·storing, disposition non_conformant) · sensorElementList(온도·습도·조도·진동·PM2.5)', '검증: OpenEPCIS (Apache-2.0)')}
    ${row('계보 데이터 구조', 'ISA-95 / IEC 62264 · OPC 10031-4 ISA-95 Job Control', 'Equipment · Personnel · Material Actual, Material Lot', '용어·구조만 차용')}
    ${row('추적 요구사항', 'ISO 9001 8.5.2 · IATF 16949 8.5.2.1', '부적합품 식별·격리 · 봉쇄 범위(의심 제품) · 기록 보존', '')}
    ${row('문제 해결 · CAPA', '8D (VDA · AIAG CQI-20 유사) · AIAG-VDA FMEA(2019) AP', 'D0~D8 상태 흐름 · D7에서 FMEA 발생도·AP 갱신 · 관리계획(정책) 반영', '단계 이름만 사용 (원문 유료)')}
    ${row('품질 이슈 전달', 'Catena-X CX-0023 Notification API (Quality Investigation · Alert) · Eclipse Tractus-X Trace-X', 'Zone → 총괄 오케스트레이터 Quality Alert · 수평 전개', '알림 모델 참고')}
    ${row('디지털 트윈 자산', 'IEC 63278 AAS · IDTA 02011 BoM(as-built) · Digital Nameplate', '기존 AAS 연동(데이터 연동 창)과 같은 설비 ID', '선택')}
    ${row('측정 결과', 'QIF 3.0 (ISO 23952) · MTConnect 2.5', '토크·각도 측정값 + 규격 (요약 필드)', '정밀검사Zone 확장 시')}
    ${row('AI 원인 분석', 'DoWhy GCM (MIT) · PyRCA (BSD-3) · SHAP', 'features.csv(제품 1행·라벨) + causal_graph.json + environment.csv 내려받기 · 내장 분석 = 계보 베이즈 분해', '분석 코드는 브라우저 밖 Python')}
    </tbody></table>
    <h4>제안 — 적용한 조합</h4><ol class="qt-why">
      <li><b>추적:</b> 제품마다 시리얼·EPC → 셀 통과마다 EPCIS 2.0 ObjectEvent (센서값 포함) · ISA-95 용어 계보 — 실제 MES/EPCIS 저장소(OpenEPCIS 등)로 그대로 보낼 수 있는 형식</li>
      <li><b>분석 데이터:</b> 불량 사례 하나 = zip 하나 (EPCIS · 계보 · 특징 표 · 환경 시계열 · 설비 상태 · 인과 그래프 · LLM 요청문) — 표 학습(GBM+SHAP)·인과 분석(DoWhy)·LLM 어느 쪽이든 바로 사용</li>
      <li><b>CAPA:</b> 8D 상태 흐름을 Zone 오케스트레이터가 수행, 총괄 오케스트레이터가 승인·수평 전개(Catena-X Quality Alert 모델), D7에서 FMEA AP와 운영 정책 갱신 — 사람이 정책 반영/보류 결정, 자동 반영 선택 가능</li>
      <li><b>피할 것:</b> 브라우저에 OPC UA·EPCIS 저장소·AAS 서버를 실제로 붙이기(과도) · IPC-CFX(전자조립)·ISA-88(배치) 채택 · Odoo Quality(Enterprise 전용) 의존</li></ol>
    <p class="vla-note">조사 기준 2026-10. 실제 공장 적용 시에는 OpenEPCIS(EPCIS 저장소) + Eclipse BaSyx(AAS) + 사내 MES를 연결하고, 이 시뮬레이터의 내려받기 형식을 데이터 계약으로 쓰면 됩니다.</p></div>`;
}

// 클릭 처리 — 내려받기는 { dl: 'case' | 'all', caseId }를 돌려 main.js가 파일을 만든다
export function traceClick(sim, e) {
  const t = e.target, g = (sel) => t.closest(sel), st = traceState, C = sim.capa;
  let b;
  if ((b = g('[data-qt-tab]'))) { st.tab = b.dataset.qtTab; return true; }
  if ((b = g('[data-qt-goto]'))) { st.tab = 'trace'; st.serial = b.dataset.qtGoto; st.q = ''; return true; }
  if ((b = g('[data-qt-serial]'))) { st.serial = b.dataset.qtSerial; return true; }
  if ((b = g('[data-qt-case]'))) { st.caseId = b.dataset.qtCase; return true; }
  if ((b = g('[data-qt-approve]'))) { C?.approve(b.dataset.qtApprove); return true; }
  if ((b = g('[data-qt-hold]'))) { C?.hold(b.dataset.qtHold); return true; }
  if ((b = g('[data-qt-revert]'))) { C?.revert(b.dataset.qtRevert); return true; }
  if ((b = g('[data-qt-capa]'))) { st.tab = 'capa'; st.capaId = b.dataset.qtCapa; return true; }
  if ((b = g('[data-qt-auto]'))) { if (C) C.auto = b.checked; return true; }
  if ((b = g('[data-qt-dl]')) && !b.disabled) return { dl: b.dataset.qtDl, caseId: (sim.trace.cases.find((x) => x.id === st.caseId) ?? sim.trace.cases[0])?.id };
  return false;
}
export { ENV_NODES };
