"""Step 4: Crop Match app. Start with:  streamlit run app.py"""
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from config import DATA_DIR, ZONES
from scoring import best_planting, evaluate, get_climate, get_crops, scan_year, zone_offsets

BLUE, GREY, ORANGE = "#2a6fdb", "#b8bcc4", "#d9772b"
st.set_page_config(page_title="Crop Match - Field Shift", layout="wide")
crops = get_crops()


@st.cache_data
def load_precomputed():
    """Precomputed results (default climate, no shift). Made by precompute.py."""
    res = pd.read_csv(DATA_DIR / "results.csv", parse_dates=["planting_date"])
    best = pd.read_csv(DATA_DIR / "best_windows.csv", parse_dates=["best_date", "harvest_date"])
    return res, best


@st.cache_data
def live_year(crop, zone, dT, rain):
    """Live recompute, only used when the Field Shift sliders move."""
    df = scan_year(crop, zone, dT, rain)
    df["planting_date"] = pd.to_datetime(df["planting_date"])
    return df


# ---------------- Sidebar ----------------
st.sidebar.title("Crop Match")
crop = st.sidebar.selectbox("Crop", crops.index, format_func=lambda c: crops.loc[c, "display_name"])
zone = st.sidebar.selectbox("Zone (model estimate)", list(ZONES))
z = ZONES[zone]
st.sidebar.caption(f"Model estimate: soil salinity {z['ece']} dS/m, temperature offset "
                   f"{z['dT_summer']:+} C (May-Oct) / {z['dT_winter']:+} C (Nov-Apr).")
st.sidebar.subheader("Field Shift")
dT = st.sidebar.slider("Warming (C)", 0.0, 4.0, 0.0, 0.5)
rain_pct = st.sidebar.slider("Rain (% of 2025)", 60, 100, 100, 5)
rain = rain_pct / 100
shifted = dT != 0 or rain_pct != 100

# Year scan + best date: from CSV when no shift, else live
try:
    results, best_windows = load_precomputed()
except FileNotFoundError:
    st.error("results.csv not found. Run `python precompute.py` first.")
    st.stop()
if shifted:
    year = live_year(crop, zone, dT, rain)
    best = best_planting(crop, zone, dT, rain)
    best_date = pd.Timestamp(best["planting_date"])
else:
    year = results[(results["crop"] == crop) & (results["zone"] == zone)]
    best_date = best_windows[(best_windows["crop"] == crop) & (best_windows["zone"] == zone)]["best_date"].iloc[0]

use_best = st.sidebar.checkbox("Use best planting date", value=True)
date = best_date if use_best else pd.Timestamp(st.sidebar.date_input(
    "Planting date", best_date.date(), min_value=pd.Timestamp("2025-01-01").date(),
    max_value=pd.Timestamp("2025-12-31").date()))

# ---------------- Main numbers ----------------
r = evaluate(crop, zone, date, dT, rain)
p = crops.loc[crop]
st.title(f"{p['display_name']} in {zone}")
if shifted:
    st.caption(f"Field Shift active: +{dT} C, rain {rain_pct}% of 2025.")

c1, c2, c3, c4 = st.columns(4)
delta = None
if shifted:
    base = evaluate(crop, zone, date)["match"]
    delta = f"{(r['match'] - base) * 100:+.0f} pts vs 2025 climate"
c1.metric("Crop match", f"{r['match'] * 100:.0f}%", delta)
c2.metric("Best planting date", best_date.strftime("%d %b"))
c3.metric("Irrigation needed", f"{r['irrigation_mm']:.0f} mm")
c4.metric("Expected yield vs ideal conditions", f"{r['expected_yield_pct']:.0f}%",
          help="Index = salt relative yield x temperature score. Not tonnes.")

for label, key in [("Temperature", "temp_score"), ("Water", "water_score"), ("Soil salinity", "salt_score")]:
    st.progress(float(r[key]), text=f"{label}: {r[key] * 100:.0f}%")
