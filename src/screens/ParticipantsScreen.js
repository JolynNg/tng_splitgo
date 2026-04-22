import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import TngAvatar from '../components/TngAvatar';
import { SG } from '../tokens';
import { PEOPLE } from '../data';
import { useFlow } from '../context/FlowContext';

export default function ParticipantsScreen({ navigation }) {
  const { selected, setSelected } = useFlow();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('Contacts');

  const contacts = PEOPLE.filter(p => !p.me);
  const filtered = contacts.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.phone && p.phone.includes(query))
  );

  const toggle = (name) => {
    if (selected.includes(name)) setSelected(selected.filter(n => n !== name));
    else setSelected([...selected, name]);
  };

  const count = 1 + selected.length;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.primary} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: SG.primary }}>
        {/* Blue header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add People</Text>
          <View style={{ width: 32 }} />
        </View>
        {/* Tabs */}
        <View style={styles.tabs}>
          {['Contacts', 'Recent', 'Phone'].map(t => {
            const active = tab === t;
            return (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={styles.tab} activeOpacity={0.7}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t}</Text>
                <View style={[styles.tabLine, active && styles.tabLineActive]} />
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Search row */}
        <View style={styles.searchRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryText}>+60</Text>
            <Svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <Path d="M2 4l3 3 3-3" stroke={SG.muted} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or phone number"
            placeholderTextColor={SG.muted}
            style={styles.searchInput}
          />
          <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <Path d="M16 4v4h-4M4 16v-4h4" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M16 8c-1-2.5-3.5-4-6-4-2 0-3.8 1-5 2.5M4 12c1 2.5 3.5 4 6 4 2 0 3.8-1 5-2.5" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" />
          </Svg>
        </View>

        {/* Info banner */}
        <View style={styles.infoBanner}>
          <View style={styles.infoIconWrap}>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Circle cx="7" cy="7" r="6" stroke={SG.primary} strokeWidth="1.4" />
              <Path d="M7 4v4M7 10h.01" stroke={SG.primary} strokeWidth="1.4" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Include yourself in the split</Text>
            <Text style={styles.infoSub}>You're added by default. Pick friends from your contacts below.</Text>
            <Text style={styles.infoLink}>Learn more</Text>
          </View>
        </View>

        {/* Selected count */}
        <View style={styles.selectedHeader}>
          <Text style={styles.selectedTitle}>Selected ({count})</Text>
          <Text style={styles.viewAll}>View All</Text>
        </View>

        {/* You row */}
        <View style={styles.personRow}>
          <TngAvatar size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.personName}>YOU</Text>
            <Text style={styles.personPhone}>Bill creator</Text>
          </View>
          <View style={styles.defaultBadge}>
            <Text style={styles.defaultText}>DEFAULT</Text>
          </View>
        </View>

        {/* Selected contacts */}
        {selected.map(n => {
          const p = contacts.find(c => c.name === n);
          if (!p) return null;
          return (
            <View key={n} style={styles.personRow}>
              <TngAvatar size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{p.name.toUpperCase()}</Text>
                <Text style={styles.personPhone}>+60 {p.phone}</Text>
              </View>
              <TouchableOpacity onPress={() => toggle(n)} style={styles.removeBtn} activeOpacity={0.7}>
                <Svg width="10" height="10" viewBox="0 0 10 10">
                  <Path d="M1 1l8 8M9 1l-8 8" stroke={SG.muted} strokeWidth="1.5" strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>
          );
        })}

        <View style={styles.divider} />
        <Text style={styles.contactsTitle}>Contacts</Text>

        {/* Unselected contacts */}
        {filtered.filter(p => !selected.includes(p.name)).map(p => (
          <TouchableOpacity key={p.name} onPress={() => toggle(p.name)} style={styles.personRow} activeOpacity={0.7}>
            <TngAvatar size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{p.name.toUpperCase()}</Text>
              <Text style={styles.personPhone}>+60 {p.phone}</Text>
            </View>
            <View style={styles.radioEmpty} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Text style={styles.footerBalance}>
          Transferable eWallet balance: <Text style={{ color: SG.ink, fontWeight: '600' }}>RM 1,284.50</Text>
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Assign')}
          style={styles.continueBtn}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>Continue with {count} {count === 1 ? 'person' : 'people'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center',
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 17, marginRight: 32 },
  tabs: { flexDirection: 'row', paddingHorizontal: 24 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  tabLine: { height: 3, width: '100%', backgroundColor: 'transparent', marginTop: 4 },
  tabLineActive: { backgroundColor: SG.accent },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 120 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: SG.line2,
  },
  countryCode: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingRight: 12, borderRightWidth: 1, borderRightColor: SG.line,
  },
  countryText: { fontSize: 15, color: SG.ink },
  searchInput: { flex: 1, fontSize: 15, color: SG.ink },
  infoBanner: {
    marginTop: 20, padding: 14, borderRadius: 12, backgroundColor: SG.bg,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  infoIconWrap: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  infoTitle: { fontSize: 13, fontWeight: '600', color: SG.ink },
  infoSub: { fontSize: 12, color: SG.muted, marginTop: 2, lineHeight: 18 },
  infoLink: { fontSize: 12, fontWeight: '600', color: SG.primary, marginTop: 6 },
  selectedHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 22, marginBottom: 6,
  },
  selectedTitle: { fontSize: 15, fontWeight: '700', color: SG.ink },
  viewAll: { fontSize: 13, color: SG.primary, fontWeight: '600' },
  personRow: {
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  personName: { fontSize: 15, fontWeight: '700', color: SG.ink },
  personPhone: { fontSize: 12, color: SG.muted, marginTop: 1 },
  defaultBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: SG.primarySoft,
  },
  defaultText: { fontSize: 11, fontWeight: '700', color: SG.primary, letterSpacing: 0.3 },
  removeBtn: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: SG.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  divider: { height: 1, backgroundColor: SG.line2, marginVertical: 14 },
  contactsTitle: { fontSize: 15, fontWeight: '700', color: SG.ink, marginBottom: 4 },
  radioEmpty: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: SG.line, backgroundColor: '#fff',
  },
  footer: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    backgroundColor: SG.bg, borderTopWidth: 1, borderTopColor: SG.line2,
  },
  footerBalance: { textAlign: 'center', fontSize: 12, color: SG.muted, marginBottom: 10 },
  continueBtn: {
    height: 48, borderRadius: 999, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  continueBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
