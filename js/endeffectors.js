// 로봇 엔드이펙터 (유연생산Zone 셀) — 6축 로봇 툴 플랜지(ToolFlange)에 기본 그리퍼 대신 다는 공정 툴
// 플랜지 로컬 +y가 툴 축(바깥쪽), TCP(ToolTCP)는 플랜지에서 0.15m — 역기구학이 TCP를 쓰므로 툴마다 작업 끝점을 TCP에 맞춘다
//   spot : 서보 C형 스폿용접 건 — 위 전극(TCP)과 아래 전극이 판을 사이에 두고 마주 보고, 변압기·C암은 툴 축 옆(플랜지 −x)에 둔다
//   seal : 실러 디스펜싱 건 — 노즐 끝이 TCP, 건 뒤쪽 호스 피팅에서 디스펜서(펌프)까지 호스가 이어진다 (zones.js가 매 프레임 호스를 그린다)
//   vacuum : 패널 핸들링 진공 그리퍼 — 알루미늄 프레임 끝 흡착컵 4개, 컵 면이 TCP 높이
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3, ...o });
const M = { body: std(0x3a4047), copper: std(0xc0773a, { metalness: 0.8, roughness: 0.3 }), arm: std(0x8a939c, { metalness: 0.7 }), blue: std(0x2b6cb0), nozzle: std(0xd9dde2, { metalness: 0.8, roughness: 0.25 }), rubber: std(0x1d1f22, { roughness: 0.9, metalness: 0 }), alu: std(0xb8c0c8, { metalness: 0.75, roughness: 0.3 }), hose: std(0x1b1d20, { roughness: 0.8, metalness: 0 }) };
const box = (w, h, d, m, x, y, z, p) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };
const cyl = (r0, r1, h, m, x, y, z, p, seg = 14) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; };

// 기본 그리퍼(손가락·그리퍼 몸체)를 숨기고 툴을 단다
function mount(arm, build) {
  const fl = arm.flange ?? arm.tip?.parent; if (!fl) return null;
  for (const n of ['CustomFinger1', 'CustomFinger-1', 'CustomGripper']) { const o = fl.getObjectByName(n); if (o) o.visible = false; }
  const g = new THREE.Group(); g.name = 'EndEffector'; fl.add(g); build(g); return g;
}

// 스폿용접 C건: 위 전극 팁이 TCP(y 0.15) · 아래 전극(턱 · 팁 · 홀더)은 C암을 따라 툴 축 방향으로 움직인다 — setGap(판 두께, 닫힘 0~1)
// 벌림 = 판 두께 + 3cm(열림) → 판 두께(닫힘: 아래 팁이 판 아랫면) · 목(throat) 깊이 0.26m — 판 가장자리 안쪽 점까지 아래 전극이 판 밑으로 들어간다
export function attachSpotGun(arm) {
  return mount(arm, (g) => {
    box(0.14, 0.05, 0.14, M.arm, 0, 0.025, 0, g).name = 'GunAdapter';                  // 플랜지 어댑터
    box(0.22, 0.1, 0.2, M.body, -0.1, 0.045, 0, g).name = 'GunTransformer';            // 변압기·서보 모터 (아랫면이 위 전극 끝보다 5cm 위 — 판 윗면에 닿지 않게)
    box(0.02, 0.1, 0.12, M.blue, -0.215, 0.07, 0, g).name = 'GunTimerBox';             // 용접 타이머 케이블 박스
    cyl(0.03, 0.03, 0.06, M.arm, 0, 0.11, 0, g).name = 'GunUpperHolder';               // 위 전극 홀더
    cyl(0.012, 0.016, 0.04, M.copper, 0, 0.13, 0, g).name = 'GunUpperTip';             // 위 전극 캡 (끝 = TCP)
    box(0.05, 0.36, 0.05, M.arm, -0.26, 0.2, 0, g).name = 'GunCArm';                   // C암 등 (툴 축 옆)
    const low = new THREE.Group(); low.name = 'GunLower'; g.add(low);
    box(0.29, 0.045, 0.05, M.arm, -0.125, 0.33, 0, low).name = 'GunLowerJaw';           // 아래 턱 (판 밑으로)
    cyl(0.016, 0.012, 0.05, M.copper, 0, 0.215, 0, low).name = 'GunLowerTip';            // 아래 전극 캡 (끝 y 0.19 — 위를 봄)
    cyl(0.022, 0.022, 0.09, M.arm, 0, 0.285, 0, low).name = 'GunLowerHolder';           // 아래 전극 홀더
    g.userData.setGap = (gap, close = 0) => { low.position.y = gap + (1 - close) * 0.03 - 0.04; };
    g.userData.setGap(0.04, 0);
  });
}

