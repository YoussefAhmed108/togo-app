# Feature: Share from TikTok to Add Place

## Overview

Users can share a TikTok video about a place they like directly to the app. The app extracts the place information using an LLM (Claude Haiku) + Google Places API, then opens the Add Place screen with everything pre-filled. The user just reviews, picks tags, chooses destination(s) (saved places and/or one or more spaces), and taps Save.

### Flow Diagram

```
TikTok app                  OS Share Sheet           Your App                      Backend
──────────                  ──────────────           ────────                      ───────
User taps Share  ────────►  Shows your app icon
                            User taps it    ────►  Share Extension receives URL
                                                    ↓
                                                    Opens main app via deep link:
                                                    yourapp://add-place?url=<encoded_tiktok_url>
                                                    ↓
                                                    App routes to CreatePlaceScreen
                                                    with tiktokUrl param
                                                    ↓
                                                    Shows loading: "Analyzing TikTok..."
                                                    ↓
                                                    POST /api/v1/places/extract ────────►  1. Fetch TikTok oEmbed
                                                                                           2. Fetch HTML meta tags
                                                                                           3. Bundle all text signals
                                                                                           4. Send to Claude Haiku
                                                                                           5. Google Places text search
                                                                                ◄────────  Returns candidates[]
                                                    ↓
                                              ┌─ confidence high ──► auto-fill form
                                              ├─ confidence medium ─► show picker (2-3 candidates)
                                              └─ confidence low ───► show message, fall back to manual search
                                                    ↓
                                                    User reviews name/location/tags
                                                    Picks destination(s): saved places / space1 / space2 ...
                                                    Taps Save → done
```

---

## Step 1: Backend — New Config Values

### File: `backend/.env`

Add these two new environment variables:

```env
# ── Place Extraction (TikTok share feature) ──────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...          # Claude Haiku API key for LLM extraction
GOOGLE_PLACES_API_KEY=AIzaSy...       # Server-side Google Places API key
```

### File: `backend/internal/config/config.go`

Add to the `Config` struct:

```go
AnthropicAPIKey   string
GooglePlacesKey   string
```

Add to the `Load()` function:

```go
AnthropicAPIKey:   getEnv("ANTHROPIC_API_KEY", ""),
GooglePlacesKey:   getEnv("GOOGLE_PLACES_API_KEY", ""),
```

---

## Step 2: Backend — TikTok Metadata Extractor

### New file: `backend/internal/extract/tiktok.go`

This module fetches metadata from a TikTok URL using two methods:

#### Method 1: oEmbed API (free, no auth, reliable)

```
GET https://www.tiktok.com/oembed?url=<tiktok_url>
```

Returns JSON:
```json
{
  "title": "Best matcha spot in Shibuya 🍵 #tokyo #matcha",
  "author_name": "tokyofoodie",
  "author_url": "https://www.tiktok.com/@tokyofoodie",
  "thumbnail_url": "https://..."
}
```

#### Method 2: HTML meta tags (fallback, richer description)

Fetch the TikTok page HTML with a browser-like User-Agent header and parse `<meta>` tags:
- `og:title` — video title
- `og:description` — often more detailed than oEmbed title
- `og:image` — thumbnail URL (useful for potential future OCR)
- Any hashtags found in the page body text

#### What the module exports:

```go
package extract

type TikTokMeta struct {
    Title        string   // from oEmbed title or og:title
    Description  string   // from og:description (often richer)
    AuthorName   string   // e.g. "tokyofoodie"
    Hashtags     []string // parsed from title + description, e.g. ["tokyo", "matcha"]
    ThumbnailURL string   // og:image URL
    SourceURL    string   // the original TikTok URL
}

// FetchMeta fetches metadata from a TikTok URL.
// It tries oEmbed first, then falls back to HTML scraping.
// Both results are merged (oEmbed for title/author, HTML for description/hashtags).
func FetchMeta(ctx context.Context, tiktokURL string) (*TikTokMeta, error)
```

#### Implementation notes:

- **HTTP client**: Use Go's `net/http` with a 10-second timeout and a browser-like `User-Agent` header:
  ```
  Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
  ```
