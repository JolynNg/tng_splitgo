import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, StatusBar,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';

/**
 * Phone-only login.
 *
 * Step 1 — phone:
 *   User types their phone number. We refresh the contacts directory and
 *   look for a match (compared by digits only). If found → signIn.
 *
 * Step 2 — name (only when the number isn't in the directory):
 *   We ask for their name and add a new contact with that name + the phone
 *   they just typed, then signIn. Their device is now "remembered" via
 *   AsyncStorage so they won't have to do this again.
 */

// Strip everything except digits so "+60 12-345 6789" and "012 3456 789"
// resolve to the same contact when one omits the country code, etc.
function digitsOnly(s) {
  return (s || '').replace(/\D+/g, '');
}

// Treat a number as the same contact even if one has the leading country code
// and the other doesn't (e.g. "60123456789" matches "0123456789").
function phonesMatch(a, b) {
  const A = digitsOnly(a);
  const B = digitsOnly(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return A.endsWith(B) || B.endsWith(A);
}

export default function LoginScreen() {
  const { refreshContacts, signIn, addContact } = useAuth();

  const [step, setStep]     = useState('phone'); // 'phone' | 'name'
  const [phone, setPhone]   = useState('');
  const [name, setName]     = useState('');
  const [loading, setLoading] = useState(false);

  // Remember the full phone (including any country-code prefix the user typed)
  // so we send the same string to DynamoDB when we register a new contact.
  const [pendingPhone, setPendingPhone] = useState('');

  const onContinuePhone = async () => {
    const digits = digitsOnly(phone);
    if (digits.length < 7) {
      Alert.alert('Phone required', 'Please enter a valid phone number to continue.');
      return;
    }

    setLoading(true);
    try {
      const list = await refreshContacts();
      const match = list.find(c => phonesMatch(c.phone, phone));
      if (match) {
        await signIn(match);
        return; // App.js auth gate will swap us into the main stack
      }
      // No contact with this number yet — collect name on the next step.
      setPendingPhone(phone);
      setStep('name');
    } catch (e) {
      Alert.alert("Couldn't sign in", e.message);
    } finally {
      setLoading(false);
    }
  };

  const onContinueName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter your name to continue.');
      return;
    }
    setLoading(true);
    try {
      await addContact({ name: trimmed, phone: pendingPhone, signInAfter: true });
    } catch (e) {
      Alert.alert("Couldn't create contact", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={SG.primary} />
      <LinearGradient
        colors={[SG.primary, SG.primaryDeep]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={styles.heroBg}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.hero}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>SG</Text>
            </View>
            <Text style={styles.appName}>SplitGo</Text>
            <Text style={styles.appTag}>Snap. Split. Settle.</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.card}>
          {step === 'phone' && (
            <>
              <Text style={styles.title}>Sign in</Text>
              <Text style={styles.sub}>
                Enter your phone number — no password needed.
                {'\n'}If you're new, we'll set you up in a sec.
              </Text>

              <Text style={styles.label}>Phone number</Text>
              <View style={styles.inputRow}>
                <View style={styles.codePill}>
                  <Text style={styles.codePillText}>+60</Text>
                </View>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="12 345 6789"
                  placeholderTextColor={SG.muted2}
                  keyboardType="phone-pad"
                  style={styles.phoneInput}
                  autoFocus
                  editable={!loading}
                  onSubmitEditing={onContinuePhone}
                  returnKeyType="go"
                />
              </View>

              <TouchableOpacity
                style={[styles.cta, (loading || !phone.trim()) && styles.ctaDisabled]}
                disabled={loading || !phone.trim()}
                onPress={onContinuePhone}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.ctaText}>Continue</Text>
                }
              </TouchableOpacity>

              <Text style={styles.footnote}>
                Numbers are matched against the SplitGo directory.
                {'\n'}New numbers can sign up by entering their name on the next step.
              </Text>
            </>
          )}

          {step === 'name' && (
            <>
              <Text style={styles.title}>Welcome to SplitGo</Text>
              <Text style={styles.sub}>
                We didn't find <Text style={{ fontWeight: '700' }}>{pendingPhone}</Text> in
                the directory yet. Tell us your name and we'll add you.
              </Text>

              <Text style={styles.label}>Your name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Jolynn Tan"
                placeholderTextColor={SG.muted2}
                style={styles.input}
                autoFocus
                autoCapitalize="words"
                editable={!loading}
                onSubmitEditing={onContinueName}
                returnKeyType="go"
              />

              <TouchableOpacity
                style={[styles.cta, (loading || !name.trim()) && styles.ctaDisabled]}
                disabled={loading || !name.trim()}
                onPress={onContinueName}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.ctaText}>Create my account</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { setStep('phone'); setName(''); }}
                disabled={loading}
                style={styles.linkBtn}
                activeOpacity={0.7}
              >
                <Svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <Path d="M7 2L3 6l4 4" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={styles.linkBtnText}>Use a different number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },

  heroBg: { paddingBottom: 40 },
  hero: { alignItems: 'center', paddingTop: 40, paddingBottom: 24 },
  logo: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  logoText: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  appName:  { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.3 },
  appTag:   { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },

  card: {
    flex: 1, marginTop: -24, marginHorizontal: 16,
    backgroundColor: '#fff', borderRadius: 18, padding: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08, shadowRadius: 14, elevation: 4,
  },
  title: { fontSize: 20, fontWeight: '800', color: SG.ink },
  sub:   { fontSize: 13, color: SG.muted, marginTop: 6, marginBottom: 18, lineHeight: 19 },

  label: { fontSize: 11, color: SG.muted, marginBottom: 6, fontWeight: '700', letterSpacing: 0.4 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: SG.line, borderRadius: 12,
    backgroundColor: '#fff',
  },
  codePill: {
    paddingHorizontal: 14, paddingVertical: 13,
    borderRightWidth: 1, borderRightColor: SG.line,
  },
  codePillText: { fontSize: 14, fontWeight: '700', color: SG.ink },
  phoneInput: {
    flex: 1, fontSize: 15, color: SG.ink,
    paddingHorizontal: 12, paddingVertical: 13,
  },

  input: {
    fontSize: 15, color: SG.ink,
    borderWidth: 1, borderColor: SG.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },

  cta: {
    marginTop: 18,
    height: 50, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SG.primary,
  },
  ctaDisabled: { backgroundColor: SG.muted2 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  linkBtn: {
    marginTop: 14, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  linkBtnText: { color: SG.primary, fontWeight: '700', fontSize: 13 },

  footnote: {
    fontSize: 11, color: SG.muted, textAlign: 'center',
    marginTop: 18, lineHeight: 16,
  },
});
