"""
add_uncovered_linework.py — Add every DXF line with no network pipe under it.

1. Classify each DXF segment as covered / uncovered (midpoint within BUF of an
   existing network pipe centreline).
2. Chain the uncovered segments (per layer) into runs.
3. Resolve each run end to: nearest real manhole (<=MH_TOL), else an existing/new
   dummy node (coincident free ends share one dummy).
4. Add each run as a pipe  end1 -> end2  (diameter_source 'dxf_linework_added'),
   carrying the DXF path for bent runs. Self-loops and exact duplicate MH pairs
   are skipped.

Run with --write to apply (a timestamped backup is made). Dry run otherwise.
"""
import json, math, sys, shutil, datetime
from collections import defaultdict

NET, DXF = "data/network.json", "data/dxf_overlay.json"
WRITE = "--write" in sys.argv

BUF      = 1.5   # DXF point 'covered' if within this of a network centreline
MH_TOL   = 2.5   # run end snaps to a real manhole within this
DUP_TOL  = 2.0   # run end reuses an existing/created dummy within this
MERGE_TOL = 0.5  # coincident free ends share one new dummy
MIN_LEN  = 1.5   # ignore shorter fragments (chamber ticks / symbol noise)
DIA = {"Sewer": 160.0, "Stormwater": 300.0, "Water": 160.0, "Unknown": 160.0}

net = json.load(open(NET)); dxf = json.load(open(DXF))
mh = {m["id"]: m for m in net["manholes"]}
reals = [(i, m["x"], m["y"], m["type"]) for i, m in mh.items() if not i.startswith("DUMMY")]

# ── network centreline segments + grid index ──────────────────────────────
segs = []
for p in net["pipes"]:
    A, B = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not A or not B: continue
    pts = [(xy[0], xy[1]) for xy in p["path"]] if (p.get("path") and len(p["path"]) >= 2) \
          else [(A["x"], A["y"]), (B["x"], B["y"])]
    for i in range(len(pts) - 1): segs.append((pts[i], pts[i + 1]))
CELL = 5.0
grid = defaultdict(list)
def cells(a, b):
    for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
        for cy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
            yield (cx, cy)
for idx, (a, b) in enumerate(segs):
    for c in cells(a, b): grid[c].append(idx)
