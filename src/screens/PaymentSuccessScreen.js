import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';

/**
 * PaymentSuccessScreen — minimal "you just paid the merchant" confirmation.
 *
 * Demo-only: we skip the actual QR-scan step and jump straight here so the
 * judges can see how naturally the merchant-pay flow leads into "Split with
 * friends". This is the moment that visualises TNG capturing the merchant
 * payment first (and therefore the MDR), then SplitGo handling reimbursement.
 */
export default function PaymentSuccessScreen({ navigation }) {
  const { refreshMe } = useAuth();

  // Animate the check in so the success moment actually feels like
  // a moment, not a static page.
  const scale   = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  // Refresh wallet balance so the deduction is live the moment the user
  // returns to Home.
  useEffect(() => { refreshMe?.(); }, [refreshMe]);

  const handleSplit = () => navigation.replace('Scan');
  const handleDone  = () => navigation.popToTop();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.success} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.body}>
          {/* Big animated check */}
          <Animated.View style={[styles.checkWrap, { transform: [{ scale }] }]}>
            <View style={styles.checkOuter}>
              <View style={styles.checkInner}>
                <Svg width="44" height="44" viewBox="0 0 36 36" fill="none">
                  <Path d="M9 18l6 6 12-13" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </View>
          </Animated.View>

          <Animated.Text style={[styles.title, { opacity }]}>
            Payment Successful
          </Animated.Text>

          <Animated.Text style={[styles.merchantLabel, { opacity }]}>
            Paid to <Text style={styles.merchantBold}>Restaurant XXX</Text>
          </Animated.Text>

          <Animated.Text style={[styles.amount, { opacity }]}>
            RM XX
          </Animated.Text>

          <View style={{ flex: 1 }} />

          {/* The Trojan-horse CTA — visualises the seamless merchant-pay →
              split-with-friends loop. */}
          <TouchableOpacity style={styles.splitCta} onPress={handleSplit} activeOpacity={0.9}>
            <LinearGradient
              colors={[SG.primary, SG.primaryDeep]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.splitCtaInner}
            >
              <View style={styles.splitIcon}>
                <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <Circle cx="6" cy="6" r="2.5" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="18" cy="6" r="2.5" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="6" cy="18" r="2.5" stroke="#fff" strokeWidth="1.8" />
                  <Circle cx="18" cy="18" r="2.5" stroke="#fff" strokeWidth="1.8" />
                  <Path d="M6 8.5v7M18 8.5v7M8.5 6h7M8.5 18h7" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2" />
                </Svg>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.splitCtaTitle}>Split this bill with friends</Text>
                <Text style={styles.splitCtaSub}>Scan the receipt · settle in-wallet</Text>
              </View>
              <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <Path d="M5 2l5 5-5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.7}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.success },

  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
    alignItems: 'center',
  },

  checkWrap: { marginTop: 24, marginBottom: 28 },
  checkOuter: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkInner: {
    width: 82, height: 82, borderRadius: 41,
    backgroundColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },

  title: {
    fontSize: 22, fontWeight: '800', color: '#fff',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  merchantLabel: {
    marginTop: 10,
    fontSize: 14, color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  merchantBold: { color: '#fff', fontWeight: '700' },

  amount: {
    marginTop: 22,
    fontSize: 44, fontWeight: '800', color: '#fff',
    letterSpacing: -1.2,
    textAlign: 'center',
  },

  splitCta: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  splitCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  splitIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  splitCtaTitle: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  splitCtaSub: { fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  doneBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 28, paddingVertical: 10,
    borderRadius: 999,
  },
  doneBtnText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
});
