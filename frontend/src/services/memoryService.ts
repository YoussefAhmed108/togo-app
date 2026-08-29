/**
 * Memory upload service.
 *
 * Flow:
 *  1. Call presign()   → get presign_url + key from backend
 *  2. Call uploadToR2() → PUT the image file directly to R2 (zero backend egress)
 *  3. Call create()    → POST /places/{id}/memories with the key + caption
 *
 * Image picking is handled by the caller using react-native-image-picker.
 * Install before use:
 *   npm install react-native-image-picker
 *   cd ios && pod install
 *   Add to ios/frontend/Info.plist:
 *     <key>NSCameraUsageDescription</key><string>Take a photo for this memory</string>
 *     <key>NSPhotoLibraryUsageDescription</key><string>Choose a photo for this memory</string>
 */

import api from './api';

export interface PresignResult {
  presign_url: string;
  cdn_url: string;
  key: string;
}

export interface ApiMemory {
  id: number;
  place_id: number;
  image_url: string;
  caption: string | null;
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
  ): Promise<ApiMemory> => {
    const res = await api.post<{data: ApiMemory}>(`/places/${placeId}/memories`, {
      image_key: imageKey,
      caption: caption?.trim() || undefined,
      space_id: spaceId ?? undefined,
    });
    return res.data.data;
  },
};

export default memoryService;
