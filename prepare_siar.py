"""Clean the SiAR station downloads into one tidy daily table (+ a provenance file).

Input : data/raw/siar/MU*.csv   (exported from servicio.mapa.gob.es/siarweb, daily data,
                                 Latin-1, ';' separator, decimal comma)
Output: data/yearly/siar_daily.csv   one row per station per day
        data/yearly/siar_meta.json   source, stations, units, date range, missing values
Run:    python prepare_siar.py      (only rebuilds when a raw file changed)
"""
import hashlib
import json
from datetime import date

import pandas as pd

from config import DATA_DIR, load_daily

RAW_DIR = DATA_DIR / "raw" / "siar"
OUT_CSV = DATA_DIR / "yearly" / "siar_daily.csv"
OUT_META = DATA_DIR / "yearly" / "siar_meta.json"

# SiAR stations used (Region de Murcia, network of the Ministry MAPA / IMIDA)
STATIONS = {
    "MU120": {"name": "San Javier (Santiago de la Ribera)", "role": "coast reference (Mar Menor shore)"},
    "MU130": {"name": "San Javier (El Mirador)", "role": "inland farmland reference"},
    "MU128": {"name": "Torre Pacheco (Torre Pacheco)", "role": "second inland reference (Campo de Cartagena)"},
}
# SiAR column name -> our column name (units in UNITS)
COLUMNS = {"Fecha": "date", "Temp Media (ºC)": "t_mean_C", "Temp Max (ºC)": "t_max_C", "Temp Mín (ºC)": "t_min_C",
           "Precip (mm)": "precip_mm", "P. Efect (mm)": "precip_eff_mm", "ET0 (mm)": "et0_mm"}
UNITS = {"t_mean_C": "degC (daily mean)", "t_max_C": "degC (daily max)", "t_min_C": "degC (daily min)",
         "precip_mm": "mm/day", "precip_eff_mm": "mm/day (effective precipitation, computed by SiAR)",
         "et0_mm": "mm/day (reference evapotranspiration, FAO-56 Penman-Monteith, computed by SiAR)"}


DONOR = "MU120"   # the station with the fewest gaps fills the others
GAP_METHOD = (
    "Empty days are filled and flagged in column 'filled_from' (raw values are never changed). "
    "1) From the donor station MU120: temperatures + monthly mean offset, ET0 x monthly ratio "
    "(offset/ratio computed on days where both stations have data); rain copied as-is. "
    "2) Days with no station data: temperature and rain from the NASA SMAP L4 2025 cell "
    "(data/daily.csv), effective rain = 0, ET0 linearly interpolated.")
VALUES = list(UNITS)


