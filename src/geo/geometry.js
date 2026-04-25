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

export function mergeWaterwaysIntoPath(waterways, endpoints = null) {
  const segments = waterways
    .filter((waterway) => waterway.points?.length > 1)
    .map((waterway) => ({
      id: waterway.id,
      points: waterway.points.map((point) => [...point])
    }));

  if (!segments.length) return [];
  if (segments.length === 1) return dedupeSequentialPoints(segments[0].points);

  const guessed = endpoints || inferFlowEndpoints(waterways);
  const nodes = new Map();
  const adjacency = new Map();

  segments.forEach((segment, index) => {
    segment.startKey = pointKey(segment.points[0]);
    segment.endKey = pointKey(segment.points.at(-1));
    segment.lengthKm = lineLengthKm(segment.points);

    nodes.set(segment.startKey, segment.points[0]);
    nodes.set(segment.endKey, segment.points.at(-1));
    addAdjacency(adjacency, segment.startKey, index);
    addAdjacency(adjacency, segment.endKey, index);
  });

  const sourceKey = nearestNodeKey(nodes, guessed.source) || segments[0].startKey;
  const mouthKey = nearestNodeKey(nodes, guessed.mouth) || segments[0].endKey;
  const bestPath = findBestSegmentPath(sourceKey, mouthKey, segments, adjacency, nodes);

  if (bestPath.indices.length) {
    return dedupeSequentialPoints(buildPathFromSegments(bestPath.indices, bestPath.startKey, segments));
  }

  return dedupeSequentialPoints(greedyPathFallback(segments, guessed.source || segments[0].points[0]));
}

export function samplePointsAlongPath(points, sampleCount = 10) {
  if (!points.length) return [];

  if (points.length === 1) {
    return Array.from({ length: sampleCount }, (_, index) => ({
      index,
      fraction: sampleCount === 1 ? 0 : index / (sampleCount - 1),
      distanceKm: 0,
      point: [...points[0]]
    }));
  }

  const segmentLengths = [];
  let totalKm = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLengthKm = haversineKm(points[index - 1], points[index]);
    segmentLengths.push(segmentLengthKm);
    totalKm += segmentLengthKm;
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const fraction = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const targetKm = totalKm * fraction;
    let walkedKm = 0;

    for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
      const segmentLengthKm = segmentLengths[segmentIndex - 1];
      const nextWalkedKm = walkedKm + segmentLengthKm;

      if (targetKm <= nextWalkedKm || segmentIndex === points.length - 1) {
        const ratio = segmentLengthKm === 0 ? 0 : (targetKm - walkedKm) / segmentLengthKm;
        return {
          index,
          fraction,
          distanceKm: targetKm,
          point: interpolatePoint(points[segmentIndex - 1], points[segmentIndex], ratio)
        };
      }

      walkedKm = nextWalkedKm;
    }

    return {
      index,
      fraction,
      distanceKm: totalKm,
      point: [...points.at(-1)]
    };
  });
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

function interpolatePoint(a, b, ratio) {
  return [
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio
  ];
}

function addAdjacency(adjacency, key, segmentIndex) {
  const bucket = adjacency.get(key) || [];
  bucket.push(segmentIndex);
  adjacency.set(key, bucket);
}

function pointKey(point, precision = 6) {
  return `${point[0].toFixed(precision)},${point[1].toFixed(precision)}`;
}

function nearestNodeKey(nodes, targetPoint) {
  if (!targetPoint) return null;

  let bestKey = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  nodes.forEach((point, key) => {
    const distanceKm = haversineKm(point, targetPoint);
    if (distanceKm < bestDistance) {
      bestDistance = distanceKm;
      bestKey = key;
    }
  });
  return bestKey;
}

function findBestSegmentPath(preferredSourceKey, preferredMouthKey, segments, adjacency, nodes) {
  const preferred = longestPathBetween(preferredSourceKey, preferredMouthKey, segments, adjacency);
  if (preferred.indices.length) {
    return {
      ...preferred,
      startKey: preferredSourceKey
    };
  }

  const terminalKeys = Array.from(nodes.keys()).filter((key) => (adjacency.get(key)?.length || 0) <= 1);
  const candidates = terminalKeys.length >= 2 ? terminalKeys : Array.from(nodes.keys());
  let best = {
    indices: [],
    totalKm: 0,
    startKey: preferredSourceKey
  };

  for (let index = 0; index < candidates.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const startKey = candidates[index];
      const endKey = candidates[otherIndex];
      const result = longestPathBetween(startKey, endKey, segments, adjacency);

      if (result.totalKm > best.totalKm) {
        best = {
          ...result,
          startKey
        };
      }
    }
  }

  return best;
}

function longestPathBetween(sourceKey, targetKey, segments, adjacency) {
  if (!sourceKey || !targetKey) {
    return {
      indices: [],
      totalKm: 0
    };
  }

  const used = new Set();
  const path = [];
  let best = {
    indices: [],
    totalKm: 0
  };

  function visit(currentKey, totalKm) {
    if (currentKey === targetKey && totalKm >= best.totalKm) {
      best = {
        indices: [...path],
        totalKm
      };
    }

    const connected = adjacency.get(currentKey) || [];
    connected
      .slice()
      .sort((left, right) => segments[right].lengthKm - segments[left].lengthKm)
      .forEach((segmentIndex) => {
        if (used.has(segmentIndex)) return;

        used.add(segmentIndex);
        path.push(segmentIndex);
        const segment = segments[segmentIndex];
        const nextKey = segment.startKey === currentKey ? segment.endKey : segment.startKey;
        visit(nextKey, totalKm + segment.lengthKm);
        path.pop();
        used.delete(segmentIndex);
      });
  }

  visit(sourceKey, 0);
  return best;
}

function buildPathFromSegments(segmentIndices, startKey, segments) {
  const path = [];
  let currentKey = startKey;

  segmentIndices.forEach((segmentIndex) => {
    const segment = segments[segmentIndex];
    const forward = segment.startKey === currentKey;
    const points = forward ? segment.points : [...segment.points].reverse();

    if (!path.length) {
      path.push(...points);
    } else if (samePoint(path.at(-1), points[0])) {
      path.push(...points.slice(1));
    } else {
      path.push(...points);
    }

    currentKey = forward ? segment.endKey : segment.startKey;
  });

  return path;
}

function greedyPathFallback(segments, sourcePoint) {
  const remaining = segments.map((segment) => ({
    ...segment,
    points: segment.points.map((point) => [...point])
  }));
  const path = [];
  let currentPoint = sourcePoint;

  while (remaining.length) {
    let bestIndex = 0;
    let bestReverse = false;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((segment, index) => {
      const startDistance = haversineKm(currentPoint, segment.points[0]);
      const endDistance = haversineKm(currentPoint, segment.points.at(-1));

      if (startDistance < bestDistance) {
        bestIndex = index;
        bestReverse = false;
        bestDistance = startDistance;
      }

      if (endDistance < bestDistance) {
        bestIndex = index;
        bestReverse = true;
        bestDistance = endDistance;
      }
    });

    const [selected] = remaining.splice(bestIndex, 1);
    const oriented = bestReverse ? [...selected.points].reverse() : selected.points;

    if (!path.length) {
      path.push(...oriented);
    } else if (samePoint(path.at(-1), oriented[0])) {
      path.push(...oriented.slice(1));
    } else {
      path.push(...oriented);
    }

    currentPoint = path.at(-1);
  }

  return path;
}

function samePoint(a, b) {
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1];
}

function dedupeSequentialPoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    return !samePoint(point, points[index - 1]);
  });
}
