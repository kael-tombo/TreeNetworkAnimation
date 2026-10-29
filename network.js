/* ═══════════════════════════════════════════════════════════════════
   CANOPY NETWORK ENGINE
   One shared graph + one SVG layer + one fixed particle canvas
   covering the entire landing page.

   Coordinates:
   - WORLD   : stable x/y in the document (the network's own frame)
   - VIEW    : screen y = worldY - scrollY each frame
   Particles advance in WORLD space, so scrolling never resets them.
   ═══════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const SVG    = document.getElementById('netSvg');
const LAYER  = document.getElementById('netLayer');
const CANVAS = document.getElementById('netCanvas');
const CTX    = CANVAS.getContext('2d');
const RM     = !new URLSearchParams(location.search).has('motion')
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS     = 'http://www.w3.org/2000/svg';

/* ── seeded PRNG: rebuilds keep the same tree shape ─────────────── */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;};}
let rng = mulberry32(0xC0FFE1);

/* ── graph ──────────────────────────────────────────────────────── */
let NODES = {}, LINKS = [], OUT = {}, nodeList = [];
let journeys = [], particles = [], flashes = [];
let targetCount = 150, spawnAcc = 0, lastT = 0, rafId = null;

function node(id,x,y,kind){
  NODES[id] = {id,x,y,kind:kind||'pass'};
  return id;
}

function link(a,b,lvl,opt={}){
  const A=NODES[a], B=NODES[b];
  if(!A||!B) return null;
  const dx=B.x-A.x, dy=B.y-A.y;
  const straight=Math.hypot(dx,dy);
  if(straight<2) return null;
  const ux=dx/straight, uy=dy/straight, px=-uy, py=ux;
  let c1,c2;
  if(opt.bulge!==undefined && opt.bulge!==null){
    c1={x:A.x+ux*straight*.25+px*opt.bulge, y:A.y+uy*straight*.25+py*opt.bulge};
    c2={x:B.x-ux*straight*.25+px*opt.bulge, y:B.y-uy*straight*.25+py*opt.bulge};
  }else{
    const w1=(rng()-.5)*.22*straight, w2=(rng()-.5)*.22*straight;
    const f=opt.flat?0.14:0.32;
    c1={x:A.x+ux*straight*f+px*w1, y:A.y+uy*straight*f+py*w1};
    c2={x:B.x-ux*straight*f+px*w2, y:B.y-uy*straight*f+py*w2};
  }
  // stable sampling every ~7px → polylines used for traversal
  const n=Math.max(4,Math.ceil(straight/7));
  const pts=[];
  for(let i=0;i<=n;i++){
    const t=i/n, mt=1-t;
    pts.push([
      mt*mt*mt*A.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*B.x,
      mt*mt*mt*A.y + 3*mt*mt*t*c1.y + 3*mt*t*t*c2.y + t*t*t*B.y
    ]);
  }
  let len=0; const cum=[0];
  for(let i=1;i<pts.length;i++){
    len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    cum.push(len);
  }
  const lk={i:LINKS.length,a,b,lvl,pts,cum,len,ret:!!opt.ret,
    d:`M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}`};
  LINKS.push(lk);
  (OUT[a]=OUT[a]||[]).push(lk);
  return lk;
}

