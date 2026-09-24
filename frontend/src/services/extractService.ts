import api from './api';

/** One Google Places match for the shared TikTok. */
export interface PlaceCandidate {
  google_place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  maps_url: string;
}

/** One venue read off the video, with its Google matches. */
export interface ExtractedPlace {
  /** Canonical name to seed the form — Google's spelling when matched. */
  name: string;
  /** Top candidate, or null when nothing matched. */
  selected: PlaceCandidate | null;
  candidates: PlaceCandidate[];
  confidence: number;
  /** Branch / neighbourhood the model read. Not searched on yet. */
  area: string;
  /** Where the name was seen — overlay, signage, menu, caption. */
  evidence: string;
  note?: string;
  /**
   * Set when the venue is not on Google Maps: `selected` is then the venue's
   * name pinned at this nearby spot (a mall, street…), with no place id.
   */
  fallback?: string;
}

/**
 * The top-level fields repeat the first matched venue; `places` lists every
 * venue the video features (a roundup yields several).
 */
export interface ExtractResult extends ExtractedPlace {
  places: ExtractedPlace[];
  caption: string;
  /** Echo to `feedback` — absent when the answer was not cached. */
  feedback_keys?: string[];
}

export const extractService = {
  /**
   * Analyse a shared TikTok and return pre-fill candidates.
   * The backend downloads the video and reads its frames, so this takes
   * ~15s — always show a progress state while it runs.
   */
  extract: async (url: string, near?: {lat: number; lng: number}): Promise<ExtractResult> => {
    // The default 10s client timeout is far too short here: the backend
    // downloads the video, samples frames and makes two API calls — measured
    // at 13s, and up to ~150s when yt-dlp has to retry TikTok.
    const res = await api.post<{data: ExtractResult}>(
      '/places/extract',
      // Where the sharer is, so a chain resolves to the nearby branch.
      near ? {url, lat: near.lat, lng: near.lng} : {url},
      {timeout: 180000},
    );
    return res.data.data;
  },

  /**
   * Tell the backend whether an extraction was right. Only confirmed answers
   * are served from its cache; a wrong one is dropped. Best effort — a lost
   * vote just means the next share re-runs the pipeline.
   */
  feedback: (keys: string[] | undefined, correct: boolean) => {
    if (!keys?.length) return;
    api.post('/places/extract/feedback', {feedback_keys: keys, correct}).catch(() => {});
  },
};
