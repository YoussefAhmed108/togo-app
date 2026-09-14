package extract

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidURL(t *testing.T) {
	valid := []string{
		"https://www.tiktok.com/@user/video/1234567890",
		"https://vm.tiktok.com/ZSVgcpVGR/",
		"https://vt.tiktok.com/ZSVgcpVGR/",
		"https://www.tiktok.com/t/ZMxxxx/",
		"https://m.tiktok.com/v/123.html",
		"https://tiktok.com/@user/video/1",
	}
	for _, u := range valid {
		if !ValidURL(u) {
			t.Errorf("ValidURL(%q) = false, want true", u)
		}
	}
	// This is the trust boundary — the URL is handed to yt-dlp.
	invalid := []string{
		"https://youtube.com/watch?v=1",
		"https://evil.com/?x=https://tiktok.com/",
		"file:///etc/passwd",
		"", "not a url",
		"https://nottiktok.com/@a/video/1",
	}
	for _, u := range invalid {
		if ValidURL(u) {
			t.Errorf("ValidURL(%q) = true, want false", u)
		}
	}
}

func TestFrameFPS(t *testing.T) {
	cases := []struct {
		duration float64
		want     float64
	}{
		{60, 0.1}, // 6 frames across a 60s clip
		{6, 1},    // short clip caps at 1 fps
		{0, 1},    // missing duration must not divide by zero
	}
	for _, c := range cases {
		if got := frameFPS(c.duration, 6); got != c.want {
			t.Errorf("frameFPS(%v, 6) = %v, want %v", c.duration, got, c.want)
		}
	}
}

func TestFrameOffset(t *testing.T) {
	// Frames must sit at the CENTRE of each slice: starting at t=0 never samples
	// the final slice, which is where the outro card naming the place lives.
	if got, want := frameOffset(60, 6), 5.0; got != want {
		t.Errorf("frameOffset(60,6) = %v, want %v", got, want)
	}
	if got := frameOffset(0, 6); got != 0 {
		t.Errorf("frameOffset(0,6) = %v, want 0", got)
	}
}

func TestReadSubs(t *testing.T) {
	dir := t.TempDir()
	vtt := "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nموجود في زين الشام\n\n" +
		"2\n00:00:03.000 --> 00:00:05.000\nموجود في زين الشام\n"
	if err := os.WriteFile(filepath.Join(dir, "v.ar.vtt"), []byte(vtt), 0o644); err != nil {
		t.Fatal(err)
	}
	// cues joined, timestamps/indices dropped, consecutive duplicates collapsed
	if got, want := readSubs(dir), "موجود في زين الشام"; got != want {
		t.Errorf("readSubs = %q, want %q", got, want)
	}
	// no subtitles is normal, not an error
	if got := readSubs(t.TempDir()); got != "" {
		t.Errorf("readSubs(empty) = %q, want \"\"", got)
	}
}

func TestRetryDelay(t *testing.T) {
	// Fast first: the common case is a 2nd-attempt success, and sleeping there
	// is pure added latency. Later attempts back off in case it is throttling.
	if got := retryDelay(0); got > 200*time.Millisecond {
		t.Errorf("first retry should be near-instant, got %v", got)
	}
	if retryDelay(5) <= retryDelay(0) {
		t.Error("later retries should back off")
	}
	// Worst case must stay inside the handler's 150s budget.
	var total time.Duration
	for i := 0; i < downloadTries; i++ {
		total += retryDelay(i)
	}
	if total > 30*time.Second {
		t.Errorf("total backoff %v is too much of the request budget", total)
	}
}

func TestQueryExcludesArea(t *testing.T) {
	r := Result{PlaceName: "البركة فرايد تشيكن", Area: "المقطم", City: "القاهرة"}
	// area is deliberately left out — a misread branch once matched a bank
	if got, want := r.Query(), "البركة فرايد تشيكن القاهرة"; got != want {
		t.Errorf("Query() = %q, want %q", got, want)
	}
}

func TestParseResultDedupesAndCaps(t *testing.T) {
	block := func(s string) []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} {
		return []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}{{Type: "text", Text: s}}
	}

	// A nameless entry and a repeat of the same venue are dropped.
	got, _, err := ParseResult(block(`{"places":[
		{"place_name":"Zein El Sham","city":"Cairo"},
		{"place_name":"","city":"Cairo"},
		{"place_name":"zein el sham ","city":"cairo"},
		{"place_name":"Café Riche","city":"Cairo"}]}`), &Usage{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].PlaceName != "Zein El Sham" || got[1].PlaceName != "Café Riche" {
		t.Errorf("ParseResult = %+v, want Zein El Sham then Café Riche", got)
	}

	// A roundup longer than maxPlaces is cut — each entry is a paid lookup.
	many := `{"places":[`
	for i := 0; i < maxPlaces+3; i++ {
		if i > 0 {
			many += ","
		}
		many += `{"place_name":"Venue ` + string(rune('A'+i)) + `"}`
	}
	if got, _, _ := ParseResult(block(many+`]}`), &Usage{}); len(got) != maxPlaces {
		t.Errorf("ParseResult kept %d places, want cap of %d", len(got), maxPlaces)
	}

	// No venue read is an empty list, not an error.
	if got, _, err := ParseResult(block(`{"places":[]}`), &Usage{}); err != nil || len(got) != 0 {
		t.Errorf("ParseResult(empty) = %v, %v", got, err)
	}
}