/* ── document-scale topology: seven regions of one tree ─────────── */
function buildNetwork(){
  rng = mulberry32(0xC0FFE1);
  NODES={}; LINKS=[]; OUT={};
  const doc = document.documentElement;
  const W = doc.clientWidth, H = doc.scrollHeight;

  LAYER.style.height = H+'px';
  SVG.setAttribute('viewBox',`0 0 ${W} ${H}`);
  SVG.setAttribute('width',W); SVG.setAttribute('height',H);
  SVG.style.width='100%'; SVG.style.height=H+'px';

  // measure each region in WORLD coordinates (document space)
  const R={};
  document.querySelectorAll('[data-region]').forEach(el=>{
    if(el.dataset.region==='nav') return;
    const r=el.getBoundingClientRect();
    const t=r.top+window.scrollY;
    R[el.dataset.region]={t,h:r.height,b:t+r.height};
  });
  const hero=R.hero, ins=R.inputs, itl=R.intelligence,
        dis=R.distribution, exs=R.execution, fbk=R.feedback, ftr=R.footer;
  const X=f=>Math.round(f*W);
  const Y=(s,f)=>Math.round(s.t+f*s.h);

  /* — Region 1 · HERO: inflows merge into the first trunk — */
  node('E1',X(.10),-40,'entry'); node('E2',X(.50),-40,'entry'); node('E3',X(.90),-40,'entry');
  node('J0',X(.52),Y(hero,.09),'junction');
  node('HT1',X(.05),Y(hero,.36),'terminal'); node('HT3',X(.95),Y(hero,.32),'terminal');
  link('E1','J0','trunk',{flat:true}); link('E2','J0','trunk');
  link('E3','J0','trunk',{flat:true});
  link('E1','HT1','p2'); link('E3','HT3','p2');
  node('R1',X(.88),hero.b+8,'junction');
  node('HA',X(.16),Y(hero,.66),'junction');
  // both trunk curves bow OUTWARD around the hero's central clearing
  link('J0','R1','p1',{bulge:-X(.14)});
  link('J0','HA','p2',{bulge:X(.14)});
  link('HA','R1','p2',{bulge:150});

  /* — Region 2 · INPUTS: inflow from above + convergence — */
  node('A',X(.11),Y(ins,.17),'junction'); node('B',X(.78),Y(ins,.14),'pass');
  node('C1',X(.24),Y(ins,.52),'junction'); node('C2',X(.66),Y(ins,.58),'pass');
  node('R2',X(.88),ins.b+6,'junction');
  node('TI1',X(.07),Y(ins,.70),'terminal');
  link('HT1','A','p1');                       // hero channel persists into inputs
  link('R1','B','p1',{flat:true});
  link('A','C1','p1',{bulge:-X(.008)});
  link('B','C2','p1');
  link('C1','C2','p2',{bulge:-36});
  link('C1','TI1','p3');                      // one branch sinks below the cards
  link('C2','R2','p1',{bulge:X(.008)});

  /* — Region 3 · INTELLIGENCE: parallel routes, no single center —
     M1 / M4 run in the open band above the heading; deeper branches
     pass behind the translucent cards, which dim them naturally. */
  node('M1',X(.10),itl.t+104,'junction');
  node('M4',X(.62),itl.t+84,'pass');
  node('M2',X(.86),Y(itl,.58),'pass');
  node('M3',X(.36),Y(itl,.74),'pass');
  node('TI2',X(.05),Y(itl,.40),'terminal');
  node('R3',X(.88),itl.b+6,'junction');
  node('L2',X(.08),Y(dis,.26),'pass');
  link('R2','M2','p1',{bulge:-X(.008)});
  link('R2','M1','p1',{bulge:-30});           // shallow sag in the top band
  link('R2','M4','p2');
  link('M1','M3','p2',{bulge:64});
  link('M1','TI2','p3');
  link('M3','M2','p2',{bulge:26});
  link('M4','M2','p3',{bulge:-40});
  link('M2','R3','p1',{bulge:-X(.008)});
  link('M1','L2','p1',{flat:true});           // left collector continues downward

  /* — Distribution: descender roots drop through the inter-column
     gutters; the fan spreads below the stats row. Anatomy:
     lede corridor (between lede and stats) carries horizontal flow,
     stat-gutter threads carry vertical flow, body text carries none. */
  node('D1',X(.38),Y(dis,.62),'junction');
  node('D2',X(.70),Y(dis,.49),'pass');
  node('D2r',X(.87),Y(dis,.55),'pass');
  node('tA',X(.075),Y(dis,.66),'terminal');
  node('tB',X(.20),Y(dis,.88),'terminal');
  node('tC',X(.42),Y(dis,.84),'terminal');
  node('tD',X(.55),Y(dis,.90),'terminal');
  node('tE',X(.75),Y(dis,.82),'junction');
  node('tF',X(.945),Y(dis,.80),'terminal');
  node('R4',X(.88),dis.b+6,'junction');
  link('R3','D2','p2',{bulge:-24});            // enters via the open corridor
  link('R3','D2r','p1',{flat:true});          // right-gutter descent
  link('D2r','D2','p3',{bulge:14});
  link('D2r','tF','p1',{bulge:-30});
  link('D2','tD','p2');
  link('D2','tE','p2');
  link('tE','R4','p2',{bulge:X(.008)});
  link('D2','D1','p2',{bulge:16});            // behind the display numbers only
  link('D1','tB','p2');
  link('D1','tC','p2');
  link('L2','tA','p1');                       // left collector's own descender

  /* — Region 5 · EXECUTION: fan-in to glowing endpoints — */
  node('X1',X(.16),Y(exs,.42),'junction'); node('X2',X(.40),Y(exs,.56),'pass');
  node('X3',X(.63),Y(exs,.45),'pass');
  node('F0',X(.87),exs.b-6,'terminal');
  node('xT1',X(.09),Y(exs,.78),'terminal'); node('xT2',X(.33),Y(exs,.84),'terminal');
  node('xT3',X(.57),Y(exs,.80),'terminal'); node('xT4',X(.75),Y(exs,.72),'terminal');
  link('R4','X1','p1',{bulge:-X(.008)});
  link('R4','X2','p2'); link('R4','X3','p2',{bulge:X(.008)});
  link('R4','F0','p1',{bulge:-X(.01)});
  link('X1','xT1','p3'); link('X2','xT2','p3');
  link('X3','xT3','p3'); link('X3','xT4','p3');
  link('X2','X3','p3',{bulge:22});

  /* — Region 6 · FEEDBACK: dashed return routes go back upstream — */
  node('R5',X(.88),fbk.b+4,'junction');
  node('Fb1',X(.12),Y(fbk,.26),'pass');
  node('FBj',X(.50),Y(fbk,.56),'pass');
  link('F0','Fb1','ret',{bulge:-70});         // travels UP from execution region
  link('Fb1','M1','ret',{bulge:46});          // back up into routing region…
  link('Fb1','FBj','p2',{bulge:-28});         // …or continues gently downstream
  link('FBj','R5','p1',{bulge:X(.008)});

  /* — Region 7 · FOOTER: selected pathways exit the document —
     Exits hug both page edges; the footer link grid stays clear. */
  node('FuC',X(.58),H+55,'exit'); node('FuL',X(.035),H+55,'exit');
  node('FuR',X(.945),H+55,'exit');
  link('R5','FuC','p2',{bulge:-30});
  link('R5','FuR','p3',{bulge:-34});
  link('L2','FuL','p2',{bulge:40});           // long left identity, hero→footer

  nodeList = Object.values(NODES);
  renderSVG();
  buildJourneys();
  seedParticles();
}

