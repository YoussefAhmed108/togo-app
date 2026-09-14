/**
 * Region (neighbourhood / district) of a saved place, derived from its address.
 *
 * ponytail: parsed from the address string rather than stored on the place —
 * no migration, no geocoding call. If addresses ever get too messy to parse,
 * the upgrade path is a `region` column filled at save time from the Google
 * place's `sublocality` / `administrative_area_level_2` component.
 */
import {displayAddress} from './address.ts';

/** Parts that name a country, governorate or postal code — never a region. */
const NOISE =
  /^(egypt|مصر)$|governorate|muhafazah|محافظة|province|^[\d٠-٩][\d٠-٩\s-]*$|^[a-z]{0,2}[\d٠-٩]{4,}$/i;
/** Invisible direction marks Google wraps around mixed Arabic/Latin parts. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function regionOf(address?: string | null): string | null {
  const real = displayAddress(address);
  if (!real) return null;

  const parts = real
    .replace(BIDI, '')
    // Arabic addresses separate parts with "،", not ",".
    .split(/[,،]/)
    .map(p => p.trim())
    // Drop a trailing postal code stuck to a name: "Giza Governorate 12588".
    .filter(p => p.length > 0 && !NOISE.test(p.replace(/\s+[\d٠-٩][\d٠-٩\s-]*$/, '')));

  // Google orders an address narrow → broad, so once the country and
  // governorate lines are gone the region is the part right after the street
  // line: "105 Al Hekma St, First Al Sheikh Zayed, Giza Governorate, Egypt".
  // With nothing but one part left, that part is already the region.
  if (parts.length === 0) return null;
  return parts.length >= 2 ? parts[1] : parts[0];
}

/** Distinct regions present in a list of addresses, alphabetical. */
export function regionsOf(addresses: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const a of addresses) {
    const r = regionOf(a);
    if (r) set.add(r);
  }
  return Array.from(set).sort();
}
