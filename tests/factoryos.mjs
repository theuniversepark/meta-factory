// Factory OS 계층 검증 (1단계 정밀조립Zone) — 공장 오케스트레이터(FacOS) · Manufacturing Agent · 셀 OCS · A2A 메시지
// 가드레일(계층 권한표) · 오더·수량 정산 · 셀 OCS 상태머신·명령 검증 · 결정 메시지 필수 필드 · 상위망 단절(Outbox) · 정밀검사 샘플 핸드셰이크 · 이상 판단 10초. 실행: npm test
import { zoneLine } from '../js/line.js';
import { Simulation } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { HybridAgent } from '../js/multiagent.js';
import { allowed, ocsState, OCS } from '../js/factoryos.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (s, ag, sec) => { for (let t = 0; t < sec; t += 0.1) { s.step(0.1); ag.update(0.1); } };
console.log('== 가드레일 (계층 권한표)');
check('존 ↔ 존: 핸드셰이크·품질 알림 허용 · 명령 금지', allowed('zone:main', 'zone:insp', 'service.request') && allowed('zone:insp', 'zone:main', 'quality.alert') && !allowed('zone:main', 'zone:insp', 'command'));
check('공장 → 셀 직접 명령 금지 (계층 건너뛰기) · 존 → 자기 셀 명령 허용 · 셀 → 존 상태 보고 허용', !allowed('factory', 'cell:SORT', 'command') && allowed('zone:main', 'cell:SORT', 'command') && allowed('cell:SORT', 'zone:main', 'status'));
check('존 → 공장 결정 요청 허용 · 존 → 공장 명령 금지', allowed('zone:main', 'factory', 'decision.request') && !allowed('zone:main', 'factory', 'command'));
console.log('== 자동화 2시간 (정밀조립)');
const s = new Simulation('smart', 3, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s), F = s.fos;
run(s, ag, 7200);
{ const g = F.bus.send('zone:main', 'zone:insp', 'command', { text: '시험' });
  check('가드레일이 존 → 존 명령을 막고 기록', g.status === 'blocked' && F.bus.stats.blocked >= 1, g.why);
  const C = F.orders.filter((o) => o.status === 'closed');
  check('오더 종료: 양품 100 · 정산 오차 0 · 고유 투입 = 양품 + 폐기 (불량 보충 투입)', C.length >= 5 && C.every((o) => o.recon.err === 0 && o.recon.good === 100 && o.recon.input === o.recon.good + o.recon.scrap + o.recon.wip + o.recon.pass + o.recon.hold), C.map((o) => `${o.id} ${o.recon.input}=${o.recon.good}+${o.recon.scrap}`).join(' · '));
  const flow = ['order.assign', 'order.ack', 'order.evidence', 'order.close'].every((t) => F.bus.stats.byType[t] > 0);
  check('오더 메시지: 배정 → 수락·계획 → 종료 증빙 → 종료', flow, JSON.stringify(F.bus.stats.byType));
  const R = F.main.reconcile();
  check('전체 수량 정산 오차 0 (공정중 + 합격대기 + HOLD + 인계 + 폐기 = 고유 투입)', R.err === 0 && R.input === s.trace.stats.released, JSON.stringify(R));
  check('셀 OCS: 정밀조립 셀마다 · 상태 7종 안', s.processing.every((st) => F.ocs.has(st.id)) && s.processing.every((st) => OCS[ocsState(st)]), s.processing.map((st) => `${st.id}:${ocsState(st)}`).join(' '));
  const ok = [...F.ocs.values()].reduce((a, c) => a + c.ok, 0);
  const st = s.processing.find((x) => !x.request && x.state !== 'DOWN'); s.requestTech(st, 'pm'); const before = F.ocs.get(st.id).rej; s.requestTech(st, 'cal');
  check('셀 OCS 명령 검증: 정비·보정 승인 기록 · 진행 중 다른 정비는 거부 사유와 함께', ok > 5 && F.ocs.get(st.id).rej === before + 1 && /거부/.test(F.ocs.get(st.id).checks[0].reason), F.ocs.get(st.id).checks[0].reason);
  const D = F.decisions;
  check('공장 결정 메시지 필수 필드 (대상 · 권한자 · 버전 · 제약 · 재개 조건)', D.length > 0 && D.every((d) => d.target && d.authority && /^P-\d+$/.test(d.version) && 'constraints' in d && 'resume' in d), `${D.length}건 · ${[...new Set(D.map((d) => d.kind))].join(', ')}`);
  const sup = F.bus.log.filter((m) => m.body?.kind === 'maint-support');
  check('Zone 간 정비 지원은 공장 경유 (존 → 공장 결정 요청 → 공장 → 빌려주는 존 명령)', !sup.length || (sup.every((m) => m.to === 'factory' || m.from === 'factory') && F.bus.log.some((m) => m.from === 'factory' && m.body?.kind === 'lend')) || D.some((d) => d.kind === 'maint-support' && d.verdict === '불가'), `${sup.length}건`);
  check('이상 판단 10초 (자동화 MES)', F.judge.n > 5 && F.judge.fast / F.judge.n >= 0.9, `${F.judge.fast}/${F.judge.n} · 평균 ${(F.judge.sum / F.judge.n).toFixed(1)}초`);
}
console.log('== 8D 정책 승인 → 공장 결정 (사람 결정)');
{ const K = s.capa, k = K.pending[0];
  check('8D D5 → Manufacturing Agent가 공장에 정책 승인 결정 요청 (시간 초과 없음)', !!k?.fosReq && k.fosReq.type === 'decision.request' && k.fosReq.status !== 'timeout');
  K.approve(k.id);
  const d = F.decisions.find((x) => x.kind === 'policy');
  check('정책 반영 → 공장 결정 메시지 (승인 · 버전 증가 · 재개 조건)', d?.verdict === '승인' && d.resume && F.bus.log.some((m) => m.type === 'decision' && m.corr === k.fosReq.msgId), d?.text);
}
console.log('== 상위망 단절 → Edge Outbox → 복구');
{ F.setOnline(false);
  const m = F.main.escalate('due-risk', '시험: 납기 위험', { lateBy: 60 }, { order: F.orders[0].id });
  check('단절 중 공장행 메시지는 Outbox에 쌓임 (존은 승인 범위 안에서 계속)', m.status === 'queued' && F.bus.outbox.length >= 1);
  run(s, ag, 30);
  const n = F.setOnline(true);
  check('복구하면 Outbox 전송 → 공장 결정', n >= 1 && F.bus.outbox.length === 0 && F.bus.log.some((x) => x.type === 'decision' && x.corr === m.msgId), `${n}건 전송`);
}
console.log('== 정밀검사 샘플 핸드셰이크 (A2A)');
{ const T = s.trace, req = { id: 'QS-T01', zone: 'main', product: 'doortrim', t0: s.time };
  F.sampleRequest(req); const r = T.byId.get(req.serial);
  check('서비스 요청: 샘플 시리얼 지정 · 결과 올 때까지 HOLD (자동 OK 금지)', !!r && r.hold === 'sample', req.serial);
  F.sampleAccept(req, '정밀검사-AMR01'); const it = { ...req, msg: req.msg }; F.sampleHandover(it); F.sampleResult(it, 'ok');
  check('수락 → 인계 준비 → 인수 확인 → 결과 OK → HOLD 해제', r.hold === null && ['service.accept', 'handover.ready', 'handover.ack', 'service.result'].every((t) => F.bus.log.some((m) => m.type === t && m.subject.sample === 'QS-T01')));
  const req2 = { id: 'QS-T02', zone: 'main', product: 'eaxle', t0: s.time }; F.sampleRequest(req2); const n0 = T.cases.length, k0 = s.capa.list.length;
  F.sampleResult({ ...req2 }, 'ng');
  const c = T.cases[0];
  check('결과 NG → 품질 알림 → 정밀조립 불량 사례(계보 원인 분석) · 8D', T.cases.length === n0 + 1 && c.kind === 'sample' && c.rca.causes.length && F.bus.log.some((m) => m.type === 'quality.alert' && m.subject.sample === 'QS-T02') && (s.capa.list.length > k0 || !!c.capa), `${c.id} · ${c.rca.top?.label}`);
}
console.log('== 단계별 이상 판단 시간');
{ const L = new Simulation('traditional', 3, { line: zoneLine(), quiet: true }), la = new FactoryAgent(L); run(L, la, 3600);
  const D = new Simulation('dark', 3, { line: zoneLine(), quiet: true }), da = new HybridAgent(D); run(D, da, 3600);
  const r = (X) => (X.fos.judge.n ? X.fos.judge.fast / X.fos.judge.n : 1);
  check('피지컬AI 이상 판단 10초 이내 90%↑ · 레거시(작업반장)보다 빠름', r(D) >= 0.9 && D.fos.judge.sum / Math.max(1, D.fos.judge.n) < L.fos.judge.sum / Math.max(1, L.fos.judge.n), `피지컬AI ${(r(D) * 100).toFixed(0)}% · 레거시 ${(r(L) * 100).toFixed(0)}%`);
  check('혼합형 다중: 존 에이전트(Field Logistics · 정비 · 품질 · 흐름 · 반사 규칙) 등록', D.fos.main.agents().length === 5 && D.fos.registry().some((x) => x.name === 'Agent Gateway'), D.fos.main.agents().map((a) => a.name).join(', '));
}
console.log('== 확장 Zone 오케스트레이터 (유연생산 · 적응가공 · 정밀검사)');
{ const X = new Simulation('smart', 5, { line: zoneLine(), quiet: true }), xa = new FactoryAgent(X), F = X.fos; run(X, xa, 1800);
  const R = F.registry();
  check('등록부: 4 Zone 오케스트레이터 + 존 에이전트 (정밀검사 기능형 7 · 유연생산 4 · 적응가공 5)', ['Manufacturing Agent', '정밀검사 Orchestrator', '전환·흐름 오케스트레이터', '적응가공 오케스트레이터'].every((n) => R.some((r) => r.name === n)) && F.insp.agents().length === 7 && F.flex.agents().length === 4 && F.adapt.agents().length === 5);
  check('확장 Zone 셀 OCS (설비 관리 셀마다) · 상태 7종', X.zoneCells.every((zc) => F.ocs.has(zc.id) && OCS[F.zones[zc.zone].ocsOf(zc)]), `${X.zoneCells.length}셀`);
  // 유연생산: 전환 오더 → 배치 순서 → 셀 CHANGEOVER(3중 일치 검증) · 혼류는 전환 시간 0 · 첫물 불합격 → 공장 롤백 결정
  const FX = F.flex, cell = { id: 'C03', cycle: 109 };
  check('유연생산 혼류: 지그 ID → 레시피 자동 (전환 시간 0)', FX.onCellStart(cell, { product: 'door' }) === 0 && FX.onCellStart(cell, { product: 'hood' }) === 0);
  FX.changeoverOrder([{ product: 'door', n: 3 }, { product: 'hood', n: 2 }], '시험');
  const seq = Array.from({ length: 6 }, () => FX.productFor());
  check('전환 오더: 도어 3 → 후드 2 → 혼류 복귀 (종료 증빙)', seq.join() === 'door,door,door,hood,hood,' && F.bus.log.some((m) => m.type === 'order.evidence' && /ORD-F/.test(m.subject.order)), seq.join());
  FX.changeoverOrder([{ product: 'door', n: 5 }], '시험');
  const it = { id: 'FLX-T1', product: 'door' }, co = FX.onCellStart(cell, it);
  check('Wave CHANGEOVER: 셀 사이클 × 배율 · 셀 OCS 3중 일치 승인 기록 · 첫물 표시', co === Math.round(109 * 0.45) && F.ocs.get('FLX-C03').checks[0]?.kind === 'changeover' && it.firstArticle === 'C03', `${co}초`);
  FX.onFirstArticle(it, false);
  check('첫물 불합격 → 공장 결정 요청 → 롤백 결정 (레시피 이전 슬롯)', F.decisions[0]?.kind === 'first-article' && F.decisions[0].verdict === '롤백', F.decisions[0]?.text);
  // 적응가공: 마모 누적 → 조건 조정(승인 게이트·전/후 기록) → 88% 공구 교환(HOLD) → 교환 끝 마모 0 · 교환 6회마다 공장에 공구 재고 보충 요청
  const AD = F.adapt, mc = { id: 'HB_MILL', def: { type: 'mill5' } }; let k = 0, r = 0.5;
  while (!AD.tools.HB_MILL?.changing && k++ < 200) AD.afterCell(mc, { id: `ADP-T${k}` }, () => r);
  const T = AD.tools.HB_MILL;
  check('조건 조정: 마모 60%에 승인 게이트 → 이송 −8% (전/후·근거·결과 기록)', AD.conds.some((c) => c.cell === 'HB_MILL' && c.before && c.after) && F.ocs.get('ADP-HB_MILL').checks.some((c) => c.kind === 'condition' && c.ok));
  check('공구 감시: 88%에 교환 → 셀 HOLD (다음 가공 대기)', T.changing > 0 && AD.beforeCell(mc).hold > 0 && AD.changes[0].wear >= 88, `${k}개 가공 · 교환 ${T.changing}초`);
  AD.tick(T.changing + 1);
  check('교환 끝 → 마모 0 · 새 공구 ID · 조건 기본', T.wear === 0 && T.changing === 0 && T.id === 'T-HB_MILL-2' && T.cond === 1);
  const before = F.decisions.filter((d) => d.kind === 'tool-stock').length;
  for (let i = 0; i < 6; i++) AD.startChange(mc, false);
  check('공구 교환 누적 → 공장 결정 요청 (FAC 공구 발주)', F.decisions.filter((d) => d.kind === 'tool-stock').length > before);
  check('정밀검사 Asset Management Agent: 검사 셀 건강도·가동 (설비 관리)', /가동 \d\/6/.test(F.insp.agents().find((a) => a.name === 'Asset Management Agent').stat));
}
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
