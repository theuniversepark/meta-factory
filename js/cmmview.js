// 적응가공 CMM 셀 정보 (셀 정보 창) — 측정실 센서 · 피지컬AI(① 범용 파지 · ② 접촉 리워크 · ④ 온도 보정) · 최근 측정 기록 (js/cmmcell.js)
import { CMM_SENSORS, CMM_TOPIC, CMM_PHASE_KO } from './cmmcell.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { ok: '#3ddc84', warn: '#f5b82e', alarm: '#ff5a5a' };
const GRASP = { VLA: 'VLA 범용 파지', teach: '티칭 파지', manual: '작업자' };
const RW = { mc: '머시닝센터 재가공', hand: '접촉 리워크' };

export function cmmHtml(M) {
  const S = M?.snapshot(); if (!S) return '';
  const v = S.sensors ?? {}, L = S.levels ?? {}, c = S.cur, A = S.avg, st = S.stats;
  const lim = (s) => (s.alarm ? [s.alarm.lo != null ? `≤${s.alarm.lo}` : '', s.alarm.hi != null ? `≥${s.alarm.hi}` : ''].filter(Boolean).join(' · ') : '');
  const row = (s) => `<tr title="${esc(s.dev)}"><td>${esc(s.label)}</td><td style="color:${COL[L[s.key] ?? 'ok']};font-weight:700">${v[s.key] ?? '-'} <small>${esc(s.unit)}</small></td><td><small>${esc(lim(s))}</small></td></tr>`;
  const mode = S.ai ? '피지컬AI' : S.on ? '자동화' : '레거시';
  const ai = [
    ['① 범용 파지', c ? `${GRASP[c.grasp.method]}${c.grasp.method === 'VLA' ? ` · 후보 ${c.grasp.candidates}개 중 선택 (신뢰도 ${c.grasp.conf})` : ''} · ${esc(c.grasp.pose)}${c.force != null ? ` · 지그 핀 끼움 최대 ${c.force}N` : ''}` : '대기',
      S.ai ? '손목 카메라로 제품·놓인 자세를 보고 파지 자세를 고른 뒤, 힘 제어로 기준 핀에 끼운다' : S.on ? '제품별로 티칭한 파지점 · 위치 제어로 끼운다 (핀에 걸리면 힘이 튐)' : '작업자가 옮긴다'],
    ['② 접촉 리워크', `${st.hand}회 (재가공 ${st.mc}회)`, S.ai ? '양팔 로봇이 한 손으로 소재를 누르고 다른 손으로 힘 제어 연마·디버링 — 치수 NG만 머시닝센터로' : S.on ? '협동로봇 디버링 스핀들 — 치수 NG만 머시닝센터로' : '작업자 수작업'],
    ['④ 온도 보정', c ? `소재 ${c.temp}℃ (+${c.dT}) · 열팽창 ${c.raw}µm → 남은 오차 ${c.residual}µm` : A.temp != null ? `최근 평균 소재 ${A.temp}℃ · 열팽창 ${A.raw}µm → ${A.residual}µm` : '대기',
      S.ai ? '소재 온도·형상 열 모델로 20℃ 치수를 계산 — 식을 때까지 기다리지 않는다' : S.on ? '열팽창 계수식(선형) 보정 — 소재 속이 아직 따뜻해 오차가 남음' : '보정 없음'],
  ].map(([h, b, s]) => `<li><b>${esc(h)}</b> · ${b}<br><small>${esc(s)}</small></li>`).join('');
  const recs = S.records.slice(0, 6).map((r) => `<li><b style="color:${r.rework ? COL.warn : COL.ok}">${r.rework ? `${RW[r.rework]} 후 합격` : '합격'}</b> · ${esc(String(r.part).split('-').slice(-2).join('-'))} · 소재 ${r.partTemp_C}℃ · 보정 후 ${r.residual_um}µm${r.insertForce_N != null ? ` · 끼움 ${r.insertForce_N}N` : ''}</li>`).join('') || '<li>아직 측정 기록 없음</li>';
  return `<div class="mm">
    <h4>📐 초정밀 측정 · ${esc(S.spec.model)}</h4>
    <div class="mm-dec" style="border-color:${COL[L.room ?? 'ok']}"><b style="color:${COL[L.room ?? 'ok']}">${v.phase ? esc(CMM_PHASE_KO[v.phase]) : '대기'}</b>
      <span>${mode} · 측정 범위 ${esc(S.spec.range)} · ${esc(S.spec.mpe)} · 이송 6축(AMR ↔ 측정실 지그 ↔ 리워크 머시닝센터)</span></div>
    <div class="mm-h">피지컬AI 적용 요소</div><ul class="mm-r">${ai}</ul>
    <table class="mm-t"><thead><tr><th>센서</th><th>현재</th><th>경보</th></tr></thead><tbody>${CMM_SENSORS.map(row).join('')}</tbody></table>
    <div class="mm-h">최근 측정 (리워크율 ${st.parts ? Math.round((st.rework / st.parts) * 1000) / 10 : 0}%)</div><ul class="mm-r">${recs}</ul>
    <small>측정 ${st.parts}개 · 리워크 ${st.rework}개 (재가공 ${st.mc} · 접촉 ${st.hand}) · 온도 보정 ${st.comp}개 · VLA 파지 ${st.vla}회 · 끼움 힘 경고 ${st.forceWarn}회 · 토픽 ${esc(CMM_TOPIC)} (…/part)</small>
  </div>`;
}
