import { collectionLengthKm, distancePointToSegmentM } from "./geometry.js";

const METERS_PER_DEGREE = 111320;

export function classifyBasin(waterways, mainWaterways, options = {}) {
  const toleranceM = options.toleranceM ?? 900;
  const maxOrder = options.maxOrder ?? 2;
  const mainIds = new Set(mainWaterways.map((waterway) => waterway.id));
  const remaining = waterways.filter((waterway) => !mainIds.has(waterway.id));
  const direct = [];
  const descendants = [];
  let frontier = mainWaterways;

  for (let order = 1; order <= maxOrder; order += 1) {
    const attached = [];
    const index = createSegmentIndex(frontier, toleranceM);

    remaining.forEach((waterway) => {
      if (waterway.basinOrder) return;
      const outlet = waterway.points.at(-1);
      const inlet = waterway.points[0];
      const outletDistance = Math.min(
        distancePointToIndexedSegmentsM(outlet, index),
        distancePointToIndexedSegmentsM(inlet, index)
      );

      if (outletDistance <= toleranceM) {
        waterway.basinOrder = order;
        waterway.outletDistanceM = outletDistance;
        attached.push(waterway);
      }
    });

    if (!attached.length) break;

    if (order === 1) {
      direct.push(...attached);
    } else {
      descendants.push(...attached);
    }
    frontier = attached;
  }

  return {
    direct,
    descendants,
    unclassified: remaining.filter((waterway) => !waterway.basinOrder),
    stats: {
      directCount: direct.length,
      descendantCount: descendants.length,
      waterwayCount: direct.length + descendants.length,
      directKm: collectionLengthKm(direct),
      descendantKm: collectionLengthKm(descendants),
      totalKm: collectionLengthKm(direct) + collectionLengthKm(descendants)
    }
  };
}

function createSegmentIndex(waterways, toleranceM) {
  const cellDeg = Math.max(0.02, (toleranceM / METERS_PER_DEGREE) * 4);
  const cells = new Map();

  waterways.forEach((waterway) => {
    for (let index = 1; index < waterway.points.length; index += 1) {
      const start = waterway.points[index - 1];
      const end = waterway.points[index];
      const lat = (start[0] + end[0]) / 2;
      const lonBuffer = degreeBuffer(toleranceM, lat, true);
      const latBuffer = degreeBuffer(toleranceM, lat, false);
      const segment = {
        id: `${waterway.id}:${index}`,
        start,
        end
      };

      forEachCell(
        {
          south: Math.min(start[0], end[0]) - latBuffer,
          north: Math.max(start[0], end[0]) + latBuffer,
          west: Math.min(start[1], end[1]) - lonBuffer,
          east: Math.max(start[1], end[1]) + lonBuffer
        },
        cellDeg,
        (key) => {
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(segment);
        }
      );
    }
  });

  return { cells, cellDeg };
}

function distancePointToIndexedSegmentsM(point, index) {
  if (!point) return Number.POSITIVE_INFINITY;

  const latCell = Math.floor(point[0] / index.cellDeg);
  const lonCell = Math.floor(point[1] / index.cellDeg);
  const seen = new Set();
  let best = Number.POSITIVE_INFINITY;

  for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
    for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
      const segments = index.cells.get(cellKey(latCell + latOffset, lonCell + lonOffset)) || [];
      segments.forEach((segment) => {
        if (seen.has(segment.id)) return;
        seen.add(segment.id);
        best = Math.min(best, distancePointToSegmentM(point, segment.start, segment.end));
      });
    }
  }

  return best;
}

function forEachCell(bounds, cellDeg, callback) {
  const south = Math.floor(bounds.south / cellDeg);
  const north = Math.floor(bounds.north / cellDeg);
  const west = Math.floor(bounds.west / cellDeg);
  const east = Math.floor(bounds.east / cellDeg);

  for (let lat = south; lat <= north; lat += 1) {
    for (let lon = west; lon <= east; lon += 1) {
      callback(cellKey(lat, lon));
    }
  }
}

function cellKey(lat, lon) {
  return `${lat}:${lon}`;
}

function degreeBuffer(toleranceM, lat, longitude = false) {
  if (!longitude) return toleranceM / METERS_PER_DEGREE;
  const cosLat = Math.max(0.2, Math.abs(Math.cos((lat * Math.PI) / 180)));
  return toleranceM / (METERS_PER_DEGREE * cosLat);
}
