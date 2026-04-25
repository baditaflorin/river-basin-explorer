import { DEFAULT_SETTINGS, LOCAL_STORAGE_KEYS, RIVER_COLOR_PRESETS } from "./config.js";

export function loadSettings() {
  const stored = readJson(LOCAL_STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    layerVisibility: {
      ...DEFAULT_SETTINGS.layerVisibility,
      ...(stored?.layerVisibility || {})
    }
  };
}

export function saveSettings(settings) {
  writeJson(LOCAL_STORAGE_KEYS.settings, settings);
}

export function loadSavedPalettes() {
  return readJson(LOCAL_STORAGE_KEYS.palettes) || {};
}

export function saveRiverPalette(ref, palette) {
  const palettes = loadSavedPalettes();
  palettes[ref] = palette;
  writeJson(LOCAL_STORAGE_KEYS.palettes, palettes);
  return palettes;
}

export function deleteRiverPalette(ref) {
  const palettes = loadSavedPalettes();
  delete palettes[ref];
  writeJson(LOCAL_STORAGE_KEYS.palettes, palettes);
  return palettes;
}

export function clearSavedPreferences() {
  safeRemove(LOCAL_STORAGE_KEYS.settings);
  safeRemove(LOCAL_STORAGE_KEYS.palettes);
}

export function defaultPaletteForRiver(ref) {
  const preset = RIVER_COLOR_PRESETS[hashRef(ref) % RIVER_COLOR_PRESETS.length];
  return { ...preset };
}

function hashRef(value) {
  return Array.from(value).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 0);
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    return null;
  }
  return value;
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    return null;
  }
  return true;
}
