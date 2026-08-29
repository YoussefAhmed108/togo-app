import api from './api';

export interface ApiPlace {
  id: number;
  owner_id: number;
  saved: boolean;
  visited: boolean;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Venue identity. Null for a pin the user dropped by hand. */
  google_place_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ApiMemoryWithSpace {
  id: number;
  place_id: number;
  space_id: number | null;
  space_name: string | null;
  image_url: string;
  caption: string | null;
  created_at: string;
}

export const placeService = {
  /**
   * Create a place, or return the existing one when googlePlaceId matches a
   * venue the user already saved — two TikToks about the same restaurant must
   * not become two places.
   */
  create: async (
    name: string,
    lat: number,
    lng: number,
    address?: string,
    saved: boolean = true,
    googlePlaceId?: string | null,
  ): Promise<ApiPlace> => {
    const res = await api.post<{data: ApiPlace}>('/places', {
      name,
      lat,
      lng,
      address: address ?? null,
      saved,
      google_place_id: googlePlaceId ?? null,
    });
    return res.data.data;
  },

  getPlace: async (placeId: number): Promise<ApiPlace & {memories: ApiMemoryWithSpace[]}> => {
    const res = await api.get<{data: ApiPlace & {memories: ApiMemoryWithSpace[]}}>(`/places/${placeId}`);
    return res.data.data;
  },

  getMemories: async (placeId: number): Promise<ApiMemoryWithSpace[]> => {
    const res = await api.get<{data: ApiMemoryWithSpace[]}>(`/places/${placeId}/memories`);
    return res.data.data ?? [];
  },

  addTags: async (placeId: number, tags: string[]): Promise<void> => {
    await api.post(`/places/${placeId}/tags`, {tags});
  },

  setVisited: async (placeId: number, visited: boolean): Promise<ApiPlace> => {
    const res = await api.patch<{data: ApiPlace}>(`/places/${placeId}/visited`, {visited});
    return res.data.data;
  },

  deletePlace: async (placeId: number): Promise<void> => {
    await api.delete(`/places/${placeId}`);
  },
};
