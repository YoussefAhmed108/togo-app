import api from './api';

export interface ApiSpacePlace {
  id: number;
  owner_id: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  tags: string[];
  visited: boolean;
  created_at: string;
}

export interface ApiSpaceMember {
  user_id: number;
  name: string;
  role: 'owner' | 'member';
  avatar_url: string | null;
  joined_at: string;
}

export interface ApiSpaceMemory {
  id: number;
  place_id: number;
  place_name: string;
  uploader_id: number;
  image_url: string;
  caption: string | null;
  created_at: string;
}

export interface ApiSpaceDetail {
  id: number;
  name: string;
  icon: string;
  owner_id: number;
  banner_url: string | null;
  created_at: string;
}

export const spaceDetailService = {
  getSpace: async (spaceId: number): Promise<ApiSpaceDetail> => {
    const res = await api.get<{data: ApiSpaceDetail}>(`/spaces/${spaceId}`);
    return res.data.data;
  },

  getPlaces: async (spaceId: number): Promise<ApiSpacePlace[]> => {
    const res = await api.get<{data: ApiSpacePlace[]}>(`/spaces/${spaceId}/places`);
    return res.data.data ?? [];
  },

  getMembers: async (spaceId: number): Promise<ApiSpaceMember[]> => {
    const res = await api.get<{data: ApiSpaceMember[]}>(`/spaces/${spaceId}/members`);
    return res.data.data ?? [];
  },

  getMemories: async (spaceId: number): Promise<ApiSpaceMemory[]> => {
    const res = await api.get<{data: ApiSpaceMemory[]}>(`/spaces/${spaceId}/memories`);
    return res.data.data ?? [];
  },

  removeMember: async (spaceId: number, userId: number): Promise<void> => {
    await api.delete(`/spaces/${spaceId}/members/${userId}`);
  },

  removePlace: async (spaceId: number, placeId: number): Promise<void> => {
    await api.delete(`/spaces/${spaceId}/places/${placeId}`);
  },

  addPlace: async (spaceId: number, placeId: number): Promise<ApiSpacePlace[]> => {
    const res = await api.post<{data: ApiSpacePlace[]}>(`/spaces/${spaceId}/places`, {
      place_id: placeId,
    });
    return res.data.data ?? [];
  },
};
