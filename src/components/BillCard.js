import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SG } from '../tokens';

const CCY_SYMBOL = { MYR: 'RM', SGD: 'S$', THB: '฿', IDR: 'Rp', USD: '$', EUR: '€', CNY: '¥' };

// Friendly fallback title when the receipt didn't yield a restaurant name.
// Builds something like "Bill · Sat 25 Apr · 7:30pm" so the entry still has
// a recognisable, scannable label in the history feed.
export function billTitle(bill) {
  if (bill.restaurant && bill.restaurant.trim()) return bill.restaurant.trim();
  if (!bill.createdAt) return `Bill ${bill.billId}`;
  const d = new Date(bill.createdAt);
  const day  = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' ', '').toLowerCase();
  return `Bill · ${day} · ${time}`;
}

export function formatRelative(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30)    return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * BillCard — single bill row used by both HistoryScreen (all bills) and
 * SplitGoHomeScreen (just open ones). Shows live claim progress and routes
 * to the right screen on tap.
 */
export default function BillCard({ bill, onOpen, resuming, compact = false }) {
  const sym = CCY_SYMBOL[(bill.currency || 'MYR').toUpperCase()] || 'RM';
  const isClosed    = bill.status === 'closed';
  const isCancelled = bill.status === 'cancelled';
  const isInactive  = isClosed || isCancelled;
  const itemPct  = bill.itemCount > 0
    ? Math.min(1, (bill.claimedItems || 0) / bill.itemCount)
    : 0;
  const ppl       = bill.participantCount || (bill.participants || []).length;
  const pplDone   = bill.claimedParticipants || 0;
  const pplOthers = Math.max(0, ppl - 1);
  const title     = billTitle(bill);
  const initial   = (title[0] || '?').toUpperCase();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isInactive && styles.cardClosed,
        resuming && styles.cardLoading,
        compact && styles.cardCompact,
      ]}
      activeOpacity={0.85}
      onPress={() => onOpen(bill)}
      disabled={resuming}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, isInactive && styles.cardIconClosed]}>
          <Text style={[styles.cardIconText, isInactive && styles.cardIconTextClosed]}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.meta}>
            {bill.billId} · {formatRelative(bill.createdAt)}
          </Text>
        </View>
        <View style={[
          styles.statusPill,
          isCancelled ? styles.statusCancelled : isClosed ? styles.statusClosed : styles.statusOpen,
        ]}>
          {!isInactive && <View style={styles.openDot} />}
          <Text style={[
            styles.statusText,
            { color: isCancelled ? '#B91C1C' : isClosed ? SG.success : SG.accentDeep },
          ]}>
            {isCancelled ? 'CANCELLED' : isClosed ? 'CLOSED' : 'OPEN'}
          </Text>
        </View>
      </View>

      {!isInactive && bill.itemCount > 0 && (
        <>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>
              {bill.claimedItems || 0} / {bill.itemCount} items claimed
            </Text>
            <Text style={styles.progressPpl}>
              {pplDone}/{pplOthers} ppl done
            </Text>
          </View>
          <View style={styles.progressBar}>
            <LinearGradient
              colors={[SG.primary, SG.accent]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${itemPct * 100}%` }]}
            />
          </View>
        </>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.amt}>{sym} {Number(bill.grandTotal || 0).toFixed(2)}</Text>
        <View style={styles.cardFooterRight}>
          {resuming
            ? <ActivityIndicator size="small" color={SG.primary} />
            : (
              <Text style={styles.openLink}>
                {isCancelled ? 'View bill' : isClosed ? 'View settlement' : 'Open dashboard'} ›
              </Text>
            )
          }
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardCompact: { padding: 12 },
  cardClosed: { opacity: 0.92 },
  cardLoading: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: SG.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  cardIconClosed:     { backgroundColor: SG.successSoft },
  cardIconText:       { fontSize: 18, fontWeight: '800', color: SG.primary },
  cardIconTextClosed: { color: SG.success },
  title: { fontSize: 14, fontWeight: '700', color: SG.ink },
  meta:  { fontSize: 11, color: SG.muted, marginTop: 2 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  statusOpen:      { backgroundColor: SG.accentSoft },
  statusClosed:    { backgroundColor: SG.successSoft },
  statusCancelled: { backgroundColor: '#FEE2E2' },
  statusText:      { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  openDot:      { width: 5, height: 5, borderRadius: 3, backgroundColor: SG.accentDeep },

  progressRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, marginBottom: 4,
  },
  progressLabel: { fontSize: 11, color: SG.ink2,  fontWeight: '600' },
  progressPpl:   { fontSize: 11, color: SG.muted, fontWeight: '600' },
  progressBar:   { height: 6, backgroundColor: SG.bg, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },

  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10,
  },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amt: { fontSize: 16, fontWeight: '800', color: SG.ink, letterSpacing: -0.3 },
  openLink:   { fontSize: 11, fontWeight: '700', color: SG.primary },
});
