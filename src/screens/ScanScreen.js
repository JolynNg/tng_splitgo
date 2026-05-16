import React, { useState, useRef, useEffect } from 'react';
import { useRoute } from '@react-navigation/native';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Animated, Easing,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { SG } from '../tokens';
import { extractReceiptItems } from '../api/extractReceipt';
import { uploadReceipt } from '../api/uploadService';
import { convertAmountsToMyr } from '../api/fxService';
import { useFlow } from '../context/FlowContext';

// A short, calm sequence of status lines shown one at a time during the
// scan. Apple Pay / Stripe / ChatGPT-style: a single sentence that morphs
// into the next as work progresses — no checklists, no jargon, no boxes.
const STAGES = [
  { key: 'compress', label: 'Sharpening your photo', target: 0.12 },
  { key: 'ocr',      label: 'Reading your receipt',  target: 0.55 },
  { key: 'extract',  label: 'Sorting out the items', target: 0.85 },
  { key: 'done',     label: 'Almost there',          target: 0.96 },
];

/**
 * A single status line that crossfades when the label changes — the only
 * UI element shown while OCR runs. Inspired by Apple Pay / Stripe processing
 * states: one calm sentence that morphs into the next.
 */
function StatusLine({ label }) {
  const fade  = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    fade.setValue(0);
    slide.setValue(6);
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [label]);

  return (
    <Animated.Text
      style={[styles.statusText, { opacity: fade, transform: [{ translateY: slide }] }]}
    >
      {label}
    </Animated.Text>
  );
}

/**
 * A single pulsing dot used in the "•••" indicator. Three of these with
 * staggered delays make a calm typing-style breath under the status text.
 */
function Dot({ delay = 0 }) {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1,   duration: 480, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 480, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[styles.dot, { opacity: v }]} />;
}

