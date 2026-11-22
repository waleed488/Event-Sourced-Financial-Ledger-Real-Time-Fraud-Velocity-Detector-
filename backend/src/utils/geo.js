// ============================================================================
// utils/geo.js
// Haversine distance and impossible-travel detector helper.
// Includes a zero-division guard when two events occur at the same timestamp.
// ============================================================================

const EARTH_RADIUS_KM = 6371;
const MAX_PLAUSIBLE_SPEED_KMH = 900; // Commercial jet speed threshold
const MIN_TRAVEL_DISTANCE_KM = 100;  // Ignore small local GPS jitter

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate great-circle distance in kilometers between two lat/lon points.
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Check whether moving between prevGeo and currGeo in the elapsed time is
 * physically impossible.
 */
export function evaluateImpossibleTravel(prevGeo, prevTime, currGeo, currTime) {
  if (!prevGeo || !currGeo) {
    return { isImpossible: false };
  }
  if (
    typeof prevGeo.lat !== "number" ||
    typeof prevGeo.lon !== "number" ||
    typeof currGeo.lat !== "number" ||
    typeof currGeo.lon !== "number"
  ) {
    return { isImpossible: false };
  }

  const distanceKm = calculateDistanceKm(
    prevGeo.lat,
    prevGeo.lon,
    currGeo.lat,
    currGeo.lon
  );

  const deltaSeconds = Math.abs(new Date(currTime) - new Date(prevTime)) / 1000;

  // Guard against divide-by-zero (Infinity/NaN) when two events share a timestamp
  if (distanceKm > MIN_TRAVEL_DISTANCE_KM && deltaSeconds <= 1) {
    return {
      isImpossible: true,
      distanceKm: Math.round(distanceKm),
      deltaSeconds,
      speedKmh: null // Effectively instantaneous
    };
  }

  if (distanceKm <= MIN_TRAVEL_DISTANCE_KM) {
    return { isImpossible: false };
  }

  const deltaHours = deltaSeconds / 3600;
  const speedKmh = distanceKm / deltaHours;

  return {
    isImpossible: speedKmh > MAX_PLAUSIBLE_SPEED_KMH,
    distanceKm: Math.round(distanceKm),
    deltaSeconds: Math.round(deltaSeconds),
    speedKmh: Math.round(speedKmh)
  };
}
