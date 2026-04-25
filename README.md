# River Basin Explorer

Generic OpenStreetMap-based river basin explorer for finding a river, showing its mapped course, and loading nearby direct tributaries plus upstream descendants.

## What It Does

- Searches OpenStreetMap river records with indexed Overpass lookups and Nominatim-assisted fallback.
- Loads the selected river geometry from Overpass API.
- Infers source and mouth candidates from OSM waterway direction and endpoint distance.
- Loads surrounding waterway shapes in tiled Overpass requests.
- Classifies waterways as direct tributaries or upstream descendants by outlet proximity.
- Uses configurable retry attempts from 4 to 9 with exponential backoff, jitter, and retry handling for throttling.
- Keeps the code modular across API, retry, geometry, classification, and map UI modules.

## Run Locally

This is a static site:

```bash
python3 -m http.server 4174
```

Open:

```text
http://localhost:4174
```

## Data And Attribution

Map tiles and waterway data come from OpenStreetMap and are available under the Open Database License.

- OpenStreetMap attribution and license: <https://www.openstreetmap.org/copyright>
- Nominatim search: <https://nominatim.openstreetmap.org/>
- Overpass API: <https://overpass-api.de/>
- Author GitHub: <https://github.com/baditaflorin>
- Repository: <https://github.com/baditaflorin/river-basin-explorer>

## Notes

This is a geometry-based classifier. For worldwide generality it does not depend on a country-specific hydrological registry. It classifies tributaries by testing whether a waterway endpoint is near the main river or near an already-classified tributary. Very large rivers can produce many Overpass tiles and may be rate-limited by public API capacity, so the app keeps searches indexed and basin loading tiled.