def ptseg(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))
def covered(px, py):
    cx, cy = int(px // CELL), int(py // CELL)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for idx in grid.get((cx + dx, cy + dy), ()):
                if ptseg(px, py, *segs[idx]) <= BUF: return True
    return False

# ── chain helpers ─────────────────────────────────────────────────────────
SNAP = 0.05
def k(x, y): return (round(x / SNAP), round(y / SNAP))
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def plen(pts): return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
def chain(seglist):
    adj = defaultdict(list)
    for i, s in enumerate(seglist):
        adj[k(*s[0])].append((i, s[1])); adj[k(*s[1])].append((i, s[0]))
    used, out = set(), []
    for i, s in enumerate(seglist):
        if i in used: continue
        ch = [s[0], s[1]]; used.add(i)
        while True:
            nx = [(j, p) for j, p in adj[k(*ch[-1])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.append(p)
        while True:
            nx = [(j, p) for j, p in adj[k(*ch[0])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.insert(0, p)
        out.append(ch)
    return out

def nearest_real(x, y, t):
    best = (None, 1e9)
    for i, rx, ry, rt in reals:
        if rt != t: continue
        d = math.hypot(x - rx, y - ry)
        if d < best[1]: best = (i, d)
    return best

# ── build runs and resolve endpoints ──────────────────────────────────────
maxn = max((int(p["id"][1:]) for p in net["pipes"] if p["id"][1:].isdigit()), default=0)
maxd = max((int(m["id"].split("_")[1]) for m in net["manholes"]
            if m["id"].startswith("DUMMY_") and m["id"].split("_")[1].isdigit()), default=0)
existing_pairs = {frozenset((p["from_mh"], p["to_mh"])) for p in net["pipes"]}
created = []          # (x, y, id) created dummies, for sharing
created_nodes = {}    # id -> node dict (only those referenced by a kept pipe are emitted)
existing_dummies = [(m["x"], m["y"], i) for i, m in mh.items() if i.startswith("DUMMY")]

def resolve_end(x, y, t):
    global maxd
    rid, rd = nearest_real(x, y, t)
    if rid and rd <= MH_TOL: return rid
    for dx, dy, did in existing_dummies:
        if math.hypot(x - dx, y - dy) <= DUP_TOL: return did
    for cx, cy, cid in created:
        if math.hypot(x - cx, y - cy) <= MERGE_TOL: return cid
    maxd += 1; did = f"DUMMY_{maxd:03d}"
    rr, _ = nearest_real(x, y, t)
    cov = mh[rr]["cover_elev"] if rr else net["metadata"].get("basemap_elev", 1546.83)
    created_nodes[did] = {"id": did, "name": did, "type": t, "x": round(x, 3),
                          "y": round(y, 3), "cover_elev": cov, "depth": 0.0,
                          "diameter": 1.0, "images": [], "parent_mh": rr}
    created.append((x, y, did)); mh[did] = created_nodes[did]
    return did

new_pipes, used_dummies = [], set()
skipped_short = skipped_loop = skipped_dup = 0
for grp in ["Sewer", "Stormwater", "Water", "Unknown"]:
    unc = []
    for s in dxf["groups"][grp]:
        a, b = (s[0], s[1]), (s[2], s[3])
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if not covered(mx, my): unc.append((a, b))
    for run in chain(unc):
        L = plen(run)
        if L < MIN_LEN: skipped_short += 1; continue
        n1 = resolve_end(run[0][0], run[0][1], grp)
        n2 = resolve_end(run[-1][0], run[-1][1], grp)
        if n1 == n2: skipped_loop += 1; continue
        if frozenset((n1, n2)) in existing_pairs: skipped_dup += 1; continue
        existing_pairs.add(frozenset((n1, n2)))
        for nid in (n1, n2):
            if nid in created_nodes: used_dummies.add(nid)
        def depth_of(nid):
            m = mh.get(nid); return (m.get("depth", 0.0) or 0.0) if m and not nid.startswith("DUMMY") else 0.0
        maxn += 1
        pipe = {"id": f"P{maxn:03d}", "from_mh": n1, "to_mh": n2,
                "from_depth": depth_of(n1), "to_depth": depth_of(n2),
                "diameter_mm": DIA.get(grp, 160.0), "diameter_source": "dxf_linework_added", "type": grp}
        if len(run) > 2:
            pipe["path"] = [[round(x, 3), round(y, 3)] for (x, y) in run]
        new_pipes.append(pipe)

new_nodes = [created_nodes[i] for i in created_nodes if i in used_dummies]

# ── report ────────────────────────────────────────────────────────────────
byt = defaultdict(int)
for p in new_pipes: byt[p["type"]] += 1
ends = defaultdict(int)
for p in new_pipes:
    a = "MH" if not p["from_mh"].startswith("DUMMY") else "dum"
    b = "MH" if not p["to_mh"].startswith("DUMMY") else "dum"
    ends["-".join(sorted([a, b]))] += 1
print(f"New pipes        : {len(new_pipes)}   by type {dict(byt)}")
print(f"New dummy nodes  : {len(new_nodes)}")
print(f"Endpoint kinds   : {dict(ends)}  (MH-MH / MH-dum / dum-dum)")
print(f"Skipped          : {skipped_short} short(<{MIN_LEN}m), {skipped_loop} self-loops, {skipped_dup} dup-pairs")
tl = sum(plen([(xy[0], xy[1]) for xy in p['path']]) if p.get('path')
         else dist((mh[p['from_mh']]['x'], mh[p['from_mh']]['y']), (mh[p['to_mh']]['x'], mh[p['to_mh']]['y']))
         for p in new_pipes)
print(f"Total new length : {tl:.0f} m")

if WRITE:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{NET}.bak_linework_{stamp}.json"
    shutil.copyfile(NET, bak)
    net["manholes"].extend(new_nodes); net["pipes"].extend(new_pipes)
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET}  (backup {bak})")
    print(f"Totals now: {len(net['manholes'])} manholes, {len(net['pipes'])} pipes")
else:
    print("\nDRY RUN — re-run with --write to apply.")
