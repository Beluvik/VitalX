import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, EmptyState, Loading, MiniButton, Row, SectionTitle, Tag } from '../components/ui';
import {
  FeedItem,
  ProfileResult,
  SocialError,
  copyWorkout as apiCopyWorkout,
  getFeed,
  getProfile,
  login as apiLogin,
  setFollow,
  setLike,
  signup as apiSignup,
  socialAvailable,
  updateProfile,
} from '../lib/socialApi';
import { useAuth } from '../store/authStore';
import { useCloudSync } from '../store/cloudSync';
import { useApp } from '../store/AppState';
import { uid } from '../store/trainingReducer';
import { colors, radius, space, type } from '../theme';

type Mode = 'home' | 'auth' | 'ownProfile' | 'viewProfile' | 'feed';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { workouts, dispatchTraining } = useApp();

  const [mode, setMode] = useState<Mode>('home');
  const [viewUsername, setViewUsername] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const server = { backendUrl: auth.backendUrl, appToken: auth.appToken };
  const available = socialAvailable(server);
  const signedIn = !!auth.sessionToken && !!auth.user;

  function openProfile(username: string) {
    setViewUsername(username);
    setMode(username === auth.user?.username ? 'ownProfile' : 'viewProfile');
  }

  let body: React.ReactNode;

  if (!available) {
    body = (
      <Card>
        <SectionTitle>No server set up</SectionTitle>
        <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
          Accounts and syncing need a VitalX server. Add its address in the Food tab, under Setup, then come back here.
        </Text>
      </Card>
    );
  } else if (mode === 'auth') {
    body = <AuthForm server={server} onDone={(token, user) => { auth.signIn(token, user); setMode('home'); }} onBack={() => setMode('home')} />;
  } else if (mode === 'ownProfile' && signedIn) {
    body = (
      <OwnProfile
        server={server}
        token={auth.sessionToken as string}
        user={auth.user!}
        localWorkouts={workouts}
        onUserChange={auth.updateUser}
        onBack={() => setMode('home')}
        onSignOut={() => { auth.signOut(); setMode('home'); }}
      />
    );
  } else if (mode === 'viewProfile') {
    body = (
      <ViewProfile
        server={server}
        token={auth.sessionToken}
        username={viewUsername}
        onBack={() => setMode('home')}
        onSignInFirst={() => setMode('auth')}
        onCopy={(name, exercises) => {
          dispatchTraining({ type: 'SAVE_ROUTINE', routine: { id: uid('routine'), name, createdAt: Date.now(), exercises, isBuiltIn: false } });
          Alert.alert('Copied', `"${name}" was added to your routines.`);
        }}
      />
    );
  } else if (mode === 'feed' && signedIn) {
    body = (
      <Feed
        server={server}
        token={auth.sessionToken as string}
        onBack={() => setMode('home')}
        onOpenProfile={openProfile}
        onCopy={(name, exercises) => {
          dispatchTraining({ type: 'SAVE_ROUTINE', routine: { id: uid('routine'), name, createdAt: Date.now(), exercises, isBuiltIn: false } });
          Alert.alert('Copied', `"${name}" was added to your routines.`);
        }}
      />
    );
  } else {
    body = (
      <>
        <Text style={[type.display, { color: colors.text, marginBottom: space.lg }]}>Profile</Text>

        {!signedIn ? (
          <Card style={{ marginBottom: space.lg }}>
            <SectionTitle>Sign in to sync and share</SectionTitle>
            <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md, lineHeight: 19 }]}>
              Keep your training history on every device, and choose which sessions to make public.
            </Text>
            <Button label="Sign in or create an account" onPress={() => setMode('auth')} />
          </Card>
        ) : (
          <Card style={{ marginBottom: space.lg }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={[type.bodyStrong, { color: colors.text }]}>{auth.user!.displayName}</Text>
                <Text style={[type.caption, { color: colors.textFaint }]}>@{auth.user!.username}</Text>
              </View>
              <Tag text={auth.user!.isPublic ? 'public' : 'private'} tone={auth.user!.isPublic ? 'accent' : 'default'} />
            </Row>
            <View style={{ height: space.md }} />
            <Button label="Your profile and sync" onPress={() => openProfile(auth.user!.username)} />
            <View style={{ height: space.sm }} />
            <Button label="Feed" variant="ghost" onPress={() => setMode('feed')} />
          </Card>
        )}

        <SectionTitle>Find someone</SectionTitle>
        <Row gap={space.sm} style={{ marginBottom: space.xl }}>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={() => searchInput.trim() && openProfile(searchInput.trim())}
            placeholder="username"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              flex: 1,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              color: colors.text,
              fontSize: 16,
              paddingHorizontal: space.md,
              height: 46,
            }}
          />
          <MiniButton label="Go" tone="accent" onPress={() => searchInput.trim() && openProfile(searchInput.trim())} />
        </Row>
      </>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: space.lg + insets.top, paddingBottom: insets.bottom + space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

