// 토리(Tori) — 피지컬AI 실증 메타팩토리 공장장 아바타. 화면 오른쪽 아래에 서서(그림 애니메이션), 처음 접속하면 인사하고
// 주제별로 안내한다: 메타팩토리 둘러보기(단계 · Zone 카메라 이동 · 주요 버튼 강조) · 인시던트 해결 예시(실제로 현장 이벤트를 일으켜 진행 상황을 읽어 줌)
//   · 데이터 폐루프 · 데이터 플라이휠(고리 그림에 지금 단계 표시) · 매뉴얼·앱 내려받기
// 접으면 작은 얼굴만 남고, 누르면 주제 메뉴.
// 그리기: 토리 전용 캔버스를 WebGPU(three/webgpu WebGPURenderer)로 — 메인 3D 화면(WebGL)과 따로라 공장 화면 속도와 무관
//   WebGPU를 쓸 수 없는 브라우저 · 공유 아티팩트에서는 같은 장면을 WebGL로 그린다 (모양 · 동작 같음)
// 말: 말풍선 글자와 브라우저 내장 한국어 음성(speechSynthesis — 설치 · 비용 없음)을 함께 · 🔊로 음성만 끌 수 있음
//   브라우저는 사용자가 화면을 누르기 전에는 소리를 막으므로, 그 전에 나온 말은 첫 클릭 때 읽는다 (앱은 처음부터 — electron/main.mjs autoplayPolicy)
// 안내 내용은 앱의 실제 구성에서 가져왔다: 센서망 계층(js/sensors.js) · VLA 학습·배포(js/vla.js) · AIOS(js/aios.js) · 데이터 연동(js/datahub.js)
import * as THREE from 'three';