- **oEmbed parsing**: Simple `json.Unmarshal` on the response.
- **HTML parsing**: Use Go's `golang.org/x/net/html` package (add to `go.mod`) to find `<meta property="og:..." content="...">` tags. Don't use regex for HTML parsing.
- **Hashtag extraction**: Scan the title and description for `#word` patterns. Strip the `#` prefix, lowercase them, deduplicate. Also look for common TikTok hashtag patterns in the page HTML.
- **URL validation**: Only accept URLs matching `https://(www\.|vm\.)?tiktok\.com/`. Reject anything else with a clear error message.
- **Follow redirects**: TikTok share URLs are often shortened (e.g. `https://vm.tiktok.com/ZMxxxxxxx/`). The HTTP client must follow redirects (Go's default client does this automatically).

---

## Step 3: Backend — Claude Haiku LLM Extraction

### New file: `backend/internal/extract/llm.go`

This module takes the raw TikTok metadata and uses Claude Haiku to reason about what specific place is being referenced.

#### Why an LLM is needed:

TikTok metadata is often vague. Examples of what the title/description might look like:

| Signal strength | Example title/description |
|---|---|
| **Explicit** | "L'Industrie Pizzeria in Brooklyn — best slice ever" |
| **Vague** | "Best pizza spot in Brooklyn 🍕 you need this" |
| **Useless** | "You NEED to try this 😍🔥 #fyp #food" |

Simple keyword matching only catches the first bucket. Claude Haiku catches all three by combining signals: title + description + hashtags + author name + author bio context.

#### The Haiku prompt:

```
You are a place extraction assistant. From the following TikTok metadata, 
identify the specific real-world place (restaurant, cafe, bar, attraction, 
shop, etc.) being featured in this video.

Combine all available signals — the title may be vague but the description, 
hashtags, and author context often narrow it down.

Title: {{.Title}}
Description: {{.Description}}
Hashtags: {{.Hashtags | join ", "}}
Author: {{.AuthorName}}

Return ONLY valid JSON (no markdown fences, no explanation outside the JSON):
{
  "place_query": "a search query optimized for Google Places Text Search API — MUST be in English (transliterate if needed)",
  "place_name_guess": "the specific place name if you can identify it, or null if uncertain",
  "city_hint": "the city or area if identifiable, or null",
  "category": "one of: restaurant, cafe, bar, hotel, attraction, park, beach, museum, shop, gym, spa, bakery, other",
  "confidence": "high if you identified a specific named place, medium if you identified the type and location but not the name, low if you could only guess, none if there is no place-related content",
  "reasoning": "one sentence explaining your logic"
}

IMPORTANT: 
- The content may be in ANY language (Arabic, Japanese, French, etc.). You must understand it regardless.
- Always return place_query in English (transliterated if needed) as it will be used with Google Places API.
- If the TikTok is not about a place at all (e.g. a dance video), return confidence "none".
```

#### What the module exports:

```go
type LLMResult struct {
    PlaceQuery     string  `json:"place_query"`
    PlaceNameGuess *string `json:"place_name_guess"` // nullable
    CityHint       *string `json:"city_hint"`        // nullable
    Category       string  `json:"category"`
    Confidence     string  `json:"confidence"`        // "high" | "medium" | "low" | "none"
    Reasoning      string  `json:"reasoning"`
}

// AnalyzeTikTok sends the metadata to Claude Haiku and returns structured extraction.
func AnalyzeTikTok(ctx context.Context, apiKey string, meta *TikTokMeta) (*LLMResult, error)
```

#### Implementation notes:

- **HTTP call to Anthropic API**: Use a direct HTTP POST to `https://api.anthropic.com/v1/messages` — do NOT add an Anthropic Go SDK dependency. Keep it simple with `net/http`:
  ```go
  // Request body
  {
    "model": "claude-haiku-4-20250414",
    "max_tokens": 300,
    "messages": [{"role": "user", "content": prompt}]
  }
  ```
  Headers:
  ```
  x-api-key: <ANTHROPIC_API_KEY>
  anthropic-version: 2023-06-01
  Content-Type: application/json
  ```
- **Response parsing**: Extract `content[0].text` from the response, then `json.Unmarshal` into `LLMResult`.
- **Timeout**: 15-second timeout on the HTTP call.
- **Error handling**: If Haiku fails or returns unparseable JSON, return a result with `confidence: "none"` rather than erroring out. The user can still search manually.
- **Cost**: ~$0.0005 per call (500 input tokens, 100 output tokens with Haiku pricing). Negligible.

---

## Step 4: Backend — Google Places Resolution

### New file: `backend/internal/extract/places.go`

This module takes the LLM's `place_query` and searches Google Places to find real place candidates with coordinates.

#### Google Places Text Search API:

```
GET https://maps.googleapis.com/maps/api/place/textsearch/json
    ?query=<place_query>
    &key=<GOOGLE_PLACES_API_KEY>
```

If the LLM provided a `city_hint`, append it to the query for better results:
```
query = place_query + " " + city_hint   (if city_hint is not null)
```

#### What the module exports:

```go
type PlaceCandidate struct {
    Name          string   `json:"name"`
    Address       string   `json:"address"`
    Lat           float64  `json:"lat"`
    Lng           float64  `json:"lng"`
    GooglePlaceID string   `json:"google_place_id"`
    Types         []string `json:"types"`         // Google place types e.g. ["restaurant", "food"]
    SuggestedTags []string `json:"suggested_tags"` // mapped to your app's tag system
    Rating        *float64 `json:"rating"`         // Google rating, nullable
}

// SearchPlaces queries Google Places Text Search API and returns up to 3 candidates.
func SearchPlaces(ctx context.Context, apiKey string, query string) ([]PlaceCandidate, error)
```

#### Implementation notes:

- **Max 3 results**: Parse the `results` array from Google's response but only return the first 3.
- **Tag mapping**: Map Google's `types[]` to your app's tag system. Create a mapping table:
  ```go
  var googleTypeToTag = map[string]string{
      "restaurant":      "restaurant",
      "cafe":            "cafe",
      "bar":             "bar",
      "bakery":          "bakery",
      "night_club":      "bar",
      "museum":          "museum",
      "art_gallery":     "art",
      "park":            "park",
      "gym":             "gym",
      "spa":             "spa",
      "shopping_mall":   "shopping",
      "clothing_store":  "shopping",
      "lodging":         "hotel",
      "tourist_attraction": "attraction",
      "beach":           "beach",
  }
  ```
  Also include the LLM's `category` as a suggested tag if it's not already in the list.
- **Fields from Google response**: Parse `results[].name`, `results[].formatted_address`, `results[].geometry.location.lat/lng`, `results[].place_id`, `results[].types`, `results[].rating`.
- **Timeout**: 10 seconds.
- **Cost**: Google Places Text Search costs ~$0.032 per call.

---

## Step 5: Backend — Extract Handler and Route

### New file: `backend/internal/handlers/extract.go`

#### Endpoint: `POST /api/v1/places/extract`

This is the single endpoint the frontend calls. It orchestrates the full extraction pipeline.

**Request body:**
```json
{
  "url": "https://www.tiktok.com/@user/video/1234567890"
}
```

**Response (success — candidates found):**
```json
{
  "candidates": [
    {
      "name": "L'Industrie Pizzeria",
      "address": "254 S 2nd St, Brooklyn, NY 11211, USA",
      "lat": 40.7128,
      "lng": -73.9576,
      "google_place_id": "ChIJ...",
      "types": ["restaurant", "food"],
      "suggested_tags": ["pizza", "restaurant", "italian"],
      "rating": 4.7
    },
    {
      "name": "Best Pizza",
      "address": "33 Havemeyer St, Brooklyn, NY 11211, USA",
      "lat": 40.7102,
      "lng": -73.9580,
      "google_place_id": "ChIJ...",
      "types": ["restaurant", "food"],
      "suggested_tags": ["pizza", "restaurant"],
      "rating": 4.5
    }
  ],
  "confidence": "medium",
  "reasoning": "Description mentions 'best pizza spot in Brooklyn' — found top pizza restaurants in Brooklyn area.",
  "source_title": "Best pizza spot in Brooklyn 🍕 you need this #food #nyc"
}
```

**Response (no place found):**
```json
{
  "candidates": [],
  "confidence": "none",
  "reasoning": "This TikTok appears to be a dance video with no place-related content.",
  "source_title": "New dance trend 🔥 #fyp #viral"
}
```

#### Handler logic (pseudocode):

```go
func (h *ExtractHandler) ExtractPlace(w http.ResponseWriter, r *http.Request) {
    // 1. Parse request
    var req struct {
        URL string `json:"url"`
    }
    // validate URL is a TikTok URL (regex: https://(www\.|vm\.)?tiktok\.com/)

    // 2. Fetch TikTok metadata
    meta, err := extract.FetchMeta(r.Context(), req.URL)
    // if err: return 422 "could not fetch TikTok metadata"

    // 3. Send to Claude Haiku for analysis
    llmResult, err := extract.AnalyzeTikTok(r.Context(), h.anthropicKey, meta)
    // if err: return partial response with confidence "none"

    // 4. If confidence is "none", return early (no place to search for)
    if llmResult.Confidence == "none" {
        return response with empty candidates + reasoning
    }

    // 5. Search Google Places
    candidates, err := extract.SearchPlaces(r.Context(), h.googlePlacesKey, llmResult.PlaceQuery)
    // if err: return partial response with just the LLM result

    // 6. Return full response
    return response with candidates + confidence + reasoning + source_title
}
```

#### Handler struct:

```go
type ExtractHandler struct {
    anthropicKey   string
    googlePlacesKey string
}

func NewExtractHandler(anthropicKey, googlePlacesKey string) *ExtractHandler {
    return &ExtractHandler{
        anthropicKey:   anthropicKey,
        googlePlacesKey: googlePlacesKey,
    }
}
```

### File: `backend/internal/handlers/routes.go`

Add the extract handler and route. The endpoint requires authentication (user must be logged in):

```go
// In RegisterRoutes(), after creating other handlers:
extractH := NewExtractHandler(deps.Config.AnthropicAPIKey, deps.Config.GooglePlacesKey)

// Under the `protected` subrouter (auth required):
protected.HandleFunc("/places/extract", extractH.ExtractPlace).Methods(http.MethodPost)
```

**Important**: Register this route BEFORE `/places/{id}` to avoid gorilla/mux treating "extract" as a place ID.

### New dependency in `go.mod`:

```
golang.org/x/net  (for HTML parsing — run: go get golang.org/x/net)
```

---

## Step 6: Backend — Tests

### File: `backend/internal/extract/tiktok_test.go`

Test the TikTok metadata fetcher:
- Test oEmbed parsing with a mock HTTP response
- Test HTML meta tag extraction with sample HTML
- Test hashtag extraction from various formats (`#food`, `#日本語`, `#café`)
- Test URL validation (accept tiktok.com, vm.tiktok.com; reject youtube.com)
- Test redirect following (vm.tiktok.com short URLs)

### File: `backend/internal/extract/llm_test.go`

Test the LLM response parsing:
- Test with a well-formed Haiku JSON response
- Test with malformed JSON (should return confidence "none", not error)
- Test prompt construction with multilingual input (Arabic, Japanese)

### File: `backend/internal/extract/places_test.go`

Test the Google Places integration:
- Test response parsing with sample Google API JSON
- Test tag mapping (Google types → app tags)
- Test empty results handling

### File: `backend/internal/handlers/extract_test.go`

Integration tests for the endpoint:
- Test with valid TikTok URL → expect candidates
- Test with non-TikTok URL → expect 400 error
- Test with missing URL → expect 400 error
- Test unauthenticated → expect 401
- Mock the extract functions (don't hit real APIs in tests)

---

## Step 7: Frontend — New Service

### New file: `frontend/src/services/extractService.ts`

```typescript
import api from './api';

export interface PlaceCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_place_id: string;
  types: string[];
  suggested_tags: string[];
  rating: number | null;
}

export interface ExtractResult {
  candidates: PlaceCandidate[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  reasoning: string;
  source_title: string;
}

export const extractService = {
  /**
   * Send a TikTok URL to the backend for place extraction.
   * Returns candidates with pre-filled place data.
   */
  extract: async (url: string): Promise<ExtractResult> => {
    const res = await api.post<{data: ExtractResult}>('/places/extract', {url});
    return res.data.data;
  },
};
```

---

## Step 8: Frontend — Deep Linking Configuration

### File: `frontend/src/App.tsx`

Current state — no linking config:
```tsx
<NavigationContainer>
  <RootNavigator />
</NavigationContainer>
```

Updated — add linking configuration:

```tsx
import {Linking} from 'react-native';

const linking = {
  prefixes: ['yourapp://'],
  config: {
    screens: {
      // The RootNavigator renders AppNavigator when authenticated.
      // React Navigation resolves nested navigators automatically.
      CreatePlace: {
        path: 'add-place',
        parse: {
          tiktokUrl: (url: string) => decodeURIComponent(url),
        },
      },
    },
  },
  // Handle the case where the app was opened from a killed state
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    return url;
  },
  // Handle the case where the app is already running in the background
  subscribe(listener: (url: string) => void) {
    const subscription = Linking.addEventListener('url', ({url}) => listener(url));
    return () => subscription.remove();
  },
};

// Then in the JSX:
<NavigationContainer linking={linking}>
  <RootNavigator />
</NavigationContainer>
```

**How deep link URLs will look:**
```
yourapp://add-place?tiktokUrl=https%3A%2F%2Fwww.tiktok.com%2F%40user%2Fvideo%2F123
```

**Important edge case — user not logged in:**
If the app opens via deep link but the user is not authenticated, `RootNavigator` will show `AuthNavigator` (login screen). The deep link params will be lost. To handle this:
- Store the pending deep link URL in a module-level variable or context
- After login completes, check for the pending URL and navigate accordingly
- This is a polish item (Step 13) — for v1, require the user to be logged in

---

## Step 9: Frontend — Update Navigation Types

### File: `frontend/src/types/navigation.ts`

Update the `CreatePlace` params to accept TikTok extraction data:

```typescript
export type AppStackParamList = {
  Home: undefined;
  Settings: undefined;
  CreateSpace: undefined;
  CreatePlace: {
    // Existing params (from space context)
    spaceId?: number;
    spaceTags?: string[];
    // NEW — from TikTok share / deep link
    tiktokUrl?: string;
    // NEW — pre-filled data (from extraction or deep link with pre-resolved data)
    prefillName?: string;
    prefillLat?: number;
    prefillLng?: number;
    prefillAddress?: string;
    prefillTags?: string[];
  } | undefined;
  SpaceDetail: {
    spaceId: number;
    spaceName: string;
    spaceIcon: string;
    bannerUrl: string | null;
  };
  PlaceDetail: {
    placeId: number;
    placeName: string;
    fromSpaceId?: number;
  };
};
```

---

## Step 10: Frontend — Update CreatePlaceScreen

### File: `frontend/src/screens/app/CreatePlaceScreen.tsx`

This is the most significant frontend change. The screen currently accepts `spaceId` and `spaceTags`. It needs to also handle:
1. A `tiktokUrl` param → triggers extraction flow
2. `prefillName/Lat/Lng/Address/Tags` params → directly fills the form
3. A new **destination picker** (multi-select: saved places + spaces)

#### 10a. Extraction loading state

At the top of the component, after reading route params:

```typescript
const tiktokUrl = route.params?.tiktokUrl;
const prefillName = route.params?.prefillName;
const prefillLat = route.params?.prefillLat;
const prefillLng = route.params?.prefillLng;
const prefillAddress = route.params?.prefillAddress;
const prefillTags = route.params?.prefillTags;

const [extracting, setExtracting] = useState(false);
const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
const [showCandidatePicker, setShowCandidatePicker] = useState(false);
```

Add a `useEffect` that runs extraction when `tiktokUrl` is present:

```typescript
useEffect(() => {
  if (!tiktokUrl) return;

  const run = async () => {
    setExtracting(true);
    try {
      const result = await extractService.extract(tiktokUrl);
      setExtractResult(result);

      if (result.confidence === 'high' && result.candidates.length >= 1) {
        // Auto-fill with the top candidate
        applyCandidate(result.candidates[0]);
      } else if (result.confidence === 'medium' && result.candidates.length > 1) {
        // Show picker for user to choose
        setShowCandidatePicker(true);
      } else {
        // Low/none confidence — show a message, user searches manually
        Alert.alert(
          'Place not identified',
          result.confidence === 'none'
            ? 'This TikTok doesn\'t seem to be about a specific place. You can search manually below.'
            : `We found some possibilities but aren't sure. Try searching manually.\n\n${result.reasoning}`,
        );
      }
    } catch (err: any) {
      Alert.alert('Extraction failed', 'Could not analyze the TikTok. You can search for the place manually.');
    } finally {
      setExtracting(false);
    }
  };

  run();
}, [tiktokUrl]);
```

Also handle direct prefill params (without extraction, for future use):

```typescript
useEffect(() => {
  if (prefillName) setName(prefillName);
  if (prefillTags) setTags(prefillTags);
  if (prefillLat != null && prefillLng != null && prefillAddress) {
    setPickedLocation({lat: prefillLat, lng: prefillLng, address: prefillAddress});
    mapRef.current?.animateToRegion({
      latitude: prefillLat,
      longitude: prefillLng,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    }, 600);
  }
}, []);
```

The `applyCandidate` helper:

```typescript
const applyCandidate = (candidate: PlaceCandidate) => {
  setName(candidate.name);
  setPickedLocation({
    lat: candidate.lat,
    lng: candidate.lng,
    address: candidate.address,
  });
  setTags(candidate.suggested_tags);
  mapRef.current?.animateToRegion({
    latitude: candidate.lat,
    longitude: candidate.lng,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  }, 600);
  setShowCandidatePicker(false);
};
```

#### 10b. Candidate picker (when confidence is "medium")

When the backend returns 2-3 candidates, show a bottom sheet / modal for the user to pick:

```tsx
{showCandidatePicker && extractResult && (
  <Modal visible animationType="slide" transparent>
    <View style={candidateStyles.backdrop}>
      <View style={candidateStyles.sheet}>
        <Text style={candidateStyles.title}>Which place is it?</Text>
        <Text style={candidateStyles.subtitle}>
          We found a few possibilities from this TikTok
        </Text>

        {extractResult.candidates.map((c, i) => (
          <TouchableOpacity
            key={c.google_place_id || i}
            style={candidateStyles.card}
            onPress={() => applyCandidate(c)}
            activeOpacity={0.75}>
            <Text style={candidateStyles.name}>{c.name}</Text>
            <Text style={candidateStyles.address}>{c.address}</Text>
            {c.rating && (
              <Text style={candidateStyles.rating}>⭐ {c.rating}</Text>
            )}
            {c.suggested_tags.length > 0 && (
              <View style={candidateStyles.tagRow}>
                {c.suggested_tags.slice(0, 3).map(t => (
                  <View key={t} style={candidateStyles.tag}>
                    <Text style={candidateStyles.tagText}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={candidateStyles.skipBtn}
          onPress={() => setShowCandidatePicker(false)}>
          <Text style={candidateStyles.skipText}>None of these — search manually</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
)}
```

#### 10c. Loading overlay (while extraction runs)

When `extracting` is true, show a full-screen loading overlay on top of the form:

```tsx
{extracting && (
  <View style={extractStyles.overlay}>
    <ActivityIndicator size="large" color={colors.primary} />
    <Text style={extractStyles.loadingTitle}>Analyzing TikTok...</Text>
    <Text style={extractStyles.loadingSubtitle}>
      Finding the place mentioned in this video
    </Text>
  </View>
)}
```

#### 10d. Destination picker (replaces single-space save logic)

Currently the save flow is:
- If `spaceId` is set → create place (saved=false) → add to that space → goBack
- If `spaceId` is not set → create place (saved=true) → show success

Replace this with a **multi-destination picker** that appears before saving. This is especially needed for the TikTok flow where the user may want to add to multiple spaces.

Add a new state:

```typescript
const [showDestinationPicker, setShowDestinationPicker] = useState(false);
const [userSpaces, setUserSpaces] = useState<ApiSpace[]>([]);
const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<number>>(new Set());
const [savedPlacesSelected, setSavedPlacesSelected] = useState(true); // default on
```

Fetch the user's spaces when the destination picker opens:

```typescript
const loadSpaces = async () => {
  try {
    const spaces = await homeService.fetchSpaces();
    setUserSpaces(spaces);
  } catch {}
};
```

If `spaceId` is pre-set (came from a specific space), pre-select it and uncheck saved places:

```typescript
useEffect(() => {
  if (spaceId) {
    setSelectedSpaceIds(new Set([spaceId]));
    setSavedPlacesSelected(false);
  }
}, [spaceId]);
```

The destination picker UI:

```tsx
<Modal visible={showDestinationPicker} animationType="slide" transparent>
  <View style={destStyles.backdrop}>
    <View style={destStyles.sheet}>
      <Text style={destStyles.title}>Add this place to...</Text>

      {/* Saved Places toggle */}
      <TouchableOpacity
        style={destStyles.option}
        onPress={() => setSavedPlacesSelected(!savedPlacesSelected)}>
        <Text style={destStyles.optionIcon}>{savedPlacesSelected ? '☑' : '☐'}</Text>
        <Text style={destStyles.optionEmoji}>📍</Text>
        <Text style={destStyles.optionLabel}>Saved Places</Text>
      </TouchableOpacity>

      {/* Spaces list */}
      {userSpaces.map(space => {
        const selected = selectedSpaceIds.has(space.id);
        return (
          <TouchableOpacity
            key={space.id}
            style={destStyles.option}
            onPress={() => {
              const next = new Set(selectedSpaceIds);
              selected ? next.delete(space.id) : next.add(space.id);
              setSelectedSpaceIds(next);
            }}>
            <Text style={destStyles.optionIcon}>{selected ? '☑' : '☐'}</Text>
            <Text style={destStyles.optionEmoji}>{space.icon}</Text>
            <Text style={destStyles.optionLabel}>{space.name}</Text>
          </TouchableOpacity>
        );
      })}

      {/* Save button */}
      <TouchableOpacity
        style={destStyles.saveBtn}
        disabled={!savedPlacesSelected && selectedSpaceIds.size === 0}
        onPress={handleSaveWithDestinations}>
        <Text style={destStyles.saveBtnText}>
          Save to {(savedPlacesSelected ? 1 : 0) + selectedSpaceIds.size} destination(s)
        </Text>
      </TouchableOpacity>
    </View>
  </View>
</Modal>
```

#### 10e. Updated save handler

Replace the current `handleSave` with a two-step flow:

```typescript
// Step 1: User taps "Save" button on the form → open destination picker
const handleSavePress = () => {
  if (!canSave) return;
  loadSpaces();
  setShowDestinationPicker(true);
};

// Step 2: User confirms destinations → execute the save
const handleSaveWithDestinations = async () => {
  if (!canSave || !pickedLocation) return;
  setShowDestinationPicker(false);
  setSaving(true);
  try {
    // Create the place. saved=true if "Saved Places" is checked,
    // OR if no spaces are selected (fallback to personal).
    const isSaved = savedPlacesSelected || selectedSpaceIds.size === 0;
    const place = await placeService.create(
      name.trim(),
      pickedLocation.lat,
      pickedLocation.lng,
      pickedLocation.address,
      isSaved,
    );

    // Add tags
    if (tags.length > 0) {
      try { await placeService.addTags(place.id, tags); place.tags = tags; } catch {}
    }

    // Add to each selected space
    const spaceErrors: string[] = [];
    for (const sid of selectedSpaceIds) {
      try {
        await spaceDetailService.addPlace(sid, place.id);
      } catch (err: any) {
        const spaceName = userSpaces.find(s => s.id === sid)?.name ?? `Space ${sid}`;
        spaceErrors.push(spaceName);
      }
    }

    if (spaceErrors.length > 0) {
      Alert.alert('Partial success', `Place saved but could not add to: ${spaceErrors.join(', ')}`);
    }

    // If we came from a specific space, go back to it. Otherwise show success.
    if (spaceId !== undefined) {
      navigation.goBack();
    } else {
      setSaved(place);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to save place';
    Alert.alert('Error', msg);
  } finally {
    setSaving(false);
  }
};
```

**Important**: The existing "Save" button at the bottom of the form should now call `handleSavePress` (opens destination picker) instead of directly saving. The button label should change to "Next — Choose Destination".

---

## Step 11: iOS — Share Extension

This is a **native Swift extension** that appears in TikTok's share sheet. It is NOT React Native code.

### 11a. Create the extension target in Xcode

1. Open `frontend/ios/frontend.xcworkspace` in Xcode
2. File → New → Target → "Share Extension"
3. Product name: `ShareExtension`
4. Language: Swift
5. This creates a new folder: `frontend/ios/ShareExtension/`

### 11b. File: `frontend/ios/ShareExtension/ShareViewController.swift`

```swift
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            close()
            return
        }

        for item in extensionItems {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                // Check for URL
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] (item, _) in
                        if let url = item as? URL {
                            self?.openMainApp(with: url.absoluteString)
                        } else {
                            self?.close()
                        }
                    }
                    return
                }
                // Check for plain text (TikTok sometimes shares as text)
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (item, _) in
                        if let text = item as? String,
                           let url = self?.extractTikTokURL(from: text) {
                            self?.openMainApp(with: url)
                        } else {
                            self?.close()
                        }
                    }
                    return
                }
            }
        }
        close()
    }

    /// Extract a TikTok URL from shared text (TikTok often shares "Check this out: <url>")
    private func extractTikTokURL(from text: String) -> String? {
        let pattern = #"https?://(www\.|vm\.)?tiktok\.com/[^\s]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else {
            return nil
        }
        return String(text[range])
    }

    private func openMainApp(with tiktokURL: String) {
        guard let encoded = tiktokURL.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let appURL = URL(string: "yourapp://add-place?tiktokUrl=\(encoded)") else {
            close()
            return
        }

        // Open the main app via the custom URL scheme.
        // Share extensions cannot call UIApplication.shared.open directly,
        // so we use the responder chain trick.
        var responder: UIResponder? = self
        while let r = responder {
            if let application = r as? UIApplication {
                application.open(appURL, options: [:], completionHandler: nil)
                break
            }
            responder = r.next
        }

        // Close the extension after a brief delay to allow the app to open
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.close()
        }
    }

    private func close() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
