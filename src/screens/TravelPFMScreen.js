import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import TngAvatar from '../components/TngAvatar';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';
import { getTripInsights } from '../api/billService';

const DASH_REGEX = /[-\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

const CATEGORY_COLORS = {
  food: '#2563EB',
  fashion: '#A855F7',
  amusement: '#F59E0B',
  transport: '#06B6D4',
  shopping: '#0EA5A4',
  lodging: '#4F46E5',
  cosmetics: '#EC4899',
  other: '#64748B',
};

const CATEGORY_LABELS = {
  food: 'Food',
  fashion: 'Fashion',
  amusement: 'Amusement',
  transport: 'Transport',
  shopping: 'Shopping',
  lodging: 'Lodging',
  cosmetics: 'Cosmetics',
  other: 'Other',
};

// Keep quick-summary cards in primary blue + white only.
const TONES = {
  good: { bg: '#FFFFFF', accent: '#0A5BFF', ink: '#0A2A73' },
  warn: { bg: '#FFFFFF', accent: '#0A5BFF', ink: '#0A2A73' },
  info: { bg: '#FFFFFF', accent: '#0A5BFF', ink: '#0A2A73' },
  tip: { bg: '#FFFFFF', accent: '#0A5BFF', ink: '#0A2A73' },
  soft: { bg: '#FFFFFF', accent: '#0A5BFF', ink: '#0A2A73' },
};

function InsightIcon({ name, color }) {
  switch (name) {
    case 'up':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M5 15l7-7 7 7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'down':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M5 9l7 7 7-7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'balance':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M4 9h16M4 15h16" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
        </Svg>
      );
    case 'trophy':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M7 4h10v3a5 5 0 01-10 0V4z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <Path d="M5 6H3v2a3 3 0 003 3M19 6h2v2a3 3 0 01-3 3M9 18h6M12 14v4" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </Svg>
      );
    case 'pie':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M12 3a9 9 0 109 9h-9V3z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        </Svg>
      );
    case 'bulb':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M9 17h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'people':
      return (
        <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <Path d="M8 11a3 3 0 100-6 3 3 0 000 6zM16 13a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2.5 19c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5M14 19c.5-2 2-3.2 4-3.2s3.5 1.2 4 3.2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    default:
      return null;
  }
}

// Simple summary card: one short headline + one clear line.
function NudgeCard({ tone = 'info', icon, metric, label }) {
  const p = TONES[tone] || TONES.info;
  return (
    <View style={[styles.nudgeCard, { backgroundColor: p.bg }]}>
      <View style={[styles.nudgeIconWrap, { backgroundColor: p.accent + '1A' }]}>
        <InsightIcon name={icon} color={p.accent} />
      </View>
      <View style={styles.nudgeTextWrap}>
        <Text style={styles.nudgeMetric}>{metric}</Text>
        <Text style={styles.nudgeLabel}>{label}</Text>
      </View>
    </View>
  );
}

function PercentageRingAvatar({ percent = 0 }) {
  const size = 80;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const arc = (clamped / 100) * circ;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#DBEAFE" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={SG.primary} strokeWidth={stroke}
          strokeDasharray={`${arc} ${circ - arc}`}
          strokeLinecap="round" fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <TngAvatar size={52} />
    </View>
  );
}

