package extract

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	model      = "claude-haiku-4-5"
	anthropicU = "https://api.anthropic.com/v1/messages"
)

// Result is what the model reads off the video.
type Result struct {
	PlaceName  string  `json:"place_name"` // original script, as shown on screen
	Area       string  `json:"area"`       // neighbourhood / branch — read but NOT searched on yet
	City       string  `json:"city"`
	Country    string  `json:"country"`
	Language   string  `json:"language"` // ISO 639-1, or "" when the model is unsure
	Evidence   string  `json:"evidence"` // where the name was actually seen
	Confidence float64 `json:"confidence"`
}

// Query builds the Google Places text query.
//
// Area is deliberately excluded: before temperature was pinned to 0 the model
// read four different branches for one video, and a wrong area once matched a
// bank instead of the restaurant. Add it back with multi-branch handling.
func (r Result) Query() string {
	q := r.PlaceName
	for _, part := range []string{r.City, r.Country} {
		if part != "" {
			q += " " + part
		}
	}
	return q
}

// isoCode matches a bare ISO 639-1 code. Anything else the model returns
// ("mixed", "arz", "Arabic") is treated as unknown.
var isoCode = regexp.MustCompile(`^[a-z]{2}$`)

// LanguageCode maps the detected language to a Google Places languageCode, or
// "" to let Google infer it from the query script.
//
// This used to default to "ar" for anything that was not English, which was
// right while the only market was Cairo and wrong everywhere else — it would
// ask Google for Arabic results for a Tokyo venue. Unknown now means unset.
func (r Result) LanguageCode() string {
	lang := strings.ToLower(strings.TrimSpace(r.Language))
	if isoCode.MatchString(lang) {
		return lang
	}
	return ""
}

// maxPlaces caps how many venues one video can yield. Each costs a Google
// Places lookup (~$0.032), so a "top 20" listicle must not cost $0.60.
const maxPlaces = 8

const systemPrompt = `You identify the venues featured in a TikTok. Most videos feature ONE ` +
	`venue; listicles and roundups ("5 cafés you must try") feature several. Return one entry ` +
	`in "places" per DISTINCT venue actually featured, in the order they appear, at most ` +
	`8 — not venues merely mentioned in passing, and never the same venue twice. For each ` +
	`venue, read its own name, branch and city: do not mix one venue's name with another's ` +
	`location. The rules below apply to every entry. Read EVERYTHING visible in ` +
	`the frames: on-screen text overlays, storefront and neon signs, menus, cups, packaging, ` +
	`receipts, and the location sticker. Also read the caption and the spoken transcript — ` +
	`creators often only SAY the name ("موجود في زين الشام"), and then it is on no frame at all. ` +
	`Read the HASHTAGS too — a tag is frequently the only place the venue or its city is named ` +
	`(#زين_الشام, #القاهرة), so mine them for a name even though most tags are junk (#fyp, ` +
	`#viral, #foryou, #trending) and name no place. A tag is written as one run-on token: split ` +
	`it on underscores and word boundaries to recover the name (#زين_الشام -> "زين الشام", ` +
	`#cairofood -> Cairo + food). A hashtag alone is enough evidence to answer with. ` +
	`Beware: packaging and menus name the DISH or the chain's product, not the venue — the ` +
	`transcript usually settles which is which. Content may be in ANY language; today it is most ` +
	`often Arabic (incl. Gulf/Egyptian/Levantine dialect), English, or a mix of both, but do not ` +
	`assume that — keep the name in its original script in place_name whatever that script is. ` +
	`The caption often names only the chain while the video shows WHICH branch — when the ` +
	`caption and the screen disagree about city or branch, trust the screen. Put the branch or ` +
	`neighbourhood in "area" — leave it empty rather than guessing, a wrong area is worse than ` +
	`none. Give the FULL brand name in place_name (e.g. "البركة فرايد تشيكن", not "البركة") — a ` +
	`truncated name matches the wrong business. Set "evidence" to where you actually saw the ` +
	`name. If exactly one plausible name appears anywhere — caption, transcript, or a sign — ` +
	`return it with the confidence it deserves rather than nothing; a weak lead the user can ` +
	`correct beats an empty result. Return an empty "places" list only when NO candidate ` +
	`name appears at all. Do not guess a chain from decor alone.`

// placeSchema keeps `language` a bare ISO 639-1 code. It was an ar/en/mixed enum
// while Cairo was the only market; a free code costs nothing here and is what
// lets the same pipeline run in a market whose script we never listed.
var placeSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"place_name": map[string]any{"type": "string",
			"description": "Full venue name in its original script, or \"\" if none is identifiable."},
		"area": map[string]any{"type": "string",
			"description": "Neighbourhood or branch, or \"\" if not clearly shown."},
		"city": map[string]any{"type": "string",
			"description": "City, or \"\" if not shown. Fill this whenever the city is legible."},
		"country": map[string]any{"type": "string", "description": "Country, or \"\" if not shown."},
		"language": map[string]any{"type": "string",
			"description": "ISO 639-1 code of the on-screen content (\"ar\", \"en\", \"ja\", ...). " +
				"Use the language the venue name itself is written in. Return \"\" when the " +
				"content is mixed or you are unsure — a wrong code is worse than none."},
		"evidence": map[string]any{"type": "string",
			"description": "REQUIRED whenever place_name is non-empty: where you saw the name " +
				"(overlay, signage, menu, packaging, maps card, caption, hashtag, transcript). " +
				"Never leave this empty if you identified a name."},
		"confidence": map[string]any{"type": "number",
			"description": "0-1. REQUIRED. If you filled place_name you saw a name, so this must " +
				"be greater than 0. Use 0 only when place_name is empty."},
	},
	"required":             []string{"place_name", "area", "city", "country", "language", "evidence", "confidence"},
	"additionalProperties": false,
}

