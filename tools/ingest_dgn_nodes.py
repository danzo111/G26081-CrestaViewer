"""
Step 2: ingest the consolidated runs that reach NEW nodes (not in network.json).

Each unmatched run-endpoint becomes a DUMMY node, and the runs become pipes.
EXCEPTION (user rule): if a new node is just a 2-way pass-through (a continuous
pipe that only bends there), merge the two runs instead of creating a dummy.

Coordinate frame: csv = (-net.x, -net.y). z = pipe invert elevation.
Run with --write to apply (.backup.json made). Dry run otherwise.
"""
import csv, json, sys, math, shutil
from collections import defaultdict, Counter

CONS = r"D:\Daniel Njoroge Working folder\CRESTA\pipes_consolidated.csv"
NEWONLY = r"D:\Daniel Njoroge Working folder\CRESTA\line_endpoints_NEW_ONLY.csv"
NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
WRITE = "--write" in sys.argv
TOL = 0.5
MIN_LEN = 1.0
STRAIGHT_DEG = 0.0   # any degree-2 node is a continuous pipe bending through -> merge (no dummy)

net = json.load(open(NET))
mh = {m["id"]: m for m in net["manholes"]}
pipes = net["pipes"]
existing_pairs = {frozenset((p["from_mh"], p["to_mh"])) for p in pipes}

maxn = max((int(p["id"][1:]) for p in pipes if p["id"][1:].isdigit()), default=0)
maxd = max((int(m["id"].split("_")[1]) for m in net["manholes"]
            if m["id"].startswith("DUMMY_") and m["id"].split("_")[1].isdigit()), default=0)

# z lookup
zlut = {}
for r in csv.DictReader(open(NEWONLY)):
    for xk, yk, zk in (("S_x","S_y","S_z"), ("E_x","E_y","E_z")):
        try: z = float(r[zk])
        except (TypeError, ValueError): continue
        zlut[(round(float(r[xk]),1), round(float(r[yk]),1))] = z
def z_at(x, y): return zlut.get((round(x,1), round(y,1)))
def layer_type(l): return "Sewer" if "SEWER" in l.upper() else "Stormwater"

# ── read runs reaching >=1 new node ─────────────────────────────────────────
rows = [r for r in csv.DictReader(open(CONS)) if float(r["length_m"]) >= MIN_LEN]
runs = [r for r in rows if not (r["from_mh"] and r["to_mh"])]

# cluster the unmatched endpoints into new nodes
nodes = []   # representative csv (x,y)
def node_id(p):
    for i, n in enumerate(nodes):
        if math.hypot(p[0]-n[0], p[1]-n[1]) <= TOL:
            return i
    nodes.append(p); return len(nodes)-1

# terminal = ("mh", id) or ("node", cid).  store coord + z per terminal
def terminal(mid, x, y):
    if mid:
        return ("mh", mid, (x, y), None)
    cid = node_id((x, y))
    return ("node", cid, (x, y), z_at(x, y))

R = []   # list of dicts: A,B terminals, layer, length
for r in runs:
    A = terminal(r["from_mh"], float(r["from_x"]), float(r["from_y"]))
    B = terminal(r["to_mh"],   float(r["to_x"]),   float(r["to_y"]))
    R.append({"A": A, "B": B, "layer": r["layer"], "len": float(r["length_m"])})

# drop degenerate self-loop runs (same terminal both ends: DGN closed rings)
selfloops = [r for r in R if r["A"][0] == r["B"][0] and r["A"][1] == r["B"][1]]
R[:] = [r for r in R if not (r["A"][0] == r["B"][0] and r["A"][1] == r["B"][1])]
print(f"dropped self-loop runs (closed rings, not pipes): {len(selfloops)}")

# ── degree of each new node (count of run-ends attached) ─────────────────────
def node_ends():
    inc = defaultdict(list)
    for ri, run in enumerate(R):
        for end in ("A", "B"):
            t = run[end]
            if t[0] == "node":
                inc[t[1]].append((ri, end))
    return inc

inc = node_ends()
deg = {cid: len(v) for cid, v in inc.items()}
print(f"new-node clusters: {len(nodes)}")
print(f"  run-degree distribution: {dict(Counter(deg.values()))}")

# ── bend check: merge degree-2 pass-throughs (continuous pipe that bends) ────
def angle_at(cid):
    """interior angle (deg) of the two runs meeting at node cid."""
    (r1, e1), (r2, e2) = inc[cid][0], inc[cid][1]
    c = nodes[cid]
    def far(run, end):
        other = run["B"] if end == "A" else run["A"]
        return other[2]
    p1, p2 = far(R[r1], e1), far(R[r2], e2)
    v1 = (p1[0]-c[0], p1[1]-c[1]); v2 = (p2[0]-c[0], p2[1]-c[1])
    n1 = math.hypot(*v1); n2 = math.hypot(*v2)
    if n1 == 0 or n2 == 0: return 180.0
    cosv = max(-1, min(1, (v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2)))
    return math.degrees(math.acos(cosv))

