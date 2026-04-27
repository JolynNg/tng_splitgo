import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listContacts, createContact as apiCreateContact, getMe as apiGetMe } from '../api/contactService';

const AuthContext = createContext(null);

const STORAGE_KEY = 'splitgo.me.v1';

/**
 * AuthProvider — owns "who is using this device".
 *
 * Responsibilities:
 *   - Loads the saved `me` contact from AsyncStorage on boot, so devices
 *     stay logged in across restarts.
 *   - Owns the directory `contacts` list (synced from the backend).
 *   - Exposes signIn / signOut / addContact for the rest of the app.
 *
 * Why a separate context (not folded into FlowContext):
 *   FlowContext owns *bill-session* state which gets reset between bills.
 *   `me` and `contacts` are device-level and persist across bills, so they
 *   live in their own provider above FlowProvider.
 */
export function AuthProvider({ children }) {
  // Hydration: undefined while loading from disk, null when no user is signed
  // in, or a contact object once known. The "loading" state lets App.js
  // show a tiny boot splash instead of flashing the Login screen.
  const [me, setMe] = useState(undefined);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(null);

  // Restore the saved user on first boot
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        setMe(raw ? JSON.parse(raw) : null);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  // Returns the latest list so callers (e.g. LoginScreen looking up by phone)
  // don't have to wait for the React state closure to update.
  const refreshContacts = useCallback(async () => {
    setContactsLoading(true);
    setContactsError(null);
    try {
      const r = await listContacts();
      const list = r.contacts || [];
      setContacts(list);
      return list;
    } catch (err) {
      setContactsError(err.message);
      setContacts([]);
      return [];
    } finally {
      setContactsLoading(false);
    }
  }, []);

  // Pull the directory once we know who's using the device, so it's ready
  // when they navigate to Participants / Login.
  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  const signIn = useCallback(async (contact) => {
    // Default a missing balance to RM 1000 so the wallet UI never shows blank.
    const seeded = { balance: 1000, ...contact };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    setMe(seeded);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setMe(null);
  }, []);

  // Re-fetch the signed-in contact from the server (typically after a payment
  // has shifted the wallet balance). Also accepts an optional explicit balance
  // override so callers that already know the new number (the /paid response)
  // can update synchronously without a round trip.
  const updateMyBalance = useCallback(async (newBalance) => {
    setMe((prev) => {
      if (!prev) return prev;
      const next = { ...prev, balance: typeof newBalance === 'number' ? newBalance : prev.balance };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const refreshMe = useCallback(async () => {
    setMe((prev) => {
      if (!prev?.phone) return prev;
      apiGetMe(prev.phone)
        .then((r) => {
          if (r?.contact) {
            const merged = { ...prev, ...r.contact };
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => {});
            setMe(merged);
          }
        })
        .catch(() => {});
      return prev;
    });
  }, []);

  // Adds a new contact to the directory and merges it into the local list.
  // If `signInAfter` is true, the new contact also becomes `me` (used by the
  // login screen's "I'm not in the list" flow).
  const addContact = useCallback(async ({ name, phone, signInAfter = false }) => {
    const r = await apiCreateContact({ name, phone });
    const c = r.contact;
    setContacts(prev => {
      const without = prev.filter(p => p.contactId !== c.contactId);
      return [...without, c].sort((a, b) => a.name.localeCompare(b.name));
    });
    if (signInAfter) await signIn(c);
    return c;
  }, [signIn]);

  return (
    <AuthContext.Provider value={{
      me,
      contacts, contactsLoading, contactsError,
      refreshContacts,
      signIn, signOut, addContact,
      updateMyBalance, refreshMe,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
