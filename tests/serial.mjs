// 2단 ID · 시리얼·마킹 · 출하 SSCC · 샘플 NG 봉쇄·처분 검증 (js/serial.js · js/codes.js)
// QR·DataMatrix가 실제 디코더(ZXing)로 읽히는지, GS1 검사 숫자, 투입 WIP ID → 최종 검사 합격 때 시리얼, 보류품은 출하되지 않는지,
// 샘플 요청 즉시 로트 보류 → OK 해제 / NG 봉쇄 → 처분(재작업·폐기) · 선별검사 · 확장 Zone 간이 8D · 샘플링 강화, 수량 정산이 맞는지. 실행: npm test
import zx from '@zxing/library';
import { zoneLine } from '../js/line.js';
import { Simulation } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
import { qrMatrix, dataMatrix, FNC1, GS } from '../js/codes.js';
import { gs1Check, gtinOf, ssccOf, payloadOf, matrixOf, codeSVG, serialsCSV, MRB_T, SORT_T, REWORK_T, TIGHT_N } from '../js/serial.js';
import { serialEpcis } from '../js/epcis.js';
import { allFiles } from '../js/trace.js';
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, QRCodeReader, DataMatrixReader, DecodeHintType } = zx;
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (s, ag, sec) => { for (let t = 0; t < sec; t += 0.1) { s.step(0.1); ag?.update(0.1); } };
const iso = (t) => new Date(Date.UTC(2026, 9, 22) + t * 1000).toISOString();
function decode(m, Reader) {
  const q = 4, sc = 4, n = m.length, W = (n + 2 * q) * sc, px = new Uint8ClampedArray(W * W).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) px[((y + q) * sc + a) * W + (x + q) * sc + b] = 0;
  return new Reader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(px, W, W))), new Map([[DecodeHintType.PURE_BARCODE, true]])).getText();
}
const tryDecode = (m, R) => { try { return decode(m, R); } catch { return null; } };

console.log('== 2차원 코드 인코더 (ZXing 판독)');
{ const qs = ['A', 'https://id.meta-factory.example/01/08800000000031/10/261022HD/21/HD-261022-000001?11=261022'];
  for (let L = 3; L < 70; L += 6) qs.push('메타팩토리-'.repeat(Math.ceil(L / 6)).slice(0, L));   // 한글 3바이트 — 10형 M 용량(213바이트) 안
  for (let L = 20; L <= 213; L += 31) qs.push('x'.repeat(L));
  const okQ = qs.filter((t) => tryDecode(qrMatrix(t), QRCodeReader) === t).length;
  check('QR (ISO/IEC 18004 · 바이트 모드 · 오류 정정 M · 1~10형) — 짧은 글자 ~ 한글 포함 긴 주소까지 판독', okQ === qs.length, `${okQ}/${qs.length} · 크기 ${[...new Set(qs.map((t) => qrMatrix(t).length))].join('·')}`);
  const ds = ['1', 'ABC-123', `${FNC1}0108800000000055112610222` + `1HB-261022-000123${GS}10261022HB`];
  for (let L = 2; L < 170; L += 9) ds.push('HB-261022-'.repeat(20).slice(0, L));
  const want = (t) => t.replace(FNC1, GS);   // ZXing은 맨 앞 FNC1을 GS로 돌려준다 (GS1 DataMatrix 관례)
  const okD = ds.filter((t) => [want(t), t].includes(tryDecode(dataMatrix(t), DataMatrixReader))).length;
  check('DataMatrix ECC200 (ISO/IEC 16022 · 10×10 ~ 48×48 · 2×2 구역) — FNC1 · GS 구분자 포함 판독', okD === ds.length, `${okD}/${ds.length} · 크기 ${[...new Set(ds.map((t) => dataMatrix(t).length))].join('·')}`);
  check('GS1 검사 숫자 (GTIN-13 4006381333931 · SSCC 18자리)', gs1Check('400638133393') === '1' && /^\d{14}$/.test(gtinOf('hood')) && gs1Check(gtinOf('hood').slice(0, 13)) === gtinOf('hood')[13] && /^\d{18}$/.test(ssccOf(7)) && gs1Check(ssccOf(7).slice(0, 17)) === ssccOf(7)[17], `${gtinOf('hood')} · ${ssccOf(7)}`);
  check('SVG 코드 그림 (화면 창 · 캔버스 없이)', /^<svg[^>]+viewBox="0 0 \d+ \d+"/.test(codeSVG(qrMatrix('x'))) && codeSVG(qrMatrix('x')).includes('<path d="M'));
}

