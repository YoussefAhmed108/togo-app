import api from './api';

export interface ApiSpace {
  id: number;
  name: string;
  icon: string;
  owner_id: number;
  banner_url: string | null;
  created_at: string;
}

export const spaceService = {
  create: async (name: string, icon: string, bannerKey?: string): Promise<ApiSpace> => {
    const res = await api.post<{data: ApiSpace}>('/spaces', {
      name,
      icon,
      banner_key: bannerKey ?? null,
    });
    return res.data.data;
  },

  /** Patches a space. Omitted icon/banner keep their current value server-side. */
  update: async (
    spaceId: number,
    name: string,
    icon?: string,
    bannerKey?: string,
  ): Promise<ApiSpace> => {
    const res = await api.put<{data: ApiSpace}>(`/spaces/${spaceId}`, {
      name,
      icon: icon ?? null,
      banner_key: bannerKey ?? null,
    });
    return res.data.data;
  },

  generateInviteLink: async (spaceId: number): Promise<{token: string; link: string}> => {
    const res = await api.post<{data: {token: string; link: string}}>(`/spaces/${spaceId}/invite-link`);
    return res.data.data;
  },
};
