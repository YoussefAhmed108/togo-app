# Place Recommendations — Implementation Plan

## Context

Users save personal places and share places inside "spaces" (shared groups with friends).  
The goal is to show **relevant place recommendations** in two surfaces:

| Surface | Goal |
|---------|------|
| **Home screen** | Personalized discovery across all the user's data |
| **Space screen** | Contextual suggestions relevant to that specific space |

The frontend already has a `RecommendationCard` component and a `recommendations` array in HomeScreen that is currently empty. The backend has no recommendation endpoint yet.

---

## Problem Framing: Where Do Recommendations Come From?

This is the most important design decision. The app has **no public place catalog** — every place is either private (personal `saved=1`) or shared only within a specific space. So recommendation sources are:

| Source | Privacy model | Works at launch? |
|--------|---------------|-----------------|
| **Places in spaces the user is in, not personally saved** | ✅ User has access | ✅ Yes |
| **User's own places in other spaces, not added here** | ✅ User's own data | ✅ Yes |
| **Tag-derived interest profile → Google Places API** | External discovery | ✅ With API key |
| **Other users' personal saved places** | ❌ Private, not accessible | ❌ Never without opt-in |
| **Collaborative filtering (users with similar taste)** | Needs critical mass | 🔜 Phase 3 |
| **Vector similarity (embeddings)** | Self-contained ML | 🔜 Phase 3 |

---

## Strategy Overview (3 Phases)

```
Phase 1 — Internal cross-pollination   (no external APIs, works day 1)
Phase 2 — External discovery           (Google Places API, personalized)
Phase 3 — ML ranking                   (embeddings, collaborative filtering)
```

---

## Phase 1: Internal Cross-Pollination

### Signal: Places in the user's spaces that they haven't personally saved

When a user is in multiple spaces, they may not have personally saved every place that's been shared in those spaces. These are high-quality recommendations because:
- Trusted source (friends put them there)
- Tagged and located (real data, not guesses)
- Already vetted by someone in their circle

**Example**: Alice is in "Tokyo Trip" (15 places) and "Work Lunches" (8 places). She has personally saved 5 places. The remaining 18 are candidates.

### Homepage: "From Your Spaces"

Aggregate all places across all of the user's spaces. Exclude places already in their personal list (`saved=1` and same owner). Rank by:
1. **Tag overlap score** with the user's own tags (more overlap = higher rank)
2. **Recency** (recently added to a space = more relevant)
3. **Membership count** (place added to multiple spaces = more popular)

Each recommendation carries a `reason`:  
`{ type: "space", space_name: "Tokyo Trip", space_id: 5 }`

### Space screen: "Not in This Space Yet"

When viewing Space X, show places from the user's **other spaces** that haven't been added here. Especially useful when the user is organizing places and wants to cross-add.

**Example**: User is viewing "Weekend Hikes" space. In their "Nature Spots" space they have 3 trails that aren't in Weekend Hikes. Show those with reason `{ type: "your_other_space", space_name: "Nature Spots" }`.

---

## Phase 2: External Discovery (Google Places API)

### Signal: User interest profile → Google Places API

Build a taste profile from the user's places and use it to query Google Places for nearby undiscovered spots.

#### Step 1: Build Interest Profile

```
tag frequency rank for a user:
  "sushi" × 4, "ramen" × 3, "coffee" × 2 → Japanese food + café profile
  
map to Google Places types:
  sushi/ramen → restaurant (keyword: japanese)
  coffee → cafe
  hiking → park / tourist_attraction
  museum → museum
```

A mapping table lives in a config file (`internal/recommendations/tags.go`). No ML needed.

#### Step 2: Geographic Cluster

The user's places cluster geographically (e.g., their city neighborhood). Find the **centroid** of their most dense cluster using k-means or simple average lat/lng.

For a space, the centroid of the space's places is its "home territory."

#### Step 3: Query Google Places

```
GET https://maps.googleapis.com/maps/api/place/nearbysearch/json
  ?location={centroid_lat},{centroid_lng}
  &radius=2000
  &type={mapped_type}
  &keyword={top_tag}
  &key={GOOGLE_PLACES_KEY}
```

