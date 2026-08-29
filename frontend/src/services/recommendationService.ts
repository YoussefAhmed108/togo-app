import api from './api';

export interface ApiRecommendation {
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_place_id: string;
  category: string;
  emoji: string;
  reason_type: 'interests' | 'space_area';
  reason_label: string;
}

export const recommendationService = {
  getGlobal: async (): Promise<ApiRecommendation[]> => {
    const res = await api.get<{data: ApiRecommendation[]}>('/recommendations');
    return res.data.data ?? [];
  },

  getForSpace: async (spaceId: number): Promise<ApiRecommendation[]> => {
    const res = await api.get<{data: ApiRecommendation[]}>(`/spaces/${spaceId}/recommendations`);
    return res.data.data ?? [];
  },

  saveInterests: async (interests: string[]): Promise<void> => {
    await api.post('/users/me/interests', {interests});
  },
};
