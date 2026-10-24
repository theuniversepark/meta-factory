// 유연생산 C01 공급·키팅 정보 (셀 정보 창) — 키팅 센서 · 피지컬AI(① 빈 피킹 · ② 키트 검증 AI · ③ 선행 피킹 · ④ 적응 장착 · ⑤ 재고 보충 · ⑥ 보울 피더) · 흐름 랙 재고 · 최근 키트 (js/kitcell.js)
import { KIT_SENSORS, KIT_TOPIC, KIT_PHASE_KO } from './kitcell.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { ok: '#3ddc84', warn: '#f5b82e', alarm: '#ff5a5a' };

export function kitHtml(M) {
  const S = M?.snapshot(); if (!S) return '';
  const v = S.sensors ?? {}, L = S.levels ?? {}, c = S.cur, st = S.stats, ai = S.ai, on = S.on;
  const lim = (s) => (s.alarm ? [s.alarm.lo != null ? `≤${s.alarm.lo}` : '', s.alarm.hi != null ? `≥${s.alarm.hi}` : ''].filter(Boolean).join(' · ') : '');
  const row = (s) => `<tr title="${esc(s.dev)}"><td>${esc(s.label)}</td><td style="color:${COL[L[s.key] ?? 'ok']};font-weight:700">${v[s.key] ?? '-'} <small>${esc(s.unit)}</small></td><td><small>${esc(lim(s))}</small></td></tr>`;
  const mode = ai ? '피지컬AI' : on ? '자동화' : '레거시';
  const items = [
    ['① 빈 피킹', c ? `${esc(c.pick.method)}${c.pick.conf != null && c.pick.conf < 1 ? ` (신뢰도 ${c.pick.conf})` : ''} · 부품 ${c.parts.length}개` : `키트 ${st.kits}개`,
      ai ? 'AMMR이 상자 속 섞인 브래킷·보강판을 비전으로 집음 — 새 부품도 따로 가르치지 않음' : on ? '레일 협동로봇 · 표시등이 켜진 칸만 (정해진 부품만)' : '작업자 키팅'],
    ['② 키트 검증 AI', `잘못 담음 ${st.errors}개 → 검증에서 ${st.caught}개 · C01에서 발견 ${st.missed}개`,
      ai ? '영상 + 무게로 누락·다른 사양·뒤집힘을 잡아 키팅 구역에서 다시 담음' : on ? '무게만 — 같은 무게의 좌/우·사양 차이는 C01 로봇 비전에서 발견해 다시 가져옴(+12초)' : '육안 — 절반만 잡음'],
    ['③ 순서 연동 선행 피킹', ai ? '혼류 순서를 보고 다음 판넬 키트를 미리 담음 · 순서가 바뀌면 키트를 다시 짬' : on ? '생산 순서대로 다음 키트를 미리 담음' : '작업자 판단', ''],
    ['④ 적응 장착', c?.mount ? `${esc(c.mount.method)}${c.mount.offset != null ? ` · 위치 보정 ${c.mount.offset}mm` : ''}${c.mount.force != null ? ` · 안착 ${c.mount.force}N` : ''}` : '대기',
      ai ? '트레이 위 부품 위치 편차를 손목 카메라로 보정하고 힘 제어로 판넬에 안착' : on ? '티칭 위치 · 위치 제어' : '작업자'],
    ['⑤ 재고·보충', S.stock.map((x) => `${x.pct}%${x.req ? '(보충 중)' : ''}`).join(' · ') + ` · 보충 ${st.replenish}회 · 결품 ${st.stockouts}회`,
      ai ? '흐름 랙을 비전으로 세어 35%에서 미리 칸반 보충 요청' : on ? '칸반 카드 — 20%에서 보충 요청' : '빈 칸이 보여야 보충 (결품으로 C01이 기다림)'],
    ['⑥ 보울 피더', `레벨 ${S.feed.join(' · ')}% · 막힘 ${st.jams}회${ai ? ` · 예측 처리 ${st.jamsAvoided}회` : ''}`,
      ai ? '진동·레벨로 막힘을 미리 알아 셀이 쉬는 동안 트랙 정리' : on ? '막히면 C01이 멈추고 작업자가 처리 (+20초)' : '막히면 작업자가 알아챌 때까지'],
  ].map(([h, b, s]) => `<li><b>${esc(h)}</b> · ${b}${s ? `<br><small>${esc(s)}</small>` : ''}</li>`).join('');
  const recs = S.records.slice(0, 6).map((r) => `<li><b style="color:${r.result === 'OK' ? COL.ok : COL.warn}">${esc(r.result)}</b> · ${esc(String(r.part).split('-').slice(-2).join('-'))} · ${esc(r.id)} · 부품 ${r.parts}개 · ${r.weight_g}g${r.stockout ? ' · 결품 대기' : ''}</li>`).join('') || '<li>아직 키트 기록 없음</li>';
  const evs = S.events.slice(0, 4).map((e) => `<li>${Math.floor(e.t / 60)}분 · ${esc(e.text)}</li>`).join('') || '<li>보충·피더 기록 없음</li>';
  return `<div class="mm">
    <h4>🧰 공급·키팅 · ${esc(S.spec.model)}</h4>
    <div class="mm-dec" style="border-color:${COL.ok}"><b style="color:${COL.ok}">${v.phase ? esc(KIT_PHASE_KO[v.phase]) : '대기'}</b>
      <span>${mode} · 키팅 구역(흐름 랙 3대 · 피킹 로봇 · 조립대 · 검증대) → 라인사이드 컨베이어 → C01 협동로봇 2대</span></div>
    <div class="mm-h">피지컬AI 적용 요소</div><ul class="mm-r">${items}</ul>
    <table class="mm-t"><thead><tr><th>센서</th><th>현재</th><th>경보</th></tr></thead><tbody>${KIT_SENSORS.map(row).join('')}</tbody></table>
    <div class="mm-h">최근 키트</div><ul class="mm-r">${recs}</ul>
    <div class="mm-h">보충 · 보울 피더</div><ul class="mm-r">${evs}</ul>
    <small>키트 ${st.kits}개 · 잘못 담음 ${st.errors} (검증 ${st.caught} · C01 발견 ${st.missed}) · 다시 담음 ${st.repick} · 피더 막힘 ${st.jams} · 토픽 ${esc(KIT_TOPIC)} (…/part · …/event)</small>
  </div>`;
}
