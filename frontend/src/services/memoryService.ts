/**
 * Memory upload service.
 *
 * Flow:
 *  1. Call presign()   → get presign_url + key from backend
 *  2. Call uploadToR2() → PUT the image file directly to R2 (zero backend egress)
 *  3. Call create()    → POST /places/{id}/memories with the key + caption
 *
 * Image picking (and cropping to a frame) is handled by the caller via utils/pickImage.
 */

import api from './api';

export interface PresignResult {
  presign_url: string;
  cdn_url: string;
  key: string;
}

/** A dish eaten on a memory, rated 1-5. */
export interface ApiDish {
  id: number;
  name: string;
  rating: number;
}

/** A dish before it is saved — no id yet. */
export interface DishDraft {
  name: string;
  rating: number;
}

export interface ApiMemory {
  id: number;
  place_id: number;
  image_url: string;
  caption: string | null;
  dishes: ApiDish[];
  created_at: string;
}

const memoryService = {
  /**
   * Request a presigned PUT URL from the backend.
   * context: 'memory' | 'space_banner' | 'avatar'
   */
  presign: async (context: 'memory' | 'space_banner' | 'avatar'): Promise<PresignResult> => {
    const res = await api.post<{data: PresignResult}>('/uploads/presign', {context});
    return res.data.data;
  },

  /**
   * PUT the image binary directly to R2 via the presigned URL.
   * Works in React Native by fetching the local file:// URI as a blob.
   */
  uploadToR2: async (
    presignUrl: string,
    imageUri: string,
    mimeType: string = 'image/jpeg',
  ): Promise<void> => {
    // Fetch the local file as a blob (works on iOS and Android)
    const fileResponse = await fetch(imageUri);
    const blob = await fileResponse.blob();

    const putResponse = await fetch(presignUrl, {
      method: 'PUT',
      headers: {'Content-Type': mimeType},
      body: blob,
    });

    if (!putResponse.ok) {
      throw new Error(`R2 upload failed: ${putResponse.status}`);
    }
  },

  /**
   * Register the memory with the backend (stores the key in DB).
   * Pass spaceId when adding a memory from a space context so it gets attributed to that space.
   */
  create: async (
    placeId: number,
    imageKey: string,
    caption?: string,
    spaceId?: number,
    dishes?: DishDraft[],
  ): Promise<ApiMemory> => {
    const res = await api.post<{data: ApiMemory}>(`/places/${placeId}/memories`, {
      image_key: imageKey,
      caption: caption?.trim() || undefined,
      space_id: spaceId ?? undefined,
      dishes: dishes?.length ? dishes : undefined,
    });
    return res.data.data;
  },
};

export default memoryService;
