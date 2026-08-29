package recommendations

import (
	"math"
	"sort"
)

// GridCell rounds lat/lng to the nearest 0.01 degree (~1.1 km grid tile).
func GridCell(lat, lng float64) (gridLat, gridLng float64) {
	return math.Round(lat*100) / 100, math.Round(lng*100) / 100
}

// Centroid returns the average lat/lng of a slice of [lat, lng] points.
// Returns (0, 0) for an empty slice.
func Centroid(points [][2]float64) (lat, lng float64) {
	if len(points) == 0 {
		return 0, 0
	}
	var sumLat, sumLng float64
	for _, p := range points {
		sumLat += p[0]
		sumLng += p[1]
	}
	n := float64(len(points))
	return sumLat / n, sumLng / n
}

// TopCategories maps a list of tag strings to interest categories and returns
// the top N distinct categories ranked by frequency. Tags not present in
// TagToCategory are ignored.
func TopCategories(tags []string, n int) []string {
	counts := make(map[string]int)
	for _, tag := range tags {
		if cat, ok := TagToCategory[tag]; ok {
			counts[cat]++
		}
	}

	type kv struct {
		k string
		v int
	}
	var pairs []kv
	for k, v := range counts {
		pairs = append(pairs, kv{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].v > pairs[j].v
	})

	var result []string
	for i, p := range pairs {
		if i >= n {
			break
		}
		result = append(result, p.k)
	}
	return result
}
