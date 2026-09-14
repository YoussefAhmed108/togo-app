import api from './api';

/**
 * A "starting point" — a named origin (Home, Work, …) the user can pick
 * instead of GPS when changing their location.
 */
export interface StartingPoint {
  id: number;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export const savedLocationService = {
  list: async (): Promise<StartingPoint[]> => {
    const res = await api.get<{data: StartingPoint[]}>('/users/me/locations');
    return res.data.data ?? [];
  },

  create: async (
    label: string,
    address: string,
    lat: number,
    lng: number,
  ): Promise<StartingPoint> => {
    const res = await api.post<{data: StartingPoint}>('/users/me/locations', {
      label,
      address,
      lat,
      lng,
    });
    return res.data.data;
  },

  remove: async (id: number): Promise<void> => {
    await api.delete(`/users/me/locations/${id}`);
  },
};
