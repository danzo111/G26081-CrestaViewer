"""Comprehensive correctness audit of network.json. Read-only."""
import json, math
from collections import Counter, defaultdict

NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
net = json.load(open(NET))
M = {m["id"]: m for m in net["manholes"]}
pipes = net["pipes"]

def isd(mid):
    m = M.get(mid)
    return mid.startswith("DUMMY") or (m and m.get("type") == "Dummy")

reals = [m for m in net["manholes"] if not isd(m["id"])]
dums = [m for m in net["manholes"] if isd(m["id"])]

print("="*72)
print("0. INVENTORY")
print(f"   manholes: {len(net['manholes'])} ({len(reals)} real, {len(dums)} dummy)")
print(f"   real by type: {dict(Counter(m.get('type') for m in reals))}")
print(f"   pipes: {len(pipes)}, by type field: {dict(Counter(p.get('type','(none)') for p in pipes))}")
print(f"   diameter coverage: {sum(1 for p in pipes if p.get('diameter_mm'))}/{len(pipes)}")

issues = defaultdict(list)

# 1. referential integrity
for p in pipes:
    for k in ("from_mh", "to_mh"):
        if p.get(k) not in M:
            issues["MISSING_ENDPOINT"].append(f"{p['id']}: {k}={p.get(k)}")

# 2. duplicate manhole ids / pipe ids
mhc = Counter(m["id"] for m in net["manholes"])
for k, v in mhc.items():
    if v > 1: issues["DUP_MH_ID"].append(f"{k} x{v}")
pc = Counter(p["id"] for p in pipes)
for k, v in pc.items():
    if v > 1: issues["DUP_PIPE_ID"].append(f"{k} x{v}")

# 3. self-loops & duplicate pairs
pair_seen = defaultdict(list)
for p in pipes:
    if p["from_mh"] == p["to_mh"]:
        issues["SELF_LOOP"].append(f"{p['id']}: {p['from_mh']}")
    else:
        pair_seen[frozenset((p["from_mh"], p["to_mh"]))].append(p["id"])
for pair, ids in pair_seen.items():
    if len(ids) > 1:
        issues["DUP_PAIR"].append(f"{'/'.join(sorted(pair))}: {ids}")

# 4. manhole field sanity
for m in net["manholes"]:
    c, d = m.get("cover_elev"), m.get("depth")
    if c is None:
        issues["NO_COVER"].append(m["id"])
    elif not (1500 < c < 1620):
        issues["COVER_RANGE"].append(f"{m['id']}: {c}")
    if d is None:
        issues["NO_DEPTH"].append(m["id"])
    elif d < 0:
        issues["NEG_DEPTH"].append(f"{m['id']}: {d}")
    elif d > 6:
        issues["VERY_DEEP"].append(f"{m['id']}: {d}m")
    if m.get("x") is None or m.get("y") is None:
        issues["NO_XY"].append(m["id"])

# 5. coordinate outliers (vs bbox of reals)
xs = [m["x"] for m in reals]; ys = [m["y"] for m in reals]
x0,x1,y0,y1 = min(xs),max(xs),min(ys),max(ys)
for m in net["manholes"]:
    if not (x0-200 <= m["x"] <= x1+200 and y0-200 <= m["y"] <= y1+200):
        issues["COORD_OUTLIER"].append(f"{m['id']}: ({m['x']},{m['y']})")

# 6. connectivity
deg = defaultdict(int)
for p in pipes:
    deg[p["from_mh"]] += 1; deg[p["to_mh"]] += 1
iso_real = [m["id"] for m in reals if deg[m["id"]] == 0]
iso_dum = [m["id"] for m in dums if deg[m["id"]] == 0]
issues["ISOLATED_REAL"] = iso_real
issues["ISOLATED_DUMMY"] = iso_dum

# 7. hydraulics: uphill on real-real, no override, no dummy touch
def inv(mid, dep):
    m = M.get(mid)
    if not m or m.get("cover_elev") is None: return None
    return m["cover_elev"] - (dep or 0)
for p in pipes:
    f, t = p["from_mh"], p["to_mh"]
    if f not in M or t not in M or f == t: continue
    if isd(f) or isd(t) or p.get("flow_override"): continue
    fi, ti = inv(f, p.get("from_depth")), inv(t, p.get("to_depth"))
    if fi is None or ti is None: continue
    if ti > fi + 0.005:
        issues["UPHILL"].append(f"{p['id']}: {f}->{t} rises {ti-fi:.3f}m")
    if ti > fi + 3.0 or fi - ti > 6.0:
        issues["EXTREME_GRADE"].append(f"{p['id']}: {f}->{t} drop {fi-ti:+.2f}m")

