package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"app/backend/internal/eta"
	"app/backend/internal/middleware"
)

// maxETAPlaces caps what one request can spend ($0.25 uncached). The app asks
// for the nearest 3 on open and the rest only when the full list is opened.
const maxETAPlaces = 25

// GET /api/v1/spaces/{id}/eta?lat=&lng=&place_ids=1,2,3
//
// Driving seconds in current traffic, keyed by place id. Places Google cannot
// route are absent. Only places in the space are priced, so this is not a
// general-purpose route-matrix proxy for any member.
func (h *SpaceHandler) SpaceETA(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}
	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	q := r.URL.Query()
	lat, errLat := strconv.ParseFloat(q.Get("lat"), 64)
	lng, errLng := strconv.ParseFloat(q.Get("lng"), 64)
	if errLat != nil || errLng != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, http.StatusBadRequest, "lat and lng are required")
		return
	}
	var want []uint64
	for _, s := range strings.Split(q.Get("place_ids"), ",") {
		if id, err := strconv.ParseUint(strings.TrimSpace(s), 10, 64); err == nil {
			want = append(want, id)
		}
	}
	if len(want) == 0 || len(want) > maxETAPlaces {
		writeError(w, http.StatusBadRequest, "place_ids must list 1-25 ids")
		return
	}

	inSpace, err := h.spaces.ListSpacePlaceIDs(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	member := make(map[uint64]bool, len(inSpace))
	for _, id := range inSpace {
		member[id] = true
	}
	var ids []uint64
	for _, id := range want {
		if member[id] {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		writeJSON(w, http.StatusOK, map[uint64]int{})
		return
	}

	places, err := h.places.ListByIDs(r.Context(), ids)
	if err != nil {
		serverError(w, err)
		return
	}
	dests := make([]eta.Dest, 0, len(places))
	for _, p := range places {
		dests = append(dests, eta.Dest{ID: p.ID, Lat: p.Lat, Lng: p.Lng})
	}
	writeJSON(w, http.StatusOK, eta.Lookup(r.Context(), h.db, h.mapsKey, lat, lng, dests))
}