/* ── SVG layer: stable vascular strokes, revealed on scroll ─────── */
function renderSVG(){
  const frag=document.createDocumentFragment();
  for(const lk of LINKS){
    const p=document.createElementNS(NS,'path');
    p.setAttribute('d',lk.d);
    p.setAttribute('class','lv-'+lk.lvl);
    if(!RM && lk.lvl!=='ret' && lk.lvl!=='trunk') p.dataset.reveal='1';
    frag.appendChild(p);
  }
  SVG.replaceChildren(frag);
  setupReveal();
}

function setupReveal(){
  const paths=[...SVG.querySelectorAll('path[data-reveal]')];
  if(RM){ paths.forEach(p=>{p.style.strokeDasharray='none';p.style.strokeDashoffset='0';}); return; }
  const sy=window.scrollY, vh=window.innerHeight;
  const io=new IntersectionObserver(es=>{
    for(const e of es){
      if(!e.isIntersecting) continue;
      const p=e.target;
      io.unobserve(p);
      requestAnimationFrame(()=>p.style.strokeDashoffset='0');   // CSS transition draws it in
    }
  },{rootMargin:'15% 0px'});
  paths.forEach((p,i)=>{
    const L=p.getTotalLength();
    p.style.transitionDelay=((i*53)%460)+'ms';
    // anything already above the fold line appears instantly — no reset feel
    if(p.getBoundingClientRect().top < sy+vh*0.92){
      p.style.strokeDasharray=L; p.style.strokeDashoffset=0;
    }else{
      p.style.strokeDasharray=L; p.style.strokeDashoffset=L;
      io.observe(p);
    }
  });
}