func TestLanguageCode(t *testing.T) {
	// Anything that is not a bare ISO 639-1 code is unset, so Google infers the
	// language from the query script. This used to default to "ar", which was
	// right for Cairo and wrong for every other market.
	cases := map[string]string{
		"ar": "ar", "en": "en", "ja": "ja", "TR": "tr", " fr ": "fr",
		"mixed": "", "": "", "arz": "", "Arabic": "",
	}
	for lang, want := range cases {
		if got := (Result{Language: lang}).LanguageCode(); got != want {
			t.Errorf("LanguageCode(%q) = %q, want %q", lang, got, want)
		}
	}
}

func TestMapsURLFallsBackToPlaceID(t *testing.T) {
	if got := mapsURL("X", "https://maps.google.com/?cid=1"); got != "https://maps.google.com/?cid=1" {
		t.Errorf("should prefer googleMapsUri, got %q", got)
	}
	if got, want := mapsURL("X", ""), "https://www.google.com/maps/place/?q=place_id:X"; got != want {
		t.Errorf("mapsURL fallback = %q, want %q", got, want)
	}
}

// The caches are the difference between ~$0.041 and ~$0.000 per share, and
// both are worthless if the key is wrong: a key that varies per share never
// hits, and a key that collides serves one venue's pin for another.

func TestURLKeyIgnoresShareVariance(t *testing.T) {
	// TikTok appends per-share tracking params. Hashing the raw URL would give
	// a near-zero hit rate — every share of one video is a different string.
	same := []string{
		"https://www.tiktok.com/@tokyofoodie/video/7412345678901234567",
		"https://www.tiktok.com/@tokyofoodie/video/7412345678901234567?_t=ZS-8xAbC&_r=1",
		"https://m.tiktok.com/@someone_else/video/7412345678901234567?is_from_webapp=1",
		"https://tiktok.com/@tokyofoodie/video/7412345678901234567/",
	}
	want := URLKey(same[0])
	for _, u := range same[1:] {
		if got := URLKey(u); got != want {
			t.Errorf("URLKey(%q) = %q, want same key as canonical form", u, got)
		}
	}
	// A different video must not collide with it.
	if URLKey("https://www.tiktok.com/@x/video/7412345678901234568") == want {
		t.Error("different video IDs must not share a cache key")
	}
	// Short links carry no video ID, so they key on the normalized URL and
	// only converge with the long form once yt-dlp resolves them.
	if URLKey("https://vm.tiktok.com/ZSVgcpVGR/") != URLKey("https://vm.tiktok.com/ZSVgcpVGR") {
		t.Error("short links should ignore a trailing slash")
	}
	if VideoKey("7412345678901234567") != want {
		t.Error("VideoKey must match URLKey for the same video, or short links never dedupe")
	}
}

func TestQueryKeyFoldsSpellingVariance(t *testing.T) {
	// Same venue, same language, cosmetic differences only → one paid lookup.
	base := QueryKey("Zooba Cairo Egypt", "en")
	for _, q := range []string{"zooba cairo egypt", "  Zooba,  Cairo,  Egypt ", "Zooba - Cairo (Egypt)"} {
		if QueryKey(q, "en") != base {
			t.Errorf("QueryKey(%q) should fold onto the canonical key", q)
		}
	}
	// Arabic tashkeel is a standalone combining mark and must fold away.
	if QueryKey("مَطْعَم البركة", "ar") != QueryKey("مطعم البركة", "ar") {
		t.Error("diacritics must not split one venue across two cache entries")
	}
	// Language is part of the key: Google returns localized names.
	if QueryKey("Zooba Cairo Egypt", "ar") == base {
		t.Error("language must be part of the key")
	}
	// Different venues must not collide.
	if QueryKey("Zooba Cairo Egypt", "en") == QueryKey("Zooba Lagos Nigeria", "en") {
		t.Error("different cities must not share a cache key")
	}
}

// Long links only: short links need a network hop and are covered live.
func TestVideoURLRewritesPhotoPosts(t *testing.T) {
	cases := map[string]string{
		"https://www.tiktok.com/@a/photo/123?_r=1": "https://www.tiktok.com/@a/video/123?_r=1",
		"https://m.tiktok.com/@a.b/photo/9":        "https://m.tiktok.com/@a.b/video/9",
		"https://www.tiktok.com/@a/video/123":      "https://www.tiktok.com/@a/video/123",
		"https://www.tiktok.com/@photo/video/1":    "https://www.tiktok.com/@photo/video/1",
	}
	for in, want := range cases {
		got := videoURL(context.Background(), in)
		if got != want {
			t.Errorf("videoURL(%q) = %q, want %q", in, got, want)
		}
		if !ValidURL(got) {
			t.Errorf("videoURL(%q) = %q fails ValidURL", in, got)
		}
	}
}

