// 동작 전 구간 간섭 훑기 — check-collisions.cjs(실시간 표본)는 드문 동작(헤밍 한 사이클, 선반 왕복, 지게차 제자리 회전)을 놓칠 수 있어
// 진행률·자세를 직접 넣어 전 구간을 훑는다. 판정·형상은 check-collisions.cjs와 같은 방향 상자(OBB) 겹침 5cm (같은 함수를 그 파일에서 가져온다).
//  ① 유연생산 C05 헤밍: 진행률 0~1을 601점 — 로봇 ↔ 프레스(기둥·램·다이), 패널·AMR ↔ 프레스, 로봇 팔 ↔ 잡은 패널 (후드·도어 각각)
//  ② 정밀조립 AMMR(분류·포장셀): 선반 피킹 구간을 1×·3× 프레임 간격으로 — 팔 ↔ 셀(선반 기둥·빈) · 실제 재생 중 선반에 갈 때 슬롯 줄에서 비껴난 거리
//  ③ 레거시 지게차: 충전 자리·미니로드 출고 지게차 자리에서 제자리 한 바퀴, 진입 직선 — 차체·포크 ↔ 시설
//  ④ 적응가공 ⑥CMM(피지컬AI): 진행률 0~1을 501점 — 양팔 로봇 ↔ 문형 겐트리·셀 설비, 로봇 ↔ 로봇, AMR·소재 ↔ 설비, 정비·사족보행 자리 ↔ 레일·다리
//  ⑤ 적응가공 ③유압블록 디버링셀(피지컬AI·자동화): 진행률 0~1을 601점 — 텐딩 6축 ↔ 사선홀 머시닝센터 · 이송 6축 ↔ 워터젯 부스·세척기(문·고정구·벽)·셀 설비, 로봇 ↔ 로봇, 든 블록·AMR ↔ 설비,
//     정비·필터 교체 자리 ↔ 세척기·레일, AMR이 셀을 나가는 경로(→ ⑥CMM, 5cm 간격 · 꺾이는 곳은 앞뒤 방향) ↔ 이송 로봇·세척기·겐트리
// 실행: npm run check:sweeps   결과: outputs/sweeps/report.json
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '../outputs/sweeps'); fs.mkdirSync(out, { recursive: true }); process.env.METAFACTORY_DATA_DIR = path.join(out, 'runtime');
const PEN = 0.05, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timer = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 900000);
// 형상 판정 함수(가시성·OBB·SAT·원통 보정)는 check-collisions.cjs 그대로 — 두 검사가 같은 기준으로 잰다
const src = fs.readFileSync(path.join(__dirname, 'check-collisions.cjs'), 'utf8'), a = src.indexOf('const visible='), b = src.indexOf('const collect=');
if (a < 0 || b < a) throw Error('check-collisions.cjs 형상 함수 위치를 찾지 못함');
const LIB = src.slice(a, b);
const under = 'const under=(o,root)=>{for(let p=o;p;p=p.parent)if(p===root)return true;return false;};const box=(A,B)=>A.max[0]>B.min[0]&&A.min[0]<B.max[0]&&A.max[1]>B.min[1]&&A.min[1]<B.max[1]&&A.max[2]>B.min[2]&&A.min[2]<B.max[2];';

