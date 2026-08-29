import api from './api';

export interface ApiMemberPreview {
  user_id: number;
  name: string;
  avatar_url: string | null;
}

export interface ApiSpace {
  id: number;
  name: string;
  icon: string;
  owner_id: number;
  banner_url: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  place_count: number;
  member_previews: ApiMemberPreview[];
}

export interface ApiPlace {
  id: number;
  owner_id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export const homeService = {
  fetchSpaces: async (): Promise<ApiSpace[]> => {
    const res = await api.get<{data: ApiSpace[]}>('/spaces');
    return res.data.data ?? [];
  },

  fetchPlaces: async (): Promise<ApiPlace[]> => {
    const res = await api.get<{data: ApiPlace[]}>('/places');
    return res.data.data ?? [];
  },
};