export function AuthForm({
  server,
  onDone,
  onBack,
}: {
  server: { backendUrl: string; appToken: string };
  onDone: (token: string, user: any) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result =
        tab === 'signup' ? await apiSignup(server, username.trim(), email.trim(), password) : await apiLogin(server, (email || username).trim(), password);
      onDone(result.token, result.user);
    } catch (e: any) {
      setError(e instanceof SocialError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const boxStyle = {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: space.md,
    height: 46,
    marginBottom: space.md,
  } as const;

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>{tab === 'signup' ? 'Create account' : 'Sign in'}</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      <Row gap={space.sm} style={{ marginBottom: space.lg }}>
        <MiniButton label="Sign in" tone={tab === 'signin' ? 'accent' : 'default'} onPress={() => setTab('signin')} />
        <MiniButton label="Create account" tone={tab === 'signup' ? 'accent' : 'default'} onPress={() => setTab('signup')} />
      </Row>

      {error ? <Banner tone="warning" title={error} body="" /> : null}

      <Card>
        {tab === 'signup' ? (
          <>
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Username</Text>
            <TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="3-20 characters" placeholderTextColor={colors.textFaint} style={boxStyle} />
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Email</Text>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholderTextColor={colors.textFaint} style={boxStyle} />
          </>
        ) : (
          <>
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Email or username</Text>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.textFaint} style={boxStyle} />
          </>
        )}
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Password</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder={tab === 'signup' ? 'At least 8 characters' : ''} placeholderTextColor={colors.textFaint} style={boxStyle} />

        <Button label={busy ? 'Please wait...' : tab === 'signup' ? 'Create account' : 'Sign in'} onPress={submit} disabled={busy || !password || (tab === 'signup' ? !username || !email : !email)} />
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------

function OwnProfile({
  server,
  token,
  user,
  localWorkouts,
  onUserChange,
  onBack,
  onSignOut,
}: {
  server: { backendUrl: string; appToken: string };
  token: string;
  user: any;
  localWorkouts: any[];
  onUserChange: (u: any) => void;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [bio, setBio] = useState(user.bio);
  const [isPublic, setIsPublic] = useState(user.isPublic);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cloud = useCloudSync();

  const finished = useMemo(() => localWorkouts.filter((w) => w.endedAt), [localWorkouts]);

  function flash(m: string) {
    setMessage(m);
    setTimeout(() => setMessage(null), 3500);
  }

  async function saveProfile() {
    setBusy(true);
    try {
      const updated = await updateProfile(server, token, { bio, isPublic });
      onUserChange(updated);
      flash('Profile updated.');
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    try {
      const r = await cloud.syncNow();
      const parts = [r.pushed ? `sent ${r.pushed}` : '', r.received ? `received ${r.received}` : ''].filter(Boolean);
      flash(parts.length ? `Synced: ${parts.join(', ')} ${r.pushed + r.received === 1 ? 'change' : 'changes'}.` : 'Everything is up to date.');
      if (r.rejected) Alert.alert('Some items were not saved', `${r.rejected} ${r.rejected === 1 ? 'item was' : 'items were'} refused by the server and will stay on this phone only.`);
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message ?? 'Could not reach the server.');
    }
  }

  const syncLine =
    cloud.status === 'syncing'
      ? 'Syncing...'
      : cloud.status === 'error'
        ? `Last sync failed: ${cloud.lastError ?? 'unknown error'}`
        : cloud.lastSyncedAt
          ? `Last synced ${timeAgo(cloud.lastSyncedAt)}`
          : 'Not synced yet';

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Your profile</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {message ? <Banner tone="info" title={message} body="" /> : null}

      <Card style={{ marginBottom: space.lg }}>
        <Text style={[type.bodyStrong, { color: colors.text }]}>@{user.username}</Text>
        <Text style={[type.micro, { color: colors.textFaint, marginTop: 2, marginBottom: space.md }]}>{user.displayName}</Text>

        <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          multiline
          placeholder="Say something about your training"
          placeholderTextColor={colors.textFaint}
          style={{
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.text,
            fontSize: 15,
            paddingHorizontal: space.md,
            paddingVertical: 10,
            minHeight: 60,
            textAlignVertical: 'top',
            marginBottom: space.md,
          }}
        />

        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Text style={[type.body, { color: colors.text }]}>Public profile</Text>
            <Text style={[type.micro, { color: colors.textFaint }]}>Others can find you and see workouts you mark public.</Text>
          </View>
          <MiniButton label={isPublic ? 'On' : 'Off'} tone={isPublic ? 'accent' : 'default'} onPress={() => setIsPublic(!isPublic)} />
        </Row>

        <Button label="Save profile" onPress={saveProfile} disabled={busy} />
        <View style={{ height: space.sm }} />
        <Button label="Sign out" variant="ghost" onPress={onSignOut} />
      </Card>

      <SectionTitle>Backup and sync</SectionTitle>
      <Card style={{ marginBottom: space.lg }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>{syncLine}</Text>
          <Tag text={cloud.status === 'error' ? 'offline' : 'on'} tone={cloud.status === 'error' ? 'warning' : 'accent'} />
        </Row>
        <Text style={[type.caption, { color: colors.textDim, lineHeight: 19, marginBottom: space.md }]}>
          Your profile, food log, steps, sleep, routines, recipes, badges and workouts are saved to your account and sync
          automatically. Sign in on another phone to get them all back.
        </Text>
        <Button label={cloud.status === 'syncing' ? 'Syncing...' : 'Sync now'} onPress={sync} disabled={cloud.status === 'syncing'} />
      </Card>

      <SectionTitle hint="Choose which finished sessions to share">Share workouts</SectionTitle>
      {finished.length === 0 ? (
        <Text style={[type.caption, { color: colors.textFaint, marginBottom: space.lg }]}>No finished workouts yet.</Text>
      ) : (
        finished.map((w) => {
          const on = cloud.isWorkoutPublic(w.id);
          return (
            <Card key={w.id} style={{ marginBottom: space.sm, padding: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {w.name}
                </Text>
                <MiniButton label={on ? 'Public' : 'Private'} tone={on ? 'accent' : 'default'} onPress={() => cloud.setWorkoutPublic(w.id, !on)} />
              </Row>
            </Card>
          );
        })
      )}
      <Text style={[type.micro, { color: colors.textFaint, marginTop: space.sm, lineHeight: 16 }]}>
        Workouts marked Public can appear on your public profile and in your followers' feeds. Everything else stays
        private, for your own devices only.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

function ViewProfile({
  server,
  token,
  username,
  onBack,
  onSignInFirst,
  onCopy,
}: {
  server: { backendUrl: string; appToken: string };
  token: string | null;
  username: string;
  onBack: () => void;
  onSignInFirst: () => void;
  onCopy: (name: string, exercises: any[]) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [error, setError] = useState('');
  const [busyFollow, setBusyFollow] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProfile(server, username, token ?? undefined);
        if (!cancelled) {
          setProfile(p);
          setState('ready');
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Could not load that profile.');
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function toggleFollow() {
    if (!token) return onSignInFirst();
    if (!profile) return;
    setBusyFollow(true);
    try {
      const following = await setFollow(server, token, username, !profile.isFollowing);
      setProfile({ ...profile, isFollowing: following, followers: profile.followers + (following ? 1 : -1) });
    } catch (e: any) {
      Alert.alert('Could not follow', e?.message ?? 'Something went wrong.');
    } finally {
      setBusyFollow(false);
    }
  }

  async function copy(workoutId: string, name: string) {
    if (!token) return onSignInFirst();
    try {
      const routine = await apiCopyWorkout(server, token, workoutId);
      onCopy(routine.name, routine.exercises);
    } catch (e: any) {
      Alert.alert('Could not copy', e?.message ?? 'Something went wrong.');
    }
  }

  async function like(workoutId: string, on: boolean) {
    if (!token || !profile) return onSignInFirst();
    try {
      const result = await setLike(server, token, workoutId, on);
      setProfile({
        ...profile,
        workouts: profile.workouts.map((w) => (w.id === workoutId ? { ...w, likes: result.likes, likedByMe: result.liked } : w)),
      });
    } catch {
      // A failed like is not worth interrupting the person over; they can try again.
    }
  }

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>@{username}</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {state === 'loading' ? <Loading label="Loading profile" /> : null}
      {state === 'error' ? <Banner tone="warning" title="Could not load this profile" body={error} /> : null}

      {state === 'ready' && profile ? (
        <>
          <Card style={{ marginBottom: space.lg }}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{profile.user.displayName}</Text>
            {profile.user.bio ? <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>{profile.user.bio}</Text> : null}
            <Row gap={space.lg} style={{ marginTop: space.md }}>
              <Text style={[type.caption, { color: colors.textDim }]}>
                <Text style={[type.bodyStrong, { color: colors.text }]}>{profile.followers}</Text> followers
              </Text>
              <Text style={[type.caption, { color: colors.textDim }]}>
                <Text style={[type.bodyStrong, { color: colors.text }]}>{profile.following}</Text> following
              </Text>
            </Row>
            {!profile.isSelf ? (
              <View style={{ marginTop: space.md }}>
                <Button label={profile.isFollowing ? 'Following' : 'Follow'} variant={profile.isFollowing ? 'ghost' : 'primary'} onPress={toggleFollow} disabled={busyFollow} />
              </View>
            ) : null}
          </Card>

          {profile.private ? (
            <EmptyState title="This profile is private" body="Only the owner can see their workouts." />
          ) : profile.workouts.length === 0 ? (
            <EmptyState title="No public workouts yet" body="Nothing has been shared here yet." />
          ) : (
            profile.workouts.map((w) => (
              <Card key={w.id} style={{ marginBottom: space.sm, padding: space.md }}>
                <Text style={[type.body, { color: colors.text }]}>{w.name}</Text>
                <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>{new Date(w.startedAt).toLocaleDateString()}</Text>
                {!profile.isSelf ? (
                  <Row gap={space.md} style={{ marginTop: space.sm }}>
                    <MiniButton label={w.likedByMe ? `\u2665 ${w.likes ?? 0}` : `\u2661 ${w.likes ?? 0}`} tone={w.likedByMe ? 'accent' : 'default'} onPress={() => like(w.id, !w.likedByMe)} />
                    <MiniButton label="Copy" onPress={() => copy(w.id, w.name)} />
                  </Row>
                ) : null}
              </Card>
            ))
          )}
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Feed({
  server,
  token,
  onBack,
  onOpenProfile,
  onCopy,
}: {
  server: { backendUrl: string; appToken: string };
  token: string;
  onBack: () => void;
  onOpenProfile: (username: string) => void;
  onCopy: (name: string, exercises: any[]) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getFeed(server, token);
        if (!cancelled) {
          setItems(list);
          setState('ready');
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? 'Could not load your feed.');
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function like(workoutId: string, on: boolean) {
    try {
      const result = await setLike(server, token, workoutId, on);
      setItems((cur) => cur.map((w) => (w.id === workoutId ? { ...w, likes: result.likes, likedByMe: result.liked } : w)));
    } catch {
      // Not worth interrupting over; they can try again.
    }
  }

  async function copy(workoutId: string, name: string) {
    try {
      const routine = await apiCopyWorkout(server, token, workoutId);
      onCopy(routine.name, routine.exercises);
    } catch (e: any) {
      Alert.alert('Could not copy', e?.message ?? 'Something went wrong.');
    }
  }

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Feed</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {state === 'loading' ? <Loading label="Loading feed" /> : null}
      {state === 'error' ? <Banner tone="warning" title="Could not load your feed" body={error} /> : null}
      {state === 'ready' && items.length === 0 ? (
        <EmptyState title="Nothing here yet" body="Follow people to see their public workouts here." />
      ) : null}

      {items.map((w) => (
        <Card key={w.id} style={{ marginBottom: space.sm, padding: space.md }}>
          <Pressable onPress={() => onOpenProfile(w.author)}>
            <Text style={[type.caption, { color: colors.accent }]}>@{w.author}</Text>
          </Pressable>
          <Text style={[type.body, { color: colors.text, marginTop: 2 }]}>{w.name}</Text>
          <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>{new Date(w.startedAt).toLocaleDateString()}</Text>
          <Row gap={space.md} style={{ marginTop: space.sm }}>
            <MiniButton label={w.likedByMe ? `\u2665 ${w.likes}` : `\u2661 ${w.likes}`} tone={w.likedByMe ? 'accent' : 'default'} onPress={() => like(w.id, !w.likedByMe)} />
            <MiniButton label="Copy" onPress={() => copy(w.id, w.name)} />
          </Row>
        </Card>
      ))}
    </View>
  );
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}
