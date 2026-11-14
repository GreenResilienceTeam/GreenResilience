"""Static soil data per zone: texture, pH, organic carbon (+ field capacity from our own table).

Source: ISRIC SoilGrids 2.0 (250 m grid), queried ONLY at a few sample points per zone
(no global rasters are downloaded). Values are model predictions, not field measurements.
Output: data/static/soil_zones.csv  and  data/static/soil_meta.json
Run:    python prepare_soil.py      (uses the cache if the output already exists; --refresh to re-query)
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

import pandas as pd

from config import DATA_DIR, find_file

OUT_CSV = DATA_DIR / "static" / "soil_zones.csv"
OUT_META = DATA_DIR / "static" / "soil_meta.json"
API = "https://rest.isric.org/soilgrids/v2.0/properties/query"
DEPTHS = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}       # depth -> layer thickness (cm), for a 0-30 cm average

# ASSUMPTION: illustrative sample points per zone (lat, lon). Edit to move a zone.
ZONE_POINTS = {
    # SoilGrids has no values under buildings, so Town uses the edge of town (gardens, fields)
    "Coast": [(37.853, -0.783), (37.866, -0.776)],            # coastal fields north of town
    "Town": [(37.845, -0.805), (37.828, -0.812)],             # edge of San Pedro del Pinatar
    "Inland farmland": [(37.800, -0.880), (37.825, -0.840)],   # El Mirador fields, fields west of town
}
# SoilGrids property -> (our column, divide by this to get the unit below)
PROPS = {"clay": ("clay_pct", 10), "sand": ("sand_pct", 10), "silt": ("silt_pct", 10),
         "phh2o": ("ph_h2o", 10), "soc": ("soc_g_per_kg", 10)}
UNITS = {"clay_pct": "% (mass)", "sand_pct": "% (mass)", "silt_pct": "% (mass)", "ph_h2o": "pH in water",
         "soc_g_per_kg": "g/kg soil organic carbon", "field_capacity_m3m3": "m3/m3 (from soil_moisture_conversion.csv)"}


def query(lat, lon):
    """One SoilGrids point query -> {column: 0-30 cm thickness-weighted mean}."""
    params = [("lat", lat), ("lon", lon), ("value", "mean")] + [("property", p) for p in PROPS] + [("depth", d) for d in DEPTHS]
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "EduCropModel/1.0"})
    layers = json.load(urllib.request.urlopen(req, timeout=60))["properties"]["layers"]
    out = {}
    for layer in layers:
        col, div = PROPS[layer["name"]]
        vals = {d["label"]: d["values"]["mean"] for d in layer["depths"]}
        if any(v is None for v in vals.values()):
            out[col] = None                      # SoilGrids has no value here (e.g. water, salt pan)
        else:
            out[col] = sum(vals[d] * w for d, w in DEPTHS.items()) / sum(DEPTHS.values()) / div
    return out


def texture_class(sand, silt, clay):
    """USDA soil texture triangle."""
    if pd.isna(sand) or pd.isna(silt) or pd.isna(clay):
        return None
    if silt + 1.5 * clay < 15: return "sand"
    if silt + 1.5 * clay < 30: return "loamy sand"
    if 7 <= clay < 20 and sand > 52 or clay < 7 and silt < 50: return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52: return "loam"
    if silt >= 50 and (12 <= clay < 27 or silt < 80 and clay < 12): return "silt loam"
    if silt >= 80 and clay < 12: return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45: return "sandy clay loam"
    if 27 <= clay < 40 and sand <= 20: return "silty clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45: return "clay loam"
    if clay >= 35 and sand > 45: return "sandy clay"
    if clay >= 40 and silt >= 40: return "silty clay"
    return "clay"


# Textures missing from our field-capacity table -> closest one in the table
TEXTURE_FALLBACK = {"silt": "silt loam", "sandy clay loam": "clay loam", "silty clay loam": "clay loam",
                    "sandy clay": "clay", "silty clay": "clay"}


def field_capacity(texture):
    if texture is None:
        return None
    fc = pd.read_csv(find_file("soil_moisture_conversion.csv"))
    fc["soil_texture"] = fc["soil_texture"].str.strip().str.lower()
    row = fc[fc["soil_texture"] == TEXTURE_FALLBACK.get(texture, texture)]
    if row.empty:
        return None
    nums = [float(x) for x in str(row["field_capacity_m3m3"].iloc[0]).split("-")]
    return sum(nums) / len(nums)          # "0.25-0.32" -> midpoint


def main():
    if OUT_CSV.exists() and "--refresh" not in sys.argv:
        print("Soil data cached:", OUT_CSV)
        return
    points = []
    for zone, pts in ZONE_POINTS.items():
        for lat, lon in pts:
            points.append({"zone": zone, "lat": lat, "lon": lon, **query(lat, lon)})
            time.sleep(2)                 # be polite to the free API
    pts = pd.DataFrame(points)
    zones = pts.groupby("zone", sort=False)[[c for c, _ in PROPS.values()]].mean().round(2).reset_index()
    zones["texture"] = [texture_class(r.sand_pct, r.silt_pct, r.clay_pct) for r in zones.itertuples()]
    zones["field_capacity_m3m3"] = [field_capacity(t) for t in zones["texture"]]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    zones.to_csv(OUT_CSV, index=False)
    OUT_META.write_text(json.dumps({
        "source": "ISRIC SoilGrids 2.0, https://soilgrids.org (CC BY 4.0), point queries via rest.isric.org",
        "downloaded": str(date.today()), "depth": "0-30 cm, thickness-weighted mean of 0-5, 5-15, 15-30 cm",
        "note": "SoilGrids values are 250 m model predictions; sample points per zone are illustrative (ASSUMPTION).",
        "sample_points": pts.round(3).to_dict(orient="records"), "units": UNITS,
        "texture": "USDA texture triangle", "missing_values": int(pts.isna().sum().sum()),
    }, indent=1))
    print(zones.to_string(index=False))


if __name__ == "__main__":
    main()
