// 간섭·충돌 점검 — 앱을 띄워 세 단계(레거시·자동화·피지컬AI)를 차례로 돌리며, 화면의 메시를 방향 상자(OBB)로 보고 겹침을 잰다.
//  · 로봇 팔 ↔ 설비·시설 (가공기 문·베이스·펜스·선반 …)   · 이동체(AMR·AGV·지게차·사람) ↔ 설비·시설 (게이트 기둥·갠트리 기둥 …)
//  · 이동체 ↔ 이동체 · 로봇 ↔ 로봇 · 로봇 관절이 바닥 아래로
// 손목·툴(J5·J6·그리퍼)이 집는 대상(부품·지그·작업물)에 닿는 것은 작업 접촉이라 뺀다. 휘는 호스·케이블(userData.flexible)도 뺀다 (튜브 전체가 큰 상자로 잡혀 늘 겹친다). 결과: outputs/collisions/report.json
// 실행: npm run check:collisions  (단계당 초: COLLIDE_SECS, 기본 90 · 재생 배속 3×)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '../outputs/collisions'); fs.mkdirSync(out, { recursive: true }); process.env.METAFACTORY_DATA_DIR = path.join(out, 'runtime');
const SECS = +(process.env.COLLIDE_SECS ?? 90), PEN = 0.05;   // 5cm 넘게 겹치면 간섭 (OBB라 원통·대각 링크는 조금 크게 잡힌다)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timer = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, (SECS * 6 + 300) * 1000);

