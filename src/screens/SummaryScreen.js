import React, { useEffect, useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../components/ScreenHeader';
import Avatar from '../components/Avatar';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';

export default function SummaryScreen({ navigation }) {
  const { items, participants, assignments, receiptMeta, taxMultiplier, receiptUrl } = useFlow();
  const [expanded, setExpanded] = useState(participants[0]?.name);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [receiptError, setReceiptError] = useState(false);

  // Only render <Image> for genuine URLs. Anything else (raw S3 key, null,
  // accidentally-stored object) should fall through to the empty state instead
  // of silently showing a black screen.
  const receiptUri = receiptUrl && (receiptUrl.startsWith('http') || receiptUrl.startsWith('data:'))
    ? receiptUrl
    : null;

  // Pre-warm the image cache the moment we have a URL so the modal feels
  // instant when the user taps the thumbnail.
  useEffect(() => {
    if (!receiptUri) return;
    setReceiptLoading(true);
    setReceiptError(false);
    Image.prefetch(receiptUri).catch(() => {});
  }, [receiptUri]);

  const perPerson = {};
  participants.forEach(p => { perPerson[p.name] = { items: [], subtotal: 0 }; });
  items.forEach(it => {
    const a = assignments[it.id];
    if (!a || a.people.length === 0) return;
    const share = (it.qty * it.unit) / a.people.length;
    a.people.forEach(n => {
      if (!perPerson[n]) return;
      perPerson[n].items.push({ name: it.name, qty: it.qty, share, shared: a.people.length > 1 });
      perPerson[n].subtotal += share;
    });
  });

  const grandSubtotal = Object.values(perPerson).reduce((s, p) => s + p.subtotal, 0);
  const grandTotal = grandSubtotal * taxMultiplier;
  const { restaurant, sst, serviceCharge, currency } = receiptMeta;

  // Map currency code → display symbol. Defaults to RM (Malaysia) so existing
  // demos render unchanged.
  const ccy = (currency || 'MYR').toUpperCase();
  const CCY_SYMBOL = { MYR: 'RM', SGD: 'S$', THB: '฿', IDR: 'Rp', USD: '$', EUR: '€', CNY: '¥' };
  const sym = CCY_SYMBOL[ccy] || ccy;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title="Bill summary"
          subtitle={sst != null || serviceCharge != null ? 'Taxes split proportionally' : 'Subtotal split by item'}
          onBack={() => navigation.goBack()}
          right={
            <TouchableOpacity style={styles.shareBtn} activeOpacity={0.7}>
              <Svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <Path d="M2 4h8M2 8h5" stroke={SG.primary} strokeWidth="1.5" strokeLinecap="round" />
              </Svg>
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
          }
        />
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero total */}
        <LinearGradient
          colors={[SG.primary, SG.primaryDeep]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroBubble1} />
          <View style={styles.heroBubble2} />
          <View style={{ position: 'relative' }}>
            <View style={styles.heroTopRow}>
              <Text style={styles.heroLabel}>{(restaurant || 'RECEIPT').toUpperCase()} · SPLIT {participants.length} WAYS</Text>
              <View style={styles.ccyBadge}><Text style={styles.ccyBadgeText}>{ccy}</Text></View>
            </View>
            <Text style={styles.heroAmt}>{sym} {grandTotal.toFixed(2)}</Text>
            <View style={styles.heroStats}>
              <View>
                <Text style={styles.heroStatLabel}>Subtotal</Text>
                <Text style={styles.heroStatVal}>{sym} {grandSubtotal.toFixed(2)}</Text>
              </View>
              {sst != null && (
                <View>
                  <Text style={styles.heroStatLabel}>SST</Text>
                  <Text style={styles.heroStatVal}>{sym} {sst.toFixed(2)}</Text>
                </View>
              )}
              {serviceCharge != null && (
                <View>
                  <Text style={styles.heroStatLabel}>Service</Text>
                  <Text style={styles.heroStatVal}>{sym} {serviceCharge.toFixed(2)}</Text>
                </View>
              )}
            </View>
          </View>
        </LinearGradient>

        {/* Receipt thumbnail */}
        {receiptUri && (
          <TouchableOpacity
            style={styles.receiptCard}
            onPress={() => {
              setReceiptLoading(true);
              setReceiptError(false);
              setShowReceipt(true);
            }}
            activeOpacity={0.85}
          >
            <Image source={{ uri: receiptUri }} style={styles.receiptThumb} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.receiptTitle}>Original receipt</Text>
              <Text style={styles.receiptHint}>Tap to view full size</Text>
            </View>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Path d="M5 2l5 5-5 5" stroke={SG.muted} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Per-person cards */}
        {participants.map(p => {
          const data = perPerson[p.name];
          if (!data) return null;
          // Proportional share of each tax based on subtotal share
          const ratio = grandSubtotal > 0 ? data.subtotal / grandSubtotal : 0;
          const personSst = sst != null ? sst * ratio : null;
          const personSvc = serviceCharge != null ? serviceCharge * ratio : null;
          const final = data.subtotal * taxMultiplier;
          const isOpen = expanded === p.name;

          return (
            <View key={p.name} style={[styles.personCard, p.me && styles.personCardMe]}>
              <TouchableOpacity
                onPress={() => setExpanded(isOpen ? null : p.name)}
                style={styles.personRow}
                activeOpacity={0.7}
              >
                <Avatar name={p.name} color={p.me ? SG.primary : p.color} size={42} me={p.me} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.personName}>{p.name}</Text>
                    {p.me && <View style={styles.youBadge}><Text style={styles.youText}>YOU</Text></View>}
                  </View>
                  <Text style={styles.personItemCount}>{data.items.length} items</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.personAmt}>{sym} {final.toFixed(2)}</Text>
                  <Text style={styles.detailsLink}>{isOpen ? 'Hide' : 'Details'} ›</Text>
                </View>
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.breakdown}>
                  {data.items.map((it, i) => (
                    <View key={i} style={styles.breakdownRow}>
                      <Text style={styles.breakdownItem}>
                        {it.qty > 1 && !it.shared ? `${it.qty}× ` : ''}{it.name}
                        {it.shared ? <Text style={styles.sharedTag}> (shared)</Text> : null}
                      </Text>
                      <Text style={styles.breakdownAmt}>{sym} {it.share.toFixed(2)}</Text>
                    </View>
                  ))}
                  <View style={styles.breakdownDivider} />
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownSubLabel}>Subtotal</Text>
                    <Text style={styles.breakdownSubAmt}>{sym} {data.subtotal.toFixed(2)}</Text>
                  </View>
                  {personSst != null && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownSubLabel}>SST</Text>
                      <Text style={styles.breakdownSubAmt}>{sym} {personSst.toFixed(2)}</Text>
                    </View>
                  )}
                  {personSvc != null && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownSubLabel}>Service charge</Text>
                      <Text style={styles.breakdownSubAmt}>{sym} {personSvc.toFixed(2)}</Text>
                    </View>
                  )}
                  <View style={[styles.breakdownDivider, { borderStyle: 'solid' }]} />
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownTotal}>Total</Text>
                    <Text style={styles.breakdownTotal}>{sym} {final.toFixed(2)}</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Full-screen receipt viewer */}
      <Modal
        visible={showReceipt}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShowReceipt(false)}
      >
        <View style={styles.modalBackdrop}>
          {receiptUri ? (
            <Image
              source={{ uri: receiptUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              onLoadStart={() => setReceiptLoading(true)}
              onLoadEnd={() => setReceiptLoading(false)}
              onError={(e) => {
                console.warn('[receipt] image load failed', e?.nativeEvent);
                setReceiptError(true);
                setReceiptLoading(false);
              }}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={styles.modalEmptyText}>No receipt available</Text>
            </View>
          )}
          {receiptUri && receiptLoading && !receiptError && (
            <View style={[StyleSheet.absoluteFill, styles.modalLoading]} pointerEvents="none">
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.modalLoadingText}>Loading receipt…</Text>
            </View>
          )}
          {receiptError && (
            <View style={[StyleSheet.absoluteFill, styles.modalLoading]} pointerEvents="none">
              <Text style={styles.modalEmptyText}>Couldn't load receipt</Text>
              <Text style={styles.modalLoadingText}>The link may have expired. Reopen the bill from history.</Text>
            </View>
          )}
          <SafeAreaView style={styles.modalDismissSafe} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.modalDismiss}
              onPress={() => setShowReceipt(false)}
              activeOpacity={0.85}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={styles.modalDismissText}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  shareBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: SG.bg,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  shareBtnText: { fontSize: 11, fontWeight: '600', color: SG.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  heroCard: {
    borderRadius: 20, padding: 18, marginBottom: 14, overflow: 'hidden', position: 'relative',
  },
  heroBubble1: {
    position: 'absolute', top: -30, right: -30, width: 120, height: 120,
    borderRadius: 60, backgroundColor: 'rgba(245,158,11,0.18)',
  },
  heroBubble2: {
    position: 'absolute', top: 40, right: 10, width: 60, height: 60,
    borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 0.3, flex: 1 },
  ccyBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  ccyBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.6 },
  heroAmt: { color: '#fff', fontSize: 32, fontWeight: '700', letterSpacing: -0.8, marginTop: 4 },
  heroStats: { flexDirection: 'row', gap: 14, marginTop: 12 },
  heroStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  heroStatVal: { fontSize: 11, fontWeight: '600', color: '#fff', marginTop: 2 },

  // --- Receipt thumbnail card ---
  receiptCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 10, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  receiptThumb: {
    width: 52, height: 52, borderRadius: 8, backgroundColor: SG.bg,
  },
  receiptTitle: { fontSize: 13, fontWeight: '700', color: SG.ink },
  receiptSub: { fontSize: 10, color: SG.muted, marginTop: 2 },
  receiptHint: { fontSize: 10, color: SG.primary, fontWeight: '600', marginTop: 2 },

  // --- Receipt modal ---
  modalBackdrop: { flex: 1, backgroundColor: '#000' },
  modalDismissSafe: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center',
  },
  modalDismiss: {
    marginBottom: 32,
    paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalDismissText: { color: '#000', fontWeight: '700', fontSize: 15 },
  modalEmptyText: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },
  modalLoading: {
    alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24,
  },
  modalLoadingText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center' },
  modalCaption: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    color: 'rgba(255,255,255,0.7)', fontSize: 10, textAlign: 'center',
    fontFamily: 'Courier',
  },

  personCard: {
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 10,
    borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  personCardMe: { borderColor: `${SG.primary}22` },
  personRow: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  personName: { fontSize: 15, fontWeight: '700', color: SG.ink, letterSpacing: -0.2 },
  youBadge: {
    backgroundColor: SG.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  youText: { fontSize: 9, fontWeight: '700', color: SG.primary, letterSpacing: 0.3 },
  personItemCount: { fontSize: 11, color: SG.muted, marginTop: 2 },
  personAmt: { fontSize: 17, fontWeight: '700', color: SG.ink, letterSpacing: -0.3 },
  detailsLink: { fontSize: 10, color: SG.muted, marginTop: 2 },
  breakdown: {
    borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: SG.line,
    padding: 14, paddingTop: 10, backgroundColor: SG.bgWarm,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  breakdownItem: { fontSize: 12, color: SG.ink2, flex: 1 },
  sharedTag: { color: SG.muted, fontSize: 10 },
  breakdownAmt: { fontSize: 12, color: SG.ink },
  breakdownDivider: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: SG.line2, marginVertical: 8 },
  breakdownSubLabel: { fontSize: 11, color: SG.muted },
  breakdownSubAmt: { fontSize: 11, color: SG.muted },
  breakdownTotal: { fontSize: 13, fontWeight: '700', color: SG.ink },
});
