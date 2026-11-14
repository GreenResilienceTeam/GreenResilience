"""Shared settings: where the data lives and the zone assumptions."""
from pathlib import Path

import pandas as pd

# The ONLY place a folder path is written: the data/ folder next to this file.
# Relative to the code, so it works locally and on Streamlit Community Cloud.
DATA_DIR = Path(__file__).parent / "data"


def find_file(pattern):
    """Return the first file in DATA_DIR whose name matches the pattern (e.g. 'Biology*.csv')."""
    matches = sorted(DATA_DIR.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No file matching '{pattern}' in {DATA_DIR}")
    return matches[0]


def load_daily():
    """NASA SMAP L4 daily point series for 2025 (first row 2024-12-31 is a partial day -> dropped)."""
    df = pd.read_csv(find_file("daily.csv"), parse_dates=["time"])
    df = df.iloc[1:].reset_index(drop=True)
    return df


# ZONES - MODEL ESTIMATES (not measured). Reference: irrigated soils in Campo de
# Cartagena were measured at 2-10 dS/m; the San Pedro values below are estimates.
#   ece        = soil salinity (ECe, dS/m)
#   dT_summer  = temperature offset (C) added in SUMMER_MONTHS
#   dT_winter  = temperature offset (C) added in all other months
#   saline_water = True if saline/seawater irrigation (~30 g/L) is available (needed by Salicornia)
SUMMER_MONTHS = [5, 6, 7, 8, 9, 10]  # May-Oct = warm half of the year
ZONES = {
    "Coast": {"ece": 6.0, "dT_summer": -1.5, "dT_winter": 1.0, "saline_water": False},  # sea breeze cools summer, warms winter
    "Town": {"ece": 3.0, "dT_summer": 1.0, "dT_winter": 1.0, "saline_water": False},  # urban heat island
    "Inland farmland": {"ece": 4.0, "dT_summer": 0.0, "dT_winter": 0.0, "saline_water": False},  # same as the SMAP cell
}
