import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';

/**
 * PaymentSuccessScreen — TNG-style "Transferred" receipt.
 *
 * The screen visually mirrors the real TNG eWallet payment receipt: white
 * background, green check, big RM amount, "Transferred" subtitle, three
 * receipt rows, and a bottom toolbar (favourite + share + primary "Done").
 *
 * Above the bottom bar we surface a soft SplitGo upsell card — that is the
 * trojan horse: every time a TNG user finishes paying a merchant, the most
 * obvious next tap is to split it with friends.
 */
export default function PaymentSuccessScreen({ navigation }) {
  const { refreshMe } = useAuth();

  const checkScale = useRef(new Animated.Value(0.6)).current;
  const fade       = useRef(new Animated.Value(0)).current;
  const cardSlide  = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(checkScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(cardSlide, { toValue: 0, duration: 480, delay: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [checkScale, fade, cardSlide]);

  useEffect(() => { refreshMe?.(); }, [refreshMe]);

  // The receipt timestamp is generated at mount so it always reads "now".
  const dateText = useMemo(() => {
    const d   = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, []);

  const handleSplit = () => navigation.replace('SplitBillMode');
  const handleDone  = () => navigation.popToTop();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.body}>

          <Animated.View style={[styles.checkWrap, { transform: [{ scale: checkScale }] }]}>
            <View style={styles.checkCircle}>
              <Svg width="28" height="28" viewBox="0 0 36 36" fill="none">
                <Path d="M9 18l6 6 12-13" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Animated.View>

          <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
            <Text style={styles.amount}>
              <Text style={styles.amountCurrency}>RM </Text>
              <Text style={styles.amountValue}>XX</Text>
            </Text>
            <Text style={styles.transferred}>Transferred</Text>
          </Animated.View>

          <Animated.View style={[styles.rows, { opacity: fade }]}>
            <Row label="Receiver"    value="RESTAURANT XXX" />
            <Row label="Remark"      value="Fund Transfer" />
            <Row label="Date & Time" value={dateText} />
          </Animated.View>

          <View style={{ flex: 1 }} />

          {/* SplitGo upsell — the trojan horse moment */}
          <Animated.View style={{ opacity: fade, transform: [{ translateY: cardSlide }] }}>
            <TouchableOpacity activeOpacity={0.85} onPress={handleSplit} style={styles.splitCard}>
              <View style={styles.splitIconWrap}>
                <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <Circle cx="6"  cy="6"  r="2.4" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="18" cy="6"  r="2.4" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="6"  cy="18" r="2.4" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="18" cy="18" r="2.4" stroke="#fff" strokeWidth="1.8" />
                  <Path d="M6 8.4v7.2M18 8.4v7.2M8.4 6h7.2M8.4 18h7.2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2" />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.splitTitleRow}>
                  <Text style={styles.splitTitle}>Split with friends</Text>
                  <View style={styles.splitBadge}>
                    <Text style={styles.splitBadgeText}>NEW</Text>
                  </View>
                </View>
                <Text style={styles.splitSub}>Scan the receipt · settle in-wallet in seconds</Text>
              </View>
              <View style={styles.splitChevron}>
                <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <Path d="M5 2l5 5-5 5" stroke={SG.primary} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Bottom toolbar — TNG style (star · share · primary Done) */}
        <View style={styles.bottomBar}>
          <View style={styles.bottomRow}>
            <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
              <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 3.6l2.59 5.25 5.79.84-4.19 4.08.99 5.77L12 16.82 6.82 19.54l.99-5.77L3.62 9.69l5.79-.84L12 3.6z"
                  stroke={SG.primary} strokeWidth="1.8" strokeLinejoin="round"
                />
              </Svg>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
              <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <Circle cx="6"  cy="12" r="2.4" stroke={SG.primary} strokeWidth="1.8" />
                <Circle cx="17" cy="6"  r="2.4" stroke={SG.primary} strokeWidth="1.8" />
                <Circle cx="17" cy="18" r="2.4" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M8 11l7-4M8 13l7 4" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleDone} activeOpacity={0.9}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },

  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
  },

  checkWrap: { alignItems: 'center', marginTop: 24, marginBottom: 18 },
  checkCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#22C55E',
    alignItems: 'center', justifyContent: 'center',
  },

  amount: {
    textAlign: 'center',
    color: '#0B0B0F',
    letterSpacing: -0.5,
  },
  amountCurrency: { fontSize: 26, fontWeight: '500' },
  amountValue:    { fontSize: 32, fontWeight: '800' },

  transferred: {
    marginTop: 4,
    fontSize: 13,
    color: '#9AA0A6',
    textAlign: 'center',
  },

  rows: {
    marginTop: 36,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 15,
    color: '#9AA0A6',
    fontWeight: '400',
  },
  rowValue: {
    fontSize: 15,
    color: '#0B0B0F',
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 16,
  },

  // SplitGo upsell card
  splitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: SG.primarySoft,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#CFE3F4',
  },
  splitIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SG.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  splitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: SG.primaryDeep,
    letterSpacing: -0.2,
  },
  splitBadge: {
    backgroundColor: SG.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  splitBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.6,
  },
  splitSub: {
    fontSize: 12,
    color: SG.muted,
    marginTop: 2,
  },
  splitChevron: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },

  // Bottom toolbar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECEEF2',
    backgroundColor: '#FFFFFF',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.4, borderColor: SG.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: SG.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