```

### 11c. File: `frontend/ios/ShareExtension/Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionAttributes</key>
        <dict>
            <key>NSExtensionActivationRule</key>
            <dict>
                <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
                <integer>1</integer>
                <key>NSExtensionActivationSupportsText</key>
                <true/>
            </dict>
        </dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.share-services</string>
        <key>NSExtensionPrincipalClass</key>
        <string>ShareExtension.ShareViewController</string>
    </dict>
</dict>
</plist>
```

### 11d. File: `frontend/ios/frontend/Info.plist`

Add the URL scheme to the EXISTING Info.plist. Insert before the closing `</dict>`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>yourapp</string>
        </array>
        <key>CFBundleURLName</key>
        <string>com.yourapp.share</string>
    </dict>
</array>
```

### 11e. File: `frontend/ios/frontend/AppDelegate.mm`

Add URL handling to the existing AppDelegate. Add this import and method:

```objc
#import <React/RCTLinkingManager.h>

// Add this method inside @implementation AppDelegate:

- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}
```

### 11f. App Groups (sharing data between extension and main app)

Both the main app and the share extension need to be in the same App Group to share data. In Xcode:
1. Select the main app target → Signing & Capabilities → + Capability → App Groups
2. Add a group: `group.com.yourapp.shared`
3. Select the ShareExtension target → same steps → same group