Filter out:
- Places already in user's personal list (match by google_place_id or name+approximate coords)
- Places already in any of the user's spaces

#### Step 4: Cache Results

Google Places API costs money per call. Cache results server-side in a new table:

```sql
-- migration 006_recommendations_cache.sql
CREATE TABLE recommendations_cache (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  space_id     BIGINT UNSIGNED NULL,           -- NULL = global, non-null = space-specific
  name         VARCHAR(255) NOT NULL,
  address      VARCHAR(512) NULL,
  lat          DECIMAL(10,7) NOT NULL,
  lng          DECIMAL(10,7) NOT NULL,
  google_place_id VARCHAR(255) NULL,
  reason_type  VARCHAR(50) NOT NULL,           -- 'nearby', 'space', etc.
  reason_meta  JSON NOT NULL,
  cached_at    DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  INDEX idx_user_cache (user_id, cached_at),
  INDEX idx_space_cache (space_id, cached_at)
);
```

**TTL**: 24 hours. If cache is fresh, return it. If stale, refresh async (background goroutine) and return stale in the meantime (stale-while-revalidate pattern).

#### Homepage reason pill

`{ type: "nearby", area: "Shibuya", distance: "400m" }`  
`{ type: "popular_tag", tag: "coffee" }`

---

## Phase 3: ML-Enhanced Ranking

> Not needed at launch. Document here for future reference.

### Option A: Semantic Embeddings (Claude/OpenAI)

Generate an embedding vector for each place from `name + tags + address`. Store in `places.embedding BLOB` (or a separate `place_embeddings` table for portability).

On recommendation query:
1. Average the user's saved place vectors → "taste vector"
2. Find top-N places (from spaces or cache) by cosine similarity to taste vector
3. Re-rank the Phase 1/2 candidates using similarity score

**Cost**: 1 API call per new place (embed on create). Tiny with Haiku.  
**Benefit**: Understands "izakaya" and "yakitori" are the same vibe without explicit tag matching.

### Option B: Collaborative Filtering

Once there are enough users (100+):
1. Build a user×place interaction matrix (saved=1, visited=1 as signals)
2. Find users with high cosine similarity to the current user's interaction row
3. Recommend places they saved that the current user hasn't

Standard ALS or SVD. Could run as a nightly batch job and cache results in `recommendations_cache`.

### Option C: Graph-Based (Social Graph)

Treat spaces as edges: users connected in many spaces = close friends.  
Recommend places based on what close friends saved.  
Requires a graph traversal query or dedicated graph layer.

---

## Backend Implementation

### New Files

```
internal/
  recommendations/
    profile.go       # build tag interest profile from user's places
    cluster.go       # find geographic centroid of a set of places
    tags_map.go      # tag name → Google Place type mapping
    google.go        # Google Places API client (nearbysearch)
    cache.go         # read/write recommendations_cache table
  handlers/
    recommendations.go   # GET /recommendations, GET /spaces/{id}/recommendations
```

### New Endpoints

#### `GET /api/v1/recommendations`

Returns global recommendations for the current user.

**Response:**
```json
{
  "data": {
    "from_spaces": [
      {
        "id": 42,
        "name": "Ichiran Ramen",
        "address": "1-22-7 Jinnan, Shibuya",
        "lat": 35.6617,
        "lng": 139.6983,
        "tags": ["ramen", "solo-dining"],
        "reason": { "type": "space", "space_name": "Tokyo Trip", "space_id": 5 }
      }
    ],
    "nearby": [
      {
        "id": null,
        "name": "Fuglen Tokyo",
        "address": "1-16-11 Tomigaya, Shibuya",
        "lat": 35.6680,
        "lng": 139.6944,
        "google_place_id": "ChIJ...",
        "tags": [],
        "reason": { "type": "nearby", "tag": "coffee", "area": "Shibuya" }
      }
    ]
  }
}
```

