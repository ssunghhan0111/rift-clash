f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """      } else {
        u.atkT=0.3;
        if(u.flying){
          stingFx.push({x:target.x,y:target.y-4,life:0.28,total:0.28});
          if(u.splash){ // monarch dive-bomb splashes the pack
            opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<40)
                .forEach(o=>dealDamage(o,Math.max(1,dealt*0.5),1));
            ringFx.push({x:target.x,y:target.y,life:0.4,total:0.4});
          }
        } else {
          slashFx.push({x:target.x,y:target.y,ang:Math.atan2(target.y-u.y,target.x-u.x),life:0.24,total:0.24});
          spawnMeleeFx(target.x,target.y);
        }
      }
      u.atkCd=1/u.atkSpd+(Math.random()*0.2-0.1);
    });
  };"""

new = """      } else {
        u.atkT=0.3;
        if(u.flying){
          stingFx.push({x:target.x,y:target.y-4,life:0.28,total:0.28});
          if(u.splash){ // monarch dive-bomb splashes the pack
            opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<40)
                .forEach(o=>dealDamage(o,Math.max(1,dealt*0.5),1));
            ringFx.push({x:target.x,y:target.y,life:0.4,total:0.4});
          }
        } else if(u.suicide){
          // 💣 kamikaze detonation — huge blast to everything nearby the target
          opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<55)
              .forEach(o=>dealDamage(o,Math.max(1,dealt*0.6),1));
          ringFx.push({x:target.x,y:target.y,life:0.5,total:0.5});
          ringFx.push({x:u.x,y:u.y,life:0.4,total:0.4});
        } else {
          slashFx.push({x:target.x,y:target.y,ang:Math.atan2(target.y-u.y,target.x-u.x),life:0.24,total:0.24});
          spawnMeleeFx(target.x,target.y);
        }
      }
      if(u.suicide&&u.alive){
        // the Bomber never survives its own explosion
        u.hp=0; u.alive=false; u.deathT=0.5; u.flashT=0.25;
        spawnKillFx(u.x,u.y,u.side);
        bpLog('💥 A Bomber detonates in a blast of shrapnel!',u.side==='me'?'good':'hit');
      }
      u.atkCd=1/u.atkSpd+(Math.random()*0.2-0.1);
    });
  };"""

assert s.count(old) == 1
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("editb2 OK")