// 실러 디스펜싱 건: 노즐이 툴 축을 따라 TCP까지 · 건 뒤(플랜지 −x) 호스 피팅 — fitting을 반환해 호스 시작점으로 쓴다
export function attachSealGun(arm) {
  let fitting = null;
  const g = mount(arm, (g) => {
    box(0.12, 0.04, 0.12, M.arm, 0, 0.02, 0, g);
    box(0.1, 0.09, 0.1, M.body, -0.02, 0.085, 0, g);                   // 계량 밸브 (디스펜싱 건)
    cyl(0.018, 0.018, 0.06, M.blue, -0.09, 0.085, 0, g).rotation.z = Math.PI / 2;   // 호스 피팅
    cyl(0.006, 0.012, 0.03, M.nozzle, 0, 0.135, 0, g);                 // 노즐 (끝 = TCP · 끝이 가늘다)
    cyl(0.016, 0.016, 0.02, M.nozzle, 0, 0.12 - 0.01, 0, g);
    fitting = new THREE.Object3D(); fitting.position.set(-0.13, 0.085, 0); g.add(fitting);
  });
  return g && { tool: g, fitting };
}

// 진공 그리퍼: 툴 축에 수직인 H 프레임(0.5 × 0.3m) 끝 흡착컵 4개 — 컵 면이 TCP 높이 (패널 윗면에 붙여 들어 올린다)
export function attachVacuumGripper(arm) {
  return mount(arm, (g) => {
    box(0.12, 0.04, 0.12, M.arm, 0, 0.02, 0, g);
    cyl(0.025, 0.025, 0.05, M.body, 0, 0.065, 0, g);
    box(0.5, 0.03, 0.04, M.alu, 0, 0.1, 0, g); box(0.04, 0.03, 0.3, M.alu, 0, 0.1, 0, g);
    for (const [x, z] of [[-0.23, -0.13], [0.23, -0.13], [-0.23, 0.13], [0.23, 0.13]]) {
      box(0.04, 0.03, 0.04, M.alu, x, 0.1, z, g);
      cyl(0.008, 0.008, 0.03, M.arm, x, 0.125, z, g);
      cyl(0.022, 0.032, 0.012, M.rubber, x, 0.144, z, g);              // 흡착컵 (면 y 0.15 = TCP)
    }
  });
}

// 로봇이 옮기는 작은 부품: bracket(키팅 브래킷 · 바닥면이 기준) · hinge(도어 힌지 · 판 두 장)
const PART_M = { bracket: std(0x5d6b78, { metalness: 0.7 }), hinge: std(0x2d3238, { metalness: 0.8, roughness: 0.35 }) };
export function makePart(kind = 'bracket') {
  const g = new THREE.Group(); g.name = 'HeldPart';
  if (kind === 'hinge') { box(0.11, 0.012, 0.06, PART_M.hinge, 0, 0.006, 0, g); box(0.012, 0.05, 0.06, PART_M.hinge, -0.05, 0.03, 0, g); cyl(0.012, 0.012, 0.065, PART_M.hinge, -0.045, 0.055, 0, g).rotation.x = Math.PI / 2; }
  else { box(0.09, 0.01, 0.05, PART_M.bracket, 0, 0.005, 0, g); box(0.09, 0.03, 0.008, PART_M.bracket, 0, 0.02, -0.021, g); }
  return g;
}
// 집은 부품: 손끝(TCP)에 바닥면이 오도록 — 툴 축(+y) 방향 반대로 뒤집어 단다
export function holdPart(tip, kind) { const o = makePart(kind); o.rotation.x = Math.PI; tip.add(o); o.visible = false; return o; }
// 그리퍼 + 너트러너 복합 툴 (정밀 장착): 기본 그리퍼 옆(플랜지 +z)에 너트러너 스핀들 — 힌지를 내려놓은 자리에서 볼트를 조인다
export function attachNutrunner(arm) {
  const fl = arm.flange ?? arm.tip?.parent; if (!fl) return null;
  const g = new THREE.Group(); g.name = 'Nutrunner'; fl.add(g);
  box(0.05, 0.05, 0.05, M.arm, 0, 0.03, 0.075, g); cyl(0.022, 0.022, 0.09, M.body, 0, 0.09, 0.075, g); cyl(0.009, 0.009, 0.035, M.nozzle, 0, 0.152, 0.075, g);
  box(0.03, 0.04, 0.02, M.blue, 0, 0.06, 0.105, g);
  return g;
}
// 3D 스캐너 (소재 식별·3D 측정): 툴 축을 보는 스테레오 카메라 2대 + 가운데 청색 패턴 프로젝터 · scanOn(on)이면 툴 축 방향으로 부채꼴 빛 (끝 y 0.29 — TCP 0.16 위에서 스캔하면 대상물 윗면 바로 위)
export function attachScanner(arm) {
  let fan = null;
  const g = mount(arm, (g) => {
    box(0.1, 0.04, 0.1, M.arm, 0, 0.02, 0, g);
    box(0.32, 0.06, 0.08, M.body, 0, 0.07, 0, g);                                   // 스캐너 몸체 (가로 막대)
    for (const x of [-0.13, 0.13]) cyl(0.022, 0.022, 0.02, M.nozzle, x, 0.105, 0, g); // 카메라 렌즈
    cyl(0.018, 0.018, 0.02, std(0x2b6cff, { emissive: 0x2b6cff, emissiveIntensity: 1.5 }), 0, 0.105, 0, g);   // 프로젝터
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.11, 0, -0.1, 0.29, 0, 0.1, 0.29, 0], 3));
    fan = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); fan.visible = false; g.add(fan);
  });
  if (g) g.userData.scanOn = (on) => { fan.visible = on; };
  return g;
}
// 디버링 스핀들: 모터 + 툴 축 방향 버(bur) — 버 끝이 TCP · spin(dt)로 버가 돈다
export function attachDeburrSpindle(arm) {
  let bit = null;
  const g = mount(arm, (g) => {
    box(0.1, 0.04, 0.1, M.arm, 0, 0.02, 0, g);
    cyl(0.04, 0.04, 0.1, M.body, 0, 0.09, 0, g);                                     // 고속 스핀들 모터
    cyl(0.012, 0.012, 0.02, M.arm, 0, 0.145, 0.0, g).position.y = 0.13;               // 콜릿
    bit = new THREE.Group(); bit.position.y = 0.14; g.add(bit);
    cyl(0.004, 0.004, 0.01, M.nozzle, 0, 0.0, 0, bit); cyl(0.007, 0.004, 0.012, std(0xd0b060, { metalness: 0.9, roughness: 0.25 }), 0, 0.006, 0, bit);   // 버 (끝 = TCP)
  });
  if (g) g.userData.spin = (dt) => { bit.rotation.y += dt * 60; };
  return g;
}
// 에어 블로 노즐 (측정 전 표면 청소): 툴 축 방향 가는 노즐 · 끝이 TCP
export function attachAirNozzle(arm) {
  return mount(arm, (g) => {
    box(0.1, 0.04, 0.1, M.arm, 0, 0.02, 0, g);
    box(0.06, 0.06, 0.06, M.blue, 0, 0.07, 0, g);                                    // 에어 밸브
    cyl(0.006, 0.01, 0.05, M.nozzle, 0, 0.125, 0, g);                                // 노즐 (끝 = TCP)
  });
}

