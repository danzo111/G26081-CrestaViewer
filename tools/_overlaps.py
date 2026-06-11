import json, math
NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
net = json.load(open(NET)); M = {m["id"]: m for m in net["manholes"]}
def seg(p):
    a, b = M.get(p["from_mh"]), M.get(p["to_mh"])
    return ((a["x"],a["y"]),(b["x"],b["y"])) if a and b else None
def overlap(N, E):
    (n1,n2),(e1,e2)=N,E
    ex,ey=e2[0]-e1[0],e2[1]-e1[1]; nx,ny=n2[0]-n1[0],n2[1]-n1[1]
    el2=ex*ex+ey*ey; nl=math.hypot(nx,ny); el=math.sqrt(el2) if el2 else 0
    if el==0 or nl==0: return 0
    if abs((ex*nx+ey*ny)/(el*nl))<math.cos(math.radians(15)): return 0
    def pr(pt):
        t=((pt[0]-e1[0])*ex+(pt[1]-e1[1])*ey)/el2
        return t, math.hypot(pt[0]-(e1[0]+t*ex), pt[1]-(e1[1]+t*ey))
    t1,d1=pr(n1); t2,d2=pr(n2)
    if d1>1.0 or d2>1.0: return 0
    lo,hi=max(0.0,min(t1,t2)),min(1.0,max(t1,t2))
    return max(0.0,hi-lo)*el/nl
P = {p["id"]: p for p in net["pipes"]}
geos = [(p["id"], seg(p)) for p in net["pipes"]]
geos = [(i, g) for i, g in geos if g]
print("=== ALL GEOM OVERLAPS >=60% ===")
for i in range(len(geos)):
    for j in range(i+1, len(geos)):
        ia, ga = geos[i]; ib, gb = geos[j]
        f = overlap(ga, gb)
        if f >= 0.6:
            pa, pb = P[ia], P[ib]
            sa = pa.get("diameter_source") or "-"
            sb = pb.get("diameter_source") or "-"
            print(f"  {ia}({pa['from_mh']}->{pa['to_mh']},{sa}) ~ "
                  f"{ib}({pb['from_mh']}->{pb['to_mh']},{sb}) {int(f*100)}%")
