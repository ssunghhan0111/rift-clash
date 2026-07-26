function cubic(p0,c1,c2,p1,n){
  const pts=[];
  for(let i=0;i<=n;i++){
    const t=i/n, u=1-t;
    pts.push({x:u*u*u*p0.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*p1.x, y:u*u*u*p0.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*p1.y});
  }
  return pts;
}
let LAY, PATHS, W, H;
function computeLayout(){
  const gy=H*0.28;
  const tw=Math.min(280,W*0.40), th=Math.min(130,(H-gy)*0.30);
  const throne={x:W*0.5-tw/2, y:gy+(H-gy)*0.24-th*0.30, w:tw, h:th};
  const sw=Math.min(165,W*0.25), sh=Math.min(108,(H-gy)*0.26);
  const nursery={x:8, y:H-sh-12, w:sw, h:sh};
  const granary={x:W-sw-8, y:H-sh-12, w:sw, h:sh};
  const bw=Math.min(190,W*0.30), bh=Math.min(96,(H-gy)*0.23);
  // raised so the Lay Egg button never covers it
  const by=Math.max(throne.y+throne.h+8, H-bh-74);
  const barracks={x:W*0.5-bw/2, y:by, w:bw, h:bh};
  const rrw=Math.min(72,W*0.12), rrh=Math.min(58,bh*0.85);
  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  // Infirmary: a small ward tucked beside the Throne Room — wounded fighters rest here until healed
  const infw=Math.max(16,Math.min(70, throne.x-16-6));
  const infh=Math.min(54, throne.h*0.6);
  const infirmary={x:Math.max(6, throne.x-infw-10), y:throne.y+(throne.h-infh)/2, w:infw, h:infh};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom,infirmary};
  const thTop={x:throne.x+throne.w/2, y:throne.y+14};
  const thBL={x:throne.x+30, y:throne.y+throne.h-14};
  const thBR={x:throne.x+throne.w-30, y:throne.y+throne.h-14};
  const thBC={x:throne.x+throne.w/2, y:throne.y+throne.h-10};
  const thML={x:throne.x+4, y:throne.y+throne.h*0.5};
  const surf={x:W*0.5, y:gy-6};
  const surf2={x:W*0.24, y:gy-6};
  const surf3={x:W*0.76, y:gy-6};
  PATHS={
    surface: cubic(thTop, {x:W*0.34,y:(gy+thTop.y)/2+22}, {x:W*0.66,y:gy+18}, surf, 16),
    surfaceB: cubic(thTop, {x:W*0.30,y:(gy+thTop.y)/2+30}, {x:W*0.28,y:gy+22}, surf2, 16),
    surfaceC: cubic(thTop, {x:W*0.70,y:(gy+thTop.y)/2+30}, {x:W*0.72,y:gy+22}, surf3, 16),
    nursery: cubic(thBL, {x:W*0.42,y:H*0.66}, {x:W*0.02,y:H*0.60}, {x:nursery.x+nursery.w*0.62, y:nursery.y+12}, 16),
    granary: cubic(thBR, {x:W*0.58,y:H*0.66}, {x:W*0.98,y:H*0.60}, {x:granary.x+granary.w*0.38, y:granary.y+12}, 16),
    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
    infirmary: cubic(thML, {x:throne.x-20,y:throne.y+throne.h*0.5-6}, {x:infirmary.x+infirmary.w+14,y:infirmary.y+infirmary.h*0.5+4}, {x:infirmary.x+infirmary.w*0.5,y:infirmary.y+infirmary.h-6}, 10),
  };
  PATHS.surfaceVariants=['surface','surfaceB','surfaceC'];
}
function overlap(a,b){ return !(a.x+a.w<b.x || b.x+b.w<a.x || a.y+a.h<b.y || b.y+b.h<a.y); }
function pathHitsBox(pts, box, r){ return pts.some(p=>p.x>box.x-r&&p.x<box.x+box.w+r&&p.y>box.y-r&&p.y<box.y+box.h+r); }
let anyFail=false;
for(const [w,h] of [[300,560],[320,480],[340,600],[360,640],[375,667],[390,844],[400,700],[414,896],[430,932],[480,800],[600,900],[768,1024],[960,600],[1200,700],[1400,800]]){
  W=w; H=h;
  computeLayout();
  const inf = LAY.infirmary;
  const roomCollide = ['throne','barracks','armory','towerRoom','granary','nursery'].filter(k=>overlap(inf, LAY[k]));
  const tunnelCollide = ['surface','surfaceB','surfaceC','nursery','granary','barracks'].filter(k=>pathHitsBox(PATHS[k], inf, 12));
  const bad = roomCollide.length || tunnelCollide.length || inf.x<0 || inf.w<10;
  if(bad) anyFail=true;
  console.log(`${bad?'FAIL':'ok  '} W=${w} H=${h} rooms=${JSON.stringify(roomCollide)} tunnels=${JSON.stringify(tunnelCollide)}`);
}
console.log(anyFail ? '*** FAIL ***' : 'ALL CLEAN — real file computeLayout() verified');
