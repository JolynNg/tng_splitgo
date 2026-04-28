import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, RefreshControl, Alert, Animated, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SG } from '../tokens';
import { listBillsForUser, getBill } from '../api/billService';
import { useAuth } from '../context/AuthContext';
import { useFlow } from '../context/FlowContext';
import {
  accumulateDirectedOwes,
  settlementLinesFor,
} from '../utils/travelSettlement';

/**
 * Trip hub: list all receipts in this travel group, scan new ones,
 * and show aggregate “who owes whom” at the bottom.
 */
function SwipeToDeleteBillRow({ bill, onOpen, onDelete }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const actionWidth = 88;

  const closeRow = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [translateX]);

  const openRow = useCallback(() => {
    Animated.spring(translateX, {
      toValue: -actionWidth,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, g) => (
        Math.abs(g.dx) > Math.abs(g.dy) && (g.dx < -8 || g.dx > 8)
      ),
      onPanResponderMove: (_evt, g) => {
        const x = Math.max(-actionWidth, Math.min(0, g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_evt, g) => {
        if (g.dx <= -36) openRow();
        else closeRow();
      },
      onPanResponderTerminate: closeRow,
    }),
  ).current;

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.deleteRail}>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={onDelete}
          activeOpacity={0.85}
        >
          <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <Path d="M4 7h16" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
            <Path d="M9 7V5h6v2" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M7 7l1 12h8l1-12" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M10 11v5M14 11v5" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.billRowSwipe, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity style={[styles.billRow, styles.billRowSwipe]} onPress={onOpen} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={styles.billTitle}>{bill.restaurant || 'Receipt'}</Text>
            <Text style={styles.uploaderName}>
              Uploaded by {bill.creator ? bill.creator : 'Unknown'}
            </Text>
            <Text style={styles.billMeta}>
              {bill.creator ? `${bill.creator} paid` : 'Payer unknown'} · Cancelled
            </Text>
          </View>
          <View style={styles.amountCol}>
            <Text style={styles.billAmt}>RM {Number(bill.grandTotal || 0).toFixed(2)}</Text>
            <View style={[styles.stateBadge, styles.badgeTodo]}>
              <Text style={[styles.stateBadgeText, styles.stateBadgeTextTodo]}>cancelled</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function TravelGroupHubScreen({ navigation, route }) {
  const safeBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('TravelGroups');
  };
  const { me } = useAuth();
  const { loadBillFromServer } = useFlow();
  const travelGroupId = route.params?.travelGroupId;
  const travelGroupName = route.params?.travelGroupName || 'Trip';
  const initialNames = route.params?.participantNames || [];

  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [owes, setOwes] = useState({});
  const [hiddenCancelledBillIds, setHiddenCancelledBillIds] = useState([]);
  const aliveRef = useRef(true);

  const myName = me?.name;

  const hiddenKey = useMemo(
    () => (myName && travelGroupId ? `@splitgo:hidden-cancelled:${myName}:${travelGroupId}` : null),
    [myName, travelGroupId],
  );

  const tripBills = useMemo(() => {
    const hidden = new Set(hiddenCancelledBillIds);
    return (summaries || []).filter(
      (b) => b.travelGroupId === travelGroupId && !(b.status === 'cancelled' && hidden.has(b.billId)),
    );
  }, [summaries, travelGroupId, hiddenCancelledBillIds]);

  const mergedParticipantNames = useMemo(() => {
    const s = new Set(initialNames);
    tripBills.forEach((b) => (b.participants || []).forEach((n) => s.add(n)));
    return [...s];
  }, [initialNames, tripBills]);

  const recomputeSettlement = useCallback(async ({ showLoading = false } = {}) => {
    if (!tripBills.length || !travelGroupId) {
      setOwes({});
      return;
    }
    if (showLoading) setSettling(true);
    try {
      const full = await Promise.all(tripBills.map((b) => getBill(b.billId)));
      const valid = full.filter((x) => x && !x.local);
      const agg = accumulateDirectedOwes(valid);
      setOwes(agg);
    } catch (e) {
      console.warn('[TravelHub] settlement:', e.message);
    } finally {
      if (showLoading) setSettling(false);
    }
  }, [tripBills, travelGroupId]);

  const fetchList = useCallback(async () => {
    if (!myName || !travelGroupId) return;
    try {
      const r = await listBillsForUser(myName);
      if (!aliveRef.current) return;
      setSummaries(r.bills || []);
    } catch (e) {
      if (aliveRef.current) Alert.alert('Could not refresh', e.message);
    }
  }, [myName, travelGroupId]);

  useFocusEffect(
    useCallback(() => {
      aliveRef.current = true;
      (async () => {
        setLoading(true);
        if (hiddenKey) {
          try {
            const raw = await AsyncStorage.getItem(hiddenKey);
            const ids = raw ? JSON.parse(raw) : [];
            setHiddenCancelledBillIds(Array.isArray(ids) ? ids : []);
          } catch {
            setHiddenCancelledBillIds([]);
          }
        }
        await fetchList();
        if (aliveRef.current) setLoading(false);
      })();
      return () => { aliveRef.current = false; };
    }, [fetchList, hiddenKey]),
  );

  // Keep the trip hub in sync across devices for receipt/status updates.
  useEffect(() => {
    if (!myName || !travelGroupId) return undefined;
    const id = setInterval(() => {
      fetchList();
    }, 3500);
    return () => clearInterval(id);
  }, [fetchList, myName, travelGroupId]);

  const tripSig = tripBills.map((b) => `${b.billId}:${b.status}`).join('|');
  useEffect(() => {
    if (!tripBills.length) {
      setOwes({});
      return;
    }
    const t = setTimeout(() => { recomputeSettlement({ showLoading: false }); }, 400);
    return () => clearTimeout(t);
  }, [tripSig, recomputeSettlement, tripBills.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchList();
    await recomputeSettlement({ showLoading: true });
    setRefreshing(false);
  };

  const { oweLines, owedLines } = useMemo(
    () => (myName ? settlementLinesFor(myName, owes) : { oweLines: [], owedLines: [] }),
    [myName, owes],
  );

  const totalToPay = useMemo(
    () => oweLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [oweLines],
  );

  const getReceiptState = useCallback((bill) => {
    if (!myName) return { label: 'not yet selected', tone: 'todo' };
    if (bill.status === 'closed') return { label: 'settled', tone: 'done' };
    if (bill.status === 'cancelled') return { label: 'cancelled', tone: 'todo' };
    if (bill.creator === myName) return { label: 'paid', tone: 'done' };
    if ((bill.paid || []).includes(myName)) return { label: 'paid', tone: 'done' };
    if ((bill.ready || []).includes(myName)) return { label: 'pending pay', tone: 'pending' };
    return { label: 'not yet selected', tone: 'todo' };
  }, [myName]);

  const hasActionableOpenReceipts = useMemo(
    () => tripBills.some((b) => b.status === 'open' && b.creator !== myName && !(b.paid || []).includes(myName)),
    [tripBills, myName],
  );

  const openBill = async (bill) => {
    try {
      const full = await getBill(bill.billId);
      if (!full || full.local) {
        Alert.alert('Could not open', 'No data from server.');
        return;
      }
      loadBillFromServer(full);
      const target = full.status === 'open' ? 'BillCreated' : 'Summary';
      navigation.navigate(target);
    } catch (e) {
      Alert.alert('Could not open', e.message);
    }
  };

  const scanReceipt = () => {
    navigation.navigate('Scan', {
      travelGroupId,
      travelGroupName,
      travelParticipantNames: mergedParticipantNames.length ? mergedParticipantNames : initialNames,
    });
  };

  const onDeleteCancelled = useCallback((bill) => {
    Alert.alert(
      'Hide cancelled receipt?',
      'This will hide it on your screen only. Other trip members can still see it until they hide it themselves.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            const next = Array.from(new Set([...hiddenCancelledBillIds, bill.billId]));
            setHiddenCancelledBillIds(next);
            if (hiddenKey) {
              try { await AsyncStorage.setItem(hiddenKey, JSON.stringify(next)); } catch {}
            }
          },
        },
      ],
    );
  }, [hiddenCancelledBillIds, hiddenKey]);

  if (!travelGroupId) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: SG.muted }}>Missing trip id</Text>
        <TouchableOpacity onPress={safeBack} style={{ marginTop: 16 }}>
          <Text style={{ color: SG.primary, fontWeight: '700' }}>Back to trips</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{travelGroupName}</Text>
            <Text style={styles.headerSub}>{travelGroupId}</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 240 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SG.primary} />}
      >
        <TouchableOpacity style={styles.scanCta} onPress={scanReceipt} activeOpacity={0.88}>
          <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <Path d="M4 7h4l2-2h4l2 2h4v12H4V7z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            <Path d="M12 11a3 3 0 100 6 3 3 0 000-6z" stroke="#fff" strokeWidth="1.6" />
          </Svg>
          <Text style={styles.scanCtaText}>Scan receipt to trip</Text>
          <Text style={styles.scanCtaSub}>Whoever paid can scan — same group on every receipt</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.pfmEntry}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('TravelPFM', { travelGroupId, travelGroupName })}
        >
          <View style={styles.pfmEntryIcon}>
            <Svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <Path d="M4 19h16M7 16V9M12 16V5M17 16v-7" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pfmEntryTitle}>Trip Insights</Text>
            <Text style={styles.pfmEntrySub}>Spending carousel, category cards and AI advice</Text>
          </View>
          <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <Path d="M5 3l4 4-4 4" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Receipts on this trip</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={SG.primary} />
        ) : tripBills.length === 0 ? (
          <Text style={styles.empty}>No receipts yet. Tap above to add the first one.</Text>
        ) : (
          tripBills.map((b) => (
            b.status === 'cancelled' ? (
              <SwipeToDeleteBillRow
                key={b.billId}
                bill={b}
                onOpen={() => openBill(b)}
                onDelete={() => onDeleteCancelled(b)}
              />
            ) : (
            <TouchableOpacity key={b.billId} style={styles.billRow} onPress={() => openBill(b)} activeOpacity={0.8}>
              {(() => {
                const uploader = b.creator || null;
                const uploaderLabel = uploader ? (uploader === myName ? 'You' : uploader) : 'Unknown';
                const payerLabel = uploader ? (uploader === myName ? 'You paid' : `${uploader} paid`) : 'Payer unknown';
                const statusLabel = b.status === 'open' ? 'Open' : b.status === 'cancelled' ? 'Cancelled' : 'Settled';
                return (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.billTitle}>{b.restaurant || 'Receipt'}</Text>
                    <Text style={styles.uploaderName}>
                      Uploaded by {uploaderLabel}
                    </Text>
                    <Text style={styles.billMeta}>
                      {payerLabel} · {statusLabel}
                    </Text>
                  </View>
                );
              })()}
              <View style={styles.amountCol}>
                <Text style={styles.billAmt}>RM {Number(b.grandTotal || 0).toFixed(2)}</Text>
                {(() => {
                  const state = getReceiptState(b);
                  return (
                    <View style={[styles.stateBadge, state.tone === 'done' ? styles.badgeDone : state.tone === 'pending' ? styles.badgePending : styles.badgeTodo]}>
                      <Text style={[styles.stateBadgeText, state.tone === 'todo' ? styles.stateBadgeTextTodo : null]}>{state.label}</Text>
                    </View>
                  );
                })()}
              </View>
            </TouchableOpacity>
            )
          ))
        )}

      </ScrollView>

      {/* Trip settlement strip */}
      <SafeAreaView edges={['bottom']} style={styles.settlePanel}>
        <Text style={styles.settleTitle}>Total payment to trip members</Text>
        {settling ? (
          <ActivityIndicator size="small" color={SG.primary} style={{ marginVertical: 8 }} />
        ) : oweLines.length === 0 ? (
          <Text style={styles.settleHint}>
            {hasActionableOpenReceipts
              ? 'You have something to pay. Select your items in open receipts to calculate your amount.'
              : 'You do not need to pay anyone right now.'}
          </Text>
        ) : (
          <>
            <Text style={styles.totalPayAmt}>RM {totalToPay.toFixed(2)}</Text>
            {oweLines.map((l) => (
              <Text key={`o-${l.to}`} style={styles.perMemberLine}>
                Pay <Text style={styles.bold}>{l.to}</Text> · RM {l.amount.toFixed(2)}
              </Text>
            ))}
          </>
        )}
        {owedLines.length > 0 ? (
          <Text style={styles.netLine}>
            Also receiving: {owedLines.map((l) => `${l.from} RM ${l.amount.toFixed(2)}`).join(' · ')}
          </Text>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  headerSafe: { backgroundColor: SG.primary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  scanCta: {
    marginHorizontal: 16, marginTop: 16, padding: 18, borderRadius: 16, backgroundColor: SG.primary,
  },
  scanCtaText: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 10 },
  scanCtaSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4, lineHeight: 17 },
  pfmEntry: {
    marginHorizontal: 16, marginTop: 10, padding: 14, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1, borderColor: SG.line2,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  pfmEntryIcon: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: SG.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  pfmEntryTitle: { fontSize: 15, fontWeight: '800', color: SG.ink },
  pfmEntrySub: { fontSize: 12, color: SG.muted, marginTop: 2 },
  sectionLabel: {
    marginHorizontal: 16, marginTop: 22, marginBottom: 8, fontSize: 13, fontWeight: '700', color: SG.muted,
    letterSpacing: 0.3,
  },
  empty: { marginHorizontal: 16, color: SG.muted, fontSize: 14, lineHeight: 20 },
  membersSection: { marginHorizontal: 16, marginTop: 24, marginBottom: 8 },
  memberLine: { fontSize: 14, color: SG.ink, lineHeight: 22, fontWeight: '600' },
  billRow: {
    marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 12,
    backgroundColor: SG.bg, flexDirection: 'row', alignItems: 'center',
  },
  billRowSwipe: { marginHorizontal: 0, marginBottom: 0 },
  swipeWrap: { marginHorizontal: 16, marginBottom: 10, borderRadius: 12, overflow: 'hidden' },
  deleteRail: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 88,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtn: {
    width: 88, height: '100%', backgroundColor: '#DC2626',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  amountCol: {
    alignItems: 'flex-end',
  },
  stateBadge: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginTop: 6,
  },
  badgeTodo: { backgroundColor: '#FEF3C7' },
  badgePending: { backgroundColor: '#DBEAFE' },
  badgeDone: { backgroundColor: '#DCFCE7' },
  stateBadgeText: { fontSize: 10, fontWeight: '800', color: '#065F46', textTransform: 'lowercase' },
  stateBadgeTextTodo: { color: '#92400E' },
  billTitle: { fontSize: 15, fontWeight: '700', color: SG.ink },
  uploaderName: { fontSize: 12, color: SG.ink2, marginTop: 3, fontWeight: '600' },
  billMeta: { fontSize: 12, color: SG.muted, marginTop: 2 },
  billAmt: { fontSize: 15, fontWeight: '800', color: SG.primary },
  settlePanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: SG.line2,
    paddingHorizontal: 16, paddingTop: 12, maxHeight: 200,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  settleTitle: { fontSize: 13, fontWeight: '800', color: SG.ink, marginBottom: 6 },
  settleHint: { fontSize: 12, color: SG.muted, lineHeight: 18 },
  totalPayAmt: { fontSize: 26, fontWeight: '800', color: SG.primary, marginBottom: 6, letterSpacing: -0.4 },
  perMemberLine: { fontSize: 11, color: SG.muted, marginTop: 3, lineHeight: 16 },
  bold: { fontWeight: '800' },
  netLine: { fontSize: 11, color: SG.muted, marginTop: 8, lineHeight: 16 },
});