const SEEN = 'mf.tori.seen', VOICE = 'mf.tori.voice';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 등 */ } } };

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
    { say: '설비를 누르면 상세 정보가, 🏷 라벨 버튼을 누르면 이름표가 보여요. 저를 누르면 인시던트 해결 예시, 데이터 폐루프 · 플라이휠, 매뉴얼 · 앱 내려받기도 안내해 드려요!', view: 'all', hl: ['#btnLabels'], end: true },
  ] },
  // 인시던트 해결 예시: 실제로 현장 이벤트를 일으키고, 시뮬레이션의 이벤트 기록(감지 · 대응 로봇 · 처리 시각)을 1초마다 읽어 진행 상황을 말한다
  incident: { name: '인시던트 해결 예시', steps: [
    { say: '예시로 현장에 문제를 하나 일으켜 볼게요. 피지컬AI 단계의 정밀조립Zone이에요. 「다음」을 누르면 로봇 카메라 앞에 바닥 누유 · 이물질 · 연기 의심 · 무단 진입 중 하나가 생겨요.', mode: 'dark', view: 'precision' },
    { act: (T) => { T.ev = T.h.injectEvent?.() ?? null; if (T.ev) T.h.look?.(T.ev.x, T.ev.z); }, hl: ['#btnEvent'],
      say: (T) => T.ev ? `방금 「${T.ev.label}」 상황이 생겼어요 (우선순위 P${prioOf(T.ev)}). 아직 아무도 모르는 상태예요. 화면이 그 자리로 이동했어요 — 빨간 표지와 빛기둥이 보이죠? 화면 위쪽에 오케스트레이터 흐름도도 열렸어요.` : '지금은 현장 이벤트를 만들 수 없어요. 피지컬AI 단계에서 ⚠ 현장 이벤트 버튼으로 다시 해 보세요.' },
    { live: true, hl: ['#orchPanel'],
      say: (T) => `① AI 감지 — 근처 로봇 카메라 영상을 AI가 추론해 이상을 찾아요. ${!T.ev ? '' : T.ev.detected ? `${ga(T.ev.detectedBy)} ${sec(T.ev.tDetect - T.ev.t0)} 만에 감지했어요 (신뢰도 ${Math.round((T.ev.conf ?? 0) * 100)}%).` : '지금 찾는 중이에요…'} 감지되면 인시던트가 열리고, 주변 AMR · 로봇은 속도를 줄이거나 반경 밖으로 돌아가요.` },
    { hl: ['#orchPanel'],
      say: (T) => `② 보고 · 판단 — 셀이 공장 오케스트레이터에 보고하면, 오케스트레이터가 우선순위(P1 화재 · 인명 → P2 시설 · 작업 안전 → P3 생산 정지 …)를 정하고 대응 로봇을 골라요. 피지컬AI 단계는 판단이 1.5초, 화재 · 인명(P1)은 0.4초예요.${T.ev ? ` 이번 건은 ${ieyo(`P${prioOf(T.ev)}`)}.` : ''}` },
    { live: true,
      say: (T) => `③ 피지컬AI 출동 — ${!T.ev ? '' : T.ev.type === 'intrusion' ? '사람이 안전구역을 나갈 때까지 주변 로봇이 안전 속도로 기다려요.' : T.ev.responder ? `${ga(T.ev.responder)} 출동했어요.` : '대응 로봇을 배정하는 중이에요…'} 정비 휴머노이드는 흡착포 · 수거 도구 · 소화기를 챙겨 가고, 사족보행 로봇은 열화상 · 가스 센서로 점검해요. 순찰 드론도 하늘에서 현장을 확인해요.` },
    { live: true, hl: ['#btnOrch', '#btnImpact'],
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
  // 매뉴얼 · 앱 내려받기 — 앱 내려받기는 웹 버전(⬇ 버튼이 보일 때)에서만 안내한다 (맥 · 윈도우 앱과 npm start에는 내려받기 기능이 없음)
  docs: { name: '매뉴얼 · 앱 내려받기', steps: [
    { say: '📘 버튼을 누르면 사용자 가이드(PDF)를 내려받아요. 설치부터 화면 구성, 운영 시나리오 실습, 데이터 내보내기, 문제 해결까지 담겨 있어요.', hl: ['#btnGuide'] },
    { when: () => isWeb(), say: '⬇ 버튼에서는 맥(Apple Silicon)과 윈도우(64비트 10 · 11) 앱을 내려받을 수 있어요. 앱에서는 서버 저장 · MQTT 발행 · MP4 녹화 · 자연어 공정 설계 Agent까지 전체 기능을 내 컴퓨터에서 써요.', hl: ['#btnApps'] },
    { when: () => isWeb(), say: '맥은 압축을 풀어 응용 프로그램 폴더로 옮기고 처음 한 번 우클릭 → 열기, 윈도우는 폴더째 풀고 Meta-Factory.exe를 실행해 「PC 보호」 창이 뜨면 추가 정보 → 실행을 누르면 돼요. 그러면 지금 이 화면을 내 컴퓨터에서 그대로 확인할 수 있어요.', hl: ['#btnApps'] },
    { when: () => document.body.classList.contains('app'), say: '지금 쓰시는 앱은 서버 저장 · MQTT 발행 · 녹화 · 공정 설계 Agent가 모두 이 컴퓨터에서 동작해요. 데이터는 앱 데이터 폴더에 쌓이고, ⚙ 설정에서 Claude API 키를 넣으면 대화 기반 Agent도 쓸 수 있어요.', hl: ['#btnSettings'] },
  ] },
};
// 한국어 음성: 남성 공장장 캐릭터라 남성 음성을 먼저 고른다 (맥 Eddy · Reed · Rocko · Grandpa · 지안, 윈도우 · Edge InJoon) — 없으면 있는 한국어 음성
const MALE_KO = [/eddy/i, /reed/i, /rocko/i, /grandpa/i, /지안|jian/i, /injoon/i, /minsu|민수/i];
const koVoice = (all) => { const ko = all.filter((v) => /^ko/i.test(v.lang)); for (const re of MALE_KO) { const v = ko.find((x) => re.test(x.name)); if (v) return v; } return ko[0] ?? null; };
const isWeb = () => { const b = document.getElementById('btnApps'); return !!b && !b.hidden; };
const prioOf = (ev) => ({ intrusion: 1, smoke: 1 })[ev.type] ?? 2;   // js/sim.js FIELD_EVENTS prio
const sec = (s) => `${Math.max(0, s).toFixed(1)}초`;   // 시뮬레이션 시간
// 받침에 맞는 조사: 끝 글자가 한글이면 받침, 숫자면 읽는 소리(일 · 삼 · 육 · 칠 · 팔 · 영 → 받침), 영문 L · M · N · R은 받침으로 본다
const final = (w) => { const c = String(w).trim().slice(-1); if (/[가-힣]/.test(c)) return (c.charCodeAt(0) - 0xac00) % 28 > 0; if (/\d/.test(c)) return '013678'.includes(c); return /[lmnr]/i.test(c); };
const ga = (w) => `${w}${final(w) ? '이' : '가'}`, ieyo = (w) => `${w}${final(w) ? '이에요' : '예요'}`;

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
      else if (t === 'voice') { this.voice = !this.voice; store.set(VOICE, this.voice ? '1' : '0'); this.syncVoice(); if (this.voice) this.speak(this.sayEl.textContent); else window.speechSynthesis?.cancel(); }
      else if (e.target === this.cv && !this.open) this.menu();
    });
    this.syncVoice();
    this.initGfx().catch((e) => console.warn('[토리] 그리기 시작 실패', e));
  }
  syncVoice() { const b = this.el.querySelector('[data-t="voice"]'); b.classList.toggle('on', this.voice); b.hidden = !('speechSynthesis' in window); }
  steps() { return (this.list ??= TOPICS[this.topic].steps.filter((st) => !st.when || st.when(this))); }   // 환경에 맞는 단계만 (웹 · 앱)
  cur() { return this.step >= 0 ? this.steps()[this.step] : null; }

  // 처음 접속이면 인사부터 (한 번만)
  greetIfFirst() { if (!store.get(SEEN)) setTimeout(() => this.play('tour'), 1200); }

  // 주제 메뉴 (작은 토리를 누르면)
  menu() {
    clearInterval(this.liveT); this.clearHl(); this.step = -1; this.open = true; this.el.classList.remove('mini');
    this.nEl.textContent = ''; this.figEl.innerHTML = '';
    this.say('무엇을 안내해 드릴까요?');
    this.btnEl.innerHTML = ['tour', 'incident', 'loop', 'fly', 'docs'].map((k) => [k, TOPICS[k]]).map(([k, T]) => `<button type="button" data-t="topic" data-k="${k}">${T.name}</button>`).join('');
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
    for (const q of s.hl ?? []) document.querySelector(q)?.classList.add('tori-hl');
    this.nEl.textContent = `${TOPICS[this.topic].name}${i ? ` · ${i} / ${S.length - 1}` : ''}`;
    this.figEl.innerHTML = s.ring ? ringSvg(s.ring, s.at) : '';
    const last = s.end || i === S.length - 1, nextLabel = s.start ? '둘러보기 시작 ▶' : last && s.next ? `${TOPICS[s.next].name} ▶` : last ? '마치기' : '다음 ▶';
    this.btnEl.innerHTML = `${i ? '<button type="button" data-t="prev">◀ 이전</button>' : ''}${i === 0 && this.topic === 'tour' ? '<button type="button" data-t="skip">다음에</button>' : ''}<button type="button" data-t="menu">주제</button><button type="button" data-t="next" class="primary">${nextLabel}</button>`;
    const text = () => (typeof s.say === 'function' ? s.say(this) : s.say);
    this.say(text());
    if (s.live) this.liveT = setInterval(() => { const t = text(); if (t !== this.sayEl.textContent) this.sayEl.textContent = t; }, 1000);   // 진행 상황을 1초마다 다시 읽음 (소리는 처음 한 번)
    store.set(SEEN, '1');
  }
  say(text) { this.sayEl.textContent = text; this.talkT = Math.min(6, 1.2 + text.length * 0.045); this.speak(text); }   // 말하는 입 모양 (글자 수만큼)
  close() { clearInterval(this.liveT); this.clearHl(); this.open = false; this.step = -1; this.el.classList.add('mini'); window.speechSynthesis?.cancel(); this.talkT = 0; }
  clearHl() { document.querySelectorAll('.tori-hl').forEach((e) => e.classList.remove('tori-hl')); }
  speak(text) {
    const S = window.speechSynthesis; if (!this.voice || !S || !text) return;
    // 아직 사용자가 화면을 누른 적이 없으면 소리가 막힌다 — 첫 클릭 때 지금 말풍선을 읽는다
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive && !document.body.classList.contains('app')) {
      if (!this.waitTap) { this.waitTap = true; addEventListener('pointerdown', () => { this.waitTap = false; setTimeout(() => { if (this.open && this.sayEl.textContent) this.speak(this.sayEl.textContent); }, 0); }, { once: true, capture: true }); }
      return;
    }
    S.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/→/g, ',').replace(/·/g, ',').replace(/[①②③④⑤⑥]/g, '')); u.lang = 'ko-KR'; u.rate = 1.05;
    u.voice = koVoice(S.getVoices());
    u.onstart = () => { this.talkT = 60; }; u.onend = () => { this.talkT = 0; };
    S.speak(u);
  }

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
