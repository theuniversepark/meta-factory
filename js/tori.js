// 토리(Tori) — 피지컬AI 실증 메타팩토리 공장장 아바타. 화면 오른쪽 아래에 서서(그림 애니메이션), 처음 접속하면 인사하고
// 주제별로 안내한다: 메타팩토리 둘러보기(단계 · Zone 카메라 이동 · 주요 버튼 강조) · 인시던트 해결 예시(실제로 현장 이벤트를 일으켜 진행 상황을 읽어 줌)
//   · 데이터 폐루프 · 데이터 플라이휠(고리 그림에 지금 단계 표시) · 매뉴얼·앱 내려받기
// 접으면 작은 얼굴만 남고, 누르면 주제 메뉴.
// 자동 넘김: 말이 끝난 뒤(음성이 없으면 읽는 시간 뒤) 1초 동안 「다음」을 누르지 않으면 다음 단계로 (첫 인사도 둘러보기 시작) — 메뉴 · 주제 마지막 단계는 기다림,
//   실제로 일어나기를 기다리는 단계(인시던트 감지 · 출동 · 처리)는 ready()가 참이 된 뒤부터 (최대 90초)
// 그리기: 토리 전용 캔버스를 WebGPU(three/webgpu WebGPURenderer)로 — 메인 3D 화면(WebGL)과 따로라 공장 화면 속도와 무관
//   WebGPU를 쓸 수 없는 브라우저 · 공유 아티팩트에서는 같은 장면을 WebGL로 그린다 (모양 · 동작 같음)
// 말: 말풍선 글자와 브라우저 내장 한국어 음성(speechSynthesis — 설치 · 비용 없음)을 함께 · 🔊로 음성만 끌 수 있음
//   브라우저는 사용자가 화면을 누르기 전에는 소리를 막으므로, 그 전에 나온 말은 첫 클릭 때 읽는다 (앱은 처음부터 — electron/main.mjs autoplayPolicy)
// 안내 내용은 앱의 실제 구성에서 가져왔다: 센서망 계층(js/sensors.js) · VLA 학습·배포(js/vla.js) · AIOS(js/aios.js) · 데이터 연동(js/datahub.js)
import * as THREE from 'three';
import { PRODUCTS } from './serial.js';

const SEEN = 'mf.tori.seen', VOICE = 'mf.tori.voice';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 등 */ } } };

// 흐름 막대: 제품 ID 추적 7단계 (아래 작은 글씨 = 그 단계에서 붙는 ID)
const CHAIN = [['오더', ''], ['자재', '원자재 로트'], ['투입', '생산 ID'], ['공정', '셀별 이력'], ['판정', '제품 ID'], ['출하', '팔레트 SSCC'], ['이후', '조회 · 리콜']];
function chainSvg(at) {
  const W = 336, H = 70, n = CHAIN.length, gap = W / n;
  const nodes = CHAIN.map(([l, sub], k) => { const x = gap * k + gap / 2, on = at < 0 || k <= at, cur = k === at;
    return `<g class="tr-n${on ? ' on' : ''}${cur ? ' cur' : ''}"><rect x="${x - 19}" y="10" width="38" height="22" rx="11"/><text x="${x}" y="25" text-anchor="middle">${l}</text>${sub ? `<text x="${x}" y="${k % 2 ? 62 : 48}" text-anchor="middle" class="tr-sub">${sub}</text>` : ''}</g>`; }).join('');
  const arrows = CHAIN.slice(1).map((_, k) => { const x1 = gap * k + gap / 2 + 20, x2 = gap * (k + 1) + gap / 2 - 22, on = at < 0 || k < at;
    return `<path d="M${x1} 21 L${x2} 21" class="tr-a${on ? ' on' : ''}" marker-end="url(#tc-h${on ? '1' : '0'})"/>`; }).join('');
  return `<svg class="tori-ring" viewBox="0 0 ${W} ${H}" role="img" aria-label="제품 ID 추적: ${CHAIN.map((c) => c[0]).join(' → ')}"><defs>${[0, 1].map((o) => `<marker id="tc-h${o}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="tr-h${o ? ' on' : ''}"/></marker>`).join('')}</defs>${arrows}${nodes}</svg>`;
}
// 실제 제품 예시 (시뮬레이션의 시리얼 서비스 · 제품 추적에서 읽음)
const prodKo = (p) => PRODUCTS[p]?.label ?? p;
const clock = (t) => { const x = Math.floor(t) + 8 * 3600; return `${String(Math.floor(x / 3600) % 24).padStart(2, '0')}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}`; };
const ex = {
  order: (s) => { const F = s?.fos; if (!F) return null; const o = F.orders.find((x) => x.status === 'open' && x.evidenced !== true) ?? F.orders[0]; return o ? { o, good: F.main?.reconcile?.(o.id)?.good ?? 0 } : null; },
  wip: (s, minSteps = 0) => s?.trace?.recent?.findLast((r) => r.status === 'wip' && !r.serial && r.steps.length >= minSteps) ?? null,
  serial: (s) => s?.serials?.units?.findLast((u) => u.serial && u.zone === 'main') ?? s?.serials?.units?.findLast((u) => u.serial) ?? null,
  pallet: (s) => s?.serials?.pallets?.[0] ?? null,
  shipped: (s) => s?.serials?.units?.findLast((u) => u.loc === 'shipped' && u.serial) ?? null,
};
const cellName = (s, id) => s?.processing?.find((st) => st.id === id)?.name ?? id;

