# Green Resilience — NASA Space Apps, theme "Field Shift"

An interactive Streamlit app that scores how well 10 crops fit three zones around
**San Pedro del Pinatar (Murcia, Spain)**, finds the best planting date for each crop,
and shows how the answer changes when the climate shifts (warming of up to +4 °C,
rain down to 60%).

For each crop, zone and planting date, the model scores **temperature** (daily mean vs.
the crop's optimum), **water** (seasonal need vs. rain, i.e. the irrigation needed) and
**soil salinity** (FAO yield-loss curve). It combines the three with a geometric mean
into a single **match %**.

## Run locally

```bash
pip install -r requirements.txt
python precompute.py      # (re)builds data/results.csv and data/best_windows.csv
python export_ui_data.py  # (re)builds data/ui_data.json for the interface
python test_scoring.py    # sanity tests -> "ALL TESTS PASSED"
streamlit run app.py
```

On Streamlit Community Cloud, set the main file to `app.py`. The precomputed results are
already in `data/`.

## Files

- `config.py`: data path (`data/`) and zone assumptions
- `crops.py`: cleans the crop tables into numeric parameters
- `scoring.py`: the model
- `precompute.py`: all crops × zones × planting weeks → CSVs
- `test_scoring.py`: tests
- `export_ui_data.py`: runs the model for every crop × zone × week × Field Shift step → `data/ui_data.json`
- `app.py`: Streamlit app that shows the designed interface full screen
- `ui/`: the interface (HTML, CSS, JS) built from the team's design files in `design/`
- `ui/i18n.js`: all interface texts in English and Spanish (language switch in the menu)
- `assets/photos/`: crop photos (Creative Commons, credits in `assets/photos/CREDITS.md`)

## Data sources

- **NASA SMAP L4** Global 3-hourly 9 km Surface and Root Zone Soil Moisture Geophysical Data
  (**SPL4SMGP v008**), one cell over San Pedro del Pinatar, 2023–2025: root-zone soil moisture
  (water in the soil at planting), natural ET, rain and temperature (`prepare_smap.py` →
  `data/yearly/smap_daily.csv`; `data/daily.csv` is the first 2025 extract).
- **SiAR weather stations** (Spanish Ministry of Agriculture) MU120, MU130, MU128, daily 2023–2025:
  temperature, rain, effective rain, reference evaporation ET₀ (`prepare_siar.py`).
- **ISRIC SoilGrids**: soil texture, pH and organic carbon per zone (`prepare_soil.py`).
- **Crop requirements:** our team's biologists' crop table (`data/Biology_Data_Table_-_Sheet1.csv`),
  plus FAO-56 crop coefficients, degree-days and pH ranges in `data/crop_params_extra.csv`.
- **Salinity tolerance:** FAO Irrigation and Drainage Paper (threshold + slope, Maas–Hoffman),
  in `data/crops_extra.csv`.

## AI tools

- **Claude Code** (Anthropic): AI coding assistant, used to help write the model and the app code.

## Limitations

SMAP has a 9 km resolution, so one grid cell covers all zones; it is used for soil moisture
and natural ET, not for differences between zones. Soil salinity cannot be measured by
satellite, so the zone ECe values are estimates; irrigated soils in Campo de Cartagena have
been measured at 2–10 dS/m. Weather covers 2023–2025 (three years), and crop cycle lengths
and some crop parameters are approximate.
