export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const SAMPLE_MANIFEST_PATH = "data/samples/manifest.json";
export const DATA_CACHE_NAME = "river-basin-explorer-data-v2";

export const WATERWAY_PATTERN = "^(river|stream|canal|drain|ditch)$";

export const DEFAULT_LAYER_VISIBILITY = {
  main: true,
  direct: true,
  descendant: true,
  points: true
};

export const DEFAULT_SETTINGS = {
  retryAttempts: 6,
  toleranceM: 900,
  maxOrder: 2,
  paddingDeg: 0.25,
  basemap: "standard",
  preferSampleCache: true,
  preferLocalCache: true,
  layerVisibility: DEFAULT_LAYER_VISIBILITY
};

export const LOCAL_STORAGE_KEYS = {
  settings: "river-basin-explorer:settings",
  palettes: "river-basin-explorer:palettes"
};

export const APP_LINKS = {
  github: "https://github.com/baditaflorin/river-basin-explorer",
  author: "https://github.com/baditaflorin",
  osmCopyright: "https://www.openstreetmap.org/copyright"
};

export const BASEMAPS = {
  standard: {
    label: "OSM Standard",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    },
    background: "#dbeefe"
  },
  humanitarian: {
    label: "OSM Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, style by Humanitarian OpenStreetMap Team'
    },
    background: "#dbeefe"
  },
  topo: {
    label: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 17,
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
    },
    background: "#dce9e3"
  },
  blank: {
    label: "Blank / dark",
    background: "#03111f"
  }
};

export const RIVER_COLOR_PRESETS = [
  {
    main: "#1557a6",
    direct: "#2788cf",
    descendant: "#73c0ea",
    endpoint: "#dff4ff"
  },
  {
    main: "#146b84",
    direct: "#1f9ab3",
    descendant: "#77d5df",
    endpoint: "#defbfd"
  },
  {
    main: "#254d9f",
    direct: "#3f7fe0",
    descendant: "#8fb5ff",
    endpoint: "#e8f0ff"
  },
  {
    main: "#0f6a6d",
    direct: "#2aa4a0",
    descendant: "#8de1d0",
    endpoint: "#e9fffa"
  },
  {
    main: "#1f5e8a",
    direct: "#4798cb",
    descendant: "#9bd3f2",
    endpoint: "#eef9ff"
  },
  {
    main: "#315e91",
    direct: "#4c95c8",
    descendant: "#95caed",
    endpoint: "#ecf6ff"
  }
];