// 고리 그림: 데이터 폐루프 6단계 · 플라이휠 5단계 (마지막 → 처음으로 이어짐)
const RINGS = {
  loop: ['수집', '엣지', '서버·연동', 'AI 학습', '모니터링', '현장 제어'],
  fly: ['운영', '데이터', '학습', '배포', '성능 향상'],
};
// 주제별 단계: 말 · 카메라(Zone 시점) · 단계 전환 · 강조할 화면 요소 · 고리 그림(지금 단계)
const TOPICS = {
  tour: { name: '메타팩토리 둘러보기', steps: [
    { say: '안녕하세요! 저는 피지컬AI 실증 메타팩토리 공장장 토리예요. 이곳은 레거시 공장이 자동화를 거쳐 피지컬AI 자율공장으로 바뀌는 과정을 3D 디지털 트윈으로 보여 주는 시뮬레이터예요. 2분 정도 함께 둘러볼까요?', view: 'all', start: true },
    { say: '화면 위 단계 버튼으로 레거시 → 자동화 → 피지컬AI를 바꿀 수 있어요. 같은 라인을 세 단계로 운영해서 생산량 · OEE · 재공이 어떻게 달라지는지 비교해요.', hl: ['#modeSeg'] },
    { say: '지금 피지컬AI 단계로 바꿨어요. 이 단계에서는 휴머노이드 · AMMR · 사족보행 로봇과 드론이 현장을 맡고, 로봇 카메라 영상을 보고 동작을 정하는 VLA 모델이 일해요.', mode: 'dark', hl: ['#modeSeg'] },
    { say: '가운데가 정밀조립Zone이에요. 도어트림과 e-axle을 혼류 생산하고, 부품분류 → 조립 → 체결 → 검사·포장 6개 셀이 이어져 있어요.', view: 'precision' },
    { say: '뒤쪽은 유연생산Zone이에요. 후드와 도어를 공급·키팅 → 용접 → 실링 → 롤러 헤밍 → 정밀 장착 → 치수·외관검사 순서로 만들어요.', view: 'flex' },
    { say: '앞쪽은 적응가공Zone이에요. 유압블록과 리어커버를 소재 식별 → 5축 가공 · 디버링 · 선삭 → 초정밀 측정 순서로 가공해요.', view: 'adapt' },
    { say: '오른쪽은 정밀검사Zone이에요. 세 Zone에서 시료를 받아 비전 · 3D 스캔 · 정밀측정 · CT로 검사하고 AI가 판정해요.', view: 'insp' },
    { say: '오른쪽 패널은 공장 운영 AI예요. 고장 · 공급 차질 · 현장 이벤트를 관찰 → 판단 → 실행한 기록이 남아요. 아래 입력창에 "포장셀 속도 80%"처럼 지시할 수도 있어요.', hl: ['#agentPanel'] },
    { say: '위쪽 버튼에서는 로봇 데이터로 VLA 학습, 운영 AI 학습, KPI 영향 분석, 품질 추적, Zone 대시보드를 볼 수 있어요.', hl: ['#btnVla', '#btnAios', '#btnImpact', '#btnTrace', '#btnZoneDash'] },
    { say: '아래 버튼으로 설비 고장이나 현장 이벤트를 일부러 일으켜 보세요. 에이전트가 어떻게 대응하는지 볼 수 있어요. CCTV · 5G · 센서 배치도 여기서 봐요.', hl: ['#btnFault', '#btnEvent', '#btnCctv'] },
    { say: '설비를 누르면 상세 정보가, 🏷 라벨 버튼을 누르면 이름표가 보여요. 저를 누르면 인시던트 해결 예시, 제품 ID 추적, 데이터 폐루프 · 플라이휠, 매뉴얼 · 앱 내려받기도 안내해 드려요!', view: 'all', hl: ['#btnLabels'], end: true },
  ] },
  // 인시던트 해결 예시: 실제로 현장 이벤트를 일으키고, 시뮬레이션의 이벤트 기록(감지 · 대응 로봇 · 처리 시각)을 1초마다 읽어 진행 상황을 말한다
  incident: { name: '인시던트 해결 예시', steps: [
    { say: '예시로 현장에 문제를 하나 일으켜 볼게요. 피지컬AI 단계의 정밀조립Zone이에요. 「다음」을 누르면 로봇 카메라 앞에 바닥 누유 · 이물질 · 연기 의심 · 무단 진입 중 하나가 생겨요.', mode: 'dark', view: 'precision' },
    { act: (T) => { T.ev = T.h.injectEvent?.() ?? null; if (T.ev) T.h.look?.(T.ev.x, T.ev.z); }, hl: ['#btnEvent'],
      voice: '방금 현장에 문제가 생겼어요. 아직 아무도 모르는 상태예요. 화면이 그 자리로 이동했어요. 빨간 표지와 빛기둥이 보이죠? 화면 위쪽에 오케스트레이터 흐름도도 열렸어요.',
      say: (T) => T.ev ? `방금 「${T.ev.label}」 상황이 생겼어요 (우선순위 P${prioOf(T.ev)}). 아직 아무도 모르는 상태예요. 화면이 그 자리로 이동했어요 — 빨간 표지와 빛기둥이 보이죠? 화면 위쪽에 오케스트레이터 흐름도도 열렸어요.` : '지금은 현장 이벤트를 만들 수 없어요. 피지컬AI 단계에서 ⚠ 현장 이벤트 버튼으로 다시 해 보세요.' },
    { live: true, ready: (T) => !T.ev || T.ev.detected || T.ev.cleared, hl: ['#orchPanel'], voice: '첫째, AI 감지. 근처 로봇 카메라 영상을 AI가 추론해 이상을 찾아요. 감지되면 인시던트가 열리고, 주변 AMR과 로봇은 속도를 줄이거나 반경 밖으로 돌아가요.',
      say: (T) => `① AI 감지 — 근처 로봇 카메라 영상을 AI가 추론해 이상을 찾아요. ${!T.ev ? '' : T.ev.detected ? `${ga(T.ev.detectedBy)} ${sec(T.ev.tDetect - T.ev.t0)} 만에 감지했어요 (신뢰도 ${Math.round((T.ev.conf ?? 0) * 100)}%).` : '지금 찾는 중이에요…'} 감지되면 인시던트가 열리고, 주변 AMR · 로봇은 속도를 줄이거나 반경 밖으로 돌아가요.` },
    { hl: ['#orchPanel'], voice: '둘째, 보고와 판단. 셀이 공장 오케스트레이터에 보고하면, 오케스트레이터가 화재와 인명, 시설과 작업 안전, 생산 정지 순으로 우선순위를 정하고 대응 로봇을 골라요. 피지컬AI 단계는 판단이 1.5초, 화재와 인명 사고는 0.4초예요.',
      say: (T) => `② 보고 · 판단 — 셀이 공장 오케스트레이터에 보고하면, 오케스트레이터가 우선순위(P1 화재 · 인명 → P2 시설 · 작업 안전 → P3 생산 정지 …)를 정하고 대응 로봇을 골라요. 피지컬AI 단계는 판단이 1.5초, 화재 · 인명(P1)은 0.4초예요.${T.ev ? ` 이번 건은 ${ieyo(`P${prioOf(T.ev)}`)}.` : ''}` },
    { live: true, ready: (T) => !T.ev || !!T.ev.responder || T.ev.type === 'intrusion' || T.ev.cleared, voice: '셋째, 피지컬AI 출동. 정비 휴머노이드는 흡착포와 수거 도구, 소화기를 챙겨 가고, 사족보행 로봇은 열화상과 가스 센서로 점검해요. 순찰 드론도 하늘에서 현장을 확인해요.',
      say: (T) => `③ 피지컬AI 출동 — ${!T.ev ? '' : T.ev.type === 'intrusion' ? '사람이 안전구역을 나갈 때까지 주변 로봇이 안전 속도로 기다려요.' : T.ev.responder ? `${ga(T.ev.responder)} 출동했어요.` : '대응 로봇을 배정하는 중이에요…'} 정비 휴머노이드는 흡착포 · 수거 도구 · 소화기를 챙겨 가고, 사족보행 로봇은 열화상 · 가스 센서로 점검해요. 순찰 드론도 하늘에서 현장을 확인해요.` },
    { live: true, ready: (T) => !T.ev || T.ev.cleared, hl: ['#btnOrch', '#btnImpact'], voice: '넷째, 해결과 기록. 처리가 끝나면 흐름도에 감지부터 셀 자체 조치, 상위 보고, 판단, 명령, 조치, 완료 확인까지의 시각이 남아요. 이 기록은 KPI 영향 분석과 운영 AI 학습 데이터가 돼요.',
      say: (T) => `④ 해결 · 기록 — ${!T.ev ? '' : T.ev.cleared ? `${sec((T.ev.tClear ?? T.ev.t0) - T.ev.t0)} 만에 처리가 끝났어요.` : '처리 중이에요… 끝나면 여기에 시간이 나와요.'} 흐름도에는 감지 → 셀 자체 조치 → 상위 보고 → 판단 → 명령 → 조치 → 완료 확인 시각이 남고, 이 기록은 KPI 영향 분석과 운영 AI(AIOS) 학습 데이터가 돼요.` },
    { say: '이렇게 AI는 보고 판단하고, 피지컬AI 로봇은 직접 가서 해결해요. 사람은 흐름도와 대시보드로 확인하고 필요할 때만 지시하면 돼요. ⚡ 설비 고장이나 ⚠ 현장 이벤트 버튼으로 다른 상황도 시험해 보세요!', hl: ['#btnFault', '#btnEvent'], end: true },
  ] },
  loop: { name: '데이터 폐루프', steps: [
    { say: '메타팩토리의 데이터는 한 번 쓰고 끝나지 않아요. 현장에서 모은 데이터가 엣지와 서버를 거쳐 AI 학습 · 모니터링에 쓰이고, 그 결과가 다시 현장 제어로 돌아와요. 이 닫힌 고리를 데이터 폐루프라고 해요.', ring: 'loop', at: -1, view: 'all' },
    { say: '① 수집 — 로봇의 관절 · 손끝 위치 · 카메라 영상, 설비 상태, 진동 · 온도 같은 환경 센서, CCTV, AMR · 드론 위치를 모아요. 모든 데이터에는 공장 기준 시계(PTP)의 같은 시각이 붙어요.', ring: 'loop', at: 0, hl: ['#btnSensors', '#btnCctv'] },
    { say: '② 엣지 — 셀 엣지가 센서 값을 모아 RMS · 첨도 · FFT 같은 특징을 뽑고 1초씩 묶어요. 엣지 게이트웨이는 프로토콜을 바꾸고, 연결이 끊겨도 잠시 저장했다가 보내요. 셀 제어기는 VLA 파지 · 체결 판정 같은 엣지 스킬을 현장에서 바로 실행해요.', ring: 'loop', at: 1, hl: ['#btnSensors'] },
    { say: '③ 서버 · 연동 — 존 서버를 거쳐 공장 중앙의 MQTT 브로커(UNS)로 모이고, AAS 모델과 OPC UA PubSub 형식으로 다른 시스템과 주고받아요. 센서 DB, 로봇 에피소드, 운영 데이터셋이 서버에 쌓여요.', ring: 'loop', at: 2, hl: ['#btnData'] },
    { say: '④ AI 학습 — 로봇 데이터와 카메라 영상은 AI-ready 에피소드가 되어 VLA 모델을 학습하고, 생산 · 설비 · 물류 · 에너지 · 품질 데이터는 운영 데이터셋이 되어 공장 운영 AI(AIOS)의 정책을 학습해요.', ring: 'loop', at: 3, hl: ['#btnVla', '#btnAios'], mode: 'dark' },
    { say: '⑤ 모니터링 — Zone 대시보드에서 OEE · 6대 손실 · 관리도를, FACOS 패널에서 공장 · 존 · 셀 상태를 실시간으로 봐요. KPI 영향 분석은 이벤트가 생산량 · OEE · 재공 · 전력에 미친 손실을 나눠 보여 줘요.', ring: 'loop', at: 4, hl: ['#btnZoneDash', '#btnImpact'] },
    { say: '⑥ 현장 제어 — 검증된 모델은 로봇과 오케스트레이터에 배포되고, 오케스트레이터는 판단을 셀 현장 명령(정지 · 속도 · 정비 · 투입)으로 내려보내요. 그 결과가 다시 ① 수집으로 돌아오면서 고리가 닫혀요.', ring: 'loop', at: 5, hl: ['#btnOrch'] },
    { say: '정리하면 수집 → 엣지 → 서버 → AI 학습 · 모니터링 → 현장 제어 → 다시 수집이에요. 이 고리가 돌 때마다 공장이 조금씩 더 똑똑해지는데, 그 이야기가 데이터 플라이휠이에요.', ring: 'loop', at: 6, end: true, next: 'fly' },
  ] },
  fly: { name: '데이터 플라이휠', steps: [
    { say: '플라이휠은 한 번 돌기 시작하면 점점 더 빨리 도는 무거운 바퀴예요. 로봇이 일할수록 데이터가 쌓이고, 데이터가 쌓일수록 모델이 좋아지고, 모델이 좋아지면 로봇이 더 많은 일을 더 잘하게 돼요.', ring: 'fly', at: -1 },
    { say: '운영 → 데이터 — 피지컬AI 단계에서 로봇은 작업 사이클 세 번에 한 번을 에피소드로 기록해요. 0.2초 간격의 관절 · 손끝 · 그리퍼 기록과 카메라 영상, 자연어 작업 지시, 성공 여부가 함께 저장돼요.', ring: 'fly', at: 0, hl: ['#btnVla'], mode: 'dark' },
    { say: '데이터 → 학습 — 새 에피소드가 200개 쌓이면 VLA 학습이 자동으로 시작돼요. 공장 운영 AI는 10초마다 모은 운영 데이터를 10분 단위 데이터셋으로 묶어 학습해요.', ring: 'fly', at: 1, hl: ['#btnVla', '#btnAios'] },
    { say: '학습 → 배포 — 새 모델은 검증 성공률이 나아졌을 때만 배포돼요. 로봇 한 대에 먼저 배포해 지켜본 뒤 전체로 넓히고, 운영 AI는 디지털트윈에서 지금 정책과 비교해 검증한 뒤 추천 모드부터 적용해요. 나빠지면 자동으로 되돌려요.', ring: 'fly', at: 2, hl: ['#btnVla', '#btnAios'] },
    { say: '배포 → 성능 향상 — 좋아진 모델로 성공한 작업이 늘고, 고장 · 현장 이벤트 같은 새 상황의 데이터도 쌓여요. 에피소드마다 어떤 모델 버전으로 일했는지 남아서 버전별 성과를 비교할 수 있어요.', ring: 'fly', at: 3, hl: ['#btnImpact'] },
    { say: '성능 향상 → 다시 운영 — 더 잘 일하는 로봇이 더 많은, 더 좋은 데이터를 만들어 바퀴가 다시 돌아요. 바퀴를 빨리 돌리는 열쇠는 데이터 품질이라서, 같은 기준 시계와 스텝 시각 · 보간 여부 · 영상 시각 차이까지 기록해요.', ring: 'fly', at: 4 },
    { say: '데이터 폐루프가 길이라면, 데이터 플라이휠은 그 길을 돌수록 빨라지는 힘이에요. 궁금한 주제가 있으면 언제든 저를 눌러 주세요!', ring: 'fly', at: 5, end: true },
  ] },
  // 제품 ID 추적: 단계마다 그 현장으로 카메라를 옮겨 확대하고(cam), 3초 뒤 관련 창을 연다(panel) — 설명을 메타팩토리 기능과 바로 연결
  trace: { name: '제품 ID 추적 — 오더부터 출하 이후까지', tour: true, steps: [
    { chain: -1, cam: { view: 'precision' }, panel: null,
      say: '제품 하나의 일생은 ID로 이어져요. 생산에 들어갈 때 생산 ID, 품질검사에 합격하면 제품 고유 ID, 출하할 때는 팔레트 ID가 붙어요. 오더부터 출하 이후까지 그 흐름을 현장과 화면으로 따라가 볼게요.' },
    { chain: 0, cam: { view: 'all' }, panel: { kind: 'orch', tab: 'fos' }, hl: ['#orchPanel'],
      voice: '첫째, 오더. 공장 오케스트레이터가 오더를 받아 각 Zone에 배정해요. 양품 목표와 혼류 비율, 납기가 함께 내려가고, 앱에서는 ERPNext 작업지시와도 연동돼요. 오케스트레이터 창의 Factory OS 탭에서 오더 진행을 볼 수 있어요.',
      say: (T) => { const o = ex.order(T.h.sim?.()); return `① 오더 — 공장 오케스트레이터가 오더를 받아 Zone에 배정해요.${o ? ` 지금 오더는 ${o.o.id}: 양품 목표 ${o.o.target}개 중 ${o.good}개 완료, 납기 ${clock(o.o.due)}.` : ''} 양품 목표 · 혼류 비율 · 납기가 함께 내려가고, 앱에서는 ERPNext 작업지시와도 연동돼요.`; }, live: true },
    { chain: 1, cam: { x: -46, z: 33, d: 22 }, panel: { kind: 'fac', tab: 'po' }, hl: ['#btnFac'],
      voice: '둘째, 자재 준비. 창고 재고가 재주문점 아래로 내려가면 구매오더가 확정되고, 입고 트럭이 이 도크로 들어와요. 들어온 자재에는 원자재 로트가 붙고, AGV가 투입구까지 날라요. FAC 창에서 구매오더와 입고 전표, 재고를 볼 수 있어요.',
      say: '② 자재 준비 — 창고 재고가 재주문점 아래로 내려가면 구매오더가 확정되고, 입고 트럭이 이 도크(왼쪽 벽)로 들어와요. 들어온 자재에는 원자재 로트가 붙고, AGV가 투입구까지 날라요. FAC 창에서 구매오더 · 입고 전표 · 재고를 볼 수 있어요.' },
    { chain: 2, cam: { station: 'SRC', d: 11 }, panel: null,
      voice: '셋째, 생산 투입. 자재가 투입구에서 AMR 지그에 오르는 순간 생산 ID가 붙어요. 이후 공정 기록은 모두 이 생산 ID에 쌓여요.',
      say: (T) => { const r = ex.wip(T.h.sim?.()); return `③ 생산 투입 — 자재가 투입구에서 AMR 지그에 오르는 순간 생산 ID가 붙어요.${r ? ` 방금 투입된 ${eun(prodKo(r.product))} ${r.wip} · 원자재 로트 ${r.lot}${r.amr ? ` · 운반 ${r.amr}` : ''}이에요.` : ''} 이후 공정 기록은 모두 이 ID에 쌓여요.`; }, live: true },
    { chain: 3, act: (T) => { T.exWip = ex.wip(T.h.sim?.(), 2) ?? ex.wip(T.h.sim?.()); },
      cam: (T) => ({ station: T.exWip?.steps.at(-1)?.id ?? 'DT_ASSY', d: 12 }), panel: (T) => ({ kind: 'trace', tab: 'trace', id: T.exWip?.wip }), hl: ['#btnTrace'],
      voice: '넷째, 생산 중 추적. 셀을 지날 때마다 그 셀의 로봇과 VLA 모델 버전, 운반 AMR, 설비 건강도, 체결 토크 같은 공정 측정값, 그 자리 환경값이 이 제품의 이력으로 기록돼요. 품질 추적 창에서 셀별 이력을 볼 수 있어요.',
      say: (T) => { const r = T.exWip, s = T.h.sim?.(); return `④ 생산 중 추적 — 셀을 지날 때마다 로봇 · VLA 모델 버전 · 운반 AMR · 설비 건강도 · 공정 측정값(체결 토크 · 각도 · 압입 하중) · 그 자리 환경값이 기록돼요.${r ? ` 지금 ${eun(r.wip)} ${cellName(s, r.steps.at(-1)?.id)}에 있고, 지금까지 셀 ${r.steps.length}곳의 기록이 쌓였어요.` : ''}`; }, live: true },
    { chain: 4, act: (T) => { T.exSer = ex.serial(T.h.sim?.()); }, cam: { station: 'PACK', d: 11 }, panel: (T) => ({ kind: 'trace', tab: 'serial', id: T.exSer?.serial }), hl: ['#btnTrace'],
      voice: '다섯째, 품질 판정. 체결셀에서 토크와 각도를 전수 검사하고, 검사 포장셀에서 합격하면 중앙 발행기가 제품 고유 ID를 발행해요. QR 라벨이나 금속 각인으로 표시하고 바로 판독해 검증해요. 불합격이면 불량 사례가 열리고 AI가 원인 셀을 찾아요.',
      say: (T) => { const u = T.exSer; return `⑤ 품질 판정 — 체결셀에서 토크 · 각도를 전수 검사하고, 검사·포장셀에서 합격하면 중앙 발행기가 제품 고유 ID를 발행해요(품목별 순차 · 재사용 없음).${u ? ` 최근 합격한 ${prodKo(u.product)}: 제품 ID ${u.serial} ← 생산 ID ${u.wip}, ${u.mark?.symbol === 'DM' ? '금속 각인 DataMatrix' : 'QR 라벨(GS1 Digital Link)'} 판독 등급 ${u.mark?.grade ?? '-'}.` : ''} 불합격이면 불량 사례가 열리고 AI가 원인 셀을 찾아요.`; } },
    { chain: 5, act: (T) => { T.exPal = ex.pallet(T.h.sim?.()); }, cam: { x: 47, z: -25, d: 26 }, panel: (T) => ({ kind: 'trace', tab: 'serial', id: T.exPal?.units?.[0] }), hl: ['#btnTrace'],
      voice: '여섯째, 포장과 출하. 합격품은 팔레트에 실리고, 팔레트마다 SSCC가 붙어 팔레트와 제품 ID가 묶여요. 트럭과 출하 시각도 함께 기록돼요. 정밀검사 샘플 결과에 따라 로트 출하를 보류하거나 풀어요.',
      say: (T) => { const p = T.exPal; return `⑥ 포장 · 출하 — 합격품은 팔레트에 실리고, 팔레트마다 SSCC가 붙어 팔레트와 제품 ID가 묶여요(EPCIS 묶음 이벤트). 트럭 · 출하 시각도 기록돼요.${p ? ` 최근 팔레트 ${p.sscc}에 ${prodKo(p.product)} ${p.units.length}개${p.truck ? ` · ${p.truck}로 출하` : ' · 출하 대기'}.` : ' 아직 만들어진 팔레트가 없어요.'} 정밀검사 샘플 결과에 따라 로트 출하를 보류하거나 풀어요.`; } },
    { chain: 6, act: (T) => { T.exShip = ex.shipped(T.h.sim?.()); }, cam: { x: 56, z: -25, d: 34 },
      panel: (T) => (T.exShip ? { kind: 'trace', tab: T.exShip.zone === 'main' ? 'trace' : 'serial', id: T.exShip.serial, epcis: true } : { kind: 'trace', tab: 'serial' }), hl: ['#btnTrace'],
      voice: '일곱째, 출하 이후. 제품 라벨의 QR 코드로 제품 ID를 조회하면 생산 이력까지 이어져요. 문제가 생기면 트럭에서 팔레트, 제품 ID로 리콜 범위를 찾고, 거꾸로 원인 셀과 로트, 시간대로 영향 범위를 좁혀요. 모든 기록은 GS1 EPCIS 표준 이벤트라 고객사와 협력사 시스템과 공유할 수 있어요. 이 시뮬레이터는 출하까지 기록하고, 판매 이후 A/S와 반품 데이터도 같은 ID로 이어 붙일 수 있는 구조예요.',
      say: (T) => { const u = T.exShip; return `⑦ 출하 이후 — 제품 라벨의 QR(GS1 Digital Link)로 제품 ID를 조회하면 생산 이력까지 이어져요. 문제가 생기면 트럭 → 팔레트 → 제품 ID로 리콜 범위를, 거꾸로 원인 셀 · 로트 · 시간대로 영향 범위를 찾아요.${u ? ` 예: ${eun(u.serial)} ${u.ship?.truck ?? '트럭'}에 실려 출하됐고, EPCIS 저장소에 발행 → 적재 → 팔레트 → 출하 이벤트가 남아 있어요.` : ' (아직 출하된 제품이 없어 조회 예시는 생략해요.)'} 시뮬레이터는 출하까지 기록하고, 판매 이후 A/S · 반품 데이터도 같은 ID로 이어 붙일 수 있는 구조예요.`; } },
    { chain: 7, cam: { view: 'all' }, panel: null, end: true,
      say: '제품 ID 하나로 오더 · 자재 · 공정 · 품질 · 출하가 이어지면, 문제가 생겨도 원인과 범위를 바로 찾을 수 있어요. 이 데이터는 품질 원인 분석과 AI 학습, 고객 신뢰의 바탕이 돼요.' },
  ] },
  // 매뉴얼 · 앱 내려받기 — 앱 내려받기는 웹 버전(⬇ 버튼이 보일 때)에서만 안내한다 (맥 · 윈도우 앱과 npm start에는 내려받기 기능이 없음)
  docs: { name: '매뉴얼 · 앱 내려받기', steps: [
    { voice: '책 모양의 사용자 가이드 버튼을 누르면 사용자 가이드 PDF를 내려받아요. 설치부터 화면 구성, 운영 시나리오 실습, 데이터 내보내기, 문제 해결까지 담겨 있어요.', say: '📘 버튼을 누르면 사용자 가이드(PDF)를 내려받아요. 설치부터 화면 구성, 운영 시나리오 실습, 데이터 내보내기, 문제 해결까지 담겨 있어요.', hl: ['#btnGuide'] },
    { when: () => isWeb(), voice: '앱 내려받기 버튼에서는 맥과 윈도우 앱을 내려받을 수 있어요. 맥은 애플 실리콘, 윈도우는 64비트 10과 11이에요. 앱에서는 서버 저장, MQTT 발행, MP4 녹화, 자연어 공정 설계 Agent까지 전체 기능을 내 컴퓨터에서 써요.', say: '⬇ 버튼에서는 맥(Apple Silicon)과 윈도우(64비트 10 · 11) 앱을 내려받을 수 있어요. 앱에서는 서버 저장 · MQTT 발행 · MP4 녹화 · 자연어 공정 설계 Agent까지 전체 기능을 내 컴퓨터에서 써요.', hl: ['#btnApps'] },
    { when: () => isWeb(), say: '맥은 압축을 풀어 응용 프로그램 폴더로 옮기고 처음 한 번 우클릭 → 열기, 윈도우는 폴더째 풀고 Meta-Factory.exe를 실행해 「PC 보호」 창이 뜨면 추가 정보 → 실행을 누르면 돼요. 그러면 지금 이 화면을 내 컴퓨터에서 그대로 확인할 수 있어요.', hl: ['#btnApps'] },
    { when: () => document.body.classList.contains('app'), say: '지금 쓰시는 앱은 서버 저장 · MQTT 발행 · 녹화 · 공정 설계 Agent가 모두 이 컴퓨터에서 동작해요. 데이터는 앱 데이터 폴더에 쌓이고, ⚙ 설정에서 Claude API 키를 넣으면 대화 기반 Agent도 쓸 수 있어요.', hl: ['#btnSettings'] },
  ] },
};
// 녹음이 없는 문장(실시간 수치 등)만 OS 음성으로 읽는다 — 한국어 원어민 음성을 먼저 (Edge InJoon 남성 · 맥 지안 · 유나 · 윈도우 Heami)
// 맥의 Eddy · Reed · Rocko 같은 다국어 공용 음성은 외국인 억양이라 쓰지 않는다
const MALE_KO = [/injoon/i, /hyunsu/i, /지안|jian/i, /유나|yuna/i, /heami/i, /sunhi/i];
const koVoice = (all) => { const ko = all.filter((v) => /^ko/i.test(v.lang)); for (const re of MALE_KO) { const v = ko.find((x) => re.test(x.name)); if (v) return v; } return ko.find((v) => !/eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i.test(v.name)) ?? ko[0] ?? null; };
const isWeb = () => { const b = document.getElementById('btnApps'); return !!b && !b.hidden; };
const prioOf = (ev) => ({ intrusion: 1, smoke: 1 })[ev.type] ?? 2;   // js/sim.js FIELD_EVENTS prio
const sec = (s) => `${Math.max(0, s).toFixed(1)}초`;   // 시뮬레이션 시간
// 받침에 맞는 조사: 끝 글자가 한글이면 받침, 숫자면 읽는 소리(일 · 삼 · 육 · 칠 · 팔 · 영 → 받침), 영문 L · M · N · R은 받침으로 본다
const final = (w) => { const c = String(w).trim().slice(-1); if (/[가-힣]/.test(c)) return (c.charCodeAt(0) - 0xac00) % 28 > 0; if (/\d/.test(c)) return '013678'.includes(c); return /[lmnr]/i.test(c); };
const ga = (w) => `${w}${final(w) ? '이' : '가'}`, eun = (w) => `${w}${final(w) ? '은' : '는'}`, ieyo = (w) => `${w}${final(w) ? '이에요' : '예요'}`;

