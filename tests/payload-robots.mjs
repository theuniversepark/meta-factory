import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROBOT_SPECS, robotSpecTech } from '../js/robot-specs.js';
const glb=(asset)=>{const b=fs.readFileSync(new URL(`../assets/blender/${asset}.glb`,import.meta.url));assert.equal(b.readUInt32LE(),0x46546c67);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));};
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
for(const [kind,min]of [['cobot',20],['ammr',3],['articulated',60]]){
 const s=ROBOT_SPECS[kind],j=glb(s.asset),nodes=j.nodes,find=n=>nodes.find(x=>x.name===n),meta=nodes.find(x=>x.extras?.payload_kg)?.extras;
 test(`${s.model}: manufacturer rating and provenance`,()=>{assert.ok(s.payload>=min);assert.equal(meta.payload_kg,s.payload);assert.equal(meta.source,s.source);assert.ok(/Blender/.test(j.asset.generator));assert.equal(robotSpecTech({spec:s,kind}).ReferenceModel,s.model);});
 test(`${s.model}: original metric scale, no expanded normalized model`,()=>{assert.equal(meta.reach_m,s.reach);assert.ok(nodes.every(n=>!n.scale||n.scale.every(v=>Math.abs(v-1)<1e-5)));});
 if(kind==='ammr'){
  test('RB-Y1: official body, arms, wheels and head joints',()=>{assert.equal(nodes.filter(n=>n.extras?.axis).length,24);for(const side of ['L','R'])for(let i=1;i<=7;i++)assert.ok(find(`${side}_J${i}`));for(let i=0;i<6;i++)assert.ok(find(`torso_${i}`));assert.ok(!find('Lift'));assert.ok(meta.payload_basis.includes('3 kg per arm'));assert.equal(s.payload,3);});
  test('RB-Y1: native 440 mm shoulder spacing / 276 mm upper arm origin',()=>{assert.ok(Math.abs(find('L_J1_Origin').translation[2]-find('R_J1_Origin').translation[2]+.44)<1e-5);assert.ok(Math.abs(find('L_J4_Origin').translation[1]+.276)<1e-5);assert.equal(meta.revision.length,40);});
 }else{
  test(`${s.model}: 6 real joint limits and custom TCP`,()=>{for(let i=1;i<=6;i++){const n=find(`J${i}`);assert.equal(n.extras.axis.length,3);assert.ok(n.extras.lower<n.extras.upper);assert.ok(!n.rotation);}assert.ok(find('ToolTCP'));});
 }
 if(kind==='cobot')test('UR20: OEM UV/texture and 862/728.7 mm links preserved',()=>{assert.ok(j.images?.length);assert.ok(j.meshes.some(m=>m.primitives.some(p=>p.attributes.TEXCOORD_0!==undefined)));assert.ok(Math.abs(find('J3_Origin').translation[0]+.862)<1e-5);assert.ok(Math.abs(find('J4_Origin').translation[0]+.7287)<1e-5);assert.ok(meta.copyright.includes('Universal Robots'));});
 if(kind==='articulated')test('ABB: 900/960 mm links, actual camera housing/bracket/optical frame',()=>{assert.ok(Math.abs(find('J3_Origin').translation[1]-.9)<1e-5);assert.ok(Math.abs(find('J5_Origin').translation[0]-.96)<1e-5);for(const n of ['WristCamera','CameraHousing','CameraBracket','CameraLens'])assert.ok(find(n));});
}
console.log(`${passed} PASS`);
