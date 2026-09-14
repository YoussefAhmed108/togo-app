import ImagePicker from 'react-native-image-crop-picker';

/**
 * Pick a photo and crop it into a fixed frame, WhatsApp-style: the user moves
 * and zooms the photo inside the frame, and only what's in the frame is kept.
 * Frames match where the photo is shown, so nothing is cut off later.
 */
export type ImageFrame = 'banner' | 'memory';

const FRAMES: Record<ImageFrame, {width: number; height: number; title: string}> = {
  // Space banners and space tiles: wide.
  banner: {width: 1600, height: 900, title: 'Move and zoom your banner'},
  // Memory photos are shown as square tiles.
  memory: {width: 1440, height: 1440, title: 'Move and zoom your photo'},
};

export interface PickedImage {
  uri: string;
  type: string;
  fileName: string;
}

/** Resolves null when the user backs out; throws only on a real failure. */
export async function pickImage(
  source: 'camera' | 'gallery',
  frame: ImageFrame = 'memory',
): Promise<PickedImage | null> {
  const f = FRAMES[frame];
  const options = {
    width: f.width,
    height: f.height,
    cropping: true,
    mediaType: 'photo' as const,
    compressImageQuality: 0.85,
    forceJpg: true,
    cropperToolbarTitle: f.title,
    cropperChooseText: 'Use',
    cropperCancelText: 'Cancel',
  };
  try {
    const img = await (source === 'camera' ? ImagePicker.openCamera(options) : ImagePicker.openPicker(options));
    return {
      uri: img.path,
      type: img.mime ?? 'image/jpeg',
      fileName: img.filename ?? `${frame}.jpg`,
    };
  } catch (err: any) {
    if (err?.code === 'E_PICKER_CANCELLED') return null;
    throw err;
  }
}
