// Package extract turns a shared TikTok link into a real-world place.
//
// The place name is usually NOT in the caption — it is on a text overlay, a
// storefront sign, a menu, or a location sticker. So we download the video and
// sample frames for the model to read. A caption-only version of this was
// measured picking the wrong branch of the right chain.
//
// Requires `yt-dlp` and `ffmpeg` on PATH.
package extract

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	nFrames    = 6   // 12 frames cost 2x for no measurable gain
	frameWidth = 768 // enough to read signage; ~1.2k tokens per frame
	// TikTok auto-captions. Missing languages are skipped, so asking costs nothing.
	subLangs = "ara-SA,eng-US,ar,en"
	// Cap the rendition: frames are scaled to frameWidth anyway, so a larger
	// download is pure latency. Do NOT drop below 720p without re-testing —
	// reading signage off compressed frames is the whole feature.
	videoFormat = "mp4[height<=720]/mp4/best"
)

// tiktokURL matches every share format TikTok produces (long, vm/vt short, /t/, m.).
var tiktokURL = regexp.MustCompile(`^https?://((www|m|vm|vt)\.)?tiktok\.com/`)

// ValidURL reports whether u is a TikTok link. Callers must check this before
// passing user input to yt-dlp — this is the trust boundary for the whole feature.
func ValidURL(u string) bool { return tiktokURL.MatchString(u) }

// Meta is the metadata yt-dlp reports for a video.
type Meta struct {
	// ID is TikTok's canonical video ID. Short share links (vm./vt./t/) do not
	// carry it in the URL, so this is the only way they can share a cache
	// entry with the long-form link they redirect to.
	ID          string  `json:"id"`
	Description string  `json:"description"`
	Title       string  `json:"title"`
	Uploader    string  `json:"uploader"`
	Track       string  `json:"track"`
	Duration    float64 `json:"duration"`
}

// Caption is the text we hand to the model alongside the frames.
func (m Meta) Caption() string {
	desc := m.Description
	if desc == "" {
		desc = m.Title
	}
	return fmt.Sprintf("Caption: %s\nAccount: @%s\nSound: %s", desc, m.Uploader, m.Track)
}

// frameOffset is the timestamp of the first sample: half an interval in, so the
// n frames sit at the CENTRE of n equal slices. Starting at t=0 leaves the last
// slice unseen — and the outro card naming the place lives there.
func frameOffset(duration float64, n int) float64 {
	if duration < 0 {
		duration = 0
	}
	off := duration / float64(2*n)
	if off > duration {
		return duration
	}
	return off
}

// readSubs returns TikTok's own auto-captions as one line of text. The venue is
// often only ever SPOKEN and appears on no frame at all. Free — same yt-dlp call.
func readSubs(dir string) string {
	paths, err := filepath.Glob(filepath.Join(dir, "v.*.vtt"))
	if err != nil {
		return ""
	}
	sort.Strings(paths)

	var lines []string
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, ln := range strings.Split(string(raw), "\n") {
			ln = strings.TrimSpace(strings.TrimSuffix(ln, "\r"))
			if ln == "" || ln == "WEBVTT" || strings.Contains(ln, "-->") || isDigits(ln) {
				continue
			}
			if len(lines) == 0 || lines[len(lines)-1] != ln {
				lines = append(lines, ln)
			}
		}
	}
	out := strings.Join(lines, " ")
	if len(out) > 4000 { // ponytail: a 3-min clip fits; longer gets cut
		out = out[:4000]
	}
	return out
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// frameFPS samples n frames evenly across the clip, never faster than 1 fps.
func frameFPS(duration float64, n int) float64 {
	if duration < 1 {
		duration = 1
	}
	if fps := float64(n) / duration; fps < 1 {
		return fps
	}
	return 1
}