console.log('== 정밀조립 (자동화 · 2시간): WIP ID → 검사·포장셀 시리얼 · 출하 SSCC');
const s = new Simulation('smart', 5, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s), H = s.serials, T = s.trace, F = s.fos;
let heldShipped = 0; const take0 = H.take.bind(H); H.take = (p, k, by) => { const r = take0(p, k, by); if (r?.units.some((u) => u.hold)) heldShipped++; return r; };
run(s, ag, 7200);
{ const issued = T.recent.filter((r) => r.serial), qrOk = issued.slice(-20).every((r) => tryDecode(matrixOf(r), QRCodeReader) === r.mark.data);
  check('투입 = WIP ID · 검사·포장셀 합격 = 시리얼 (판정 셀 PACK) · 시리얼 중복 없음', issued.length > 100 &&   /* 실제 작업 시간(1.0.45) */ T.recent.every((r) => r.wip) && issued.every((r) => r.mark.at === 'PACK' && r.tSerial >= r.t0) && new Set(issued.map((r) => r.serial)).size === issued.length, `발행 ${issued.length} · 투입 ${T.recent.length}`);
  check('QR 라벨 내용 = GS1 Digital Link (01 → 10 → 21 · 11) · 실제 판독 일치', qrOk && issued.every((r) => r.mark.data === `https://id.meta-factory.example/01/${gtinOf(r.product)}/10/${r.plot}/21/${r.serial}?11=${r.pdate}`));
  const g = issued.map((r) => r.mark), re = g.filter((m) => m.tries > 1);
  check('판독 검증: 모든 마킹 등급 기록 · 합격(C 이상) 또는 재마킹 이력', g.every((m) => m.grades.length === m.tries && (m.ok ? 'ABC'.includes(m.grade) : true)) && re.every((m) => 'DF'.includes(m.grades[0])), `재마킹 ${re.length}건 · 등급 A ${g.filter((m) => m.grade === 'A').length}`);
  const sh = H.units.filter((u) => u.loc === 'shipped');
  check('출하 = 팔레트 SSCC + 트럭 (시리얼 단위) · 보류품 출하 0', sh.length > 100 && sh.every((u) => /^\d{18}$/.test(u.ship.sscc) && u.ship.truck) && heldShipped === 0 && H.stats.shipped === s.stats.shipped, `출하 ${sh.length} · 팔레트 ${H.stats.pallets} · 시뮬레이션 출하 ${s.stats.shipped}`);
  check('완제품 재고 수 = 시리얼 재고 (구분 적재장)', ['doortrim', 'eaxle'].every((p) => (H.fg[p] ?? []).length === s.fgBy[p]), ['doortrim', 'eaxle'].map((p) => `${p} ${(H.fg[p] ?? []).length}/${s.fgBy[p]}`).join(' · '));
}

