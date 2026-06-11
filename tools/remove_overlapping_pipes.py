"""
Find and remove DGN-added pipes whose geometry lies ON TOP of another pipe
(collinear, small perpendicular offset, overlapping extent) -- i.e. a segment
laid over an existing longer pipe.

Keep priority: pre-existing pipe > longer pipe. Only DGN-added pipes are ever
removed (pre-existing overlaps are reported, not touched).

DGN-added pipes are identified by diameter_source.
After removal, DGN dummy nodes left with no pipes are also removed.

Run with --write to apply (.backup.json). Dry run otherwise.
"""
import json, sys, math, shutil
from collections import defaultdict

NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
WRITE = "--write" in sys.argv

PERP_TOL = 1.0      # max perpendicular offset (m) to count as "on the same line"
ANGLE_TOL = 15.0    # max angle (deg) between directions to count as parallel
OVERLAP_FRAC = 0.5  # min fraction of the candidate pipe covered by the other

DGN_SRC = {"dgn_unsized", "sheet_both", "sheet_from_out", "sheet_to_in",
           "sheet_to_ambig", "sheet_from_ambig"}

net = json.load(open(NET))
mh = {m["id"]: m for m in net["manholes"]}
pipes = net["pipes"]

def coords(p):
    a, b = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not a or not b:
        return None
    return (a["x"], a["y"]), (b["x"], b["y"])

def length(seg):
    (x1, y1), (x2, y2) = seg
    return math.hypot(x2 - x1, y2 - y1)

def overlap(N, E):
    """Fraction of N covered by E if collinear & close; else 0."""
    (n1, n2), (e1, e2) = N, E
    ex, ey = e2[0]-e1[0], e2[1]-e1[1]
    nx, ny = n2[0]-n1[0], n2[1]-n1[1]
    el2 = ex*ex + ey*ey
    nl = math.hypot(nx, ny)
    el = math.sqrt(el2) if el2 else 0
    if el == 0 or nl == 0:
        return 0
    cosang = abs((ex*nx + ey*ny) / (el*nl))
    if cosang < math.cos(math.radians(ANGLE_TOL)):
        return 0
    def proj(p):
        t = ((p[0]-e1[0])*ex + (p[1]-e1[1])*ey) / el2
        cx, cy = e1[0]+t*ex, e1[1]+t*ey
        return t, math.hypot(p[0]-cx, p[1]-cy)
    t1, d1 = proj(n1)
    t2, d2 = proj(n2)
    if d1 > PERP_TOL or d2 > PERP_TOL:
        return 0
    lo, hi = max(0.0, min(t1, t2)), min(1.0, max(t1, t2))
    if hi <= lo:
        return 0
    return (hi - lo) * el / nl

geo = {}
for p in pipes:
    c = coords(p)
    if c:
        geo[p["id"]] = c
is_dgn = {p["id"]: (p.get("diameter_source") in DGN_SRC) for p in pipes}
plen = {pid: length(g) for pid, g in geo.items()}
pby = {p["id"]: p for p in pipes}

remove = set()
report = []
ids = list(geo)
for i, na in enumerate(ids):
    if not is_dgn[na] or na in remove:
        continue
    for nb in ids:
        if nb == na or nb in remove:
            continue
        # skip if they merely share an endpoint and go different ways handled by extent
        frac = overlap(geo[na], geo[nb])
        if frac < OVERLAP_FRAC:
            continue
        # na (DGN) is covered by nb -> decide removal
        a_pre = not is_dgn[na]
        b_pre = not is_dgn[nb]
        kill = None
        if b_pre and not a_pre:
            kill = na                      # DGN over pre-existing -> drop DGN
        elif is_dgn[na] and is_dgn[nb]:
            kill = na if plen[na] <= plen[nb] else nb   # drop shorter DGN
        if kill:
            remove.add(kill)
            report.append((kill, na if kill != na else nb, round(frac, 2),
                           round(plen[na], 1), round(plen[nb], 1),
                           "DGN-over-existing" if b_pre else "DGN-over-DGN"))
            if kill == na:
                break

print(f"pipes: {len(pipes)}   DGN-added: {sum(is_dgn.values())}")
print(f"overlapping DGN pipes to REMOVE: {len(remove)}\n")
for kill, other, frac, la, lb, kind in report:
    k = pby[kill]
    o = pby[other]
    print(f"  remove {kill} ({k['from_mh']}->{k['to_mh']}, {plen[kill]:.1f}m) "
          f"-- {int(frac*100)}% on top of {other} ({o['from_mh']}->{o['to_mh']}, {plen[other]:.1f}m) [{kind}]")

# dummies that become NEWLY isolated by this removal (scope-tight: leave
# pre-existing orphans alone)
deg_before = defaultdict(int)
for p in pipes:
    deg_before[p["from_mh"]] += 1
    deg_before[p["to_mh"]] += 1
deg_after = defaultdict(int)
for p in pipes:
    if p["id"] in remove:
        continue
    deg_after[p["from_mh"]] += 1
    deg_after[p["to_mh"]] += 1
iso_dummies = [m["id"] for m in net["manholes"]
               if m["id"].startswith("DUMMY")
               and deg_after[m["id"]] == 0 and deg_before[m["id"]] > 0]
pre_orphan = sum(1 for m in net["manholes"]
                 if m["id"].startswith("DUMMY") and deg_before[m["id"]] == 0)
print(f"\ndummies newly isolated by removal (will also remove): {len(iso_dummies)}")
print(f"(note: {pre_orphan} dummies were ALREADY isolated before this fix - left untouched)")

if WRITE:
    shutil.copy(NET, NET + ".backup.json")
    net["pipes"] = [p for p in pipes if p["id"] not in remove]
    iso = set(iso_dummies)
    net["manholes"] = [m for m in net["manholes"] if m["id"] not in iso]
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET} (backup at {NET}.backup.json)")
    print(f"  removed {len(remove)} pipes, {len(iso_dummies)} isolated dummies")
    print(f"  now: {len(net['pipes'])} pipes, {len(net['manholes'])} manholes")
else:
    print("\n[DRY RUN] re-run with --write to apply.")
