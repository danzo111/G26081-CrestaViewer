"""
add_dxf_stubs.py — Add DXF spur stubs that are missing from network.json.

A spur = a chained DXF polyline with exactly one end on a real manhole and the
other end NOT on any real manhole (a dangling/unrecorded far end). We add only
spurs that are NOT already represented by an existing dummy stub.

Each added spur becomes:
  - a DUMMY node at the far end (parent_mh = the anchor manhole)
  - a pipe  anchor_mh -> dummy   (diameter_source = 'dxf_stub_added')
Spurs whose far ends coincide (<=0.5 m) share ONE dummy node (a real junction).

Run with --write to apply (a .bak_stubs backup is made). Dry run otherwise.
"""
import json, math, sys, shutil, datetime
from collections import defaultdict

HERE = "data/network.json"
DXF  = "data/dxf_overlay.json"
WRITE = "--write" in sys.argv

MH_TOL   = 2.5   # an endpoint sits ON a real manhole within this distance
FREE_TOL = 3.0   # far end must be clear of any real manhole by this much
DUP_TOL  = 3.0   # spur already represented if an existing dummy is this close
MERGE_TOL = 0.5  # far ends closer than this share one dummy node
MIN_LEN  = 2.0   # ignore tiny chamber ticks

DIA_BY_TYPE = {"Sewer": 160.0, "Stormwater": 300.0, "Water": 160.0, "Unknown": 160.0}

net = json.load(open(HERE))
dxf = json.load(open(DXF))
mh = {m["id"]: m for m in net["manholes"]}
reals  = [(i, m["x"], m["y"]) for i, m in mh.items() if not i.startswith("DUMMY")]
dummies = [(i, m["x"], m["y"]) for i, m in mh.items() if i.startswith("DUMMY")]

SNAP = 0.05
def k(x, y): return (round(x / SNAP), round(y / SNAP))
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def plen(pts): return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

def chain(segs):
    adj = defaultdict(list)
    for i, s in enumerate(segs):
        adj[k(s[0], s[1])].append((i, (s[2], s[3])))
        adj[k(s[2], s[3])].append((i, (s[0], s[1])))
    used, polys = set(), []
    for i, s in enumerate(segs):
        if i in used: continue
        ch = [(s[0], s[1]), (s[2], s[3])]; used.add(i)
        while True:
            nx = [(j, p) for j, p in adj[k(*ch[-1])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.append(p)
        while True:
            nx = [(j, p) for j, p in adj[k(*ch[0])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.insert(0, p)
        polys.append(ch)
    return polys

def nearest(lst, x, y):
    best = (None, 1e9)
    for i, rx, ry in lst:
        d = math.hypot(x - rx, y - ry)
        if d < best[1]: best = (i, d)
    return best

# ── Detect the spurs to add ───────────────────────────────────────────────
spurs = []
for grp in ["Sewer", "Stormwater", "Water", "Unknown"]:
    for poly in chain(dxf["groups"][grp]):
        L = plen(poly)
        if L < MIN_LEN: continue
        s, e = poly[0], poly[-1]
        rs, ds = nearest(reals, *s); re_, de = nearest(reals, *e)
        if (ds <= MH_TOL) == (de <= MH_TOL): continue          # need exactly one end on a MH
        anchor   = rs if ds <= MH_TOL else re_
        free_xy  = e  if ds <= MH_TOL else s
        path     = poly if ds <= MH_TOL else poly[::-1]        # orient anchor -> free
        _, dfree = nearest(reals, *free_xy)
        if dfree <= FREE_TOL: continue                          # far end actually reaches a MH
        if dummies:
            _, ddum = nearest(dummies, *free_xy)
            if ddum <= DUP_TOL: continue                        # already represented
        spurs.append({"grp": grp, "anchor": anchor, "len": L, "free": free_xy, "path": path})

# ── Merge coincident far ends into shared dummies ─────────────────────────
clusters = []   # list of {free_xy, members:[spur,...]}
for sp in spurs:
    for c in clusters:
        if dist(c["free"], sp["free"]) <= MERGE_TOL:
            c["members"].append(sp); break
    else:
        clusters.append({"free": sp["free"], "members": [sp]})

# ── Build new nodes + pipes ───────────────────────────────────────────────
maxn = max((int(p["id"][1:]) for p in net["pipes"] if p["id"][1:].isdigit()), default=0)
maxd = max((int(m["id"].split("_")[1]) for m in net["manholes"]
            if m["id"].startswith("DUMMY_") and m["id"].split("_")[1].isdigit()), default=0)

new_nodes, new_pipes = [], []
for c in clusters:
    maxd += 1
    did = f"DUMMY_{maxd:03d}"
    # node type / anchor reference from the first member
    grp0 = c["members"][0]["grp"]
    anc0 = c["members"][0]["anchor"]
    am0 = mh[anc0]
    new_nodes.append({
        "id": did, "name": did, "type": grp0,
        "x": round(c["free"][0], 3), "y": round(c["free"][1], 3),
        "cover_elev": am0["cover_elev"], "depth": 0.0, "diameter": 1.0,
        "images": [], "parent_mh": anc0,
    })
    for sp in c["members"]:
        maxn += 1
        anc = sp["anchor"]; am = mh[anc]
        depth = am.get("depth", 0.0) or 0.0
        pipe = {
            "id": f"P{maxn:03d}", "from_mh": anc, "to_mh": did,
            "from_depth": depth, "to_depth": depth,
            "diameter_mm": DIA_BY_TYPE.get(sp["grp"], 160.0),
            "diameter_source": "dxf_stub_added", "type": sp["grp"],
        }
        if len(sp["path"]) > 2:   # carry the DXF route for bent spurs
            pipe["path"] = [[round(x, 3), round(y, 3)] for (x, y) in sp["path"]]
        new_pipes.append(pipe)

# ── Report ────────────────────────────────────────────────────────────────
print(f"Spurs to add        : {len(spurs)}")
print(f"Shared-end clusters : {len(clusters)}  -> {len(new_nodes)} new dummy node(s)")
print(f"New pipes           : {len(new_pipes)}")
byt = defaultdict(int)
for p in new_pipes: byt[p["type"]] += 1
print(f"New pipes by type   : {dict(byt)}")
print(f"Pipe ids            : P{maxn - len(new_pipes) + 1:03d}..P{maxn:03d}")
print(f"Dummy ids           : DUMMY_{maxd - len(new_nodes) + 1:03d}..DUMMY_{maxd:03d}")
print()
for p in sorted(new_pipes, key=lambda x: x["from_mh"]):
    bent = f" path({len(p['path'])})" if p.get("path") else ""
    print(f"  {p['id']}  {p['from_mh']:10s} -> {p['to_mh']}  {p['type']:10s} d{p['diameter_mm']:.0f}{bent}")

if WRITE:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{HERE}.bak_stubs_{stamp}.json"
    shutil.copyfile(HERE, bak)
    net["manholes"].extend(new_nodes)
    net["pipes"].extend(new_pipes)
    json.dump(net, open(HERE, "w"), indent=2)
    print(f"\nWROTE {HERE}  (backup: {bak})")
    print(f"Totals now: {len(net['manholes'])} manholes, {len(net['pipes'])} pipes")
else:
    print("\nDRY RUN — re-run with --write to apply.")
