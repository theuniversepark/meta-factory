// 설비 대시보드 JSON 생성 (Grafana 12 · InfluxDB 2 Flux) → monitoring/grafana/dashboards/*.json
//  ① 공장 개요 · ② 설비 건강도·RUL · ③ 적응가공 가공기 상태 감시 · ④ 환경·설비 센서 — 모두 운영 이벤트(경보·주의·조치)를 그래프 위에 겹친다
// 실행: node tools/gen-grafana.mjs  (결과 JSON을 커밋 — 앱이 monitoring/ 폴더를 그대로 데이터 폴더로 복사해 쓴다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../monitoring/grafana/dashboards');
const DS = { type: 'influxdb', uid: 'mf-influx' };
const R = 'range(start: v.timeRangeStart, stop: v.timeRangeStop)';
let pid = 0;
const target = (query, refId = 'A') => ({ datasource: DS, refId, query });
const panel = (type, title, grid, targets, extra = {}) => ({ id: ++pid, type, title, datasource: DS, gridPos: grid, targets: Array.isArray(targets) ? targets : [target(targets)], ...extra });
const ts = (title, grid, q, { unit = 'short', min, max, thresholds, desc, overrides = [] } = {}) => panel('timeseries', title, grid, q, {
  description: desc,
  fieldConfig: { defaults: { unit, min, max, custom: { lineWidth: 1, fillOpacity: 6, showPoints: 'never', spanNulls: true, ...(thresholds ? { thresholdsStyle: { mode: 'line+area' } } : {}) }, ...(thresholds ? { thresholds: { mode: 'absolute', steps: thresholds } } : {}) }, overrides: overrides.map(([n, d, c]) => ({ matcher: { id: 'byName', options: n }, properties: [{ id: 'displayName', value: d }, { id: 'color', value: { mode: 'fixed', fixedColor: c } }, ...(n === 'value' ? [{ id: 'custom.showPoints', value: 'always' }] : [{ id: 'custom.lineStyle', value: { fill: 'dash', dash: [8, 4] } }])] })) },
  options: { legend: { displayMode: 'table', placement: 'right', calcs: ['lastNotNull', 'min', 'max'] }, tooltip: { mode: 'multi', sort: 'desc' } },
});
const stat = (title, grid, q, { unit = 'short', color = 'blue', thresholds, decimals } = {}) => panel('stat', title, grid, q, {
  fieldConfig: { defaults: { unit, decimals, color: { mode: thresholds ? 'thresholds' : 'fixed', fixedColor: color }, thresholds: { mode: 'absolute', steps: thresholds ?? [{ color, value: null }] } }, overrides: [] },
  options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'background', graphMode: 'area', textMode: 'value', justifyMode: 'center' },
});
const HEALTH_STEPS = [{ color: 'red', value: null }, { color: 'orange', value: 40 }, { color: 'yellow', value: 55 }, { color: 'green', value: 70 }];
// 운영 이벤트 겹치기 (Flux → time · text · tags)
const annotations = (zoneVar = false) => ({ list: [
  { builtIn: 1, datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: true, iconColor: 'rgba(0, 211, 255, 1)', name: 'Annotations & Alerts', type: 'dashboard' },
  ...[['alert', '경보', 'red'], ['warn', '주의', 'orange'], ['act', '조치', 'blue']].map(([lv, name, color]) => ({
    datasource: DS, enable: lv !== 'act', iconColor: color, name: `운영 이벤트 — ${name}`,
    target: { refId: 'Anno', query: `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "event" and r.level == "${lv}"${zoneVar ? ' and (r.zone == "${zone}" or "${zone}" == "all")' : ''}) |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value") |> map(fn: (r) => ({ _time: r._time, text: r.title + (if exists r.text then " — " + r.text else ""), tags: r.zone }))` },
  })),
] });
const zoneVar = { name: 'zone', label: 'Zone', type: 'custom', query: 'all,main,flex,adapt,insp', current: { text: 'all', value: 'all' }, options: [], includeAll: false, multi: false };
const dash = (uid, title, panels, { vars = [], desc, zoneAnno = false, from = 'now-30m', refresh = '10s' } = {}) => ({
  uid, title, description: desc, tags: ['메타팩토리'], timezone: 'browser', refresh, time: { from, to: 'now' }, schemaVersion: 41, version: 1, editable: false,
  templating: { list: vars }, annotations: annotations(zoneAnno), panels,
  links: [{ title: '메타팩토리 대시보드', type: 'dashboards', tags: ['메타팩토리'], asDropdown: true, includeVars: false, keepTime: true }],
});
const zoneF = '(r.zone == "${zone}" or "${zone}" == "all")';
const lastEq = (field) => `from(bucket: "raw") |> range(start: -2m) |> filter(fn: (r) => r._measurement == "equipment" and r._field == "${field}" and ${zoneF}) |> last()`;

