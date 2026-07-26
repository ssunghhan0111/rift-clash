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
  // Infirmary: a small ward tucked just above the Nursery — wounded fighters rest here until healed
  const iw=Math.min(96,sw*0.72), ih=Math.min(54,sh*0.6);
  const infirmary={x:nursery.x+(nursery.w-iw)/2, y:Math.max(gy+30,nursery.y-ih-10), w:iw, h:ih};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom,infirmary};
  const thTop={x:throne.x+throne.w/2, y:throne.y+14};
  const thBL={x:throne.x+30, y:throne.y+throne.h-14};
  const thBR={x:throne.x+throne.w-30, y:throne.y+throne.h-14};
  const thBC={x:throne.x+throne.w/2, y:throne.y+throne.h-10};
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
    infirmary: cubic(thBL, {x:W*0.30,y:H*0.50}, {x:W*0.05,y:H*0.38}, {x:infirmary.x+infirmary.w*0.5, y:infirmary.y+infirmary.h-8}, 14),
  };
  PATHS.surfaceVariants=['surface','surfaceB','surfaceC'];
}
for(const [w,h] of [[360,640],[400,700],[960,600],[500,900],[320,480]]){
  W=w; H=h;
  computeLayout();
  const inf = LAY.infirmary;
  const overlap = (a,b) => !(a.x+a.w<b.x || b.x+b.w<a.x || a.y+a.h<b.y || b.y+b.h<a.y);
  const collides = ['throne','barracks','armory','towerRoom','granary'].filter(k=>overlap(inf, LAY[k]));
  console.log(`W=${w} H=${h}  infirmary=${JSON.stringify(inf)}  collidesWith=${JSON.stringify(collides)}  pathLen=${PATHS.infirmary.length}`);
}
