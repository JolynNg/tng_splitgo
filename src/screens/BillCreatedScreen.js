import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Share, Alert,
  Image, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import ScreenHeader from '../components/ScreenHeader';
import PillBtn from '../components/PillBtn';
import TngAvatar from '../components/TngAvatar';
import UserSwitcher from '../components/UserSwitcher';
import { SG } from '../tokens';
import { useFlow, BILL_STATUS } from '../context/FlowContext';
import { useAuth } from '../context/AuthContext';
import { getBill } from '../api/billService';
import { translateItems, SUPPORTED_LANGS } from '../api/translate';

/**
 * Live bill dashboard — same screen for everyone, with a two-phase settlement:
 *   1. Each participant taps the items they ate inline ("pick").
 *   2. They mark themselves "Ready" — locking their selection.
 *   3. Once everyone is Ready, non-creators get a "Pay" button → confirm modal → marked Paid.
 *   4. Creator monitors progress, can cancel the bill (mistake) or close & settle once all are paid.
 *
 * The picker operates on `currentUser` (the FAB-switched viewer) so the
 * single-device demo continues to work without redirecting to ClaimScreen.
 */
export default function BillCreatedScreen({ navigation }) {
  const {
    billId, billStatus, shareLink, items, claims,
    perPersonTotals, totalAmount, claimProgress, participantProgress,
    closeBill, currentUser, syncFromServer, receiptMeta,
    me, billCreator, receiptUrl, billParticipantNames,
    translations, setTranslations,
    updateBillParticipants,
    toggleClaim, leaveBill,
    ready, paid, setMyReady, setMyPaid, cancelBillRemote,
    transactions,
  } = useFlow();
  const { contacts } = useAuth();

  // The "viewer" is who we're acting as on this device — defaults to me, but
  // the demo FAB can flip it to any other participant on a single phone.
  const viewer = (currentUser && currentUser.trim()) || me?.name || '';
  const viewerIsCreator = !!(billCreator && viewer === billCreator);
  const isCreatorDevice = !!(me?.name && billCreator && me.name === billCreator);

  const rosterNames = useMemo(() => {
    const all = billParticipantNames.filter(Boolean);
    const uniq = [...new Set(all)];
    if (!billCreator || !uniq.includes(billCreator)) return uniq.sort((a, b) => a.localeCompare(b));
    const rest = uniq.filter(n => n !== billCreator).sort((a, b) => a.localeCompare(b));
    return [billCreator, ...rest];
  }, [billParticipantNames, billCreator]);

  const colorFor = useCallback((name) => {
    const c = contacts.find(x => x.name === name);
    return c?.color || SG.primary;
  }, [contacts]);

  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [activeLang, setActiveLang] = useState(null);
  const [langLoading, setLangLoading] = useState(false);
  const [savingParts, setSavingParts] = useState(false);
  const [confirmingReady, setConfirmingReady] = useState(false);
  const [payConfirmOpen, setPayConfirmOpen] = useState(false);
  const [payConfirming, setPayConfirming] = useState(false);
  // Set to { amount, newBalance, currency } once a /paid call returns successfully
  // so the wallet success modal can render the deducted amount + new balance.
  const [paySuccess, setPaySuccess] = useState(null);

  // Two-phase settlement derived flags ----------------------------------------
  const myReady     = !!viewer && ready.includes(viewer);
  const myPaid      = !!viewer && paid.includes(viewer);
  const myAmount    = perPersonTotals[viewer] || 0;
  const myItemCount = items.filter(it => (claims[it.id] || []).includes(viewer)).length;
  const everyoneReady = billParticipantNames.length > 0
    && billParticipantNames.every(n => ready.includes(n));
  const nonCreatorNames = billParticipantNames.filter(n => n !== billCreator);
  const allOthersPaid = nonCreatorNames.length === 0
    || nonCreatorNames.every(n => paid.includes(n));
  const readyCount = billParticipantNames.filter(n => ready.includes(n)).length;
  const paidCount  = nonCreatorNames.filter(n => paid.includes(n)).length;

  useEffect(() => {
    if (!billId || billStatus !== BILL_STATUS.OPEN) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const bill = await getBill(billId);
        if (!cancelled && bill && !bill.local) {
          syncFromServer(bill);
          setLastSyncAt(Date.now());
        }
      } catch { /* next tick */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [billId, billStatus, syncFromServer]);

  // Auto-close handoff: when the server flips status to CLOSED (all
  // non-creator participants paid up), drop into the Summary view instead
  // of leaving the user on a stale "open" dashboard.
  useEffect(() => {
    if (billStatus !== BILL_STATUS.CLOSED) return;
    const t = setTimeout(() => navigation.replace('Summary'), 600);
    return () => clearTimeout(t);
  }, [billStatus, navigation]);

  // The moment everyone except the creator has marked paid, finalise the bill
  // locally and on the server. closeBill() is idempotent — if the server has
  // already auto-closed it from the /paid call, /close returns 409 and we
  // silently keep the local closed state. Either way the dashboard flips to
  // CLOSED instantly so the auto-navigate useEffect above can take over.
  useEffect(() => {
    if (!billId || !viewerIsCreator) return;
    if (billStatus !== BILL_STATUS.OPEN) return;
    if (!allOthersPaid) return;
    closeBill();
  }, [billId, viewerIsCreator, billStatus, allOthersPaid, closeBill]);

  const CCY_SYMBOL = { MYR: 'RM', SGD: 'S$', THB: '฿', IDR: 'Rp', USD: '$', EUR: '€', CNY: '¥' };
  // If we have sourceCurrency metadata, scan-time FX conversion already
  // normalized item prices into MYR, so all live totals on this screen should
  // render in RM regardless of the original receipt currency.
  const displayCurrency = receiptMeta?.sourceCurrency ? 'MYR' : (receiptMeta?.currency || 'MYR').toUpperCase();
  const sym = CCY_SYMBOL[displayCurrency] || 'RM';

  const handleShare = async () => {
    if (!shareLink) return;
    try {
      await Share.share({
        message: `Hey! Split the bill with me on SplitGo: ${shareLink}\nBill code: ${billId}`,
      });
    } catch {}
  };

  const handleCopyCode = async () => {
    if (!billId) return;
    try {
      await Clipboard.setStringAsync(billId);
      Alert.alert('Copied', 'Bill code copied to clipboard.');
    } catch {}
  };

  const allClaimed = claimProgress.total > 0 && claimProgress.claimed === claimProgress.total;
  const unclaimedItems = items.filter(it => (claims[it.id] || []).length === 0);

  const handleClose = () => {
    if (!viewerIsCreator) return;
    closeBill();
    navigation.navigate('Summary');
  };

  const handleForceClose = () => {
    if (!viewerIsCreator) return;
    if (unclaimedItems.length === 0) {
      handleClose();
      return;
    }
    const peopleCount = billParticipantNames.length;
    const leftoverTotal = unclaimedItems.reduce((s, it) => s + it.qty * it.unit, 0);
    const perHead = peopleCount > 0 ? leftoverTotal / peopleCount : 0;
    const lines = unclaimedItems
      .slice(0, 5)
      .map(it => `• ${it.name} — ${sym} ${(it.qty * it.unit).toFixed(2)}`)
      .join('\n');
    const more = unclaimedItems.length > 5 ? `\n…and ${unclaimedItems.length - 5} more` : '';
    Alert.alert(
      `${unclaimedItems.length} item${unclaimedItems.length > 1 ? 's' : ''} not claimed`,
      `${lines}${more}\n\nThese will be split equally among all ${peopleCount} people (≈ ${sym} ${perHead.toFixed(2)} each).`,
      [
        { text: 'Wait for them', style: 'cancel' },
        { text: 'Split & close', style: 'destructive', onPress: handleClose },
      ],
    );
  };

  // ---- Inline picker ----
  const onToggleItem = (itemId) => {
    if (!viewer) return;
    if (myReady) {
      Alert.alert(
        'Update your picks?',
        'You marked yourself ready. Editing will un-mark you so others know to wait.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Edit picks',
            onPress: async () => {
              try { await setMyReady(viewer, false); } catch {}
              toggleClaim(itemId, viewer);
            },
          },
        ],
      );
      return;
    }
    toggleClaim(itemId, viewer);
  };

  // ---- Ready / Pay ----
  const handleReadyPress = async () => {
    if (!viewer) return;
    if (myReady) {
      try { await setMyReady(viewer, false); } catch (e) { Alert.alert('Could not update', e.message); }
      return;
    }
    if (myItemCount === 0) {
      // No items picked — give them a chance to leave the bill instead.
      Alert.alert(
        'Nothing picked',
        viewerIsCreator
          ? 'You haven\u2019t picked any items. Mark ready anyway?'
          : 'You haven\u2019t picked any items. Do you want to leave the bill instead?',
        viewerIsCreator
          ? [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Mark ready',
                onPress: async () => {
                  setConfirmingReady(true);
                  try { await setMyReady(viewer, true); }
                  catch (e) { Alert.alert('Could not update', e.message); }
                  finally { setConfirmingReady(false); }
                },
              },
            ]
          : [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Leave bill',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await leaveBill(viewer);
                    navigation.navigate('SplitGoHome');
                  } catch (e) { Alert.alert('Could not leave', e.message); }
                },
              },
              {
                text: 'Mark ready',
                onPress: async () => {
                  setConfirmingReady(true);
                  try { await setMyReady(viewer, true); }
                  catch (e) { Alert.alert('Could not update', e.message); }
                  finally { setConfirmingReady(false); }
                },
              },
            ],
      );
      return;
    }
    setConfirmingReady(true);
    try { await setMyReady(viewer, true); }
    catch (e) { Alert.alert('Could not update', e.message); }
    finally { setConfirmingReady(false); }
  };

  const confirmPay = async () => {
    if (!viewer) return;
    setPayConfirming(true);
    try {
      const r = await setMyPaid(viewer, true);
      setPayConfirmOpen(false);
      // Show the wallet success sheet only when the payer is the signed-in
      // user — i.e. they actually had money debited. (When the demo FAB
      // switches the viewer to someone else, no wallet was hit.)
      if (r && me?.name === viewer && typeof r.amount === 'number') {
        setPaySuccess({
          amount:     r.amount,
          newBalance: typeof r.payerBalance === 'number' ? r.payerBalance : null,
          currency:   sym,
        });
      }
    } catch (e) {
      Alert.alert('Could not update', e.message);
    } finally {
      setPayConfirming(false);
    }
  };

  const handleCancelBill = () => {
    if (!viewerIsCreator) return;
    Alert.alert(
      'Cancel this bill?',
      'The bill will be marked cancelled and moved to History. This cannot be undone.',
      [
        { text: 'Keep bill', style: 'cancel' },
        {
          text: 'Cancel bill',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelBillRemote();
              navigation.navigate('SplitGoHome');
            } catch (e) { Alert.alert('Could not cancel', e.message); }
          },
        },
      ],
    );
  };

  const itemsClaimedByName = (name) =>
    items.filter(it => (claims[it.id] || []).includes(name));

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

  const displayItemName = (it) => {
    if (!activeLang) return it.name;
    return translations[activeLang]?.[it.id] || it.name;
  };

  const receiptUri = receiptUrl && (receiptUrl.startsWith('http') || receiptUrl.startsWith('data:'))
    ? receiptUrl
    : null;

  const addableContacts = useMemo(
    () => contacts.filter(c => !billParticipantNames.includes(c.name)),
    [contacts, billParticipantNames],
  );

  const onRemoveParticipant = (name) => {
    if (name === billCreator) return;
    Alert.alert(
      'Remove from bill?',
      `${name} will be removed and their claims cleared.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSavingParts(true);
            try {
              await updateBillParticipants({ remove: [name] });
            } catch (e) {
              Alert.alert('Could not update', e.message);
            } finally {
              setSavingParts(false);
            }
          },
        },
      ],
    );
  };

  const onAddParticipant = async (name) => {
    setSavingParts(true);
    try {
      await updateBillParticipants({ add: [name] });
    } catch (e) {
      Alert.alert('Could not add', e.message);
    } finally {
      setSavingParts(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title={isCreatorDevice ? 'Bill group created' : 'Live bill'}
          subtitle={
            isCreatorDevice
              ? 'Waiting for friends to claim their items'
              : `${billCreator || 'Host'} is collecting · you can watch progress here`
          }
          onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('SplitGoHome'))}
        />
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Share / code card */}
        <LinearGradient
          colors={[SG.primary, SG.primaryDeep]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.shareCard}
        >
          <View style={styles.shareTop}>
            <View>
              <Text style={styles.shareLabel}>BILL CODE</Text>
              <Text style={styles.billCode}>{billId || '—'}</Text>
            </View>
            <View style={styles.qrBox}>
              <Svg width="56" height="56" viewBox="0 0 56 56">
                <Rect x="0" y="0" width="56" height="56" fill="#fff" rx="6" />
                {[...Array(7)].map((_, r) =>
                  [...Array(7)].map((_, c) => {
                    const on = (r * 7 + c * 3 + (billId?.charCodeAt(c % (billId?.length || 1)) || 0)) % 3 === 0;
                    return on ? (
                      <Rect key={`${r}-${c}`} x={4 + c * 7} y={4 + r * 7} width="6" height="6" fill={SG.primary} />
                    ) : null;
                  })
                )}
                <Rect x="3" y="3" width="14" height="14" fill="none" stroke={SG.primary} strokeWidth="2" />
                <Rect x="39" y="3" width="14" height="14" fill="none" stroke={SG.primary} strokeWidth="2" />
                <Rect x="3" y="39" width="14" height="14" fill="none" stroke={SG.primary} strokeWidth="2" />
                <Rect x="7" y="7" width="6" height="6" fill={SG.primary} />
                <Rect x="43" y="7" width="6" height="6" fill={SG.primary} />
                <Rect x="7" y="43" width="6" height="6" fill={SG.primary} />
              </Svg>
            </View>
          </View>
          <Text style={styles.shareLink} numberOfLines={1}>{shareLink}</Text>
          {isCreatorDevice ? (
            <View style={styles.shareBtnRow}>
              <TouchableOpacity onPress={handleShare} style={styles.shareBtn} activeOpacity={0.85}>
                <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <Path d="M7 1v8M3 5l4-4 4 4M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={styles.shareBtnText}>Share link</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCopyCode} style={styles.shareBtn2} activeOpacity={0.85}>
                <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <Rect x="3" y="3" width="8" height="10" rx="1" stroke="#fff" strokeWidth="1.5" />
                  <Path d="M5 5h4M5 7h4M5 9h2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
                </Svg>
                <Text style={styles.shareBtn2Text}>Copy code</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.readOnlyHint}>Only the bill creator can share or edit the group.</Text>
          )}
        </LinearGradient>

        {/* Receipt thumbnail */}
        {receiptUri && (
          <TouchableOpacity
            style={styles.receiptCard}
            activeOpacity={0.9}
            onPress={() => setShowReceipt(true)}
          >
            <Image source={{ uri: receiptUri }} style={styles.receiptThumb} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.receiptTitle}>Receipt</Text>
              <Text style={styles.receiptSub}>Tap to view full image</Text>
            </View>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Path d="M5 3l4 4-4 4" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Progress */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.progressLabel}>PEOPLE CLAIMED</Text>
              <Text style={styles.progressNum}>
                {participantProgress.done}<Text style={styles.progressTotal}> / {participantProgress.total}</Text>
              </Text>
              <Text style={styles.progressSub}>
                {claimProgress.claimed} of {claimProgress.total} items claimed
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.collectedLabel}>RUNNING TOTAL</Text>
              <Text style={styles.collectedAmt}>{sym} {totalAmount.toFixed(2)}</Text>
              <Text style={styles.collectedSub}>updates live</Text>
            </View>
          </View>
          <View style={styles.progressBar}>
            <LinearGradient
              colors={[SG.primary, SG.accent]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${claimProgress.percent * 100}%` }]}
            />
          </View>
        </View>

        {/* Translation — available to everyone on the bill */}
        {items.length > 0 && (
          <View style={styles.langRow}>
            <Text style={styles.langLabel}>Translate items</Text>
            <View style={styles.langChips}>
              {SUPPORTED_LANGS.map(l => {
                const active = activeLang === l.code;
                return (
                  <TouchableOpacity
                    key={l.code}
                    onPress={() => handleLangToggle(l.code)}
                    disabled={langLoading}
                    style={[styles.langChip, active && styles.langChipActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{l.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {langLoading && <ActivityIndicator size="small" color={SG.primary} style={{ marginTop: 6 }} />}
          </View>
        )}

        {/* Inline item picker — tap to claim/unclaim for `viewer` */}
        {items.length > 0 && (
          <>
            <View style={styles.itemsHeader}>
              <Text style={styles.sectionTitle}>Pick the items you ate</Text>
              <View style={styles.myPickPill}>
                <Text style={styles.myPickPillText}>
                  {myItemCount} picked · {sym} {myAmount.toFixed(2)}
                </Text>
              </View>
            </View>
            {billStatus === BILL_STATUS.OPEN && (
              <Text style={styles.itemsHint}>
                {myReady
                  ? `You\u2019re ready. Tap an item to edit your picks (will un-ready you).`
                  : `Tap items you had. Mark yourself ready when done.`}
              </Text>
            )}
            <View style={styles.listCard}>
              {items.map((it, i) => {
                const claimers = claims[it.id] || [];
                const mine = claimers.includes(viewer);
                const sharedBy = claimers.length;
                const sharedAmt = sharedBy > 0 ? (it.qty * it.unit) / sharedBy : it.qty * it.unit;
                return (
                  <TouchableOpacity
                    key={it.id}
                    activeOpacity={0.75}
                    onPress={() => onToggleItem(it.id)}
                    disabled={billStatus !== BILL_STATUS.OPEN}
                    style={[styles.itemPickRow, i < items.length - 1 && styles.rowBorder]}
                  >
                    <View style={[styles.checkbox, mine && styles.checkboxOn, mine && { borderColor: colorFor(viewer) || SG.primary, backgroundColor: colorFor(viewer) || SG.primary }]}>
                      {mine && (
                        <Svg width="12" height="12" viewBox="0 0 12 12">
                          <Path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      )}
                    </View>
                    <Text style={styles.itemQtyLite}>{it.qty}×</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemNameLite}>{displayItemName(it)}</Text>
                      <Text style={styles.itemMetaLite}>
                        {sym} {(it.qty * it.unit).toFixed(2)}
                        {sharedBy > 1 && ` · split ${sharedBy} ways · ${sym} ${sharedAmt.toFixed(2)} each`}
                      </Text>
                      {claimers.length > 0 && (
                        <View style={styles.claimerRow}>
                          {claimers.slice(0, 6).map(n => (
                            <View key={n} style={styles.claimerChip}>
                              <View style={[styles.claimerDot, { backgroundColor: colorFor(n) }]} />
                              <Text style={styles.claimerName}>{n === viewer ? 'You' : n}</Text>
                            </View>
                          ))}
                          {claimers.length > 6 && (
                            <Text style={styles.claimerMore}>+{claimers.length - 6}</Text>
                          )}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Creator: manage who is on the bill */}
        {isCreatorDevice && billStatus === BILL_STATUS.OPEN && (
          <TouchableOpacity style={styles.manageBtn} onPress={() => setManageOpen(true)} activeOpacity={0.85}>
            <Svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <Circle cx="8" cy="5" r="2.5" stroke={SG.primary} strokeWidth="1.5" />
              <Path d="M3 14v-1a3 3 0 013-3h4a3 3 0 013 3v1" stroke={SG.primary} strokeWidth="1.5" strokeLinecap="round" />
              <Path d="M12 5h2M13 4v2" stroke={SG.primary} strokeWidth="1.5" strokeLinecap="round" />
            </Svg>
            <Text style={styles.manageBtnText}>Add or remove people</Text>
          </TouchableOpacity>
        )}

        {/* Participants */}
        <Text style={styles.sectionTitle}>Participants ({readyCount}/{billParticipantNames.length} ready)</Text>
        <View style={styles.listCard}>
          {rosterNames.map((name, i) => {
            const isPayerRow = name === billCreator;
            const isViewer = name === viewer;
            const cnt = itemsClaimedByName(name).length;
            const owe = perPersonTotals[name] || 0;
            const isReady = ready.includes(name);
            const isPaid  = paid.includes(name);
            let label;
            const itemSummary = cnt > 0
              ? `${cnt} item${cnt > 1 ? 's' : ''} · ${sym} ${owe.toFixed(2)}`
              : 'no items';
            if (isPaid)        label = `Paid · ${itemSummary}`;
            else if (isReady)  label = `Ready · ${itemSummary}`;
            else if (cnt > 0)  label = `Picked ${itemSummary}`;
            else               label = 'Waiting to pick…';
            return (
              <View key={name} style={[styles.row, i < rosterNames.length - 1 && styles.rowBorder]}>
                <View style={{ position: 'relative' }}>
                  <View style={[styles.colorRing, { borderColor: colorFor(name) }]}>
                    <TngAvatar size={36} />
                  </View>
                  {isReady && (
                    <View style={styles.statusDot}>
                      <Svg width="8" height="8" viewBox="0 0 8 8">
                        <Path d="M1 4l2 2 4-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.rowName}>
                      {isViewer ? `${name} (you)` : name}
                    </Text>
                    {isPayerRow && (
                      <View style={styles.payerBadge}><Text style={styles.payerBadgeText}>PAYER</Text></View>
                    )}
                  </View>
                  <Text style={styles.rowMeta}>{label}</Text>
                </View>
                {isPaid ? (
                  <View style={[styles.statusPill, styles.statusPillPaid]}>
                    <Text style={[styles.statusPillText, { color: SG.success }]}>PAID</Text>
                  </View>
                ) : isReady ? (
                  <View style={[styles.statusPill, styles.statusPillReady]}>
                    <Text style={[styles.statusPillText, { color: SG.primary }]}>READY</Text>
                  </View>
                ) : cnt > 0 ? (
                  <View style={[styles.statusPill, styles.statusPillPending]}>
                    <Text style={[styles.statusPillText, { color: SG.accentDeep }]}>PICKING</Text>
                  </View>
                ) : (
                  <View style={[styles.statusPill, styles.statusPillPending]}>
                    <Text style={[styles.statusPillText, { color: SG.muted }]}>WAITING</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Creator-only ledger: every confirmed payment lands here, summing
            into "received so far". This is the payer's running receipt. */}
        {viewerIsCreator && (
          <View style={styles.receivedCard}>
            <View style={styles.receivedHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.receivedLabel}>PAYMENTS RECEIVED</Text>
                <Text style={styles.receivedTotal}>
                  {sym} {transactions.reduce((s, t) => s + (t.amount || 0), 0).toFixed(2)}
                </Text>
                <Text style={styles.receivedSub}>
                  {transactions.length} of {nonCreatorNames.length} friend{nonCreatorNames.length === 1 ? '' : 's'} paid
                </Text>
              </View>
              <View style={styles.receivedIcon}>
                <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <Path d="M12 2v20M5 9l7-7 7 7" stroke={SG.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </View>
            {transactions.length === 0 ? (
              <Text style={styles.receivedEmpty}>
                No payments yet. Friends will appear here as soon as they tap "Confirm I've paid".
              </Text>
            ) : (
              <View style={styles.receivedList}>
                {transactions
                  .slice()
                  .sort((a, b) => (b.at || 0) - (a.at || 0))
                  .map((t, idx) => {
                    const txCcy = (t.currency || displayCurrency || 'MYR').toUpperCase();
                    const symFor = CCY_SYMBOL[txCcy] || sym;
                    const when = t.at ? new Date(t.at) : null;
                    const whenStr = when
                      ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '';
                    return (
                      <View key={`${t.from}-${t.at || idx}`} style={[styles.receivedRow, idx > 0 && styles.rowBorder]}>
                        <View style={[styles.receivedDot, { backgroundColor: colorFor(t.from) }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.receivedName}>{t.from} paid you</Text>
                          {whenStr ? <Text style={styles.receivedWhen}>{whenStr}</Text> : null}
                        </View>
                        <Text style={styles.receivedAmt}>+{symFor} {Number(t.amount || 0).toFixed(2)}</Text>
                      </View>
                    );
                  })}
              </View>
            )}
          </View>
        )}

        <View style={styles.tipCard}>
          <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <Path d="M7 1l1.5 3.5L12 6l-2.5 2.5.5 3.5L7 10l-3 1.5.5-3.5L2 6l3.5-.5L7 2z" fill={SG.accent} />
          </Svg>
          <Text style={styles.tipText}>
            {viewerIsCreator
              ? 'The bill settles automatically the moment your last friend pays — nothing to press.'
              : everyoneReady
                ? `${billCreator} is collecting. Pay your share to settle.`
                : 'Tap items you had, then mark yourself Ready. The Pay button unlocks once everyone is Ready.'}
          </Text>
        </View>

        {/* Creator-only: cancel a bill created by mistake */}
        {isCreatorDevice && billStatus === BILL_STATUS.OPEN && (
          <TouchableOpacity onPress={handleCancelBill} activeOpacity={0.7} style={styles.cancelLink}>
            <Text style={styles.cancelLinkText}>Created by mistake?  <Text style={styles.cancelLinkAction}>Cancel this bill</Text></Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {isCreatorDevice && <UserSwitcher />}

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {billStatus !== BILL_STATUS.OPEN ? (
          <PillBtn onPress={() => navigation.navigate(billStatus === BILL_STATUS.CLOSED ? 'Summary' : 'SplitGoHome')}>
            {billStatus === BILL_STATUS.CLOSED ? 'View settlement' : 'Back to SplitGo'}
          </PillBtn>
        ) : !myReady ? (
          <PillBtn onPress={handleReadyPress} disabled={confirmingReady}>
            {myItemCount > 0
              ? `I\u2019m done picking · ${sym} ${myAmount.toFixed(2)}`
              : 'I\u2019m done picking'}
          </PillBtn>
        ) : !everyoneReady ? (
          <>
            <PillBtn variant="ghost" onPress={handleReadyPress} disabled={confirmingReady}>
              Waiting for others ({readyCount}/{billParticipantNames.length})  ·  Edit my picks
            </PillBtn>
          </>
        ) : viewerIsCreator ? (
          <>
            {allOthersPaid ? (
              <View style={styles.autoSettling}>
                <ActivityIndicator size="small" color={SG.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.autoSettlingTitle}>All friends paid · settling automatically</Text>
                  <Text style={styles.autoSettlingSub}>Taking you to the receipt…</Text>
                </View>
              </View>
            ) : (
              <View style={styles.waitingPill}>
                <View style={styles.waitingDot} />
                <Text style={styles.waitingText}>
                  Waiting for friends to pay  ·  {paidCount}/{nonCreatorNames.length} settled
                </Text>
              </View>
            )}
            {!allOthersPaid && (
              <TouchableOpacity onPress={handleForceClose} activeOpacity={0.7} style={styles.escapeHatch}>
                <Text style={styles.escapeHatchText}>
                  Friends taking forever?  <Text style={styles.escapeHatchLink}>Force close →</Text>
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : !myPaid ? (
          <PillBtn onPress={() => setPayConfirmOpen(true)}>
            Pay {sym} {myAmount.toFixed(2)} to {billCreator}
          </PillBtn>
        ) : (
          <PillBtn variant="ghost" onPress={() => navigation.navigate('SplitGoHome')}>
            Paid · Waiting for others to settle
          </PillBtn>
        )}
      </SafeAreaView>

      <Modal
        visible={showReceipt}
        animationType="fade"
        onRequestClose={() => setShowReceipt(false)}
      >
        <View style={styles.modalBg}>
          {receiptUri ? (
            <Image
              source={{ uri: receiptUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              onError={(e) => console.warn('[receipt] image load failed', e.nativeEvent)}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={styles.modalEmptyText}>No receipt available</Text>
            </View>
          )}
          <SafeAreaView style={styles.modalCloseSafe} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setShowReceipt(false)}
              activeOpacity={0.8}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={payConfirmOpen} animationType="fade" transparent onRequestClose={() => !payConfirming && setPayConfirmOpen(false)}>
        <View style={styles.payModalBg}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !payConfirming && setPayConfirmOpen(false)} />
          <View style={styles.paySheet}>
            <Text style={styles.payTitle}>Confirm payment</Text>
            <Text style={styles.paySub}>
              You\u2019re about to mark yourself as paid. Make sure you\u2019ve sent the money to {billCreator || 'the bill creator'}.
            </Text>
            <View style={styles.payAmountBox}>
              <Text style={styles.payAmountLabel}>YOUR SHARE</Text>
              <Text style={styles.payAmount}>{sym} {myAmount.toFixed(2)}</Text>
              <Text style={styles.payAmountMeta}>{myItemCount} item{myItemCount === 1 ? '' : 's'} picked</Text>
            </View>
            <PillBtn onPress={confirmPay} disabled={payConfirming}>
              {payConfirming ? 'Confirming…' : `Confirm I\u2019ve paid ${sym} ${myAmount.toFixed(2)}`}
            </PillBtn>
            <TouchableOpacity onPress={() => !payConfirming && setPayConfirmOpen(false)} style={styles.payCancelBtn} activeOpacity={0.7}>
              <Text style={styles.payCancelText}>Not yet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Wallet success sheet — appears only when the signed-in user has just
          paid. Surfaces the exact deduction and the wallet's new balance so
          the experience matches a real e-wallet payment. */}
      <Modal
        visible={!!paySuccess}
        animationType="fade"
        transparent
        onRequestClose={() => setPaySuccess(null)}
      >
        <View style={styles.payModalBg}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPaySuccess(null)} />
          <View style={styles.paySheet}>
            <View style={styles.successCheck}>
              <Svg width="34" height="34" viewBox="0 0 34 34">
                <Circle cx="17" cy="17" r="15" fill={SG.success} />
                <Path d="M10 17l5 5 9-10" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
            <Text style={[styles.payTitle, { textAlign: 'center' }]}>Payment sent</Text>
            <Text style={[styles.paySub, { textAlign: 'center' }]}>
              {billCreator ? `${billCreator} has been notified.` : 'The bill creator has been notified.'}
            </Text>
            <View style={styles.deductedBox}>
              <Text style={styles.deductedLabel}>DEDUCTED FROM YOUR WALLET</Text>
              <Text style={styles.deductedAmt}>
                − {paySuccess?.currency || sym} {Number(paySuccess?.amount || 0).toFixed(2)}
              </Text>
            </View>
            {typeof paySuccess?.newBalance === 'number' && (
              <View style={styles.balanceBox}>
                <Text style={styles.balanceLabel}>NEW BALANCE</Text>
                <Text style={styles.balanceAmt}>
                  {paySuccess?.currency || sym} {Number(paySuccess.newBalance).toFixed(2)}
                </Text>
              </View>
            )}
            <PillBtn onPress={() => setPaySuccess(null)}>Done</PillBtn>
          </View>
        </View>
      </Modal>

      <Modal visible={manageOpen} animationType="slide" transparent onRequestClose={() => setManageOpen(false)}>
        <View style={styles.manageModalBg}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => !savingParts && setManageOpen(false)} />
          <View style={styles.manageSheet}>
            <Text style={styles.manageTitle}>People on this bill</Text>
            <Text style={styles.manageSub}>Remove someone or add from your contacts. Changes sync instantly.</Text>
            {savingParts && <ActivityIndicator style={{ marginVertical: 8 }} color={SG.primary} />}
            <Text style={styles.manageSection}>Current</Text>
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
              {rosterNames.map(name => (
                <View key={name} style={styles.manageRow}>
                  <Text style={styles.manageName}>{name}{name === billCreator ? ' · payer' : ''}</Text>
                  {name !== billCreator && (
                    <TouchableOpacity onPress={() => onRemoveParticipant(name)} disabled={savingParts}>
                      <Text style={styles.manageRemove}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
            <Text style={[styles.manageSection, { marginTop: 12 }]}>Add from contacts</Text>
            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
              {addableContacts.length === 0 && (
                <Text style={styles.manageEmpty}>Everyone in your directory is already on this bill.</Text>
              )}
              {addableContacts.map(c => (
                <TouchableOpacity
                  key={c.contactId}
                  style={styles.manageRow}
                  onPress={() => onAddParticipant(c.name)}
                  disabled={savingParts}
                  activeOpacity={0.7}
                >
                  <Text style={styles.manageName}>{c.name}</Text>
                  <Text style={styles.manageAdd}>Add</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <PillBtn variant="ghost" onPress={() => setManageOpen(false)}>Done</PillBtn>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 140 },

  readOnlyHint: {
    marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 16,
  },

  shareCard: {
    borderRadius: 20, padding: 18, marginBottom: 14, overflow: 'hidden',
  },
  shareTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shareLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 0.5 },
  billCode: { fontSize: 28, color: '#fff', fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  qrBox: {
    marginLeft: 'auto', backgroundColor: '#fff', borderRadius: 8, padding: 4,
  },
  shareLink: {
    marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, fontFamily: 'Courier',
  },
  shareBtnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#fff', height: 40, borderRadius: 999,
  },
  shareBtnText: { color: SG.primary, fontWeight: '700', fontSize: 13 },
  shareBtn2: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)', height: 40, paddingHorizontal: 16, borderRadius: 999,
  },
  shareBtn2Text: { color: '#fff', fontWeight: '700', fontSize: 13 },

  receiptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 14, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: SG.line,
  },
  receiptThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: SG.bg },
  receiptTitle: { fontSize: 14, fontWeight: '700', color: SG.ink },
  receiptSub: { fontSize: 11, color: SG.muted, marginTop: 2 },

  progressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: SG.successSoft, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, marginBottom: 8,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SG.success },
  liveText: { fontSize: 9, fontWeight: '800', color: SG.success, letterSpacing: 0.4 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  progressLabel: { fontSize: 10, color: SG.muted, fontWeight: '700', letterSpacing: 0.4 },
  progressNum: { fontSize: 26, fontWeight: '700', color: SG.ink, letterSpacing: -0.6, marginTop: 2 },
  progressTotal: { fontSize: 18, color: SG.muted, fontWeight: '600' },
  progressSub: { fontSize: 11, color: SG.muted, marginTop: 1 },
  collectedLabel: { fontSize: 10, color: SG.muted, fontWeight: '700', letterSpacing: 0.4 },
  collectedAmt: { fontSize: 18, fontWeight: '700', color: SG.primary, marginTop: 2 },
  collectedSub: { fontSize: 10, color: SG.muted, marginTop: 1 },
  progressBar: { height: 8, backgroundColor: SG.bg, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  langRow: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: SG.line,
  },
  langLabel: { fontSize: 11, fontWeight: '700', color: SG.muted, marginBottom: 8 },
  langChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: SG.bg, borderWidth: 1, borderColor: SG.line,
  },
  langChipActive: { backgroundColor: SG.primarySoft, borderColor: SG.primary },
  langChipText: { fontSize: 12, fontWeight: '600', color: SG.ink2 },
  langChipTextActive: { color: SG.primary },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: SG.ink, marginBottom: 8, marginLeft: 4 },
  listCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  itemRowLite: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  itemQtyLite: { fontSize: 12, fontWeight: '800', color: SG.ink2, width: 28 },
  itemNameLite: { fontSize: 13, fontWeight: '600', color: SG.ink },
  itemMetaLite: { fontSize: 11, color: SG.muted, marginTop: 2 },

  itemsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, marginLeft: 4 },
  myPickPill: {
    backgroundColor: SG.primarySoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  myPickPillText: { fontSize: 11, fontWeight: '800', color: SG.primary, letterSpacing: 0.2 },
  itemsHint: { fontSize: 11, color: SG.muted, marginLeft: 4, marginBottom: 8 },
  itemPickRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: SG.line,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  checkboxOn: { borderColor: SG.primary, backgroundColor: SG.primary },
  claimerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  claimerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: SG.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  claimerDot: { width: 8, height: 8, borderRadius: 4 },
  claimerName: { fontSize: 10, fontWeight: '700', color: SG.ink2 },
  claimerMore: { fontSize: 10, fontWeight: '700', color: SG.muted, alignSelf: 'center' },

  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: SG.primarySoft, padding: 14, borderRadius: 12, marginBottom: 14,
  },
  manageBtnText: { fontSize: 14, fontWeight: '700', color: SG.primary },

  row: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: SG.line2 },
  colorRing: {
    borderWidth: 2, borderRadius: 22, padding: 1,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowName: { fontSize: 14, fontWeight: '600', color: SG.ink },
  rowMeta: { fontSize: 11, color: SG.muted, marginTop: 2 },
  payerBadge: { backgroundColor: SG.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  payerBadgeText: { fontSize: 9, fontWeight: '800', color: SG.primary, letterSpacing: 0.3 },
  statusDot: {
    position: 'absolute', bottom: -2, right: -2, width: 14, height: 14,
    borderRadius: 7, backgroundColor: SG.success,
    borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  statusPillDone: { backgroundColor: SG.successSoft },
  statusPillPending: { backgroundColor: SG.accentSoft },
  statusPillReady: { backgroundColor: SG.primarySoft },
  statusPillPaid:  { backgroundColor: SG.successSoft },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  cancelLink: { alignItems: 'center', paddingTop: 16 },
  cancelLinkText: { fontSize: 12, color: SG.muted, fontWeight: '500' },
  cancelLinkAction: { color: '#B91C1C', fontWeight: '700' },

  payModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  paySheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 28,
  },
  payTitle: { fontSize: 20, fontWeight: '800', color: SG.ink, marginBottom: 6 },
  paySub: { fontSize: 13, color: SG.muted, lineHeight: 18, marginBottom: 14 },
  payAmountBox: {
    backgroundColor: SG.primarySoft, borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 14,
  },
  payAmountLabel: { fontSize: 10, fontWeight: '800', color: SG.primary, letterSpacing: 0.5 },
  payAmount:      { fontSize: 32, fontWeight: '800', color: SG.primary, marginTop: 4, letterSpacing: -1 },
  payAmountMeta:  { fontSize: 11, color: SG.primary, marginTop: 4 },
  payCancelBtn: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  payCancelText: { fontSize: 13, color: SG.muted, fontWeight: '600' },

  successCheck: { alignSelf: 'center', marginBottom: 8 },
  deductedBox: {
    backgroundColor: '#FEF3F2', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#FECACA',
  },
  deductedLabel: { fontSize: 10, fontWeight: '800', color: '#991B1B', letterSpacing: 0.5 },
  deductedAmt:   { fontSize: 26, fontWeight: '800', color: '#B91C1C', marginTop: 4, letterSpacing: -0.5 },
  balanceBox: {
    backgroundColor: SG.bg, borderRadius: 14, padding: 14,
    alignItems: 'center', marginBottom: 14,
    borderWidth: 1, borderColor: SG.line,
  },
  balanceLabel: { fontSize: 10, fontWeight: '800', color: SG.muted, letterSpacing: 0.5 },
  balanceAmt:   { fontSize: 22, fontWeight: '800', color: SG.ink, marginTop: 2, letterSpacing: -0.4 },

  receivedCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginTop: 14,
    borderWidth: 1, borderColor: SG.line,
  },
  receivedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  receivedIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: SG.successSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  receivedLabel: { fontSize: 10, fontWeight: '800', color: SG.muted, letterSpacing: 0.4 },
  receivedTotal: { fontSize: 22, fontWeight: '800', color: SG.success, marginTop: 2, letterSpacing: -0.4 },
  receivedSub:   { fontSize: 11, color: SG.muted, marginTop: 1 },
  receivedEmpty: {
    fontSize: 12, color: SG.muted, marginTop: 12, lineHeight: 16,
  },
  receivedList: { marginTop: 10 },
  receivedRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  receivedDot:  { width: 8, height: 8, borderRadius: 4 },
  receivedName: { fontSize: 13, fontWeight: '600', color: SG.ink },
  receivedWhen: { fontSize: 11, color: SG.muted, marginTop: 1 },
  receivedAmt:  { fontSize: 14, fontWeight: '800', color: SG.success },
  actionBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: SG.primary,
  },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 11 },

  tipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SG.accentSoft, borderRadius: 10, padding: 10, marginTop: 14,
  },
  tipText: { flex: 1, fontSize: 11, color: SG.accentDeep, lineHeight: 16 },

  footer: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: SG.line2,
  },
  escapeHatch: {
    alignItems: 'center', paddingTop: 10, paddingBottom: 4,
  },
  escapeHatchText: {
    fontSize: 12, color: SG.muted, fontWeight: '500',
  },
  escapeHatchLink: {
    color: SG.primary, fontWeight: '700',
  },

  autoSettling: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SG.successSoft,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  autoSettlingTitle: {
    fontSize: 14, fontWeight: '800', color: SG.success, letterSpacing: -0.2,
  },
  autoSettlingSub: {
    fontSize: 11, color: SG.success, marginTop: 2, opacity: 0.85,
  },

  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SG.bg,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: SG.line,
  },
  waitingDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: SG.accent,
  },
  waitingText: {
    fontSize: 13, fontWeight: '700', color: SG.ink2, letterSpacing: -0.1,
  },

  modalBg: { flex: 1, backgroundColor: '#000' },
  modalCloseSafe: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center',
  },
  modalClose: {
    marginBottom: 32,
    paddingHorizontal: 28, paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalCloseText: { color: '#000', fontWeight: '700', fontSize: 15 },
  modalEmptyText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  manageModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  manageSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 28, maxHeight: '85%',
  },
  manageTitle: { fontSize: 18, fontWeight: '800', color: SG.ink },
  manageSub: { fontSize: 12, color: SG.muted, marginTop: 4, marginBottom: 8 },
  manageSection: { fontSize: 11, fontWeight: '800', color: SG.muted, letterSpacing: 0.4, marginBottom: 6 },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: SG.line2,
  },
  manageName: { fontSize: 14, fontWeight: '600', color: SG.ink, flex: 1 },
  manageRemove: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  manageAdd: { fontSize: 13, fontWeight: '700', color: SG.primary },
  manageEmpty: { fontSize: 12, color: SG.muted, paddingVertical: 8 },
});
