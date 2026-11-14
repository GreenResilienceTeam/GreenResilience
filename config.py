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


# ZONES. Weather comes from SiAR stations (measured); salinity and the urban offset are
# MODEL ESTIMATES. Reference: irrigated soils in Campo de Cartagena were measured at 2-10 dS/m.
#   stations   = SiAR stations whose daily data (mean of them) is the zone's weather
#   ece        = soil salinity (ECe, dS/m)                                   - estimate
#   dT_summer  = temperature offset (C) added to the station data in SUMMER_MONTHS - estimate
#   dT_winter  = temperature offset (C) added in all other months            - estimate
#   saline_water_available = True if saline/seawater irrigation (~30 g/L) is available (needed by
#                            Salicornia). Coast = True is an ASSUMPTION ("seawater assumed available").
SUMMER_MONTHS = [5, 6, 7, 8, 9, 10]  # May-Oct = warm half of the year
ZONES = {
    # MU120 stands on the Mar Menor shore, so the coast climate is measured (no offset needed)
    "Coast": {"stations": ["MU120"], "ece": 6.0, "dT_summer": 0.0, "dT_winter": 0.0, "saline_water_available": True},
    # no station inside the town: mean of coast + inland station, plus urban heat (+1 C, estimate)
    "Town": {"stations": ["MU120", "MU130"], "ece": 3.0, "dT_summer": 1.0, "dT_winter": 1.0, "saline_water_available": False},
    # MU130 El Mirador: fields west of San Javier
    "Inland farmland": {"stations": ["MU130"], "ece": 4.0, "dT_summer": 0.0, "dT_winter": 0.0, "saline_water_available": False},
}
YEARS = [2023, 2024, 2025]           # years of SiAR weather; scores are averaged over them

SALINE_WATER_LABEL = "seawater assumed available"   # shown in the app for zones with saline water
