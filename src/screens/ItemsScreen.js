import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import PillBtn from '../components/PillBtn';
import ScreenHeader from '../components/ScreenHeader';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';
import { categorizeItems } from '../api/categorize';
import { translateItems, SUPPORTED_LANGS } from '../api/translate';

const BLANK_DRAFT = { name: '', qty: '1', unit: '' };

// AI category → display chip styling
const CATEGORY_META = {
  mains:   { label: 'Mains',   color: '#0066CC', bg: '#E6F2FA' },
  drinks:  { label: 'Drinks',  color: '#0E9F6E', bg: '#E0F4EC' },
  sides:   { label: 'Sides',   color: '#B8780F', bg: '#FFF4DC' },
  dessert: { label: 'Dessert', color: '#C026D3', bg: '#FAEBFF' },
  other:   { label: 'Other',   color: '#6B7280', bg: '#F3F4F6' },
};

const CCY_SYMBOL = { MYR: 'RM', SGD: 'S$', THB: '฿', IDR: 'Rp', USD: '$', EUR: '€', CNY: '¥' };

export default function ItemsScreen({ navigation }) {
  const {
    items, setItems, receiptMeta,
    categories, setCategories,
    translations, setTranslations,
  } = useFlow();
  const [editingId, setEditingId] = useState(null);  // id of item being edited, or 'new'
  const [draft, setDraft] = useState(BLANK_DRAFT);

  // Language toggle state
  const [activeLang, setActiveLang] = useState(null); // null = original
  const [langLoading, setLangLoading] = useState(false);

  const sym = CCY_SYMBOL[(receiptMeta.currency || 'MYR').toUpperCase()] || 'RM';
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit, 0);
  const sst = receiptMeta.sst;
  const serviceCharge = receiptMeta.serviceCharge;
  const total = subtotal + (sst ?? 0) + (serviceCharge ?? 0);
  const restaurantName = receiptMeta.restaurant || 'Restaurant';
  const receiptDate = receiptMeta.date || null;

  // ✦ Auto-categorise items via Qwen-Plus once on mount.
  // Runs only when we have items but no cached categories yet.
  useEffect(() => {
    if (items.length === 0) return;
    if (Object.keys(categories).length > 0) return;
    categorizeItems(items)
      .then(cats => { if (cats && Object.keys(cats).length) setCategories(cats); })
      .catch(err => console.warn('[AI] categorize failed:', err.message));
  }, [items, categories, setCategories]);

  // ✦ Translate item names on language toggle, with a per-language cache.
  const handleLangToggle = async (lang) => {
    if (langLoading) return;
    if (lang === activeLang) {
      setActiveLang(null);
      return;
    }
    if (translations[lang]) {
      setActiveLang(lang);
      return;
    }
    setLangLoading(true);
    try {
      const map = await translateItems(items, lang);
      if (map && Object.keys(map).length) {
        setTranslations(prev => ({ ...prev, [lang]: map }));
        setActiveLang(lang);
      }
    } catch (err) {
      console.warn('[AI] translate failed:', err.message);
    } finally {
      setLangLoading(false);
    }
  };

  // Display name for an item, respecting active language
  const displayName = (it) => {
    if (!activeLang) return it.name;
    return translations[activeLang]?.[it.id] || it.name;
  };

  // Open edit form for an existing item
  const openEdit = (it) => {
    setEditingId(it.id);
    setDraft({ name: it.name, qty: String(it.qty), unit: String(it.unit) });
  };

  // Close without saving
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
  };

  // Save edit for an existing item
  const saveEdit = (id) => {
    const qty = parseFloat(draft.qty) || 1;
    const unit = parseFloat(draft.unit) || 0;
    const name = draft.name.trim() || 'Item';
    setItems(items.map(it => it.id === id ? { ...it, name, qty, unit } : it));
    setEditingId(null);
    setDraft(BLANK_DRAFT);
  };

  // Delete an item
  const deleteItem = (id) => {
    setItems(items.filter(it => it.id !== id));
    setEditingId(null);
  };

  // Open "add new item" form
  const openAdd = () => {
    setEditingId('new');
    setDraft(BLANK_DRAFT);
  };

  // Save the new item
  const saveNew = () => {
    const qty = parseFloat(draft.qty) || 1;
    const unit = parseFloat(draft.unit) || 0;
    const name = draft.name.trim() || 'New item';
    const newId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
    setItems([...items, { id: newId, name, qty, unit }]);
    setEditingId(null);
    setDraft(BLANK_DRAFT);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title="Review items"
          subtitle={
            Object.keys(categories).length
              ? `${items.length} item${items.length === 1 ? '' : 's'} ready, sorted by category`
              : `${items.length} item${items.length === 1 ? '' : 's'} pulled from your receipt`
          }
          onBack={() => navigation.goBack()}
        />
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Restaurant card */}
        <View style={styles.restCard}>
          <View style={styles.restIcon}>
            <Text style={styles.restInitial}>{(restaurantName[0] || '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.restName}>{restaurantName}</Text>
            {receiptDate && <Text style={styles.restMeta}>{receiptDate}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmt}>{sym} {total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Language toggle — Qwen-Plus translates item names on the fly */}
        <View style={styles.langRow}>
          <Text style={styles.langLabel}>View in</Text>
          {SUPPORTED_LANGS.map(l => {
            const active = activeLang === l.code;
            return (
              <TouchableOpacity
                key={l.code}
                onPress={() => handleLangToggle(l.code)}
                disabled={langLoading}
                style={[styles.langChip, active && styles.langChipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                  {l.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          {langLoading && <ActivityIndicator size="small" color={SG.primary} style={{ marginLeft: 4 }} />}
        </View>

        {/* Items list */}
        <View style={styles.itemsCard}>
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>Items ({items.length})</Text>
            <TouchableOpacity onPress={openAdd} activeOpacity={0.7}>
              <Text style={styles.addItemBtn}>+ Add item</Text>
            </TouchableOpacity>
          </View>

          {items.map((it, i) => {
            const cat = categories[it.id];
            const meta = cat && CATEGORY_META[cat];
            return (
            <View key={it.id}>
              {/* Item row */}
              <View style={[
                styles.itemRow,
                i < items.length - 1 && editingId !== it.id && styles.itemBorder,
                editingId === it.id && styles.itemActive,
              ]}>
                <View style={styles.qtyBadge}>
                  <Text style={styles.qtyText}>{it.qty}×</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.itemNameRow}>
                    <Text style={styles.itemName}>{displayName(it)}</Text>
                    {meta && (
                      <View style={[styles.catChip, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.catChipText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.itemUnit}>{sym} {it.unit.toFixed(2)} each</Text>
                </View>
                <Text style={styles.itemTotal}>{sym} {(it.qty * it.unit).toFixed(2)}</Text>
                <TouchableOpacity
                  onPress={() => editingId === it.id ? cancelEdit() : openEdit(it)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.6}
                >
                  {editingId === it.id ? (
                    <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <Path d="M2 2l10 10M12 2L2 12" stroke={SG.muted} strokeWidth="1.8" strokeLinecap="round" />
                    </Svg>
                  ) : (
                    <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <Path d="M9 2l2 2-6 6H3V8l6-6z" stroke={SG.muted} strokeWidth="1.5" strokeLinejoin="round" />
                    </Svg>
                  )}
                </TouchableOpacity>
              </View>

              {/* Inline edit form */}
              {editingId === it.id && (
                <View style={styles.editForm}>
                  <View style={styles.editRow}>
                    <View style={styles.editFieldWide}>
                      <Text style={styles.editLabel}>Item name</Text>
                      <TextInput
                        style={styles.editInput}
                        value={draft.name}
                        onChangeText={v => setDraft(d => ({ ...d, name: v }))}
                        placeholder="e.g. Nasi Lemak"
                        placeholderTextColor={SG.muted2}
                        returnKeyType="next"
                      />
                    </View>
                  </View>
                  <View style={styles.editRow}>
                    <View style={styles.editFieldSmall}>
                      <Text style={styles.editLabel}>Qty</Text>
                      <TextInput
                        style={styles.editInput}
                        value={draft.qty}
                        onChangeText={v => setDraft(d => ({ ...d, qty: v }))}
                        keyboardType="decimal-pad"
                        returnKeyType="next"
                      />
                    </View>
                    <View style={styles.editFieldMed}>
                      <Text style={styles.editLabel}>Unit price (RM)</Text>
                      <TextInput
                        style={styles.editInput}
                        value={draft.unit}
                        onChangeText={v => setDraft(d => ({ ...d, unit: v }))}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </View>
                    <View style={styles.editFieldSmall}>
                      <Text style={styles.editLabel}>Line total</Text>
                      <View style={[styles.editInput, styles.editInputReadonly]}>
                        <Text style={styles.editReadonlyText}>
                          {((parseFloat(draft.qty) || 0) * (parseFloat(draft.unit) || 0)).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.editActions}>
                    <TouchableOpacity onPress={() => deleteItem(it.id)} style={styles.deleteBtn} activeOpacity={0.7}>
                      <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <Path d="M2 4h10M5 4V2h4v2M6 7v4M8 7v4M3 4l1 8h6l1-8" stroke="#EF4444" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                      <Text style={styles.deleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity onPress={cancelEdit} style={styles.cancelBtn} activeOpacity={0.7}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => saveEdit(it.id)} style={styles.saveBtn} activeOpacity={0.8}>
                      <Text style={styles.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
            );
          })}

          {/* Add new item form inline */}
          {editingId === 'new' && (
            <View style={[styles.editForm, styles.editFormAdd]}>
              <Text style={styles.editFormTitle}>New item</Text>
              <View style={styles.editRow}>
                <View style={styles.editFieldWide}>
                  <Text style={styles.editLabel}>Item name</Text>
                  <TextInput
                    style={styles.editInput}
                    value={draft.name}
                    onChangeText={v => setDraft(d => ({ ...d, name: v }))}
                    placeholder="e.g. Milo Ais"
                    placeholderTextColor={SG.muted2}
                    autoFocus
                    returnKeyType="next"
                  />
                </View>
              </View>
              <View style={styles.editRow}>
                <View style={styles.editFieldSmall}>
                  <Text style={styles.editLabel}>Qty</Text>
                  <TextInput
                    style={styles.editInput}
                    value={draft.qty}
                    onChangeText={v => setDraft(d => ({ ...d, qty: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.editFieldMed}>
                  <Text style={styles.editLabel}>Unit price ({sym})</Text>
                  <TextInput
                    style={styles.editInput}
                    value={draft.unit}
                    onChangeText={v => setDraft(d => ({ ...d, unit: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.editFieldSmall}>
                  <Text style={styles.editLabel}>Line total</Text>
                  <View style={[styles.editInput, styles.editInputReadonly]}>
                    <Text style={styles.editReadonlyText}>
                      {((parseFloat(draft.qty) || 0) * (parseFloat(draft.unit) || 0)).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity onPress={cancelEdit} style={styles.cancelBtn} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveNew} style={styles.saveBtn} activeOpacity={0.8}>
                  <Text style={styles.saveBtnText}>Add item</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Totals — live update */}
        <View style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalRowLabel}>Subtotal</Text>
            <Text style={styles.totalRowAmt}>{sym} {subtotal.toFixed(2)}</Text>
          </View>
          {sst != null && (
            <View style={styles.totalRow}>
              <Text style={styles.totalRowLabel}>SST</Text>
              <Text style={styles.totalRowAmt}>{sym} {sst.toFixed(2)}</Text>
            </View>
          )}
          {serviceCharge != null && (
            <View style={styles.totalRow}>
              <Text style={styles.totalRowLabel}>Service charge</Text>
              <Text style={styles.totalRowAmt}>{sym} {serviceCharge.toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandAmt}>{sym} {total.toFixed(2)}</Text>
          </View>
        </View>

      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PillBtn onPress={() => navigation.navigate('Participants')}>
          Continue · {sym} {total.toFixed(2)}
        </PillBtn>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  badge: {
    backgroundColor: SG.successSoft, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: SG.success },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 120 },
  restCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  restIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  restInitial: { color: '#fff', fontWeight: '800', fontSize: 18 },
  restName: { fontSize: 15, fontWeight: '700', color: SG.ink },
  restMeta: { fontSize: 11, color: SG.muted, marginTop: 1 },
  totalLabel: { fontSize: 10, color: SG.muted },
  totalAmt: { fontSize: 16, fontWeight: '700', color: SG.ink },
  itemsCard: {
    backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  itemsHeader: {
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: SG.line2,
  },
  itemsTitle: { fontSize: 13, fontWeight: '700', color: SG.ink },
  addItemBtn: { fontSize: 11, color: SG.primary, fontWeight: '700' },
  itemRow: {
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: SG.line2 },
  itemActive: { backgroundColor: SG.primarySoft },
  qtyBadge: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: SG.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyText: { fontSize: 12, fontWeight: '700', color: SG.ink2 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  itemName: { fontSize: 14, fontWeight: '600', color: SG.ink, letterSpacing: -0.1 },
  itemUnit: { fontSize: 11, color: SG.muted, marginTop: 1 },
  itemTotal: { fontSize: 14, fontWeight: '700', color: SG.ink },

  // Category chip (AI-derived)
  catChip: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  catChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  // Language toggle row
  langRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4, marginBottom: 10,
  },
  langLabel: { fontSize: 11, color: SG.muted, fontWeight: '600', marginRight: 2 },
  langChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1, borderColor: SG.line,
  },
  langChipActive: { backgroundColor: SG.primary, borderColor: SG.primary },
  langChipText: { fontSize: 11, fontWeight: '700', color: SG.ink2 },
  langChipTextActive: { color: '#fff' },

  // Edit form
  editForm: {
    backgroundColor: SG.primarySoft, padding: 14,
    borderTopWidth: 1, borderTopColor: `${SG.primary}22`,
  },
  editFormAdd: {
    borderTopWidth: 1, borderTopColor: SG.line2,
    backgroundColor: '#F0F8FF',
  },
  editFormTitle: { fontSize: 13, fontWeight: '700', color: SG.primary, marginBottom: 10 },
  editRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  editFieldWide: { flex: 1 },
  editFieldMed: { flex: 1.4 },
  editFieldSmall: { flex: 0.8 },
  editLabel: { fontSize: 10, fontWeight: '600', color: SG.muted, marginBottom: 5, letterSpacing: 0.3 },
  editInput: {
    height: 40, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: SG.line,
    paddingHorizontal: 10, fontSize: 14, color: SG.ink,
  },
  editInputReadonly: {
    backgroundColor: SG.bg, justifyContent: 'center',
  },
  editReadonlyText: { fontSize: 14, fontWeight: '600', color: SG.ink },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  deleteBtnText: { fontSize: 13, color: '#EF4444', fontWeight: '600' },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, borderWidth: 1, borderColor: SG.line, backgroundColor: '#fff',
  },
  cancelBtnText: { fontSize: 13, color: SG.muted, fontWeight: '600' },
  saveBtn: {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 999, backgroundColor: SG.primary,
  },
  saveBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },

  totalsCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalRowLabel: { fontSize: 13, color: SG.muted },
  totalRowAmt: { fontSize: 13, color: SG.muted },
  totalDivider: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: SG.line, marginVertical: 8 },
  grandLabel: { fontSize: 16, fontWeight: '700', color: SG.ink },
  grandAmt: { fontSize: 16, fontWeight: '700', color: SG.ink },
  footer: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: SG.line2,
  },
});
