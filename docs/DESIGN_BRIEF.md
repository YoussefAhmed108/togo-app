# Design Brief — Shared Places & Memories App

Mobile app (React Native, iOS + Android). Portrait phone screens only. No tab bar today — a single stack with a Home hub.

## 1. Purpose

A social place-keeping app. Users save places they love, group them into **Spaces** shared with friends, attach **Memories** (photos + captions) to places inside those spaces, and get **Recommendations** for new places based on their interests and their spaces' activity.

Three nouns drive everything:

| Noun | What it is |
|---|---|
| **Place** | A pinned location (name, address, lat/lng, tags, visited flag). Personal, or added into a space. |
| **Space** | A shared group (name, emoji or banner photo, members, places). Joined via invite link. |
| **Memory** | A photo + optional caption attached to a place, inside a space. The emotional payload of the app. |

Tone target: warm, personal, a little playful. Emoji are used as first-class iconography (place category, space icon, interest categories) — the design should treat emoji as a deliberate visual system, not a placeholder.

## 2. Screens

### Auth flow (unauthenticated stack)

**1. Login** — Logo + tagline "Your places, your memories." Heading "Welcome back", sub "Sign in to your account". Email field, password field, inline field errors, an API-error banner, primary Sign In button, footer "Don't have an account? Create one".

**2. Signup** — "Create account" / "It's free and takes 30 seconds." Fields: email, phone, password, confirm password. Live **password strength meter** (bar + colored label). Terms of Service / Privacy Policy fine print. Footer link back to Sign in.

**3. Profile Setup** (forced after registration, no back) — 👋 "One last step". Fields: display name ("How you'll appear to others"), username ("e.g. alice_wanders") with a hint line. Continue button.

**4. Interest Picker** (shown once, right after profile setup) — ✨ "What do you love?" A selectable grid of 8 interest cards, each with emoji + label + one-line description, and a ✓ check badge when selected:
Food & Dining 🍽️ · Coffee & Cafés ☕ · Outdoors & Parks 🌳 · Arts & Culture 🎨 · Shopping 🛍️ · Bars & Nightlife 🍸 · Wellness & Fitness 💆 · Entertainment 🎬.
Sticky footer: Continue (label reflects count selected) + "Skip for now".

### Main app (authenticated stack)

**5. Home** — the hub. Two visual zones:
- **Dark header block**: "Good morning, {FirstName}!" (greeting changes by time of day), a tappable **location pill** (📍 Current Location ▾), and a circular avatar with an accent glow ring that opens Settings.
- **Light rounded-top scroll sheet** that overlaps the header, containing three sections. Each section header is a small uppercase tracked-out label with optional "See all" link and a round ＋ button.
  1. **MY SPACES** — horizontal carousel of Space cards.
  2. **SAVED PLACES** — horizontal carousel of Place cards.
  3. **RECOMMENDED FOR YOU** — vertical list of Recommendation rows.
- Every section has a loading **skeleton** state (3 grey card blocks) and a designed **empty state** card: big emoji, title, one-line encouragement, pill CTA. ("No spaces yet" 🌍 / "No saved places yet" 📍 / "Recommendations on the way" ✨ — the last has no button.)

**6. Location Modal** (from the header pill) — "Change Location" / "Choose where to discover places from." Two selectable options: 📍 Use Current Location (hint: "Uses your device GPS") and 🗺️ Set a Custom Location (hint: "Search or drop a pin on the map"). Confirm button; the custom option opens a full **map picker** (search bar + draggable pin + reverse-geocoded address).

**7. Create Space** — two steps in one screen.
- *Configure*: header "New Space" with ‹ back. A **mode toggle: Photo / Emoji**. Photo mode shows a banner image picker (empty state 🖼️ "Add a Banner Photo" + "Choose from Library"; filled state shows the image with a "📷 Tap to change photo" overlay). Emoji mode shows a large emoji tile plus a scrollable emoji picker grid, each emoji tinted by a derived color. Then "SPACE NAME" text field with a 0/60 character counter. Sticky footer: hint line + Create Space button.
- *Success*: "Space Created" — big banner/emoji, space name, sub-line, and an **INVITE FRIENDS** card: the invite link in a truncated pill, "Copy Link" (⎘ → ✓ Copied!) and "Share" (↑) buttons, a hint line, error state if link generation fails. Done button returns Home.

**8. Create Place** — top ~35% of screen is a **live map** with a center pin; below it a form.
- Google Places autocomplete search that animates the map and auto-fills name + address.
- Or drag the map manually → reverse-geocodes to an address (needs a "locating…" state while geocoding and while the map is moving).
- Name field, **tag chips** — a preset row of ~18 suggested tags (restaurant, cafe, bar, pizza, sushi, brunch, park, nature, beach, museum, art, shopping, hotel, coffee, bakery, cocktails, rooftop, gym) each with an emoji, plus a free-text tag input for custom tags.
- Save button, disabled until name + location exist.
- Can be opened **pre-filled** (from a recommendation) and **scoped to a space** (adds directly to that space).

