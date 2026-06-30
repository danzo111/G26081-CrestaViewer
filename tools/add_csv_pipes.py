"""
add_csv_pipes.py — Import pipes from the two CSV exports.
  NEW SE PIPES.csv            -> Sewer       (layer label is mislabeled)
  NEW SW PIPES TO ADD.csv     -> Stormwater
CSV coords are negated network coords (net = -csv). Segments sharing endpoints
(<=0.5 m) are chained into runs. Each run's ends resolve to a real manhole
(<=3 m); if both ends snap to the SAME manhole the farther end becomes a dummy
(so the short ones become MH->dummy stubs, not self-loops). Free ends -> dummies
(shared when coincident). Dry run unless --write.
"""
import csv, math, json, sys, shutil, datetime
from collections import defaultdict

NET = "data/network.json"
FILES = [("Sewer", r"C:\Users\mrdan\Downloads\NEW SE PIPES.csv", 160.0),
         ("Stormwater", r"C:\Users\mrdan\Downloads\NEW SW PIPES TO ADD.csv", 300.0)]
WRITE = "--write" in sys.argv
SNAP, DUP_TOL, MERGE_TOL = 3.0, 2.0, 0.5

net = json.load(open(NET))
mh = {m["id"]: m for m in net["manholes"]}
reals = [(i, m["x"], m["y"]) for i, m in mh.items() if not i.startswith("DUMMY")]
existing_pairs = {frozenset((p["from_mh"], p["to_mh"])) for p in net["pipes"]}
existing_dummies = [(m["x"], m["y"], i) for i, m in mh.items() if i.startswith("DUMMY")]
maxn = max((int(p["id"][1:]) for p in net["pipes"] if p["id"][1:].isdigit()), default=0)
maxd = max((int(m["id"].split("_")[1]) for m in net["manholes"]
            if m["id"].startswith("DUMMY_") and m["id"].split("_")[1].isdigit()), default=0)

def nearest(x, y):
    best = (None, 1e9)
    for i, rx, ry in reals:
        d = math.hypot(x - rx, y - ry)
        if d < best[1]: best = (i, d)
    return best

def load(path):
    out = []
    for r in csv.DictReader(open(path)):
        a = (-float(r["S_x"]), -float(r["S_y"]))
        b = (-float(r["E_x"]), -float(r["E_y"]))
        out.append((a, b))
    return out

def chain(segs, tol=0.5):
    def k(p): return (round(p[0]/tol), round(p[1]/tol))
    adj = defaultdict(list)
    for i, (a, b) in enumerate(segs):
        adj[k(a)].append((i, b)); adj[k(b)].append((i, a))
    used, out = set(), []
    for i, (a, b) in enumerate(segs):
        if i in used: continue
        ch = [a, b]; used.add(i)
        while True:
            nx = [(j, p) for j, p in adj[k(ch[-1])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.append(p)
        while True:
            nx = [(j, p) for j, p in adj[k(ch[0])] if j not in used]
            if len(nx) != 1: break
            j, p = nx[0]; used.add(j); ch.insert(0, p)
        out.append(ch)
    return out

created, created_nodes = [], {}
def make_dummy(x, y, t, parent):
    global maxd
    for dx, dy, did in existing_dummies:
        if math.hypot(x-dx, y-dy) <= DUP_TOL: return did
    for cx, cy, cid in created:
        if math.hypot(x-cx, y-cy) <= MERGE_TOL: return cid
    maxd += 1; did = f"DUMMY_{maxd:03d}"
    cov = mh[parent]["cover_elev"] if parent else net["metadata"].get("basemap_elev", 1546.83)
    created_nodes[did] = {"id": did, "name": did, "type": t, "x": round(x, 3), "y": round(y, 3),
                          "cover_elev": cov, "depth": 0.0, "diameter": 1.0, "images": [], "parent_mh": parent}
    created.append((x, y, did)); mh[did] = created_nodes[did]
    return did

new_pipes, used_d, skipped_dup, skipped_loop = [], set(), 0, 0
summary = defaultdict(int)
for typ, path, dia in FILES:
    runs = chain(load(path))
    for run in runs:
        s, e = run[0], run[-1]
        (ms, ds), (me, de) = nearest(*s), nearest(*e)
        ns = ms if ds <= SNAP else None
        ne = me if de <= SNAP else None
        if ns and ne and ns == ne:                 # same MH both ends -> stub
            if ds <= de: ne = None
            else: ns = None
        anchor = ns or ne
        if ns is None: ns = make_dummy(s[0], s[1], typ, anchor)
        if ne is None: ne = make_dummy(e[0], e[1], typ, anchor)
        if ns == ne: skipped_loop += 1; continue
        if frozenset((ns, ne)) in existing_pairs: skipped_dup += 1; continue
        existing_pairs.add(frozenset((ns, ne)))
        for nid in (ns, ne):
            if nid in created_nodes: used_d.add(nid)
        def dep(nid): mm = mh.get(nid); return (mm.get("depth", 0.0) or 0.0) if mm and not nid.startswith("DUMMY") else 0.0
        maxn += 1
        pipe = {"id": f"P{maxn:03d}", "from_mh": ns, "to_mh": ne, "from_depth": dep(ns),
                "to_depth": dep(ne), "diameter_mm": dia, "diameter_source": "csv_added", "type": typ}
        if len(run) > 2:
            pipe["path"] = [[round(x, 3), round(y, 3)] for (x, y) in run]
        new_pipes.append(pipe)
        kind = ("MH" if not ns.startswith("DUMMY") else "dum") + "-" + ("MH" if not ne.startswith("DUMMY") else "dum")
        summary[(typ, "-".join(sorted(kind.split("-"))))] += 1

new_nodes = [created_nodes[i] for i in created_nodes if i in used_d]
print(f"New pipes : {len(new_pipes)}   ({sum(1 for p in new_pipes if p['type']=='Sewer')} sewer, "
      f"{sum(1 for p in new_pipes if p['type']=='Stormwater')} storm)")
print(f"New dummies: {len(new_nodes)}")
print(f"Endpoint kinds: {dict(summary)}")
print(f"Skipped: {skipped_dup} dup-pairs, {skipped_loop} self-loops")
for p in new_pipes:
    bent = f" path({len(p['path'])})" if p.get("path") else ""
    print(f"  {p['id']} {p['type'][:4]:4s} {p['from_mh']:11s}->{p['to_mh']:11s}{bent}")

if WRITE:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{NET}.bak_csv_{stamp}.json"; shutil.copyfile(NET, bak)
    net["manholes"].extend(new_nodes); net["pipes"].extend(new_pipes)
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET} (backup {bak})")
    print(f"Totals now: {len(net['manholes'])} manholes, {len(net['pipes'])} pipes")
else:
    print("\nDRY RUN — re-run with --write to apply.")
