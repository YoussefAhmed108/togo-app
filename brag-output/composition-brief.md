# Hyperframes Composition Brief: Waypoint

## Objective
Short app-store-style brag video for Waypoint (working name; see name note in brag-plan.md).

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20.5s

## Source Material
- Project root: /Users/yoamin/Projects/app
- Primary files read: PRODUCT.md, frontend/src/theme/index.ts, components/WaypointLoader.tsx, components/RouteWait.tsx, screens/app/CreatePlaceScreen.tsx, screens/HomeScreen.tsx
- Strongest claim: "$0.0417 a share. Same video again: $0." (measured, PRODUCT.md)
- UI to recreate: RouteWait analysing screen, Add Place result + vote, "Add this place to…" sheet, Space list with travel times, WaypointLoader route mark
- Verbatim copy: "Analysing TikTok…", "Reading the video", "Finding the place", "Matching it on the map", "This usually takes about 20 seconds.", "Found from your TikTok", "Is this the right place?", "Add this place to…", "Saved Places", "Place saved!", "Food & drink"

## Creative Direction
- Tone preset: app-store; direction: bright, confident mobile launch film grounded in the real screens
- Hook: "Saw a place on TikTok?" types beside a phone showing a sample food video; tap Share.
- Outro: route logo draws, "Waypoint" lands, "From TikTok to table."
- Avoid: generic SaaS language, abstract filler, invented users/testimonials/metrics. All venues, people, times are sample data.

## Visual Identity
- Background #F0F0F3, surface #FDFDFF, text #1C1C25 / #5C5C69, teal #00838E (text-safe #006873), header teal #00828E→#005F68, violet #6A69DB, category orange #E65719
- Fonts: Figtree Bold / SemiBold / Medium / Regular (local TTFs in assets/fonts)

## Storyboard
See brag-plan.md. 1 Hook 0–3 · 2 Analysing 3–7 · 3 Found+saved 7–11.5 · 4 Space 11.5–14.5 · 5 Number 14.5–17 · 6 Outro 17–20.5

## Audio
- Music: assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3, 0.45 volume, fade out last ~1.2s
- Cues: preset `cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`; outro cut 17.02 strong cue, logo landing 17.52 strong cue; stage ticks on every other beat (4.02, 5.03, 6.03)
- Audio-reactive: skipped — hyperframes-creative extraction helper not installed in this environment.
- SFX (low/medium HF risk from sfx-analysis.md): click_002 taps, keypress ticks on hook typing, select_008 stage ticks, drop_002 pin, impactGlass_light_002 saved, card-slide-1 space rows, chip-lay-1 on $0, impactSoft_medium_001 logo.

## Hyperframes Instructions
Hyperframes domain skills were not installed; implementation follows `npx hyperframes docs` (data-attributes, compositions, gsap) and the project CLAUDE.md. Gate: `npx hyperframes check`.
