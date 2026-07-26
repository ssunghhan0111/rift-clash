f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """  bomber:  {name:'Bomber',  emoji:'💣', color:'#7a3fb5', combat:true, hatchT:38, minLvl:12,
            hp:30, dmg:32, armor:0, shield:6, food:30, crystal:20,
            blurb:'Elite siege ant. Huge damage, very costly to raise.'},"""

new = """  bomber:  {name:'Bomber',  emoji:'💣', color:'#7a3fb5', combat:true, hatchT:38, minLvl:12,
            hp:30, dmg:32, armor:0, shield:6, food:30, crystal:20, suicide:true, splash:true,
            blurb:'Kamikaze siege ant — detonates on impact for a huge blast, then is gone. One shot, big boom.'},"""

assert s.count(old) == 1
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("editb1 OK")
