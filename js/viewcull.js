// 보조 화면(로봇 비전 전광판·CCTV·녹화·에피소드 캡처) 렌더: 그 화면에 1픽셀보다 작게 찍힐 물체는 빼고 그린다
// 보조 화면은 해상도가 낮고(160×120 ~ 타일 수백 픽셀) 공장 전체를 다시 그리므로, 멀리 있는 나사·케이블·라벨판 같은 작은 메시가 그리기 호출 대부분을 차지했다
// (tools/perf-sample.cjs 측정: 보조 화면 합계가 메인 화면보다 draw가 많음). 1픽셀 미만은 저해상도 렌더 타깃(MSAA 없음)에서 거의 보이지 않으므로 화면 차이는 없다
// 메인 화면은 그대로 (이 함수를 쓰지 않음)
const MIN_PX = 1;          // 이보다 작게 찍히면 뺀다 (화면 픽셀)
const SMALL_R = 0.6;       // 이보다 큰 물체(월드 반지름 m)는 후보에서 뺀다 — 보조 카메라 먼 쪽 끝(60~90m)에서도 1픽셀 넘게 찍힘
const REFRESH_MS = 2000;   // 후보 목록을 다시 만드는 간격 (운영 중 새로 생긴 대상물·트럭·Blender 교체 모델)

const cache = new WeakMap();   // 장면마다 후보 목록
function candidates(scene) {
  const now = performance.now(), hit = cache.get(scene);
  if (hit && now - hit.t < REFRESH_MS) return hit.list;
  const list = [];
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.children.length || !o.geometry) return;   // 자식이 있는 메시는 숨기면 자식까지 사라지므로 뺀다
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere; if (!s || !Number.isFinite(s.radius)) return;
    const e = o.matrixWorld.elements, k = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
    const r = s.radius * k; if (r < SMALL_R) list.push({ o, r, c: s.center });
  });
  cache.set(scene, { t: now, list });
  return list;
}

const hidden = [];
// cam: 그릴 카메라 · pxH: 이 렌더가 차지하는 세로 픽셀 (전광판 칸이면 칸 높이)
export function renderAux(r, scene, cam, pxH) {
  cam.updateMatrixWorld();
  const ce = cam.matrixWorld.elements, cx = ce[12], cy = ce[13], cz = ce[14];
  const kk = pxH / (2 * Math.tan((cam.fov ?? 60) * Math.PI / 360) * MIN_PX), list = candidates(scene);
  for (let i = 0; i < list.length; i++) {
    const { o, r: rad, c } = list[i]; if (!o.visible) continue;
    const e = o.matrixWorld.elements;
    const x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12] - cx, y = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13] - cy, z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14] - cz;
    const lim = rad * kk;
    if (x * x + y * y + z * z > lim * lim) { o.visible = false; hidden.push(o); }
  }
  try { r.render(scene, cam); } finally { for (const o of hidden) o.visible = true; hidden.length = 0; }
}
