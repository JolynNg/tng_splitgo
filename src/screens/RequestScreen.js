import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import ScreenHeader from '../components/ScreenHeader';
import Avatar from '../components/Avatar';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';

export default function RequestScreen({ navigation }) {
  const { participants, perPersonTotals } = useFlow();
  const others = participants.filter(p => !p.me);

  const [statuses, setStatuses] = useState(
    Object.fromEntries(others.map((p, i) => [p.name, i < 2 ? 'paid' : 'pending']))
  );
  const [nudged, setNudged] = useState({});

  // Auto-progress one pending person after delay for demo
  useEffect(() => {
    const pending = others.filter(p => statuses[p.name] === 'pending');
    if (pending.length === 0) return;
    const t = setTimeout(() => {
      setStatuses(s => ({ ...s, [pending[0].name]: 'paid' }));
    }, 3500);
    return () => clearTimeout(t);
  }, [statuses]);

  const nudge = (name) => {
    setNudged(n => ({ ...n, [name]: true }));
    setTimeout(() => setNudged(n => ({ ...n, [name]: false })), 2200);
  };

  const paidCount = others.filter(p => statuses[p.name] === 'paid').length;
  const totalOwed = others.reduce((s, p) => s + (perPersonTotals[p.name] || 0), 0);
  const collected = others.reduce((s, p) => s + (statuses[p.name] === 'paid' ? (perPersonTotals[p.name] || 0) : 0), 0);
  const progress = totalOwed > 0 ? collected / totalOwed : 0;
  const allPaid = paidCount === others.length;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title="Payment requests"
          subtitle={allPaid ? 'Everyone paid ✓' : `${paidCount} of ${others.length} paid`}
          onBack={() => navigation.goBack()}
        />
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Progress hero */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.collectedLabel}>COLLECTED</Text>
              <Text style={styles.collectedAmt}>RM {collected.toFixed(2)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.ofAmt}>of RM {totalOwed.toFixed(2)}</Text>
              <Text style={styles.pctAmt}>{Math.round(progress * 100)}%</Text>
            </View>
          </View>
          <View style={styles.progressBar}>
            <LinearGradient
              colors={[SG.primary, SG.accent]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${progress * 100}%` }]}
            />
          </View>
          <View style={styles.sentInfo}>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Path d="M7 2l1.5 3.5L12 6l-2.5 2.5.5 3.5L7 10l-3 1.5.5-3.5L2 6l3.5-.5L7 2z" fill={SG.primary} />
            </Svg>
            <Text style={styles.sentText}>Requests sent · instant notification</Text>
          </View>
        </View>

        {/* People list */}
        <View style={styles.listCard}>
          {others.map((p, i) => {
            const amt = perPersonTotals[p.name] || 0;
            const st = statuses[p.name];
            return (
              <View key={p.name} style={[styles.personRow, i < others.length - 1 && styles.personBorder]}>
                <View style={{ position: 'relative' }}>
                  <Avatar name={p.name} color={p.color} size={42} />
                  {st === 'paid' && <View style={styles.paidDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.personName}>{p.name}</Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, { backgroundColor: st === 'paid' ? SG.success : SG.accent }]} />
                    <Text style={[styles.statusText, { color: st === 'paid' ? SG.success : SG.accentDeep }]}>
                      {st === 'paid' ? 'Paid' : nudged[p.name] ? 'Nudged ✓' : 'Pending'}
                    </Text>
                    <Text style={styles.statusTime}>· {st === 'paid' ? 'just now' : 'sent 2 min ago'}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.personAmt}>RM {amt.toFixed(2)}</Text>
                  {st === 'pending' ? (
                    <TouchableOpacity
                      onPress={() => nudge(p.name)}
                      disabled={!!nudged[p.name]}
                      style={[styles.nudgeBtn, nudged[p.name] && styles.nudgeBtnSent]}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.nudgeText, nudged[p.name] && styles.nudgeTextSent]}>
                        {nudged[p.name] ? 'SENT' : 'NUDGE'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.viaText}>via SplitGo</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.helperText}>You'll get a notification when each person pays.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {allPaid ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Settled')}
            style={styles.primaryBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>View settlement</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.closeBtn} activeOpacity={0.8}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('Settled')}
              style={styles.skipBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.skipBtnText}>Skip to settled (demo)</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 120 },
  progressCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  collectedLabel: { fontSize: 11, color: SG.muted, fontWeight: '600', letterSpacing: 0.3 },
  collectedAmt: { fontSize: 26, fontWeight: '700', color: SG.ink, letterSpacing: -0.6, marginTop: 2 },
  ofAmt: { fontSize: 11, color: SG.muted },
  pctAmt: { fontSize: 12, color: SG.success, fontWeight: '700', marginTop: 2 },
  progressBar: { height: 8, backgroundColor: SG.bg, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  sentInfo: {
    flexDirection: 'row', gap: 6, marginTop: 12, padding: 8, borderRadius: 10,
    backgroundColor: SG.primarySoft, alignItems: 'center',
  },
  sentText: { fontSize: 11, color: SG.primaryInk },
  listCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  personRow: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personBorder: { borderBottomWidth: 1, borderBottomColor: SG.line2 },
  paidDot: {
    position: 'absolute', bottom: -2, right: -2, width: 14, height: 14,
    borderRadius: 7, backgroundColor: SG.success, borderWidth: 2, borderColor: '#fff',
  },
  personName: { fontSize: 14, fontWeight: '600', color: SG.ink, letterSpacing: -0.1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusTime: { fontSize: 11, color: SG.muted },
  personAmt: { fontSize: 14, fontWeight: '700', color: SG.ink },
  nudgeBtn: {
    marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: SG.accentSoft,
  },
  nudgeBtnSent: { backgroundColor: SG.successSoft },
  nudgeText: { fontSize: 10, fontWeight: '700', color: SG.accentDeep, letterSpacing: 0.3 },
  nudgeTextSent: { color: SG.success },
  viaText: { marginTop: 4, fontSize: 10, color: SG.success, fontWeight: '600' },
  helperText: { marginTop: 14, textAlign: 'center', fontSize: 11, color: SG.muted, padding: 12 },
  footer: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: SG.line2,
  },
  primaryBtn: {
    height: 54, borderRadius: 999, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  footerRow: { flexDirection: 'row', gap: 10 },
  closeBtn: {
    flex: 1, height: 54, borderRadius: 999,
    borderWidth: 1, borderColor: SG.line,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontWeight: '600', fontSize: 14, color: SG.ink },
  skipBtn: {
    flex: 2, height: 54, borderRadius: 999, backgroundColor: SG.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  skipBtnText: { fontWeight: '600', fontSize: 14, color: '#1a1205' },
});
