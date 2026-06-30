"""Render DXF (truth) vs network for visual inspection.
Network pipes coloured by DXF backing: GREEN = lies on a DXF line, RED = no DXF
under it. Uncovered DXF lines highlighted MAGENTA. Manholes dotted by type.
Outputs overview + zoom crops to tools/compare_*.png
"""
import json, math
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

net = json.load(open("data/network.json")); dxf = json.load(open("data/dxf_overlay.json"))
mh = {m["id"]: m for m in net["manholes"]}

# ── network pipe centrelines ──
def pipe_pts(p):
    A, B = mh.get(p["from_mh"]), mh.get(p["to_mh"])
    if not A or not B: return None
    if p.get("path") and len(p["path"]) >= 2: return [(xy[0], xy[1]) for xy in p["path"]]
    return [(A["x"], A["y"]), (B["x"], B["y"])]

net_segs = []
for p in net["pipes"]:
    pts = pipe_pts(p)
    if pts:
        for i in range(len(pts) - 1): net_segs.append((pts[i], pts[i + 1]))

# ── grids ──
CELL = 5.0
def gindex(segs):
    g = defaultdict(list)
    for idx, (a, b) in enumerate(segs):
        for cx in range(int(min(a[0], b[0]) // CELL), int(max(a[0], b[0]) // CELL) + 1):
            for cy in range(int(min(a[1], b[1]) // CELL), int(max(a[1], b[1]) // CELL) + 1):
                g[(cx, cy)].append(idx)
    return g
def ptseg(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L2 = dx*dx+dy*dy
    t = 0 if L2 == 0 else max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L2))
    return math.hypot(px-(ax+t*dx), py-(ay+t*dy))
def nearest(segs, grid, px, py):
    cx, cy = int(px//CELL), int(py//CELL); best = 1e9
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for idx in grid.get((cx+dx, cy+dy), ()):
                d = ptseg(px, py, *segs[idx])
                if d < best: best = d
    return best

dxf_segs = []
for grp, segs in dxf["groups"].items():
    for s in segs: dxf_segs.append(((s[0], s[1]), (s[2], s[3]), grp))
dxf_geo = [(a, b) for a, b, g in dxf_segs]
net_grid = gindex(net_segs); dxf_grid = gindex(dxf_geo)
BUF = 1.5

# pipe backing
pipe_backed = {}
for p in net["pipes"]:
    pts = pipe_pts(p)
    if not pts: continue
    tot = hit = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i+1]; L = math.hypot(a[0]-b[0], a[1]-b[1]); n = max(1, int(L//1.0))
        for j in range(n):
            t = (j+0.5)/n; tot += 1
            if nearest(dxf_geo, dxf_grid, a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t) <= BUF: hit += 1
    pipe_backed[p["id"]] = (hit/tot) if tot else 0

# dxf coverage
dxf_cov = []
for (a, b) in dxf_geo:
    mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
    dxf_cov.append(nearest(net_segs, net_grid, mx, my) <= BUF)

TYPE_COL = {"Sewer": "#E87722", "Stormwater": "#00C8FF", "Water": "#0A3D91", "Unknown": "#999999"}

def render(fname, xlim=None, ylim=None, title="", lw_scale=1.0):
    fig, ax = plt.subplots(figsize=(16, 17.6), dpi=130)
    ax.set_facecolor("#0D1E35")
    # DXF backdrop
    for (a, b), cov in zip(dxf_geo, dxf_cov):
        if cov: ax.plot([a[0], b[0]], [a[1], b[1]], color="#5a6b7a", lw=0.6*lw_scale, alpha=0.55, zorder=1)
    for (a, b), cov in zip(dxf_geo, dxf_cov):
        if not cov: ax.plot([a[0], b[0]], [a[1], b[1]], color="#ff35d0", lw=1.4*lw_scale, alpha=0.95, zorder=2)
    # network pipes
    for p in net["pipes"]:
        pts = pipe_pts(p)
        if not pts: continue
        col = "#2ECC71" if pipe_backed.get(p["id"], 0) >= 0.5 else "#E74C3C"
        ax.plot([x for x, y in pts], [y for x, y in pts], color=col, lw=1.7*lw_scale, alpha=0.9, zorder=3)
    # manholes
    for i, m in mh.items():
        if i.startswith("DUMMY"):
            ax.plot(m["x"], m["y"], "o", ms=1.5*lw_scale, color="#444", zorder=4); continue
        ax.plot(m["x"], m["y"], "o", ms=4.5*lw_scale, color=TYPE_COL.get(m["type"], "#999"),
                mec="white", mew=0.5*lw_scale, zorder=5)
    ax.set_aspect("equal"); ax.set_title(title, color="white", fontsize=15)
    if xlim: ax.set_xlim(xlim)
    if ylim: ax.set_ylim(ylim)
    ax.tick_params(colors="#888", labelsize=7)
    leg = [Line2D([0],[0],color="#2ECC71",lw=3,label="Network pipe — on DXF (valid)"),
           Line2D([0],[0],color="#E74C3C",lw=3,label="Network pipe — NO DXF backing"),
           Line2D([0],[0],color="#ff35d0",lw=2,label="DXF line — no network pipe (missing)"),
           Line2D([0],[0],color="#5a6b7a",lw=2,label="DXF line — covered"),
           Line2D([0],[0],marker="o",color="#E87722",lw=0,label="Sewer MH",mec="w"),
           Line2D([0],[0],marker="o",color="#00C8FF",lw=0,label="Stormwater MH",mec="w"),
           Line2D([0],[0],marker="o",color="#0A3D91",lw=0,label="Water MH",mec="w"),
           Line2D([0],[0],marker="o",color="#999",lw=0,label="Unknown MH",mec="w")]
    ax.legend(handles=leg, loc="upper right", fontsize=9, facecolor="#162B47", labelcolor="white", framealpha=0.9)
    fig.tight_layout(); fig.savefig(fname, facecolor="#0D1E35"); plt.close(fig)
    print("wrote", fname)

# overview
render("tools/compare_overview.png", title="DXF (truth) vs Network — full extent")
# zoom: SE019/SE085 area we edited
render("tools/compare_zoom_se.png", xlim=(-97600, -97500), ylim=(2891560, 2891660),
       title="Zoom: SE018-021 / SE085 / SW216-220 area", lw_scale=3.0)

# stats
backed = sum(1 for v in pipe_backed.values() if v >= 0.5); nb = len(pipe_backed) - backed
print(f"network pipes: {backed} backed / {nb} no-DXF")
print(f"DXF segments: {sum(dxf_cov)} covered / {len(dxf_cov)-sum(dxf_cov)} uncovered")
