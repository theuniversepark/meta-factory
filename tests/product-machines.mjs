import fs from 'node:fs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { MACHINE_SPECS, machineTech } from '../js/machine-specs.js';
let pass=0;const test=(n,fn)=>{fn();console.log('PASS',n);pass++;};
for(const [k,s]of Object.entries(MACHINE_SPECS)){
 const b=fs.readFileSync(new URL(`../assets/blender/${s.asset}.glb`,import.meta.url));assert.equal(b.readUInt32LE(),0x46546c67);const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
 const n=name=>j.nodes.find(x=>x.name===name);
 const size=name=>{const o=n(name),a=j.accessors[j.meshes[o.mesh].primitives[0].attributes.POSITION];const q=new THREE.Quaternion(...(o.rotation??[0,0,0,1])),box=new THREE.Box3();for(let k=0;k<8;k++)box.expandByPoint(new THREE.Vector3(...[0,1,2].map(i=>k&(1<<i)?a.max[i]:a.min[i])).applyQuaternion(q));return box.getSize(new THREE.Vector3()).toArray();};
 const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} versus ${b}`);
 test(`${s.model}: Blender provenance, source and spec metadata`,()=>{assert.ok(/Blender/.test(j.asset.generator));const root=j.nodes.find(n=>n.extras?.machine_spec===k);assert.ok(root);assert.equal(root.extras.source,s.source);assert.deepEqual(JSON.parse(root.extras.spec_json),s);});
 test(`${s.model}: movable parts / metric scale`,()=>{assert.ok(n('Fixture'));assert.ok(n(s.spindleRpm?'Door':'Ram'));assert.ok(j.nodes.every(n=>!n.scale||n.scale.every(v=>Math.abs(v-1)<1e-5)));});
 if(k==='vf2')test('VF-2: actual 914 × 356 mm table / 889 mm datum / 864 mm door',()=>{const a=size('WorkTable');near(a[0],.914);near(a[2],.356);near(n('Table').translation[1]+n('Fixture').translation[1],.889);near(size('DoorLower')[0],.864);});
 if(k==='umc1250')test('UMC-1250: 762 mm platter / separate B and C axes / 1193 mm door',()=>{near(size('Platter')[0],.762);assert.ok(n('Tilt')&&n('Rotary'));near(size('DoorLower')[0],1.193);});
 if(k==='st40')test('ST-40: 381 mm chuck / 12 turret stations / horizontal axis',()=>{const a=size('ChuckBody');near(a[1],.381);near(a[2],.381);assert.equal(j.nodes.filter(n=>/^TurretTool_\d+$/.test(n.name)).length,12);});
 if(k==='nc1')test('AIDA: actual bolster / slide / 180 mm stroke / 350 mm die height',()=>{const a=size('Bolster'),d=size('Slide');near(a[0],1.070);near(a[2],.680);near(d[0],.630);near(d[2],.520);near(n('Ram').translation[1]-.180-.080-1.0,.350);assert.equal(s.strokeMm,180);});
 if(k==='ep347')test('SCHMIDT: peak and continuous force distinguished / actual worktable',()=>{assert.equal(s.forceKn,20);assert.equal(s.continuousForceKn,13);near(size('WorkTable')[0],.300);near(size('WorkTable')[2],.220);assert.equal(machineTech('pressfit').ContinuousPressForceKN,13);});
 if(k==='oden')test('ODEN-F: force range only; custom hemming not represented as factory rating',()=>{assert.deepEqual(s.forceRangeKn,[1000,12000]);assert.ok(!s.forceKn&&!s.strokeMm);assert.ok(s.geometryBasis.includes('시뮬레이션 설계값'));});
}
test('Current workpieces: UMC-1250 B0 swing and ST-40 cutting envelope (not a fixture certificate)',()=>{assert.ok(Math.hypot(660,620)<MACHINE_SPECS.umc1250.maxPartSwingMm);assert.ok(Math.hypot(460,430)<MACHINE_SPECS.st40.maxTurningDiameterMm);assert.ok(190<MACHINE_SPECS.st40.maxTurningLengthMm);});
console.log(`${pass} PASS`);
