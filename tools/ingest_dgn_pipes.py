"""
Ingest the consolidated manhole-to-manhole DGN runs (from pipes_consolidated.csv)
into network.json as new pipes.

For each run where BOTH ends matched a known manhole and from_mh != to_mh:
  - skip if a pipe between that unordered manhole pair already exists
  - de-dup reversed/duplicate pairs within the new set
  - type = Sewer / Stormwater from the DGN layer
  - invert: inherit manhole depth where depth>0 (pipe invert = manhole invert);
            else derive depth from the DGN z (pipe invert) at that endpoint
  - diameter: unknown in this dataset -> diameter_mm=null, source 'dgn_unsized'

CSV coords are the negated network.json coords: csv = (-net.x, -net.y).
z values are pipe invert elevations.

Run with --write to apply (.backup.json made). Dry run otherwise.
"""
import csv, json, sys, math, shutil

CONS = r"D:\Daniel Njoroge Working folder\CRESTA\pipes_consolidated.csv"
NEWONLY = r"D:\Daniel Njoroge Working folder\CRESTA\line_endpoints_NEW_ONLY.csv"
NET = r"C:\Users\User\Documents\GitHub\G26081 CrestaViwer\data\network.json"
WRITE = "--write" in sys.argv

net = json.load(open(NET))
mh = {m["id"]: m for m in net["manholes"]}
pipes = net["pipes"]

# existing unordered manhole pairs that already have a pipe
existing_pairs = set()
for p in pipes:
    existing_pairs.add(frozenset((p["from_mh"], p["to_mh"])))

# next pipe id
maxn = 0
for p in pipes:
    pid = p["id"]
    if pid.startswith("P") and pid[1:].isdigit():
        maxn = max(maxn, int(pid[1:]))
def next_id(n):
    return f"P{n:03d}"

# z lookup from new-only CSV endpoints: (round x, round y) -> z
zlut = {}
for r in csv.DictReader(open(NEWONLY)):
    for xk, yk, zk in (("S_x","S_y","S_z"), ("E_x","E_y","E_z")):
        key = (round(float(r[xk]), 1), round(float(r[yk]), 1))
        try:
            z = float(r[zk])
        except (TypeError, ValueError):
            continue
        zlut[key] = z

def z_at(x, y):
    return zlut.get((round(x, 1), round(y, 1)))

def layer_type(layer):
    return "Sewer" if "SEWER" in layer.upper() else "Stormwater"

def depth_for(mid, end_x, end_y):
    """Inherit manhole depth if known; else derive from DGN z; else 0."""
    m = mh[mid]
    cov = m.get("cover_elev")
    d = m.get("depth")
    if d and d > 0:
        return d, "manhole"
    z = z_at(end_x, end_y)
    if z and cov and 1000 < z <= cov + 0.05:
        return round(cov - z, 3), "dgn_z"
    return 0.0, "none"

MIN_LEN = 1.0   # runs shorter than this are coincident-manhole artifacts, not pipes

runs = [r for r in csv.DictReader(open(CONS))
        if r["from_mh"] and r["to_mh"] and r["from_mh"] != r["to_mh"]]

added, skip_exist, skip_dup, skip_short = [], [], [], []
seen = set()
for r in runs:
    a, b = r["from_mh"], r["to_mh"]
    ax, ay, bx, by = float(r["from_x"]), float(r["from_y"]), float(r["to_x"]), float(r["to_y"])
    pair = frozenset((a, b))
    if float(r["length_m"]) < MIN_LEN:
        skip_short.append((a, b, r["length_m"])); continue
    if pair in existing_pairs:
        skip_exist.append((a, b)); continue
    if pair in seen:
        skip_dup.append((a, b)); continue
    seen.add(pair)
    fd, fsrc = depth_for(a, ax, ay)
    td, tsrc = depth_for(b, bx, by)
    fi = mh[a]["cover_elev"] - fd
    ti = mh[b]["cover_elev"] - td
    # orient downhill: from = higher invert (upstream), so from_mh->to_mh = flow
    if fsrc != "none" and tsrc != "none" and ti > fi:
        a, b = b, a
        fd, td = td, fd
        fsrc, tsrc = tsrc, fsrc
    added.append({
        "from": a, "to": b, "type": layer_type(r["layer"]),
        "from_depth": fd, "to_depth": td, "fsrc": fsrc, "tsrc": tsrc,
        "len": r["length_m"],
    })

print(f"candidate MH-MH runs: {len(runs)}")
print(f"  skip (<{MIN_LEN}m, coincident manholes): {len(skip_short)} " +
      ("(" + ", ".join(f"{a}-{b}:{L}m" for a,b,L in skip_short) + ")" if skip_short else ""))
print(f"  skip (pipe already exists): {len(skip_exist)}")
print(f"  skip (duplicate/reverse):   {len(skip_dup)}")
print(f"  TO ADD: {len(added)}")
from collections import Counter
print(f"  types: {dict(Counter(a['type'] for a in added))}")
print(f"  invert source: {dict(Counter(a['fsrc'] for a in added) + Counter(a['tsrc'] for a in added))}")
print()
steep = []
for i, a in enumerate(added):
    fi = mh[a["from"]]["cover_elev"] - a["from_depth"]
    ti = mh[a["to"]]["cover_elev"] - a["to_depth"]
    fall = fi - ti
    flag = ""
    if fall < -0.005:
        flag = "  <-- still uphill (one end invert unknown)"
    elif fall > 3.0:
        flag = "  <-- STEEP, verify inverts"
        steep.append((a["from"], a["to"], fall))
    print(f"  {next_id(maxn+1+i)}: {a['from']:7}->{a['to']:7} {a['type']:10} "
          f"IL {fi:.2f}->{ti:.2f} fall {fall:+.2f} ({a['fsrc']}/{a['tsrc']}) {a['len']}m{flag}")

if skip_exist:
    print(f"\n  already-existing pairs skipped: " + ", ".join(f"{a}-{b}" for a,b in skip_exist[:20]))

if WRITE:
    shutil.copy(NET, NET + ".backup.json")
    n = maxn
    for a in added:
        n += 1
        pipes.append({
            "id": next_id(n),
            "from_mh": a["from"], "to_mh": a["to"],
            "from_depth": a["from_depth"], "to_depth": a["to_depth"],
            "diameter_mm": None, "diameter_source": "dgn_unsized",
            "type": a["type"],
        })
    net["pipes"] = pipes
    json.dump(net, open(NET, "w"), indent=2)
    print(f"\nWROTE {NET} (backup at {NET}.backup.json)")
    print(f"  pipes: {len(pipes)} total (+{len(added)})")
else:
    print("\n[DRY RUN] re-run with --write to apply.")