// 페이지 안에서 도는 점검 (window.__twin)
const AUDIT = (secs) => `(async()=>{const THREE=await import('three');const t=window.__twin,v=t.view;
const reg=new Map(),R=(o,cls,label)=>{if(o&&!reg.has(o))reg.set(o,{cls,label});};
const zonesAll=()=>[...t.xzones.zones,t.insp];
const regAll=()=>{reg.clear();
 for(const sv of v.stationViews){(sv.parts.robots||[]).forEach((r,i)=>R(r.root,'robot',sv.st.id+'#'+i));Object.entries(sv.parts.arms||{}).forEach(([k,a])=>R(a.arm?.root,'robot',sv.st.id+'.'+k));(sv.parts.spsPickers||[]).forEach((r,k)=>R(r.root,'robot',sv.st.id+'.K'+(k+1)));}
 for(const sv of v.stationViews)if(sv.parts.loader)R(sv.parts.loader.r.root,'robot',sv.st.id+'.loader');for(const z of t.xzones.zones)if(z.src?.port?.loader)R(z.src.port.loader.r.root,'robot',z.Z.key+'/SRC.loader');
 for(const z of zonesAll()){const zk=z.Z?.key??'insp';for(const c of z.order)c.robots.forEach((r,i)=>R(r.root,'robot',zk+'/'+c.id+'#'+i));
  Object.values(z.pack??{}).forEach((p,i)=>p.arm&&R(p.arm.root,'robot',zk+'/PACK#'+i));z.carriers.forEach(c=>R(c.g,'mover',zk+'/'+c.id));}
 for(const k of ['vehicleViews','carrierViews','techViews','helperViews','quadViews','workerViews'])for(const vv of v[k]??[])R(vv.g,'mover',vv.v.id);
 v.dyn.children.forEach(g=>{if(g.userData?.amr)R(g,g.userData.amr.visible?'mover':'belt',(g.userData.amr.visible?'AMR':'컨베이어')+'(대상물 '+(g.userData.itemId??'?')+')');});
 for(const sv of v.stationViews)R(sv.group,'fac',sv.st.id);
 for(const z of zonesAll())for(const c of z.order)R(c.g,'fac',(z.Z?.key??'insp')+'/'+c.id);};
const ownerOf=(o)=>{for(let p=o;p;p=p.parent){const e=reg.get(p);if(e)return e;}return null;};
const visible=(o)=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
const nameOf=(o)=>{const s=[];for(let p=o,i=0;p&&i<4;p=p.parent,i++)if(p.name)s.push(p.name);return s.join('<')||'('+o.geometry.type+')';};
const obb=(m)=>{const g=m.geometry;if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox;if(!b||!isFinite(b.min.x))return null;const e=m.matrixWorld.elements;
 const c=new THREE.Vector3().addVectors(b.min,b.max).multiplyScalar(.5).applyMatrix4(m.matrixWorld);
 const ax=[0,1,2].map(i=>new THREE.Vector3(e[i*4],e[i*4+1],e[i*4+2])),s=ax.map(a=>a.length());ax.forEach((a,i)=>a.divideScalar(s[i]||1));
 const h=[(b.max.x-b.min.x)/2*s[0],(b.max.y-b.min.y)/2*s[1],(b.max.z-b.min.z)/2*s[2]];
 const ext=[0,1,2].map(k=>Math.abs(ax[0].getComponent(k))*h[0]+Math.abs(ax[1].getComponent(k))*h[1]+Math.abs(ax[2].getComponent(k))*h[2]);
 return {c,ax,h,min:[c.x-ext[0],c.y-ext[1],c.z-ext[2]],max:[c.x+ext[0],c.y+ext[1],c.z+ext[2]]};};
const sat=(A,B)=>{const L=[...A.ax,...B.ax];for(const a of A.ax)for(const b of B.ax){const x=new THREE.Vector3().crossVectors(a,b);if(x.lengthSq()>1e-6)L.push(x.normalize());}
 const d=new THREE.Vector3().subVectors(B.c,A.c);let pen=1e9;
 for(const l of L){const ra=A.h[0]*Math.abs(A.ax[0].dot(l))+A.h[1]*Math.abs(A.ax[1].dot(l))+A.h[2]*Math.abs(A.ax[2].dot(l)),rb=B.h[0]*Math.abs(B.ax[0].dot(l))+B.h[1]*Math.abs(B.ax[1].dot(l))+B.h[2]*Math.abs(B.ax[2].dot(l)),o=ra+rb-Math.abs(d.dot(l));if(o<=0)return 0;pen=Math.min(pen,o);}return pen;};
// 원통(모델 지오메트리 포함): 로컬 상자의 두 축 폭이 같고 정점이 그 반지름 안에만 있으면 원통으로 보고, 상자(OBB)로 겹쳐도 상대 정점이 실제 원통 안에 들어올 때만 간섭으로 친다 (OBB 모서리 오검출 제거)
const CYL=new WeakMap();const cylOf=(m)=>{if(CYL.has(m.geometry))return CYL.get(m.geometry);const g=m.geometry,b=g.boundingBox,h=[b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z].map(x=>x/2),c=[(b.max.x+b.min.x)/2,(b.max.y+b.min.y)/2,(b.max.z+b.min.z)/2];let res=null;
 for(const ax of [1,0,2]){const [u,w]=[0,1,2].filter(i=>i!==ax);if(Math.abs(h[u]-h[w])>0.03*Math.max(h[u],h[w])||h[u]<0.02)continue;const P=g.attributes.position;let mr=0;for(let i=0;i<P.count;i++){const a=[P.getX(i),P.getY(i),P.getZ(i)];mr=Math.max(mr,Math.hypot(a[u]-c[u],a[w]-c[w]));}if(mr<=h[u]*1.05){res={ax,u,w,r:h[u],hh:h[ax],c};break;}}
 CYL.set(m.geometry,res);return res;};
const inCyl=(cyl,owner,other)=>{const inv=owner.matrixWorld.clone().invert(),P=other.geometry.attributes.position,st=Math.max(1,Math.floor(P.count/400)),v=new THREE.Vector3();for(let i=0;i<P.count;i+=st){v.fromBufferAttribute(P,i).applyMatrix4(other.matrixWorld).applyMatrix4(inv);const a=v.toArray();if(Math.hypot(a[cyl.u]-cyl.c[cyl.u],a[cyl.w]-cyl.c[cyl.w])<cyl.r&&Math.abs(a[cyl.ax]-cyl.c[cyl.ax])<cyl.hh)return true;}return false;};
const real=(a,b)=>{const ca=cylOf(a),cb=cylOf(b);if(cb&&!inCyl(cb,b,a))return false;if(ca&&!inCyl(ca,a,b))return false;return true;};
const solid=(m)=>{if(!m.isMesh||m.isInstancedMesh||m.userData.flexible)return false;const mt=Array.isArray(m.material)?m.material[0]:m.material;if(mt&&(mt.transparent&&mt.opacity<0.6||mt.blending===THREE.AdditiveBlending||mt.depthWrite===false))return false;return visible(m);};
const collect=()=>{v.scene.updateMatrixWorld(true);const o=[];v.scene.traverse(m=>{if(!solid(m))return;const B=obb(m);if(!B||B.max[1]<0.06)return;const sz=[0,1,2].map(i=>B.max[i]-B.min[i]);if(Math.max(...sz)>30)return;
 const ow=ownerOf(m);if(!ow&&m.parent&&/AMR|Forklift|AGV/.test(nameOf(m)))return;o.push({m,ow:ow??{cls:'fac',label:'시설'},B});});return o;};
const grid=(arr)=>{const G=new Map();for(const o of arr)for(let x=Math.floor(o.B.min[0]);x<=Math.floor(o.B.max[0]);x++)for(let z=Math.floor(o.B.min[2]);z<=Math.floor(o.B.max[2]);z++){const k=x+','+z;(G.get(k)??G.set(k,[]).get(k)).push(o);}return G;};
const near=(G,a,f)=>{const seen=new Set();for(let x=Math.floor(a.B.min[0]);x<=Math.floor(a.B.max[0]);x++)for(let z=Math.floor(a.B.min[2]);z<=Math.floor(a.B.max[2]);z++)for(const b of G.get(x+','+z)??[]){if(seen.has(b))continue;seen.add(b);f(b);}};
const ovl=(A,B)=>A.min[0]<B.max[0]&&A.max[0]>B.min[0]&&A.min[1]<B.max[1]&&A.max[1]>B.min[1]&&A.min[2]<B.max[2]&&A.max[2]>B.min[2];
const TOOL=/ToolFlange|ToolTCP|J6_Origin|J5_Origin|WristCamera|Gripper|Finger|tool_left|tool_right|EE_|[LR]_J[67]/;   // RB-Y1 양팔 그리퍼 포함   // 손목·툴 — 집는 대상과의 접촉은 작업 접촉
const WORK=/Workpiece|Jig|Pin_|Eaxle|Hblock|Rcover|Hood|Door_|Machined|P_[A-Z]|Bin|Fixture|Chuck|Platter|TSlot/;   // 집는 대상·지그·부품
const hits=new Map(),add=(key,info,pen)=>{info={...info,t:+(window.__twin.sim?.time??0).toFixed(1)};const h=hits.get(key);if(!h)hits.set(key,{...info,max:pen,n:1});else{h.n++;if(pen>h.max)Object.assign(h,info,{max:pen});}};
const P3=(c)=>[+c.x.toFixed(2),+c.y.toFixed(2),+c.z.toFixed(2)];
let n=0,fac=[],G=null,dynM=[],joints=[];const T0=performance.now();document.querySelector('[data-speed="3"]')?.click();
while(performance.now()-T0<${secs}*1000){await new Promise(r=>setTimeout(r,40));
 if(n%15===0){regAll();const all=collect();fac=all.filter(o=>o.ow.cls==='fac');G=grid(fac);dynM=all.filter(o=>o.ow.cls!=='fac').map(o=>({m:o.m,ow:o.ow}));joints=[];for(const [o,e] of reg)if(e.cls==='robot')o.traverse(j=>{if(/^J[2-6]_Origin$|^ToolTCP$/.test(j.name))joints.push([j,e.label]);});}
 n++;const dyn=[];for(const d of dynM){d.m.updateWorldMatrix(true,false);if(!visible(d.m))continue;const B=obb(d.m);if(B)dyn.push({...d,B});}
 for(const a of dyn){if(/Caster|Wheel/i.test(a.m.name))continue;const an=nameOf(a.m);near(G,a,(b)=>{if(b.n!==n){b.m.updateWorldMatrix(true,false);b.B=obb(b.m)??b.B;b.n=n;}   // 문·헤드 등 움직이는 설비 부품: 비교할 때마다 지금 위치로 (격자는 15샘플마다)
  if(!visible(b.m))return;   // 격자를 다시 모으는 사이(15샘플)에 숨겨진 설비 (옮겨 간 빈 트레이 등)
  if(a.ow.cls==='mover'&&b.B.max[1]<0.12)return;if(b.B.max[1]<0.1&&b.B.h[1]<0.015)return;if(!ovl(a.B,b.B))return;const p=sat(a.B,b.B);if(p<0.02||!real(a.m,b.m))return;const bn=nameOf(b.m);
  if(a.ow.cls==='robot'&&TOOL.test(an)&&WORK.test(bn))return;
  if(a.ow.cls==='belt'&&b.B.h[1]<0.08)return;
  if(/Fork/.test(an)&&b.B.max[1]<0.2&&b.B.h[1]<0.08)return;   // 지게차 포크 ↔ 팔레트(높이 0.2m 아래 납작한 판): 포크를 팔레트에 넣는 작업 접촉
  if(/Fork/.test(an)&&(/CargoFloor/.test(bn)||Math.abs(b.B.h[0]-0.33)<0.01&&Math.abs(b.B.h[1]-0.25)<0.01))return;   // 포크 ↔ 트럭 적재함 바닥(내려놓기) · 팔레트째 들어 올린 적재 상자(0.66×0.5×0.66): 싣는 짐   // 컨베이어 위 대상물 ↔ 컨베이어 옆 가이드 레일: 설계상 접촉
  add((a.ow.cls==='robot'?'로봇↔설비':a.ow.cls==='belt'?'컨베이어 대상물↔설비':'이동체↔설비')+' | '+a.ow.label+' | '+b.ow.label+' '+bn,{a:an,at:P3(a.B.c),b:{c:P3(b.B.c),size:b.B.h.map(x=>+(2*x).toFixed(2))}},p);});}
 for(const [o,l] of joints){if(!visible(o))continue;const w=o.getWorldPosition(new THREE.Vector3());if(w.y<0.02)add('관절↔바닥 | '+l+' '+o.name,{at:P3(w)},0.02-w.y+PEN);}
 const D=grid(dyn),done=new Set();
 for(const a of dyn)near(D,a,(b)=>{if(a.ow===b.ow||a.ow.label>=b.ow.label)return;const k=a.m.id+'_'+b.m.id;if(done.has(k))return;done.add(k);if(!ovl(a.B,b.B))return;const p=sat(a.B,b.B);if(p<0.02||!real(a.m,b.m))return;const an=nameOf(a.m),bn=nameOf(b.m);
  if((a.ow.cls==='robot'&&TOOL.test(an)&&WORK.test(bn))||(b.ow.cls==='robot'&&TOOL.test(bn)&&WORK.test(an)))return;
  const prod=(o,n)=>/대상물/.test(o.ow.label)&&!/AMR</.test(n);   // 대상물(제품·이미지 판) — AMR 차체는 제외
  if((a.ow.cls==='robot'&&TOOL.test(an)&&prod(b,bn))||(b.ow.cls==='robot'&&TOOL.test(bn)&&prod(a,an)))return;   // 손목·툴이 집는 제품: 작업 접촉
  const kind=a.ow.cls==='robot'&&b.ow.cls==='robot'?'로봇↔로봇':a.ow.cls!=='robot'&&b.ow.cls!=='robot'?'이동체↔이동체':'로봇↔이동체';
  add(kind+' | '+a.ow.label+' | '+b.ow.label,{a:an,b:bn,at:P3(a.B.c)},p);});
}
const res=[...hits.entries()].map(([k,h])=>({k,...h,max:+h.max.toFixed(3),frames:h.n})).sort((a,b)=>b.max-a.max);
return {mode:t.sim.mode.key,samples:n,res};})()`;