func TestUnescapeJSONURL(t *testing.T) {
	cases := map[string]string{
		`https:\/\/p16.tiktokcdn.com\/a.jpeg?x=1&y=2`:                  "https://p16.tiktokcdn.com/a.jpeg?x=1&y=2",
		`https:\u002F\u002Fp19.tiktokcdn.com\u002Fb.jpeg?x=1\u0026y=2`: "https://p19.tiktokcdn.com/b.jpeg?x=1&y=2",
		`https:\u002f\u002fp19.tiktokcdn.com\u002fc.jpeg`:              "https://p19.tiktokcdn.com/c.jpeg",
	}
	for in, want := range cases {
		if got := unescapeJSONURL(in); got != want {
			t.Errorf("unescapeJSONURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPickSlides(t *testing.T) {
	all := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"}
	// More than 10 slides: first 5 and last 5, middle dropped.
	got := pickSlides(all)
	want := []string{"1", "2", "3", "4", "5", "8", "9", "10", "11", "12"}
	if len(got) != len(want) {
		t.Fatalf("pickSlides(12) = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("pickSlides(12) = %v, want %v", got, want)
		}
	}
	// The source slice must not be clobbered by the append.
	if all[5] != "6" {
		t.Errorf("pickSlides overwrote its input: %v", all)
	}
	// 10 or fewer: all of them.
	for _, n := range []int{0, 1, 6, 10} {
		if got := pickSlides(all[:n]); len(got) != n {
			t.Errorf("pickSlides(%d) returned %d, want %d", n, len(got), n)
		}
	}
}

func TestSlideURLs(t *testing.T) {
	dir := t.TempDir()
	// The app API shape: sibling keys precede url_list, and & is escaped.
	dump := `{"image_post_info":{"images":[` +
		`{"display_image":{"uri":"x","url_list":["https://cdn/a.jpeg?a=1&b=2","https://cdn/a2"]}},` +
		`{"display_image":{"uri":"y","url_list":["https://cdn/b.jpeg"]}}]}}`
	if err := os.WriteFile(filepath.Join(dir, "p.dump"), []byte(dump), 0o600); err != nil {
		t.Fatal(err)
	}
	got := slideURLs(context.Background(), dir)
	want := []string{"https://cdn/a.jpeg?a=1&b=2", "https://cdn/b.jpeg"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("slideURLs = %v, want %v", got, want)
	}

	// The web shape.
	web := `{"imagePost":{"images":[{"imageURL":{"urlList":["https:\/\/cdn\/w.jpeg"]}}]}}`
	dir2 := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir2, "p.dump"), []byte(web), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := slideURLs(context.Background(), dir2); len(got) != 1 || got[0] != "https://cdn/w.jpeg" {
		t.Fatalf("slideURLs(web) = %v", got)
	}

	// A normal video's pages contain no image post.
	dir3 := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir3, "p.dump"), []byte(`{"video":{"playAddr":"x"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := slideURLs(context.Background(), dir3); got != nil {
		t.Errorf("slideURLs(video) = %v, want nil", got)
	}
}

func TestMetaHashtags(t *testing.T) {
	m := Meta{Description: "أحلى فطار #زين_الشام #القاهرة #fyp #fyp", Title: "x #cairo"}
	if got, want := m.Hashtags(), "#زين_الشام #القاهرة #fyp #cairo"; got != want {
		t.Errorf("Hashtags() = %q, want %q", got, want)
	}
	// The tags must reach the model on their own labelled line.
	if !strings.Contains(m.Caption(), "\nHashtags: #زين_الشام") {
		t.Errorf("Caption() dropped the hashtags: %q", m.Caption())
	}
	if strings.Contains(Meta{Description: "no tags"}.Caption(), "Hashtags") {
		t.Error("Caption() added an empty Hashtags line")
	}
}

func TestAreaKey(t *testing.T) {
	base := QueryKey("fresh noodles", "")
	downtown := &LatLng{Lat: 30.0444, Lng: 31.2357}
	zamalek := &LatLng{Lat: 30.0626, Lng: 31.2197}
	paris := &LatLng{Lat: 48.8566, Lng: 2.3522}
	if AreaKey(base, nil) != base {
		t.Fatal("no location must keep the global key")
	}
	if AreaKey(base, downtown) != AreaKey(base, zamalek) {
		t.Fatal("two Cairo neighbourhoods must share a cache entry")
	}
	if AreaKey(base, downtown) == AreaKey(base, paris) {
		t.Fatal("Cairo and Paris must not share a cache entry")
	}
	if AreaKey(base, downtown) == base {
		t.Fatal("a located key must differ from the global one")
	}
}
