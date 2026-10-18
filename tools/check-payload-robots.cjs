const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../outputs/robot-upgrade');fs.mkdirSync(out,{recursive:true});process.env.METAFACTORY_DATA_DIR=path.join(out,'recordings');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let w;
const timeout=setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},180000);
app.whenReady().then(async()=>{try{
 const {startServer}=await import(path.resolve(__dirname,'../server/app-server.mjs'));const {port}=await startServer({port:0});
 w=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{backgroundThrottling:false}});
 const errors=[];w.webContents.on('console-message',e=>{if(e.level==='error'&&!/favicon/.test(e.message))errors.push(e.message)});
 await w.loadURL(`http://127.0.0.1:${port}`);const js=s=>w.webContents.executeJavaScript(s);
 for(let i=0;i<60;i++){if(await js('!!window.__twin?.RENDER.loaded'))break;await wait(500)}
 console.log('loaded',await js('window.__twin?.RENDER.loaded'));
 const result=await js(`(async()=>{const {KIT}=await import('/js/factory.js');const THREE=await import('three');const {makeRobot}=KIT;const tests=[];
 for(const [kind,min] of [['cobot',20],['ammr',3],['articulated',60]]){const r=makeRobot(kind,KIT.MAT.orange);r.anim(false,0);r.root.updateWorldMatrix(true,true);const a=r.tip.getWorldPosition(new THREE.Vector3());r.anim(true,2);r.root.updateWorldMatrix(true,true);const b=r.tip.getWorldPosition(new THREE.Vector3());tests.push({kind,model:r.spec?.model,payload:r.payload,axes:r.jointDefs.length,positions:r.joints().length,finite:r.joints().every(Number.isFinite),motion:a.distanceTo(b),native:!!(r.arm?.native||r.arms?.[0]?.native),threshold:r.payload>=min});}
 return tests;})()`);console.log(JSON.stringify(result,null,2));
 if(result.some(t=>!t.threshold||!t.native||!t.finite||t.axes!==t.positions||t.motion<.001))throw new Error('Native robot contract failed');
 await js(`document.querySelector('[data-mode=smart]').click()`);await wait(2000);
 const pedestals=await js(`(()=>{const t=window.__twin;let robots=[];t.view.scene.traverse(o=>{if(o.name==='CobotPedestal'){o.updateWorldMatrix(true,false);robots.push({size:o.userData.dimensionsMeters,center:o.getWorldPosition(new (o.position.constructor)()).toArray()});}});return robots;})()`);console.log('cobot pedestals',JSON.stringify(pedestals));if(!pedestals.length||pedestals.some(p=>p.size.some(v=>v!==.5)||Math.abs(p.center[1]-.25)>.001))throw new Error('Cobot pedestal size/floor alignment failed');
 const camera=await js(`(()=>{const t=window.__twin;return t.camWall.allCameras().filter(c=>c.kind==='articulated').map(c=>({robot:c.robot,ref:c.ref,label:c.label}));})()`);console.log('smart industrial cameras',camera.length);
 if(!camera.length)throw new Error('Industrial camera missing in smart mode');
 const pose=await js(`(()=>{const t=window.__twin,c=t.camWall.allCameras().find(c=>c.kind==='articulated'),p=t.camWall.cameraFor(c.ref).pose();return{pos:p.pos.toArray(),dir:p.dir.toArray()}})()`);if(![...pose.pos,...pose.dir].every(Number.isFinite))throw new Error('Invalid camera pose');
 // Close previous automatic segment; then record one real industrial camera for a small reviewable clip.
 await js(`(async()=>{const t=window.__twin,r=t.robotRec;r.on=false;await r.flush();r._all=r.cw.allCameras.bind(r.cw);r.cw.allCameras=()=>r._all().filter(c=>c.kind==='articulated').slice(0,1);r.on=true;})()`);
 await wait(6500);
 const video=await js(`(async()=>{const t=window.__twin,r=t.robotRec;r.on=false;const seg=await r.flush();if(!seg)throw Error('No recorded segment');await r.convertAll('robotcam',[seg]);r.cw.allCameras=r._all;const v=r.entry(seg,seg.index[0]);delete v.blob;return{...v,server:r.server,ffmpeg:r.ffmpeg,bytes:seg.bytes,index:seg.index};})()`);
 console.log('video',JSON.stringify(video));if(!video.stored||video.bytes<1000||!video.mp4Path)throw new Error('Video not saved/converted');
 await js(`document.querySelector('[data-mode=dark]').click()`);await wait(2500);
 const dark=await js(`(()=>{const t=window.__twin;return {models:t.view.stationViews.flatMap(s=>(s.parts.robots??[]).map(r=>r.spec?.model)).filter(Boolean),cameraCount:t.camWall.allCameras().filter(c=>c.kind==='articulated').length};})()`);
 if(!dark.cameraCount)throw new Error('Dark industrial cameras missing');
 const png=await w.webContents.capturePage();fs.writeFileSync(path.join(out,'factory.png'),png.toPNG());
 const report={result,cameraCount:camera.length,pose,video,dark,errors};fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(report,null,2));
 if(errors.length)throw new Error('Browser console errors: '+errors.slice(0,5).join('\n'));
 console.log('PASS: native robot specs, joint animation, smart/dark cameras, real scene WebM -> MP4 + metadata');clearTimeout(timeout);app.exit(0);
 }catch(e){console.error(e.stack);clearTimeout(timeout);app.exit(1)}});
