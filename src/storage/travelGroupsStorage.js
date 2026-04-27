import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local cache of travel-group records. The source-of-truth lives in DynamoDB
 * via `src/api/tripService.js`; this cache only exists so the lobby can render
 * something instantly while the network call is in flight.
 *
 * @typedef {{ travelGroupId: string, travelGroupName: string, participantNames: string[], updatedAt?: number, creator?: string|null }} TravelGroupRecord
 */

const KEY = 'splitgo_travel_groups_v2';

export async function getCachedTravelGroups() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function setCachedTravelGroups(list) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    // ignore — cache is purely a UX nicety
  }
}

export async function clearCachedTravelGroups() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
