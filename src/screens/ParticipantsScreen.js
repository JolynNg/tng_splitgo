import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, StatusBar,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import TngAvatar from '../components/TngAvatar';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';
import { useAuth } from '../context/AuthContext';

export default function ParticipantsScreen({ navigation }) {
  const { selected, setSelected, createBillGroup } = useFlow();
  const { me, contacts, addContact, refreshContacts, contactsLoading } = useAuth();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('Contacts');
  const [creating, setCreating] = useState(false);

  // Add-contact modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  // Everyone in the directory except the signed-in user (they're shown separately as "YOU")
  const others = (contacts || []).filter(c => c.name !== me?.name);
  const filtered = others.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.phone && p.phone.includes(query))
  );

  const toggle = (name) => {
    if (selected.includes(name)) setSelected(selected.filter(n => n !== name));
    else setSelected([...selected, name]);
  };

  const onAddContact = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please enter the contact\'s name.');
      return;
    }
    setAdding(true);
    try {
      const c = await addContact({ name, phone: newPhone.trim() });
      // Auto-select the new contact so the payer doesn't have to scroll & tap again
      if (!selected.includes(c.name)) setSelected([...selected, c.name]);
      setShowAdd(false);
    } catch (e) {
      Alert.alert('Could not add contact', e.message);
    } finally {
      setAdding(false);
    }
  };

  const count = 1 + selected.length;

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
          <Text style={styles.headerTitle}>Add People</Text>
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
            keyboardType="phone-pad"
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
            <Text style={styles.infoTitle}>Include yourself in the split</Text>
            <Text style={styles.infoSub}>You're added by default. Pick friends from your contacts below.</Text>
          </View>
        </View>

        <View style={styles.selectedHeader}>
          <Text style={styles.selectedTitle}>Selected ({count})</Text>
          {contactsLoading && <ActivityIndicator size="small" color={SG.primary} />}
        </View>

        {/* You row — uses the signed-in user's actual name */}
        <View style={styles.personRow}>
          <TngAvatar size={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.personName}>{(me?.name || 'YOU').toUpperCase()}</Text>
            <Text style={styles.personPhone}>Bill creator</Text>
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
              <View style={[styles.colorDot, { backgroundColor: p.color || SG.primary }]} />
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
          <TouchableOpacity
            onPress={() => { setNewName(''); setNewPhone(''); setShowAdd(true); }}
            activeOpacity={0.7}
            style={styles.addBtn}
          >
            <Svg width="12" height="12" viewBox="0 0 12 12">
              <Path d="M6 2v8M2 6h8" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
            </Svg>
            <Text style={styles.addBtnText}>Add new</Text>
          </TouchableOpacity>
        </View>

        {filtered.filter(p => !selected.includes(p.name)).map(p => (
          <TouchableOpacity key={p.contactId || p.name} onPress={() => toggle(p.name)} style={styles.personRow} activeOpacity={0.7}>
            <View style={[styles.colorDot, { backgroundColor: p.color || SG.primary }]} />
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
            <Text style={styles.emptySub}>Tap "Add new" to add someone to the directory.</Text>
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Text style={styles.footerBalance}>
          Each person picks their own items · powered by AI
        </Text>
        <TouchableOpacity
          onPress={async () => {
            if (creating || selected.length === 0) return;
            setCreating(true);
            try {
              await createBillGroup();
              // Wipe the Scan→Items→Participants stack so back from the bill
              // dashboard returns straight to SplitGo Home (and the user
              // doesn't bounce through the frozen camera preview).
              navigation.reset({
                index: 1,
                routes: [
                  { name: 'SplitGoHome' },
                  { name: 'BillCreated' },
                ],
              });
            } finally {
              setCreating(false);
            }
          }}
          disabled={selected.length === 0 || creating}
          style={[
            styles.continueBtn,
            (selected.length === 0 || creating) && styles.continueBtnDisabled,
          ]}
          activeOpacity={0.8}
        >
          <Text style={styles.continueBtnText}>
            {creating
              ? 'Creating bill group…'
              : selected.length === 0
                ? 'Pick at least one friend'
                : `Create bill group with ${count} ${count === 1 ? 'person' : 'people'}`}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Add new contact modal */}
      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => !adding && setShowAdd(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a contact</Text>
            <Text style={styles.modalSub}>This person will be added to the shared directory and selected for this bill.</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Hafiz Zainal"
              placeholderTextColor={SG.muted2}
              style={styles.input}
              autoFocus
              autoCapitalize="words"
              editable={!adding}
            />

            <Text style={styles.label}>Phone (optional)</Text>
            <TextInput
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="e.g. +60 18 990 3344"
              placeholderTextColor={SG.muted2}
              style={styles.input}
              keyboardType="phone-pad"
              editable={!adding}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnGhost}
                activeOpacity={0.7}
                disabled={adding}
                onPress={() => setShowAdd(false)}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, (adding || !newName.trim()) && styles.modalBtnDisabled]}
                activeOpacity={0.85}
                disabled={adding || !newName.trim()}
                onPress={onAddContact}
              >
                {adding
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalBtnText}>Add to bill</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  colorDot: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  contactsTitle: { fontSize: 15, fontWeight: '700', color: SG.ink },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: SG.primarySoft,
  },
  addBtnText: { fontSize: 12, fontWeight: '700', color: SG.primary },
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

  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalDismiss: { flex: 1 },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: SG.ink },
  modalSub:   { fontSize: 12, color: SG.muted, marginTop: 4, marginBottom: 14 },
  label:      { fontSize: 11, color: SG.muted, marginTop: 12, marginBottom: 4, fontWeight: '700', letterSpacing: 0.3 },
  input: {
    fontSize: 14, color: SG.ink,
    borderWidth: 1, borderColor: SG.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtnGhost: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SG.bg,
  },
  modalBtnGhostText: { color: SG.ink2, fontWeight: '700', fontSize: 13 },
  modalBtn: {
    flex: 2, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SG.primary,
  },
  modalBtnDisabled: { backgroundColor: SG.muted2 },
  modalBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
