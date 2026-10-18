import * as THREE from 'three';
import { blenderOn, cloneAsset } from './blender.js';
import { MACHINE_SPECS } from './machine-specs.js';
const move = (a, b, max) => a + THREE.MathUtils.clamp(b - a, -max, max);
// All exported assets use metres, Y-up, front +Z. Published travels stay distinct
// from the housing envelope and from the workpiece/fixture clearance.
export function makeProductMachine(key, parent, location = [0, 0, 0]) {
  if (!blenderOn()) return null;
  const spec = MACHINE_SPECS[key], asset = cloneAsset(spec.asset), root = asset.root; root.position.set(...location); parent.add(root);
  const names = ['Door', 'Ram', 'Head', 'Spindle', 'XSlide', 'YSlide', 'Tilt', 'Rotary', 'Chuck', 'Turret', 'Fixture'];
  const nodes = Object.fromEntries(names.map((n) => [n, asset.find(n)]));
  const rest = Object.fromEntries(names.filter((n) => nodes[n]).map((n) => [n, nodes[n].position.clone()]));
  const screen = root.getObjectByName('ControlScreen')?.material?.clone();
  if (screen) root.traverse((o) => { if (o.isMesh && o.material?.name === 'Screen') o.material = screen; });
  const machine = { key, spec, root, nodes, rest, fixture: nodes.Fixture, doorK: 1, cutting: false, displayedRPM: 0,
    configureWorkpiece(size) {
      if (!size || !this.fixture) return;
      const [w, d, h] = size, diagonalMm = Math.hypot(w, d) * 1000;
      this.partEnvelope = { widthMm: w * 1000, depthMm: d * 1000, heightMm: h * 1000, diagonalMm };
      this.tiltEnabled = !spec.platterDiameterMm || diagonalMm <= spec.platterDiameterMm;
      this.envelopeFits = spec.maxPartSwingMm ? diagonalMm <= spec.maxPartSwingMm : spec.maxTurningDiameterMm ? diagonalMm <= spec.maxTurningDiameterMm && h * 1000 <= spec.maxTurningLengthMm : true;
      const sample = root.getObjectByName('DemoWorkpiece') ?? root.getObjectByName('TurningSample'); sample?.removeFromParent();
      const part = new THREE.Mesh(new THREE.BoxGeometry(...(nodes.Chuck ? [h, w, d] : [w, h, d])), new THREE.MeshStandardMaterial({ color: 0xaab5bf, metalness: .7, roughness: .32 }));
      part.name = 'ProcessWorkpiece'; part.castShadow = true; this.fixture.add(part);
      part.position.set(nodes.Chuck ? h / 2 : 0, nodes.Chuck ? 0 : h / 2, 0);
      const pickup = new THREE.Object3D(); this.fixture.add(pickup); pickup.position.set(nodes.Chuck ? h : 0, nodes.Chuck ? 0 : h, 0); this.fixture = pickup;
    },
    update({ busy = false, progress = 0, time = 0, rdt = 0, dts = 0, frozen = false, fault = false, open } = {}) {
      if (frozen) return;
      const p = THREE.MathUtils.clamp(progress, 0, 1), dt = Math.max(0, dts);
      const machining = !!spec.spindleRpm;
      if (nodes.Door) {
        const wantOpen = open ?? (!busy || p < .15 || p > .85);
        this.doorK = move(this.doorK, wantOpen ? 1 : 0, dt * 3);   // 시뮬레이션 시간으로 연다 — 실제 시간으로 열면 고속 재생(3~30×)에서 로봇 팔(진행률 기준)이 덜 열린 문으로 들어가 부딪힌다
        nodes.Door.position.x = rest.Door.x + this.doorK * spec.doorTravelMm / 1000;
      }
      this.cutting = machining && busy && p > .18 && p < .82 && this.doorK < .015 && !fault;
      this.displayedRPM = this.cutting ? spec.spindleRpm : 0;
      if (nodes.Ram) {
        const stroke = (spec.strokeMm ?? spec.demoStrokeMm) / 1000;
        const k = busy && !fault ? Math.max(0, Math.sin(p * Math.PI * 2 - Math.PI / 2)) : 0;
        const target = rest.Ram.y - stroke * k;
        nodes.Ram.position.y = spec.ramSpeedMmS ? move(nodes.Ram.position.y, target, dt * spec.ramSpeedMmS / 1000) : target;
      }
      if (nodes.Head) {
        const zTravel = spec.travelMm[2] / 1000;
        const target = rest.Head.y - (this.cutting ? zTravel * (.70 + .08 * Math.sin(time * 2)) : 0);
        nodes.Head.position.y = move(nodes.Head.position.y, target, dt * (this.cutting ? .25 : .5));   // 가공 끝나면 급속 이송(0.5m/s)으로 원점 복귀 — 문이 열려 로봇이 들어갈 때(진행률 0.905)까지 다 올라간다
        this.headHome = nodes.Head.position.y >= rest.Head.y - 0.01 ? 1 : 0;   // 헤드가 Z 원점(맨 위)에 있음 — 머신텐딩 로봇은 이때만 기계 안으로 들어간다 (zones.js)
        nodes.XSlide.position.x = this.cutting ? Math.sin(p * Math.PI * 4) * spec.travelMm[0] / 4000 : 0;
        nodes.YSlide.position.z = this.cutting ? Math.cos(p * Math.PI * 4) * spec.travelMm[1] / 4000 : 0;
        if (this.cutting) nodes.Spindle.rotation.y += dt * 24; // display speed, not claimed physical RPM
        if (nodes.Tilt) nodes.Tilt.rotation.z = this.cutting && this.tiltEnabled !== false ? .30 * Math.sin(p * Math.PI * 4) : 0;
        if (nodes.Rotary && this.cutting) nodes.Rotary.rotation.y += dt * .5;
      }
      if (nodes.Chuck) {
        if (this.cutting) nodes.Chuck.rotation.x += dt * 18; // horizontal spindle, unlike the old vertical chuck
        nodes.Turret.position.x = rest.Turret.x - (this.cutting ? Math.min(spec.travelMm[1] / 1000, .30 + .05 * Math.sin(p * Math.PI * 6)) : 0);
        nodes.Turret.position.y = rest.Turret.y - (this.cutting ? Math.min(spec.travelMm[0] / 1000, .12) : 0);
      }
      screen?.emissive?.setHex(fault ? 0xff3030 : this.cutting ? 0x2a9ed8 : 0x2c7f9e);
      root.updateWorldMatrix(true, true);
    },
  };
  // Start with open access so robot loading is visible before the first cut.
  machine.update({ rdt: 1, dts: 1, open: true });
  return { machine, head: nodes.Head, spindle: nodes.Spindle, ram: nodes.Ram, door: nodes.Door, table: asset.find('Platter') ?? asset.find('WorkTable'), chuck: nodes.Chuck, turret: nodes.Turret, screen };
}
