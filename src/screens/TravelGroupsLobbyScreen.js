import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';
import { listTripsForUser, clearMyTrips } from '../api/tripService';
import {
  getCachedTravelGroups,
  setCachedTravelGroups,
  clearCachedTravelGroups,
} from '../storage/travelGroupsStorage';

/**
 * Lists travel groups the signed-in user is a member of. Source of truth is
 * the AWS `SplitGoTrips` table; we keep a tiny `AsyncStorage` cache so the
 * list pops in instantly while the network request resolves.
 */
export default function TravelGroupsLobbyScreen({ navigation }) {
  const safeBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('SplitGoHome');
  };
  const { me } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!me?.name) {
      setGroups([]);
      setError(null);
      return;
    }
    if (!silent) {
      const cached = await getCachedTravelGroups();
      const mineCached = cached.filter((g) => (g.participantNames || []).includes(me.name));
      if (mineCached.length) setGroups(mineCached);
    }
    try {
      const r = await listTripsForUser(me.name);
      const trips = (r.trips || []).map((t) => ({
        travelGroupId:    t.travelGroupId,
        travelGroupName:  t.travelGroupName || 'Trip',
        participantNames: Array.isArray(t.participantNames) ? t.participantNames : [],
        creator:          t.creator || null,
        updatedAt:        t.updatedAt || t.createdAt || 0,
      }));
      setGroups(trips);
      setError(null);
      setCachedTravelGroups(trips);
    } catch (e) {
      const cached = await getCachedTravelGroups();
      const mine = cached.filter((g) => (g.participantNames || []).includes(me.name));
      setGroups(mine);
      setError(e?.message || 'Could not reach trips API.');
    }
  }, [me?.name]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        await load();
        if (alive) setLoading(false);
      })();
      return () => { alive = false; };
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openGroup = (g) => {
    navigation.navigate('TravelGroupHub', {
      travelGroupId: g.travelGroupId,
      travelGroupName: g.travelGroupName || 'Trip',
      participantNames: g.participantNames || [],
    });
  };

  const newTrip = () => {
    navigation.navigate('TravelPickContacts');
  };

  const onClearTrips = () => {
    if (!me?.name) return;
    Alert.alert(
      'Clear trip history',
      'Trips you created will be deleted for everyone on the trip. Trips you joined will simply remove you from the roster. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearMyTrips(me.name);
              await clearCachedTravelGroups();
              await load();
            } catch (e) {
              Alert.alert('Could not clear', e?.message || 'Server error.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Travel groups</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SG.primary} />}
      >
        <Text style={styles.intro}>
          Open an existing trip to add receipts and split. Create a new trip only when you need a fresh group of people.
        </Text>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
            <TouchableOpacity onPress={onRefresh} activeOpacity={0.8}>
              <Text style={styles.errorRetry}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity style={styles.newCard} onPress={newTrip} activeOpacity={0.88}>
          <View style={styles.newIcon}>
            <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <Path d="M12 5v14M5 12h14" stroke={SG.primary} strokeWidth="2.2" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.newTitle}>New trip</Text>
            <Text style={styles.newSub}>Add people to the trip, then name it — one-time setup</Text>
          </View>
          <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <Path d="M5 3l4 4-4 4" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>Your trips</Text>
          {groups.length > 0 ? (
            <TouchableOpacity onPress={onClearTrips} activeOpacity={0.75}>
              <Text style={styles.clearText}>Clear history</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 28 }} color={SG.primary} />
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>No trips yet. Create a new trip to get started, or pull down to refresh after you have bills on the server.</Text>
        ) : (
          groups.map((g) => (
            <TouchableOpacity
              key={g.travelGroupId}
              style={styles.tripCard}
              onPress={() => openGroup(g)}
              activeOpacity={0.85}
            >
              <View style={styles.tripIcon}>
                <Text style={styles.tripIconLetter}>
                  {(String(g.travelGroupName || 'Trip').trim()[0] || 'T').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripTitle} numberOfLines={2}>{g.travelGroupName}</Text>
                <Text style={styles.tripMeta} numberOfLines={1}>{g.travelGroupId}</Text>
                <Text style={styles.tripPeople} numberOfLines={2}>
                  {(g.participantNames || []).join(' · ') || 'No members listed'}
                </Text>
              </View>
              <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <Path d="M5 3l4 4-4 4" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  headerSafe: { backgroundColor: SG.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 17, marginRight: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  intro: {
    fontSize: 13, color: SG.muted, lineHeight: 19, marginBottom: 18,
  },
  newCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: SG.primary, borderStyle: 'dashed',
    marginBottom: 22,
  },
  newIcon: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: SG.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  newTitle: { fontSize: 16, fontWeight: '800', color: SG.ink },
  newSub: { fontSize: 12, color: SG.muted, marginTop: 4, lineHeight: 17 },
  section: {
    fontSize: 12, fontWeight: '800', color: SG.muted, letterSpacing: 0.5, marginBottom: 10,
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  clearText: {
    fontSize: 12, fontWeight: '700', color: '#B91C1C',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 12,
    padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  errorText: { flex: 1, color: '#B91C1C', fontSize: 12, lineHeight: 17 },
  errorRetry: { color: '#B91C1C', fontWeight: '800', fontSize: 12 },
  empty: { fontSize: 14, color: SG.muted, lineHeight: 21, marginTop: 8 },
  tripCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  tripIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: SG.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  tripIconLetter: { fontSize: 18, fontWeight: '800', color: SG.primary },
  tripTitle: { fontSize: 16, fontWeight: '800', color: SG.ink },
  tripMeta: { fontSize: 11, color: SG.muted, marginTop: 2 },
  tripPeople: { fontSize: 12, color: SG.ink2, marginTop: 6, lineHeight: 17 },
});
