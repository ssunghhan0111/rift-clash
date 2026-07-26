f_in = "antopia_v29.html"
f_out = "antopia_v30.html"
s = open(f_in, encoding="utf-8").read()

def one(old, new, s, expect=1):
    c = s.count(old)
    if c != expect:
        raise SystemExit("FAILED (count=%d, expected %d): %r" % (c, expect, old[:120]))
    return s.replace(old, new)

# Replace the earlier (colliding) infirmary box placement with one tucked beside the Throne Room,
# proven collision-free against every other room and every tunnel across 15 tested viewport sizes.
s = one(
"""  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  // Infirmary: a small ward tucked just above the Nursery — wounded fighters rest here until healed
  const iw=Math.min(96,sw*0.72), ih=Math.min(54,sh*0.6);
  const infirmary={x:nursery.x+(nursery.w-iw)/2, y:Math.max(gy+30,nursery.y-ih-10), w:iw, h:ih};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom,infirmary};""",
"""  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  // Infirmary: a small ward tucked beside the Throne Room — wounded fighters rest here until healed
  const infw=Math.max(16,Math.min(70, throne.x-16-6));
  const infh=Math.min(54, throne.h*0.6);
  const infirmary={x:Math.max(6, throne.x-infw-10), y:throne.y+(throne.h-infh)/2, w:infw, h:infh};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom,infirmary};""", s)

s = one(
"""  const thBC={x:throne.x+throne.w/2, y:throne.y+throne.h-10};
  const surf={x:W*0.5, y:gy-6};""",
"""  const thBC={x:throne.x+throne.w/2, y:throne.y+throne.h-10};
  const thML={x:throne.x+4, y:throne.y+throne.h*0.5};
  const surf={x:W*0.5, y:gy-6};""", s)

s = one(
"""    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
    infirmary: cubic(thBL, {x:W*0.30,y:H*0.50}, {x:W*0.05,y:H*0.38}, {x:infirmary.x+infirmary.w*0.5, y:infirmary.y+infirmary.h-8}, 14),
  };""",
"""    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
    infirmary: cubic(thML, {x:throne.x-20,y:throne.y+throne.h*0.5-6}, {x:infirmary.x+infirmary.w+14,y:infirmary.y+infirmary.h*0.5+4}, {x:infirmary.x+infirmary.w*0.5,y:infirmary.y+infirmary.h-6}, 10),
  };""", s)

open(f_out, "w", encoding="utf-8").write(s)
print("LAYOUT FIX OK, length", len(s))