Note: `from_spaces` items are places already in the DB (have an `id`). `nearby` items from Google Places are NOT yet in the DB — the user would tap "Save" to create them.

**Auth**: Requires auth + profile complete.

#### `GET /api/v1/spaces/{id}/recommendations`

Returns recommendations for a specific space.

**Response:**
```json
{
  "data": [
    {
      "place": {
        "id": 37,
        "name": "Yoyogi Park",
        "address": "Yoyogi Kamizonocho, Shibuya",
        "lat": 35.6715,
        "lng": 139.6951,
        "tags": ["park", "picnic", "outdoor"]
      },
      "reason": {
        "type": "your_other_space",
        "space_name": "Weekend Outdoors",
        "space_id": 3
      }
    }
  ]
}
```

**Auth**: Requires `IsSpaceMember`.

### New Repository Methods

Add to `SpaceStore` interface and implementation:

```go
// All places across all of user's spaces, excluding those user has personally saved.
// Returns place + the first space it was found in as the "reason".
ListCrossSpaceRecommendations(ctx context.Context, userID uint64) ([]*RecommendedPlace, error)

// Places in user's other spaces (not spaceID), not already in spaceID.
ListUserOtherSpacePlacesNotInSpace(ctx context.Context, userID, spaceID uint64) ([]*RecommendedPlace, error)
```

```go
type RecommendedPlace struct {
    Place     *models.Place
    SpaceID   uint64
    SpaceName string
}
```

Add to `PlaceStore` interface and implementation:

```go
// Get tag frequency profile for user (tag name → count)
GetUserTagProfile(ctx context.Context, userID uint64) ([]TagCount, error)
```

```go
type TagCount struct {
    Tag   string
    Count int
}
```

### SQL Queries

**Cross-space recommendations (global):**
```sql
SELECT DISTINCT
  p.id, p.name, p.address, p.lat, p.lng, p.visited, p.saved,
  s.id   AS space_id,
  s.name AS space_name
FROM space_places sp
JOIN spaces s  ON s.id  = sp.space_id
JOIN places p  ON p.id  = sp.place_id
JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
WHERE p.owner_id != ?                          -- not their own place
  AND NOT EXISTS (
    SELECT 1 FROM places p2
    WHERE p2.owner_id = ? AND p2.saved = 1
      AND p2.lat = p.lat AND p2.lng = p.lng    -- dedup by coords (good enough)
  )
ORDER BY sp.added_at DESC
LIMIT 20;
```