// Fetch downloads the video and returns its metadata plus JPEG frames.
// TikTok intermittently serves a page yt-dlp cannot parse (~1 in 3 measured),
// so the download is retried; one call fetches video and metadata together
// because two separate calls would double the failure surface.
func Fetch(ctx context.Context, url string) (*Meta, [][]byte, string, error) {
	if !ValidURL(url) {
		return nil, nil, "", fmt.Errorf("not a TikTok URL")
	}

	dir, mkErr := os.MkdirTemp("", "tiktok")
	if mkErr != nil {
		return nil, nil, "", mkErr
	}
	defer os.RemoveAll(dir)

	t0 := time.Now()
	tries, err := download(ctx, url, dir)
	if err != nil {
		return nil, nil, "", err
	}
	log.Printf("extract/timing: yt-dlp %v (%d attempt(s))", time.Since(t0).Round(time.Millisecond), tries)

	raw, err := os.ReadFile(filepath.Join(dir, "v.info.json"))
	if err != nil {
		return nil, nil, "", fmt.Errorf("yt-dlp wrote no metadata: %w", err)
	}
	var meta Meta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, nil, "", fmt.Errorf("decode metadata: %w", err)
	}

	t1 := time.Now()
	frames, err := extractFrames(ctx, dir)
	if err != nil {
		return nil, nil, "", err
	}
	log.Printf("extract/timing: ffmpeg %v (%d frames)", time.Since(t1).Round(time.Millisecond), len(frames))
	return &meta, frames, readSubs(dir), nil
}

// downloadTries: at a measured ~1-in-3 per-attempt failure rate, 4 tries still
// left ~20% of shares failing outright. 8 brings that under 4%; attempts are
// free (they fail before any paid API call), only wall-clock is spent.
const downloadTries = 8

// retryDelay: near-instant for the first attempts (measured: a 2nd attempt
// usually succeeds, and 750ms+ of sleeping there was pure wall clock), then
// backing off so a genuinely throttled client does not hammer.
func retryDelay(attempt int) time.Duration {
	switch {
	case attempt < 2:
		return 100 * time.Millisecond
	case attempt < 4:
		return time.Second
	default:
		return 3 * time.Second
	}
}

func download(ctx context.Context, url, dir string) (int, error) {
	var last error
	for i := 0; i < downloadTries; i++ {
		cmd := exec.CommandContext(ctx, "yt-dlp", "-q", "--no-warnings", "-f", videoFormat,
			"--write-info-json", "--write-subs", "--sub-langs", subLangs,
			"-o", filepath.Join(dir, "v.%(ext)s"), url)
		if out, err := cmd.CombinedOutput(); err != nil {
			last = fmt.Errorf("yt-dlp: %v: %s", err, truncate(string(out), 200))
		} else {
			return i + 1, nil
		}
		if ctx.Err() != nil {
			return i + 1, ctx.Err()
		}
		// The failure is TikTok serving a page shape yt-dlp can't parse, not
		// rate limiting — so retry immediately for the first few attempts, where
		// most successes happen. Back off later in case it IS throttling.
		time.Sleep(retryDelay(i))
	}
	return downloadTries, fmt.Errorf("yt-dlp failed %dx: %w", downloadTries, last)
}

func extractFrames(ctx context.Context, dir string) ([][]byte, error) {
	var meta Meta
	if raw, err := os.ReadFile(filepath.Join(dir, "v.info.json")); err == nil {
		_ = json.Unmarshal(raw, &meta)
	}
	vf := fmt.Sprintf("fps=%f:start_time=%f,scale='min(%d,iw)':-2",
		frameFPS(meta.Duration, nFrames), frameOffset(meta.Duration, nFrames), frameWidth)

	cmd := exec.CommandContext(ctx, "ffmpeg", "-v", "error",
		"-i", filepath.Join(dir, "v.mp4"), "-vf", vf,
		"-frames:v", fmt.Sprint(nFrames), "-q:v", "3", filepath.Join(dir, "f%02d.jpg"))
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %v: %s", err, truncate(string(out), 200))
	}

	paths, err := filepath.Glob(filepath.Join(dir, "f*.jpg"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	frames := make([][]byte, 0, len(paths))
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		frames = append(frames, b)
	}
	if len(frames) == 0 {
		return nil, fmt.Errorf("ffmpeg produced no frames")
	}
	return frames, nil
}

// truncate cuts s to at most n bytes without splitting a rune — captions and
// transcripts are routinely non-ASCII, and half a rune is invalid UTF-8 that
// the JSON encoder then has to replace.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && s[n]&0xC0 == 0x80 { // step back off a continuation byte
		n--
	}
	return s[:n]
}