This is not strictly needed for the URL-based approach above but is important if you later want to cache the shared URL or auth token in `UserDefaults(suiteName: "group.com.yourapp.shared")`.

---

## Step 12: Android — Share Intent + Deep Link

### 12a. File: `frontend/android/app/src/main/AndroidManifest.xml`

Add TWO new intent-filters to the existing `<activity>` element (inside the `<activity>` tag, alongside the existing MAIN/LAUNCHER filter):

```xml
<!-- Deep link: yourapp://add-place?tiktokUrl=... -->
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="yourapp" />
</intent-filter>

<!-- Receive shared text/URLs from other apps (TikTok share) -->
<intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="text/plain" />
</intent-filter>
```

### 12b. File: `frontend/android/app/src/main/java/com/frontend/MainActivity.kt`

Update to handle incoming shared text and convert it to a deep link:

```kotlin
package com.frontend

import android.content.Intent
import android.net.Uri
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "frontend"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent) // update the intent so Linking.getInitialURL works
    }

    /**
     * Override to intercept ACTION_SEND intents (from TikTok share sheet)
     * and convert them into deep link URLs that React Navigation can handle.
     */
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        handleSendIntent(intent)
    }

    private fun handleSendIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return

        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return

        // Extract TikTok URL from the shared text
        val tiktokRegex = Regex("""https?://(www\.|vm\.)?tiktok\.com/\S+""")
        val match = tiktokRegex.find(sharedText) ?: return
        val tiktokUrl = match.value

        // Convert to deep link format so React Navigation handles it
        val encoded = Uri.encode(tiktokUrl)
        val deepLink = Uri.parse("yourapp://add-place?tiktokUrl=$encoded")

        // Replace the intent so Linking picks it up
        val newIntent = Intent(Intent.ACTION_VIEW, deepLink)
        setIntent(newIntent)
    }
}
```

