import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import BottomNav from '../components/BottomNav';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';

function TopAction({ label, children }) {
  return (
    <TouchableOpacity style={styles.topAction} activeOpacity={0.7}>
      <View style={styles.topActionIcon}>{children}</View>
      <Text style={styles.topActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function Tile({ label, badge, onPress, children }) {
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.tileIcon}>
        {children}
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const { me, signOut, refreshMe } = useAuth();

  // Pull the latest wallet balance every time the home screen comes back into
  // view, so the headline number reflects payments made/received in SplitGo.
  React.useEffect(() => {
    refreshMe?.();
    const id = setInterval(() => refreshMe?.(), 5000);
    return () => clearInterval(id);
  }, [refreshMe]);

  const balance = typeof me?.balance === 'number' ? me.balance : 1000;
  const balanceText = `RM ${balance.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Tap the avatar to log out — confirms first so we don't sign people out
  // by accident when they meant to scroll up. The avatar shows the first
  // letter of the signed-in user's name as a quick visual identity hint.
  const handleProfilePress = () => {
    Alert.alert(
      `Signed in as ${me?.name || 'this device'}`,
      'Sign out and return to the login screen?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut },
      ],
    );
  };

  const initial = (me?.name || '?').trim()[0]?.toUpperCase() || '?';

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.primary} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: SG.primary }}>
        {/* Blue header */}
        <View style={[styles.header, { backgroundColor: SG.primary }]}>
          {/* Search row */}
          <View style={styles.searchRow}>
            <View style={styles.countryPill}>
              <Text style={styles.countryText}>🇲🇾 MY</Text>
              <Svg width="8" height="8" viewBox="0 0 8 8"><Path d="M1 3l3 3 3-3" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" /></Svg>
            </View>
            <View style={styles.searchBar}>
              <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <Circle cx="6" cy="6" r="4" stroke={SG.muted} strokeWidth="1.5" />
                <Path d="M9 9l3 3" stroke={SG.muted} strokeWidth="1.5" strokeLinecap="round" />
              </Svg>
              <Text style={styles.searchText}>Search</Text>
            </View>
            <TouchableOpacity
              style={styles.avatarBtn}
              activeOpacity={0.75}
              onPress={handleProfilePress}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Profile · tap to sign out"
            >
              <Text style={styles.avatarInitial}>{initial}</Text>
              <View style={styles.avatarDot} />
            </TouchableOpacity>
          </View>

          {/* Balance */}
          <View style={styles.balanceRow}>
            <Svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <Path d="M9 1l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V4l7-3z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.18)" />
              <Path d="M6 9l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={styles.balance}>{balanceText}</Text>
            <Svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ opacity: 0.9 }}>
              <Path d="M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" stroke="#fff" strokeWidth="1.4" />
              <Circle cx="9" cy="9" r="2.5" fill="#fff" />
            </Svg>
          </View>
          <View style={styles.viewDetails}>
            <Text style={styles.viewDetailsText}>View asset details</Text>
            <Svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <Path d="M3 2l3 3-3 3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>

          {/* Pill buttons */}
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.addMoneyPill} activeOpacity={0.8}>
              <Text style={styles.addMoneyText}>+ Add money</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.txBtn} activeOpacity={0.8}>
              <Text style={styles.txText}>Transactions</Text>
              <Svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <Path d="M4 2l4 4-4 4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Quick actions card */}
        <View style={styles.qaCard}>
          <View style={styles.qaInner}>
            <TopAction label="Apply">
              <Svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <Rect x="5" y="4" width="14" height="18" rx="2" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M8 9h7M8 13h5" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
                <Circle cx="19" cy="17" r="4" fill="#fff" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M17 17l1.5 1.5L21 16" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TopAction>
            <TopAction label="Cash flow">
              <Svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <Circle cx="13" cy="13" r="9" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M13 4v9h9" stroke={SG.primary} strokeWidth="1.8" strokeLinejoin="round" />
              </Svg>
            </TopAction>
            <TopAction label="Transfer">
              <Svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <Path d="M4 6l18-2-8 19-3-8-7-3z" stroke={SG.primary} strokeWidth="1.8" strokeLinejoin="round" />
              </Svg>
            </TopAction>
            <TopAction label="Cards">
              <Svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <Rect x="3" y="7" width="20" height="13" rx="2" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M3 11h20M7 16h4" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
              </Svg>
            </TopAction>
          </View>
        </View>

        {/* Info grid */}
        <View style={styles.infoGrid}>
          <View style={[styles.infoCard, { backgroundColor: SG.primarySoft }]}>
            <View style={styles.infoIcon}>
              <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <Path d="M10 16V8M6 12l4-4 4 4" stroke={SG.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <Circle cx="10" cy="10" r="8" stroke={SG.primary} strokeWidth="1.4" opacity="0.3" />
              </Svg>
            </View>
            <View>
              <Text style={styles.infoTitle}>Grow your money</Text>
              <Text style={styles.infoSub}>Start with just RM10</Text>
            </View>
          </View>
          <View style={[styles.infoCard, { backgroundColor: SG.primarySoft }]}>
            <View style={[styles.infoIcon, { backgroundColor: SG.accent }]}>
              <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <Rect x="3" y="8" width="14" height="3" fill="#fff" />
                <Rect x="4" y="11" width="12" height="7" fill="#fff" opacity="0.8" />
                <Path d="M10 8v10M6 5c0-1 1-2 2-2s2 2 2 3M14 5c0-1-1-2-2-2s-2 2-2 3" stroke="#fff" strokeWidth="1.4" />
              </Svg>
            </View>
            <View>
              <Text style={styles.infoTitle}>eRewards</Text>
              <Text style={[styles.infoSub, { color: SG.primary, fontWeight: '700' }]}>25,000 pts</Text>
            </View>
          </View>
          <View style={[styles.infoCard, { backgroundColor: SG.primarySoft }]}>
            <View style={styles.infoIcon}>
              <Svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <Rect x="4" y="3" width="9" height="12" rx="1" stroke={SG.primary} strokeWidth="1.6" />
                <Circle cx="15" cy="14" r="4" fill={SG.accent} />
                <Path d="M15 12v4M13 14h4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
              </Svg>
            </View>
            <View>
              <Text style={styles.infoTitle}>SplitGo AI</Text>
              <Text style={styles.infoSub}>Snap. Split. Settle.</Text>
            </View>
          </View>
          <View style={[styles.infoCard, { backgroundColor: SG.primarySoft }]}>
            <View style={styles.infoIcon}>
              <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <Path d="M5 2h10v16l-2-1-2 1-2-1-2 1-2-1V2z" stroke={SG.primary} strokeWidth="1.6" />
                <Path d="M7 6h6M7 9h6M7 12h4" stroke={SG.primary} strokeWidth="1.4" strokeLinecap="round" />
              </Svg>
            </View>
            <View>
              <Text style={styles.infoTitle}>Pay bills</Text>
              <Text style={styles.infoSub}>One tap, no fuss</Text>
            </View>
          </View>
        </View>

        {/* Promo banner */}
        <View style={styles.bannerWrap}>
          <LinearGradient
            colors={[SG.accentSoft, '#FFF7E6', `${SG.accent}44`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.banner}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Thank you for using</Text>
              <Text style={styles.bannerTitle}>our eWallet</Text>
              <Text style={styles.bannerSub}>Rewards curated just for you</Text>
            </View>
            <View style={styles.bannerIcon}>
              <Svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <Rect x="4" y="10" width="26" height="20" rx="2" fill="#fff" />
                <Rect x="4" y="10" width="26" height="4" fill={SG.primary} />
                <Path d="M17 4s-4 3-4 6h8c0-3-4-6-4-6z" fill={SG.primary} />
              </Svg>
            </View>
          </LinearGradient>
          <View style={styles.dots}>
            <View style={[styles.dot, { width: 14, backgroundColor: SG.primary }]} />
            <View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} />
          </View>
        </View>

        {/* Recommended */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommended</Text>
          <View style={styles.tileRow}>
            <Tile label="SplitGo" badge="NEW" onPress={() => navigation.navigate('SplitGoHome')}>
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="7" y="5" width="18" height="24" rx="2" fill="#fff" stroke={SG.primary} strokeWidth="1.8" />
                <Path d="M11 11h10M11 15h10M11 19h7" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
                <Circle cx="28" cy="28" r="8" fill={SG.accent} stroke="#fff" strokeWidth="2" />
                <Path d="M28 24v8M24 28h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
              </Svg>
            </Tile>
            <Tile label="Travel">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Path d="M6 28h28" stroke={SG.accent} strokeWidth="2" strokeLinecap="round" />
                <Path d="M14 28c0-6 3-12 6-12s6 6 6 12" stroke={SG.primary} strokeWidth="1.8" fill="#fff" />
              </Svg>
            </Tile>
            <Tile label="Bills">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Path d="M12 6h16v28l-3-2-3 2-3-2-3 2-4-2V6z" stroke={SG.primary} strokeWidth="1.8" fill="#fff" />
                <Path d="M16 12h8M16 17h8M16 22h5" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
              </Svg>
            </Tile>
            <Tile label="Invest">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Path d="M6 32h28" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" />
                <Rect x="9" y="22" width="5" height="10" fill={SG.primary} opacity="0.6" />
                <Rect x="17" y="16" width="5" height="16" fill={SG.primary} />
                <Rect x="25" y="10" width="5" height="22" fill={SG.accent} />
              </Svg>
            </Tile>
          </View>
        </View>

        {/* Favourites */}
        <View style={[styles.section, { paddingBottom: 100 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Favourites</Text>
            <Text style={styles.editLink}>Edit</Text>
          </View>
          <View style={styles.tileRow}>
            <Tile label="Parking">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="8" y="8" width="24" height="24" rx="4" fill={SG.primary} />
                <Path d="M16 14h8a3 3 0 010 6h-5v6h-3V14z" fill="#fff" />
              </Svg>
            </Tile>
            <Tile label="Prepaid">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="10" y="6" width="20" height="28" rx="3" stroke={SG.primary} strokeWidth="1.8" fill="#fff" />
                <Circle cx="20" cy="20" r="4" stroke={SG.primary} strokeWidth="1.6" />
              </Svg>
            </Tile>
            <Tile label="Rewards">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="8" y="14" width="24" height="20" rx="2" fill={SG.accent} />
                <Path d="M8 14h24v5H8z" fill="#fff" opacity="0.3" />
                <Path d="M20 14v20" stroke="#fff" strokeWidth="1.5" />
              </Svg>
            </Tile>
            <Tile label="More">
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="8" y="8" width="24" height="24" rx="12" stroke={SG.primary} strokeWidth="1.8" fill="#fff" />
                <Circle cx="14" cy="20" r="1.8" fill={SG.primary} />
                <Circle cx="20" cy="20" r="1.8" fill={SG.primary} />
                <Circle cx="26" cy="20" r="1.8" fill={SG.primary} />
              </Svg>
            </Tile>
          </View>
        </View>
      </ScrollView>

      <BottomNav active="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  header: { paddingHorizontal: 16, paddingBottom: 15 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4, paddingBottom: 14 },
  countryPill: {
    height: 36, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  countryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  searchBar: {
    flex: 1, height: 36, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.95)',
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14,
  },
  searchText: { fontSize: 13, color: SG.muted },
  avatarBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: -0.3 },
  avatarDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: SG.accent, borderWidth: 1.5, borderColor: SG.primary,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  balance: { color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  viewDetails: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  viewDetailsText: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  pillRow: { flexDirection: 'row', gap: 14, marginTop: 14, alignItems: 'center' },
  addMoneyPill: {
    height: 34, paddingHorizontal: 16, borderRadius: 999,
    borderWidth: 1.2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  addMoneyText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  txBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  txText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  scroll: { flex: 1 },
  qaCard: { paddingHorizontal: 12, marginTop: 12, zIndex: 2 },
  qaInner: {
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4,
    flexDirection: 'row',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  topAction: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 8,
  },
  topActionIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  topActionLabel: { fontSize: 12, fontWeight: '500', color: SG.ink2 },
  infoGrid: {
    paddingHorizontal: 12, paddingTop: 14,
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  infoCard: {
    width: '47.5%', borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  infoIcon: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  infoTitle: { fontSize: 12, fontWeight: '700', color: SG.ink },
  infoSub: { fontSize: 10, color: SG.muted, marginTop: 2 },
  bannerWrap: { padding: 12, paddingBottom: 0 },
  banner: {
    borderRadius: 12, padding: 14, minHeight: 74,
    flexDirection: 'row', alignItems: 'center',
  },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: SG.primary, letterSpacing: -0.2 },
  bannerSub: { fontSize: 11, color: SG.primaryInk, marginTop: 3, opacity: 0.8 },
  bannerIcon: {
    width: 58, height: 58, borderRadius: 8, backgroundColor: SG.accent,
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 6 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: SG.muted2, opacity: 0.5 },
  section: { paddingHorizontal: 16, paddingTop: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: SG.ink, letterSpacing: -0.2, marginBottom: 10 },
  editLink: { fontSize: 12, color: SG.primary, fontWeight: '700' },
  tileRow: { flexDirection: 'row', gap: 4 },
  tile: { flex: 1, alignItems: 'center', gap: 6 },
  tileIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 11, color: SG.ink2, textAlign: 'center' },
  badge: {
    position: 'absolute', top: -6, right: -10,
    backgroundColor: '#E74C3C', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.3 },
});
