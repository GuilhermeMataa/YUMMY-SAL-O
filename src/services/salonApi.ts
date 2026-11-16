import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  ADMIN_EMAIL,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  SALON_SERVICES,
  SIGNATURE_RITUALS,
  SPECIALISTS,
  TIME_SLOTS,
} from '../data/catalog';
import type {
  BookingRecord,
  BookingStatus,
  OwnerSessionInfo,
  SalonService,
  SignatureRitual,
  Specialist,
  UserProfile,
} from '../types';

const STATIC_GUEST_KEY = 'yummy_salao_guest_id_v2';
const GUEST_BOOKINGS_KEY = 'yummy_salao_guest_bookings_v2';
const OWNER_CREDS_KEY = 'yummy_salao_owner_creds_v2';
const OWNER_PASS_OK_KEY = 'yummy_salao_owner_pass_ok_v2';
const OWNER_WA_LOCAL_KEY = 'yummy_salao_owner_wa_v2';
const SEEDED_KEY = 'yummy_salao_firestore_seeded_v1';

interface LocalOwnerCreds {
  login: string;
  password: string;
  isDefaultPassword: boolean;
}

function normalizeDigits(phone: string | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

function nextWeekdayDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while (d.getDay() === 0 || d.getDay() === 1) {
    d.setDate(d.getDate() + 1);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getSlotKey(date: string, specialistId: string, time: string): string {
  return `${date}__${specialistId}__${time.replace(':', '-')}`;
}

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

function mapFirestoreBooking(docData: Record<string, unknown>, id: string): BookingRecord {
  return {
    id: typeof docData.id === 'string' ? docData.id : id,
    userId:
      typeof docData.clientUid === 'string' && docData.clientUid
        ? docData.clientUid
        : typeof docData.guestId === 'string'
        ? docData.guestId
        : 'guest',
    customerName: String(docData.customerName || 'Cliente'),
    customerPhone: String(docData.customerPhone || ''),
    notes: typeof docData.notes === 'string' && docData.notes ? docData.notes : undefined,
    serviceId: String(docData.serviceId || ''),
    serviceName: String(docData.serviceName || 'Serviço'),
    specialistId: String(docData.specialistId || ''),
    specialistName: String(docData.specialistName || 'Especialista'),
    date: String(docData.date || ''),
    time: String(docData.time || ''),
    durationMin: Number(docData.durationMin || 60),
    totalBrl: Number(docData.totalBrl || 0),
    status: (docData.status as BookingStatus) || 'pending',
    confirmationMessage:
      typeof docData.confirmationMessage === 'string' ? docData.confirmationMessage : undefined,
    confirmedAt: typeof docData.confirmedAt === 'string' ? docData.confirmedAt : undefined,
    createdAt: timestampToIso(docData.createdAt),
  };
}

function getGuestId(): string {
  try {
    let guestId = window.localStorage.getItem(STATIC_GUEST_KEY);
    if (!guestId || !/^[a-zA-Z0-9_\-]+$/.test(guestId)) {
      guestId = `guest_${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(STATIC_GUEST_KEY, guestId);
    }
    return guestId.slice(0, 64);
  } catch {
    return 'guest_local';
  }
}

function readGuestBookingsLocal(): BookingRecord[] {
  try {
    const raw = window.localStorage.getItem(GUEST_BOOKINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BookingRecord[]) : [];
  } catch {
    return [];
  }
}

function saveGuestBookingLocal(booking: BookingRecord): void {
  try {
    const existing = readGuestBookingsLocal().filter((b) => b.id !== booking.id);
    existing.unshift(booking);
    window.localStorage.setItem(GUEST_BOOKINGS_KEY, JSON.stringify(existing.slice(0, 30)));
  } catch {
    // ignore storage limits
  }
}

function randomBookingCode(): string {
  const chars = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `AGD-${out}`;
}

export function encodeBookingShareParam(booking: BookingRecord): string {
  const minimal = {
    id: booking.id,
    n: booking.customerName,
    p: booking.customerPhone,
    m: booking.notes || '',
    s: booking.serviceId,
    e: booking.specialistId,
    d: booking.date,
    t: booking.time,
  };
  const json = JSON.stringify(minimal);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBookingShareParam(param: string): BookingRecord | null {
  try {
    const pad = param.length % 4 === 0 ? '' : '='.repeat(4 - (param.length % 4));
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      id?: string;
      n?: string;
      p?: string;
      m?: string;
      s?: string;
      e?: string;
      d?: string;
      t?: string;
    };
    if (!parsed.id || !parsed.n || !parsed.s || !parsed.d || !parsed.t) return null;
    const service = SALON_SERVICES.find((srv) => srv.id === parsed.s);
    const specialist = SPECIALISTS.find((sp) => sp.id === parsed.e);
    return {
      id: parsed.id,
      userId: 'imported_whatsapp',
      customerName: parsed.n,
      customerPhone: parsed.p || '',
      notes: parsed.m || undefined,
      serviceId: service ? service.id : parsed.s,
      serviceName: service ? service.name : 'Serviço solicitado',
      specialistId: specialist ? specialist.id : parsed.e || '',
      specialistName: specialist ? specialist.name : 'Especialista',
      date: parsed.d,
      time: parsed.t,
      durationMin: service ? service.durationMin : 60,
      totalBrl: service ? service.priceBrl : 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveOwnerWhatsAppLocally(whatsapp: string): void {
  try {
    window.localStorage.setItem(OWNER_WA_LOCAL_KEY, whatsapp.trim().slice(0, 24));
  } catch {
    // ignore
  }
}

function getLocalOwnerWhatsApp(): string {
  try {
    return window.localStorage.getItem(OWNER_WA_LOCAL_KEY) || '';
  } catch {
    return '';
  }
}

export async function fetchCatalog(): Promise<{
  services: SalonService[];
  specialists: Specialist[];
  rituals: SignatureRitual[];
  ownerWhatsApp: string;
}> {
  let ownerWhatsApp = getLocalOwnerWhatsApp();
  try {
    const snap = await getDoc(doc(db, 'settings', 'salon'));
    if (snap.exists()) {
      const val = snap.data().ownerWhatsApp;
      if (typeof val === 'string' && val) {
        ownerWhatsApp = val;
        saveOwnerWhatsAppLocally(val);
      }
    }
  } catch {
    // Fallback cleanly to local/empty if settings doc does not exist yet
  }
  return {
    services: SALON_SERVICES,
    specialists: SPECIALISTS,
    rituals: SIGNATURE_RITUALS,
    ownerWhatsApp,
  };
}

export async function fetchAvailability(
  date: string,
  specialistId: string
): Promise<{ time: string; available: boolean }[]> {
  try {
    const q = query(
      collection(db, 'slot_locks'),
      where('date', '==', date),
      where('specialistId', '==', specialistId),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    const taken = new Set(snap.docs.map((d) => String(d.data().time || '')));
    return TIME_SLOTS.map((time) => ({
      time,
      available: !taken.has(time),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'slot_locks');
  }
}

export function subscribeAvailability(
  date: string,
  specialistId: string,
  onChange: (slots: { time: string; available: boolean }[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'slot_locks'),
    where('date', '==', date),
    where('specialistId', '==', specialistId),
    where('status', '==', 'active')
  );
  return onSnapshot(
    q,
    (snap) => {
      const taken = new Set(snap.docs.map((d) => String(d.data().time || '')));
      onChange(
        TIME_SLOTS.map((time) => ({
          time,
          available: !taken.has(time),
        }))
      );
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'slot_locks');
    }
  );
}

// Client Authentication (Google Sign-In via Firebase Auth — optional for clients)
function mapFirebaseUser(user: FirebaseUser | null): UserProfile | null {
  if (!user) return null;
  return {
    id: user.uid,
    name: user.displayName || user.email?.split('@')[0] || 'Cliente',
    phone: user.phoneNumber || '',
    email: user.email || undefined,
    createdAt: user.metadata.creationTime || new Date().toISOString(),
  };
}

export function subscribeClientAuth(onChange: (user: UserProfile | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, (fbUser) => {
    onChange(mapFirebaseUser(fbUser));
  });
}

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  return mapFirebaseUser(auth.currentUser);
}

export async function loginClientWithGoogle(): Promise<{ user?: UserProfile; error?: string }> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const mapped = mapFirebaseUser(result.user);
    if (!mapped) {
      return { error: 'Não foi possível concluir o login com Google.' };
    }
    return { user: mapped };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
      return { error: 'Janela de login do Google fechada antes de concluir.' };
    }
    return { error: 'Não foi possível entrar com sua conta Google agora.' };
  }
}

export async function logoutClient(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
}

export async function createClientBooking(input: {
  serviceId: string;
  specialistId: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone: string;
  notes?: string;
}): Promise<{ booking?: BookingRecord; ownerWhatsApp?: string; error?: string }> {
  const service = SALON_SERVICES.find((s) => s.id === input.serviceId);
  const specialist = SPECIALISTS.find((sp) => sp.id === input.specialistId);
  if (!service || !specialist) {
    return { error: 'Serviço ou especialista selecionado é inválido.' };
  }
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !TIME_SLOTS.includes(input.time)) {
    return { error: 'Data ou horário selecionado é inválido.' };
  }

  const name = input.customerName.trim().slice(0, 80);
  const phone = input.customerPhone.trim().slice(0, 24);
  if (name.length < 2) {
    return { error: 'Informe seu nome completo para solicitar a reserva.' };
  }
  if (normalizeDigits(phone).length < 8) {
    return { error: 'Informe seu WhatsApp com DDD para contato e confirmação.' };
  }

  const cleanNotes = input.notes && input.notes.trim() ? input.notes.trim().slice(0, 400) : undefined;
  const id = randomBookingCode();
  const guestId = getGuestId();
  const fbUser = auth.currentUser;
  const clientUid = fbUser && fbUser.emailVerified ? fbUser.uid : '';
  const slotKey = getSlotKey(input.date, specialist.id, input.time);
  const slotRef = doc(db, 'slot_locks', slotKey);

  let slotExistsCancelled = false;
  try {
    const slotSnap = await getDoc(slotRef);
    if (slotSnap.exists()) {
      const st = slotSnap.data().status;
      if (st === 'active') {
        return {
          error: 'Este horário acabou de ser reservado. Escolha outro horário disponível.',
        };
      }
      slotExistsCancelled = true;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `slot_locks/${slotKey}`);
  }

  const bookingPayload: Record<string, unknown> = {
    id,
    guestId,
    clientUid,
    customerName: name,
    customerPhone: phone,
    serviceId: service.id,
    serviceName: service.name.slice(0, 120),
    specialistId: specialist.id,
    specialistName: specialist.name.slice(0, 80),
    date: input.date,
    time: input.time,
    durationMin: Math.round(service.durationMin),
    totalBrl: Number(service.priceBrl),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanNotes) {
    bookingPayload.notes = cleanNotes;
  }

  const statusPayload = {
    bookingId: id,
    serviceName: service.name.slice(0, 120),
    specialistName: specialist.name.slice(0, 80),
    date: input.date,
    time: input.time,
    durationMin: Math.round(service.durationMin),
    totalBrl: Number(service.priceBrl),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'bookings', id), bookingPayload);
    batch.set(doc(db, 'booking_statuses', id), statusPayload);
    if (slotExistsCancelled) {
      batch.update(slotRef, {
        bookingId: id,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(slotRef, {
        bookingId: id,
        date: input.date,
        specialistId: specialist.id,
        time: input.time,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `bookings/${id}`);
  }

  const record: BookingRecord = {
    id,
    userId: clientUid || guestId,
    customerName: name,
    customerPhone: phone,
    notes: cleanNotes,
    serviceId: service.id,
    serviceName: service.name,
    specialistId: specialist.id,
    specialistName: specialist.name,
    date: input.date,
    time: input.time,
    durationMin: service.durationMin,
    totalBrl: service.priceBrl,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  saveGuestBookingLocal(record);

  let ownerWhatsApp = getLocalOwnerWhatsApp();
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'salon'));
    if (settingsSnap.exists() && typeof settingsSnap.data().ownerWhatsApp === 'string') {
      ownerWhatsApp = settingsSnap.data().ownerWhatsApp;
    }
  } catch {
    // non-fatal
  }

  return { booking: record, ownerWhatsApp };
}

export async function fetchClientBookings(): Promise<BookingRecord[]> {
  const localBookings = readGuestBookingsLocal();
  const merged = new Map<string, BookingRecord>();
  for (const b of localBookings) {
    merged.set(b.id, b);
  }

  // Refresh guest bookings statuses from zero-PII mirror
  await Promise.all(
    localBookings.map(async (local) => {
      try {
        const snap = await getDoc(doc(db, 'booking_statuses', local.id));
        if (snap.exists()) {
          const data = snap.data();
          merged.set(local.id, {
            ...local,
            status: (data.status as BookingStatus) || local.status,
            confirmationMessage:
              typeof data.confirmationMessage === 'string'
                ? data.confirmationMessage
                : local.confirmationMessage,
            confirmedAt:
              typeof data.confirmedAt === 'string' ? data.confirmedAt : local.confirmedAt,
          });
        }
      } catch {
        // ignore missing mirror
      }
    })
  );

  const fbUser = auth.currentUser;
  if (fbUser && fbUser.emailVerified) {
    try {
      const q = query(collection(db, 'bookings'), where('clientUid', '==', fbUser.uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        merged.set(d.id, mapFirestoreBooking(d.data(), d.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribeClientBookings(onChange: (bookings: BookingRecord[]) => void): Unsubscribe {
  const unsubs: Unsubscribe[] = [];
  const merged = new Map<string, BookingRecord>();
  const localBookings = readGuestBookingsLocal();
  for (const b of localBookings) {
    merged.set(b.id, b);
  }

  const emit = () => {
    onChange(Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };

  emit();

  for (const local of localBookings) {
    const unsub = onSnapshot(
      doc(db, 'booking_statuses', local.id),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const current = merged.get(local.id) || local;
          const updated: BookingRecord = {
            ...current,
            status: (data.status as BookingStatus) || current.status,
            confirmationMessage:
              typeof data.confirmationMessage === 'string'
                ? data.confirmationMessage
                : current.confirmationMessage,
            confirmedAt:
              typeof data.confirmedAt === 'string' ? data.confirmedAt : current.confirmedAt,
          };
          merged.set(local.id, updated);
          saveGuestBookingLocal(updated);
          emit();
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `booking_statuses/${local.id}`);
      }
    );
    unsubs.push(unsub);
  }

  const fbUser = auth.currentUser;
  if (fbUser && fbUser.emailVerified) {
    const q = query(collection(db, 'bookings'), where('clientUid', '==', fbUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        for (const d of snap.docs) {
          merged.set(d.id, mapFirestoreBooking(d.data(), d.id));
        }
        emit();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bookings');
      }
    );
    unsubs.push(unsub);
  }

  return () => {
    for (const u of unsubs) u();
  };
}

export async function cancelClientBooking(booking: BookingRecord): Promise<{ ok: boolean; error?: string }> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) {
    return {
      ok: false,
      error: 'Para cancelar direto pela agenda, entre com sua conta Google ou avise o dono pelo WhatsApp.',
    };
  }

  const slotKey = getSlotKey(booking.date, booking.specialistId, booking.time);
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', booking.id), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'booking_statuses', booking.id), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'slot_locks', slotKey), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
  }
}

// Owner Credentials (Local admin/admin gate) + Google Cloud Admin Session
function getLocalOwnerCreds(): LocalOwnerCreds {
  try {
    const raw = window.localStorage.getItem(OWNER_CREDS_KEY);
    if (!raw) {
      return { login: 'admin', password: 'admin', isDefaultPassword: true };
    }
    const parsed = JSON.parse(raw) as Partial<LocalOwnerCreds>;
    if (parsed.login && parsed.password) {
      return {
        login: parsed.login,
        password: parsed.password,
        isDefaultPassword: Boolean(parsed.isDefaultPassword),
      };
    }
  } catch {
    // ignore
  }
  return { login: 'admin', password: 'admin', isDefaultPassword: true };
}

function isOwnerPasswordPassed(): boolean {
  try {
    return window.sessionStorage.getItem(OWNER_PASS_OK_KEY) === 'true';
  } catch {
    return false;
  }
}

function setOwnerPasswordPassed(passed: boolean): void {
  try {
    if (passed) window.sessionStorage.setItem(OWNER_PASS_OK_KEY, 'true');
    else window.sessionStorage.removeItem(OWNER_PASS_OK_KEY);
  } catch {
    // ignore
  }
}

export async function isFirebaseAdminConnected(): Promise<{
  connected: boolean;
  email?: string;
  wrongAccountEmail?: string;
}> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return { connected: false };
  }
  if (user.email === ADMIN_EMAIL) {
    return { connected: true, email: user.email };
  }
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      return { connected: true, email: user.email || undefined };
    }
  } catch {
    // not admin
  }
  return { connected: false, wrongAccountEmail: user.email || undefined };
}

export async function fetchOwnerSession(): Promise<
  OwnerSessionInfo & { passwordVerified: boolean; cloudConnected: boolean; wrongAccountEmail?: string }
> {
  const creds = getLocalOwnerCreds();
  const passwordVerified = isOwnerPasswordPassed();
  const cloud = await isFirebaseAdminConnected();
  const authenticated = passwordVerified && cloud.connected;

  let ownerWhatsApp = getLocalOwnerWhatsApp();
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'salon'));
    if (settingsSnap.exists() && typeof settingsSnap.data().ownerWhatsApp === 'string') {
      ownerWhatsApp = settingsSnap.data().ownerWhatsApp;
    }
  } catch {
    // ignore
  }

  return {
    authenticated,
    passwordVerified,
    cloudConnected: cloud.connected,
    wrongAccountEmail: cloud.wrongAccountEmail,
    login: creds.login,
    isDefaultPassword: creds.isDefaultPassword,
    ownerWhatsApp,
  };
}

export async function loginOwner(
  login: string,
  password: string
): Promise<
  OwnerSessionInfo & {
    passwordVerified: boolean;
    cloudConnected: boolean;
    wrongAccountEmail?: string;
    error?: string;
  }
> {
  const creds = getLocalOwnerCreds();
  const cleanLogin = login.trim().toLowerCase();

  let valid = cleanLogin === creds.login.toLowerCase() && password === creds.password;

  // Also check server credentials if running alongside Express
  if (!valid) {
    try {
      const res = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = (await res.json()) as { authenticated?: boolean };
        if (data.authenticated) valid = true;
      }
    } catch {
      // Static deploy
    }
  }

  if (!valid) {
    return {
      authenticated: false,
      passwordVerified: false,
      cloudConnected: false,
      isDefaultPassword: creds.isDefaultPassword,
      error: 'Login ou senha incorretos.',
    };
  }

  setOwnerPasswordPassed(true);
  return fetchOwnerSession();
}

export async function connectOwnerGoogle(): Promise<
  OwnerSessionInfo & {
    passwordVerified: boolean;
    cloudConnected: boolean;
    wrongAccountEmail?: string;
    error?: string;
  }
> {
  try {
    await signInWithPopup(auth, googleProvider);
    const session = await fetchOwnerSession();
    if (!session.cloudConnected) {
      return {
        ...session,
        error: session.wrongAccountEmail
          ? `A conta conectada (${session.wrongAccountEmail}) não tem permissão de dono. Conecte com ${ADMIN_EMAIL}.`
          : `Conecte a conta Google administradora (${ADMIN_EMAIL}) para receber as reservas.`,
      };
    }
    return session;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const base = await fetchOwnerSession();
    if (msg.includes('popup-closed-by-user')) {
      return { ...base, error: 'Janela do Google fechada antes de concluir.' };
    }
    return { ...base, error: 'Não foi possível conectar a conta Google do dono.' };
  }
}

export async function logoutOwner(): Promise<void> {
  setOwnerPasswordPassed(false);
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
}

export async function updateOwnerCredentials(
  newLogin: string,
  newPassword: string
): Promise<OwnerSessionInfo & { error?: string }> {
  const cleanLogin = newLogin.trim().toLowerCase();
  const cleanPassword = newPassword.trim();
  if (cleanLogin.length < 3) {
    return { authenticated: false, error: 'O login deve ter pelo menos 3 caracteres.' };
  }
  if (cleanPassword.length < 4) {
    return { authenticated: false, error: 'A senha deve ter pelo menos 4 caracteres.' };
  }

  const nextCreds: LocalOwnerCreds = {
    login: cleanLogin.slice(0, 60),
    password: cleanPassword,
    isDefaultPassword: false,
  };
  try {
    window.localStorage.setItem(OWNER_CREDS_KEY, JSON.stringify(nextCreds));
  } catch {
    // ignore
  }

  const session = await fetchOwnerSession();
  return {
    ...session,
    authenticated: true,
    login: nextCreds.login,
    isDefaultPassword: false,
  };
}

export async function updateOwnerWhatsApp(
  whatsapp: string
): Promise<{ ownerWhatsApp?: string; error?: string }> {
  const clean = whatsapp.trim().slice(0, 24);
  if (clean && normalizeDigits(clean).length < 10) {
    return { error: 'Informe um WhatsApp válido com DDD (ex: (11) 99999-9999).' };
  }
  try {
    await setDoc(doc(db, 'settings', 'salon'), {
      ownerWhatsApp: clean,
      updatedAt: serverTimestamp(),
    });
    saveOwnerWhatsAppLocally(clean);
    return { ownerWhatsApp: clean };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/salon');
  }
}

export async function seedInitialBookingsIfEmpty(): Promise<void> {
  try {
    if (window.localStorage.getItem(SEEDED_KEY) === 'true') return;
    const snap = await getDocs(collection(db, 'bookings'));
    if (!snap.empty) {
      window.localStorage.setItem(SEEDED_KEY, 'true');
      return;
    }

    const sampleDate = nextWeekdayDate(1);
    const batch = writeBatch(db);

    const pendingId = 'AGD-104A';
    const pendingSlot = getSlotKey(sampleDate, 'esp-lucas', '11:00');
    batch.set(doc(db, 'bookings', pendingId), {
      id: pendingId,
      guestId: 'seed_client_1',
      clientUid: '',
      customerName: 'Helena Vasconcelos',
      customerPhone: '(11) 98421-3309',
      notes: 'Prefere iluminação sutil sem descoloração na raiz.',
      serviceId: 'srv-morena-iluminada',
      serviceName: 'Iluminação Botânica & Matização',
      specialistId: 'esp-lucas',
      specialistName: 'Lucas Ferreira',
      date: sampleDate,
      time: '11:00',
      durationMin: 150,
      totalBrl: 540,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'booking_statuses', pendingId), {
      bookingId: pendingId,
      serviceName: 'Iluminação Botânica & Matização',
      specialistName: 'Lucas Ferreira',
      date: sampleDate,
      time: '11:00',
      durationMin: 150,
      totalBrl: 540,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'slot_locks', pendingSlot), {
      bookingId: pendingId,
      date: sampleDate,
      specialistId: 'esp-lucas',
      time: '11:00',
      status: 'active',
      updatedAt: serverTimestamp(),
    });

    const confirmedId = 'AGD-103B';
    const confirmedSlot = getSlotKey(sampleDate, 'esp-sofia', '15:00');
    const confirmedMsg =
      'Olá Carolina, sua reserva de Corte Visagista & Finalização com Sofia Mendes foi confirmada. Esperamos você!';
    const confirmedAtIso = new Date().toISOString();

    batch.set(doc(db, 'bookings', confirmedId), {
      id: confirmedId,
      guestId: 'seed_client_2',
      clientUid: '',
      customerName: 'Carolina Nogueira',
      customerPhone: '(11) 99104-7782',
      serviceId: 'srv-corte-visagismo',
      serviceName: 'Corte Visagista & Finalização',
      specialistId: 'esp-sofia',
      specialistName: 'Sofia Mendes',
      date: sampleDate,
      time: '15:00',
      durationMin: 60,
      totalBrl: 220,
      status: 'confirmed',
      confirmationMessage: confirmedMsg,
      confirmedAt: confirmedAtIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'booking_statuses', confirmedId), {
      bookingId: confirmedId,
      serviceName: 'Corte Visagista & Finalização',
      specialistName: 'Sofia Mendes',
      date: sampleDate,
      time: '15:00',
      durationMin: 60,
      totalBrl: 220,
      status: 'confirmed',
      confirmationMessage: confirmedMsg,
      confirmedAt: confirmedAtIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'slot_locks', confirmedSlot), {
      bookingId: confirmedId,
      date: sampleDate,
      specialistId: 'esp-sofia',
      time: '15:00',
      status: 'active',
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    window.localStorage.setItem(SEEDED_KEY, 'true');
  } catch {
    // Seed failure is non-blocking
  }
}

export function subscribeOwnerBookings(
  onBookings: (bookings: BookingRecord[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapFirestoreBooking(d.data(), d.id));
      onBookings(list);
    },
    (error) => {
      onError?.('Sem permissão na nuvem. Conecte a conta Google do dono.');
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    }
  );
}

export async function fetchOwnerOverview(): Promise<{
  unauthorized?: boolean;
  bookings: BookingRecord[];
  ownerWhatsApp?: string;
  error?: string;
}> {
  const cloud = await isFirebaseAdminConnected();
  if (!cloud.connected || !isOwnerPasswordPassed()) {
    return { unauthorized: true, bookings: [] };
  }

  try {
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const bookings = snap.docs.map((d) => mapFirestoreBooking(d.data(), d.id));
    let ownerWhatsApp = getLocalOwnerWhatsApp();
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'salon'));
      if (settingsSnap.exists() && typeof settingsSnap.data().ownerWhatsApp === 'string') {
        ownerWhatsApp = settingsSnap.data().ownerWhatsApp;
      }
    } catch {
      // ignore
    }
    return { bookings, ownerWhatsApp };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'bookings');
  }
}

export async function confirmOwnerBooking(
  bookingId: string,
  message: string
): Promise<{ booking?: BookingRecord; error?: string }> {
  const cleanMessage = message.trim().slice(0, 500);
  if (cleanMessage.length < 5) {
    return { error: 'Escreva uma mensagem de confirmação para o cliente.' };
  }

  const confirmedAtIso = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'bookings', bookingId), {
      status: 'confirmed',
      confirmationMessage: cleanMessage,
      confirmedAt: confirmedAtIso,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'booking_statuses', bookingId), {
      status: 'confirmed',
      confirmationMessage: cleanMessage,
      confirmedAt: confirmedAtIso,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const updatedSnap = await getDoc(doc(db, 'bookings', bookingId));
    if (updatedSnap.exists()) {
      return { booking: mapFirestoreBooking(updatedSnap.data(), bookingId) };
    }
    return { error: 'Reserva não encontrada.' };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
  }
}

export async function cancelOwnerBooking(
  booking: BookingRecord,
  message: string
): Promise<{ booking?: BookingRecord; error?: string }> {
  const cleanMessage = message.trim().slice(0, 500);
  const confirmedAtIso = new Date().toISOString();
  const slotKey = getSlotKey(booking.date, booking.specialistId, booking.time);

  try {
    const batch = writeBatch(db);
    const updateData: Record<string, unknown> = {
      status: 'cancelled',
      confirmedAt: confirmedAtIso,
      updatedAt: serverTimestamp(),
    };
    if (cleanMessage) {
      updateData.confirmationMessage = cleanMessage;
    }

    batch.update(doc(db, 'bookings', booking.id), updateData);
    batch.update(doc(db, 'booking_statuses', booking.id), updateData);
    batch.update(doc(db, 'slot_locks', slotKey), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const updatedSnap = await getDoc(doc(db, 'bookings', booking.id));
    if (updatedSnap.exists()) {
      return { booking: mapFirestoreBooking(updatedSnap.data(), booking.id) };
    }
    return { error: 'Reserva não encontrada.' };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
  }
}

export async function importBookingToOwner(
  booking: BookingRecord
): Promise<{ imported: boolean }> {
  try {
    const existing = await getDoc(doc(db, 'bookings', booking.id));
    if (existing.exists()) {
      return { imported: false };
    }
    const slotKey = getSlotKey(booking.date, booking.specialistId, booking.time);
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      id: booking.id,
      guestId: 'imported_whatsapp',
      clientUid: '',
      customerName: booking.customerName.slice(0, 80),
      customerPhone: (booking.customerPhone || 'Não informado').slice(0, 24),
      serviceId: booking.serviceId,
      serviceName: booking.serviceName.slice(0, 120),
      specialistId: booking.specialistId,
      specialistName: booking.specialistName.slice(0, 80),
      date: booking.date,
      time: booking.time,
      durationMin: Math.round(booking.durationMin || 60),
      totalBrl: Number(booking.totalBrl || 0),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (booking.notes) {
      payload.notes = booking.notes.slice(0, 400);
    }
    batch.set(doc(db, 'bookings', booking.id), payload);
    batch.set(doc(db, 'booking_statuses', booking.id), {
      bookingId: booking.id,
      serviceName: booking.serviceName.slice(0, 120),
      specialistName: booking.specialistName.slice(0, 80),
      date: booking.date,
      time: booking.time,
      durationMin: Math.round(booking.durationMin || 60),
      totalBrl: Number(booking.totalBrl || 0),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'slot_locks', slotKey), {
      bookingId: booking.id,
      date: booking.date,
      specialistId: booking.specialistId,
      time: booking.time,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { imported: true };
  } catch {
    return { imported: false };
  }
}