const HEM = (prod) => `(async()=>{const THREE=await import('three');${LIB}${under}
const t=window.__twin,v=t.view,wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('[data-speed="10"]')?.click();
const z=t.xzones.zones.find(z=>z.Z.key==='flex'),c=z.order.find(c=>c.id==='C05'),r=c.robots.find(r=>r.tool);let car=null;
for(let k=0;k<900;k++){car=z.carriers.find(q=>q.at===c.id&&q.state==='work'&&q.pm);if(car&&c.item&&c.state==='BUSY'&&(c.progress??0)<0.1&&c.item.product==='${prod}')break;car=null;await wait(100);}
if(!car)return {err:'C05에 ${prod} 없음'};document.getElementById('playBtn').click();await wait(200);
const TOOL=/ToolFlange|ToolTCP|J6_Origin|J5_Origin|WristCamera|Gripper|Finger|EndEffector|Vacuum|Cup/,fixed=[];c.g.traverse(m=>{if(solid(m)&&!under(m,r.root)&&!under(m,car.g))fixed.push(m);});
const res=new Map(),add=(k,pen,p)=>{const h=res.get(k);if(!h||pen>h.max)res.set(k,{max:+pen.toFixed(3),p:+p.toFixed(3)});};
for(let i=0;i<=600;i++){const p=i/600;z.hemPress(c,true,p,0.016);z.hemWork(c,r,car,p);v.scene.updateMatrixWorld(true);
 const R=[],C=[];r.root.traverse(m=>{if(solid(m))R.push(m);});car.g.traverse(m=>{if(solid(m))C.push(m);});
 const pair=(a,b,k)=>{const A=obb(a),B=obb(b);if(!A||!B||!box(A,B))return;const pen=sat(A,B);if(pen>=0.02&&real(a,b))add(k+' '+nameOf(a).split('<')[0]+' | '+nameOf(b).split('<')[0],pen,p);};
 for(const a of [...R,...C])for(const b of fixed)pair(a,b,R.includes(a)?'로봇↔프레스':'패널·AMR↔프레스');
 for(const a of R){if(TOOL.test(nameOf(a)))continue;for(const b of C)pair(a,b,'로봇 팔↔패널·AMR');}}
z.hemWork(c,r,car,c.progress);document.getElementById('playBtn').click();
return {name:'헤밍 C05 ${prod}',hits:[...res.entries()].map(([k,h])=>({k,...h})).sort((a,b)=>b.max-a.max)};})()`;

const AMMR = `(async()=>{const THREE=await import('three');${LIB}${under}
const {AMMR,AMMR_FETCH}=await import('/js/line.js');const t=window.__twin,v=t.view,wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(1500);
// 실제 재생(3×, 시뮬레이션 120초): 선반 피킹 중 로봇이 슬롯 줄에서 비껴난 거리 — 접촉 작업이 끊긴 자리에 남아 선반 기둥 쪽으로 가는지
document.querySelector('[data-speed="3"]')?.click();const T0=t.sim.time;let drift=0;
while(t.sim.time-T0<120){await new Promise(r=>requestAnimationFrame(r));for(const sv of v.stationViews){if(!sv.st.ammr||!sv.parts.robots)continue;sv.parts.robots.forEach((r,i)=>{const u=sv.st.ammr[i];if(u&&r.slot&&u.phase==='pick')drift=Math.max(drift,r.plan?.mode==='x'?Math.abs(r.root.position.z-r.slot.z):Math.abs(r.root.position.x-r.slot.x));});}}
document.getElementById('playBtn').click();await wait(200);
const res=new Map();
for(const sv of v.stationViews){const st=sv.st;if(!st.ammr||!sv.parts.robots)continue;
 const fixed=[];sv.group.traverse(m=>{if(solid(m)&&!sv.parts.robots.some(q=>under(m,q.root)))fixed.push(m);});
 for(const [i,r] of sv.parts.robots.entries()){if(!r.slot||!r.arms)continue;const u=st.ammr[i],save={u:{...u},prog:st.progress,item:st.item,pos:r.root.position.clone(),rot:r.root.rotation.y,vla:r.vlaArm};
  for(const dp of [0.002,0.006]){Object.assign(u,{phase:'pick',pos:1,turn:1});st.item=null;r.vlaArm=null;
   if(r.plan?.mode==='x')r.root.position.x=r.plan.pick.x;else{r.root.position.set(r.slot.x,r.root.position.y,r.slot.side*AMMR.pickZ);r.root.rotation.y=r.slot.yaw+Math.PI;}
   for(let p=AMMR_FETCH.driveOut;p<=AMMR_FETCH.pick+1e-9;p+=dp){st.progress=p;v.animAMMRVLA(r,st,true,p*40,i,true);v.scene.updateMatrixWorld(true);const R=[];r.root.traverse(m=>{if(solid(m))R.push(m);});
    for(const a of R){const A=obb(a);if(!A)continue;for(const b of fixed){const B=obb(b);if(!B||!box(A,B))continue;const pen=sat(A,B);if(pen<0.02||!real(a,b))continue;const k=st.id+'#'+i+' '+nameOf(a).split('<')[0]+' | '+(nameOf(b)||b.geometry.type);const h=res.get(k);if(!h||pen>h.max)res.set(k,{max:+pen.toFixed(3),p:+p.toFixed(3)});}}}}
  Object.assign(u,save.u);st.progress=save.prog;st.item=save.item;r.root.position.copy(save.pos);r.root.rotation.y=save.rot;r.vlaArm=save.vla;}}
document.getElementById('playBtn').click();
return {name:'AMMR 선반 피킹',drift:+drift.toFixed(3),hits:[...res.entries()].map(([k,h])=>({k,...h})).sort((a,b)=>b.max-a.max)};})()`;

