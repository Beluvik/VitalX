import { useEffect, useReducer } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BACKEND_TOKEN, BACKEND_URL } from '../config';
import { SocialUser, logout as apiLogout, me as apiMe } from '../lib/socialApi';

export interface AuthState {
  backendUrl: string;
  appToken: string;
  sessionToken: string | null;
  user: SocialUser | null;
}

const STORAGE_KEY = 'vitalx.auth.v1';
/** Where Setup (Food tab) saves the server address. That is the one place the user edits it. */
const SETTINGS_KEY = 'vitalx.foodsettings.v1';

/**
 * One store shared by every screen, so signing in on the Profile tab is seen
 * immediately by background sync (and the other way round, a session the
 * server rejects signs out everywhere).
 */
let shared: AuthState = { backendUrl: BACKEND_URL, appToken: BACKEND_TOKEN, sessionToken: null, user: null };
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: AuthState) {
  shared = next;
  listeners.forEach((l) => l());
}

function persist(next: AuthState) {
  set(next);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionToken: next.sessionToken, user: next.user })).catch(() => undefined);
}

/** Re-reads the server address from Setup, falling back to the one built into the app. */
export async function refreshServer(): Promise<void> {
  let backendUrl = BACKEND_URL;
  let appToken = BACKEND_TOKEN;
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      backendUrl = (typeof s.backendUrl === 'string' && s.backendUrl) || BACKEND_URL;
      appToken = (typeof s.appToken === 'string' && s.appToken) || BACKEND_TOKEN;
    }
  } catch {
    // Unreadable settings: use the built-in address.
  }
  if (backendUrl !== shared.backendUrl || appToken !== shared.appToken) set({ ...shared, backendUrl, appToken });
}

async function load() {
  await refreshServer();
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const sessionToken = typeof saved.sessionToken === 'string' ? saved.sessionToken : null;
      set({ ...shared, sessionToken, user: sessionToken ? saved.user ?? null : null });
      // A saved session token might have expired or been revoked
      // elsewhere; confirm it quietly rather than trusting it forever.
      if (sessionToken) {
        const user = await apiMe({ backendUrl: shared.backendUrl, appToken: shared.appToken }, sessionToken).catch(() => undefined);
        if (user === null) persist({ ...shared, sessionToken: null, user: null });
        else if (user) persist({ ...shared, user });
      }
    }
  } catch {
    // An unreadable saved session must never block the app from opening.
  }
  loaded = true;
  listeners.forEach((l) => l());
}

export function getAuth(): AuthState {
  return shared;
}

export function signIn(sessionToken: string, user: SocialUser) {
  persist({ ...shared, sessionToken, user });
}

export function signOut() {
  const token = shared.sessionToken;
  persist({ ...shared, sessionToken: null, user: null });
  if (token) apiLogout({ backendUrl: shared.backendUrl, appToken: shared.appToken }, token).catch(() => undefined);
}

export function updateUser(user: SocialUser) {
  persist({ ...shared, user });
}

export function useAuth() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(rerender);
    if (!loading) loading = load();
    // Setup may have changed the address since this screen was last open.
    else refreshServer();
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  return { ...shared, loaded, signIn, signOut, updateUser };
}
