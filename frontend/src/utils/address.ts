/**
 * Places saved by dragging the map fall back to storing "lat, lng" as their
 * address when reverse geocoding is unavailable. Coordinates are not an
 * address, so never render one as if it were.
 */
const COORD_PAIR = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;

export function isCoordinateAddress(address?: string | null): boolean {
  return !!address && COORD_PAIR.test(address);
}

/** The address to show, or null when there isn't a real one. */
export function displayAddress(address?: string | null): string | null {
  if (!address || isCoordinateAddress(address)) return null;
  return address;
}