// ① 공장 개요
pid = 0;
const overview = dash('mf-overview', '메타팩토리 · 공장 개요', [
  stat('가동 중 셀', { x: 0, y: 0, w: 6, h: 5 }, `${lastEq('busy')} |> group() |> sum() |> map(fn: (r) => ({ r with _field: "가동 중" }))`, { color: 'green' }),
  stat('고장·정비 중 셀', { x: 6, y: 0, w: 6, h: 5 }, `${lastEq('down')} |> group() |> sum() |> map(fn: (r) => ({ r with _field: "고장·정비" }))`, { thresholds: [{ color: 'green', value: null }, { color: 'orange', value: 1 }, { color: 'red', value: 3 }] }),
  stat('평균 건강도', { x: 12, y: 0, w: 6, h: 5 }, `${lastEq('health')} |> group() |> mean() |> map(fn: (r) => ({ r with _field: "평균 건강도" }))`, { unit: 'percent', thresholds: HEALTH_STEPS, decimals: 1 }),
  stat('최저 건강도', { x: 18, y: 0, w: 6, h: 5 }, `${lastEq('health')} |> group() |> min() |> map(fn: (r) => ({ r with _field: r.name }))`, { unit: 'percent', thresholds: HEALTH_STEPS, decimals: 1 }),
  panel('bargauge', 'Zone별 평균 건강도', { x: 0, y: 5, w: 8, h: 8 }, `from(bucket: "raw") |> range(start: -2m) |> filter(fn: (r) => r._measurement == "equipment" and r._field == "health") |> last() |> group(columns: ["zone"]) |> mean() |> map(fn: (r) => ({ _value: r._value, zone: if r.zone == "main" then "정밀조립" else if r.zone == "flex" then "유연생산" else if r.zone == "adapt" then "적응가공" else "정밀검사" })) |> group()`,
    { fieldConfig: { defaults: { unit: 'percent', min: 0, max: 100, thresholds: { mode: 'absolute', steps: HEALTH_STEPS }, color: { mode: 'thresholds' }, displayName: '${__field.labels.zone}' }, overrides: [] }, options: { orientation: 'horizontal', displayMode: 'gradient', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: true }, showUnfilled: true } }),
  ts('고장·정비 중 셀 수 (Zone별)', { x: 8, y: 5, w: 16, h: 8 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "equipment" and r._field == "down") |> aggregateWindow(every: v.windowPeriod, fn: max, createEmpty: false) |> group(columns: ["_time", "zone"]) |> sum() |> group(columns: ["zone"])`, { desc: '고장(DOWN) 또는 정비 중(MAINT)인 셀 수' }),
  panel('table', '설비 현재 상태 (건강도 낮은 순)', { x: 0, y: 13, w: 24, h: 12 }, `from(bucket: "raw") |> range(start: -2m) |> filter(fn: (r) => r._measurement == "equipment" and ${zoneF}) |> last() |> pivot(rowKey: ["asset", "name", "zone"], columnKey: ["_field"], valueColumn: "_value") |> group() |> keep(columns: ["zone", "asset", "name", "health", "rul_min", "risk10", "cpk", "state"]) |> sort(columns: ["health"])`,
    { fieldConfig: { defaults: { custom: { align: 'auto' } }, overrides: [
      { matcher: { id: 'byName', options: 'health' }, properties: [{ id: 'displayName', value: '건강도 %' }, { id: 'custom.cellOptions', value: { type: 'color-background' } }, { id: 'thresholds', value: { mode: 'absolute', steps: HEALTH_STEPS } }, { id: 'decimals', value: 1 }] },
      { matcher: { id: 'byName', options: 'rul_min' }, properties: [{ id: 'displayName', value: 'RUL (분)' }, { id: 'decimals', value: 0 }] },
      { matcher: { id: 'byName', options: 'risk10' }, properties: [{ id: 'displayName', value: '10분 고장확률' }, { id: 'unit', value: 'percentunit' }] },
      { matcher: { id: 'byName', options: 'cpk' }, properties: [{ id: 'displayName', value: 'Cpk' }] },
      { matcher: { id: 'byName', options: 'state' }, properties: [{ id: 'displayName', value: '상태' }] },
      { matcher: { id: 'byName', options: 'name' }, properties: [{ id: 'displayName', value: '설비' }] },
      { matcher: { id: 'byName', options: 'asset' }, properties: [{ id: 'displayName', value: '설비 ID' }] },
      { matcher: { id: 'byName', options: 'zone' }, properties: [{ id: 'displayName', value: 'Zone' }] }] }, options: { showHeader: true, cellHeight: 'sm' },
      transformations: [{ id: 'organize', options: { indexByName: { asset: 0, name: 1, zone: 2, health: 3, state: 4, rul_min: 5, risk10: 6, cpk: 7 } } }] }),
], { vars: [zoneVar], zoneAnno: true, desc: '가동·고장 셀 수, Zone별 건강도, 설비 현재 상태 — 앱 MQTT(UNS) metafactory/telemetry/v1' });

// ② 설비 건강도 · RUL
pid = 0;
const assetVar = { name: 'asset', label: '설비', type: 'query', datasource: DS, query: 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "raw", tag: "name", predicate: (r) => r._measurement == "equipment" and (r.zone == "${zone}" or "${zone}" == "all"), start: -1d)', refresh: 2, includeAll: true, multi: true, current: { text: 'All', value: '$__all' }, allValue: '.*', sort: 1 };
const eqTs = (field) => `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "equipment" and r._field == "${field}" and ${zoneF} and r.name =~ /^\${asset:regex}$/) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.name })) |> group(columns: ["_field"])`;
const health = dash('mf-health', '메타팩토리 · 설비 건강도 · RUL', [
  ts('건강도 (%)', { x: 0, y: 0, w: 24, h: 10 }, eqTs('health'), { unit: 'percent', min: 0, max: 100, thresholds: [{ color: 'transparent', value: null }, { color: 'red', value: 0 }, { color: 'transparent', value: 50 }], desc: '빨간 영역 = 예지정비 착수 검토 구간 (건강도 50% 미만)' }),
  ts('잔여수명 RUL (분)', { x: 0, y: 10, w: 12, h: 9 }, eqTs('rul_min'), { unit: 'm' }),
  ts('10분 고장확률', { x: 12, y: 10, w: 12, h: 9 }, eqTs('risk10'), { unit: 'percentunit' }),
  ts('공정능력 Cpk', { x: 0, y: 19, w: 12, h: 8 }, eqTs('cpk'), { thresholds: [{ color: 'red', value: null }, { color: 'transparent', value: 1.33 }], desc: '빨간 영역 = Cpk 1.33 미만 (재보정 검토)' }),
  ts('건강도 장기 추세 (1분 집계 · 90일 보관)', { x: 12, y: 19, w: 12, h: 8 }, `from(bucket: "agg_1m") |> ${R} |> filter(fn: (r) => r._measurement == "equipment" and r._field == "health" and ${zoneF} and r.name =~ /^\${asset:regex}$/) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.name })) |> group(columns: ["_field"])`, { unit: 'percent', min: 0, max: 100 }),
], { vars: [zoneVar, assetVar], zoneAnno: true, from: 'now-1h', desc: '셀별 건강도·RUL·고장확률·Cpk 추세 — 예지정비 근거' });

// ③ 적응가공 가공기 상태 감시
pid = 0;
const machVar = { name: 'machine', label: '가공기', type: 'query', datasource: DS, query: 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "raw", tag: "asset", predicate: (r) => r._measurement == "machine", start: -1d)', refresh: 2, includeAll: true, multi: true, current: { text: 'All', value: '$__all' }, allValue: '.*', sort: 1 };
const mTs = (field) => `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "machine" and r._field == "${field}" and r.asset =~ /^\${machine:regex}$/) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.asset })) |> group(columns: ["_field"])`;
const wTs = (meas, field) => `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "${meas}" and r._field == "${field}") |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.asset })) |> group(columns: ["_field"])`;   // 세척기 (자산 1대)
const machine = dash('mf-machine', '메타팩토리 · 적응가공 가공기 상태 감시', [
  ts('이상 점수 (엣지 AI)', { x: 0, y: 0, w: 12, h: 8 }, mTs('anomaly'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 0.6 }, { color: 'red', value: 0.8 }] }),
  ts('잔여 수명 RUL — 공구 · 주축 (분)', { x: 12, y: 0, w: 12, h: 8 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "machine" and (r._field == "rul_tool_min" or r._field == "rul_spindle_min") and r.asset =~ /^\${machine:regex}$/) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.asset + (if r._field == "rul_tool_min" then " 공구" else " 주축") })) |> group(columns: ["_field"])`, { unit: 'm' }),
  ts('주축 부하 (%)', { x: 0, y: 8, w: 8, h: 8 }, mTs('spindleLoad'), { unit: 'percent' }),
  ts('진동 RMS (mm/s)', { x: 8, y: 8, w: 8, h: 8 }, mTs('vibration'), { unit: 'suffix: mm/s' }),
  ts('진동 첨도 (Kurtosis)', { x: 16, y: 8, w: 8, h: 8 }, mTs('kurtosis'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 4.5 }] }),
  ts('음향방출 AE (dB)', { x: 0, y: 16, w: 8, h: 8 }, mTs('ae'), { unit: 'suffix: dB' }),
  ts('주축 베어링 온도 (°C)', { x: 8, y: 16, w: 8, h: 8 }, mTs('bearingTemp'), { unit: 'celsius' }),
  ts('공구 플랭크 마모 VB (µm)', { x: 16, y: 16, w: 8, h: 8 }, mTs('toolVB'), { unit: 'suffix: µm' }),
  ts('공구 마모율', { x: 0, y: 24, w: 12, h: 8 }, mTs('tool_wear'), { unit: 'percentunit' }),
  panel('state-timeline', '엣지 AI 판단 (정상 · 감시 · 교체 권고 · 즉시 교체 · 주축 점검)', { x: 12, y: 24, w: 12, h: 8 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "machine" and r._field == "decision" and r.asset =~ /^\${machine:regex}$/) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.asset })) |> group(columns: ["_field"])`,
    { fieldConfig: { defaults: { color: { mode: 'thresholds' } }, overrides: [] }, options: { showValue: 'auto', mergeValues: true, rowHeight: 0.8 } }),
  // 유압블록 디버링셀 세척기 (js/washer.js · metafactory/washer/v1): 공정 센서 · 블록별 청정도 — 필터 차압이 오르면 청정도가 나빠지고, 교체하면 돌아온다
  ts('세척기 고압 펌프 압력 (bar)', { x: 0, y: 32, w: 8, h: 8 }, wTs('washer', 'pressure'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 540 }] }),
  ts('세척기 백필터 차압 (bar)', { x: 8, y: 32, w: 8, h: 8 }, wTs('washer', 'dp'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 0.8 }, { color: 'red', value: 1.2 }] }),
  ts('세척액 전도도 (µS/cm)', { x: 16, y: 32, w: 8, h: 8 }, wTs('washer', 'cond'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 900 }, { color: 'red', value: 1200 }] }),
  ts('청정도 — 최대 금속 입자 (µm · 블록마다 · 규격 ≤ 400)', { x: 0, y: 40, w: 12, h: 8 }, wTs('cleanliness', 'maxParticle_um'), { thresholds: [{ color: 'transparent', value: null }, { color: 'red', value: 400 }] }),
  ts('청정도 — 잔류 오염량 (mg · 블록마다 · 규격 ≤ 2.0)', { x: 12, y: 40, w: 12, h: 8 }, wTs('cleanliness', 'residue_mg'), { thresholds: [{ color: 'transparent', value: null }, { color: 'red', value: 2 }] }),
  // CMM 셀 (js/cmmcell.js · metafactory/cmm/v1): 항온 측정실 온도 · 소재 온도와 온도 보정 뒤 남은 오차 (피지컬AI < 1µm · 자동화 선형식 수 µm)
  ts('CMM 측정실 온도 (°C · 20 ± 1)', { x: 0, y: 48, w: 8, h: 8 }, wTs('cmm', 'room'), { thresholds: [{ color: 'transparent', value: null }, { color: 'orange', value: 20.6 }, { color: 'red', value: 21 }] }),
  ts('CMM 소재 온도 (°C · 소재마다)', { x: 8, y: 48, w: 8, h: 8 }, wTs('cmm_part', 'partTemp_C')),
  ts('CMM 온도 보정 뒤 남은 오차 (µm · 소재마다)', { x: 16, y: 48, w: 8, h: 8 }, wTs('cmm_part', 'residual_um')),
], { vars: [machVar], from: 'now-30m', desc: '적응가공 가공기 4대 — 주축 부하·진동·AE·베어링 온도·공구 마모 → 엣지 AI 이상 점수·RUL·판단 (metafactory/machmon/v1) · 유압블록 세척기 공정·청정도 (metafactory/washer/v1) · CMM 측정실·온도 보정 (metafactory/cmm/v1)' });

// ④ 환경 · 설비 센서
pid = 0;
const metricVar = { name: 'metric', label: '지표', type: 'query', datasource: DS, query: 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "raw", tag: "m", predicate: (r) => r._measurement == "sensor" and (r.zone == "${zone}" or "${zone}" == "all"), start: -1d)', refresh: 2, includeAll: true, multi: true, current: { text: 'All', value: '$__all' }, allValue: '.*', sort: 1 };
const sensor = dash('mf-sensors', '메타팩토리 · 환경 · 설비 센서', [
  ts('센서 측정값 (지표별 · 센서별)', { x: 0, y: 0, w: 24, h: 14 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "sensor" and r._field == "v" and ${zoneF} and r.m =~ /^\${metric:regex}$/) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: r.m + " · " + r.s + " (" + r.u + ")" })) |> group(columns: ["_field"])`),
  panel('table', '센서 최신값', { x: 0, y: 14, w: 24, h: 12 }, `from(bucket: "raw") |> range(start: -5m) |> filter(fn: (r) => r._measurement == "sensor" and r._field == "v" and ${zoneF} and r.m =~ /^\${metric:regex}$/) |> last() |> group() |> keep(columns: ["zone", "cell", "s", "m", "u", "_value", "_time"]) |> sort(columns: ["zone", "cell", "m"])`,
    { fieldConfig: { defaults: {}, overrides: [{ matcher: { id: 'byName', options: '_value' }, properties: [{ id: 'displayName', value: '값' }, { id: 'decimals', value: 2 }] }, { matcher: { id: 'byName', options: 's' }, properties: [{ id: 'displayName', value: '센서' }] }, { matcher: { id: 'byName', options: 'm' }, properties: [{ id: 'displayName', value: '지표' }] }, { matcher: { id: 'byName', options: 'u' }, properties: [{ id: 'displayName', value: '단위' }] }, { matcher: { id: 'byName', options: '_time' }, properties: [{ id: 'displayName', value: '수신' }] }] }, options: { showHeader: true, cellHeight: 'sm' } }),
], { vars: [zoneVar, metricVar], zoneAnno: true, from: 'now-15m', desc: '환경(온습도·진동·PM2.5 등)·설비 센서 — 셀 엣지 묶음 metafactory/sensors/v1' });