---

## Step 13: Polish and Edge Cases

### 13a. Deep link when user is not logged in

If the app opens from a TikTok share but the user isn't authenticated:

**File: `frontend/src/App.tsx`**

Create a pending-URL store:

```typescript
// Module-level variable to store a pending deep link
let pendingDeepLink: string | null = null;

export function setPendingDeepLink(url: string | null) {
  pendingDeepLink = url;
}
export function consumePendingDeepLink(): string | null {
  const url = pendingDeepLink;
  pendingDeepLink = null;
  return url;
}
```

In `RootNavigator`, after login completes, check for a pending deep link and navigate to CreatePlace with it.

### 13b. TikTok URL formats to support

TikTok shares URLs in several formats. The backend URL validator and the share extension regex must handle all:

```
https://www.tiktok.com/@username/video/1234567890123456789
https://vm.tiktok.com/ZMxxxxxxx/           (short URL, redirects)
https://www.tiktok.com/t/ZMxxxxxxx/        (another short format)
https://m.tiktok.com/v/1234567890.html     (mobile web)
```

### 13c. Rate limiting

Add rate limiting to `POST /api/v1/places/extract` — since each call costs ~$0.03, protect against abuse:
- Max 20 extractions per user per hour
- Max 100 per user per day
- Return 429 Too Many Requests with a clear message

