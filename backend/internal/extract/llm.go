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

const systemPrompt = `You identify the venue featured in a TikTok. Read EVERYTHING visible in ` +
	`the frames: on-screen text overlays, storefront and neon signs, menus, cups, packaging, ` +
	`receipts, and the location sticker. Also read the caption and the spoken transcript — ` +
	`creators often only SAY the name ("موجود في زين الشام"), and then it is on no frame at all. ` +
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
	`correct beats an empty result. Return empty strings and confidence 0 only when NO candidate ` +
	`name appears at all. Do not guess a chain from decor alone.`

// schema keeps `language` a bare ISO 639-1 code. It was an ar/en/mixed enum
// while Cairo was the only market; a free code costs nothing here and is what
// lets the same pipeline run in a market whose script we never listed.
var schema = map[string]any{
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
				"(overlay, signage, menu, packaging, maps card, caption). Never leave this empty " +
				"if you identified a name."},
		"confidence": map[string]any{"type": "number",
			"description": "0-1. REQUIRED. If you filled place_name you saw a name, so this must " +
				"be greater than 0. Use 0 only when place_name is empty."},
	},
	"required":             []string{"place_name", "area", "city", "country", "language", "evidence", "confidence"},
	"additionalProperties": false,
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// Analyze sends the frames and caption to Claude and returns the structured read.
func Analyze(ctx context.Context, apiKey string, meta *Meta, frames [][]byte, transcript string) (*Result, *Usage, error) {
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
		"text": text + "\n\nFrames above are in chronological order.",
	})

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

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("anthropic: %w", err)
	}
	defer resp.Body.Close()

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

	return ParseResult(out.Content, &out.Usage)
}

// ParseResult pulls the JSON payload out of the response blocks.
func ParseResult(blocks []struct {
	Type string `json:"type"`
	Text string `json:"text"`
}, usage *Usage) (*Result, *Usage, error) {
	for _, b := range blocks {
		if b.Type != "text" {
			continue
		}
		var r Result
		if err := json.Unmarshal([]byte(b.Text), &r); err != nil {
			return nil, nil, fmt.Errorf("model returned unparseable JSON: %w", err)
		}
		return &r, usage, nil
	}
	return nil, nil, fmt.Errorf("no text block in response")
}
