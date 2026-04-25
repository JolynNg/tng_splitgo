import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native'; // Alert kept for handleOpen error reporting
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { SG } from '../tokens';
import BillCard from '../components/BillCard';
import { listBillsForUser, getBill } from '../api/billService';
import { useFlow } from '../context/FlowContext';
import { useAuth } from '../context/AuthContext';

/**
 * SplitGoHomeScreen — the actual SplitGo "app within TnG".
 *
 * Three jobs:
 *   1. Show the user's active (un-settled) bills, with live claim progress
 *      polled every 5 s. Tap a card to resume into the live dashboard or
 *      claim view, depending on whether you're the creator or a participant.
 *   2. Big "Scan a new receipt" CTA → camera (ScanScreen).
 *   3. History link in the top-right, covering settled bills too.
 */
export default function SplitGoHomeScreen({ navigation }) {
  const { loadBillFromServer } = useFlow();
  const { me, refreshMe } = useAuth();
  const myName = me?.name;

  const [bills, setBills]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefr]   = useState(false);
  const [error, setError]       = useState(null);
  const [cloudMode, setCloud]   = useState(true);
  const [resumingId, setResumingId] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const aliveRef = useRef(true);

  const fetchBills = useCallback(async () => {
    if (!myName) return;
    try {
      const r = await listBillsForUser(myName);
      if (!aliveRef.current) return;
      // SplitGoHome only surfaces in-flight bills — settled ones live in History.
      setBills((r.bills || []).filter(b => b.status === 'open'));
      setCloud(!r.local);
      setLastSyncAt(Date.now());
      setError(null);
      // Wallet balance can change when someone else pays *us*, so refresh
      // alongside every bill poll to keep the home dashboard accurate.
      refreshMe?.();
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err.message);
    }
  }, [myName, refreshMe]);

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      setLoading(true);
      await fetchBills();
      if (aliveRef.current) setLoading(false);
    })();
    const id = setInterval(fetchBills, 5000);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [fetchBills]);

  const onRefresh = async () => {
    setRefr(true);
    await fetchBills();
    setRefr(false);
  };

  const handleOpen = async (bill) => {
    if (resumingId) return;
    setResumingId(bill.billId);
    try {
      const full = await getBill(bill.billId);
      if (!full || full.local) {
        Alert.alert('Could not open bill', 'No data returned from the server.');
        return;
      }
      loadBillFromServer(full);
      // Everyone opens the same live dashboard; "Pick mine" goes to Claim.
      const target = full.status === 'closed' ? 'Summary' : 'BillCreated';
      navigation.navigate(target);
    } catch (err) {
      Alert.alert('Could not open bill', err.message);
    } finally {
      setResumingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.primary} />
      {/* Branded header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: SG.primary }}>
        <LinearGradient
          colors={[SG.primary, SG.primaryDeep]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerRow}>
            {/* Title is the only flex child so it naturally centers itself.
                The back button (left) and history pill (right) are absolutely
                positioned over the row so they don't push the title off-center. */}
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>SplitGo</Text>
            </View>

            <TouchableOpacity
              onPress={() => navigation.navigate('Home')}
              style={[styles.iconBtn, styles.headerLeft]}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('History')}
              style={[styles.historyBtn, styles.headerRight]}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <Circle cx="9" cy="9" r="7" stroke="#fff" strokeWidth="1.6" />
                <Path d="M9 5v4l2.5 2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.historyBtnText}>History</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SG.primary} />}
      >
        {/* Hero scan card */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Scan')}
          style={styles.heroWrap}
        >
          <LinearGradient
            colors={[SG.primary, SG.primaryDeep]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIcon}>
              <Svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <Path d="M5 8V6a2 2 0 012-2h2M19 4h2a2 2 0 012 2v2M23 18v2a2 2 0 01-2 2h-2M9 22H7a2 2 0 01-2-2v-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <Circle cx="14" cy="14" r="4.5" stroke="#fff" strokeWidth="2" />
                <Circle cx="14" cy="14" r="1.5" fill="#fff" />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Create a new bill</Text>
              <Text style={styles.heroSub}>Scan a receipt — AI does the rest</Text>
            </View>
            <View style={styles.heroChev}>
              <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <Path d="M5 3l4 4-4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Active bills */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active bills</Text>
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={SG.primary} />
            <Text style={styles.centerText}>Loading active bills…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.errCard}>
            <Text style={styles.errTitle}>Couldn't load bills</Text>
            <Text style={styles.errMsg}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchBills} activeOpacity={0.7}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && bills.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No active bills</Text>
            <Text style={styles.emptySub}>
              Bills you create or get added to will appear here while they're being settled.
            </Text>
          </View>
        )}

        {!loading && bills.map((b) => (
          <BillCard key={b.billId} bill={b} onOpen={handleOpen} resuming={resumingId === b.billId} />
        ))}

        {!loading && bills.length > 0 && (
          <Text style={styles.footnote}>
            Auto-refreshes every 5s · {bills.length} in flight
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },

  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: {
    paddingTop: 22, paddingBottom: 6,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  headerTitleWrap: {
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerLeft:  { position: 'absolute', left: 0, top: 22 },
  headerRight: { position: 'absolute', right: 0, top: 22 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  headerSub:   { color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 1, textAlign: 'center' },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  historyBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 80 },

  // Hero CTA
  heroWrap: {
    borderRadius: 18, marginBottom: 22,
    shadowColor: SG.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 14, elevation: 4,
  },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 18, borderRadius: 18,
  },
  heroIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroSub:   { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  heroChev: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: SG.ink, letterSpacing: 0.2,
  },

  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: SG.successSoft, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: SG.success },
  liveText: { fontSize: 9, fontWeight: '800', color: SG.success, letterSpacing: 0.4 },

  center:     { paddingTop: 24, alignItems: 'center', gap: 8 },
  centerText: { fontSize: 12, color: SG.muted },

  errCard: {
    backgroundColor: '#FEF2F2', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errTitle: { fontSize: 13, fontWeight: '700', color: '#991B1B' },
  errMsg:   { fontSize: 11, color: '#991B1B', marginTop: 4 },
  retryBtn: {
    marginTop: 10, alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#FECACA',
  },
  retryBtnText: { fontSize: 11, color: '#991B1B', fontWeight: '700' },

  empty: {
    backgroundColor: '#fff', borderRadius: 14, padding: 22,
    borderWidth: 1, borderColor: SG.line, alignItems: 'center',
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: SG.ink },
  emptySub:   { fontSize: 11, color: SG.muted, textAlign: 'center', marginTop: 4, lineHeight: 16, maxWidth: 240 },

  footnote: { fontSize: 10, color: SG.muted, textAlign: 'center', marginTop: 12, lineHeight: 14 },
});
