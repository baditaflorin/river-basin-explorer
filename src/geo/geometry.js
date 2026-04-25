const EARTH_KM = 6371;

export function km(value) {
  return `${Math.round(value).toLocaleString("en-US")} km`;
}

export function meters(value) {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

export function haversineKm(a, b) {
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function lineLengthKm(points) {
  return points.reduce((total, point, index) => {
    if (index === 0) return total;
    return total + haversineKm(points[index - 1], point);
  }, 0);
}

export function collectionLengthKm(waterways) {
  return waterways.reduce((total, waterway) => total + lineLengthKm(waterway.points), 0);
}

export function boundsForWaterways(waterways) {
  const bounds = {
    south: Number.POSITIVE_INFINITY,
    west: Number.POSITIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY
  };

  waterways.forEach((waterway) => {
    waterway.points.forEach(([lat, lon]) => {
      bounds.south = Math.min(bounds.south, lat);
      bounds.west = Math.min(bounds.west, lon);
      bounds.north = Math.max(bounds.north, lat);
      bounds.east = Math.max(bounds.east, lon);
    });
  });

  return bounds;
}

export function expandBounds(bounds, degrees) {
  return {
    south: Math.max(-89.9, bounds.south - degrees),
    west: Math.max(-179.9, bounds.west - degrees),
    north: Math.min(89.9, bounds.north + degrees),
    east: Math.min(179.9, bounds.east + degrees)
  };
}

export function splitBounds(bounds, tileSizeDeg = 2) {
  const tiles = [];
  for (let south = bounds.south; south < bounds.north; south += tileSizeDeg) {
    for (let west = bounds.west; west < bounds.east; west += tileSizeDeg) {
      tiles.push({
        south,
        west,
        north: Math.min(bounds.north, south + tileSizeDeg),
        east: Math.min(bounds.east, west + tileSizeDeg)
      });
    }
  }
  return tiles;
}

export function inferFlowEndpoints(waterways) {
  const starts = waterways.map((waterway) => waterway.points[0]).filter(Boolean);
  const ends = waterways.map((waterway) => waterway.points.at(-1)).filter(Boolean);
  const startCandidates = starts.length ? starts : endpoints(waterways);
  const endCandidates = ends.length ? ends : endpoints(waterways);

  let best = {
    source: startCandidates[0],
    mouth: endCandidates[0],
    distanceKm: 0
  };

  startCandidates.forEach((source) => {
    endCandidates.forEach((mouth) => {
      const distanceKm = haversineKm(source, mouth);
      if (distanceKm > best.distanceKm) best = { source, mouth, distanceKm };
    });
  });

  return best;
}

function endpoints(waterways) {
  return waterways.flatMap((waterway) => [waterway.points[0], waterway.points.at(-1)]).filter(Boolean);
}

export function distancePointToLineM(point, linePoints) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < linePoints.length; index += 1) {
    best = Math.min(best, distancePointToSegmentM(point, linePoints[index - 1], linePoints[index]));
  }
  return best;
}

export function distancePointToWaterwaysM(point, waterways) {
  return waterways.reduce((best, waterway) => {
    return Math.min(best, distancePointToLineM(point, waterway.points));
  }, Number.POSITIVE_INFINITY);
}

export function distancePointToSegmentM(point, start, end) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((point[0] * Math.PI) / 180);
  const px = point[1] * metersPerDegreeLon;
  const py = point[0] * metersPerDegreeLat;
  const ax = start[1] * metersPerDegreeLon;
  const ay = start[0] * metersPerDegreeLat;
  const bx = end[1] * metersPerDegreeLon;
  const by = end[0] * metersPerDegreeLat;
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
