import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, StatusBar, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';
import { upsertTrip } from '../api/tripService';

/** Step 2 of travel setup — name the trip (after contacts on the previous page). */
export default function TravelTripNameScreen({ navigation, route }) {
  const safeBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('TravelPickContacts');
  };
  const { me } = useAuth();
  const selectedNames = route.params?.selectedNames;
  const [tripName, setTripName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onStartTrip = async () => {
    if (submitting) return;
    if (!me?.name) {
      Alert.alert('Sign in', 'Please sign in first.');
      return;
    }
    if (!Array.isArray(selectedNames) || selectedNames.length === 0) {
      Alert.alert('Missing people', 'Go back and choose at least one friend.');
      return;
    }
    const trimmed = tripName.trim();
    if (!trimmed) {
      Alert.alert('Trip name required', 'Enter a name so everyone recognises this trip.');
      return;
    }
    const travelGroupName = trimmed.slice(0, 40);
    const buddyNames = selectedNames.filter((n) => n !== me.name);
    const participantNames = [me.name, ...buddyNames];

    setSubmitting(true);
    try {
      const r = await upsertTrip({
        creator: me.name,
        travelGroupName,
        participantNames,
      });
      const trip = r?.trip;
      if (!trip?.travelGroupId) throw new Error('Server did not return a trip id.');
      navigation.reset({
        index: 2,
        routes: [
          { name: 'SplitGoHome' },
          { name: 'TravelGroups' },
          {
            name: 'TravelGroupHub',
            params: {
              travelGroupId: trip.travelGroupId,
              travelGroupName: trip.travelGroupName || travelGroupName,
              participantNames: trip.participantNames || participantNames,
            },
          },
        ],
      });
    } catch (e) {
      Alert.alert('Could not save trip', e?.message || 'Server error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Name your trip</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.content}>
          <Text style={styles.kicker}>Step 2 of 2</Text>
          <Text style={styles.title}>What should we call this trip?</Text>
          <Text style={styles.sub}>
            {Array.isArray(selectedNames) && selectedNames.length > 0
              ? `${1 + selectedNames.length} people on this trip · choose a name everyone recognises`
              : 'Choose a name everyone recognises'}
          </Text>

          <Text style={styles.fieldLabel}>Trip name (required)</Text>
          <TextInput
            value={tripName}
            onChangeText={setTripName}
            placeholder="e.g. Bangkok 2026"
            placeholderTextColor={SG.muted2}
            style={styles.input}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={onStartTrip}
          />

          <TouchableOpacity
            style={[styles.btn, (!tripName.trim() || submitting) && styles.btnDisabled]}
            onPress={onStartTrip}
            disabled={!tripName.trim() || submitting}
            activeOpacity={0.88}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Start trip</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} />
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff' }} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  headerSafe: { backgroundColor: SG.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 17, marginRight: 40 },
  content: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 28,
  },
  kicker: {
    fontSize: 12, fontWeight: '700', color: SG.primary, letterSpacing: 0.6, marginBottom: 8,
  },
  title: {
    fontSize: 22, fontWeight: '800', color: SG.ink, letterSpacing: -0.3, lineHeight: 28,
  },
  sub: {
    fontSize: 14, color: SG.muted, marginTop: 8, lineHeight: 20, marginBottom: 28,
  },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: SG.muted, letterSpacing: 0.4, marginBottom: 8,
  },
  input: {
    borderWidth: 1.5, borderColor: SG.line2, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 17, color: SG.ink, fontWeight: '600',
  },
  btn: {
    marginTop: 22, height: 52, borderRadius: 999, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { backgroundColor: SG.muted2, opacity: 0.85 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
