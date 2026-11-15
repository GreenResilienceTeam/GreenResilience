"""NASA SMAP L4 (SPL4SMGP v008), one 9 km cell over San Pedro del Pinatar: 3-hourly -> daily, 2023-2025.

Input : data/raw/smap/all_3hourly_multiyear.csv   (3-hourly, kept out of git)
Output: data/yearly/smap_daily.csv  + smap_meta.json

Per day: mean root-zone and surface soil moisture (m3/m3), mean / min / max temperature (C),
rain and actual evapotranspiration ETa (mm/day). Fluxes are kg m-2 s-1 averaged over each
3-hour interval; 1 kg/m2 = 1 mm, so mm/day = mean flux of the day x 86400 s (a day with a
missing interval is not under-counted). Duplicated time stamps are averaged.
ETa is the modelled, rain-fed ET of the whole cell (no irrigation), not a crop's water need.
Run: python prepare_smap.py
"""
import json
from datetime import date

import pandas as pd

from config import DATA_DIR

RAW = DATA_DIR / "raw" / "smap" / "all_3hourly_multiyear.csv"
OUT_CSV = DATA_DIR / "yearly" / "smap_daily.csv"
OUT_META = DATA_DIR / "yearly" / "smap_meta.json"
FIRST, LAST = "2023-01-01", "2025-12-31"


def main():
    h = pd.read_csv(RAW, parse_dates=["time"])
    # 22:30 on 31 Dec 2022 is the last interval of 2022: keep only 2023-2025
    h = h[(h["time"] >= FIRST) & (h["time"] < "2026-01-01")]
    n_dupes = int(h["time"].duplicated().sum())
    h = h.groupby("time", as_index=False).mean(numeric_only=True)          # duplicated stamps -> mean
    day = h["time"].dt.normalize()
    g = h.groupby(day)
    daily = pd.DataFrame({
        "temp_mean_C": g["temp_C"].mean(), "temp_min_C": g["temp_C"].min(), "temp_max_C": g["temp_C"].max(),
        "precip_mm": g["precipitation_total_surface_flux"].mean() * 86400,
        "eta_mm": g["land_evapotranspiration_flux"].mean() * 86400,
        "sm_surface": g["sm_surface"].mean(), "sm_rootzone": g["sm_rootzone"].mean(),
        "intervals": g.size(),
    })
    # every calendar day, gaps filled by straight-line interpolation and flagged
    days = pd.date_range(FIRST, LAST, freq="D")
    daily = daily.reindex(days)
    missing = daily["intervals"].isna()
    daily["intervals"] = daily["intervals"].fillna(0).astype(int)
    daily = daily.interpolate(limit_direction="both")
    daily["filled"] = missing
    daily.index.name = "time"
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    daily.round({"temp_mean_C": 2, "temp_min_C": 2, "temp_max_C": 2, "precip_mm": 3, "eta_mm": 3,
                 "sm_surface": 4, "sm_rootzone": 4}).to_csv(OUT_CSV, date_format="%Y-%m-%d")

    yearly = daily.groupby(daily.index.year).agg(rain_mm=("precip_mm", "sum"), eta_mm=("eta_mm", "sum"),
                                                 sm_rootzone=("sm_rootzone", "mean"), temp_C=("temp_mean_C", "mean"))
    OUT_META.write_text(json.dumps({
        "source": "NASA SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture "
                  "Geophysical Data (SPL4SMGP v008), one cell over San Pedro del Pinatar",
        "created": str(date.today()), "date_range": [FIRST, LAST],
        "units": {"temp_*_C": "degC (from temp_C, lowest model layer)", "precip_mm": "mm/day", "eta_mm": "mm/day (actual ET, rain-fed cell)",
                  "sm_surface": "m3/m3 (0-5 cm)", "sm_rootzone": "m3/m3 (0-100 cm)", "intervals": "3-hour intervals present"},
        "conversion": "flux kg m-2 s-1 (3-hourly mean) -> daily mean x 86400 s; 1 kg m-2 = 1 mm",
        "data_issues": {"duplicated_time_stamps_averaged": n_dupes,
                        "days_with_fewer_than_8_intervals": int((daily["intervals"].between(1, 7)).sum()),
                        "days_with_no_data_interpolated": int(missing.sum())},
        "yearly": {int(y): {k: round(float(v), 3) for k, v in r.items()} for y, r in yearly.iterrows()},
    }, indent=1))
    print(f"Saved {len(daily)} days -> {OUT_CSV}")
    print(yearly.round(3).to_string())


if __name__ == "__main__":
    main()
