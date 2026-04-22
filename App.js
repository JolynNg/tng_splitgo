import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FlowProvider } from './src/context/FlowContext';

import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ItemsScreen from './src/screens/ItemsScreen';
import ParticipantsScreen from './src/screens/ParticipantsScreen';
import AssignScreen from './src/screens/AssignScreen';
import SummaryScreen from './src/screens/SummaryScreen';
import RequestScreen from './src/screens/RequestScreen';
import SettledScreen from './src/screens/SettledScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <FlowProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home"         component={HomeScreen} />
            <Stack.Screen name="Scan"         component={ScanScreen} />
            <Stack.Screen name="Items"        component={ItemsScreen} />
            <Stack.Screen name="Participants" component={ParticipantsScreen} />
            <Stack.Screen name="Assign"       component={AssignScreen} />
            <Stack.Screen name="Summary"      component={SummaryScreen} />
            <Stack.Screen name="Request"      component={RequestScreen} />
            <Stack.Screen name="Settled"      component={SettledScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </FlowProvider>
    </SafeAreaProvider>
  );
}
