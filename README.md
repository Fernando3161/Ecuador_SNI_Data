# Ecuador SNI Data

A desktop dashboard prototype for exploring the 2022 PyPSA model of mainland Ecuador’s *Sistema Nacional Interconectado* (SNI). The home page opens on an interactive transmission map, with annual generation, demand, and cross-border exchanges available in the results views.

## Explore the dashboard

| View | What you can do |
| --- | --- |
| **Explorer** | Pan and zoom around mainland Ecuador, filter transmission lines by voltage, and inspect buses, lines, and transformers. Switch to **Annual Generation** to see domestic generation by bus and dominant technology. |
| **2022 Results** | Explore annual generation and demand, peak hourly demand, imports, exports, and unserved energy. Compare the modeled supply mix with the CENACE reference. |
| **Power Plants** | Search by plant name, model ID, or province. Filter by technology and sort by annual generation. |
| **Data & Methods** | Download the annual tables and review the sources, calculation methods, and scope of the CENACE comparison. |

## 2022 model at a glance

| Indicator | Modeled value |
| --- | ---: |
| Domestic generation | 27,287.36 GWh |
| Domestic demand | 27,561.62 GWh |
| Peak hourly demand | 4,388.06 MW |
| Net imports | 274.26 GWh |

The dashboard publishes annual aggregates for the 2022 simulation. Transmission lines show schematic connections between modeled buses. The CENACE comparison covers annual supply categories, with the documented statistical gap reported separately.

## Data and provenance

- [System indicators](data/sni-2022-kpis.csv) include annual energy totals, peak demand, and the energy balance.
- [Supply mix](data/sni-2022-supply-mix.csv) contains modeled and CENACE reference values in GWh, shares, and differences in percentage points.
- [Generation by plant](data/sni-2022-power-plants.csv) contains model IDs, technologies, source provinces, annual generation, and shares of domestic generation.

The [Zenodo archive](https://doi.org/10.5281/zenodo.23726852) documents the completed EcuadorElectricGrid run and is licensed under CC BY 4.0. The dashboard uses [versioned Notebook 06A outputs](https://github.com/Fernando3161/EcuadorElectricGrid/tree/1cdf2788043619dbf2c779a6435ca2b82cb23adc/results/phase_06a) for plant generation and system indicators. Plant-level annual generation sums the twelve monthly energy totals. See the [EcuadorElectricGrid model repository](https://github.com/Fernando3161/EcuadorElectricGrid) for the modeling workflow.

The geographic basemap uses [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) and relief derived from [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).

## Run locally

Serve the repository root over HTTP to load the dashboard and its bundled data.

```sh
git clone https://github.com/Fernando3161/Ecuador_SNI_Data.git
cd Ecuador_SNI_Data
python -m http.server 8000
```

Open [localhost:8000](http://localhost:8000/) in a desktop browser.

## Publish with GitHub Pages

In **Settings → Pages**, select **Deploy from a branch**, choose `main` and `/(root)`, and save. The site is served at [fernando3161.github.io/Ecuador_SNI_Data](https://fernando3161.github.io/Ecuador_SNI_Data/) once Pages completes deployment.
