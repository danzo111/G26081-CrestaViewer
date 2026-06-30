"""Validate + visualize pipe flow directions (mirrors main.js _buildNetworkGraph).
Flow: flow_override / dummy-touching pipes follow from->to; others follow invert
gradient (higher invert -> lower). Flags MH->MH pipes that flow UPHILL.
Renders an arrow map: green=downhill, red=uphill, grey=indeterminate."""
import json, math
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

net = json.load(open("data/network.json"))
mh = {m["id"]: m for m in net["manholes"]}
md = net["metadata"]; bb = md["basemap_bounds"]

def pts(p):
    A, B = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not A or not B: return None
    return [(xy[0], xy[1]) for xy in p["path"]] if (p.get("path") and len(p["path"]) >= 2) \
        else [(A["x"], A["y"]), (B["x"], B["y"])]

def flow_dir(p):
    """returns (flowFrom_id, flowTo_id, mode)"""
    a, b = p["from_mh"], p["to_mh"]
    touches_dummy = a.startswith("DUMMY") or b.startswith("DUMMY")
    if p.get("flow_override") or touches_dummy or (p.get("id","").startswith("DUMMY_PIPE")):
        return a, b, ("override" if p.get("flow_override") else "dummy")
    A, B = mh[a], mh[b]
    fi = A["cover_elev"] - p.get("from_depth", 0)
    ti = B["cover_elev"] - p.get("to_depth", 0)
    return (a, b, "grad") if fi >= ti else (b, a, "grad")

rows = []
for p in net["pipes"]:
    pp = pts(p)
    if not pp: continue
    ff, ft, mode = flow_dir(p)
    A, B = mh.get(ff), mh.get(ft)
    real = A and B and not ff.startswith("DUMMY") and not ft.startswith("DUMMY")
    inv_f = (A["cover_elev"] - (p["from_depth"] if p["from_mh"] == ff else p["to_depth"])) if real else None
    inv_t = (B["cover_elev"] - (p["to_depth"] if p["to_mh"] == ft else p["from_depth"])) if real else None
    uphill = real and inv_t is not None and inv_f is not None and inv_t > inv_f + 0.01
    rows.append((p, pp, ff, ft, mode, real, uphill, inv_f, inv_t))

uphill = [r for r in rows if r[6]]
print(f"Pipes: {len(rows)} | MH->MH gradient-checkable: {sum(1 for r in rows if r[5])}")
print(f"UPHILL flow (flow goes to HIGHER invert) — CHECK THESE: {len(uphill)}")
for p, pp, ff, ft, mode, real, up, inf, intt in sorted(uphill, key=lambda r: (r[7] is None, (r[8] or 0)-(r[7] or 0)), reverse=True):
    rise = intt - inf
    fo = " [flow_override]" if p.get("flow_override") else ""
    print(f"  {p['id']:6s} {ff:9s}->{ft:9s} {p['type'][:4]:4s} rises {rise:.2f}m (inv {inf:.2f}->{intt:.2f}) {mode}{fo}")

# ── render ──
fig, ax = plt.subplots(figsize=(17, 18.5), dpi=140); ax.set_facecolor("#0D1E35")
try:
    img = plt.imread("basemap.png")
    if md.get("rotate_180"): img = img[::-1, ::-1]
    ax.imshow(img, extent=[bb["left"], bb["right"], bb["bottom"], bb["top"]], origin="upper", alpha=0.42, zorder=0)
except Exception as e: print("basemap skipped:", e)

for p, pp, ff, ft, mode, real, up, inf, intt in rows:
    ax.plot([x for x,y in pp], [y for x,y in pp], color="#5b6b7a", lw=1.0, alpha=0.6, zorder=1)
# arrows at midpoints in flow direction
for p, pp, ff, ft, mode, real, up, inf, intt in rows:
    fx, fy = mh[ff]["x"], mh[ff]["y"]; tx, ty = mh[ft]["x"], mh[ft]["y"]
    mid = pp[len(pp)//2]
    dx, dy = tx-fx, ty-fy; L = math.hypot(dx, dy)
    if L == 0: continue
    dx, dy = dx/L, dy/L
    col = "#E74C3C" if up else ("#2ECC71" if real else "#8aa0b0")
    ax.annotate("", xy=(mid[0]+dx*3.5, mid[1]+dy*3.5), xytext=(mid[0]-dx*3.5, mid[1]-dy*3.5),
                arrowprops=dict(arrowstyle="-|>", color=col, lw=1.3, alpha=0.95), zorder=3)
for i, m in mh.items():
    if i.startswith("DUMMY"): continue
    c = {"Sewer":"#E87722","Stormwater":"#00C8FF","Water":"#0A3D91"}.get(m["type"], "#cfd8e0")
    ax.plot(m["x"], m["y"], "o", ms=4, color=c, mec="white", mew=0.4, zorder=4)
ax.set_xlim(bb["left"], bb["right"]); ax.set_ylim(bb["bottom"], bb["top"])
ax.set_aspect("equal"); ax.axis("off")
ax.set_title("Flow direction check — green=downhill, red=UPHILL (check), grey=stub/indeterminate",
             color="white", fontsize=15, pad=12)
ax.legend(handles=[Line2D([0],[0],color="#2ECC71",lw=3,label="Downhill (correct)"),
                   Line2D([0],[0],color="#E74C3C",lw=3,label="Uphill — CHECK"),
                   Line2D([0],[0],color="#8aa0b0",lw=3,label="Stub / indeterminate")],
          loc="upper right", fontsize=10, facecolor="#162B47", labelcolor="white", framealpha=0.92)
fig.tight_layout(); fig.savefig("tools/flow_check.png", facecolor="#0D1E35", bbox_inches="tight")
print("\nwrote tools/flow_check.png")