merged = 0
changed = True
while changed:
    changed = False
    inc = node_ends()
    for cid, ends in inc.items():
        if len(ends) != 2:
            continue
        (r1, e1), (r2, e2) = ends
        if r1 == r2:
            continue
        ang = angle_at(cid)
        if ang < STRAIGHT_DEG:
            continue   # sharp corner that is a genuine junction-of-2? keep as bend->dummy below
        # merge r1,r2 into one run connecting their FAR ends (drop this node)
        o1 = R[r1]["B"] if e1 == "A" else R[r1]["A"]
        o2 = R[r2]["B"] if e2 == "A" else R[r2]["A"]
        if o1[0] == "node" and o2[0] == "node" and o1[1] == o2[1]:
            continue   # would be a loop
        R[r1] = {"A": o1, "B": o2, "layer": R[r1]["layer"],
                 "len": R[r1]["len"] + R[r2]["len"]}
        R[r2] = None
        R[:] = [x for x in R if x is not None]
        merged += 1
        changed = True
        break

print(f"  continuous-bend merges (no dummy created): {merged}")

# recompute node incidence after merges; nodes still referenced need dummies
inc = node_ends()
used_nodes = sorted(inc.keys())
print(f"  new nodes that will become DUMMY nodes: {len(used_nodes)}")
print(f"  pipes to create from these runs: {len(R)}")

# ── assign dummy ids + build manhole records ────────────────────────────────
dummy_id = {}
new_dummies = []
for k, cid in enumerate(used_nodes):
    did = f"DUMMY_{maxd + 1 + k:03d}"
    dummy_id[cid] = did
    cx, cy = nodes[cid]
    z = z_at(cx, cy)
    lay = R[inc[cid][0][0]]["layer"]
    cover = z if (z and z > 1000) else None
    if cover is None:
        # fall back to a nearby manhole cover if any within 30m
        best = min(((math.hypot(cx+mm["x"], cy+mm["y"]), mm["cover_elev"])
                    for mm in mh.values() if mm.get("cover_elev") is not None), default=(9e9, None))
        cover = best[1] if best[0] < 30 else (z or 0)
    new_dummies.append({
        "id": did, "name": did, "type": layer_type(lay),
        "x": round(-cx, 3), "y": round(-cy, 3),
        "cover_elev": round(cover, 3) if cover else 0.0, "depth": 0.0,
        "diameter": 1.0,
    })

def term_id(t):
    return t[1] if t[0] == "mh" else dummy_id[t[1]]

def invert_of(t):
    if t[0] == "mh":
        m = mh[t[1]]; return m["cover_elev"] - (m.get("depth") or 0)
    return t[3] if (t[3] and t[3] > 1000) else None   # node z

# ── build pipes ──────────────────────────────────────────────────────────────
new_pipes, skip_exist, skip_dup = [], 0, 0
seen = set()
for run in R:
    a, b = term_id(run["A"]), term_id(run["B"])
    if a == b:
        continue
    pair = frozenset((a, b))
    if pair in existing_pairs:
        skip_exist += 1; continue
    if pair in seen:
        skip_dup += 1; continue
    seen.add(pair)
    ia, ib = invert_of(run["A"]), invert_of(run["B"])
    fa, fb = run["A"], run["B"]
    if ia is not None and ib is not None and ib > ia:
        fa, fb, ia, ib = fb, fa, ib, ia   # orient downhill
    def depth_at(t, inv):
        if t[0] == "mh":
            m = mh[t[1]]; return m.get("depth") or 0.0
        return 0.0   # dummy: cover=z, depth 0 -> invert=z
    new_pipes.append({
        "id": None, "from_mh": term_id(fa), "to_mh": term_id(fb),
        "from_depth": depth_at(fa, ia), "to_depth": depth_at(fb, ib),
        "diameter_mm": None, "diameter_source": "dgn_unsized",
        "type": layer_type(run["layer"]),
    })

print(f"\nPIPES: create {len(new_pipes)}  (skip existing {skip_exist}, dup {skip_dup})")
print(f"DUMMIES: create {len(new_dummies)}")
print(f"  pipe types: {dict(Counter(p['type'] for p in new_pipes))}")

if WRITE:
    shutil.copy(NET, NET + ".backup.json")
    n = maxn
    for p in new_pipes:
        n += 1; p["id"] = f"P{n:03d}"
    net["manholes"].extend(new_dummies)
    net["pipes"].extend(new_pipes)
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET} (backup at {NET}.backup.json)")
    print(f"  manholes: {len(net['manholes'])}  pipes: {len(net['pipes'])}")
else:
    print("\n[DRY RUN] re-run with --write to apply.")
