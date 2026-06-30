"""
audit_stubs.py — Audit every DXF run that connects to a real manhole and make
sure it has a network pipe. Runs are broken at junctions AND at manholes, so
each run is a single manhole-to-something segment.

A run touching a real manhole is classified:
  REPRESENTED  - a network pipe already covers this pair             -> skip
  PARALLEL     - duplicates an existing pipe's wall (same direction) -> skip
  MISSING STUB - genuine stub with no pipe                           -> ADD

Dry run by default; --write applies (timestamped backup).
"""
import json, math, sys, shutil, datetime
from collections import defaultdict

NET, DXF = "data/network.json", "data/dxf_overlay.json"
WRITE = "--write" in sys.argv
MH_TOL, DUP_TOL, MERGE_TOL, MIN_LEN = 2.5, 2.0, 0.5, 0.8
PARALLEL_DEG, PARALLEL_COV = 25.0, 0.6
DIA = {"Sewer": 160.0, "Stormwater": 300.0, "Water": 160.0, "Unknown": 160.0}

net = json.load(open(NET)); dxf = json.load(open(DXF))
mh = {m["id"]: m for m in net["manholes"]}
reals = [(i, m["x"], m["y"], m["type"]) for i, m in mh.items() if not i.startswith("DUMMY")]

GS = 0.30
def gk(x, y): return (round(x / GS), round(y / GS))
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

# existing network pipe directions at each manhole + pair set
def pipe_pts(p):
    A, B = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not A or not B: return None
    if p.get("path") and len(p["path"]) >= 2: return [(xy[0], xy[1]) for xy in p["path"]]
    return [(A["x"], A["y"]), (B["x"], B["y"])]
existing_pairs = {frozenset((p["from_mh"], p["to_mh"])) for p in net["pipes"]}
mh_pipe_dirs = defaultdict(list)
net_segs = []
for p in net["pipes"]:
    pts = pipe_pts(p)
    if not pts: continue
    for i in range(len(pts) - 1): net_segs.append((pts[i], pts[i + 1]))
    for end, nxt in ((p["from_mh"], pts[1]), (p["to_mh"], pts[-2])):
        m = mh.get(end)
        if m and not end.startswith("DUMMY"):
            v = (nxt[0] - m["x"], nxt[1] - m["y"]); L = math.hypot(*v)
            if L > 0.3: mh_pipe_dirs[end].append((v[0] / L, v[1] / L))

# net-seg grid + per-seg unit direction for collinear-coverage test
CELL = 5.0; ngrid = defaultdict(list); nseg_dir = []
for (a, b) in net_segs:
    v = (b[0]-a[0], b[1]-a[1]); L = math.hypot(*v)
    nseg_dir.append((v[0]/L, v[1]/L) if L else (0.0, 0.0))
for idx, (a, b) in enumerate(net_segs):
    for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
        for cy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
            ngrid[(cx, cy)].append(idx)
def ptseg(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L2 = dx*dx+dy*dy
    t = 0 if L2 == 0 else max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L2))
    return math.hypot(px-(ax+t*dx), py-(ay+t*dy))
