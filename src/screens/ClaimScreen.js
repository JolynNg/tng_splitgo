import React, { useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import ScreenHeader from '../components/ScreenHeader';
import PillBtn from '../components/PillBtn';
import TngAvatar from '../components/TngAvatar';
import UserSwitcher from '../components/UserSwitcher';
import { SG } from '../tokens';
import { useFlow, BILL_STATUS } from '../context/FlowContext';
import { getBill } from '../api/billService';

/**
 * Self-claim screen. Each participant picks the items they actually ordered.
 * If multiple people claim the same item, the cost is split equally among
 * them automatically.
 */
export default function ClaimScreen({ navigation }) {
  const {
    items, claims, toggleClaim, currentUser, setCurrentUser,
    receiptMeta, taxMultiplier,
    billId, billStatus, syncFromServer,
    me, billCreator, leaveBill,
  } = useFlow();

  const myName = currentUser;
  // "Payer view" = the device is currently rendered as the bill's creator
  // (either because that's me, or I've toggled the user-switcher back to them).
  const isPayer = !!billCreator && myName === billCreator;

  const CCY_SYMBOL = { MYR: 'RM', SGD: 'S$', THB: '฿', IDR: 'Rp', USD: '$', EUR: '€', CNY: '¥' };
  const sym = CCY_SYMBOL[(receiptMeta.currency || 'MYR').toUpperCase()] || 'RM';

  // Live sync — same poll loop as the payer dashboard so claim screens stay
  // in sync. When status flips to 'closed' (payer hit Close), auto-navigate
  // to the settlement screen.
  useEffect(() => {
    if (!billId || billStatus !== BILL_STATUS.OPEN) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const bill = await getBill(billId);
        if (cancelled || !bill || bill.local) return;
        syncFromServer(bill);
        if (bill.status === 'closed') {
          if (me?.name) setCurrentUser(me.name);
          navigation.replace('Summary');
        }
      } catch { /* swallow */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [billId, billStatus, syncFromServer, navigation, setCurrentUser, me?.name]);

  const myClaimedIds = useMemo(
    () => items.filter(it => (claims[it.id] || []).includes(myName)).map(it => it.id),
    [items, claims, myName],
  );

  const mySubtotal = useMemo(() => {
    return items.reduce((sum, it) => {
      const people = claims[it.id] || [];
      if (!people.includes(myName)) return sum;
      const share = (it.qty * it.unit) / people.length;
      return sum + share;
    }, 0);
  }, [items, claims, myName]);

  const myTotal = mySubtotal * taxMultiplier;

  const handleSubmit = () => {
    if (isPayer) {
      navigation.goBack();
      return;
    }
    // No items selected → remove this person from the bill in real time (AWS).
    if (myClaimedIds.length === 0) {
      Alert.alert(
        'Leave this bill?',
        'You will be removed from the group and won\'t owe a share. Others keep splitting without you.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove me',
            style: 'destructive',
            onPress: async () => {
              try {
                await leaveBill(me?.name);
                navigation.replace('SplitGoHome');
              } catch (e) {
                Alert.alert('Could not update', e.message);
              }
            },
          },
        ],
      );
      return;
    }
    if (me?.name && billCreator && me.name === billCreator) {
      setCurrentUser(me.name);
      navigation.replace('BillCreated');
    } else {
      navigation.replace('BillCreated');
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title={isPayer ? 'Pick your items' : `Hi ${myName.split(' ')[0]}!`}
          subtitle={
            isPayer
              ? 'Tap the items you ordered'
              : `${receiptMeta.restaurant || 'A restaurant'} · tap items you had`
          }
          onBack={() => {
            if (!isPayer) {
              if (me?.name && billCreator && me.name === billCreator) {
                setCurrentUser(me.name);
                navigation.replace('BillCreated');
              } else {
                navigation.replace('BillCreated');
              }
            } else {
              navigation.goBack();
            }
          }}
          right={
            <View style={styles.headerBadge}>
              <TngAvatar size={22} />
              <Text style={styles.headerBadgeText}>{myName.split(' ')[0]}</Text>
            </View>
          }
        />
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Greeting card (only for non-payer) */}
        {!isPayer && (
          <View style={styles.greetCard}>
            <View style={styles.greetIcon}>
              <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <Path d="M10 2l2.5 5 5.5.5-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5L10 2z"
                  stroke={SG.primary} strokeWidth="1.6" strokeLinejoin="round" fill={SG.primarySoft} />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.greetTitle}>You're invited to split a bill</Text>
              <Text style={styles.greetSub}>
                Just tap the items you ordered. Shared dishes? Tap them too — we'll split equally with whoever else claims them.
              </Text>
            </View>
          </View>
        )}

        {/* Items list */}
        <View style={styles.itemsCard}>
          {items.map((it, i) => {
            const claimers = claims[it.id] || [];
            const mine = claimers.includes(myName);
            const others = claimers.filter(n => n !== myName);
            const lineTotal = it.qty * it.unit;
            const myShare = mine ? lineTotal / claimers.length : 0;
            return (
              <TouchableOpacity
                key={it.id}
                onPress={() => toggleClaim(it.id, myName)}
                style={[
                  styles.itemRow,
                  i < items.length - 1 && styles.itemBorder,
                  mine && styles.itemRowSelected,
                ]}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, mine && styles.checkboxOn]}>
                  {mine && (
                    <Svg width="12" height="12" viewBox="0 0 12 12">
                      <Path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  )}
                </View>
                <View style={[styles.qtyBadge, mine && styles.qtyBadgeOn]}>
                  <Text style={[styles.qtyText, mine && { color: SG.primary }]}>{it.qty}×</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.itemMeta}>{sym} {lineTotal.toFixed(2)}</Text>
                    {others.length > 0 && (
                      <View style={styles.sharedTag}>
                        <Svg width="10" height="10" viewBox="0 0 10 10">
                          <Circle cx="5" cy="5" r="4" fill={SG.accent} />
                        </Svg>
                        <Text style={styles.sharedText}>
                          {others.length === 1
                            ? `${others[0].split(' ')[0]} also had this`
                            : `${others.length} others also had this`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                {mine ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.myShareLabel}>Your share</Text>
                    <Text style={styles.myShareAmt}>{sym} {myShare.toFixed(2)}</Text>
                  </View>
                ) : (
                  <Text style={styles.tapHint}>Tap to claim</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* My total */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Items claimed</Text>
            <Text style={styles.totalValue}>{myClaimedIds.length} of {items.length}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{sym} {mySubtotal.toFixed(2)}</Text>
          </View>
          {(receiptMeta.sst != null || receiptMeta.serviceCharge != null) && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>SST + service (your share)</Text>
              <Text style={styles.totalValue}>{sym} {(myTotal - mySubtotal).toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.grandLabel}>You pay</Text>
            <Text style={styles.grandAmt}>{sym} {myTotal.toFixed(2)}</Text>
          </View>
        </View>

        <Text style={styles.footnote}>
          Don't worry — you can change your selection any time before the payer closes the bill.
          {'\n'}
          If you didn't order anything, use "I didn't have anything" to leave the bill — you'll disappear from the group for everyone in real time.
        </Text>
      </ScrollView>

      {me?.name === billCreator && <UserSwitcher />}

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PillBtn
          variant={myClaimedIds.length === 0 ? 'ghost' : 'primary'}
          onPress={handleSubmit}
        >
          {myClaimedIds.length === 0
            ? "I didn't have anything · Skip"
            : `Submit · ${sym} ${myTotal.toFixed(2)}`}
        </PillBtn>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 4, paddingRight: 10, paddingVertical: 4,
    backgroundColor: SG.primarySoft, borderRadius: 999,
  },
  headerBadgeText: { fontSize: 11, fontWeight: '700', color: SG.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 160 },

  greetCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: SG.primarySoft, borderRadius: 14, padding: 14, marginBottom: 14,
  },
  greetIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  greetTitle: { fontSize: 13, fontWeight: '700', color: SG.primary, letterSpacing: -0.1 },
  greetSub: { fontSize: 12, color: SG.primaryInk, marginTop: 4, lineHeight: 17 },

  itemsCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  itemRow: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: SG.line2 },
  itemRowSelected: { backgroundColor: SG.primarySoft },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: SG.line, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { borderColor: SG.primary, backgroundColor: SG.primary },
  qtyBadge: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: SG.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBadgeOn: { backgroundColor: '#fff' },
  qtyText: { fontSize: 12, fontWeight: '700', color: SG.ink2 },
  itemName: { fontSize: 14, fontWeight: '600', color: SG.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  itemMeta: { fontSize: 11, color: SG.muted },
  sharedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sharedText: { fontSize: 10, color: SG.accentDeep, fontWeight: '600' },
  myShareLabel: { fontSize: 9, color: SG.muted, fontWeight: '600', letterSpacing: 0.3 },
  myShareAmt: { fontSize: 14, fontWeight: '700', color: SG.primary, marginTop: 2 },
  tapHint: { fontSize: 11, color: SG.muted2, fontStyle: 'italic' },

  totalCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: SG.muted },
  totalValue: { fontSize: 13, color: SG.ink, fontWeight: '600' },
  totalDivider: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: SG.line, marginVertical: 8 },
  grandLabel: { fontSize: 16, fontWeight: '700', color: SG.ink },
  grandAmt: { fontSize: 18, fontWeight: '700', color: SG.primary, letterSpacing: -0.3 },

  footnote: { fontSize: 11, color: SG.muted, textAlign: 'center', marginTop: 14, lineHeight: 16 },

  footer: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: SG.line2,
  },
});