# 8. invert mismatch at real manholes with known depth
for p in pipes:
    for end, mid, dk in (("from", p["from_mh"], "from_depth"), ("to", p["to_mh"], "to_depth")):
        m = M.get(mid)
        if not m or isd(mid): continue
        md = m.get("depth")
        if not md or md <= 0: continue
        pd = p.get(dk)
        if pd is None: continue
        if abs(pd - md) > 0.015 and pd > 0:
            issues["INVERT_MISMATCH"].append(
                f"{p['id']} {end}@{mid}: pipe depth {pd} vs MH {md}")
        if pd == 0:
            issues["PIPE_DEPTH_ZERO_AT_KNOWN_MH"].append(f"{p['id']} {end}@{mid} (MH depth {md})")

# 9. residual geometric overlaps (collinear on-top)
def seg(p):
    a, b = M.get(p["from_mh"]), M.get(p["to_mh"])
    if not a or not b: return None
    return (a["x"], a["y"]), (b["x"], b["y"])
def overlap(N, E):
    (n1,n2),(e1,e2)=N,E
    ex,ey=e2[0]-e1[0],e2[1]-e1[1]; nx,ny=n2[0]-n1[0],n2[1]-n1[1]
    el2=ex*ex+ey*ey; nl=math.hypot(nx,ny); el=math.sqrt(el2) if el2 else 0
    if el==0 or nl==0: return 0
    if abs((ex*nx+ey*ny)/(el*nl)) < math.cos(math.radians(15)): return 0
    def pr(pt):
        t=((pt[0]-e1[0])*ex+(pt[1]-e1[1])*ey)/el2
        cx,cy=e1[0]+t*ex,e1[1]+t*ey
        return t, math.hypot(pt[0]-cx,pt[1]-cy)
    t1,d1=pr(n1); t2,d2=pr(n2)
    if d1>1.0 or d2>1.0: return 0
    lo,hi=max(0.0,min(t1,t2)),min(1.0,max(t1,t2))
    return max(0.0,(hi-lo))*el/nl
geos = [(p["id"], seg(p)) for p in pipes]
geos = [(i,g) for i,g in geos if g]
for i in range(len(geos)):
    for j in range(i+1, len(geos)):
        ia, ga = geos[i]; ib, gb = geos[j]
        f = overlap(ga, gb)
        if f >= 0.6:
            issues["GEOM_OVERLAP"].append(f"{ia} ~ {ib} ({int(f*100)}%)")

# 10. dummies coincident with a real manhole (should be merged)
for d in dums:
    for r in reals:
        if math.hypot(d["x"]-r["x"], d["y"]-r["y"]) <= 0.2:
            issues["DUMMY_ON_REAL"].append(f"{d['id']} on {r['id']}")
            break

# 11. type sanity: Water pipes endpoints, pipe type field values
for p in pipes:
    t = p.get("type")
    if t and t not in ("Sewer", "Stormwater", "Water"):
        issues["BAD_PIPE_TYPE"].append(f"{p['id']}: {t}")
for m in net["manholes"]:
    if m.get("type") not in ("Sewer","Stormwater","Dummy","Water","Unknown"):
        issues["BAD_MH_TYPE"].append(f"{m['id']}: {m.get('type')}")

# 12. flow_override inventory
ovr = [p["id"] for p in pipes if p.get("flow_override")]
print(f"   flow_override pipes: {ovr}")

print("="*72)
order = ["MISSING_ENDPOINT","DUP_MH_ID","DUP_PIPE_ID","SELF_LOOP","DUP_PAIR",
         "NO_COVER","COVER_RANGE","NO_DEPTH","NEG_DEPTH","VERY_DEEP","NO_XY",
         "COORD_OUTLIER","UPHILL","EXTREME_GRADE","INVERT_MISMATCH",
         "PIPE_DEPTH_ZERO_AT_KNOWN_MH","GEOM_OVERLAP","DUMMY_ON_REAL",
         "BAD_PIPE_TYPE","BAD_MH_TYPE","ISOLATED_REAL","ISOLATED_DUMMY"]
for k in order:
    v = issues.get(k, [])
    flag = "OK " if not v else f"{len(v):3}"
    print(f"[{flag}] {k}")
    if v and len(v) <= 12:
        for x in v: print(f"        {x}")
    elif v:
        for x in v[:8]: print(f"        {x}")
        print(f"        ... +{len(v)-8} more")
