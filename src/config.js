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
  cartoLight: {
    label: "CARTO Light",
    url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 19,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    background: "#f3f6f8"
  },
  cartoDark: {
    label: "CARTO Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 19,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    background: "#0c1620"
  },
  satellite: {
    label: "ESRI Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 19,
      attribution:
        'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    },
    background: "#0a1320"
  },
  blank: {
    label: "Blank / dark",
    background: "#03111f"
  },
  blankWhite: {
    label: "Blank / white",
    background: "#ffffff"
  }
};

export const RIVER_COLOR_PRESETS = [
  {
    main: "#1462a3",
    direct: "#3793d4",
    descendant: "#87c5ea",
    endpoint: "#e3f2fb"
  },
  {
    main: "#0a7e74",
    direct: "#20b3a8",
    descendant: "#82dbcd",
    endpoint: "#e0f9f4"
  },
  {
    main: "#06658c",
    direct: "#1e9ec3",
    descendant: "#82d3ed",
    endpoint: "#e0f5fb"
  },
  {
    main: "#2a3a8a",
    direct: "#4f63c4",
    descendant: "#98a4dc",
    endpoint: "#e7e9f6"
  },
  {
    main: "#1f5f3d",
    direct: "#3a9560",
    descendant: "#95cba6",
    endpoint: "#e6f5ec"
  },
  {
    main: "#b4501f",
    direct: "#df8245",
    descendant: "#f0b889",
    endpoint: "#fbeadb"
  },
  {
    main: "#5b3a7a",
    direct: "#8b62b5",
    descendant: "#c4a2da",
    endpoint: "#efe6f6"
  }
];