def near_net(px, py):
    cx, cy = int(px//CELL), int(py//CELL); best = 1e9
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for idx in ngrid.get((cx+dx, cy+dy), ()):
                d = ptseg(px, py, *net_segs[idx]); best = min(best, d)
    return best
def near_net_dir(px, py):
    """nearest net-seg distance + its unit direction (for collinearity)."""
    cx, cy = int(px//CELL), int(py//CELL); best = 1e9; bd = (0.0, 0.0)
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for idx in ngrid.get((cx+dx, cy+dy), ()):
                d = ptseg(px, py, *net_segs[idx])
                if d < best: best = d; bd = nseg_dir[idx]
    return best, bd
def collinear_cov(run):
    """fraction of run covered by an existing pipe running in the SAME direction
    (catches duplicate walls and sub-segments of path-pipes)."""
    tot = hit = 0
    for i in range(len(run)):
        a = run[i]; b = run[i+1] if i+1 < len(run) else run[i-1]
        rv = (b[0]-a[0], b[1]-a[1]); rl = math.hypot(*rv)
        if rl == 0: continue
        rv = (rv[0]/rl, rv[1]/rl); tot += 1
        d, sd = near_net_dir(a[0], a[1])
        if d <= 1.5 and abs(rv[0]*sd[0]+rv[1]*sd[1]) >= 0.9: hit += 1
    return hit/tot if tot else 0

def nearest_real(x, y, t):
    best = (None, 1e9)
    for i, rx, ry, rt in reals:
        if rt != t: continue
        d = math.hypot(x - rx, y - ry)
        if d < best[1]: best = (i, d)
    return best

created, created_nodes = [], {}
existing_dummies = [(m["x"], m["y"], i) for i, m in mh.items() if i.startswith("DUMMY")]
maxn = max((int(p["id"][1:]) for p in net["pipes"] if p["id"][1:].isdigit()), default=0)
maxd = max((int(m["id"].split("_")[1]) for m in net["manholes"]
            if m["id"].startswith("DUMMY_") and m["id"].split("_")[1].isdigit()), default=0)

def resolve(x, y, t):
    global maxd
    rid, rd = nearest_real(x, y, t)
    if rid and rd <= MH_TOL: return rid, True
    for dx, dy, did in existing_dummies:
        if math.hypot(x - dx, y - dy) <= DUP_TOL: return did, False
    for cx, cy, cid in created:
        if math.hypot(x - cx, y - cy) <= MERGE_TOL: return cid, False
    maxd += 1; did = f"DUMMY_{maxd:03d}"
    rr, _ = nearest_real(x, y, t)
    cov = mh[rr]["cover_elev"] if rr else net["metadata"].get("basemap_elev", 1546.83)
    created_nodes[did] = {"id": did, "name": did, "type": t, "x": round(x, 3), "y": round(y, 3),
                          "cover_elev": cov, "depth": 0.0, "diameter": 1.0, "images": [], "parent_mh": rr}
    created.append((x, y, did)); mh[did] = created_nodes[did]
    return did, False

# build runs per type, broken at junctions and manhole-nodes
def runs_for(grp):
    segs = dxf["groups"][grp]
    adj = defaultdict(list); coord = {}
    for s in segs:
        a, b = gk(s[0], s[1]), gk(s[2], s[3])
        coord[a] = (s[0], s[1]); coord[b] = (s[2], s[3])
        if a != b: adj[a].append(b); adj[b].append(a)
    # break-nodes: degree != 2, or near a real manhole
    def is_mh_node(n):
        x, y = coord[n]; rid, rd = nearest_real(x, y, grp); return rid is not None and rd <= MH_TOL
    deg = {n: len(set(adj[n])) for n in adj}
    brk = {n for n in adj if deg[n] != 2 or is_mh_node(n)}
    runs = []; seen = set()
    for bn in brk:
        for nb in adj[bn]:
            ek = frozenset((bn, nb))
            path = [bn, nb]; prev, cur = bn, nb
            while cur not in brk:
                nxts = [x for x in adj[cur] if x != prev]
                if not nxts: break
                prev, cur = cur, nxts[0]; path.append(cur)
            key = frozenset((path[0], path[-1])) if path[0] != path[-1] else None
            sig = (path[0], path[-1], len(path))
            rk = (min(path[0], path[-1]), max(path[0], path[-1]), len(path))
            if rk in seen: continue
            seen.add(rk)
            runs.append([coord[n] for n in path])
    return runs

missing, parallel, represented = [], 0, 0
for grp in ["Sewer", "Stormwater", "Water", "Unknown"]:
    for run in runs_for(grp):
        L = sum(dist(run[i], run[i+1]) for i in range(len(run)-1))
        if L < MIN_LEN: continue
        e1, e2 = run[0], run[-1]
        r1, on1 = nearest_real(e1[0], e1[1], grp); r1ok = r1 and on1 <= MH_TOL
        r2, on2 = nearest_real(e2[0], e2[1], grp); r2ok = r2 and on2 <= MH_TOL
        if not (r1ok or r2ok): continue          # must touch a real manhole
        # which end is the manhole; direction of the run from it
        if r1ok: anchor, ax, ay, nxt = r1, e1[0], e1[1], run[1]
        else:    anchor, ax, ay, nxt = r2, e2[0], e2[1], run[-2]
        dv = (nxt[0]-ax, nxt[1]-ay); dl = math.hypot(*dv)
        if dl == 0: continue
        dvn = (dv[0]/dl, dv[1]/dl)
        # represented? resolve both ends and check pair
        n1, _ = resolve(e1[0], e1[1], grp); n2, _ = resolve(e2[0], e2[1], grp)
        if n1 == n2: continue
        if frozenset((n1, n2)) in existing_pairs:
            represented += 1; continue
        # already drawn? (duplicate pipe-wall OR sub-segment of a path-pipe that
        # merely passes near this manhole) -> the run lies ALONG an existing pipe
        if collinear_cov(run) >= 0.7:
            parallel += 1; continue
        # respect prior explicit removals (redundant shortcuts taken out earlier)
        if {n1, n2} in ({"SW111", "SW113"},):
            continue
        missing.append({"grp": grp, "anchor": anchor, "n1": n1, "n2": n2, "len": L, "run": run})

print(f"REPRESENTED (already a pipe) : {represented}")
print(f"PARALLEL (dup pipe wall)     : {parallel}")
print(f"MISSING STUBS (to add)       : {len(missing)}")
byt = defaultdict(int)
for m_ in missing: byt[m_["grp"]] += 1
print(f"  by type: {dict(byt)}")
ll = sorted(m_["len"] for m_ in missing)
if ll:
    print(f"  length: min {ll[0]:.1f}  median {ll[len(ll)//2]:.1f}  max {ll[-1]:.1f}")
    print(f"  <3m {sum(1 for l in ll if l<3)}  3-10m {sum(1 for l in ll if 3<=l<10)}  >=10m {sum(1 for l in ll if l>=10)}")
    print("  --- the 14 missing stubs ---")
    for m_ in sorted(missing, key=lambda x: -x["len"]):
        fd = "MH" if not m_["n1"].startswith("DUMMY") else "dum"
        td = "MH" if not m_["n2"].startswith("DUMMY") else "dum"
        print(f"    {m_['grp']:10s} {m_['n1']:11s}({fd})->{m_['n2']:11s}({td})  {m_['len']:5.1f}m  anchor={m_['anchor']}")

if WRITE:
    new_pipes, used = [], set()
    for m_ in missing:
        n1, n2 = m_["n1"], m_["n2"]
        if frozenset((n1, n2)) in existing_pairs:   # guard against duplicate pairs
            continue
        for nid in (n1, n2):
            if nid in created_nodes: used.add(nid)
        maxn += 1
        def depth_of(nid):
            mm = mh.get(nid); return (mm.get("depth", 0.0) or 0.0) if mm and not nid.startswith("DUMMY") else 0.0
        pipe = {"id": f"P{maxn:03d}", "from_mh": n1, "to_mh": n2, "from_depth": depth_of(n1),
                "to_depth": depth_of(n2), "diameter_mm": DIA.get(m_["grp"], 160.0),
                "diameter_source": "dxf_stub_audit", "type": m_["grp"]}
        if len(m_["run"]) > 2:
            pipe["path"] = [[round(x, 3), round(y, 3)] for (x, y) in m_["run"]]
        new_pipes.append(pipe); existing_pairs.add(frozenset((n1, n2)))
    new_nodes = [created_nodes[i] for i in created_nodes if i in used]
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{NET}.bak_stubaudit_{stamp}.json"; shutil.copyfile(NET, bak)
    net["manholes"].extend(new_nodes); net["pipes"].extend(new_pipes)
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nADDED {len(new_pipes)} pipes, {len(new_nodes)} dummy nodes. backup {bak}")
    print(f"Totals now: {len(net['manholes'])} manholes, {len(net['pipes'])} pipes")
else:
    print("\nDRY RUN — re-run with --write to apply.")