console.log('== 정밀검사 샘플 로트 (정밀조립): 요청 즉시 보류 → OK 해제 / NG 봉쇄 → 처분 · 선별검사');
{ const req = { id: 'QS-T1', zone: 'main', product: 'doortrim', t0: s.time };
  F.sampleRequest(req); const lot = H.lotOf('QS-T1'), smp = H.byId.get(req.serial);
  const lotU = H.units.filter((u) => u.hold === 'lot:QS-T1');
  check('샘플 시리얼 지정 · 그 로트(직전 샘플 이후 같은 제품) 출하 보류', !!smp && smp.hold === 'sample' && lot && lot.members.length === lotU.length && H.shippableUnits('doortrim').every((u) => !u.hold), `샘플 ${req.serial} · 로트 ${lotU.length + 1}개`);
  F.sampleAccept(req, '정밀검사-AMR01'); F.sampleHandover({ ...req }); F.sampleResult({ ...req }, 'ok');
  check('결과 OK → 로트·샘플 보류 해제', lot.status === 'released' && smp.hold === null && !H.units.some((u) => u.hold === 'lot:QS-T1'));
  run(s, ag, 600);
  // NG: 이미 유출된(체결 검사를 빠져나간) 불량이 섞인 로트 — 선별검사가 잡는다
  const req2 = { id: 'QS-T2', zone: 'main', product: 'eaxle', t0: s.time }; F.sampleRequest(req2);
  const lot2 = H.lotOf('QS-T2'), m2 = H.units.filter((u) => u.hold === 'lot:QS-T2');
  const plant = m2[0]; if (plant) plant.status = 'escaped';   // 시험용 유출 불량 하나
  const esc0 = T.stats.escaped; if (plant) T.stats.escaped++;
  const fg0 = s.fgBy.eaxle;
  F.sampleResult({ ...req2 }, 'ng');
  check('결과 NG → 봉쇄 (로트 + 같은 시간대 ±10분) · 유출 의심 집계 · 샘플링 강화', lot2.status === 'contain' && H.tight.main === TIGHT_N && Array.isArray(lot2.recall), `로트 ${lot2.members.length + 1} · ±10분 ${lot2.extra.length} · 유출 의심 ${lot2.recall.length}`);
  run(s, ag, MRB_T.smart + (lot2.members.length + lot2.extra.length) * SORT_T.smart + REWORK_T.smart + 30);
  const smp2 = H.byId.get(req2.serial);
  check('처분 판정(MRB) → 샘플 재작업(재검 합격·시리얼 유지) 또는 폐기(시리얼 폐기 기록)', smp2.disp && (smp2.disp.d === 'scrap' ? smp2.status === 'scrap' && H.events.some((e) => e.type === 'decommission' && e.id === smp2.serial) : smp2.hold === null && !!smp2.disp.done), `${smp2.serial} ${smp2.disp?.d}`);
  check('선별검사(전수): 유출 불량 회수(격리 · 재고에서 뺌) · 나머지 해제', lot2.status === 'done' && (!plant || (plant.status === 'ng' && plant.loc === 'quarantine')) && !H.units.some((u) => u.hold === 'lot:QS-T2'), `${lot2.sorted?.n}개 → 양품 ${lot2.sorted?.ok} · 불량 ${lot2.sorted?.bad}`);
  const R = F.main.reconcile();
  check('수량 정산 오차 0 (공정중 + 합격대기 + 보류 + 인계 + 폐기 = 투입)', R.err === 0, JSON.stringify(R));
  check('오케스트레이터 메시지: 출하 보류·봉쇄 · 처분 결과 (존 → 공장 이벤트)', F.bus.log.some((m) => m.type === 'quality.hold' && m.from === 'zone:main' && m.status !== 'blocked') && F.bus.log.some((m) => m.type === 'quality.disposition' && m.status !== 'blocked'));
  void esc0; void fg0;
}