/* ── journey bank: routes = valid walks in the shared graph ─────── */
function pickEdge(outs,retBoost){
  let sum=0;
  const ws=outs.map(l=>{
    let w = l.lvl==='trunk'?3.4 : l.lvl==='p1'?2.6 : l.lvl==='p2'?1.8 : 1;
    if(l.ret) w = retBoost ? 7 : .22;
    sum+=w; return w;
  });
  let r=Math.random()*sum;
  for(let k=0;k<outs.length;k++){ r-=ws[k]; if(r<=0) return outs[k]; }
  return outs[outs.length-1];
}

function makeJourney(startId){
  let cur=startId, total=0, usedRet=false, guard=0;
  const pts=[], cum=[0], marks=[{d:0,id:startId}], visited=new Set();
  while(guard++<36){
    const outs=(OUT[cur]||[]).filter(l=>!visited.has(l.i));
    if(!outs.length) break;
    const lk=pickEdge(outs,!usedRet && Math.random()<.5);
    visited.add(lk.i);
    const skip=pts.length?1:0;
    for(let i=skip;i<lk.pts.length;i++){
      const p=lk.pts[i];
      pts.push(p);
      if(pts.length>1){
        const q=pts[pts.length-2];
        total+=Math.hypot(p[0]-q[0],p[1]-q[1]);
      }
      cum[pts.length-1]=total;
    }
    marks.push({d:total,id:lk.b});
    cur=lk.b;
    if(lk.ret) usedRet=true;
  }
  if(total<420) return null;
  return {pts,cum,total,marks,startY:NODES[startId]?NODES[startId].y:0};
}

function buildJourneys(){
  journeys=[];
  for(const n of nodeList){
    if(!OUT[n.id]) continue;
    for(let k=0;k<3;k++){
      const j=makeJourney(n.id);
      if(j) journeys.push(j);
    }
  }
  if(!journeys.length){ // degenerate safety: one walk from first node with out-edges
    const first=Object.values(OUT)[0]||[];
    if(first[0]) journeys.push(makeJourney(first[0].a));
  }
}

/* ── particles: shared engine, independent logical progress ─────── */
function pickJourney(){
  const center=window.scrollY+window.innerHeight/2;
  let sum=0; const ws=journeys.map(j=>{const w=1/(90+Math.abs(j.startY-center));sum+=w;return w;});
  let r=Math.random()*sum;
  for(let k=0;k<journeys.length;k++){ r-=ws[k]; if(r<=0) return journeys[k]; }
  return journeys[journeys.length-1];
}

function makeParticle(j,d){
  return {j,d,ptr:0,mi:1,x:0,y:0,speed:30,r:1.6,hue:0,big:false};
}

function styleParticle(p){
  p.mi=1;
  p.speed=22+Math.random()*40;
  p.r=1.15+Math.random()*1.9;
  p.hue=Math.random()<.06?2:(Math.random()<.5?0:1);
  p.big=Math.random()<.05;
}

function seedParticles(){
  targetCount=Math.max(120,Math.min(300,Math.round(document.documentElement.scrollHeight/26)));
  particles=[];
  for(let i=0;i<targetCount;i++){
    const j=journeys[(Math.random()*journeys.length)|0];
    if(!j) return;
    const p=makeParticle(j,Math.random()*j.total);  // pre-spread across the WHOLE page
    styleParticle(p);
    particles.push(p);
  }
}

function respawn(p){
  p.j=pickJourney(); p.d=0; p.ptr=0;
  styleParticle(p);
  p.mi=1;
}

/* ── sprites: pre-rendered emerald glows (fast drawImage) ───────── */
const PAL=['#10B981','#34D399','#0F9E78'];
const SPRITES=PAL.map(col=>{
  const c=document.createElement('canvas'); c.width=c.height=64;
  const g=c.getContext('2d');
  const grad=g.createRadialGradient(32,32,0,32,32,30);
  grad.addColorStop(0,col+'F2'); grad.addColorStop(.3,col+'66'); grad.addColorStop(1,col+'00');
  g.fillStyle=grad; g.beginPath(); g.arc(32,32,30,0,7); g.fill();
  return c;
});

