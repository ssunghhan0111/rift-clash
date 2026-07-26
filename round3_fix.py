f_in = "antopia_v28.html"
f_out = "antopia_v29.html"
s = open(f_in, encoding="utf-8").read()

def one(old, new, s, expect=1):
    c = s.count(old)
    if c != expect:
        raise SystemExit("FAILED (count=%d, expected %d): %r" % (c, expect, old[:100]))
    return s.replace(old, new)

# 1) global battle animation clock
s = one(
"function battleRender(dt){\n  if(!bcv||!B||B.phase!=='fight') return;\n  combatStep(dt);",
"let battleAnimT=0;\nfunction battleRender(dt){\n  if(!bcv||!B||B.phase!=='fight') return;\n  battleAnimT+=dt;\n  combatStep(dt);",
s)

# 2) init a per-unit random phase alongside _bobT
s = one(
"  u._bobT=(u._bobT||Math.random()*6.28)+dt*(u.flying?4:0);",
"  u._bobT=(u._bobT||Math.random()*6.28)+dt*(u.flying?4:0);\n  u._wob=u._wob||Math.random()*6.28;",
s)

# 3) fix the frozen-for-ground-units ambient animation (was keyed off u._bobT, which only
#    advances for flying units) — drive it off the global battle clock + a per-unit phase instead
s = one("const ang=u._bobT*4+i*2.1;", "const ang=(battleAnimT+u._wob)*4+i*2.1;", s)
s = one("bctx.globalAlpha=0.5+Math.sin(u._bobT*7+i)*0.35;", "bctx.globalAlpha=0.5+Math.sin((battleAnimT+u._wob)*7+i)*0.35;", s)
s = one("const hp=0.25+((Math.sin(u._bobT*2)+1)/2)*0.35;", "const hp=0.25+((Math.sin((battleAnimT+u._wob)*2)+1)/2)*0.35;", s)
s = one("bctx.beginPath(); bctx.arc(0,0,15+Math.sin(u._bobT*2)*1.5,0,6.28); bctx.stroke();",
        "bctx.beginPath(); bctx.arc(0,0,15+Math.sin((battleAnimT+u._wob)*2)*1.5,0,6.28); bctx.stroke();", s)
s = one("bctx.beginPath(); bctx.arc(-12,10,3+Math.sin(u._bobT*6)*1,0,6.28); bctx.fill();",
        "bctx.beginPath(); bctx.arc(-12,10,3+Math.sin((battleAnimT+u._wob)*6)*1,0,6.28); bctx.fill();", s)
s = one("const wf=Math.sin(u._bobT*(u.type==='wasp'?24:12));",
        "const wf=Math.sin((battleAnimT+u._wob)*(u.type==='wasp'?24:12));", s)

# 4) drawBattleAntBody should use the global clock, not a nonexistent local `t`
s = one("function drawBattleAntBody(u,t){", "function drawBattleAntBody(u){\n  const t=battleAnimT;", s)
s = one("drawBattleAntBody(u,t);", "drawBattleAntBody(u);", s)

open(f_out, "w", encoding="utf-8").write(s)
print("FIX OK, length", len(s))