// 디스펜서 ↔ 실러 건 호스: 점 목록(부모 로컬)을 지나는 튜브 — 점이 조금씩 바뀌어도 같은 메시를 다시 쓴다
export function makeHose(parent, radius = 0.018) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), M.hose); mesh.castShadow = true; mesh.frustumCulled = false; mesh.userData.flexible = true; parent.add(mesh);   // 휘는 호스 — 간섭 점검(tools/check-collisions)에서 뺀다
  return {
    mesh,
    update(pts) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      mesh.geometry.dispose(); mesh.geometry = new THREE.TubeGeometry(curve, 40, radius, 7, false);
    },
  };
}

// 대상물 위 공정 흔적 (작업하는 동안 바로 보이게): 용접 너깃 점 · 실러 비드 — 대상물 그룹(pm) 로컬에 붙어 AMR과 함께 움직인다
const NUGGET = new THREE.CylinderGeometry(0.011, 0.011, 0.004, 12), BEAD = new THREE.SphereGeometry(0.009, 8, 6);
const NUGGET_M = std(0x5a3a22, { metalness: 0.6, roughness: 0.4, emissive: 0x000000 }), BEAD_M = std(0x2b2f33, { roughness: 0.5, metalness: 0.1 });
export function processMarks(pm) {
  if (pm.userData.marks) return pm.userData.marks;
  const g = new THREE.Group(); g.name = 'LiveProcessMarks'; pm.add(g);
  const bead = new THREE.InstancedMesh(BEAD, BEAD_M, 600); bead.count = 0; bead.frustumCulled = false; g.add(bead);
  const m = { g, bead, last: null, nuggets: 0,
    nugget(local) { if (this.nuggets >= 24) return; const o = new THREE.Mesh(NUGGET, NUGGET_M.clone()); o.position.copy(local); o.position.y += 0.002; o.userData.hot = 1; g.add(o); this.nuggets++; return o; },
    beadTo(local) {   // 이전 점에서 지금 점까지 0.8cm 간격으로 비드 구슬을 잇는다
      const M4 = new THREE.Matrix4(), from = this.last ?? local, d = from.distanceTo(local), n = Math.max(1, Math.ceil(d / 0.008));
      if (this.last && d < 0.004) return;
      for (let i = 1; i <= n && bead.count < bead.instanceMatrix.count; i++) { M4.makeTranslation(from.x + (local.x - from.x) * i / n, from.y + (local.y - from.y) * i / n + 0.004, from.z + (local.z - from.z) * i / n); bead.setMatrixAt(bead.count++, M4); }
      bead.instanceMatrix.needsUpdate = true; this.last = local.clone();
    },
    lift() { this.last = null; },
    placed: 0,
    place(local, part) { if (this.placed >= 12) return; const o = makePart(part); o.position.copy(local); g.add(o); this.placed++; return o; },   // 로봇이 내려놓은 부품 (키팅 브래킷 · 힌지)
    clear() { g.removeFromParent(); delete pm.userData.marks; },
  };
  pm.userData.marks = m; return m;
}
