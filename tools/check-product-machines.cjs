const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');const out=path.resolve(__dirname,'../outputs/machine-upgrade');fs.mkdirSync(out,{recursive:true});process.env.METAFACTORY_DATA_DIR=path.join(out,'runtime');
const wait=ms=>new Promise(r=>setTimeout(r,ms));const timer=setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},150000);
app.whenReady().then(async()=>{try{
 const {startServer}=await import(path.resolve(__dirname,'../server/app-server.mjs'));const {port}=await startServer({port:0});
 const w=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{backgroundThrottling:false}});const errors=[];
 w.webContents.on('console-message',e=>{if(e.level==='error'&&!/favicon/.test(e.message))errors.push(e.message)});
 await w.loadURL(`http://127.0.0.1:${port}`);const js=c=>w.webContents.executeJavaScript(c);
 for(let k=0;k<70;k++){if(await js('!!window.__twin?.RENDER.loaded'))break;await wait(500)}
 if(!await js('!!window.__twin?.RENDER.loaded'))throw Error('Blender assets not loaded');
 const functional=await js(`(async()=>{const THREE=await import('three');const {makeProductMachine}=await import('/js/product-machines.js');const {MACHINE_SPECS}=await import('/js/machine-specs.js');const out=[];
 for(const key of Object.keys(MACHINE_SPECS)){const P=makeProductMachine(key,new THREE.Group()),m=P.machine,s=m.spec,n=m.nodes;let pass=true,issues=[];const check=(ok,note)=>{if(!ok){pass=false;issues.push(note)}};
 if(n.Ram){const y0=m.rest.Ram.y;let last=n.Ram.position.y,drop=0;
  for(let i=0;i<=200;i++){m.update({busy:true,progress:i/200,rdt:.01,dts:.01});drop=Math.max(drop,y0-n.Ram.position.y);check(n.Ram.position.y<=y0+1e-5&&n.Ram.position.y>=y0-(s.strokeMm??s.demoStrokeMm)/1000-1e-5,'ram stroke');if(s.ramSpeedMmS)check(Math.abs(n.Ram.position.y-last)<=s.ramSpeedMmS/1000*.01+1e-6,'servo speed');last=n.Ram.position.y;}
  check(drop>.01,'ram movement');check(n.Ram.scale.y===1,'no artificial ram stretching');
 }else{
  m.update({busy:true,progress:.5,rdt:1,dts:.1,open:true});check(!m.cutting,'open door interlock');
  m.update({busy:true,progress:.5,rdt:1,dts:1,open:false});check(m.cutting,'closed door cutting');
  for(let i=0;i<120;i++){m.update({busy:true,progress:.2+i/200,time:i*.1,rdt:.02,dts:.02});if(n.Head){check(Math.abs(n.XSlide.position.x)<=s.travelMm[0]/2000+1e-6,'X travel');check(Math.abs(n.YSlide.position.z)<=s.travelMm[1]/2000+1e-6,'Y travel');const gap=n.Head.position.y-s.tableHeightMm/1000;check(gap>=s.spindleGapMm[0]/1000-1e-6&&gap<=s.spindleGapMm[1]/1000+1e-6,'Z clearance');}}
  if(n.Chuck){check(Math.abs(n.Chuck.rotation.x)>.1&&n.Chuck.rotation.y===0,'horizontal chuck axis');const dir=new THREE.Vector3(1,0,0).transformDirection(n.Chuck.matrixWorld);check(Math.abs(dir.y)<1e-6,'horizontal spindle world direction');}
  check(m.displayedRPM<=s.spindleRpm,'spindle rating');
 }
 const before=JSON.stringify(Object.values(n).filter(Boolean).map(o=>[o.position.toArray(),o.quaternion.toArray()]));m.update({busy:true,progress:.5,time:100,rdt:1,dts:10,frozen:true});const after=JSON.stringify(Object.values(n).filter(Boolean).map(o=>[o.position.toArray(),o.quaternion.toArray()]));check(before===after,'freeze on stop');
 out.push({key,model:s.model,pass,issues});}
 return out;})()`);console.log('functional',JSON.stringify(functional));if(functional.some(r=>!r.pass))throw Error('Machine functional contract failed');
 const installed=[];
 for(const mode of ['traditional','smart','dark']){
  await js(`document.querySelector('[data-mode=${mode}]').click()`);await wait(1000);
  const state=await js(`(()=>{const t=window.__twin;const machines=[...t.view.stationViews.map(s=>s.parts.machine),...t.xzones.zones.flatMap(z=>z.order.map(c=>c.parts.machine))].filter(Boolean);const tech=t.hub.assets.filter(a=>a.tech.ReferenceModel&&/Haas|AIDA|SCHMIDT|AP&T/.test(a.tech.ReferenceManufacturer));return{mode:t.sim.mode.key,machines:machines.map(m=>({key:m.key,model:m.spec.model,fits:m.envelopeFits,tiltEnabled:m.tiltEnabled})),aasModels:tech.map(a=>a.tech.ReferenceModel)};})()`);installed.push(state);console.log('installed',JSON.stringify(state));
  if(state.machines.some(m=>m.fits===false))throw Error('Current product does not fit base working envelope');
  if(!state.machines.some(m=>m.key==='umc1250')||!state.machines.some(m=>m.key==='st40'))throw Error('Zone machines not replaced');
  if(mode!=='traditional'&&!state.aasModels.some(m=>m==='UMC-1250'))throw Error('Machine AAS spec missing');
 }
 await wait(1000);fs.writeFileSync(path.join(out,'factory.png'),(await w.webContents.capturePage()).toPNG());
 const targets=await js(`(()=>{const out=[];for(const z of window.__twin.xzones.zones)for(const c of z.order)if(c.parts.machine&&['mill5','turn'].includes(c.def.type)){const m=c.parts.machine;for(const r of c.robots)out.push({machine:m.key,target:r.machineTargets?.table,finite:r.joints().every(Number.isFinite)});}return out;})()`);
 if(targets.some(t=>!t.target?.every(Number.isFinite)||!t.finite))throw Error('Robot/machine fixture target invalid');
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({functional,installed,targets,errors},null,2));
 if(errors.length)throw Error(errors.slice(0,5).join('\n'));
 console.log('PASS: all six machines, published motion ranges, door interlock, horizontal spindle, frozen stop, three modes and AAS references');clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e.stack);clearTimeout(timer);app.exit(1)}});