st.write(r["explanation"])
st.caption(f"Window: planted {r['planting_date']:%d %b}, harvest/end {r['harvest_date']:%d %b %Y} "
           f"({p['cycle_days']} days, approximate).")
if r["warning"]:
    st.warning(r["warning"])
if not r["in_planting_months"]:
    st.info("This date is outside the crop's usual planting months.")
if p["assumed"]:
    st.caption(f"Assumed values for this crop: {p['notes']}.")

# ---------------- Chart 1: match by planting week ----------------
st.subheader("Match % by planting week")
c1df = year.assign(match_pct=year["match"] * 100,
                   window=year["in_planting_months"].map({True: "Planting months", False: "Outside planting months"}))
fig1 = px.bar(c1df, x="planting_date", y="match_pct", color="window",
              color_discrete_map={"Planting months": BLUE, "Outside planting months": GREY},
              labels={"planting_date": "Planting date", "match_pct": "Match %", "window": ""})
fig1.add_vline(x=date, line_dash="dash", line_color="black")
fig1.update_layout(yaxis_range=[0, 100], height=320, legend_orientation="h")
st.plotly_chart(fig1, width="stretch")

# ---------------- Chart 2: all crops ranked ----------------
st.subheader(f"All crops in {zone}, planted {date:%d %b}")
same_day = results[(results["zone"] == zone) & (results["planting_date"] == date)]
if not shifted and len(same_day) == len(crops):
    rank = same_day[["crop", "match"]]
else:
    rank = pd.DataFrame([evaluate(c, zone, date, dT, rain) for c in crops.index])[["crop", "match"]]
rank = rank.assign(name=rank["crop"].map(crops["display_name"]), match_pct=rank["match"] * 100)
rank = rank.sort_values("match_pct")
fig2 = px.bar(rank, x="match_pct", y="name", orientation="h", labels={"match_pct": "Match %", "name": ""})
fig2.update_traces(marker_color=[BLUE if c == crop else GREY for c in rank["crop"]])
fig2.update_layout(xaxis_range=[0, 100], height=360)
st.plotly_chart(fig2, width="stretch")

# ---------------- Chart 3: climate with crop window ----------------
st.subheader("Daily temperature and rain (zone + Field Shift applied)")
clim = get_climate()
temp = clim["temp_mean_C"] + zone_offsets(z, clim["time"].dt.month.to_numpy()) + dT
start = pd.Timestamp(r["planting_date"])
end = pd.Timestamp(r["harvest_date"])
fig3 = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.6, 0.4], vertical_spacing=0.06)
fig3.add_trace(go.Scatter(x=clim["time"], y=temp, name="Mean temp (C)", line=dict(color=ORANGE, width=2)), 1, 1)
fig3.add_trace(go.Bar(x=clim["time"], y=clim["precip_mm"] * rain, name="Rain (mm/day)", marker_color=BLUE), 2, 1)
fig3.add_hrect(y0=p["t_opt_min"], y1=p["t_opt_max"], fillcolor="green", opacity=0.08, line_width=0,
               row=1, col=1, annotation_text="optimum", annotation_position="top left")
for row in (1, 2):
    fig3.add_vrect(x0=start, x1=end, fillcolor=BLUE, opacity=0.12, line_width=0, row=row, col=1)
fig3.update_yaxes(title_text="C", row=1, col=1)
fig3.update_yaxes(title_text="mm/day", row=2, col=1)
fig3.update_layout(height=460, showlegend=False)
st.plotly_chart(fig3, width="stretch")
st.caption("Shaded = crop window. 2026 is the 2025 data repeated (assumption).")

# ---------------- Footer ----------------
st.divider()
st.markdown("""**Limitations**
- SMAP is 9 km: one grid cell covers all zones; differences between zones are model assumptions.
- Soil salinity cannot be measured by satellite; zone values are estimates (Campo de Cartagena soils measured 2-10 dS/m).
- Climate data is 2025 only (next year assumed equal).
- Crop cycle lengths are approximate.
- Data source: NASA SMAP L4 SPL4SMGP v008.""")
