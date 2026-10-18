# Terrain data sources (Dolomites look-dev)

Area: Passo Gardena / Sella group, Val Gardena side. Local frame origin is EPSG:25832 (714700, 5158400) ≈ 46.545 N, 11.800 E. x = east, z = north, y = altitude − 2000 m.

| Use | Dataset | Resolution | Licence / attribution | How it was fetched |
|---|---|---|---|---|
| Main terrain (the 4 km near level and the 16 km mid level) | Autonome Provinz Bozen – Südtirol, **DigitalTerrainModel-2.5m** | 2.5 m | CC0 1.0 (Provincia autonoma di Bolzano – Alto Adige) | WCS `https://geoservices9.civis.bz.it/geoserver/ows`, coverage `p_bz-Elevation__DigitalTerrainModel-2.5m`, via `tools/terrain/fetch_dtm.py` |
| Detail where available | Same provider, **DigitalTerrainModel-0.5m** | 0.5 m | CC0 1.0 | same WCS, coverage `p_bz-Elevation__DigitalTerrainModel-0.5m` |
| Distant ring and the Trentino/Veneto side | **Copernicus DEM GLO-30** (tiles N46E011, N46E012) | 30 m | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved (free licence for any use) | `https://copernicus-dem-30m.s3.amazonaws.com/` |
| Terrain detail textures | **ambientCG** Rock034, Rocks002, Grass004, Ground037, Gravel038 (2K) | 1024² per layer after packing | CC0 1.0 | `https://ambientcg.com/get?file=<Set>_2K-JPG.zip`, packed by `tools/terrain/pack_textures.py` |
| Building, fence, rail textures | **ambientCG** WoodSiding013, Planks037A, Plaster003, Bricks089, WoodSiding012, Metal062C (2K) | 1024² per layer | CC0 1.0 | packed by `tools/terrain/pack_textures.py props` |
| Canopy height (forest placement) | Autonome Provinz Bozen – Südtirol, **DigitalElevationModel-2.5m** (surface model) minus the DTM | 2.5 m | CC0 1.0 | same WCS, coverage `p_bz-Elevation__DigitalElevationModel-2.5m` |
| Road (SS243 over Passo Gardena), peaks, chapel | **OpenStreetMap** | — | © OpenStreetMap contributors, ODbL 1.0 | OSM API `map?bbox=11.76,46.525,11.82,46.56` |

## Notes and limits found

- The 0.5 m DTM covers only the **settlement areas** (it reaches about 1950 m here, 2.2 % of the near level). The pass itself (2121 m) and everything above come from the 2.5 m DTM, upsampled bicubically to 2 m. The procedural detail in the shader stands in for the missing sub-metre relief.
- The province's 2.5 m DTM stops at the provincial border, which runs through the Sella group. GLO-30 fills the rest, offset by the median difference along the seam and feathered over 60 texels. GLO-30 is a surface model, so forests make it slightly high.
- The old `geoservices1`/`geoservices.buergernetz.bz.it` WCS endpoints are disabled. `geoservices9.civis.bz.it` works but streams slowly, so the fetch script asks for 500 m tiles and retries.
- Trentino's own LiDAR (PAT, CC BY 4.0) could replace GLO-30 on the south side of the Sella if that side matters later.

Raw downloads live in `ref/terrain/dolomites/raw/` and `ref/terrain/corridor/raw/` (git-ignored), fetched by `tools/terrain/fetch_corridor_raw.py` (since 2026-10-17; the older look-dev scripts still name `edit/terrain/dolomites/raw/`). The game-ready files in `assets/maps/dolomites/` are rebuilt with `python3 tools/terrain/build_dolomites.py`.

## Step 01 corridor (Dolomites → Garda)

| Use | Dataset | Resolution | Licence / attribution | How it was fetched |
|---|---|---|---|---|
| Bolzano patch terrain and canopy | South Tyrol **DigitalTerrainModel-2.5m** and **DigitalElevationModel-2.5m** (EPSG:25832 672500–690000 E, 5141000–5156000 N) | 2.5 m | CC0 1.0 | `tools/terrain/fetch_dtm.py ... dtm25 / dsm25` |
| Garda patch terrain, corridor surroundings | **Copernicus DEM GLO-30**, tiles N45E010, N45E011, N46E010, N46E011 | 30 m | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA | `https://copernicus-dem-30m.s3.amazonaws.com/` |
| Forest cover where there is no laser canopy model (Garda patch, and outside the South Tyrol DSM box) | **ESA WorldCover 2021 v200** (tile N45E009), window 10.55–11.98 E, 45.70–46.78 N saved as `edit/terrain/corridor/raw/worldcover_corridor.tif`; tree class (10) → canopy | 10 m | © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, CC BY 4.0 | `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/` |
| Roads, landuse, buildings, castles (Val Gardena, Bolzano, north Garda) | **OpenStreetMap** | — | © OpenStreetMap contributors, ODbL 1.0 | `tools/terrain/fetch_osm.py` (main API, tiled) |

- GLO-30 is a surface model. For the Garda patch (Trentino; no open LiDAR WCS was reachable: the provincial `siat.provincia.tn.it` WCS publishes no terrain coverage) a grey opening over ~90 m approximates bare earth. It removes buildings and woods narrower than that; summits lose a few metres.
- The Trentino LiDAR (PAT, 1 m, CC BY 4.0) would improve the Garda patch; it is distributed as downloads, not WCS.
