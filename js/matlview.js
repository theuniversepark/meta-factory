// 적응가공 소재 식별·3D측정셀 정보 (셀 정보 창) — 부스 센서 · 피지컬AI(① 파지 · ② 능동 스캔 · ③ 결함 AI · ④ 가공 여유 전달 · ⑤ OCR·LIBS AI · ⑥ 접촉 측정) · 최근 기록 · 격리 (js/matlcell.js)
import { MATL_SENSORS, MATL_TOPIC, MATL_PHASE_KO, REJECT_KO } from './matlcell.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COL = { ok: '#3ddc84', warn: '#f5b82e', alarm: '#ff5a5a' };
const GRASP = { VLA: 'VLA 범용 파지', teach: '티칭 파지', manual: '작업자' };

export function matlHtml(M) {
  const S = M?.snapshot(); if (!S) return '';
  const v = S.sensors ?? {}, L = S.levels ?? {}, c = S.cur, st = S.stats, A = S.avg, ai = S.ai, on = S.on;
  const lim = (s) => (s.alarm ? [s.alarm.lo != null ? `≤${s.alarm.lo}` : '', s.alarm.hi != null ? `≥${s.alarm.hi}` : ''].filter(Boolean).join(' · ') : '');
  const row = (s) => `<tr title="${esc(s.dev)}"><td>${esc(s.label)}</td><td style="color:${COL[L[s.key] ?? 'ok']};font-weight:700">${v[s.key] ?? '-'} <small>${esc(s.unit)}</small></td><td><small>${esc(lim(s))}</small></td></tr>`;
  const mode = ai ? '피지컬AI' : on ? '자동화' : '레거시';
  const items = [
    ['① 주조품 범용 파지', c ? `${GRASP[c.grasp.method]}${c.grasp.method === 'VLA' ? ` · 후보 ${c.grasp.candidates}개 (신뢰도 ${c.grasp.conf})` : ''}` : `VLA 파지 ${st.vla}회`,
      ai ? '거친 주조 표면·어긋난 놓임 자세를 보고 파지 자세를 골라 힘 제어로 턴테이블 기준 핀에 끼운다' : on ? '제품별 티칭 파지점 · 위치 제어' : '작업자가 옮긴다'],
    ['② 능동 스캔 경로', c?.views ? `뷰 ${c.views}개 · 커버리지 ${c.coverage}%` : A.views != null ? `평균 뷰 ${A.views}개 · 커버리지 ${A.cover}%` : '대기',
      ai ? 'Next-Best-View — 빠진 면을 채우는 자세만 골라 최소 횟수로 끝냄 · 반사면은 노출·각도 조정' : on ? '고정 12뷰 프로그램' : '스캔 없음 (버니어 · 육안)'],
    ['③ 주조 결함 AI', c?.defect != null ? `결함 점수 ${c.defect}${c.kind === 'reject' && c.reason === 'defect' ? ' → 격리' : ''}` : `결함 격리 ${st.defect}개`,
      ai ? '스캔 영상 이상 탐지 — 기공·균열·탕경계를 찾아 격리' : on ? '규칙 판정 문턱 — 작은 결함은 놓칠 수 있음' : '육안'],
    ['④ 가공 여유 → 가공셀 전달', c ? `최소 여유 ${c.minAllow}mm · 원점 이동 (${c.shift.x}, ${c.shift.y}, ${c.shift.z})mm${c.offset ? ` → 사이클 ×${c.cutMul} · 공구 마모 ×${c.wearMul}` : ''}` : `전달 ${st.feed}개`,
      ai ? 'CAD 베스트핏으로 면마다 여유를 재 다음 가공셀(5축 가공 · 정밀절삭)에 원점 보정·첫 절입량을 넘김 — 헛절삭·흑피 과부하 감소' : on ? '베스트핏은 합불만 — 가공 프로그램은 고정 여유' : '버니어로 여유 부족만 거름'],
    ['⑤ 각인 OCR · 재질 판별 AI', c ? `${esc(c.ocr.method)}${c.ocr.conf != null ? ` ${c.ocr.conf}` : ''}${c.ocr.manual ? ' (작업자 확인)' : ''} · ${c.libs ? `${esc(c.libs.alloy)} ${Math.round(c.libs.conf * 100)}% (${esc(c.libs.method)})` : '재질 분석 없음'}` : `AI OCR ${st.ocrAi}회 · 작업자 확인 ${st.ocrManual}회`,
      ai ? '흐릿한 주조 각인을 딥러닝 OCR로 · LIBS 스펙트럼을 AI로 분류해 합금 확인' : on ? '규칙 OCR(낮은 신뢰도면 작업자 확인) · LIBS 특성선 비율' : '작업자 대조'],
    ['⑥ 접촉 측정', c?.force != null ? `프로브 접촉 ${c.force}N` : A.force != null ? `평균 ${A.force}N` : '대기',
      ai ? '양팔 로봇 — 한 손으로 소재를 누르고 다른 손으로 프로브를 일정한 힘으로 댐' : on ? '협동로봇 프로브 — 위치 제어' : '작업자'],
  ].map(([h, b, s]) => `<li><b>${esc(h)}</b> · ${b}<br><small>${esc(s)}</small></li>`).join('');
  const recs = S.records.slice(0, 6).map((r) => `<li><b style="color:${r.reason ? COL.alarm : COL.ok}">${r.reason ? `격리 (${esc(REJECT_KO[r.reason])})` : 'OK'}</b> · ${esc(String(r.part).split('-').slice(-2).join('-'))} · ${esc(r.lot)}/${esc(r.heat)} · ${r.alloy ? esc(r.alloy) + ' · ' : ''}${r.views ? `뷰 ${r.views} · ` : ''}여유 ${r.minAllow_mm}mm · ${r.weight_kg}kg</li>`).join('') || '<li>아직 기록 없음</li>';
  return `<div class="mm">
    <h4>🔍 소재 식별·3D측정 · ${esc(S.spec.model)}</h4>
    <div class="mm-dec" style="border-color:${COL.ok}"><b style="color:${COL.ok}">${v.phase ? esc(MATL_PHASE_KO[v.phase]) : '대기'}</b>
      <span>${mode} · ID 판독 게이트(RFID · DPM/OCR) · LIBS 재질 분석 · 3D 스캔 부스(턴테이블·저울·스캔 로봇) · 격리 랙 · 이송 6축</span></div>
    <div class="mm-h">피지컬AI 적용 요소</div><ul class="mm-r">${items}</ul>
    <table class="mm-t"><thead><tr><th>센서</th><th>현재</th><th>경보</th></tr></thead><tbody>${MATL_SENSORS.map(row).join('')}</tbody></table>
    <div class="mm-h">최근 소재 (격리율 ${st.parts ? Math.round((st.reject / st.parts) * 1000) / 10 : 0}% · 놓친 불량 ${st.missed}개)</div><ul class="mm-r">${recs}</ul>
    <small>소재 ${st.parts}개 · 격리 ${st.reject}개 (결함 ${st.defect} · 여유 부족 ${st.allow} · 재질 혼입 ${st.alloy}) · 스캔 뷰 누계 ${st.views} · 가공셀 전달 ${st.feed}개 · 토픽 ${esc(MATL_TOPIC)} (…/part)</small>
  </div>`;
}