export default function ScanScreen({ navigation }) {
  const route = useRoute();
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  // While set, we render the captured photo as a static Image overlay
  // instead of the live CameraView so the receipt stops "moving" with the
  // device. This is what the user wants — a frozen preview while AI runs.
  const [capturedUri, setCapturedUri] = useState(null);
  const cameraRef = useRef(null);
  const scanAnim     = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const {
    setItems, setReceiptMeta, setReceiptKey, setReceiptUrl, resetFlow,
    setTravelBillMeta, clearTravelBillMeta,
  } = useFlow();

  // Animate the scan line when processing
  useEffect(() => {
    if (processing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(scanAnim, { toValue: 0, duration: 0,    useNativeDriver: true }),
        ])
      ).start();
    } else {
      scanAnim.stopAnimation();
      scanAnim.setValue(0);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
    }
  }, [processing]);


  const scanY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-240, 240],
  });

  // Animate the progress bar to whatever target % the current stage demands.
  // We never let it hit 100% before the OCR resolves — feels jankier to see
  // the bar lock at 100% then nothing happen than to ease into it.
  const animateProgressTo = (target, duration = 600) => {
    Animated.timing(progressAnim, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };
  const goToStage = (key) => {
    const idx = STAGES.findIndex(s => s.key === key);
    if (idx === -1) return;
    setStageIndex(idx);
    animateProgressTo(STAGES[idx].target);
  };

  /**
   * Resize the captured photo before we ship it to Qwen-VL OCR. A 12 MP iPhone
   * photo (~4032×3024) is overkill for OCR and balloons the base64 payload
   * to several MB. Down-scaling to ~1600px wide:
   *   - Cuts the base64 size 4-6×, which makes the network round trip and
   *     the model's vision tower noticeably faster.
   *   - Still keeps every receipt character readable (1600px > 99% of
   *     printed receipts in real-world photos).
   * Failures (e.g. unsupported file URI on web) silently fall back to the
   * original base64 — accuracy beats speed.
   */
  const compressForOCR = async (uri, originalBase64) => {
    if (!uri) return originalBase64;
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      return result.base64 || originalBase64;
    } catch (err) {
      console.warn('[scan] image resize failed, falling back:', err?.message);
      return originalBase64;
    }
  };

  const processImage = async (rawBase64, uri = null) => {
    setProcessing(true);
    setStageIndex(0);
    progressAnim.setValue(0);
    if (uri) setCapturedUri(uri);
    // A fresh scan = a brand-new bill flow. Wipe any stale state from a
    // previously viewed history bill (loadedParticipants, claims, billId, ...)
    // so the upcoming Items/Participants/BillCreated flow starts clean.
    resetFlow();
    const tg = route.params?.travelGroupId;
    if (tg) {
      setTravelBillMeta({
        travelGroupId: tg,
        travelGroupName: route.params?.travelGroupName || '',
        travelParticipantNames: route.params?.travelParticipantNames || [],
      });
    } else {
      clearTravelBillMeta();
    }

    // Stage 1 — compress on-device. This typically takes <500ms.
    goToStage('compress');
    const base64 = await compressForOCR(uri, rawBase64);

    // Show a local preview immediately so the Summary thumbnail works even
    // before S3 finishes. Once the upload completes we swap the data: URL
    // for the pre-signed S3 GET URL — the bucket has Block Public Access
    // on, so the plain publicUrl 403s and only the signed GET works.
    setReceiptKey(null);
    setReceiptUrl(`data:image/jpeg;base64,${base64}`);
    uploadReceipt(base64)
      .then(res => {
        if (res?.key)    setReceiptKey(res.key);
        if (res?.getUrl) setReceiptUrl(res.getUrl);
      })
      .catch(err => console.warn('[S3] receipt upload failed:', err.message));

    // Stage 2+ — the LLM call. We can't observe real progress mid-call, so
    // we time-shift through a couple of human-friendly status messages while
    // the request is in flight. If it resolves early we snap to 100%.
    goToStage('ocr');
    const fakeProgressTimers = [
      setTimeout(() => goToStage('extract'), 4000),
      setTimeout(() => goToStage('done'),    8500),
    ];

    try {
      const { restaurant, date, items, sst, serviceCharge, currency } = await extractReceiptItems(base64);
      fakeProgressTimers.forEach(clearTimeout);
      animateProgressTo(1, 350);
      let nextItems = items;
      let nextSst = sst;
      let nextServiceCharge = serviceCharge;
      let fxMeta = null;
      let fxFailed = false;
      const sourceCcy = String(currency || 'MYR').toUpperCase();
      if (sourceCcy !== 'MYR') {
        try {
          const amounts = [
            ...items.map((it) => Number(it.unit) || 0),
            Number(sst) || 0,
            Number(serviceCharge) || 0,
          ];
          const fx = await convertAmountsToMyr({ currency: sourceCcy, date, amounts });
          const rate = Number(fx.fxRateToMyr) || 0;
          // Reject a 1:1 result for a non-MYR receipt — that would render
          // foreign amounts as "RM <native>", which is the bug we just fixed.
          // Treat it like an FX failure and let the UI keep source currency.
          if (rate <= 0 || rate === 1) {
            throw new Error(`unusable FX rate (${rate}) for ${sourceCcy}->MYR`);
          }
          const converted = fx.amountsMyr || [];
          nextItems = items.map((it, idx) => ({
            ...it,
            sourceUnit: Number(it.unit) || 0,
            unit: Number(converted[idx] ?? it.unit) || 0,
          }));
          nextSst = Number(converted[items.length] ?? sst ?? 0);
          nextServiceCharge = Number(converted[items.length + 1] ?? serviceCharge ?? 0);
          fxMeta = {
            sourceCurrency: sourceCcy,
            sourceSst: Number(sst) || 0,
            sourceServiceCharge: Number(serviceCharge) || 0,
            fxRateToMyr: rate,
            fxDate: fx.fxDate || date || null,
          };
          console.log(`[scan] FX ${sourceCcy} -> MYR @ ${rate} (date ${fx.fxDate || date || 'today'})`);
        } catch (fxErr) {
          // Don't block the scan, but flag the failure so we can warn the user.
          fxFailed = true;
          console.warn('[scan] FX convert failed, keeping source currency:', fxErr?.message);
        }
      }

      setItems(nextItems);
      setReceiptMeta({
        restaurant,
        date,
        sst: nextSst,
        serviceCharge: nextServiceCharge,
        currency: fxMeta ? 'MYR' : sourceCcy,
        ...(fxMeta || {}),
      });

      if (fxFailed && sourceCcy !== 'MYR') {
        Alert.alert(
          `Showing amounts in ${sourceCcy}`,
          `We couldn't reach the FX provider to convert ${sourceCcy} to RM, so the items below are shown in the receipt's original currency. Please retry the scan if you want RM totals.`,
          [{ text: 'OK' }],
        );
      }

      // Tiny pause so the user sees the bar cap at 100% — feels finished,
      // not abrupt.
      setTimeout(() => {
        navigation.reset({
          index: 1,
          routes: [
            { name: 'SplitGoHome' },
            { name: 'Items' },
          ],
        });
      }, 200);
    } catch (err) {
      fakeProgressTimers.forEach(clearTimeout);
      Alert.alert(
        'Could not read receipt',
        err.message || 'Please try again with a clearer photo.',
        [{ text: 'OK' }],
      );
      setCapturedUri(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleCapture = async () => {
    if (!cameraRef.current || processing) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.7,
        skipProcessing: true,
      });
      await processImage(photo.base64, photo.uri);
    } catch {
      Alert.alert('Camera error', 'Could not take photo. Please try again.');
      setCapturedUri(null);
    }
  };

  const handleGallery = async () => {
    if (processing) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.base64) {
      await processImage(result.assets[0].base64, result.assets[0].uri);
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const currentStage = STAGES[stageIndex] || STAGES[0];

  // --- Permission gate ---
  if (!permission) {
    return <View style={styles.screen} />;
  }
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.permissionScreen]}>
        <StatusBar barStyle="light-content" />
        <Svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <Circle cx="24" cy="24" r="22" stroke="#fff" strokeWidth="2" opacity="0.4" />
          <Path d="M18 24a6 6 0 1012 0 6 6 0 00-12 0zM10 18c2-3 5-6 14-6s12 3 14 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </Svg>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>SplitGo needs the camera to scan your receipt</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.permBtn} activeOpacity={0.8}>
          <Text style={styles.permBtnText}>Allow camera</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.permBack} activeOpacity={0.8}>
          <Text style={styles.permBackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Main camera UI ---
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Live camera viewfinder — replaced by the captured still while
          processing so the preview doesn't sway with the phone. */}
      {capturedUri
        ? (
          <Image
            source={{ uri: capturedUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )
        : (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
          />
        )
      }

      {/* Dark vignette mask with scan-frame cutout */}
      <View style={styles.maskTop} />
      <View style={styles.maskBottom} />
      <View style={styles.maskLeft} />
      <View style={styles.maskRight} />

      {/* Scan frame corners */}
      <View style={styles.frameArea} pointerEvents="none">
        {corners.map(({ pos, transforms }, i) => (
          <View key={i} style={[styles.corner, pos]}>
            <Svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <Path
                d="M2 10V4a2 2 0 012-2h6"
                stroke={processing ? SG.accent : '#fff'}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </Svg>
          </View>
        ))}

        {/* Animated scan line */}
        {processing && (
          <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanY }] }]} />
        )}
      </View>

      {/* Blue top bar */}
      <SafeAreaView edges={['top']} style={styles.topOverlay}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Scan Receipt</Text>
          <View style={{ width: 32 }} />
        </View>

        <View style={styles.promoStrip}>
          <View style={styles.promoIcon}>
            <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <Path d="M7 1l1.5 3.5L12 6l-2.5 2.5.5 3.5L7 10l-3 1.5.5-3.5L2 6l3.5-.5L7 2z" fill={SG.accent} />
            </Svg>
          </View>
          <Text style={styles.promoText}>
            {processing ? 'Working on your receipt' : 'We\u2019ll pull the items out for you'}
          </Text>
          {processing && <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 4 }} />}
        </View>
      </SafeAreaView>

      {/* Idle: simple instruction. Processing: a single calm status line
          that morphs through stages — and a hairline progress bar pinned
          to the bottom so progress is felt without being shouted. */}
      {!processing ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Align receipt within the frame</Text>
        </View>
      ) : (
        <>
          <View style={styles.statusWrap} pointerEvents="none">
            <StatusLine label={currentStage.label} />
            <View style={styles.dots}>
              <Dot delay={0} />
              <Dot delay={160} />
              <Dot delay={320} />
            </View>
          </View>

          <View style={styles.bottomBarTrack} pointerEvents="none">
            <Animated.View style={[styles.bottomBarFill, { width: progressWidth }]} />
          </View>
        </>
      )}

      {/* Bottom controls — hidden during processing so they don't overlap
          the progress card. There's nothing useful to do mid-OCR anyway. */}
      {!processing && (
        <SafeAreaView edges={['bottom']} style={styles.bottomControls}>
          <View style={styles.shutterRow}>
            {/* Gallery */}
            <TouchableOpacity onPress={handleGallery} style={styles.galleryBtn} activeOpacity={0.8}>
              <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <Rect x="3" y="4" width="16" height="14" rx="2" stroke="#fff" strokeWidth="1.6" />
                <Circle cx="8" cy="9" r="1.6" fill="#fff" />
                <Path d="M3 15l4-4 5 5 3-3 4 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>

            {/* Shutter */}
            <TouchableOpacity
              onPress={handleCapture}
              style={styles.shutter}
              activeOpacity={0.8}
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            <View style={{ width: 52 }} />
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

// Frame dimensions (matches mask cutout below)
const FRAME = { top: 150, left: 30, right: 30, height: 480 };

const corners = [
  { pos: { top: 0, left: 0 },   transforms: [] },
  { pos: { top: 0, right: 0 },  transforms: [{ scaleX: -1 }] },
  { pos: { bottom: 0, left: 0 }, transforms: [{ scaleY: -1 }] },
  { pos: { bottom: 0, right: 0 }, transforms: [{ scaleX: -1 }, { scaleY: -1 }] },
];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  // Mask: four dark strips around the scan frame
  maskTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: FRAME.top, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  maskBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    top: FRAME.top + FRAME.height, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  maskLeft: {
    position: 'absolute', top: FRAME.top, bottom: 0,
    left: 0, width: FRAME.left,
    height: FRAME.height, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  maskRight: {
    position: 'absolute', top: FRAME.top,
    right: 0, width: FRAME.right,
    height: FRAME.height, backgroundColor: 'rgba(0,0,0,0.55)',
  },

  frameArea: {
    position: 'absolute',
    top: FRAME.top, left: FRAME.left, right: FRAME.right,
    height: FRAME.height,
    overflow: 'hidden',
  },
  corner: { position: 'absolute' },
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 3,
    backgroundColor: `${SG.accent}99`,
    top: '50%',
  },

  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    // Paint the safe-area inset (notch / status bar) the same blue as the
    // bar itself so the camera viewfinder never peeks through above it.
    backgroundColor: SG.primary,
  },
  topBar: {
    backgroundColor: SG.primary,
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: '#fff', fontWeight: '700', fontSize: 17 },
  promoStrip: {
    backgroundColor: SG.primaryDeep,
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  promoIcon: {
    width: 24, height: 24, borderRadius: 6, backgroundColor: `${SG.accent}33`,
    alignItems: 'center', justifyContent: 'center',
  },
  promoText: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1 },

  hintWrap: {
    position: 'absolute',
    top: FRAME.top + FRAME.height + 16,
    left: 0, right: 0, alignItems: 'center',
  },
  hint: { color: '#fff', fontSize: 13, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },

  // Minimal status block — a single line of text that morphs through
  // stages, with three pulsing dots underneath. Floats above the dimmed
  // mask, no card, no list. Inspired by Apple Pay / Stripe processing.
  statusWrap: {
    position: 'absolute',
    left: 0, right: 0, bottom: 96,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  statusText: {
    color: '#fff', fontSize: 19, fontWeight: '600', letterSpacing: -0.2,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 6,
  },
  dots: {
    marginTop: 14,
    flexDirection: 'row', gap: 6,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#fff',
  },

  // Hairline progress bar pinned to the bottom of the screen — felt, not
  // shown. No track behind it, just the colored fill creeping across.
  bottomBarTrack: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  bottomBarFill: {
    height: 2,
    backgroundColor: SG.accent,
  },

  bottomControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingTop: 20,
  },
  shutterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40,
    paddingBottom: 20,
  },
  galleryBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
    padding: 4, alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { flex: 1, borderRadius: 999, backgroundColor: '#fff' },

  // Permission screen
  permissionScreen: {
    backgroundColor: SG.primaryDeep, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40,
  },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 8 },
  permSub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  permBtn: {
    marginTop: 12, paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 999, backgroundColor: '#fff',
  },
  permBtnText: { color: SG.primary, fontWeight: '700', fontSize: 16 },
  permBack: { marginTop: 4 },
  permBackText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
});
