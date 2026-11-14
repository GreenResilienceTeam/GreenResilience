"""Run the model for every crop x zone x planting week (default climate, no shift).

Writes results.csv and best_windows.csv next to the data. The app reads them for speed.
"""
import pandas as pd

from config import DATA_DIR, ZONES
from scoring import get_crops, scan_year

COLUMNS = ["crop", "zone", "planting_date", "match", "temp_score", "water_score",
           "salt_score", "irrigation_mm", "expected_yield_pct", "in_planting_months"]

all_rows, best_rows = [], []
for crop in get_crops().index:
    for zone in ZONES:
        weeks = scan_year(crop, zone)
        weeks["zone"] = zone
        all_rows.append(weeks[COLUMNS])
        # best window = best week inside the allowed planting months
        best = weeks.loc[weeks[weeks["in_planting_months"]]["match"].idxmax()]
        best_rows.append({"crop": crop, "zone": zone, "best_date": best["planting_date"],
                          "harvest_date": best["harvest_date"], "match": best["match"]})

results = pd.concat(all_rows, ignore_index=True)
results.to_csv(DATA_DIR / "results.csv", index=False)
pd.DataFrame(best_rows).to_csv(DATA_DIR / "best_windows.csv", index=False)
print(f"Saved {len(results)} rows to results.csv and {len(best_rows)} rows to best_windows.csv")