/* advance one particle's LOGICAL state (works headless, no rAF needed) */
function advanceParticle(p,dt,now){
  p.d+=p.speed*dt;
  if(p.d>=p.j.total){ respawn(p); return; }
  const cum=p.j.cum, pts=p.j.pts;
  while(p.ptr<cum.length-2 && cum[p.ptr+1]<p.d) p.ptr++;
  const i0=p.ptr+1;
  if(i0>=cum.length){ respawn(p); return; }
  const d0=cum[i0-1], d1=cum[i0];
  const t=d1>d0?(p.d-d0)/(d1-d0):0;
  p.x=pts[i0-1][0]+(pts[i0][0]-pts[i0-1][0])*t;
  p.y=pts[i0-1][1]+(pts[i0][1]-pts[i0-1][1])*t;
  // arrival flashes as the particle crosses each node
  while(p.mi<p.j.marks.length && p.j.marks[p.mi].d<=p.d){
    const m=p.j.marks[p.mi];
    const kind=NODES[m.id]&&NODES[m.id].kind;
    if(now!==undefined) flash(m.id, kind==='terminal'?820:kind==='junction'?560:420, kind==='terminal');
    p.mi++;
  }
}

/* ── frame loop ─────────────────────────────────────────────────── */
function resizeCanvas(){
  const dpr=Math.min(2,window.devicePixelRatio||1);
  CANVAS.width=window.innerWidth*dpr; CANVAS.height=window.innerHeight*dpr;
  CTX.setTransform(dpr,0,0,dpr,0,0);
  CANVAS.style.width=window.innerWidth+'px';
  CANVAS.style.height=window.innerHeight+'px';
}

function flash(nodeId,dur,big){
  const n=NODES[nodeId]; if(!n) return;
  flashes.push({x:n.x,y:n.y,t0:performance.now(),dur,big});
  if(flashes.length>48) flashes.splice(0,flashes.length-48);
}

function frame(now){
  rafId=requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-lastT)/1000||0); lastT=now;

  // continuous spawning near + far
  spawnAcc+=dt;
  if(particles.length<targetCount && spawnAcc>.1){
    spawnAcc=0;
    const p=makeParticle(pickJourney(),0); styleParticle(p); particles.push(p);
  }

  // advance the shared logical state, then project a single paint pass
  for(const p of particles) advanceParticle(p,dt,now);
  renderCanvas(now);
}

/* one shared paint pass: world → viewport projection */
function renderCanvas(now){
  const sy=window.scrollY, vh=window.innerHeight, vw=window.innerWidth;
  CTX.clearRect(0,0,vw,vh);

  // faint junction dots (structure)
  for(const n of nodeList){
    const yy=n.y-sy;
    if(yy<-30||yy>vh+30) continue;
    CTX.beginPath();
    CTX.fillStyle = n.kind==='terminal' ? 'rgba(16,185,129,.30)' : 'rgba(120,145,132,.28)';
    CTX.arc(n.x,yy,n.kind==='terminal'?2.4:1.7,0,7);
    CTX.fill();
  }

  // particles
  for(const p of particles){
    if(!p.x&&p.d===0) continue;
    const yy=p.y-sy;
    if(yy<-40||yy>vh+40) continue;               // logical step done, draw skipped
    const col=PAL[p.hue||0], s=SPRITES[p.hue||0];
    const w=p.r*(p.big?7:5.4);
    CTX.globalAlpha=p.big?.5:.9;
    CTX.drawImage(s,p.x-w/2,yy-w/2,w,w);
    CTX.globalAlpha=1;
    CTX.fillStyle=col;
    CTX.beginPath(); CTX.arc(p.x,yy,p.r*.75,0,7); CTX.fill();
  }

  // arrival rings (endpoints glow briefly)
  for(let i=flashes.length-1;i>=0;i--){
    const f=flashes[i], age=(now-f.t0)/f.dur;
    if(age>=1){ flashes.splice(i,1); continue; }
    const yy=f.y-sy;
    if(yy<-20||yy>vh+20) continue;
    const rev=1-age;
    CTX.beginPath();
    CTX.strokeStyle=`rgba(16,185,129,${(rev*.55).toFixed(3)})`;
    CTX.lineWidth=1;
    CTX.arc(f.x,yy,3+age*(f.big?17:10),0,7);
    CTX.stroke();
    if(f.big){
      CTX.beginPath();
      CTX.fillStyle=`rgba(16,185,129,${(rev*.5).toFixed(3)})`;
      CTX.arc(f.x,yy,2.6,0,7); CTX.fill();
    }
  }
  CTX.globalAlpha=1;
}