export default function TravelPFMScreen({ navigation, route }) {
  const { me } = useAuth();
  const travelGroupId = route.params?.travelGroupId;
  const travelGroupName = route.params?.travelGroupName || 'Trip';
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!travelGroupId || !me?.name) {
        if (alive) { setError('Missing trip id or user.'); setLoading(false); }
        return;
      }
      setLoading(true);
      try {
        const res = await getTripInsights({ travelGroupId, user: me.name });
        if (alive) { setInsights(res); setError(null); }
      } catch (e) {
        if (alive) setError(e?.message || 'Could not load insights.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [travelGroupId, me?.name]);

  const participants = useMemo(() => {
    const arr = Array.isArray(insights?.perPersonSpend) ? insights.perPersonSpend : [];
    const total = arr.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return arr.map((p) => ({ ...p, percent: total > 0 ? ((Number(p.amount) || 0) / total) * 100 : 0 }));
  }, [insights]);

  const categories = Array.isArray(insights?.categoryBreakdown) ? insights.categoryBreakdown : [];
  const categoryTotal = categories.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const adviceLines = String(insights?.advice || '')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  function stripHyphen(text) {
    return String(text || '')
      .replace(DASH_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Build very simple summary cards so users can understand instantly.
  const nudges = useMemo(() => {
    const out = [];
    const my = Number(insights?.mySpend || 0);
    const avg = Number(insights?.groupAverage || 0);
    const cats = Array.isArray(insights?.categoryBreakdown) ? insights.categoryBreakdown : [];
    const topCat = cats[0] || null;
    const catTotal = cats.reduce((s, c) => s + (Number(c.amount) || 0), 0);

    if (avg > 0 && Number.isFinite(my)) {
      const delta = my - avg;
      if (delta > 20) {
        out.push({ tone: 'warn', icon: 'up', metric: 'Higher spending', label: 'You are spending more than your group average.' });
      } else if (delta < -20) {
        out.push({ tone: 'good', icon: 'down', metric: 'Lower spending', label: 'You are spending less than your group average.' });
      } else {
        out.push({ tone: 'info', icon: 'balance', metric: 'On track', label: 'Your spending is close to the group average.' });
      }
    }

    if (topCat && catTotal > 0) {
      const catName = (CATEGORY_LABELS[topCat.category] || topCat.category).toLowerCase();
      out.push({
        tone: 'info',
        icon: 'pie',
        metric: `Mostly ${catName}`,
        label: 'Most of this trip spending is in this category.',
      });
    }

    const tip = stripHyphen(adviceLines[0]);
    if (tip) {
      out.push({ tone: 'tip', icon: 'bulb', metric: 'One tip', label: tip });
    }

    return out.slice(0, 3);
  }, [insights, adviceLines]);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Trip Insights</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{travelGroupName}</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <ActivityIndicator color={SG.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Could not load insights</Text>
            <Text style={styles.errorMsg}>{error}</Text>
          </View>
        ) : (
          <>
            {/* Hero summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Trip Spend</Text>
              <Text style={styles.summaryAmt}>RM {Number(insights?.totalTripSpend || 0).toFixed(2)}</Text>
              <View style={styles.summaryChips}>
                <View style={styles.chip}>
                  <Text style={styles.chipLabel}>You</Text>
                  <Text style={styles.chipValue}>RM {Number(insights?.mySpend || 0).toFixed(2)}</Text>
                </View>
                <View style={[styles.chip, styles.chipMuted]}>
                  <Text style={styles.chipLabel}>Avg</Text>
                  <Text style={styles.chipValueMuted}>RM {Number(insights?.groupAverage || 0).toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {/* Participants */}
            <Text style={styles.sectionTitle}>Participants</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
              {participants.map((p) => (
                <View key={p.name} style={styles.personCard}>
                  <PercentageRingAvatar percent={p.percent} />
                  <Text style={styles.personName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.personAmt}>RM {Number(p.amount || 0).toFixed(2)}</Text>
                  <Text style={styles.personPct}>{p.percent.toFixed(1)}%</Text>
                </View>
              ))}
            </ScrollView>

            {/* Category breakdown with progress bars */}
            <Text style={styles.sectionTitle}>Spending breakdown</Text>
            <View style={styles.catList}>
              {categories.map((c) => {
                const pct = categoryTotal > 0 ? ((Number(c.amount) || 0) / categoryTotal) * 100 : 0;
                const color = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.other;
                return (
                  <View key={c.category} style={styles.catCard}>
                    <View style={styles.catCardTop}>
                      <View style={styles.catLeft}>
                        <View style={[styles.catDot, { backgroundColor: color }]} />
                        <Text style={styles.catName}>{CATEGORY_LABELS[c.category] || c.category}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 8, alignSelf: 'center' }}>
                        <Text style={styles.catPct}>{pct.toFixed(0)}%</Text>
                        <Text style={styles.catAmt}>RM {Number(c.amount || 0).toFixed(2)}</Text>
                      </View>
                    </View>
                    <View style={styles.catTrack}>
                      <View style={[styles.catFill, { width: `${pct}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Quick summary cards */}
            <Text style={styles.sectionTitle}>Quick summary</Text>
            {nudges.length === 0 ? (
              <View style={styles.nudgeEmpty}>
                <Text style={styles.nudgeEmptyTitle}>No insights yet</Text>
                <Text style={styles.nudgeEmptyBody}>Add receipts and we'll surface tips here.</Text>
              </View>
            ) : (
              <View style={styles.nudgeCol}>
                {nudges.map((n, i) => (
                  <NudgeCard key={i} tone={n.tone} icon={n.icon} metric={n.metric} label={n.label} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  headerSafe: { backgroundColor: SG.primary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 2 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Hero summary
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: SG.line2,
  },
  summaryLabel: { fontSize: 11, color: SG.muted, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  summaryAmt: { fontSize: 34, color: SG.primary, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 },
  summaryChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: {
    flexDirection: 'row', gap: 5, alignItems: 'center',
    backgroundColor: SG.primarySoft, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  chipMuted: { backgroundColor: SG.line2 },
  chipLabel: { fontSize: 11, color: SG.muted, fontWeight: '700' },
  chipValue: { fontSize: 12, color: SG.primary, fontWeight: '800' },
  chipValueMuted: { fontSize: 12, color: SG.ink2, fontWeight: '800' },

  sectionTitle: {
    fontSize: 11,
    color: '#2457C5',
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Participants
  carousel: { paddingRight: 16, gap: 10 },
  personCard: {
    width: 126, backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: SG.line2,
  },
  personName: { marginTop: 8, fontSize: 12, fontWeight: '800', color: SG.ink },
  personAmt: { marginTop: 3, fontSize: 12, color: SG.primary, fontWeight: '800' },
  personPct: { marginTop: 1, fontSize: 11, color: SG.muted },

  // Category breakdown
  catList: { gap: 8 },
  catCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: SG.line2,
  },
  catCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  catLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catDot: { width: 9, height: 9, borderRadius: 5 },
  catName: { fontSize: 13, color: SG.ink, fontWeight: '700' },
  catAmt: { fontSize: 13, color: SG.ink2, fontWeight: '700' },
  catPct: { fontSize: 12, color: SG.muted, fontWeight: '600' },
  catTrack: { height: 5, backgroundColor: SG.line2, borderRadius: 3, overflow: 'hidden' },
  catFill: { height: 5, borderRadius: 3 },

  // Nudge cards (single card per row)
  nudgeCol: { gap: 10 },
  nudgeCard: {
    width: '100%', borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: '#DDE9FF',
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  nudgeIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  nudgeTextWrap: { flex: 1 },
  nudgeMetric: { fontSize: 17, fontWeight: '900', lineHeight: 22, letterSpacing: -0.2, color: SG.primary },
  nudgeLabel: { marginTop: 2, fontSize: 12, fontWeight: '700', lineHeight: 17, color: '#111111' },

  nudgeEmpty: {
    backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: SG.line2,
  },
  nudgeEmptyTitle: { fontSize: 14, fontWeight: '800', color: SG.ink },
  nudgeEmptyBody: { marginTop: 4, fontSize: 12, color: SG.muted, lineHeight: 18 },

  errorCard: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 12, padding: 12 },
  errorTitle: { color: '#991B1B', fontWeight: '800', fontSize: 13 },
  errorMsg: { color: '#991B1B', fontSize: 12, marginTop: 4, lineHeight: 18 },
});