const FORKLIFT = `(async()=>{const THREE=await import('three');${LIB}${under}
const {chgLoc,MINILOAD_OUTS,AISLE}=await import('/js/sim.js');const t=window.__twin,v=t.view,wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(1200);document.getElementById('playBtn').click();await wait(300);
const vv=v.vehicleViews.find(q=>q.v.kind==='forklift');const movers=['vehicleViews','carrierViews','techViews','helperViews','quadViews','workerViews'].flatMap(k=>v[k]??[]).map(q=>q.g);
v.scene.updateMatrixWorld(true);const all=[];v.scene.traverse(m=>{if(!solid(m)||movers.some(g=>under(m,g))||(v.dyn&&under(m,v.dyn)))return;const B=obb(m);if(!B||B.max[1]<0.12||Math.max(...[0,1,2].map(i=>B.max[i]-B.min[i]))>30)return;all.push({m,B});});
const Y=[...Array(72).keys()].map(k=>k*5),P=[];const lane=AISLE.F-0.7;
for(let i=0;i<3;i++){const c=chgLoc(i,'forklift');P.push({x:c.x,z:c.z,yaws:[0,10,20,30,45,60,75,90],at:'충전 자리 '+i+' (통로 → +x 돌기)'});for(let z=lane;z>=c.z-1e-9;z-=0.25)P.push({x:c.x,z,yaws:[0],at:'충전 자리 '+i+' 후진 진입'});P.push({x:c.x,z:lane,yaws:Y,at:'충전 자리 '+i+' 앞 차로에서 돌아서기 (먼 차로에서 오면 반 바퀴)'});}
for(const o of [...MINILOAD_OUTS.wh,...MINILOAD_OUTS.x].filter(o=>o.fork))P.push({x:o.fork.x,z:o.fork.z,yaws:Y,at:'출고 지게차 자리 z '+o.z.toFixed(1)+' 제자리 한 바퀴'});
const p0={p:vv.g.position.clone(),r:vv.g.rotation.y},res=new Map();
for(const Q of P){const near=all.filter(o=>o.B.max[0]>Q.x-3.2&&o.B.min[0]<Q.x+3.2&&o.B.max[2]>Q.z-3.2&&o.B.min[2]<Q.z+3.2);
 for(const yaw of Q.yaws){vv.g.position.set(Q.x,vv.g.position.y,Q.z);vv.g.rotation.y=yaw*Math.PI/180;vv.g.updateMatrixWorld(true);const ms=[];vv.g.traverse(m=>{if(solid(m)&&!/Wheel|Caster/i.test(m.name))ms.push(m);});
  for(const a of ms){const A=obb(a);if(!A)continue;for(const {m:b,B} of near){if(!box(A,B))continue;const pen=sat(A,B);if(pen<0.02||!real(a,b))continue;const k=Q.at+' '+nameOf(a).split('<')[0]+' | '+(nameOf(b)||b.geometry.type)+' @'+[B.c.x,B.c.z].map(x=>x.toFixed(2)).join(',');const h=res.get(k);if(!h||pen>h.max)res.set(k,{max:+pen.toFixed(3),yaw});}}}}
vv.g.position.copy(p0.p);vv.g.rotation.y=p0.r;document.getElementById('playBtn').click();
return {name:'레거시 지게차 자리',poses:P.reduce((n,q)=>n+q.yaws.length,0),hits:[...res.entries()].map(([k,h])=>({k,...h})).sort((a,b)=>b.max-a.max)};})()`;

