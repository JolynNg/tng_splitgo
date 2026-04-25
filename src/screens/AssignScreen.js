import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import ScreenHeader from '../components/ScreenHeader';
import PillBtn from '../components/PillBtn';
import TngAvatar from '../components/TngAvatar';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';

export default function AssignScreen({ navigation }) {
  const { items, participants, assignments, setAssignments } = useFlow();
  const [focused, setFocused] = useState(items[0]?.id ?? 1);

  const toggleShared = (itemId) => {
    const a = assignments[itemId] || { shared: false, people: [] };
    setAssignments({
      ...assignments,
      [itemId]: { shared: !a.shared, people: !a.shared ? participants.map(p => p.name) : [] },
    });
  };

  const togglePerson = (itemId, name) => {
    const a = assignments[itemId] || { shared: false, people: [] };
    const exists = a.people.includes(name);
    setAssignments({
      ...assignments,
      [itemId]: { shared: false, people: exists ? a.people.filter(n => n !== name) : [...a.people, name] },
    });
  };

  const perPerson = {};
  participants.forEach(p => { perPerson[p.name] = 0; });
  items.forEach(it => {
    const a = assignments[it.id];
    if (!a || a.people.length === 0) return;
    const share = (it.qty * it.unit) / a.people.length;
    a.people.forEach(n => { if (perPerson[n] !== undefined) perPerson[n] += share; });
  });

  const unassigned = items.filter(it => !assignments[it.id] || assignments[it.id].people.length === 0).length;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title="Assign items"
          subtitle={unassigned > 0 ? `${unassigned} item${unassigned > 1 ? 's' : ''} unassigned` : 'All items assigned ✓'}
          onBack={() => navigation.goBack()}
        />

        {/* Participant rail */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail} contentContainerStyle={styles.railContent}>
          {participants.map(p => {
            const amt = perPerson[p.name] || 0;
            return (
              <View key={p.name} style={styles.railCard}>
                <TngAvatar size={32} />
                <View>
                  <Text style={styles.railName}>{p.me ? 'You' : p.name.split(' ')[0]}</Text>
                  <Text style={[styles.railAmt, { color: amt > 0 ? SG.primary : SG.muted2 }]}>RM {amt.toFixed(2)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {items.map(it => {
          const a = assignments[it.id] || { shared: false, people: [] };
          const isFocused = focused === it.id;
          const lineTotal = it.qty * it.unit;
          const isAssigned = a.people.length > 0;

          return (
            <TouchableOpacity
              key={it.id}
              onPress={() => setFocused(it.id)}
              activeOpacity={0.8}
              style={[
                styles.itemCard,
                isFocused && styles.itemCardFocused,
              ]}
            >
              <View style={styles.itemTop}>
                <View style={[styles.qtyBadge, { backgroundColor: isAssigned ? SG.successSoft : SG.bg }]}>
                  <Text style={[styles.qtyText, { color: isAssigned ? SG.success : SG.ink2 }]}>{it.qty}×</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <Text style={styles.itemMeta}>
                    RM {lineTotal.toFixed(2)}{a.people.length > 1 ? ` · split ${a.people.length} ways` : ''}
                  </Text>
                </View>
                {!isFocused && isAssigned && (
                  <View style={styles.avatarStack}>
                    {a.people.slice(0, 4).map((n, i) => (
                      <View key={n} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -8 }]}>
                        <TngAvatar size={24} />
                      </View>
                    ))}
                    {a.people.length > 4 && (
                      <View style={[styles.stackMore, { marginLeft: -8 }]}>
                        <Text style={styles.stackMoreText}>+{a.people.length - 4}</Text>
                      </View>
                    )}
                  </View>
                )}
                {!isAssigned && !isFocused && (
                  <View style={styles.unassignedBadge}>
                    <Text style={styles.unassignedText}>UNASSIGNED</Text>
                  </View>
                )}
              </View>

              {isFocused && (
                <View style={{ marginTop: 12 }}>
                  {/* Share equally */}
                  <TouchableOpacity
                    onPress={() => toggleShared(it.id)}
                    style={[styles.shareRow, a.shared && styles.shareRowActive]}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, a.shared && styles.checkboxActive]}>
                      {a.shared && (
                        <Svg width="12" height="12" viewBox="0 0 12 12">
                          <Path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      )}
                    </View>
                    <Text style={styles.shareLabel}>Share equally</Text>
                    <Text style={styles.shareSub}>All {participants.length} people</Text>
                  </TouchableOpacity>

                  <Text style={styles.orText}>OR PICK WHO HAD IT</Text>

                  <View style={styles.personChips}>
                    {participants.map(p => {
                      const on = a.people.includes(p.name);
                      return (
                        <TouchableOpacity
                          key={p.name}
                          onPress={() => togglePerson(it.id, p.name)}
                          style={[styles.chip, on && styles.chipActive]}
                          activeOpacity={0.8}
                        >
                          <TngAvatar size={22} onWhite={!on} />
                          <Text style={[styles.chipText, on && styles.chipTextActive]}>
                            {p.me ? 'You' : p.name.split(' ')[0]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerRow}>
          <Text style={styles.footerLabel}>Running subtotal</Text>
          <Text style={styles.footerAmt}>RM {Object.values(perPerson).reduce((a, b) => a + b, 0).toFixed(2)}</Text>
        </View>
        <PillBtn onPress={() => navigation.navigate('Summary')}>Review split</PillBtn>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  rail: { backgroundColor: '#fff' },
  railContent: { paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', gap: 10 },
  railCard: {
    backgroundColor: SG.bg, borderRadius: 14, padding: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 120,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  railName: { fontSize: 11, fontWeight: '600', color: SG.ink },
  railAmt: { fontSize: 12, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 140 },
  itemCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  itemCardFocused: {
    borderColor: SG.primary,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: 13, fontWeight: '700' },
  itemName: { fontSize: 14, fontWeight: '600', color: SG.ink },
  itemMeta: { fontSize: 11, color: SG.muted, marginTop: 1 },
  avatarStack: { flexDirection: 'row' },
  stackItem: { borderWidth: 2, borderColor: '#fff', borderRadius: 12 },
  stackMore: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: SG.bg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  stackMoreText: { fontSize: 9, fontWeight: '700', color: SG.muted },
  unassignedBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    backgroundColor: SG.accentSoft,
  },
  unassignedText: { color: SG.accentDeep, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  shareRow: {
    padding: 12, borderRadius: 10, backgroundColor: SG.bg,
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  shareRowActive: { backgroundColor: SG.primarySoft, borderColor: SG.primary },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: SG.line,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: SG.primary, borderColor: SG.primary },
  shareLabel: { fontSize: 13, fontWeight: '600', color: SG.ink, flex: 1 },
  shareSub: { fontSize: 11, color: SG.muted },
  orText: { fontSize: 10, fontWeight: '700', color: SG.muted, letterSpacing: 0.3, marginBottom: 6 },
  personChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5, paddingLeft: 4, paddingRight: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: SG.line, borderRadius: 999,
  },
  chipActive: { backgroundColor: SG.primary, borderColor: SG.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: SG.ink },
  chipTextActive: { color: '#fff' },
  footer: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: SG.line2,
  },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 10 },
  footerLabel: { fontSize: 12, color: SG.muted },
  footerAmt: { fontSize: 13, fontWeight: '700', color: SG.ink },
});