// ⑤ Zone 운영 분석 — OEE · 손실·NG 파레토 · 관리도(I-MR) · 산점도 (앱 「Zone 대시보드」 창과 같은 계산 — js/zonekpi.js가 metafactory/oee · quality로 보냄)
pid = 0;
const zVar = { name: 'zone', label: 'Zone', type: 'custom', query: '정밀조립 : main,유연생산 : flex,적응가공 : adapt,정밀검사 : insp', current: { text: '정밀조립', value: 'main' }, options: [], includeAll: false, multi: false };
const keyVar = (name, label, prefix) => ({ name, label, type: 'query', datasource: DS, query: `import "influxdata/influxdb/schema"\nimport "strings"\nschema.fieldKeys(bucket: "raw", predicate: (r) => r._measurement == "quality" and r.zone == "\${zone}", start: -1d) |> filter(fn: (r) => strings.hasPrefix(v: r._value, prefix: "${prefix}"))`, refresh: 2, includeAll: false, multi: false, sort: 1 });
const oeeLast = (f) => `from(bucket: "raw") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "oee" and r.zone == "\${zone}" and r._field == "${f}") |> last()`;
const LOSS_KO = [['loss_down', '설비 고장'], ['loss_setup', '준비·교체'], ['loss_stop', '운영 정지'], ['loss_idle', '자재 대기(공전)'], ['loss_blocked', '출구 막힘'], ['loss_speed', '속도 저하'], ['loss_defect', '불량·재작업']];
const lossName = LOSS_KO.reduceRight((a, [k, l]) => `if r._field == "${k}" then "${l}" else ${a}`, 'r._field');
const cum = (src, labelExpr, valExpr) => `data = ${src} |> map(fn: (r) => ({ label: ${labelExpr}, v: ${valExpr} })) |> sort(columns: ["v"], desc: true)
tt = data |> sum(column: "v") |> findColumn(fn: (key) => true, column: "v")
total = if length(arr: tt) > 0 then tt[0] else 0.0
data |> map(fn: (r) => ({ r with c: r.v })) |> cumulativeSum(columns: ["c"]) |> map(fn: (r) => ({ label: r.label + " · 누적 " + string(v: int(v: if total > 0.0 then r.c / total * 100.0 + 0.5 else 0.0)) + "%", v: r.v }))`;   // 누적 %는 막대 이름에 (막대 차트에 꺾은선을 겹칠 수 없어서)
const paretoPanel = (title, grid, q, vName, vUnit) => panel('barchart', title, grid, q, {
  fieldConfig: { defaults: { unit: vUnit, color: { mode: 'fixed', fixedColor: '#ff8a5c' }, custom: { fillOpacity: 80, lineWidth: 0 } }, overrides: [
    { matcher: { id: 'byName', options: 'v' }, properties: [{ id: 'displayName', value: vName }] }] },
  options: { xField: 'label', orientation: 'horizontal', showValue: 'always', groupWidth: 0.75, barWidth: 0.9, legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi' } },
});
const zone = dash('mf-zone', '메타팩토리 · Zone 운영 분석 (OEE · 파레토 · 관리도 · 산점도)', [
  stat('OEE', { x: 0, y: 0, w: 5, h: 5 }, oeeLast('oee'), { unit: 'percentunit', decimals: 1, thresholds: [{ color: 'red', value: null }, { color: 'orange', value: 0.45 }, { color: 'green', value: 0.65 }] }),
  stat('가동률 A', { x: 5, y: 0, w: 5, h: 5 }, oeeLast('a'), { unit: 'percentunit', decimals: 1, color: 'green' }),
  stat('성능 P', { x: 10, y: 0, w: 5, h: 5 }, oeeLast('p'), { unit: 'percentunit', decimals: 1, color: 'blue' }),
  stat('품질 Q', { x: 15, y: 0, w: 4, h: 5 }, oeeLast('q'), { unit: 'percentunit', decimals: 1, color: 'orange' }),
  panel('gauge', '교대 계획 진행률', { x: 19, y: 0, w: 5, h: 5 }, oeeLast('progress'), { fieldConfig: { defaults: { unit: 'percentunit', min: 0, max: 1, thresholds: { mode: 'absolute', steps: [{ color: 'blue', value: null }] }, color: { mode: 'thresholds' } }, overrides: [] }, options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, showThresholdMarkers: false } }),
  ts('OEE · 가동률 · 성능 · 품질 추세 (누적)', { x: 0, y: 5, w: 24, h: 8 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "oee" and r.zone == "\${zone}" and (r._field == "oee" or r._field == "a" or r._field == "p" or r._field == "q")) |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false) |> map(fn: (r) => ({ _time: r._time, _value: r._value, _field: if r._field == "oee" then "OEE" else if r._field == "a" then "가동률" else if r._field == "p" then "성능" else "품질" })) |> group(columns: ["_field"])`, { unit: 'percentunit', min: 0, max: 1, desc: 'ISO 22400-2 — OEE = 가동률 × 성능 × 품질 (계획 정비 제외)' }),
  paretoPanel('손실 시간 파레토 (6대 손실 · 분)', { x: 0, y: 13, w: 12, h: 9 }, cum(`from(bucket: "raw") |> range(start: -1h) |> filter(fn: (r) => r._measurement == "oee" and r.zone == "\${zone}" and r._field =~ /^loss_/) |> last() |> group()`, lossName, 'r._value'), '손실 (분)', 'm'),
  paretoPanel('NG 유형 파레토 (선택 기간 · 건)', { x: 12, y: 13, w: 12, h: 9 }, cum(`from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "quality" and r.zone == "\${zone}" and r._field == "ng" and r._value == 1) |> group(columns: ["kind"]) |> count() |> group()`, 'r.kind', 'float(v: r._value)'), 'NG (건)', 'none'),
  ts('관리도 (I-MR) — ${yvar}', { x: 0, y: 22, w: 14, h: 10 }, `import "math"
data = from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "quality" and r.zone == "\${zone}" and r._field == "\${yvar}") |> group() |> sort(columns: ["_time"]) |> keep(columns: ["_time", "_value"])
mr = data |> difference() |> map(fn: (r) => ({ r with _value: math.abs(x: r._value) })) |> mean() |> findColumn(fn: (key) => true, column: "_value")
cl = data |> mean() |> findColumn(fn: (key) => true, column: "_value")
m = if length(arr: mr) > 0 then mr[0] else 0.0
c = if length(arr: cl) > 0 then cl[0] else 0.0
data |> map(fn: (r) => ({ _time: r._time, value: r._value, ucl: c + 2.66 * m, cl: c, lcl: c - 2.66 * m }))`, { overrides: [['value', '측정값', '#cfe6f0'], ['ucl', 'UCL', '#ff7a7a'], ['cl', 'CL (평균)', '#7fd6ff'], ['lcl', 'LCL', '#ff7a7a']], desc: '개별값 관리도 — UCL·LCL = 평균 ± 2.66 × 평균 이동범위 (선택 기간 전체로 계산). 앱 「Zone 대시보드」는 X̄-R(부분군 5)과 Western Electric 규칙 위반도 표시' }),
  panel('xychart', '산점도 — ${xvar} × ${yvar} (양품 · NG)', { x: 14, y: 22, w: 10, h: 10 }, `from(bucket: "raw") |> ${R} |> filter(fn: (r) => r._measurement == "quality" and r.zone == "\${zone}" and (r._field == "\${xvar}" or r._field == "\${yvar}" or r._field == "ng")) |> map(fn: (r) => ({ r with _value: float(v: r._value) })) |> group() |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value") |> filter(fn: (r) => exists r["\${xvar}"] and exists r["\${yvar}"]) |> map(fn: (r) => ({ 판정: if exists r.ng and r.ng == 1.0 then "NG" else "양품", x: r["\${xvar}"], y: r["\${yvar}"] })) |> group(columns: ["판정"])`,
    { fieldConfig: { defaults: { custom: { show: 'points', pointSize: { fixed: 5 } } }, overrides: [] }, options: { mapping: 'auto', series: [{}], legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'single' } } }),
], { vars: [zVar, keyVar('yvar', '품질 특성 (y)', 'y_'), keyVar('xvar', '공정 변수 (x)', 'x_')], zoneAnno: true, from: 'now-1h', refresh: '10s', desc: 'Zone별 OEE·6대 손실·NG 유형·관리도·공정–품질 상관 — 앱 MQTT metafactory/oee/v1 · metafactory/quality/v1' });

fs.mkdirSync(OUT, { recursive: true });
for (const [f, d] of [['mf-overview', overview], ['mf-health', health], ['mf-machine', machine], ['mf-sensors', sensor], ['mf-zone', zone]]) fs.writeFileSync(path.join(OUT, `${f}.json`), JSON.stringify(d, null, 1));
console.log('dashboards →', OUT);
