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

export interface ExtractResult {
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
  caption: string;
  note?: string;
}

export const extractService = {
  /**
   * Analyse a shared TikTok and return pre-fill candidates.
   * The backend downloads the video and reads its frames, so this takes
   * ~15s — always show a progress state while it runs.
   */
  extract: async (url: string): Promise<ExtractResult> => {
    // The default 10s client timeout is far too short here: the backend
    // downloads the video, samples frames and makes two API calls — measured
    // at 13s, and up to ~150s when yt-dlp has to retry TikTok.
    const res = await api.post<{data: ExtractResult}>(
      '/places/extract',
      {url},
      {timeout: 180000},
    );
    return res.data.data;
  },
};