**9. Space Detail** — the richest screen.
- Header: ‹ back, space emoji/banner, space name, and a **member row** (overlapping avatar circles + "N members ›") that opens the Members modal.
- **NEAREST PLACES** section — places sorted by distance from the user. Each row: category emoji tile (with a ✓ overlay if visited), name, address, colored tag chips, a "Visited" pill, and a distance label (e.g. "1.2 km"). Collapsible "See all / Show less". Empty state 📍 "No places yet".
- **MEMORIES** section — a place-scoped photo feed. A "Choose place" button and a "＋ Memory" button. When a place is selected it shows a **focused place card** (emoji, "Selected place", name, address, memory count, distance, "Change" button); a **quick-switch row** of place chips with memory counts; then a horizontal grid of memory photo cards with captions, prefixed by a "＋ Add" tile. Empty state 📷.
- **MEMBERS** section with a link to the full list.
- Space-level recommendations.
- Modals: **Add a Place** sheet (pick from your saved places, ＋ per row, empty state), **Choose a Place** picker (search by place/address/tag, rows show memory count + a "Viewing" badge for the active one, ＋ Add per row, empty state 🔎 "No matching place"), **Members** ("Members (N)" list with colored initial avatars and roles), and **Add Memory**.

**10. Add Memory modal** (from Space or Place) — title "Add Memory" + place name, ✕ close. Photo picker with 📸 Camera / 🖼️ Gallery buttons, then a preview with "Change photo". Caption field with a 0/200 counter. Upload button with a **multi-stage progress state** (presigning → uploading → saving).

**11. Place Detail** — ‹ Back header, place name, 📍 address, tag chips with emoji, and a **Visited toggle** (○ / ✓). Then **Memories**: tabs per space (each with a count badge) since the same place can hold memories in several spaces, a photo grid with captions, an empty state ("No memories yet." / "Tap ＋ to add the first one!"), and an "＋ Add Memory" action.

**12. Settings** — ‹ back, "Settings". Profile hero (large initial avatar, name, @username). **Appearance** card: "Pick the mood of the app on this device." with three selectable theme cards — **Sunrise** (Warm and bright), **Midnight** (Dark and crisp), **Grove** (Soft and earthy). **Profile** card: editable Display Name with an inline Save button, and read-only rows for Email, Phone, Username. Destructive **Log Out** button with a confirm dialog.

## 3. Components to design

- **Space card** (carousel): banner photo or emoji tile, name, overlapping member avatars with "+N" overflow, member count and 📍 place count stats, per-space accent color derived from the name.
- **Place card** (carousel): emoji thumbnail on a category-tinted ground, name, category (in accent color), address, tag chips, optional distance badge.
- **Recommendation row**: colored left stripe, emoji tile, a **reason label** in the stripe color ("Because you like Coffee" / "Popular near your space"), name, category, distance, address, › chevron. Two reason types with distinct colors: *interests* (warm) and *space area* (indigo/blue).
- Section header, loading skeleton, empty-state card, primary/secondary buttons, text input with label + error, error banner, tag chip, member avatar stack, bottom-sheet modal shell.

## 4. Existing visual language (keep or improve, your call)

- **Three themes**, switchable at runtime, all three must be designed:
  - *Sunrise* — light UI (`#F4F4F8` bg, white surfaces) with near-black headers (`#0F0E17`) and an orange brand (`#FF6B35`).
  - *Midnight* — fully dark (`#09111F` bg, `#10192B` surfaces) with a sky-blue brand (`#7DD3FC`).
  - *Grove* — warm off-white paper (`#F3F1E8`) with a deep green brand (`#2F855A`).
- Recurring motifs: dark header block with a rounded-corner light sheet sliding over it; heavy card shadows; pill-shaped buttons; uppercase letter-spaced section labels; emoji-in-a-tinted-tile as the universal icon; category accent colors (restaurant/park/deli/default) that tint chips and cards.
- Semantic colors: error, success, muted text, glass overlay + border for translucent surfaces.

## 5. Functionality summary (backend already supports)

Auth: register, login, token refresh, profile setup, save interests. Users: get/update me. Places: list, create, get, update, delete, toggle visited, add/remove tags, list/add/delete memories. Spaces: list, create, join via invite link, get, update, delete, generate invite link, list/add/remove members, list space memories, list/add/remove places in a space. Recommendations: global (home) and per-space. Uploads: presigned image upload.

## 6. Planned, not yet built — worth designing for

- **Share from TikTok to add a place**: user shares a TikTok video into the app; it extracts the place via LLM + Google Places and opens Create Place pre-filled. Needs: an "Analyzing TikTok…" loading state, a **candidate picker** when confidence is medium (2–3 place options), a graceful fallback to manual search when extraction fails, and a **destination picker** (saved places and/or one or more spaces) on the Create Place screen.
- "See all" destination screens for Spaces and Saved Places (currently no-ops).

## 7. What to produce

Screen designs for all 12 screens plus the modals, in all three themes (or one theme fully plus palette swaps for the other two), with the component set from §3 as a small design system. Phone frames, portrait.