// 고리 그림 (SVG): 단계를 원 위에 놓고 화살표로 잇는다 · at = 지금 단계(-1 = 전체 소개, 마지막+1 = 한 바퀴 완성)
function ringSvg(key, at) {
  const L = RINGS[key], n = L.length, W = 336, H = 150, cx = W / 2, cy = 74, rx = 128, ry = 50, all = at < 0 || at >= n;
  const pos = L.map((_, k) => { const a = -Math.PI / 2 + (k / n) * Math.PI * 2; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  const half = L.map((t) => t.length * 5.5 + 11);   // 칸 반폭 (글자 수)
  // 화살표는 칸 가장자리에서 시작해 다음 칸 가장자리에서 끝난다 (글자를 가로지르지 않게)
  const edge = ([x, y], [tx, ty], hw) => { const dx = tx - x, dy = ty - y, f = Math.min((hw + 4) / Math.max(1e-6, Math.abs(dx)), 15 / Math.max(1e-6, Math.abs(dy)), 0.45); return [x + dx * f, y + dy * f]; };
  const arcs = pos.map((p1, k) => { const p2 = pos[(k + 1) % n], [x1, y1] = edge(p1, p2, half[k]), [x2, y2] = edge(p2, p1, half[(k + 1) % n] + 3), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ox = (mx - cx) * 0.15, oy = (my - cy) * 0.15;
    const on = all || k === at; return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${(mx + ox).toFixed(1)} ${(my + oy).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" class="tr-a${on ? ' on' : ''}" marker-end="url(#tr-h${on ? '1' : '0'})"/>`; }).join('');
  const nodes = pos.map(([x, y], k) => { const on = all || k === at, w = half[k] * 2;
    return `<g class="tr-n${on ? ' on' : ''}${k === at ? ' cur' : ''}"><rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="22" rx="11"/><text x="${x}" y="${y + 4}" text-anchor="middle">${L[k]}</text></g>`; }).join('');
  const mid = key === 'loop' ? '데이터 폐루프' : '플라이휠';
  return `<svg class="tori-ring" viewBox="0 0 ${W} ${H}" role="img" aria-label="${mid}: ${L.join(' → ')} → ${L[0]}"><defs>${[0, 1].map((o) => `<marker id="tr-h${o}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="tr-h${o ? ' on' : ''}"/></marker>`).join('')}</defs>${arcs}${nodes}<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="tr-c">↻ ${mid}</text></svg>`;
}

// ── 녹음 음성 (assets/tori/voice/<해시>.mp3 · tools/tori-voice.mjs로 만듦) ─────────────────
// 문장(읽을 글)마다 해시로 파일을 찾는다 — 문장을 고치면 해시가 바뀌어 새로 만들어야 함(없으면 OS 음성)
export const MENU_SAY = '무엇을 안내해 드릴까요?';
export const speakText = (t) => String(t).replace(/\s*→\s*/g, ', ').replace(/\s*·\s*/g, ', ').replace(/[①②③④⑤⑥]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
export const voiceKey = (t) => { let h = 0x811c9dc5; for (const c of speakText(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
// 녹음할 문장 전체: 고정 문장은 말풍선 그대로, 실시간 수치가 들어가는 단계는 voice(수치 없는 읽을 글)
export function narration() { return [MENU_SAY, ...Object.values(TOPICS).flatMap((T) => T.steps.map((s) => s.voice ?? (typeof s.say === 'string' ? s.say : null)).filter(Boolean))]; }
const VOICE_DIR = new URL('../assets/tori/voice/', import.meta.url).href;
const AUTO_MS = 1000, READY_MAX_MS = 90000, PANEL_MS = 3000;   // 현장을 보여 준 뒤 창을 열기까지
const readMs = (t) => 1500 + speakText(t).length * 150;   // 소리 없이 읽는 시간 (초당 약 7자)

export class Tori {
  // hooks: flyTo(viewKey) · setMode(modeKey) · mode() 지금 단계
  constructor(hooks) {
    this.h = hooks; this.topic = 'tour'; this.step = -1; this.open = false; this.talkT = 0; this.voice = store.get(VOICE) !== '0';   // 음성은 기본으로 켬 (🔊로 끄면 기억)
    this.el = document.createElement('div'); this.el.id = 'tori'; this.el.className = 'tori mini';
    this.el.innerHTML = `<div class="tori-bubble" role="dialog" aria-live="polite" aria-label="토리 안내">
        <div class="tori-h"><b>토리</b><span class="tori-n"></span><span class="tori-gpu" title="토리를 그리는 방식"></span>
          <button type="button" data-t="voice" title="음성으로 읽기">🔊</button><button type="button" data-t="close" title="접기">✕</button></div>
        <div class="tori-fig"></div>
        <p class="tori-say"></p>
        <div class="tori-btns"></div>
      </div><canvas class="tori-cv" width="300" height="300" title="토리 — 눌러서 안내 주제 고르기"></canvas>`;
    document.body.appendChild(this.el);
    this.cv = this.el.querySelector('.tori-cv'); this.sayEl = this.el.querySelector('.tori-say'); this.nEl = this.el.querySelector('.tori-n');
    this.figEl = this.el.querySelector('.tori-fig'); this.btnEl = this.el.querySelector('.tori-btns');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'), t = b?.dataset.t;
      if (t === 'next') { const s = this.cur(); if (s?.end && s.next) this.play(s.next); else this.go(this.step + 1); }
      else if (t === 'prev') this.go(this.step - 1);
      else if (t === 'topic') this.play(b.dataset.k);
      else if (t === 'menu') this.menu();
      else if (t === 'close' || t === 'skip') this.close();
      else if (t === 'voice') { this.voice = !this.voice; store.set(VOICE, this.voice ? '1' : '0'); this.syncVoice(); if (this.voice) this.speak(this.cur()?.voice ?? this.sayEl.textContent); else this.stopVoice(); if (this.cur()) this.scheduleAuto(this.cur(), this.step === this.steps().length - 1); }
      else if (e.target === this.cv && !this.open) this.menu();
    });
    this.syncVoice();
    fetch(`${VOICE_DIR}index.json`).then((r) => (r.ok ? r.json() : [])).then((k) => { this.recorded = new Set(k); }).catch(() => { this.recorded = new Set(); });   // 녹음된 문장 목록
    this.initGfx().catch((e) => console.warn('[토리] 그리기 시작 실패', e));
  }
  syncVoice() { const b = this.el.querySelector('[data-t="voice"]'); b.classList.toggle('on', this.voice); b.hidden = !('speechSynthesis' in window); }
  steps() { return (this.list ??= TOPICS[this.topic].steps.filter((st) => !st.when || st.when(this))); }   // 환경에 맞는 단계만 (웹 · 앱)
  cur() { return this.step >= 0 ? this.steps()[this.step] : null; }

  // 처음 접속이면 인사부터 (한 번만)
  greetIfFirst() { if (!store.get(SEEN)) setTimeout(() => this.play('tour'), 1200); }

  // 주제 메뉴 (작은 토리를 누르면)
  menu() {
    clearInterval(this.liveT); clearTimeout(this.panelT); if (this.panelOpen) { this.h.closePanels?.(); this.panelOpen = false; } this.cancelAuto(); this.clearHl(); this.step = -1; this.open = true; this.el.classList.remove('mini');
    this.nEl.textContent = ''; this.figEl.innerHTML = '';
    this.say(MENU_SAY);
    this.btnEl.innerHTML = ['tour', 'incident', 'trace', 'loop', 'fly', 'docs'].map((k) => [k, TOPICS[k]]).map(([k, T]) => `<button type="button" data-t="topic" data-k="${k}">${T.name}</button>`).join('');
    this.btnEl.classList.add('menu');
  }
  play(topic) { this.topic = topic; this.list = null; this.ev = null; this.go(0); }

  go(i) {
    const S = this.steps();
    if (i < 0) return;
    if (i >= S.length) return this.close();
    this.clearHl(); clearInterval(this.liveT);
    const s = S[i], back = i < this.step; this.step = i; this.open = true; this.el.classList.remove('mini'); this.btnEl.classList.remove('menu');
    if (s.act && !back) s.act(this);   // 이전으로 돌아올 때는 다시 실행하지 않음 (이벤트를 또 만들지 않게)
    if (s.mode && this.h.mode?.() !== s.mode) this.h.setMode?.(s.mode);
    if (s.view) this.h.flyTo?.(s.view);
    if (s.cam) { const c = typeof s.cam === 'function' ? s.cam(this) : s.cam; if (c) this.h.camTo?.(c); }   // 그 현장으로 이동 · 확대
    clearTimeout(this.panelT);
    if (s.panel !== undefined) {   // 현장을 3초 보여 준 뒤 관련 창 (null = 창 닫기)
      this.h.closePanels?.(); this.panelOpen = false;
      const p = typeof s.panel === 'function' ? s.panel(this) : s.panel;
      if (p) this.panelT = setTimeout(() => { if (this.cur() === s && this.open) { this.h.openPanel?.(p); this.panelOpen = true; } }, PANEL_MS);
    }
    for (const q of s.hl ?? []) document.querySelector(q)?.classList.add('tori-hl');
    this.nEl.textContent = `${TOPICS[this.topic].name}${i ? ` · ${i} / ${S.length - 1}` : ''}`;
    this.figEl.innerHTML = s.ring ? ringSvg(s.ring, s.at) : s.chain != null ? chainSvg(s.chain) : '';
    const last = s.end || i === S.length - 1, nextLabel = s.start ? '둘러보기 시작 ▶' : last && s.next ? `${TOPICS[s.next].name} ▶` : last ? '마치기' : '다음 ▶';
    this.btnEl.innerHTML = `${i ? '<button type="button" data-t="prev">◀ 이전</button>' : ''}${i === 0 && this.topic === 'tour' ? '<button type="button" data-t="skip">다음에</button>' : ''}<button type="button" data-t="menu">주제</button><button type="button" data-t="next" class="primary">${nextLabel}</button>`;
    const text = () => (typeof s.say === 'function' ? s.say(this) : s.say);
    this.say(text(), s.voice);
    this.scheduleAuto(s, i === S.length - 1);
    if (s.live) this.liveT = setInterval(() => { const t = text(); if (t !== this.sayEl.textContent) this.sayEl.textContent = t; }, 1000);   // 진행 상황을 1초마다 다시 읽음 (소리는 처음 한 번)
    store.set(SEEN, '1');
  }
  say(text, voice) { this.sayEl.textContent = text; this.talkT = Math.min(6, 1.2 + text.length * 0.045); this.speak(voice ?? text); }   // 말하는 입 모양 (글자 수만큼)
  close() { clearInterval(this.liveT); clearTimeout(this.panelT); if (this.panelOpen) { this.h.closePanels?.(); this.panelOpen = false; } this.cancelAuto(); this.clearHl(); this.open = false; this.step = -1; this.el.classList.add('mini'); this.stopVoice(); this.talkT = 0; }
  clearHl() { document.querySelectorAll('.tori-hl').forEach((e) => e.classList.remove('tori-hl')); }
  // ── 자동 넘김 ─────────────────
  cancelAuto() { this.autoTok = (this.autoTok ?? 0) + 1; clearTimeout(this.autoT); this.onSpoken = null; this.el.querySelector('[data-t="next"]')?.classList.remove('auto'); }
  scheduleAuto(s, last) {
    this.cancelAuto();
    if (s.end || last) return;   // 주제 마지막 단계는 기다린다 (첫 인사도 1초 뒤 둘러보기 시작)
    const tok = this.autoTok, t0 = performance.now();
    const countdown = () => {
      if (tok !== this.autoTok || !this.open) return;
      if (s.ready && !s.ready(this) && performance.now() - t0 < READY_MAX_MS) { this.autoT = setTimeout(countdown, 500); return; }   // 실제로 일어날 때까지
      const b = this.el.querySelector('[data-t="next"]'); b?.classList.remove('auto'); void b?.offsetWidth; b?.classList.add('auto');   // 1초 차오르는 막대
      this.autoT = setTimeout(() => { if (tok === this.autoTok && this.open) this.go(this.step + 1); }, AUTO_MS);
    };
    // 말이 끝나면 시작 — 음성이 재생 중이면 끝날 때, 아니면 읽는 시간 뒤
    if (this.speaking) this.onSpoken = () => { this.onSpoken = null; countdown(); };
    else this.autoT = setTimeout(countdown, readMs(this.sayEl.textContent));
  }
  spoken() { this.speaking = false; this.talkT = 0; this.onSpoken?.(); }

  speak(text) {
    this.stopVoice(); if (!this.voice || !text) return;
    // 아직 사용자가 화면을 누른 적이 없으면 소리가 막힌다 — 첫 클릭 때 지금 말을 읽는다 (앱은 처음부터 — electron/main.mjs autoplayPolicy)
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive && !document.body.classList.contains('app')) {
      this.pending = text;
      if (!this.waitTap) { this.waitTap = true; addEventListener('pointerdown', () => { this.waitTap = false; setTimeout(() => { if (this.open && this.pending) this.speak(this.pending); }, 0); }, { once: true, capture: true }); }
      return;
    }
    this.pending = null;
    const key = voiceKey(text);
    if (this.recorded?.has(key)) {   // 녹음 (자연스러운 한국어 남성 음성)
      const a = this.audio = new Audio(`${VOICE_DIR}${key}.mp3`);
      this.speaking = true;
      a.onplay = () => { this.talkT = 60; }; a.onended = a.onerror = () => { if (this.audio === a) this.spoken(); };
      a.play().catch(() => { if (this.audio === a) { this.speaking = false; this.talkT = 0; } });
      return;
    }
    const S = window.speechSynthesis; if (!S) return;   // 녹음이 없으면 OS 한국어 음성
    const u = new SpeechSynthesisUtterance(speakText(text)); u.lang = 'ko-KR'; u.rate = 1.05;
    u.voice = koVoice(S.getVoices());
    this.speaking = true;
    u.onstart = () => { this.talkT = 60; }; u.onend = u.onerror = () => { if (this.utter === u) this.spoken(); };
    this.utter = u; S.speak(u);
  }
  stopVoice() { this.speaking = false; this.utter = null; window.speechSynthesis?.cancel(); if (this.audio) { this.audio.pause(); this.audio = null; } }

  // ── 아바타 (공장장 그림 애니메이션) ─────────────────
  // 투명 배경 PNG(assets/tori/manager.png)를 격자 판에 붙이고, 판의 꼭짓점을 매 프레임 조금씩 옮겨 움직임을 만든다:
  // 숨쉬기(몸통) · 좌우 흔들림 · 둥실 · 말할 때 고개 끄덕임 · 가리키는 손 들썩임 · 처음 나타날 때 튀어 오름
  async initGfx() {
    let r = null, kind = 'WebGL';
    if (navigator.gpu) {
      try {
        const W = await import('three/webgpu');
        r = new W.WebGPURenderer({ canvas: this.cv, antialias: true, alpha: true }); await r.init();
        kind = r.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
      } catch (e) { console.info('[토리] WebGPU 대신 WebGL로 그림', e?.message ?? e); r = null; }
    }
    r ??= new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(this.cv.width, this.cv.height, false); r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.r = r; this.el.querySelector('.tori-gpu').textContent = kind;
    const scene = this.scene = new THREE.Scene(), cam = this.cam = new THREE.OrthographicCamera(-1.06, 1.06, 1.06, -1.06, 0.1, 10); cam.position.z = 5;
    const tex = await new THREE.TextureLoader().loadAsync(new URL('../assets/tori/manager.png', import.meta.url).href);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(2, 2, 28, 28), pos = geo.attributes.position;
    this.base = Float32Array.from(pos.array); this.geo = geo;
    this.fig = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false }));
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
    shadow.position.set(0.12, -0.9, -0.1); shadow.scale.set(1, 0.16, 1); this.shadow = shadow;
    scene.add(shadow, this.fig);
    this.t0 = performance.now(); this.last = 0; this.pop = 0;
    const loop = (now) => { requestAnimationFrame(loop); if (document.hidden || now - this.last < 33) return; const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now; this.frame(dt, (now - this.t0) / 1000); };
    requestAnimationFrame(loop);
  }
  frame(dt, t) {
    const talking = this.talkT > 0; if (talking && this.talkT < 59) this.talkT -= dt;
    this.pop = Math.min(1, this.pop + dt * 2.5);
    const b = this.base, a = this.geo.attributes.position.array, ease = 1 - Math.pow(1 - this.pop, 3);
    // 그림 좌표(판 -1~1): 목 (0.0, -0.02) · 가리키는 손 (-0.56, -0.04) · 발 y -0.93
    const tilt = talking ? Math.sin(t * 5.2) * 0.05 : Math.sin(t * 0.9) * 0.015, nod = talking ? Math.abs(Math.sin(t * 7)) * 0.02 : 0;
    const breathe = 1 + Math.sin(t * 2.1) * 0.008, sway = Math.sin(t * 1.1) * 0.012, hand = talking ? Math.sin(t * 4.3) * 0.035 : Math.sin(t * 1.6) * 0.008;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    for (let i = 0; i < a.length; i += 3) {
      let x = b[i], y = b[i + 1];
      const up = (y + 0.93) / 1.93;   // 발 0 → 머리 끝 1
      // 몸통 숨쉬기 (발은 고정)
      x *= 1 + (breathe - 1) * up; y = -0.93 + (y + 0.93) * (1 + (breathe - 1) * 0.6);
      // 머리: 목을 축으로 기울이고 끄덕임 (목 위로 갈수록 크게)
      const w = Math.min(1, Math.max(0, (b[i + 1] - 0.0) / 0.22)), hw = w * w * (3 - 2 * w);
      if (hw > 0) { const dx = x, dy = y + 0.02; x = dx * (1 - hw + hw * c) - dy * hw * s; y = -0.02 + dx * hw * s + dy * (1 - hw + hw * c) - nod * hw; }
      // 가리키는 손 들썩임
      const hx = b[i] + 0.56, hy = b[i + 1] + 0.04, g = Math.exp(-(hx * hx + hy * hy) / 0.025); y += hand * g;
      // 전체 좌우 흔들림 (발 기준) · 둥실 · 처음 나타날 때 튀어 오름
      x += sway * up; a[i] = x * ease; a[i + 1] = y * ease + Math.sin(t * 1.8) * 0.012 * up - (1 - ease) * 0.6;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.shadow.scale.set(1 - Math.sin(t * 1.8) * 0.04, 0.16, 1);
    this.r.render(this.scene, this.cam);
  }
}
