# Extra crop parameters (for biologists to check)

`crop_params_extra.csv` adds what the biologists' table does not contain but the improved model needs.
The biologists' table itself is unchanged. Each row has a `source` and a `confidence` column.

| Column | Meaning | Used for |
|---|---|---|
| `t_base_C` | base temperature: no growth below it | growing degree days (GDD) |
| `gdd_to_harvest_Cd` | heat needed from planting to harvest (°C·days above `t_base_C`) | cycle length from temperature (empty = keep fixed cycle) |
| `kc_ini`, `kc_mid`, `kc_end` | FAO-56 crop coefficients | crop water need = Kc × ET₀ (SiAR) |
| `stage_ini` … `stage_late` | share of the cycle in each growth stage (sums to 1) | when to use which Kc |
| `root_depth_m`, `p_depletion` | max rooting depth; share of available soil water used before stress | soil water storage (with field capacity per zone) |
| `ph_opt_min/max`, `ph_tol_min/max` | optimal and tolerated soil pH (practical ranges for calcareous Mediterranean soils with fertigation: tomato, melon and citrus are grown here at pH ≈ 8) | soft pH factor: 1 inside the optimum, falls to 0.5 at the tolerance limit, never below 0.3 |

**Please check first (lowest confidence):**
- GDD totals for melon (1100) and radish (350, base 5 °C): estimates.
- Sea asparagus: Kc from one field study (Iran); stages, roots and pH are assumptions.
- Strawberry stage shares: assumed (FAO-56 gives Kc but not stage lengths).
- pH ranges: general extension guidance, not one database (FAO ECOCROP is no longer online).

Main sources:
- Allen, Pereira, Raes & Smith (1998), *Crop evapotranspiration*, FAO Irrigation and Drainage Paper 56, Tables 11, 12 and 22.
- Glenn et al. (1997), *Water requirements for cultivating Salicornia bigelovii with seawater on sand in a coastal desert environment*, Journal of Arid Environments.
- AREEO, *Water requirement and crop coefficient of two Salicornia species in Yazd* (article 122582).
- US extension degree-day guidance (base 50 °F = 10 °C for tomato and bean).
