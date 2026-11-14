"""Daily actual evapotranspiration (ETa) of the SMAP L4 cell for 2025.

Input : data/raw/smap/all_3hourly.csv  (NASA SMAP L4 SPL4SMGP v008, one 9 km cell, 3-hourly; not in git)
Output: data/yearly/smap_eta_daily_2025.csv + smap_eta_meta.json

Units (checked): land_evapotranspiration_flux is kg m-2 s-1, a time average over each 3-hour interval
(same convention as precipitation_total_surface_flux: x 10800 s gives the file's precip_mm_3h column).
1 kg/m2 of water = 1 mm, so daily ETa (mm/day) = mean flux of the day x 86400 s.
What it is: modelled ET of the whole 9 km cell (GEOS land model, rain-fed, no irrigation).
It is NOT the water need of an irrigated crop; we use it as a natural water-stress indicator (ETa / ET0).
Run: python prepare_smap_eta.py
"""
import json
from datetime import date

import pandas as pd

from config import DATA_DIR

RAW = DATA_DIR / "raw" / "smap" / "all_3hourly.csv"
OUT_CSV = DATA_DIR / "yearly" / "smap_eta_daily_2025.csv"
OUT_META = DATA_DIR / "yearly" / "smap_eta_meta.json"


def main():
    h = pd.read_csv(RAW, parse_dates=["time"])
    h = h[(h["time"] >= "2025-01-01") & (h["time"] < "2026-01-01")]   # 31 Dec 2024 22:30 = interval of 2024
    n_dupes = int(h["time"].duplicated().sum())
    h = h.groupby("time", as_index=False).mean(numeric_only=True)        # duplicated time stamps -> mean
    day = h["time"].dt.date
    daily = pd.DataFrame({
        "eta_mm": h.groupby(day)["land_evapotranspiration_flux"].mean() * 86400,   # mean flux x seconds per day
        "intervals": h.groupby(day).size(),
    })
    daily.index.name = "date"
    daily["eta_mm"] = daily["eta_mm"].round(3)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    daily.to_csv(OUT_CSV)
    OUT_META.write_text(json.dumps({
        "source": "NASA SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture "
                  "Geophysical Data (SPL4SMGP v008), variable land_evapotranspiration_flux",
        "created": str(date.today()), "units": {"eta_mm": "mm/day", "intervals": "3-hour intervals present that day"},
        "conversion": "flux (kg m-2 s-1, 3-hourly time average) -> daily mean x 86400 s; 1 kg m-2 = 1 mm",
        "meaning": "Actual ET of the whole 9 km cell from the land model (rain-fed, no irrigation). "
                   "Not a crop water requirement.",
        "data_issues": {"duplicated_time_stamps_averaged": n_dupes,
                        "days_with_fewer_than_8_intervals": {str(k): int(v) for k, v in daily["intervals"][daily["intervals"] < 8].items()},
                        "negative_intervals_note": "negative flux = dew/condensation, kept in the mean"},
        "annual_total_mm": round(float(daily["eta_mm"].sum()), 1),
    }, indent=1))
    print(f"Saved {len(daily)} days, ETa 2025 = {daily['eta_mm'].sum():.0f} mm -> {OUT_CSV}")


if __name__ == "__main__":
    main()
