/**
 * Report and block for user-generated memories (App Store guideline 1.2).
 *
 * ponytail: reports go out by email and blocks live on this device only.
 * Move both server-side if spaces ever stop being invite-only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Alert, Linking} from 'react-native';

// The address App Review and users see; you must answer reports within 24h.
export const SUPPORT_EMAIL = 'youssef.ahmed108@gmail.com';

const blockedKey = (me: number) => `@app/blocked_users/${me}`;

export async function getBlocked(me: number): Promise<Set<number>> {
  try {
    return new Set(JSON.parse((await AsyncStorage.getItem(blockedKey(me))) ?? '[]'));
  } catch {
    return new Set();
  }
}

async function block(me: number, userId: number) {
  const ids = await getBlocked(me);
  ids.add(userId);
  await AsyncStorage.setItem(blockedKey(me), JSON.stringify([...ids]));
}

export function contactSupport(subject: string, body = '') {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  Linking.openURL(url).catch(() =>
    Alert.alert('No Mail App', `Email us at ${SUPPORT_EMAIL}`),
  );
}

/** Report / block sheet for someone else's memory. onBlocked lets the screen hide it. */
export function showMemoryActions(
  memory: {id: number; uploader_id: number},
  me: number,
  onBlocked: (userId: number) => void,
) {
  Alert.alert('Memory', undefined, [
    {
      text: 'Report',
      onPress: () =>
        contactSupport(
          `Report memory #${memory.id}`,
          `Memory ${memory.id} by user ${memory.uploader_id} is inappropriate because:\n\n`,
        ),
    },
    {
      text: 'Block this person',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Block?', "You won't see their memories anymore.", [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              await block(me, memory.uploader_id);
              onBlocked(memory.uploader_id);
            },
          },
        ]),
    },
    {text: 'Cancel', style: 'cancel'},
  ]);
}