def fill_gaps(data):
    """Fill empty days station by station; return the table and a count of filled days per source."""
    data = data.copy()
    data["filled_from"] = ""
    wide = {c: data.pivot(index="date", columns="station", values=c) for c in VALUES}
    counts = {}
    for st in data["station"].unique():
        rows = data["station"] == st
        gap = data.loc[rows, "et0_mm"].isna().to_numpy()
        if not gap.any():
            continue
        days = data.loc[rows, "date"]
        if st != DONOR:   # 1) donor station with a monthly correction
            both = wide["et0_mm"][[st, DONOR]].dropna()
            month = both.index.month
            for c in VALUES:
                pair = wide[c][[st, DONOR]].loc[both.index]
                donor_vals = wide[c][DONOR].reindex(days).to_numpy()
                m = days.dt.month.to_numpy()
                if c.startswith("t_"):      # temperature: add monthly offset
                    corr = (pair[st] - pair[DONOR]).groupby(month).mean()
                    new = donor_vals + corr.reindex(m).to_numpy()
                elif c == "et0_mm":          # ET0: multiply by monthly ratio
                    ratio = pair[st].groupby(month).sum() / pair[DONOR].groupby(month).sum()
                    new = donor_vals * ratio.reindex(m).to_numpy()
                else:                        # rain: copy
                    new = donor_vals
                idx = data.index[rows][gap & ~pd.isna(new)]
                data.loc[idx, c] = new[gap & ~pd.isna(new)].round(2)
            done = data.index[rows][gap] [data.loc[data.index[rows][gap], "et0_mm"].notna().to_numpy()]
            data.loc[done, "filled_from"] = f"{DONOR} (bias-corrected)"
            counts[f"{st} <- {DONOR}"] = int(len(done))
        # 2) still empty: NASA SMAP L4 2025 for temperature + rain, ET0 interpolated
        still = data.index[rows][data.loc[rows, "et0_mm"].isna().to_numpy()]
        if len(still):
            smap = load_daily().set_index("time")
            d = data.loc[still, "date"]
            data.loc[still, "t_mean_C"] = smap["temp_mean_C"].reindex(d).round(2).to_numpy()
            data.loc[still, "t_max_C"] = smap["temp_max_C"].reindex(d).round(2).to_numpy()
            data.loc[still, "t_min_C"] = smap["temp_min_C"].reindex(d).round(2).to_numpy()
            data.loc[still, "precip_mm"] = smap["precip_mm"].reindex(d).round(2).to_numpy()
            data.loc[still, "precip_eff_mm"] = 0.0
            et0 = data.loc[rows, "et0_mm"].interpolate(limit_direction="both")
            data.loc[still, "et0_mm"] = et0.loc[still].round(2)
            data.loc[still, "filled_from"] = "SMAP L4 2025 (temp, rain) + interpolated ET0"
            counts[f"{st} <- SMAP/interpolation"] = int(len(still))
    return data, counts


def raw_hash(files):
    """Fingerprint of the raw files, so we only rebuild when they change (cache)."""
    h = hashlib.sha256()
    for f in files:
        h.update(f.name.encode()); h.update(f.read_bytes())
    return h.hexdigest()


def main():
    files = sorted(RAW_DIR.glob("MU*.csv"))
    smap_file = DATA_DIR / "yearly" / "smap_daily.csv"          # used to fill days with no station data
    fingerprint = raw_hash(files + [smap_file])
    if OUT_META.exists() and json.loads(OUT_META.read_text()).get("raw_sha256") == fingerprint:
        print("SiAR data unchanged, using cache:", OUT_CSV)
        return

    tables, missing = [], {}
    for f in files:
        code = f.name.split("_")[0]                      # "MU120_..." -> "MU120"
        df = pd.read_csv(f, sep=";", decimal=",", encoding="latin-1")
        df = df.rename(columns=COLUMNS)[list(COLUMNS.values())]
        df["date"] = pd.to_datetime(df["date"], format="%d/%m/%Y")
        df.insert(0, "station", code)
        # check for missing days as well as empty cells
        all_days = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
        missing[code] = {"missing_days": int(len(all_days) - df["date"].nunique()),
                         **{c: int(df[c].isna().sum()) for c in UNITS}}
        tables.append(df)

    data = pd.concat(tables, ignore_index=True).sort_values(["station", "date"])
    data, filled = fill_gaps(data)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    data.to_csv(OUT_CSV, index=False, date_format="%Y-%m-%d")
    meta = {
        "source": "SiAR - Sistema de Informacion Agroclimatica para el Regadio (MAPA, Spain), "
                  "https://servicio.mapa.gob.es/siarweb/",
        "data_type": "daily", "downloaded": str(date.today()),
        "date_range": [str(data["date"].min().date()), str(data["date"].max().date())],
        "stations": {c: STATIONS.get(c, {}) for c in data["station"].unique()},
        "units": UNITS, "missing_values_in_raw_files": missing,
        "gap_filling": {"method": GAP_METHOD, "filled_days_by_source": filled},
        "raw_files": [f.name for f in files], "raw_sha256": fingerprint,
    }
    OUT_META.write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    print(f"Saved {len(data)} rows to {OUT_CSV}")


if __name__ == "__main__":
    main()
