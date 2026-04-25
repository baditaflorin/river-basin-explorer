# River Basin Explorer

OpenStreetMap-based river explorer for loading one or more rivers, showing the main stem, direct tributaries, second-order basin descendants, and a sampled elevation profile that can jump you back onto the map.

## Highlights

- Multi-river view: compare rivers such as Mureș and Olt side by side in the same map session.
- Shareable URLs: the current rivers, focused basin, map style, cache preference, and visible layers are encoded in the URL.
- Local user settings: river colors, map appearance, and loader preferences are saved in local storage and can be reset.
- Demo sample cache: prebuilt `data/samples/*.json` bundles can be loaded instantly for repeatable demos without hitting Overpass every time.
- Live basin loading: direct tributaries and upstream descendants are discovered from OpenStreetMap waterway geometry.
- Elevation profile: 10 sampled points from source to mouth, including source elevation, mouth elevation, total drop, and clickable profile samples that center the map.
- Basemap switching: OSM Standard, OSM Humanitarian, OpenTopoMap, and a blank dark background.
- Retry and backoff: configurable retry attempts from 4 to 9 for Overpass, Nominatim, and elevation requests.

## Run Locally

This app is a static site.

```bash
python3 -m http.server 4174
```

Then open:

```text
http://localhost:4174
```

## Repo Samples

Prebuilt demo bundles live in [`data/samples`](data/samples).

To rebuild them:

```bash
node scripts/build-sample-cache.mjs
```

Or rebuild a single sample:

```bash
node scripts/build-sample-cache.mjs mures-order2
node scripts/build-sample-cache.mjs olt-order2
```

The builder resolves the river from OpenStreetMap, downloads the main stem plus basin waterway tiles, samples elevation at 10 points, and writes a repo-local JSON bundle plus the manifest.

## Project Structure

- `src/api/`: Overpass, Nominatim, elevation, retry, sample loading, and local cache helpers.
- `src/geo/`: path ordering, length, endpoint inference, bounds, and basin classification.
- `src/ui/`: Leaflet map rendering and focus helpers.
- `src/preferences.js`: local settings and saved river palettes.
- `scripts/build-sample-cache.mjs`: repo sample generator for demo data.

## Data And Attribution

Map tiles and waterway data come from OpenStreetMap and are available under the Open Database License.

- OpenStreetMap attribution and license: <https://www.openstreetmap.org/copyright>
- Nominatim search: <https://nominatim.openstreetmap.org/>
- Overpass API: <https://overpass-api.de/>
- OpenTopoData elevation API: <https://www.opentopodata.org/>
- Author GitHub: <https://github.com/baditaflorin>
- Repository: <https://github.com/baditaflorin/river-basin-explorer>

## Notes

This is a geometry-driven classifier designed to stay generic across rivers worldwide rather than depending on a country-specific hydrological registry. Tributaries are classified by how their downstream endpoints connect to the main stem or to an already-classified tributary. Very large rivers can still need multiple Overpass tiles and may be limited by public API capacity, so the app supports both repo sample bundles and local browser cache reuse.
