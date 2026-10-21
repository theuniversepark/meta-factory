// 적응가공 가공기 정보 창 — 상태 감시 센서 · 공구 상태 · 엣지 AI 예지보전 판단 · 상위 보고 · 서버 전송 · AAS 저장 (js/machmon.js)
import { MON_SENSORS, MON_MACHINES, DECISION } from './machmon.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { ok: '#3ddc84', warn: '#f5b82e', alarm: '#ff5a5a' };
const DCOL = { ok: '#3ddc84', watch: '#9fd3ff', replace: '#f5b82e', now: '#ff5a5a', changing: '#9fd3ff', spindle: '#ff8a3d', repair: '#ff5a5a' };

export function machmonHtml(mon, id, { fmt = 'aasx', ver = '3.1', note = '', server = true } = {}) {
  const S = mon?.snapshot(id); if (!S) return '';
  if (!mon.on) return '<div class="note">※ 레거시 공장에는 가공기 상태 감시 센서·데이터 수집이 없습니다.</div>';
  const v = S.sensors ?? {}, L = S.levels ?? {}, T = S.tool;
  const row = (s) => { const x = v[s.key], lv = L[s.key] ?? 'ok', lim = s.alarm ? (s.alarm.hi != null ? `≥${s.alarm.hi}` : `≤${s.alarm.lo}`) : '';
    return `<tr title="${esc(s.dev)}"><td>${esc(s.label)}</td><td style="color:${COL[lv]};font-weight:700">${x == null ? '-' : x}${s.unit ? ` <small>${esc(s.unit)}</small>` : ''}</td><td><small>${esc(lim)}</small></td></tr>`; };
  const wearPct = T ? Math.round(T.wear * 100) : 0, wcol = wearPct >= 80 ? '#ff5a5a' : wearPct >= 55 ? '#f5b82e' : '#3ddc84';
  const recs = S.records.slice(0, 5).map((r) => `<li><b style="color:${DCOL[r.decision]}">${esc(r.decisionKo)}</b> · ${Math.floor(r.t / 60)}분 · ${esc(r.reason)}${r.action ? ` → <em>${esc(r.action)}</em>` : ''}</li>`).join('') || '<li>아직 판단 기록 없음</li>';
  const sent = mon.sent;
  return `<div class="mm">
    <h4>📡 가공기 상태 감시 · ${esc(MON_MACHINES[id].proc)}</h4>
    <div class="mm-dec" style="border-color:${DCOL[S.decision]}"><b style="color:${DCOL[S.decision]}">🧠 엣지 AI 판단: ${esc(S.decisionKo)}</b>
      <span>이상 점수 <b>${S.anomaly}</b> · 공구 잔여 <b>${S.rul?.parts ?? '-'}개</b> (${S.rul?.min ?? '-'}분) · 주축 잔여 <b>${S.rul?.spindleMin ?? '-'}분</b></span></div>
    <div class="mm-tool"><span>🔩 공구 ${esc(T?.id ?? '-')}${T?.changing ? ' · 교환 중' : ''}</span><div class="bar"><i style="width:${Math.min(100, wearPct)}%;background:${wcol}"></i></div>
      <small>마모 ${wearPct}% · 가공 ${T?.parts ?? 0}/${T?.life ?? '-'}개 · VB ${v.toolVB ?? '-'}µm · 치핑 ${v.toolChip ?? '-'} · 길이 편차 ${v.toolLength ?? '-'}µm</small></div>
    <table class="mm-t"><thead><tr><th>센서</th><th>현재</th><th>경보</th></tr></thead><tbody>${MON_SENSORS.map(row).join('')}</tbody></table>
    <div class="mm-h">예지보전 판단 기록 (공장 오케스트레이터 보고 · 서버 전송)</div><ul class="mm-r">${recs}</ul>
    <div class="mm-h">데이터 전송</div>
    <small>토픽 metafactory/machmon/v1/adapt/${esc(id)} · 서버 전송 ${sent.batches}묶음 · ${sent.records}건${sent.last ? ` · 마지막 ${esc(sent.last)}` : ''}${sent.err ? ` · <span style="color:#ff8a8a">${esc(sent.err)}</span>` : ''} · 대기 ${mon.outbox.length}건 · 보고 ${mon.stats.reports}건 · 예지 교환 ${mon.stats.preventive} · 주축 정비 요청 ${mon.stats.spindleReq}</small>
    <div class="btns"><button data-act="mmSend" ${server ? '' : 'disabled title="서버가 없는 화면(웹·공유 페이지)에서는 서버 전송을 할 수 없습니다"'}>📤 측정·판단 데이터 서버로 전송</button></div>
    <div class="rb-save">
      <div class="rb-h">💾 누적 데이터 저장 (AAS)</div>
      <div class="rb-count">셸 1 · 서브모델 6 (명판 · 기술 데이터 · 운영 데이터 · 공구 상태 · 예지보전 · 시계열) · 시계열 ${mon.m[id].hist.length}건 · 판단 기록 ${mon.m[id].records.length}건</div>
      <div class="rb-save-row">
        <select id="mmFmt" title="저장 형식">${[['aasx', 'AASX 패키지 (AAS Part 5, 권장)'], ['json', 'AAS JSON'], ['xml', 'AAS XML'], ['rdf', 'AAS RDF (Turtle)']].map(([k, l]) => `<option value="${k}" ${k === fmt ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="mmVer" title="AAS 메타모델 버전 — XML·RDF 네임스페이스 (3.1: BaSyx SDK 2.x 등 최신 도구 · 3.0: 구버전 도구)">${['3.1', '3.0'].map((v) => `<option value="${v}" ${v === ver ? 'selected' : ''}>AAS v${v}</option>`).join('')}</select>
        <button type="button" data-act="mmAas">저장</button>
      </div>
      <div class="rb-save-note">${note ? esc(note) : ''}</div>
    </div>
  </div>`;
}
export { DECISION };