### 13d. Caching

If the same TikTok URL is extracted twice (user shares the same video), cache the result for 24 hours:
- Add a `url_extractions` table: `(url_hash VARCHAR(64) PRIMARY KEY, result JSON, created_at TIMESTAMP)`
- Before running the pipeline, check the cache
- This saves both Haiku and Google Places API costs

### 13e. Future: Support more platforms

The extraction architecture is pluggable. To add Instagram Reels or Google Maps links later:
1. Add a new file `backend/internal/extract/instagram.go` (or `gmaps.go`)
2. In the handler, detect the URL domain and route to the right fetcher
3. The LLM + Google Places steps stay the same

---

## File Summary

### New files to create:

| File | Purpose |
|---|---|
| `backend/internal/extract/tiktok.go` | Fetch TikTok oEmbed + HTML meta tags |
| `backend/internal/extract/llm.go` | Claude Haiku LLM extraction |
| `backend/internal/extract/places.go` | Google Places text search |
| `backend/internal/extract/tiktok_test.go` | Tests for TikTok fetcher |
| `backend/internal/extract/llm_test.go` | Tests for LLM parsing |
| `backend/internal/extract/places_test.go` | Tests for Google Places |
| `backend/internal/handlers/extract.go` | `POST /places/extract` handler |
| `backend/internal/handlers/extract_test.go` | Handler tests |
| `frontend/src/services/extractService.ts` | Frontend API client for extraction |
| `frontend/ios/ShareExtension/ShareViewController.swift` | iOS share extension |
| `frontend/ios/ShareExtension/Info.plist` | Share extension config |

