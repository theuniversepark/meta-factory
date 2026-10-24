// 적응가공 유압블록 세척기 정보 (디버링셀 정보 창 · 가공기 감시 아래) — 공정 센서 · 청정도 · 필터 상태·정비 (js/washer.js)
import { WASH_SENSORS, WASH_TOPIC, WASH_PHASE_KO } from './washer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { ok: '#3ddc84', warn: '#f5b82e', alarm: '#ff5a5a' };

export function washerHtml(W) {
  const S = W?.snapshot(); if (!S) return '';
  const P = S.spec, v = S.sensors ?? {}, L = S.levels ?? {};
  const lim = (s) => (s.alarm ? [s.alarm.lo != null ? `≤${s.alarm.lo}` : '', s.alarm.hi != null ? `≥${s.alarm.hi}` : ''].filter(Boolean).join(' · ') : '');
  const row = (s) => `<tr title="${esc(s.dev)}"><td>${esc(s.label)}</td><td style="color:${COL[L[s.key] ?? 'ok']};font-weight:700">${v[s.key] ?? '-'} <small>${esc(s.unit)}</small></td><td><small>${esc(lim(s))}</small></td></tr>`;
  const dpPct = Math.min(100, Math.max(0, ((S.dp - P.dp0) / (P.dpAlarm - P.dp0)) * 100)), dcol = S.dp >= P.dpAlarm ? COL.alarm : S.dp >= P.dpRequest - 0.1 ? COL.warn : COL.ok;
  const recs = S.records.slice(0, 6).map((r) => `<li><b style="color:${r.pass ? (r.rewash ? COL.warn : COL.ok) : COL.alarm}">${r.pass ? (r.rewash ? '재세척 합격' : '합격') : '규격 밖'}</b> · ${esc(String(r.part).split('-').slice(-2).join('-'))} · 최대 입자 ${r.maxParticle_um}µm · 잔류 ${r.residue_mg}mg${r.rewash ? ` <small>(1차 ${r.firstParticle_um}µm · ${r.firstResidue_mg}mg)</small>` : ''}</li>`).join('') || '<li>아직 세척 기록 없음</li>';
  const evs = S.events.slice(0, 4).map((e) => `<li>${Math.floor(e.t / 60)}분 · ${esc(e.text)}</li>`).join('') || '<li>필터 정비 기록 없음</li>';
  const req = S.request ? `${S.request.kind === 'filter' ? '필터 교체' : '정비'} ${S.request.tech ? `· ${esc(S.request.tech)} 출동` : '· 배정 대기'}` : '없음';
  return `<div class="mm">
    <h4>🚿 세척기 · ${esc(P.model)}</h4>
    <div class="mm-dec" style="border-color:${dcol}"><b style="color:${dcol}">${v.phase ? `세척 중 — ${esc(WASH_PHASE_KO[v.phase])}` : '대기'}</b>
      <span>공정 ${esc(P.process)} · 이송 6축 로봇(AMR ↔ 고정구)</span></div>
    <div class="mm-tool"><span>🧺 백필터 차압 ${S.dp} bar · 교체까지 약 ${S.remaining}회</span><div class="bar"><i style="width:${dpPct}%;background:${dcol}"></i></div>
      <small>새 필터 ${P.dp0} · 정비 요청 ${P.dpRequest} · 경보 ${P.dpAlarm} bar · 세척액 전도도 ${S.cond} µS/cm (교체 기준 ${P.condBath}) · 정비 요청: ${req}</small></div>
    <table class="mm-t"><thead><tr><th>센서</th><th>현재</th><th>경보</th></tr></thead><tbody>${WASH_SENSORS.map(row).join('')}</tbody></table>
    <div class="mm-h">청정도 (ISO 16232 / VDA 19.1 · 규격 최대 입자 ≤ ${P.maxParticle}µm · 잔류 ≤ ${P.maxResidue}mg) — 최근 재세척률 ${S.rewashRate}%</div><ul class="mm-r">${recs}</ul>
    <div class="mm-h">필터 정비 (FAC 설비보전 · 정비 인력 출동)</div><ul class="mm-r">${evs}</ul>
    <small>세척 ${S.stats.parts}개 · 재세척 ${S.stats.rewash}회 · 규격 밖 ${S.stats.fail}개 · 필터 교체 ${S.stats.filterChanges}회 · 세척액 교체 ${S.stats.bathChanges}회 · 토픽 ${esc(WASH_TOPIC)} (…/part · …/event)</small>
  </div>`;
}
