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
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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

// reelURL matches an Instagram Reel. Reels only: /p/ posts are often image
// carousels, which yt-dlp returns as a playlist the single-file -o cannot hold.
var reelURL = regexp.MustCompile(`^https?://(www\.|m\.)?instagram\.com/(reels?|share/reel)/[\w-]+`)

// ValidURL reports whether u is a TikTok or Instagram Reel link. Callers must
// check this before passing user input to yt-dlp — this is the trust boundary
// for the whole feature.
func ValidURL(u string) bool { return tiktokURL.MatchString(u) || reelURL.MatchString(u) }

// Platform names the source of a valid share link: "instagram" or "tiktok".
func Platform(u string) string {
	if reelURL.MatchString(u) {
		return "instagram"
	}
	return "tiktok"
}

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

// hashtag matches a TikTok tag in any script — Arabic tags are the norm here,
// and they are written with underscores (#زين_الشام).
var hashtag = regexp.MustCompile(`#[\p{L}\p{N}_]+`)

// Hashtags pulls the tags out of the caption, de-duplicated, in order.
//
// They are already inside Description, but the creator's ONLY mention of the
// venue is often a tag buried in a wall of #fyp #viral #explore. Lifting them
// onto their own labelled line is what makes the model actually read them.
func (m Meta) Hashtags() string {
	tags := hashtag.FindAllString(m.Description+" "+m.Title, -1)
	seen := make(map[string]bool, len(tags))
	out := tags[:0]
	for _, t := range tags {
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return strings.Join(out, " ")
}

// Caption is the text we hand to the model alongside the frames.
func (m Meta) Caption() string {
	desc := m.Description
	if desc == "" {
		desc = m.Title
	}
	s := fmt.Sprintf("Caption: %s\nAccount: @%s\nSound: %s", desc, m.Uploader, m.Track)
	if tags := m.Hashtags(); tags != "" {
		s += "\nHashtags: " + tags
	}
	return s
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
		return nil, nil, "", fmt.Errorf("not a TikTok or Instagram Reel URL")
	}
	url = videoURL(ctx, url)

	dir, mkErr := os.MkdirTemp("", "tiktok")
	if mkErr != nil {
		return nil, nil, "", mkErr
	}
	defer os.RemoveAll(dir)

	t0 := time.Now()
	tries, dlErr := download(ctx, url, dir)
	logf(ctx, "timing: yt-dlp %v (%d attempt(s), err=%v)",
		time.Since(t0).Round(time.Millisecond), tries, dlErr)

	// A failed media download is not automatically fatal: --write-info-json and
	// --write-pages both land BEFORE the media, so a photo post whose audio
	// track will not download can still be read off its slides.
	raw, err := os.ReadFile(filepath.Join(dir, "v.info.json"))
	if err != nil {
		logf(ctx, "fetch: no info.json (%v); dir=%v", err, lsDir(dir))
		if dlErr != nil {
			return nil, nil, "", dlErr
		}
		return nil, nil, "", fmt.Errorf("yt-dlp wrote no metadata: %w", err)
	}
	var meta Meta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, nil, "", fmt.Errorf("decode metadata: %w", err)
	}
	// Instagram reports no duration at all, and every frame timestamp is derived
	// from it: without this a 63s reel was sampled at 1fps from t=0, so the
	// model only ever saw its first 6 seconds — and the venue is named in the
	// outro. Ask the file itself whenever the metadata is missing or absurd.
	if meta.Duration < 1 {
		if d := probeDuration(ctx, filepath.Join(dir, "v.mp4")); d > 0 {
			meta.Duration = d
		}
	}
	logf(ctx, "meta: id=%s uploader=@%s dur=%.1fs caption=%dch tags=%q",
		meta.ID, meta.Uploader, meta.Duration, len(meta.Description), truncate(meta.Hashtags(), 120))

	t1 := time.Now()
	var frames [][]byte
	var source string
	if _, statErr := os.Stat(filepath.Join(dir, "v.mp4")); statErr == nil {
		source = "video"
		frames, err = extractFrames(ctx, dir, meta.Duration)
	} else if urls := slideURLs(ctx, dir); len(urls) > 0 {
		source = "photo"
		logf(ctx, "photo post: %d slides selected", len(urls))
		frames, err = slideFrames(ctx, dir, urls)
	} else if dlErr != nil {
		logf(ctx, "fetch: no video and no slides; download error stands")
		err = dlErr // no video, no slides — the download failure was the real one
	} else {
		err = fmt.Errorf("neither a video nor a photo post")
	}
	if err != nil {
		logf(ctx, "fetch: frames failed (source=%s): %v", source, err)
		return nil, nil, "", err
	}
	subs := readSubs(dir)
	logf(ctx, "timing: frames %v (%d from %s, transcript %dch)",
		time.Since(t1).Round(time.Millisecond), len(frames), source, len(subs))
	return &meta, frames, subs, nil
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
			"--write-info-json", "--write-subs", "--sub-langs", subLangs, "--write-pages",
			"-o", filepath.Join(dir, "v.%(ext)s"), url)
		cmd.Dir = dir // --write-pages writes to the CWD, and nowhere else
		if out, err := cmd.CombinedOutput(); err != nil {
			last = fmt.Errorf("yt-dlp: %v: %s", err, truncate(string(out), 200))
			// Logged per attempt, not just on final failure: a share that
			// needed 6 tries looks identical to a first-try success otherwise,
			// and that count is the early warning that TikTok changed shape.
			logf(ctx, "yt-dlp attempt %d/%d failed: %v", i+1, downloadTries, last)
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

func extractFrames(ctx context.Context, dir string, duration float64) ([][]byte, error) {
	vf := fmt.Sprintf("fps=%f:start_time=%f,scale='min(%d,iw)':-2",
		frameFPS(duration, nFrames), frameOffset(duration, nFrames), frameWidth)

	logf(ctx, "ffmpeg: %s", vf)
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

// probeDuration asks ffprobe how long the downloaded file actually is. 0 when
// it cannot tell, which leaves the caller's metadata value alone.
func probeDuration(ctx context.Context, path string) float64 {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error",
		"-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path).Output()
	if err != nil {
		logf(ctx, "ffprobe duration: %v", err)
		return 0
	}
	return parseDuration(string(out))
}

// parseDuration reads ffprobe's bare-value output ("62.900000\n", or "N/A").
func parseDuration(out string) float64 {
	d, err := strconv.ParseFloat(strings.TrimSpace(out), 64)
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

// lsDir names what yt-dlp actually left behind. Only used on the failure path,
// where "no metadata" alone never says whether the download wrote nothing or
// wrote something unexpected.
func lsDir(dir string) []string {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(ents))
	for _, e := range ents {
		names = append(names, e.Name())
	}
	return names
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

// --- photo posts ------------------------------------------------------------
//
// A TikTok "photo mode" post has no video: yt-dlp downloads only its audio
// track, so ffmpeg has nothing to sample and the whole extraction used to fail.
// The pictures — carrying exactly the signage and overlay text this feature
// exists to read — are in the pages yt-dlp already fetched, which --write-pages
// leaves behind for us. No second fetch, no second way to get blocked.

// photoPath matches a photo post's long URL. yt-dlp rejects /photo/ as an
// unsupported URL before fetching anything, but the same post under /video/
// yields its metadata, audio track and dumped pages — all the slide path needs.
var photoPath = regexp.MustCompile(`^(https?://(?:www\.|m\.)?tiktok\.com/@[^/]+)/photo/`)

// shortLink matches share links that hide the real path behind a redirect.
var shortLink = regexp.MustCompile(`^https?://((vm|vt)\.tiktok\.com/|(www\.|m\.)?tiktok\.com/t/)`)

// videoURL rewrites a photo post to the /video/ form yt-dlp accepts. A short
// link is resolved first, one hop, reading only the Location header. Any
// failure returns u unchanged, so video links behave exactly as before.
// The rewritten URL still matches tiktokURL: photoPath is anchored on it.
func videoURL(ctx context.Context, u string) string {
	long := u
	if shortLink.MatchString(u) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return u
		}
		c := &http.Client{
			Timeout:       10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
		resp, err := c.Do(req)
		if err != nil {
			logf(ctx, "resolve short link: %v", err)
			return u
		}
		resp.Body.Close()
		long = resp.Header.Get("Location")
	}
	if !photoPath.MatchString(long) {
		return u
	}
	rewritten := photoPath.ReplaceAllString(long, "$1/video/")
	logf(ctx, "photo post: %s -> %s", u, rewritten)
	return rewritten
}

// maxSlides is how many images to take from each END of a photo post. The venue
// is named on the opening hook card or the closing "where to find it" card; the
// middle slides are food close-ups — except in a roundup post, where each
// middle slide is a different venue. 5+5 covers a typical "top 8" carousel at
// under 2x a video's nFrames. Posts with 2*maxSlides or fewer are sent whole.
const maxSlides = 5

// slideImage matches TikTok's per-image URL lists in both shapes yt-dlp fetches:
// the web page's `imageURL.urlList` and the app API's `display_image.url_list`.
// The lazy `[^}]*?` skips the sibling keys (`uri`, `width`) that precede the
// list in the app shape; a URL list never contains a `}`.
var slideImage = regexp.MustCompile(`"(?:imageURL|display_image)":\{[^}]*?"(?:urlList|url_list)":\["([^"]+)"`)

// slideURLs reads the photo-post images out of the dumped pages, in slide order,
// already narrowed to the first and last maxSlides. Empty for a normal video.
func slideURLs(ctx context.Context, dir string) []string {
	dumps, _ := filepath.Glob(filepath.Join(dir, "*.dump"))
	sort.Strings(dumps)
	for _, p := range dumps {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		m := slideImage.FindAllSubmatch(raw, -1)
		if len(m) == 0 {
			continue // a page that is not the post detail; try the next dump
		}
		urls := make([]string, 0, len(m))
		for _, g := range m {
			urls = append(urls, unescapeJSONURL(string(g[1])))
		}
		logf(ctx, "slides: %d urls in %s", len(urls), filepath.Base(p))
		return pickSlides(urls)
	}
	if len(dumps) > 0 {
		logf(ctx, "slides: none matched in %d dumped page(s)", len(dumps))
	}
	return nil
}

// unescapeJSONURL undoes the escapes TikTok emits inside a URL string. Some
// pages escape every slash as \u002F, which left slide URLs with no host.
func unescapeJSONURL(u string) string {
	return strings.NewReplacer(`\u0026`, "&", `\/`, "/", `\u002F`, "/", `\u002f`, "/").Replace(u)
}

// pickSlides takes the first and last maxSlides images, or all of them when
// there are not enough to split.
func pickSlides(urls []string) []string {
	if len(urls) <= 2*maxSlides {
		return urls
	}
	return append(urls[:maxSlides:maxSlides], urls[len(urls)-maxSlides:]...)
}

// slideFrames downloads the images and re-encodes them to the same JPEG size the
// video path produces — the model is told every image is JPEG, and a full-res
// 1080x1920 slide costs ~2x the tokens of a scaled one for no extra legibility.
//
// One dead or expired CDN link must not lose the other five, so failures are
// logged and skipped rather than returned.
func slideFrames(ctx context.Context, dir string, urls []string) ([][]byte, error) {
	frames := make([][]byte, 0, len(urls))
	for i, u := range urls {
		src := filepath.Join(dir, fmt.Sprintf("s%02d.img", i))
		if err := fetchFile(ctx, u, src); err != nil {
			logf(ctx, "slide %d: download: %v", i, err)
			continue
		}
		dst := filepath.Join(dir, fmt.Sprintf("s%02d.jpg", i))
		cmd := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-y", "-i", src,
			"-vf", fmt.Sprintf("scale='min(%d,iw)':-2", frameWidth), "-q:v", "3", dst)
		if out, err := cmd.CombinedOutput(); err != nil {
			logf(ctx, "slide %d: ffmpeg: %v: %s", i, err, truncate(string(out), 200))
			continue
		}
		b, err := os.ReadFile(dst)
		if err != nil {
			logf(ctx, "slide %d: read: %v", i, err)
			continue
		}
		frames = append(frames, b)
	}
	if len(frames) == 0 {
		return nil, fmt.Errorf("photo post: none of its %d slides could be read", len(urls))
	}
	return frames, nil
}

// slideBytes caps a single slide download; TikTok slides run ~200-400KB.
const slideBytes = 12 << 20

func fetchFile(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// The image CDN 403s a bare Go user agent.
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slide: HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, io.LimitReader(resp.Body, slideBytes))
	return err
}
