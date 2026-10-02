// Safe helpers for attendance GPS. A stored location may be null, or an object
// without numeric coordinates (a check-in sent `{}` or `{ addressHint }`), and
// calling `.toFixed` on a missing latitude crashed the whole Attendance screen
// (HRM8-1 / HRM6-1). Every HRM screen reads coordinates through these.

type MaybeGeo = { latitude?: unknown; longitude?: unknown } | null | undefined;

/** True when the location carries real numeric latitude/longitude. */
export function hasCoords(loc: MaybeGeo): loc is { latitude: number; longitude: number } {
  return (
    !!loc &&
    typeof loc.latitude === 'number' && Number.isFinite(loc.latitude) &&
    typeof loc.longitude === 'number' && Number.isFinite(loc.longitude)
  );
}

/** "11.3410, 77.7172" — or '' when there are no coordinates. */
export function formatCoords(loc: MaybeGeo, digits = 4): string {
  return hasCoords(loc) ? `${loc.latitude.toFixed(digits)}, ${loc.longitude.toFixed(digits)}` : '';
}

/** A Google Maps link for the location, or undefined when there are no coordinates. */
export function mapsLink(loc: MaybeGeo): string | undefined {
  return hasCoords(loc) ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : undefined;
}
