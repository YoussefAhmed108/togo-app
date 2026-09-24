/**
 * Live travel time to a place, in current traffic.
 *
 * Straight-line kilometres say nothing about a 40-minute crawl down the Ring
 * Road, so rows show "18 min · 4.2 km" when an ETA is known and fall back to
 * kilometres alone when it isn't.
 *
 * The backend asks Google and shares each answer across everyone in the same
 * ~500 m cell for 5 minutes (backend/internal/eta). The phone snaps its own
 * position to that cell before sending it, so the exact location never leaves
 * the device, and it keeps a local copy so reopening a Space costs nothing.
 */
import api from './api';

export type LatLng = {lat: number; lng: number};

/** Must match eta.Cell and eta.TTL on the server. */
const CELL = 0.005;
const TTL_MS = 5 * 60 * 1000;

const snap = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;

const cache = new Map<string, {seconds: number; at: number}>();
const cacheKey = (o: LatLng, placeId: number) =>
  `${snap(o.lat).toFixed(4)},${snap(o.lng).toFixed(4)}|${placeId}`;

export function fmtEta(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Driving seconds keyed by place id, for places in `spaceId`. Places without
 * an answer (unroutable, offline, rate limited) are simply absent.
 */
export async function fetchEtas(
  spaceId: number,
  origin: LatLng,
  placeIds: number[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  const now = Date.now();
  const pending: number[] = [];
  for (const id of placeIds) {
    const hit = cache.get(cacheKey(origin, id));
    if (hit && now - hit.at < TTL_MS) out[id] = hit.seconds;
    else pending.push(id);
  }

  // The server takes 25 per call — one Distance Matrix batch.
  for (let i = 0; i < pending.length; i += 25) {
    try {
      const res = await api.get<{data: Record<string, number>}>(`/spaces/${spaceId}/eta`, {
        params: {
          lat: snap(origin.lat),
          lng: snap(origin.lng),
          place_ids: pending.slice(i, i + 25).join(','),
        },
      });
      for (const [id, seconds] of Object.entries(res.data.data ?? {})) {
        cache.set(cacheKey(origin, Number(id)), {seconds, at: Date.now()});
        out[Number(id)] = seconds;
      }
    } catch {
      // Offline or rate limited — callers keep showing plain distance.
    }
  }

  return out;
}