const CMM = `(async()=>{const THREE=await import('three');${LIB}${under}
const t=window.__twin,v=t.view,wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('[data-speed="10"]')?.click();
const z=t.xzones.zones.find(z=>z.Z.key==='adapt'),c=z.order.find(c=>c.id==='CMM');let car=null;
for(let k=0;k<1200;k++){car=z.carriers.find(q=>q.at===c.id&&q.state==='work'&&q.pm);if(car&&c.state==='BUSY'&&(c.progress??0)<0.2)break;car=null;await wait(100);}
if(!car)return {err:'CMM에 소재 없음'};document.getElementById('playBtn').click();await wait(200);
const p0=c.progress,R=c.robots.filter(r=>r.body);if(R.length!==2||R.some(r=>Math.abs(r.slot.x)>1e-6))return {err:'CMM 양팔 로봇 2대가 도킹 정면(x 0)에 없음 '+JSON.stringify(R.map(r=>r.slot))};
const TOOL=/ToolFlange|ToolTCP|J6_Origin|J5_Origin|WristCamera|Gripper|Finger|tool_left|tool_right|EE_|[LR]_J[67]/,PROBE=/^$/;
const inR=(m)=>c.robots.find(r=>under(m,r.root)),fixed=[];c.g.traverse(m=>{if(solid(m)&&!inR(m)&&!under(m,car.g))fixed.push(m);});
const res=new Map(),add=(k,pen,p)=>{const h=res.get(k);if(!h||pen>h.max)res.set(k,{max:+pen.toFixed(3),p:+p.toFixed(3)});};
const pair=(a,b,k,p)=>{const A=obb(a),B=obb(b);if(!A||!B||!box(A,B))return;const pen=sat(A,B);if(pen>=0.02&&real(a,b))add(k+' '+nameOf(a).split('<')[0]+' | '+nameOf(b).split('<')[0],pen,p);};
let bxMin=9,bxMax=-9,parkAt=null;
for(let i=0;i<=500;i++){const p=i/500;c.progress=p;z.animCell(c,t.sim.time,0.016,0.016);v.scene.updateMatrixWorld(true);
 const bx=c.parts.bridge.position.x;bxMin=Math.min(bxMin,bx);bxMax=Math.max(bxMax,bx);if(parkAt==null&&R.some(r=>r.lean>0.01))parkAt={p,bx:+bx.toFixed(3)};
 const RM=c.robots.map(r=>{const a=[];r.root.traverse(m=>{if(solid(m))a.push(m);});return a;}),C=[];car.g.traverse(m=>{if(solid(m))C.push(m);});
 RM.forEach((ms,j)=>{for(const a of ms)for(const b of fixed)pair(a,b,'로봇'+j+'↔설비',p);for(const a of ms){if(TOOL.test(nameOf(a)))continue;for(const b of C)pair(a,b,'로봇'+j+' 몸·팔↔AMR·소재',p);}
  for(let k=j+1;k<RM.length;k++)for(const a of ms)for(const b of RM[k])pair(a,b,'로봇'+j+'↔로봇'+k,p);});
 for(const a of C)for(const b of fixed){if(/Quill|Probe/.test(nameOf(b)))continue;pair(a,b,'AMR·소재↔설비',p);}}
// 정비 인력(반지름 0.35m)·사족보행(1.1×0.5m) 자리 — 겐트리 측정 위치·비킨 위치 둘 다
const zc=t.sim.zoneCell('adapt','CMM'),spots=[['정비 자리',zc.svc,0.35,0.35],['사족보행 점검 자리',zc.scan,0.6,0.3]];
for(const p of [0.45,0.8]){c.progress=p;z.animCell(c,t.sim.time,0.016,0.016);v.scene.updateMatrixWorld(true);
 for(const [nm,s,hx,hz] of spots){const S={min:[s.x-hx,0,s.z-hz],max:[s.x+hx,1.0,s.z+hz]};for(const b of fixed){const B=obb(b);if(!B||!box(S,B))continue;add(nm+' ↔ '+nameOf(b).split('<')[0]+' @'+[B.c.x,B.c.z].map(x=>x.toFixed(2)).join(','),Math.min(S.max[0]-B.min[0],B.max[0]-S.min[0],S.max[2]-B.min[2],B.max[2]-S.min[2]),p);}}}
c.progress=p0;z.animCell(c,t.sim.time,0.016,0.016);document.getElementById('playBtn').click();
return {name:'적응가공 CMM 겐트리·양팔 로봇',note:'겐트리 x '+bxMin.toFixed(2)+'~'+bxMax.toFixed(2)+' · 양팔 로봇이 다가가기 시작할 때 겐트리 x '+(parkAt?.bx)+' (진행률 '+(parkAt?.p)+')',hits:[...res.entries()].map(([k,h])=>({k,...h})).sort((a,b)=>b.max-a.max)};})()`;

