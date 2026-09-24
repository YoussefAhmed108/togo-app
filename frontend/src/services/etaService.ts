/**
 * Travel time to a place.
 *
 * Straight-line kilometres say nothing about a 40-minute crawl down the Ring
 * Road, so rows show "~18 min · 4.2 km" when a time is known and fall back to
 * kilometres alone when it isn't.
 *
 * Lists get estimates: the no-traffic drive time times a traffic factor the
 * backend learns per area and hour (backend/internal/eta). Opening a place
 * asks for the real traffic time, which also teaches that factor. Estimates
 * carry a "~"; live times don't.
 *
 * The phone snaps its position to the server's ~500 m cell before sending it,
 * so the exact location never leaves the device, and keeps a local copy so
 * reopening a Space costs nothing.
 */
import api from './api';

export type LatLng = {lat: number; lng: number};

/** Must match eta.Cell and eta.TTL on the server. */
const CELL = 0.005;
const TTL_MS = 5 * 60 * 1000;

const snap = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;

export type Eta = {seconds: number; live: boolean};

const cache = new Map<string, Eta & {at: number}>();
const cacheKey = (o: LatLng, placeId: number) =>
  `${snap(o.lat).toFixed(4)},${snap(o.lng).toFixed(4)}|${placeId}`;

export function fmtEta({seconds, live}: Eta): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  const t = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return live ? t : `~${t}`;
}

/**
 * Drive times keyed by place id, for places in `spaceId`. Places without an
 * answer (unroutable, offline, rate limited) are simply absent.
 */
export async function fetchEtas(
  spaceId: number,
  origin: LatLng,
  placeIds: number[],
): Promise<Record<number, Eta>> {
  const out: Record<number, Eta> = {};
  const now = Date.now();
  const pending: number[] = [];
  for (const id of placeIds) {
    const hit = cache.get(cacheKey(origin, id));
    if (hit && now - hit.at < TTL_MS) out[id] = {seconds: hit.seconds, live: hit.live};
    else pending.push(id);
  }

  // The server takes 25 per call.
  for (let i = 0; i < pending.length; i += 25) {
    Object.assign(out, await request(spaceId, origin, pending.slice(i, i + 25), false));
  }
  return out;
}

/**
 * The real traffic time to one place. This is the only call that pays for
 * traffic, so it is made when a place is opened, not for lists.
 */
export async function fetchLiveEta(spaceId: number, origin: LatLng, placeId: number): Promise<Eta | null> {
  const hit = cache.get(cacheKey(origin, placeId));
  if (hit?.live && Date.now() - hit.at < TTL_MS) return {seconds: hit.seconds, live: true};
  return (await request(spaceId, origin, [placeId], true))[placeId] ?? null;
}

async function request(
  spaceId: number,
  origin: LatLng,
  placeIds: number[],
  live: boolean,
): Promise<Record<number, Eta>> {
  const out: Record<number, Eta> = {};
  try {
    const res = await api.get<{data: Record<string, Eta>}>(`/spaces/${spaceId}/eta`, {
      params: {
        lat: snap(origin.lat),
        lng: snap(origin.lng),
        place_ids: placeIds.join(','),
        ...(live ? {live: 1} : {}),
      },
    });
    for (const [id, eta] of Object.entries(res.data.data ?? {})) {
      cache.set(cacheKey(origin, Number(id)), {...eta, at: Date.now()});
      out[Number(id)] = eta;
    }
  } catch {
    // Offline or rate limited — callers keep showing plain distance.
  }
  return out;
}