/* ── lifecycle ──────────────────────────────────────────────────── */
function rebuild(){
  buildNetwork();
  if(!RM && !rafId){ lastT=performance.now(); rafId=requestAnimationFrame(frame); }
}

let rt=null;
function onResize(){
  clearTimeout(rt);
  rt=setTimeout(()=>{
    resizeCanvas();
    // the seeded graph rebuilds into the same shape; re-seat particles
    // at their old fractional progress on fresh journeys (no reset to zero)
    const fracs=particles.map(p=>p.j.total?p.d/p.j.total:0);
    rebuild();
    particles=particles.slice(0,targetCount);
    particles.forEach((p,i)=>{
      p.j=journeys[(i*7+3)%journeys.length]||p.j;
      p.d=fracs[i]*p.j.total;
      p.ptr=0; p.mi=1;
    });
  },180);
}

window.addEventListener('resize',onResize);
window.addEventListener('load',()=>{resizeCanvas();rebuild();});
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{resizeCanvas();rebuild();});
document.addEventListener('visibilitychange',()=>{ /* rAF pauses with the tab automatically */ });

resizeCanvas();
rebuild();

/* ── inspection hook (harmless in production) ───────────────────── */
window.__canopy = {
  get stats(){ return {
    particles:particles.length, journeys:journeys.length,
    links:LINKS.length, nodes:nodeList.length, flashes:flashes.length,
    reducedMotion: RM, alive: rafId !== null
  };},
  get motion(){ // mean logical distance — sampled twice proves continuous movement
    if(!particles.length) return 0;
    let s=0; for(const p of particles) s+=p.d;
    return +(s/particles.length).toFixed(1);
  },
  sample(n=12){ // world positions + journey spans for QA
    return particles.slice(0,n).map(p=>({
      x:Math.round(p.x), y:Math.round(p.y), d:Math.round(p.d),
      total:Math.round(p.j.total),
      spans:p.j.marks.length,
      from:p.j.marks[0].id, to:p.j.marks[p.j.marks.length-1].id
    }));
  },
  journeysMap(){ // which regions journeys connect
    const seen={};
    for(const j of journeys){ const k=j.marks[0].id+'->'+j.marks[j.marks.length-1].id; seen[k]=(seen[k]||0)+1; }
    return seen;
  },
  step(seconds){ // QA: advance all particles without rendering (works when rAF is paused)
    const now=performance.now();
    const dt=Math.min(seconds,0.12);
    for(const p of particles) advanceParticle(p,dt,now);
    return window.__canopy.motion;
  },
  renderQA(){ // QA: execute a real paint pass headlessly
    try{ renderCanvas(performance.now()); return 'ok'; }
    catch(e){ return 'ERROR: '+e.message; }
  },
  census(){ // QA: how many particles are currently drawable in the viewport?
    const sy=window.scrollY, vh=window.innerHeight;
    let vis=0;
    for(const p of particles){
      const yy=p.y-sy;
      if(yy>=-40 && yy<=vh+40) vis++;
    }
    return {visible:vis, total:particles.length};
  },
  compareMotion(before){ // QA: verify a particle kept a continuous world position
    const p=particles[0];
    return {d:Math.round(p.d), x:Math.round(p.x), y:Math.round(p.y), inDoc:P_OK(p)};
    function P_OK(p){ return p.x>=0 && p.x<=document.documentElement.clientWidth && p.y>=-50 && p.y<=document.documentElement.scrollHeight+70; }
  }
};

})();