const WASHER = `(async()=>{const THREE=await import('three');${LIB}${under}
const t=window.__twin,v=t.view,wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('[data-speed="10"]')?.click();
const z=t.xzones.zones.find(z=>z.Z.key==='adapt'),c=z.order.find(c=>c.id==='HB_DEBR');let car=null;
for(let k=0;k<1500;k++){car=z.carriers.find(q=>q.at===c.id&&q.state==='work'&&q.pm);if(car&&c.state==='BUSY'&&(c.progress??0)<0.3)break;car=null;await wait(100);}
if(!car)return {err:'디버링셀에 소재 없음'};document.getElementById('playBtn').click();await wait(200);
const p0=c.progress,X=c.robots.find(r=>r.washXfer);if(!X||!c.parts.washer||!c.parts.booth)return {err:'부스·세척기·이송 로봇 없음'};
const WORKAT=/ProcessWorkpiece|Fixture|TiltCradle|WashFixture|BoothFixture/;   // 그리퍼가 기계·부스·세척기 고정구 위 소재에 닿는 것은 작업 접촉
const TOOL=/ToolFlange|ToolTCP|J6_Origin|J5_Origin|WristCamera|Gripper|Finger|tool_left|tool_right|EE_|[LR]_J[67]/;
const inR=(m)=>c.robots.find(r=>under(m,r.root)),fixed=[];c.g.traverse(m=>{if(solid(m)&&!inR(m)&&!under(m,car.g)){const B=obb(m);if(B&&B.max[1]>0.08)fixed.push(m);}});   // 셀 바닥판(높이 0.06m)은 받침대가 서는 면 — 뺀다 (check-collisions와 같음)
const res=new Map(),add=(k,pen,p)=>{const h=res.get(k);if(!h||pen>h.max)res.set(k,{max:+pen.toFixed(3),p:+p.toFixed(3)});};
const pair=(a,b,k,p)=>{const A=obb(a),B=obb(b);if(!A||!B||!box(A,B))return;const pen=sat(A,B);if(pen>=0.02&&real(a,b))add(k+' '+nameOf(a).split('<')[0]+' | '+nameOf(b).split('<')[0],pen,p);};
let inside=0,doorMin=1;
for(let i=0;i<=600;i++){const p=i/600;c.progress=p;z.animCell(c,t.sim.time,0.016,0.016);v.scene.updateMatrixWorld(true);
 if(X.tendInside)inside++;doorMin=Math.min(doorMin,c.parts.washer.doorK);
 const RM=c.robots.map(r=>{const a=[];r.root.traverse(m=>{if(solid(m))a.push(m);});return a;}),C=[];car.g.traverse(m=>{if(solid(m)&&m.visible!==false)C.push(m);});
 if(X.tendHeld?.visible)X.tendHeld.traverse(m=>{if(solid(m)&&!C.includes(m))C.push(m);});
 RM.forEach((ms,j)=>{const nm=c.robots[j].washXfer?'이송6축':'텐딩6축';for(const a of ms)for(const b of fixed){if(TOOL.test(nameOf(a))&&WORKAT.test(nameOf(b)))continue;pair(a,b,nm+'↔설비',p);}for(const a of ms){if(TOOL.test(nameOf(a)))continue;for(const b of C)pair(a,b,nm+' 몸·팔↔AMR·블록',p);}
  for(let k=j+1;k<RM.length;k++)for(const a of ms)for(const b of RM[k])pair(a,b,nm+'↔로봇'+k,p);});
 for(const a of C)for(const b of fixed){if(WORKAT.test(nameOf(b)))continue;pair(a,b,'AMR·블록↔설비',p);}}   // 든 블록 ↔ 고정구·기계 안 작업물(같은 블록을 넘겨줌)은 뺀다
const zc=t.sim.zoneCell('adapt','HB_DEBR'),spots=[['정비 자리',zc.svc,0.35,0.35],['사족보행 점검 자리',zc.scan,0.6,0.3],['필터 교체 자리',zc.svcWash,0.35,0.35]];
v.scene.updateMatrixWorld(true);
for(const [nm,s,hx,hz] of spots){if(!s){add(nm+' 없음',1,0);continue;}const S={min:[s.x-hx,0,s.z-hz],max:[s.x+hx,1.0,s.z+hz]};for(const b of fixed){const B=obb(b);if(!B||!box(S,B))continue;add(nm+' ↔ '+nameOf(b).split('<')[0]+' @'+[B.c.x,B.c.z].map(x=>x.toFixed(2)).join(','),Math.min(S.max[0]-B.min[0],B.max[0]-S.min[0],S.max[2]-B.min[2],B.max[2]-S.min[2]),0);}}
// AMR이 셀을 나가는 경로 (zones.js cellPath — 가운데 줄 셀로 합류: 셀 가운데 → x+2.3 → 합류 차로 → CMM 앞) — 셀을 벗어날 때까지
c.progress=0;z.animCell(c,t.sim.time,0.016,0.016);
const A=z.Z.cells.HB_DEBR,B=z.Z.cells.CMM,x0=A.x+2.3,ez=Math.sign(A.z-B.z)*0.75,ex=B.x-2,path=[[A.x,A.z],[x0,A.z],[Math.max(x0,ex-3),ez]];
const g0={p:car.g.position.clone(),r:car.g.rotation.y},robM=c.robots.flatMap(r=>{const a=[];r.root.traverse(m=>{if(solid(m))a.push(m);});return a;});let amrN=0;
for(let s=0;s<path.length-1;s++){const [ax,az]=path[s],[bx,bz]=path[s+1],L=Math.hypot(bx-ax,bz-az),hd=Math.atan2(bx-ax,bz-az),prev=s?Math.atan2(ax-path[s-1][0],az-path[s-1][1]):hd;
 for(let d=0;d<=L;d+=0.05){const px=ax+(bx-ax)*d/L,pz=az+(bz-az)*d/L;if(Math.hypot(px-A.x,pz-A.z)>4.5)break;
  for(const h of d<0.3?[prev,hd]:[hd]){car.g.position.x=px;car.g.position.z=pz;car.g.rotation.y=h;v.scene.updateMatrixWorld(true);amrN++;
   const C=[];car.g.traverse(m=>{if(solid(m)&&m.visible!==false)C.push(m);});
   for(const a of C){for(const b of fixed)pair(a,b,'AMR 나가는 길↔설비',d+s*10);for(const b of robM)pair(a,b,'AMR 나가는 길↔로봇',d+s*10);}}}}
car.g.position.copy(g0.p);car.g.rotation.y=g0.r;
c.progress=p0;z.animCell(c,t.sim.time,0.016,0.016);document.getElementById('playBtn').click();
if(!inside)add('이송 로봇이 세척기 안으로 들어가지 않음',1,0);
return {name:'적응가공 디버링셀 머시닝센터·부스·세척기',note:'세척기 안 구간 '+inside+'점 · 문 최소 열림 '+doorMin.toFixed(2)+' · AMR 나가는 길 '+amrN+'자세',hits:[...res.entries()].map(([k,h])=>({k,...h})).sort((a,b)=>b.max-a.max)};})()`;

