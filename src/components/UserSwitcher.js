import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
  Animated, PanResponder, useWindowDimensions,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';
import TngAvatar from './TngAvatar';

/**
 * Floating, DRAGGABLE "Demo" button that lets you switch which participant
 * the device is currently acting as. Used on BillCreatedScreen and ClaimScreen
 * to demo the multi-user flow on a single device for the hackathon.
 *
 * - Tap to open the participant picker
 * - Drag to reposition anywhere on screen (clamped to safe bounds)
 * - In production this component would be removed entirely.
 */
const FAB_SIZE = 56;
const TAP_THRESHOLD = 6; // total px of movement under which we treat the gesture as a tap

export default function UserSwitcher() {
  const { participants, currentUser, setCurrentUser, claims, billCreator } = useFlow();
  const [open, setOpen] = useState(false);
  const { width: screenW, height: screenH } = useWindowDimensions();

  const claimedItemsCount = (name) =>
    Object.values(claims).filter(arr => arr.includes(name)).length;

  // Initial resting spot: bottom-right, well clear of the close button + escape link
  const initialX = screenW - FAB_SIZE - 16;
  const initialY = screenH - FAB_SIZE - 180;

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const lastPos = useRef({ x: initialX, y: initialY });
  const dragDist = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragDist.current = 0;
        pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        {
          useNativeDriver: false,
          listener: (_e, g) => {
            const d = Math.hypot(g.dx, g.dy);
            if (d > dragDist.current) dragDist.current = d;
          },
        }
      ),
      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();
        const rawX = lastPos.current.x + g.dx;
        const rawY = lastPos.current.y + g.dy;
        // Clamp to keep the bubble fully on screen with comfortable margin
        const minY = 60;
        const maxY = screenH - FAB_SIZE - 40;
        const minX = 8;
        const maxX = screenW - FAB_SIZE - 8;
        const clampedX = Math.max(minX, Math.min(maxX, rawX));
        const clampedY = Math.max(minY, Math.min(maxY, rawY));

        Animated.spring(pan, {
          toValue: { x: clampedX, y: clampedY },
          useNativeDriver: false,
          friction: 7,
          tension: 60,
        }).start();
        lastPos.current = { x: clampedX, y: clampedY };

        // If user barely moved, treat as tap → open the picker
        if (dragDist.current < TAP_THRESHOLD) {
          setOpen(true);
        }
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  // First letter of current user, "P" when viewing as the bill's creator
  const initial = (currentUser === billCreator)
    ? 'P'
    : ((currentUser || '').trim()[0] || '?').toUpperCase();

  return (
    <>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.fab,
            {
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
              ],
            },
          ]}
        >
          <View style={styles.fabBadge}>
            <Text style={styles.fabBadgeText}>DEMO</Text>
          </View>
          <Text style={styles.fabInitial}>{initial}</Text>
          <View style={styles.fabSwapIcon}>
            <Svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <Path d="M1 3h6l-1.5-1.5M9 7H3l1.5 1.5" stroke="#1a1205" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        </Animated.View>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Switch demo user</Text>
            <Text style={styles.sheetSub}>
              Single-device demo. Pick whose phone the bill is on right now.
            </Text>

            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {participants.map(p => {
                const active = currentUser === p.name;
                const cnt = claimedItemsCount(p.name);
                const isCreator = p.name === billCreator;
                return (
                  <TouchableOpacity
                    key={p.name}
                    onPress={() => { setCurrentUser(p.name); setOpen(false); }}
                    style={[styles.row, active && styles.rowActive]}
                    activeOpacity={0.7}
                  >
                    <TngAvatar size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>
                        {isCreator ? `${p.name} (Payer)` : p.name}
                        {p.me ? ' · You' : ''}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {isCreator
                          ? 'Bill creator · sees live dashboard'
                          : cnt > 0
                            ? `Claimed ${cnt} item${cnt > 1 ? 's' : ''}`
                            : 'Has not claimed yet'}
                      </Text>
                    </View>
                    {active && (
                      <View style={styles.activeDot}>
                        <Svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <Path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.hintBox}>
              <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <Circle cx="7" cy="7" r="6" stroke={SG.primary} strokeWidth="1.4" />
                <Path d="M7 4v4M7 10h.01" stroke={SG.primary} strokeWidth="1.4" strokeLinecap="round" />
              </Svg>
              <Text style={styles.hintText}>
                Drag the bubble to reposition. Tap to switch user. In production
                each phone signs in as itself — this is a single-device demo aid.
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    top: 0, left: 0,
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8,
    elevation: 6,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)',
  },
  fabInitial: {
    color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4,
    lineHeight: 22,
  },
  fabBadge: {
    position: 'absolute', top: -6, left: -6,
    backgroundColor: SG.accent, borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 2, borderColor: '#fff',
  },
  fabBadgeText: { color: '#1a1205', fontWeight: '800', fontSize: 8, letterSpacing: 0.4 },
  fabSwapIcon: {
    position: 'absolute', bottom: -4, right: -4,
    backgroundColor: SG.accent, borderRadius: 999,
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
  },
  sheetHandle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: SG.line, marginBottom: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: SG.ink, letterSpacing: -0.3 },
  sheetSub: { fontSize: 12, color: SG.muted, marginTop: 4, marginBottom: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12,
  },
  rowActive: { backgroundColor: SG.primarySoft },
  rowName: { fontSize: 14, fontWeight: '600', color: SG.ink },
  rowMeta: { fontSize: 11, color: SG.muted, marginTop: 2 },
  activeDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  hintBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: SG.bg, borderRadius: 10, padding: 10, marginTop: 12,
  },
  hintText: { flex: 1, fontSize: 11, color: SG.muted, lineHeight: 16 },
});