app.whenReady().then(async () => {
  try {
    const { startServer } = await import(path.resolve(__dirname, '../server/app-server.mjs')); const { port } = await startServer({ port: 0 });
    const w = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { backgroundThrottling: false } });
    const errors = []; w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/favicon/.test(e.message)) errors.push(e.message); });
    await w.loadURL(`http://127.0.0.1:${port}`); const js = (c) => w.webContents.executeJavaScript(c);
    for (let k = 0; k < 90; k++) { if (await js('!!window.__twin?.RENDER.loaded')) break; await wait(500); }
    if (!await js('!!window.__twin?.RENDER.loaded')) throw Error('Blender assets not loaded');
    const report = [];
    for (const mode of (process.env.COLLIDE_MODES || 'traditional,smart,dark').split(',')) {   // COLLIDE_MODES=smart,dark — 일부 단계만
      await js(`document.querySelector('[data-mode=${mode}]').click()`); await wait(1500);
      if (process.env.COLLIDE_PRE) { await js(fs.readFileSync(path.resolve(process.env.COLLIDE_PRE), 'utf8')); await wait(500); }   // 점검 전 설정 (예: Zone 셀 레시피 적용) — 페이지에서 실행할 JS 파일
      const r = await js(AUDIT(SECS)); const bad = r.res.filter((h) => h.max >= PEN);
      report.push({ ...r, violations: bad.length });
      console.log(`== ${mode} (${r.samples} 샘플)  간섭 ${bad.length}건${bad.length ? '' : ' — 없음'}`);
      for (const h of bad.slice(0, 25)) console.log(`  ${h.max.toFixed(2)}m  ${h.k}  (${h.frames}프레임 · t ${h.t}s · ${h.a}${h.b ? ' ↔ ' + (typeof h.b === 'string' ? h.b : `${h.b.c} (${h.b.size})`) : ''} @ ${h.at})`);
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ secs: SECS, pen: PEN, report, errors }, null, 2));
    if (errors.length) { console.log(`FAIL: 페이지 오류 ${errors.length}건 — 화면 갱신이 중간에 멈추면 간섭 점검도 틀린다`); [...new Set(errors)].slice(0, 5).forEach((m) => console.log('  ' + m.slice(0, 200))); }
    const total = report.reduce((a, r) => a + r.violations, 0);
    console.log(total ? `FAIL: 간섭 ${total}건 (outputs/collisions/report.json)` : 'PASS: 세 단계 모두 간섭 없음');
    clearTimeout(timer); app.exit(total ? 1 : 0);
  } catch (e) { console.error(e.stack); clearTimeout(timer); app.exit(1); }
});