// schema wraps the per-venue object in a list. The cap is enforced in
// ParseResult, not here: structured outputs do not accept maxItems.
var schema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"places": map[string]any{"type": "array", "items": placeSchema,
			"description": "One entry per distinct venue featured, in order of appearance; [] if none."},
	},
	"required":             []string{"places"},
	"additionalProperties": false,
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// Analyze sends the frames and caption to Claude and returns every venue it
// read, in order of appearance. Empty means no venue was identified.
func Analyze(ctx context.Context, apiKey string, meta *Meta, frames [][]byte, transcript string) ([]Result, *Usage, error) {
	content := make([]map[string]any, 0, len(frames)+1)
	for _, f := range frames {
		content = append(content, map[string]any{
			"type": "image",
			"source": map[string]any{
				"type":       "base64",
				"media_type": "image/jpeg",
				"data":       base64.StdEncoding.EncodeToString(f),
			},
		})
	}
	text := meta.Caption()
	if transcript != "" {
		text += "\nSpoken transcript: " + transcript
	}
	content = append(content, map[string]any{
		"type": "text",
		// Photo posts have no video: the images are the post's own slides, and
		// only the first and last few are sent.
		"text": text + "\n\nImages above are in order, first to last: either frames " +
			"sampled across a video, or the slides of a TikTok photo post.",
	})

	logf(ctx, "claude: model=%s frames=%d caption=%dch transcript=%dch",
		model, len(frames), len(text), len(transcript))

	body, err := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": 2000,
		// Pinned: at the default sampling the branch and name readings varied
		// wildly between identical runs.
		"temperature": 0,
		"system":      systemPrompt,
		"messages":    []map[string]any{{"role": "user", "content": content}},
		"output_config": map[string]any{
			"format": map[string]any{"type": "json_schema", "schema": schema},
		},
	})
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicU, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")

	logf(ctx, "claude: POST %d bytes", len(body))
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("anthropic: %w", err)
	}
	defer resp.Body.Close()
	// Status is logged separately from the decode: a 429 or 529 arrives as a
	// body the decoder may or may not understand, and "decode failed" alone
	// hides which of the two actually happened.
	if resp.StatusCode != http.StatusOK {
		logf(ctx, "claude: HTTP %d", resp.StatusCode)
	}

	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage Usage `json:"usage"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, fmt.Errorf("anthropic decode: %w", err)
	}
	if out.Error != nil {
		return nil, nil, fmt.Errorf("anthropic: %s", out.Error.Message)
	}

	places, usage, err := ParseResult(out.Content, &out.Usage)
	if err != nil {
		return nil, nil, err
	}
	logf(ctx, "claude: %d place(s) (%d in / %d out tokens)",
		len(places), usage.InputTokens, usage.OutputTokens)
	// The model's actual read, which is what every wrong-place bug report needs
	// to be diagnosed — the response the user sees keeps only the Google name.
	for i, r := range places {
		logf(ctx, "claude: [%d] name=%q area=%q city=%q country=%q lang=%q conf=%.2f evidence=%q",
			i, r.PlaceName, r.Area, r.City, r.Country, r.Language, r.Confidence, truncate(r.Evidence, 200))
	}
	return places, usage, nil
}

// ParseResult pulls the place list out of the response blocks. Nameless
// entries and repeats of the same venue are dropped, and the list is capped
// at maxPlaces — each surviving entry costs a Places lookup.
func ParseResult(blocks []struct {
	Type string `json:"type"`
	Text string `json:"text"`
}, usage *Usage) ([]Result, *Usage, error) {
	for _, b := range blocks {
		if b.Type != "text" {
			continue
		}
		var out struct {
			Places []Result `json:"places"`
		}
		if err := json.Unmarshal([]byte(b.Text), &out); err != nil {
			return nil, nil, fmt.Errorf("model returned unparseable JSON: %w", err)
		}
		places := make([]Result, 0, len(out.Places))
		seen := map[string]bool{}
		for _, r := range out.Places {
			// Same folding as the query cache: two spellings of one venue
			// would resolve to one Google lookup anyway.
			q := QueryKey(r.Query(), "")
			if strings.TrimSpace(r.PlaceName) == "" || seen[q] {
				continue
			}
			seen[q] = true
			places = append(places, r)
			if len(places) == maxPlaces {
				break
			}
		}
		return places, usage, nil
	}
	return nil, nil, fmt.Errorf("no text block in response")
}
