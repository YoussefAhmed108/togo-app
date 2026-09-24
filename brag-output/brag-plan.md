# Brag Plan: Waypoint

> Name note: PRODUCT.md lists the product name as undecided ("togo-app" / "Waypoint" / "Shared Places & Memories App"). This video uses **Waypoint**, the name the design system and logo loader already carry. Re-run with `--title` to change it.

## What is this app?
Share a TikTok of a Cairo restaurant to the app, and ~20 seconds later it's a pinned, tagged place in a list you share with your friends.

## The angle
"You saw it on TikTok. Now you'll actually go." The video is the share-sheet flow itself: a food TikTok goes in, the app reads it, the pin drops, it lands in the group's Space with live Cairo traffic times. The brag is how little the user has to do and how cheap it is to run: **$0.0417 a share, $0 for the same video again** (measured 29 Aug 2026, from `docs/business-model.html` / PRODUCT.md).

## Hook (first 2-3 seconds)
A vertical TikTok-style food card fills the phone screen. Big line types in beside it: **"Saw a place on TikTok?"** A cursor taps Share, and the app icon appears in the share row.

## Key moments (the middle)
- The real wait screen: "Analysing TikTok…" with the Waypoint route drawing itself and the three real stages ticking off: *Reading the video → Finding the place → Matching it on the map*.
- The result: map pin drops, "Found from your TikTok", tag chip "Food & drink", "Is this the right place?" → tap **Yes**.
- "Add this place to…" → Saved Places + a Space ticked → **Place saved!**
- The Space: the place sits in a shared list with friend avatars and live travel time "18 min · 4.2 km".

## Outro / punchline
Cost card: "$0.0417 a share. Same video again: $0." Then the route logo draws, **Waypoint** lands on the strong beat, subline "From TikTok to table."

## User flow worth showing
TikTok share → Analysing TikTok (3 stages) → confidence match + "Is this the right place?" → Add to Saved Places / Space → Place saved → appears in the shared Space.

## Tone
- Preset: app-store
- Creative direction: bright, confident mobile launch film grounded in the real screens
- Interpretation: clean slides and smooth wipes, feature beats held long enough to read, one bold stat, no jokes forced.

## Format: landscape — 1920x1080
## Duration: 20.5s

## Visual identity (from the project)
- Background: #F0F0F3 (light neutral), header teal #00828E / deep #005F68
- Accent: teal #00838E (a1), violet #6A69DB (a2, people and spaces)
- Text: #1C1C25, secondary #5C5C69
- Display font: Figtree Bold (bundled in `frontend/src/assets/fonts`)
- Body font: Figtree Regular/Medium
- Strongest visual element: the WaypointLoader route mark (5-point zigzag drawn in teal, violet destination dot)

## Share copy (draft)
See a restaurant on TikTok, share it to Waypoint, and 20 seconds later it's pinned in your friends' shared list with live Cairo traffic times.

## Audio direction
- Role: warm upbeat bed with sparse, motion-matched UI accents
- Music: happy-beats-business-moves-vol-1 (120 BPM)
- Music treatment: starts at 0, ~0.45 volume, fades out over the last ~1.2s
- Music cue guidance: preset read (`vol-1.music-cues.md`). Strong cue 17.02s → outro cut; 17.52s → logo landing. Beat grid every ~0.5s from 3.02s; stage ticks snap to every other beat (≈1s apart) for readability.
- Audio-reactive treatment: none (no extraction helper available without the hyperframes-creative skill; documented, not blocking)
- SFX posture: sparse; taps = click, pin drop = drop, saved = soft glass clink, logo = soft impact
- Audio-coupled moments: hook typing (key ticks), share tap, 3 stage ticks, pin drop, Yes tap, saved chime, logo hit
- Restraint rule: no SFX on every element; nothing louder than the music at the logo except one hit.

## Storyboard

### Scene 1 — Hook — 3.0s
Phone at right showing a sample vertical food video card ("Sample · Koshary spot, Downtown"). Left: "Saw a place on TikTok?" types in, holds ~1.4s. Cursor taps Share; share row slides up with the app icon.
Sequential/interaction: yes — typed line, simulated tap on Share, then app icon.
Audio intent: light, curious start. Audio-coupled: key ticks, click on tap.
Transition mood: clean → Scene 2 (phone stays, screen content slides)

### Scene 2 — Analysing — 4.0s
Phone screen: "Analysing TikTok…", route mark draws, stages tick in one by one (~1s apart), note "This usually takes about 20 seconds." Left headline: "It reads the video for you."
Sequential/interaction: yes — 3 stages tick, held together after.
Audio: three soft ticks on stage completion.
Transition mood: clean slide → Scene 3

### Scene 3 — Found + saved — 4.5s
Map with pin drop, card "Found from your TikTok", place name, "Food & drink" chip, "Is this the right place?" → cursor taps Yes. Sheet "Add this place to…" Saved Places ✓, "Friday dinner crew" ✓ → button → "Place saved!" Left headline: "Pinned. Tagged. Saved."
Sequential/interaction: yes — pin drop, tap Yes, two ticks, saved.
Audio: drop, click, clink on saved.
Transition mood: smooth wipe → Scene 4

### Scene 4 — The Space — 3.0s
Space screen "Friday dinner crew", 4 sample avatars, three place rows each with "min · km" travel time; new place at top highlighted. Left: "Shared with your people. Timed for Cairo traffic."
Sequential/interaction: rows arrive one by one (every other beat).
Audio: card place per row, quiet.
Transition mood: slide → Scene 5

### Scene 5 — The number — 2.5s
Full-frame teal: "$0.0417 a share." then "Same video again: $0."
Audio: chip lay on the $0.
Transition mood: clean → Scene 6

### Scene 6 — Outro — 3.5s
Light background, route logo draws, "Waypoint" lands at 17.52s (beat-locked strong cue), subline "From TikTok to table." Hold to end, music fades.
Audio: soft impact at landing.

Durations: 3.0 + 4.0 + 4.5 + 3.0 + 2.5 + 3.5 = 20.5s

Sample data note: all venue names, people and travel times are fictional stand-ins, per PRODUCT.md ("Any place, person, count or quote in a design is sample data").

**Music mood for this video:** upbeat
**Audio summary:** a light upbeat bed carries the flow, UI ticks punctuate each real action, one soft hit lands the logo, music fades out.