app.whenReady().then(async () => {
  try {
    const { startServer } = await import(path.resolve(__dirname, '../server/app-server.mjs')); const { port } = await startServer({ port: 0 });
    const w = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { backgroundThrottling: false } });
    const errors = []; w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/favicon/.test(e.message)) errors.push(e.message); });
    await w.loadURL(`http://127.0.0.1:${port}`); const js = (c) => w.webContents.executeJavaScript(c);
    for (let k = 0; k < 90; k++) { if (await js('!!window.__twin?.RENDER.loaded')) break; await wait(500); }
    if (!await js('!!window.__twin?.RENDER.loaded')) throw Error('Blender assets not loaded');
    const report = [];
    for (const [mode, code] of [['smart', HEM('hood')], ['smart', HEM('door')], ['dark', AMMR], ['traditional', FORKLIFT], ['dark', CMM], ['dark', WASHER], ['smart', WASHER]]) {
      await js(`document.querySelector('[data-mode=${mode}]').click()`); await wait(1500);
      const r = await js(code); if (r.err) throw Error(r.err);
      const bad = r.hits.filter((h) => h.max >= PEN), driftBad = r.drift != null && r.drift > 0.01;
      report.push({ mode, ...r, violations: bad.length + (driftBad ? 1 : 0) });
      console.log(`== ${r.name} (${mode})  간섭 ${bad.length}건${r.drift != null ? ` · 슬롯 비낌 최대 ${r.drift}m` : ''}${r.poses ? ` · 자세 ${r.poses}개` : ''}${r.note ? ` · ${r.note}` : ''}${bad.length || driftBad ? '' : ' — 없음'}`);
      for (const h of bad.slice(0, 15)) console.log(`  ${h.max.toFixed(3)}m  ${h.k}${h.p != null ? ` (진행률 ${h.p})` : ''}${h.yaw != null ? ` (방향 ${h.yaw}°)` : ''}`);
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ pen: PEN, report, errors }, null, 2));
    const total = report.reduce((n, r) => n + r.violations, 0);
    console.log(total ? `FAIL: ${total}건 (outputs/sweeps/report.json)` : 'PASS: 헤밍·AMMR 피킹·레거시 지게차 자리·적응가공 CMM·디버링셀 머시닝센터·부스·세척기 전 구간 간섭 없음');
    clearTimeout(timer); app.exit(total ? 1 : 0);
  } catch (e) { console.error(e.stack); clearTimeout(timer); app.exit(1); }
});