console.log('== 확장 Zone (유연생산 QR · 적응가공 DataMatrix) — 화면 흐름(zones.js) 대신 같은 호출 순서로');
{ const mk = (zone, product, cells, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const it = { id: `${zone}-${i}`, product }; H.extRelease(zone, it, 'AMR-T');
      for (const c of cells) { H.extEnter(it, c, c); const ex = H.isMarkCell(zone, c) ? H.plan(it) : 0; H.extDone(it, c, c === 'C06' ? 'OK' : null); if (H.isMarkCell(zone, c)) H.issue(it, { cell: c, name: c }); void ex; }
      H.toFG(it); s.zoneFg[product] = (s.zoneFg[product] ?? 0) + 1; out.push(H.unitOf(it));
      s.time += 20;   // 생산 간격
    }
    return out;
  };
  const hood = mk('flex', 'hood', ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'], 12), hb = mk('adapt', 'hblock', ['MATL', 'HB_MILL', 'HB_DEBR', 'CMM'], 22);
  check('유연생산: WIP ID → C06 합격 = 시리얼 HD-… · QR 판독', hood.every((u) => /^WIP-HD-/.test(u.wip) && /^HD-\d{6}-\d{6}$/.test(u.serial) && u.mark.symbol === 'QR' && u.mark.at === 'C06') && tryDecode(matrixOf(hood[0]), QRCodeReader) === hood[0].mark.data);
  const dm = tryDecode(matrixOf(hb[0]), DataMatrixReader), p = payloadOf(hb[0]);
  check('적응가공: CMM 합격 = 시리얼 HB-… · GS1 DataMatrix 각인 판독 (01 GTIN · 11 생산일 · 21 시리얼 · GS · 10 로트)', hb.every((u) => u.mark.symbol === 'DM' && u.mark.at === 'CMM') && dm === p.data.replace(FNC1, GS) && dm === `${GS}01${gtinOf('hblock')}11${hb[0].pdate}21${hb[0].serial}${GS}10${hb[0].plot}`, dm?.replace(/\u001d/g, '<GS>'));
  const reqF = { id: 'QS-F1', zone: 'flex', product: 'hood', t0: s.time }; F.sampleRequest(reqF);
  const lotF = H.lotOf('QS-F1'), fgF0 = s.zoneFg.hood;
  check('유연생산 샘플 요청 → 로트 출하 보류 (보류분은 출하 가능 수에서 빠짐)', lotF && lotF.members.length + 1 === 12 && H.shippable('hood') === 0, `로트 ${lotF?.members.length + 1} · 출하 가능 ${H.shippable('hood')}`);
  F.sampleResult({ ...reqF }, 'ng');
  const c = H.cases[0];
  check('NG → 간이 8D 열림 (D0 격리) · 샘플링 강화 N/2 · 공정 보정 예약', c?.lot === 'QS-F1' && c.steps[0].d === 'D0' && H.tight.flex === TIGHT_N && H.sampleEvery('flex', 10) === 5);
  run(s, ag, MRB_T.smart + 12 * SORT_T.smart + REWORK_T.smart + 60);
  const k = H.zoneCounts('flex'), scr = hood.filter((u) => u.status === 'scrap').length, shp = hood.filter((u) => u.loc === 'shipped' || u.loc === 'loading').length;   // 해제된 것은 출하 지게차가 실어 간다
  check('처분 · 선별검사 완료 → 보류 0 · 폐기분은 포장 팔레트 재고에서 빠짐 · 해제분은 출하', lotF.status === 'done' && k.hold === 0 && s.zoneFg.hood === fgF0 - scr - shp && k.scrap === scr, `출하 ${shp} · `+`선별 ${lotF.sorted?.n} → 양품 ${lotF.sorted?.ok} · 불량 ${lotF.sorted?.bad} · 폐기 ${scr} · 재작업 ${hood.filter((u) => u.disp?.d === 'rework').length}`);
  check('간이 8D D0 → D6 (원인 후보 · 공정 보정 · 강화 샘플링 검증) · 공정 보정 값 적용', ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'].every((d) => c.steps.some((x) => x.d === d)) && H.ngFactor('flex') < 1 && H.inlineMul('flex') > 1, c.actions.join(' / '));
  for (let i = 0; i < TIGHT_N; i++) { mk('flex', 'hood', ['C06'], 3); const r = { id: `QS-F${i + 2}`, zone: 'flex', product: 'hood', t0: s.time }; F.sampleRequest(r); F.sampleResult({ ...r }, 'ok'); }
  check(`강화 샘플링 ${TIGHT_N}회 연속 OK → 정상 주기 복귀 · 8D D7·D8 종결`, H.tight.flex === 0 && H.sampleEvery('flex', 10) === 10 && c.status === 'closed' && c.steps.at(-1).d === 'D8');
  const reqA = { id: 'QS-A1', zone: 'adapt', product: 'hblock', t0: s.time }; F.sampleRequest(reqA); F.sampleResult({ ...reqA }, 'ng');
  run(s, ag, 60);
  const ca = H.cases[0], tool = s.fos.adapt.tools;
  check('적응가공 NG → 간이 8D · 원인 후보 셀 · 절삭 조건 보정/CMM 판정 한계 축소', ca.zone === 'adapt' && !!ca.cause && ca.steps.some((x) => x.d === 'D5') && H.ngFactor('adapt') < 1, `${ca.cause?.name} · ${ca.actions[0] ?? ''}${Object.keys(tool).length ? '' : ' (공구 기록 없음 — 화면 흐름에서 채움)'}`);
}

console.log('== 내려받기 (EPCIS 2.0 · CSV)');
{ const doc = serialEpcis(H, iso), ev = doc.epcisBody.eventList, csv = serialsCSV(H).split('\n');
  check('EPCIS: 시리얼 발행(commissioning) · 포장 묶음(AggregationEvent SSCC) · 출하(shipping) · 보류 · 폐기(decommissioning)', ['commissioning', 'packing', 'shipping', 'holding', ...(H.units.some((u) => u.disp?.d === 'scrap') ? ['decommissioning'] : [])].every((b) => ev.some((e) => e.bizStep?.endsWith(b))) && ev.some((e) => e.type === 'AggregationEvent' && /^urn:epc:id:sscc:8800000\.\d{10}$/.test(e.parentID)), `${ev.length}건`);
  check('serials.csv: WIP ID · 시리얼 · GTIN · 마킹 · SSCC · 처분 열', csv[0].startsWith('wip_id,serial,zone,product,gtin') && csv.length > 150);
  const A = allFiles(T, iso).map((f) => f.path);
  check('불량 분석 전체 묶음에 serial_events.jsonld · serials.csv 포함', A.includes('serial_events.jsonld') && A.includes('serials.csv'));
}
console.log(`결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
