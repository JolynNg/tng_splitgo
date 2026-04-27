import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, StatusBar,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import TngAvatar from '../components/TngAvatar';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';

/**
 * Step 1 of travel setup — same contact-table UX as one-time "Add People",
 * but selection is local (does not touch FlowContext bill state).
 */
export default function TravelPickContactsScreen({ navigation }) {
  const { me, contacts, contactsError, refreshContacts, contactsLoading } = useAuth();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('Contacts');

  const others = (contacts || []).filter(c => c.name !== me?.name);
  const filtered = others.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.phone && p.phone.includes(query)),
  );

  const toggle = (name) => {
    if (selected.includes(name)) setSelected(selected.filter(n => n !== name));
    else setSelected([...selected, name]);
  };

  useFocusEffect(
    useCallback(() => {
      refreshContacts();
    }, [refreshContacts]),
  );

  const count = 1 + selected.length;

  const onContinue = () => {
    if (selected.length === 0) {
      Alert.alert('Add friends', 'Pick at least one travel buddy from your contacts.');
      return;
    }
    navigation.navigate('TravelTripName', { selectedNames: [...selected] });
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.primary} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: SG.primary }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add people to trip</Text>
          <View style={{ width: 32 }} />
        </View>
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
        {contactsError ? (
          <View style={styles.errBanner}>
            <Text style={styles.errBannerTitle}>Could not load contacts</Text>
            <Text style={styles.errBannerMsg}>{contactsError}</Text>
            <Text style={styles.errBannerHint}>
              Check EXPO_PUBLIC_AWS_API_URL in .env matches your deploy output, then restart Metro with --clear.
            </Text>
            <TouchableOpacity style={styles.errRetry} onPress={refreshContacts} activeOpacity={0.8}>
              <Text style={styles.errRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
            keyboardType="default"
          />
          <TouchableOpacity onPress={refreshContacts} activeOpacity={0.7}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M16 4v4h-4M4 16v-4h4" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M16 8c-1-2.5-3.5-4-6-4-2 0-3.8 1-5 2.5M4 12c1 2.5 3.5 4 6 4 2 0 3.8-1 5-2.5" stroke={SG.primary} strokeWidth="1.8" strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        <View style={styles.infoBanner}>
          <View style={styles.infoIconWrap}>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Circle cx="7" cy="7" r="6" stroke={SG.primary} strokeWidth="1.4" />
              <Path d="M7 4v4M7 10h.01" stroke={SG.primary} strokeWidth="1.4" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>{"You're on the trip by default"}</Text>
            <Text style={styles.infoSub}>{"Pick friends from your contacts. You'll name the trip on the next step."}</Text>
          </View>
        </View>

        <View style={styles.selectedHeader}>
          <Text style={styles.selectedTitle}>Selected ({count})</Text>
          {contactsLoading && <ActivityIndicator size="small" color={SG.primary} />}
        </View>

        <View style={styles.personRow}>
          <TngAvatar size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.personName}>{(me?.name || 'YOU').toUpperCase()}</Text>
            <Text style={styles.personPhone}>Trip member</Text>
          </View>
          <View style={styles.defaultBadge}>
            <Text style={styles.defaultText}>YOU</Text>
          </View>
        </View>

        {selected.map(n => {
          const p = others.find(c => c.name === n);
          if (!p) return null;
          return (
            <View key={n} style={styles.personRow}>
              <TngAvatar size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{p.name.toUpperCase()}</Text>
                {p.phone && <Text style={styles.personPhone}>{p.phone}</Text>}
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
        <View style={styles.contactsHeaderRow}>
          <Text style={styles.contactsTitle}>Contacts</Text>
        </View>

        {filtered.filter(p => !selected.includes(p.name)).map(p => (
          <TouchableOpacity key={p.contactId || p.name} onPress={() => toggle(p.name)} style={styles.personRow} activeOpacity={0.7}>
            <TngAvatar size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{p.name.toUpperCase()}</Text>
              {p.phone && <Text style={styles.personPhone}>{p.phone}</Text>}
            </View>
            <View style={styles.radioEmpty} />
          </TouchableOpacity>
        ))}

        {filtered.length === 0 && !contactsLoading && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No contacts match</Text>
            <Text style={styles.emptySub}>Try a different search.</Text>
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Text style={styles.footerBalance}>Next: give your trip a name</Text>
        <TouchableOpacity
          onPress={onContinue}
          disabled={selected.length === 0}
          style={[styles.continueBtn, selected.length === 0 && styles.continueBtnDisabled]}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>
            {selected.length === 0
              ? 'Pick at least one friend'
              : `Continue · ${count} ${count === 1 ? 'person' : 'people'}`}
          </Text>
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
  errBanner: {
    marginBottom: 14, padding: 14, borderRadius: 12,
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
  },
  errBannerTitle: { fontSize: 13, fontWeight: '800', color: '#991B1B' },
  errBannerMsg:   { fontSize: 11, color: '#991B1B', marginTop: 4 },
  errBannerHint:  { fontSize: 10, color: '#B91C1C', marginTop: 8, lineHeight: 15 },
  errRetry: {
    alignSelf: 'flex-start', marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#FECACA',
  },
  errRetryText: { fontSize: 12, fontWeight: '800', color: '#991B1B' },
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
  selectedHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 22, marginBottom: 6,
  },
  selectedTitle: { fontSize: 15, fontWeight: '700', color: SG.ink },
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
  contactsHeaderRow: {
    marginBottom: 4,
  },
  contactsTitle: { fontSize: 15, fontWeight: '700', color: SG.ink },
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
  continueBtnDisabled: { backgroundColor: SG.muted2 },
  continueBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  emptyCard: {
    padding: 18, borderRadius: 12, backgroundColor: SG.bg,
    alignItems: 'center', marginTop: 12,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: SG.ink },
  emptySub: { fontSize: 11, color: SG.muted, marginTop: 4, textAlign: 'center' },
});
