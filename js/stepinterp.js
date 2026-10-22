// 화면 보간 — 시뮬레이션은 0.1초 고정 간격으로만 진행하고(같은 시드면 컴퓨터·화면 주사율과 상관없이 같은 결과),
// 그 사이 프레임은 직전 간격과 지금 간격의 위치·진행률을 섞어 그린다. 1배속 60fps면 6프레임마다 한 간격이라 그대로 그리면 23cm씩 끊겨 보인다.
// 쓰는 법: 프레임의 마지막 간격 직전에 capture(대상) → 그리기 전 apply(대상, 남은 비율) → 그린 뒤 restore(). 시뮬레이션 값은 그리는 동안만 바뀌고 바로 돌아온다.
// 대상: x·y·z(이동체) · progress(셀 진행률). 크게 뛴 값(순간 이동 3m 넘음 · 진행률이 되돌아감 = 다음 사이클)은 섞지 않는다.
const POS = ['x', 'y', 'z'], JUMP2 = 9;
export class StepInterp {
  constructor() { this.prev = new WeakMap(); this.saved = []; }
  capture(objs) {
    this.prev = new WeakMap();
    for (const o of objs) if (o) this.prev.set(o, [o.x, o.y, o.z, o.progress]);
  }
  apply(objs, a) {
    this.restore();
    if (!(a > 0 && a < 1)) return;
    for (const o of objs) {
      const p = o && this.prev.get(o); if (!p) continue;
      const cur = [o.x, o.y, o.z, o.progress], out = cur.slice();
      if (Number.isFinite(cur[0]) && Number.isFinite(cur[2]) && Number.isFinite(p[0]) && Number.isFinite(p[2]) && (cur[0] - p[0]) ** 2 + (cur[2] - p[2]) ** 2 <= JUMP2) {
        for (let i = 0; i < 3; i++) if (Number.isFinite(cur[i]) && Number.isFinite(p[i])) out[i] = p[i] + (cur[i] - p[i]) * a;
      }
      if (Number.isFinite(cur[3]) && Number.isFinite(p[3]) && cur[3] >= p[3]) out[3] = p[3] + (cur[3] - p[3]) * a;
      let changed = false;
      for (let i = 0; i < 4; i++) if (out[i] !== cur[i]) changed = true;
      if (!changed) continue;
      this.saved.push([o, cur]);
      POS.forEach((k, i) => { if (out[i] !== cur[i]) o[k] = out[i]; });
      if (out[3] !== cur[3]) o.progress = out[3];
    }
  }
  restore() {
    for (const [o, cur] of this.saved) { POS.forEach((k, i) => { if (cur[i] !== undefined) o[k] = cur[i]; }); if (cur[3] !== undefined) o.progress = cur[3]; }
    this.saved.length = 0;
  }
}
