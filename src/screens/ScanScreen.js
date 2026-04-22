import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { SG } from '../tokens';
import { extractReceiptItems } from '../api/extractReceipt';
import { useFlow } from '../context/FlowContext';

// Processing status labels shown during the AI pipeline
const STAGES = [
  'Capturing receipt…',
  'Running OCR…',
  'Extracting items with AI…',
  'Almost done…',
];

export default function ScanScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const cameraRef = useRef(null);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const { setItems, setReceiptMeta } = useFlow();

  // Animate the scan line when processing
  useEffect(() => {
    if (processing) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(scanAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    } else {
      scanAnim.stopAnimation();
      scanAnim.setValue(0);
    }
  }, [processing]);

  // Cycle through stage labels during processing
  useEffect(() => {
    if (!processing) { setStageIndex(0); return; }
    const interval = setInterval(() => {
      setStageIndex(i => Math.min(i + 1, STAGES.length - 1));
    }, 1200);
    return () => clearInterval(interval);
  }, [processing]);

  const scanY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-240, 240],
  });

  const processImage = async (base64) => {
    setProcessing(true);
    try {
      const { restaurant, date, items, sst, serviceCharge } = await extractReceiptItems(base64);
      setItems(items);
      setReceiptMeta({ restaurant, date, sst, serviceCharge });
      navigation.navigate('Items');
    } catch (err) {
      Alert.alert(
        'Could not read receipt',
        err.message || 'Please try again with a clearer photo.',
        [{ text: 'OK' }],
      );
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
      await processImage(photo.base64);
    } catch {
      Alert.alert('Camera error', 'Could not take photo. Please try again.');
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
      await processImage(result.assets[0].base64);
    }
  };

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

      {/* Live camera viewfinder */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
      />

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
            {processing ? STAGES[stageIndex] : 'AI will extract items automatically'}
          </Text>
          {processing && <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 4 }} />}
        </View>
      </SafeAreaView>

      {/* Hint below frame */}
      <View style={styles.hintWrap} pointerEvents="none">
        <Text style={styles.hint}>
          {processing ? STAGES[stageIndex] : 'Align receipt within the frame'}
        </Text>
      </View>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomControls}>
        <View style={styles.shutterRow}>
          {/* Gallery */}
          <TouchableOpacity onPress={handleGallery} disabled={processing} style={styles.galleryBtn} activeOpacity={0.8}>
            <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <Rect x="3" y="4" width="16" height="14" rx="2" stroke="#fff" strokeWidth="1.6" />
              <Circle cx="8" cy="9" r="1.6" fill="#fff" />
              <Path d="M3 15l4-4 5 5 3-3 4 3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Shutter */}
          <TouchableOpacity
            onPress={handleCapture}
            disabled={processing}
            style={[styles.shutter, processing && styles.shutterDisabled]}
            activeOpacity={0.8}
          >
            {processing
              ? <ActivityIndicator color={SG.primary} size="large" />
              : <View style={styles.shutterInner} />
            }
          </TouchableOpacity>

          <View style={{ width: 52 }} />
        </View>
      </SafeAreaView>
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

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
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
  shutterDisabled: { borderColor: 'rgba(255,255,255,0.4)' },
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
