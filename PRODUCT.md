# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

**Read this before acting on the value above.** The product ships on iOS and Android from one React Native 0.76 codebase, and the confirmed decision is **one shared design language on both** — not a per-OS design language. `adaptive` is recorded because it is the only schema value that means "both native platforms"; it must not be read as a mandate to build iOS-flavoured and Material-flavoured variants. Both platform references still apply for *native affordances* — Android hardware back, iOS swipe-back, per-OS safe areas, keyboard behaviour, share-sheet entry — which the shared visual language has to honour on each OS.

## Users

Primary: consumers in Cairo who encounter places through TikTok — predominantly food and drink venues — and want to keep them and visit them with friends.

Their situation is the middle of a TikTok session, not a planning session: they see a video about a venue, and the capture has to happen there and then, in a few taps, from the OS share sheet. The job splits three ways:

- **Capture** a place off a video without retyping anything.
- **Decide together** where a group is actually going, from a shared list.
- **Keep** what happened there — photos and notes attached to the place.

*Inferred, not confirmed:* the skew toward a younger urban audience follows from the TikTok-native acquisition path and the price anchoring in `docs/business-model.html`; no audience research has been done.

## Product Purpose

Turn a shared TikTok into a saved place in seconds, group places into **Spaces** shared with friends, attach **Memories** (photos and captions) to places inside those spaces, and recommend new places from the user's interests and their spaces' activity.

Three nouns carry the whole product: **Place** (a pinned location with tags and a visited flag), **Space** (a shared group joined by invite link), **Memory** (photos, a caption, and rated dishes attached to a place, inside a space).

Success is a place captured from a video and later visited with the people in that space.

## Positioning

The mechanism a neighbouring place-saving app cannot cheaply copy is the **extraction pipeline**: yt-dlp fetch → text signals (oEmbed, HTML meta, caption) → Claude Haiku → Google Places text search → confidence-tiered candidates, with URL-level and query-level caching.

It is market-neutral by construction — language detection returns any ISO code rather than defaulting to Arabic, and cache keys are built from what the model read, so each city warms its own working set independently.

Its economics are the position: a cold share costs $0.0417 (Google Places is 77% of it), the same video again costs nothing, and the same venue from a new video costs $0.0097. Cost per user falls as a city's venues warm, rather than rising with scale.

## Operating Context

- **Entry is the OS share sheet.** TikTok → share extension → deep link `yourapp://add-place?url=…` → the Add Place screen with a `tiktokUrl` param. Design has to hold a user's attention across a **~20 second** extraction.
- **Extraction is confidence-tiered.** High confidence auto-fills; medium shows a picker of 2–3 candidates (chains match several branches and the top hit is often the wrong one); low falls back to manual search with whatever name was read off the video.
- **Saving fans out.** One place is created once, then added to any combination of Saved Places and one or more Spaces. A single space failing must not lose the others or the place.
- **Abuse and cost caps are live product limits:** 10 imports/hour, 40/day per user — a bound of roughly $1.64/user/day worst case.
- Places may also arrive pre-filled from a recommendation tap, or scoped to a space when Add Place is opened from inside one.

## Capabilities and Constraints

**Shipped backend surface:** register/login/token refresh, profile setup, interests; get/update me; places — list, create, get, update, delete, toggle visited, add/remove tags, list/add/delete memories; spaces — list, create, join by invite link, get, update, delete, generate invite link, list/add/remove members, list space memories, list/add/remove places; recommendations — global and per-space; presigned image upload; `/health/deep` readiness probe.

**Hard constraints:**

- **There is no public place catalog.** Every place is private or scoped to a space. Recommendations may draw only on: places in spaces the user belongs to, the user's own places not yet in the current space, and Google Places driven by a tag-derived interest profile. Other users' personal saved places are never accessible without explicit opt-in.
- **Google Places is 77% of an uncached extraction.** A pricing or free-tier change lands directly on the cost line.
- **`yt-dlp` reaching the video is a single point of failure.** The caption-only fallback is materially worse at picking the right branch.
- Venue identity (`google_place_id`) is deliberately dropped when the user drags the map pin, because the pin no longer sits on Google's match — this changes backend dedupe.

**Built but not yet committed to git** (present in the working tree, wired end to end):

- **Rated dishes on a memory** — `memory_dishes` (name, rating out of 5), through models, repository, handlers, OpenAPI and the Place/Space screens. A memory is no longer only photo + caption.
- **Live travel time** — `etaService` calls Google Distance Matrix for driving time *in current traffic*, batched 25 per request, cached with a 5-minute TTL and an origin rounded to ~100 m, falling back to kilometres when Google does not answer. Rows read "18 min · 4.2 km". The stated reason is Cairo-specific: straight-line kilometres say nothing about a crawl down the Ring Road.
- **Saved starting points** — `user_locations` (named label, address, lat/lng), so a user can pick a named origin instead of GPS.

**Explicitly undecided:**

- **The product name.** "togo-app" (repo), "Waypoint" (mockups) and "Shared Places & Memories App" (brief) are all in play. Nothing downstream may hardcode or invent one.
- Whether **cuisine and free tags on a memory** become real fields. They appear in recent design exploration; unlike dishes, they have no table.

## Evidence on Hand

- `docs/business-model.html` — funding options and unit economics. **Measured** 29 Aug 2026 against a live Cairo TikTok (Sushimi by K), Claude Haiku 4.5 at $1/$5 per MTok, Google Places Text Search Pro at list price. The cache hit rates in its scenario table are **projections with stated assumptions, not measurements** — they must never be presented as measured.
- `docs/DESIGN_BRIEF.md` — twelve screens and modals, specified in detail.
- `docs/TIKTOK_SHARE_FEATURE.md` — the extraction flow, endpoints and confidence tiers.
- `docs/RECOMMENDATIONS_PLAN.md` — recommendation sources and their privacy model.
- Working code for every screen in the brief, plus a live Fly.io deployment.

**Absences future work must not fabricate:** there are no users, no testimonials, no venue customers, no revenue, no press, no app-store presence, and no real user photography. Any place, person, count or quote in a design is sample data and must be recognisable as such.

## Product Principles

1. **The share is the product.** Capture from a video is the one path that has to be flawless, including its unhappy ones — a 20-second wait, a wrong branch, a failed match.
2. **The user never pays.** Cost per share is a product constraint, not an ops detail; anything that multiplies extractions is a product decision.
3. **Privacy is structural, not a setting.** Nothing surfaces another user's private saved places. Recommendations are built only from the user's own data, the spaces they belong to, and public results.
4. **Density beats reach.** Value concentrates in one city at a time; features that spread users thinly are worth less than features that deepen a city.
5. **Recommendations are the trust surface.** They are the screen users are least suspicious of. Any paid placement there must be labelled honestly and capped, or the asset is spent.

## Accessibility & Inclusion

- **Arabic and right-to-left layout are required.** This is a confirmed hard constraint on every layout, icon direction, type choice and animation direction. Directional icons must mirror; text alignment, list affordances and back gestures must flip; type must be chosen for Arabic as well as Latin.
- Both OSes' native affordances must work under the shared design language: Android hardware back, iOS swipe-back, per-OS safe areas.
- No further product-specific accessibility standard has been established.
