"""
Cross-check network.json manhole cover/invert against the deliverable DXF
labels (authoritative). Dry run unless --write.

Deliverable CSV: id, svc, cover, cover_type, invert, dx, dy   (dx,dy in DXF
frame; network coords = (-dx, -dy)).
Match by normalized name AND coordinate; only auto-apply where both agree.
"""
import json, csv, sys, math, re, shutil

NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
DELIV = r"C:\netconv\deliverable_mh.csv"
WRITE = "--write" in sys.argv
COORD_OK = 3.0      # m: name+coord agree
COORD_FAR = 6.0     # m: name matches but coord far => collision, skip
TOL = 0.02          # m: ignore changes smaller than this

net = json.load(open(NET))
M = {m["id"]: m for m in net["manholes"]}
reals = [m for m in net["manholes"] if not m["id"].startswith("DUMMY") and m.get("type") != "Dummy"]

def norm(s):
    m = re.match(r"^([A-Za-z]+)(\d+)$", s)
    return (m.group(1).upper(), int(m.group(2))) if m else (s.upper(), None)
net_by_norm = {}
for m in reals:
    net_by_norm.setdefault(norm(m["id"]), m)

def nearest(nx, ny):
    best, bd = None, 1e9
    for m in reals:
        d = math.hypot(m["x"]-nx, m["y"]-ny)
        if d < bd: best, bd = m, d
    return best, bd

rows = [r for r in csv.DictReader(open(DELIV)) if r["invert"]]
cats = {"apply": [], "name_far": [], "coord_only": [], "no_match": [], "nochange": []}

for r in rows:
    did = r["id"]; cl = float(r["cover"]); il = float(r["invert"])
    nx, ny = -float(r["dx"]), -float(r["dy"])
    dep = round(cl - il, 3)
    byname = net_by_norm.get(norm(did))
    near, nd = nearest(nx, ny)
    target = None; cat = None
    if byname:
        dname = math.hypot(byname["x"]-nx, byname["y"]-ny)
        if dname <= COORD_FAR:
            target, cat = byname, "match"
        else:
            cat = "name_far"   # collision: name same, location far
    if target is None and near and nd <= COORD_OK:
        target, cat = near, "coord_only"
    if target is None and cat != "name_far":
        cat = "no_match"

    if target is not None:
        cc = target.get("cover_elev"); cd = target.get("depth")
        dcov = None if cc is None else cl - cc
        ddep = None if cd is None else dep - cd
        if (cc is not None and abs(dcov) < TOL) and (cd is not None and abs(ddep) < TOL):
            cats["nochange"].append((did, target["id"]))
        else:
            cats["apply" if cat=="match" else "coord_only"].append(
                (did, target["id"], cc, cl, cd, dep, il))
    elif cat == "name_far":
        cats["name_far"].append((did, byname["id"], round(math.hypot(byname["x"]-nx, byname["y"]-ny),1)))
    else:
        cats["no_match"].append((did, round(nd,1)))

print(f"deliverable MHs with invert: {len(rows)}")
print(f"  to APPLY (name+coord agree): {len(cats['apply'])}")
print(f"  coord-only match (name differs/absent): {len(cats['coord_only'])}")
print(f"  no change needed: {len(cats['nochange'])}")
print(f"  NAME match but COORD far (collision-skip): {len(cats['name_far'])}")
print(f"  no match in network: {len(cats['no_match'])}")

print("\n--- APPLY (sample 25) ---")
for x in cats["apply"][:25]:
    did,nid,cc,cl,cd,dep,il = x
    print(f"  {did}->{nid}: cover {cc}->{cl} | depth {cd}->{dep} (IL {il})")
print(f"  ...({len(cats['apply'])} total)")
print("\n--- COORD-ONLY (name differs) sample 15 ---")
for x in cats["coord_only"][:15]:
    did,nid,cc,cl,cd,dep,il = x
    print(f"  deliv {did} ~ net {nid}: cover {cc}->{cl} depth {cd}->{dep}")
print("\n--- NAME-FAR collisions (skipped) ---")
for x in cats["name_far"][:20]:
    print(f"  deliv {x[0]} vs net {x[1]} ({x[2]}m apart) - NOT applied")
print("\n--- NO MATCH (sample) ---")
for x in cats["no_match"][:20]:
    print(f"  deliv {x[0]} (nearest net {x[1]}m)")

if WRITE:
    shutil.copy(NET, NET + ".backup.json")
    n=0
    for x in cats["apply"] + cats["coord_only"]:
        did,nid,cc,cl,cd,dep,il = x
        M[nid]["cover_elev"] = cl
        M[nid]["depth"] = dep
        n+=1
    json.dump(net, open(NET,"w"), indent=2)
    print(f"\nWROTE {NET} (backup). corrected {n} manholes.")
else:
    print("\n[DRY RUN]")