### Existing files to modify:

| File | Changes |
|---|---|
| `backend/.env` | Add `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` |
| `backend/internal/config/config.go` | Add `AnthropicAPIKey`, `GooglePlacesKey` to Config struct + Load() |
| `backend/internal/handlers/routes.go` | Create `ExtractHandler`, register `POST /places/extract` route (before `/places/{id}`) |
| `backend/go.mod` | Add `golang.org/x/net` dependency |
| `frontend/src/types/navigation.ts` | Add `tiktokUrl`, `prefillName`, `prefillLat`, `prefillLng`, `prefillAddress`, `prefillTags` to `CreatePlace` params |
| `frontend/src/App.tsx` | Add `linking` config to `NavigationContainer` with `yourapp://` prefix and `add-place` route |
| `frontend/src/screens/app/CreatePlaceScreen.tsx` | Add extraction loading state, candidate picker modal, destination picker modal, updated save handler |
| `frontend/ios/frontend/Info.plist` | Add `CFBundleURLTypes` with `yourapp` scheme |
| `frontend/ios/frontend/AppDelegate.mm` | Add `#import <React/RCTLinkingManager.h>` and `openURL:options:` method |
| `frontend/android/app/src/main/AndroidManifest.xml` | Add VIEW + SEND intent-filters |
| `frontend/android/app/src/main/java/com/frontend/MainActivity.kt` | Add `handleSendIntent` to convert shared text → deep link |
| `frontend/package.json` | No new npm dependencies needed (Linking is built into React Native) |

---

## Implementation Order (recommended)

| Order | Step | Description |
|---|---|---|
| 1 | Steps 1-5 | Backend: config + extract package + handler + route |
| 2 | Step 6 | Backend: tests (verify extraction pipeline works) |
| 3 | Step 7 | Frontend: extractService.ts |
| 4 | Steps 8-9 | Frontend: deep linking config + navigation types |
| 5 | Step 10 | Frontend: CreatePlaceScreen updates (extraction + destination picker) |
| 6 | Step 11 | iOS: URL scheme + Share Extension (requires Xcode) |
| 7 | Step 12 | Android: intent-filters + MainActivity update |
| 8 | Step 13 | Polish: auth edge case, rate limiting, caching |

Steps 1-5 can be tested with curl before any frontend work.
Steps 6-7 can be tested by navigating to CreatePlaceScreen with mock tiktokUrl params.
Steps 11-12 require building on real devices / simulators.
