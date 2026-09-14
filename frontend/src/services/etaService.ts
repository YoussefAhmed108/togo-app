/**
 * Live travel time to a place, from Google's Distance Matrix API.
 *
 * Straight-line kilometres say nothing about a 40-minute crawl down the Ring
 * Road, so rows show "18 min · 4.2 km" when Google answers and fall back to
 * kilometres alone when it doesn't.
 */
import {GOOGLE_MAPS_API_KEY} from '../config/maps';

export type LatLng = {lat: number; lng: number};

/** Traffic moves, so an ETA is only good for a few minutes. */
const TTL_MS = 5 * 60 * 1000;
/** Distance Matrix caps elements per request. */
const BATCH = 25;

const cache = new Map<string, {seconds: number; at: number}>();

// Origin rounded to ~100 m — walking around the block should not refetch.
function cacheKey(o: LatLng, d: LatLng): string {
  return `${o.lat.toFixed(3)},${o.lng.toFixed(3)}|${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
}

export function fmtEta(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Driving seconds (in current traffic) keyed by destination id. Destinations
 * Google could not route to are simply absent from the result.
 */
export async function fetchEtas(
  origin: LatLng,
  destinations: Array<{id: number} & LatLng>,
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  if (!GOOGLE_MAPS_API_KEY) return out;

  const now = Date.now();
  const pending: Array<{id: number} & LatLng> = [];
  for (const d of destinations) {
    const hit = cache.get(cacheKey(origin, d));
    if (hit && now - hit.at < TTL_MS) out[d.id] = hit.seconds;
    else pending.push(d);
  }

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: batch.map(d => `${d.lat},${d.lng}`).join('|'),
      mode: 'driving',
      departure_time: 'now',
      key: GOOGLE_MAPS_API_KEY,
    });

    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`,
      );
      const json = await res.json();
      const elements = json?.rows?.[0]?.elements ?? [];
      batch.forEach((d, idx) => {
        const el = elements[idx];
        if (el?.status !== 'OK') return;
        const seconds = (el.duration_in_traffic ?? el.duration)?.value;
        if (typeof seconds !== 'number') return;
        cache.set(cacheKey(origin, d), {seconds, at: Date.now()});
        out[d.id] = seconds;
      });
    } catch {
      // Offline or quota exhausted — callers keep showing plain distance.
    }
  }

  return out;
}