**Space-specific (user's other spaces → this space):**
```sql
SELECT DISTINCT
  p.id, p.name, p.address, p.lat, p.lng,
  s2.id   AS from_space_id,
  s2.name AS from_space_name
FROM space_places sp
JOIN spaces s2 ON s2.id = sp.space_id
JOIN places  p ON p.id  = sp.place_id
JOIN space_members sm ON sm.space_id = s2.id AND sm.user_id = ?
WHERE s2.id != ?                               -- not the current space
  AND NOT EXISTS (
    SELECT 1 FROM space_places sp2
    WHERE sp2.space_id = ? AND sp2.place_id = p.id  -- not already in this space
  )
LIMIT 10;
```

**User tag profile:**
```sql
SELECT t.name, COUNT(*) AS cnt
FROM place_tags pt
JOIN tags t ON t.id = pt.tag_id
JOIN places p ON p.id = pt.place_id
WHERE p.owner_id = ?
GROUP BY t.name
ORDER BY cnt DESC
LIMIT 10;
```

---

## Frontend Implementation

### Home Screen

Extend `homeService.ts`:

```typescript
export interface RecommendedPlace {
  id: number | null;             // null if from Google (not yet in DB)
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  tags: string[];
  google_place_id?: string;
  reason: RecommendationReason;
}

export interface RecommendationReason {
  type: 'space' | 'nearby' | 'popular_tag' | 'your_other_space';
  space_name?: string;
  space_id?: number;
  tag?: string;
  area?: string;
}

export interface RecommendationsResponse {
  from_spaces: RecommendedPlace[];
  nearby: RecommendedPlace[];
}

fetchRecommendations: async (): Promise<RecommendationsResponse> => {
  const res = await api.get<{data: RecommendationsResponse}>('/recommendations');
  return res.data.data;
};
```

Replace the empty `const recommendations: RecommendationItem[] = [];` in `HomeScreen.tsx`:

```typescript
const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);

useEffect(() => {
  homeService.fetchRecommendations().then(data => {
    const fromSpaces = data.from_spaces.map(p => ({
      id: p.id ?? 0,
      name: p.name,
      category: p.tags[0] ?? '',
      address: p.address ?? '',
      emoji: tagToEmoji(p.tags[0]),
      reason: p.reason,
    }));
    const nearby = data.nearby.map(p => ({
      id: -Math.random(),  // negative = not yet in DB
      name: p.name,
      category: p.tags[0] ?? '',
      address: p.address ?? '',
      emoji: '📍',
      reason: p.reason,
      googlePlaceId: p.google_place_id,
    }));
    setRecommendations([...fromSpaces, ...nearby]);
  });
}, []);
```

**Tap behavior on recommendation card:**
- If `id > 0` → navigate to `PlaceDetail`
- If `id <= 0` (Google Place) → navigate to `CreatePlaceScreen` with `name`, `lat`, `lng`, `address` pre-filled

### Space Screen

Add a "Suggested for This Space" section below the places list:

```typescript
// new state
const [spaceRecs, setSpaceRecs] = useState<RecommendedPlace[]>([]);

// fetch on mount alongside other space data
const recsRes = await spaceDetailService.getRecommendations(spaceId);
setSpaceRecs(recsRes);
```

Render below the existing places list (collapsed behind "Show suggestions" if user hasn't expanded):

```tsx
{spaceRecs.length > 0 && (
  <View style={styles.suggestionsSection}>
    <Text style={styles.sectionTitle}>Suggested for this Space</Text>
    {spaceRecs.map(rec => (
      <TouchableOpacity
        key={rec.id}
        style={styles.suggestionRow}
        onPress={() => navigation.navigate('PlaceDetail', {placeId: rec.id, placeName: rec.name})}
      >
        <Text style={styles.suggestionName}>{rec.name}</Text>
        <View style={styles.reasonPill}>
          <Text style={styles.reasonText}>
            From {rec.reason.space_name}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addToSpaceBtn}
          onPress={() => handleAddPlaceToSpace(rec.id)}
        >
          <Text>+ Add</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    ))}
  </View>
)}
```

Add to `spaceDetailService.ts`:

```typescript
getRecommendations: async (spaceId: number): Promise<RecommendedPlace[]> => {
  const res = await api.get<{data: RecommendedPlace[]}>(`/spaces/${spaceId}/recommendations`);
  return res.data.data ?? [];
},
```

---

## Data Flow Diagram

```
HOME SCREEN
┌─────────────────────────────────────────────┐
│  GET /recommendations                        │
│                                              │
│  Backend:                                    │
│    1. ListCrossSpaceRecommendations(userID) │
│       SQL: all spaces user is in →           │
│            places not in personal list       │
│       → from_spaces[]                        │
│                                              │
│    2. [Phase 2] GetUserTagProfile(userID)   │
│       → top tags                             │
│       → map tags → Google Place types        │
│       → find centroid of user's places       │
│       → query Google Places API              │
│       → cache in recommendations_cache       │
│       → nearby[]                             │
└─────────────────────────────────────────────┘

SPACE SCREEN
┌─────────────────────────────────────────────┐
│  GET /spaces/{id}/recommendations            │
│                                              │
│  Backend:                                    │
│    1. IsSpaceMember(spaceID, userID) → 403  │
│    2. ListUserOtherSpacePlacesNotInSpace(    │
│         userID, spaceID)                     │
│       SQL: user's spaces (≠ this one) →      │
│            places not yet in this space      │
│    3. [Phase 2] centroid of space's places   │
│       → nearby Google Places for this area  │
└─────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 1 (Internal, ~2 days of work)

1. **`migrations/006_recommendations_cache.sql`** — cache table (even if only used in Phase 2)
2. **`internal/models/recommendation.go`** — `RecommendedPlace`, `RecommendationReason` structs
3. **`internal/repository/interfaces.go`** — add `ListCrossSpaceRecommendations`, `ListUserOtherSpacePlacesNotInSpace`, `GetUserTagProfile`
4. **`internal/repository/space.go`** — implement the two new space queries
5. **`internal/repository/place.go`** — implement `GetUserTagProfile`
6. **`internal/handlers/recommendations.go`** — `GetRecommendations` and `GetSpaceRecommendations` handlers
7. **`internal/handlers/routes.go`** — register `GET /recommendations` and `GET /spaces/{id}/recommendations`
8. **`frontend/src/services/homeService.ts`** — add `fetchRecommendations()`
9. **`frontend/src/services/spaceDetailService.ts`** — add `getRecommendations(spaceId)`
10. **`frontend/src/screens/HomeScreen.tsx`** — wire up recommendations state + fetch
11. **`frontend/src/screens/app/SpaceScreen.tsx`** — add "Suggested" section

### Phase 2 (Google Places, ~3 days of work)

1. **`internal/recommendations/tags_map.go`** — tag → Google Place type mapping
2. **`internal/recommendations/cluster.go`** — centroid + radius calculation
3. **`internal/recommendations/google.go`** — Google Places nearbysearch client
4. **`internal/recommendations/cache.go`** — read/write `recommendations_cache`
5. **`internal/handlers/recommendations.go`** — extend to call Google + cache
6. **Frontend** — handle `id: null` recommendations (tap → CreatePlace pre-filled)

### Phase 3 (ML, future)

1. Choose embedding provider (Claude `claude-3-haiku` or OpenAI `text-embedding-3-small`)
2. `migrations/007_place_embeddings.sql` — add `embedding BLOB` or separate table
3. Embed on place create/update
4. Similarity search on recommendation query (or pre-compute nightly batch)

---

## Tradeoffs Summary

| Approach | Pros | Cons | When |
|----------|------|------|------|
| Cross-space (Phase 1) | Zero cost, instant, trusted source | Limited to existing spaces data; useless for new users | Day 1 |
| Google Places (Phase 2) | Works for new users, external discovery, location-aware | Costs money (~$0.032/call), needs API key, latency | After launch |
| Embeddings (Phase 3) | Semantic understanding, no API dependency after setup | Infra complexity, embedding cost per place | Growth stage |
| Collaborative (Phase 3) | Classic ML, scales with users | Cold start, needs 100+ active users | Scale stage |

---

## Edge Cases to Handle

| Case | Handling |
|------|---------|
| User has no saved places and is in no spaces | Return empty `from_spaces`, skip tag profile, return nothing |
| User is in spaces but all space places are already saved | Return empty `from_spaces` |
| Google Places API key not set | Skip `nearby` section silently |
| Google Places API rate limit / error | Return cached results if available, otherwise skip section |
| Recommended place is deleted from space before user taps it | `GetPlace` returns 404 → show toast "Place no longer available" |
| Space has 0 places | Skip space centroid, no `nearby` for that space |
| Very small geographic spread of places | Use 2km radius minimum |
| Duplicate between `from_spaces` and `nearby` | Deduplicate by `google_place_id` or name+coords before returning |

---

## Notes

- The `RecommendationCard` component and `RecommendationReason` type already exist in the frontend. The UI work is mostly wiring data, not new components.
- The `GOOGLE_PLACES_KEY` env var is already added to `internal/config/config.go` from the TikTok feature planning session.
- Recommendations are **read-only** — they don't create any state until the user explicitly saves or adds a place.
- For the space screen, "add" CTA on a suggestion calls the existing `POST /spaces/{id}/places` endpoint with `{ place_id }` — no new endpoint needed.
- For Google Places results (no DB id), tapping opens `CreatePlaceScreen` with pre-filled data. The `POST /places` call happens only when the user confirms — same flow as manual place creation.
