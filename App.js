import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { FlowProvider } from './src/context/FlowContext';
import { SG } from './src/tokens';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SplitGoHomeScreen from './src/screens/SplitGoHomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ItemsScreen from './src/screens/ItemsScreen';
import ParticipantsScreen from './src/screens/ParticipantsScreen';
import BillCreatedScreen from './src/screens/BillCreatedScreen';
import ClaimScreen from './src/screens/ClaimScreen';
import SummaryScreen from './src/screens/SummaryScreen';
import RequestScreen from './src/screens/RequestScreen';
import SettledScreen from './src/screens/SettledScreen';
import PaymentSuccessScreen from './src/screens/PaymentSuccessScreen';
import SplitBillModeScreen from './src/screens/SplitBillModeScreen';
import TravelGroupsLobbyScreen from './src/screens/TravelGroupsLobbyScreen';
import TravelPickContactsScreen from './src/screens/TravelPickContactsScreen';
import TravelTripNameScreen from './src/screens/TravelTripNameScreen';
import TravelGroupHubScreen from './src/screens/TravelGroupHubScreen';
import TravelPFMScreen from './src/screens/TravelPFMScreen';
import TravelPaySelectionScreen from './src/screens/TravelPaySelectionScreen';

const Stack = createNativeStackNavigator();

// Splash shown while AsyncStorage answers "do we already know who's on this device?"
function BootSplash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: SG.primary }}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}

// Gate: while `me === undefined` we're hydrating from disk; once known we
// render either Login (no user) or the full TnG app stack (signed in).
function AuthGate() {
  const { me } = useAuth();

  if (me === undefined) return <BootSplash />;

  if (!me) {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <FlowProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home"           component={HomeScreen} />
          <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
          <Stack.Screen name="SplitBillMode"  component={SplitBillModeScreen} />
          <Stack.Screen name="TravelGroups" component={TravelGroupsLobbyScreen} />
          <Stack.Screen name="TravelPickContacts" component={TravelPickContactsScreen} />
          <Stack.Screen name="TravelTripName" component={TravelTripNameScreen} />
          <Stack.Screen name="TravelGroupHub" component={TravelGroupHubScreen} />
          <Stack.Screen name="TravelPFM" component={TravelPFMScreen} />
          <Stack.Screen name="TravelPaySelection" component={TravelPaySelectionScreen} />
          <Stack.Screen name="SplitGoHome"    component={SplitGoHomeScreen} />
          <Stack.Screen name="Scan"         component={ScanScreen} />
          <Stack.Screen name="Items"        component={ItemsScreen} />
          <Stack.Screen name="Participants" component={ParticipantsScreen} />
          <Stack.Screen name="BillCreated"  component={BillCreatedScreen} />
          <Stack.Screen name="Claim"        component={ClaimScreen} />
          <Stack.Screen name="Summary"      component={SummaryScreen} />
          <Stack.Screen name="Request"      component={RequestScreen} />
          <Stack.Screen name="Settled"      component={SettledScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </FlowProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
