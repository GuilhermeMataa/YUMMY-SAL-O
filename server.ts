import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'yummy-db.json');
const CLIENT_COOKIE_NAME = 'yummy_client_session';
const OWNER_COOKIE_NAME = 'yummy_owner_session';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.createHash('sha256').update(process.env.APP_URL || 'yummy-salao-local-dev-secret').digest('hex');

interface StoredUser {
  id: string;
  name: string;
  phone: string;
  email?: string;
  createdAt: string;
}

interface StoredOwnerAccount {
  login: string;
  passwordSalt: string;
  passwordHash: string;
  isDefaultPassword: boolean;
  updatedAt: string;
}

interface StoredBooking {
  id: string;
  userId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  notes?: string;
  serviceId: string;
  serviceName: string;
  specialistId: string;
  specialistName: string;
  date: string;
  time: string;
  durationMin: number;
  totalBrl: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmationMessage?: string;
  confirmedAt?: string;
  createdAt: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  bookings: StoredBooking[];
  ownerAccount: StoredOwnerAccount;
  ownerWhatsApp?: string;
}

import {
  SALON_SERVICES,
  SIGNATURE_RITUALS,
  SPECIALISTS,
  TIME_SLOTS,
} from './src/data/catalog.ts';

function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password: string, account: StoredOwnerAccount): boolean {
  const { hash } = hashPassword(password, account.passwordSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(account.passwordHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createDefaultOwnerAccount(): StoredOwnerAccount {
  const { salt, hash } = hashPassword('admin');
  return {
    login: 'admin',
    passwordSalt: salt,
    passwordHash: hash,
    isDefaultPassword: true,
    updatedAt: new Date().toISOString(),
  };
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

function createInitialDb(): DatabaseSchema {
  const sampleDate = nextWeekdayDate(1);
  return {
    users: [],
    ownerAccount: createDefaultOwnerAccount(),
    ownerWhatsApp: '',
    bookings: [
      {
        id: 'AGD-104A',
        userId: 'seed_client_1',
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
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      },
      {
        id: 'AGD-103B',
        userId: 'seed_client_2',
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
        confirmationMessage:
          'Olá Carolina, sua reserva de Corte Visagista & Finalização com Sofia Mendes foi confirmada. Esperamos você!',
        confirmedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
        createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      },
    ],
  };
}

function ensureDb(): DatabaseSchema {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
    const ownerAccount =
      parsed.ownerAccount && parsed.ownerAccount.login && parsed.ownerAccount.passwordHash
        ? parsed.ownerAccount
        : createDefaultOwnerAccount();
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
      ownerAccount,
      ownerWhatsApp: typeof parsed.ownerWhatsApp === 'string' ? parsed.ownerWhatsApp : '',
    };
  } catch {
    return createInitialDb();
  }
}

function saveDb(db: DatabaseSchema): void {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

function signToken(payloadObj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeDigits(phone: string | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

function getCookieFlags(req: Request): { httpOnly: true; secure: boolean; sameSite: 'none' | 'lax'; path: '/' } {
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : '';
  const isHttps = req.secure || forwardedProto.includes('https');
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
  };
}

function setClientCookie(req: Request, res: Response, userId: string): string {
  const token = signToken({ userId, role: 'client', iat: Date.now() });
  res.cookie(CLIENT_COOKIE_NAME, token, {
    ...getCookieFlags(req),
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });
  return token;
}

function setOwnerCookie(req: Request, res: Response, login: string): string {
  const token = signToken({ login, role: 'owner', iat: Date.now() });
  res.cookie(OWNER_COOKIE_NAME, token, {
    ...getCookieFlags(req),
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  return token;
}

function getAuthenticatedClient(req: Request, db: DatabaseSchema): StoredUser | null {
  const headerToken =
    typeof req.headers['x-client-token'] === 'string' ? req.headers['x-client-token'] : undefined;
  const cookies = parseCookies(req);
  const verified = verifyToken(headerToken) || verifyToken(cookies[CLIENT_COOKIE_NAME]);
  if (!verified || verified.role !== 'client' || typeof verified.userId !== 'string') return null;
  return db.users.find((u) => u.id === verified.userId) ?? null;
}

function isOwnerAuthenticated(req: Request, db: DatabaseSchema): boolean {
  const authHeader =
    typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const cookies = parseCookies(req);
  const verified = verifyToken(bearerToken) || verifyToken(cookies[OWNER_COOKIE_NAME]);
  if (!verified || verified.role !== 'owner' || typeof verified.login !== 'string') return false;
  return verified.login === db.ownerAccount.login;
}

function getOrCreateGuestSession(req: Request, res: Response): { guestId: string; guestToken: string } {
  const guestHeader =
    typeof req.headers['x-guest-token'] === 'string' ? req.headers['x-guest-token'] : undefined;
  const cookies = parseCookies(req);
  const incomingToken = guestHeader || cookies['yummy_guest'];
  const verified = verifyToken(incomingToken);
  if (verified && typeof verified.guestId === 'string' && incomingToken) {
    return { guestId: verified.guestId, guestToken: incomingToken };
  }
  const guestId = `guest_${crypto.randomUUID().slice(0, 12)}`;
  const token = signToken({ guestId, iat: Date.now() });
  res.cookie('yummy_guest', token, {
    ...getCookieFlags(req),
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });
  return { guestId, guestToken: token };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'yummy-salao' });
  });

  app.get('/api/catalog', (_req, res) => {
    const db = ensureDb();
    res.json({
      services: SALON_SERVICES,
      specialists: SPECIALISTS,
      rituals: SIGNATURE_RITUALS,
      timeSlots: TIME_SLOTS,
      ownerWhatsApp: db.ownerWhatsApp || '',
    });
  });

  app.get('/api/availability', (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const specialistId = typeof req.query.specialistId === 'string' ? req.query.specialistId : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !specialistId) {
      res.status(400).json({ error: 'Informe data (AAAA-MM-DD) e profissional válidos.' });
      return;
    }
    const db = ensureDb();
    const takenSlots = new Set(
      db.bookings
        .filter((b) => b.date === date && b.specialistId === specialistId && b.status !== 'cancelled')
        .map((b) => b.time)
    );
    const slots = TIME_SLOTS.map((time) => ({
      time,
      available: !takenSlots.has(time),
    }));
    res.json({ date, specialistId, slots });
  });

  // Client Session (Name + WhatsApp, zero email required)
  app.get('/api/auth/me', (req, res) => {
    const db = ensureDb();
    const user = getAuthenticatedClient(req, db);
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(CLIENT_COOKIE_NAME, getCookieFlags(req));
    res.json({ ok: true });
  });

  app.post('/api/auth/client', (req, res) => {
    const { name, phone } = req.body as { name?: string; phone?: string };
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    const digits = normalizeDigits(cleanPhone);
    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Informe seu nome completo (mínimo 2 caracteres).' });
      return;
    }
    if (digits.length < 8) {
      res.status(400).json({ error: 'Informe um WhatsApp ou telefone válido (com DDD).' });
      return;
    }
    const db = ensureDb();
    let user = db.users.find((u) => normalizeDigits(u.phone) === digits);
    if (!user) {
      user = {
        id: `usr_${crypto.randomUUID().slice(0, 12)}`,
        name: cleanName.slice(0, 80),
        phone: cleanPhone.slice(0, 24),
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      saveDb(db);
    } else if (cleanName && user.name !== cleanName) {
      user.name = cleanName.slice(0, 80);
      user.phone = cleanPhone.slice(0, 24);
      saveDb(db);
    }
    const clientToken = setClientCookie(req, res, user.id);
    res.json({ user, clientToken });
  });

  // Client Bookings API
  app.get('/api/bookings', (req, res) => {
    const db = ensureDb();
    const user = getAuthenticatedClient(req, db);
    const guestSession = user ? null : getOrCreateGuestSession(req, res);
    const actorId = user ? user.id : guestSession!.guestId;
    const userPhoneDigits = user ? normalizeDigits(user.phone) : '';
    const list = db.bookings
      .filter(
        (b) =>
          b.userId === actorId ||
          (user && userPhoneDigits.length >= 8 && normalizeDigits(b.customerPhone) === userPhoneDigits)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ bookings: list, guestToken: guestSession?.guestToken });
  });

  app.post('/api/bookings', (req, res) => {
    const db = ensureDb();
    const user = getAuthenticatedClient(req, db);
    const guestSession = user ? null : getOrCreateGuestSession(req, res);
    const actorId = user ? user.id : guestSession!.guestId;

    const { serviceId, specialistId, date, time, customerName, customerPhone, notes } = req.body as {
      serviceId?: string;
      specialistId?: string;
      date?: string;
      time?: string;
      customerName?: string;
      customerPhone?: string;
      notes?: string;
    };

    const service = SALON_SERVICES.find((s) => s.id === serviceId);
    const specialist = SPECIALISTS.find((sp) => sp.id === specialistId);
    if (!service || !specialist) {
      res.status(400).json({ error: 'Serviço ou especialista selecionado é inválido.' });
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !TIME_SLOTS.includes(time)) {
      res.status(400).json({ error: 'Data ou horário selecionado é inválido.' });
      return;
    }
    const conflict = db.bookings.some(
      (b) => b.date === date && b.specialistId === specialist.id && b.time === time && b.status !== 'cancelled'
    );
    if (conflict) {
      res.status(409).json({ error: 'Este horário acabou de ser reservado. Escolha outro horário disponível.' });
      return;
    }

    const name = (customerName || user?.name || '').trim();
    const phone = (customerPhone || user?.phone || '').trim();
    if (name.length < 2) {
      res.status(400).json({ error: 'Informe seu nome completo para solicitar a reserva.' });
      return;
    }
    if (normalizeDigits(phone).length < 8) {
      res.status(400).json({ error: 'Informe seu WhatsApp com DDD para contato e confirmação.' });
      return;
    }

    const cleanNotes = notes && notes.trim() ? notes.trim().slice(0, 400) : undefined;

    const booking: StoredBooking = {
      id: `AGD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      userId: actorId,
      customerName: name.slice(0, 80),
      customerPhone: phone.slice(0, 24),
      notes: cleanNotes,
      serviceId: service.id,
      serviceName: service.name,
      specialistId: specialist.id,
      specialistName: specialist.name,
      date,
      time,
      durationMin: service.durationMin,
      totalBrl: service.priceBrl,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(booking);
    saveDb(db);
    res.status(201).json({
      booking,
      ownerWhatsApp: db.ownerWhatsApp || '',
      guestToken: guestSession?.guestToken,
    });
  });

  app.patch('/api/bookings/:id/cancel', (req, res) => {
    const db = ensureDb();
    const user = getAuthenticatedClient(req, db);
    const guestSession = user ? null : getOrCreateGuestSession(req, res);
    const actorId = user ? user.id : guestSession!.guestId;
    const userPhoneDigits = user ? normalizeDigits(user.phone) : '';
    const booking = db.bookings.find((b) => b.id === req.params.id);
    if (
      !booking ||
      (booking.userId !== actorId &&
        (!user || userPhoneDigits.length < 8 || normalizeDigits(booking.customerPhone) !== userPhoneDigits))
    ) {
      res.status(404).json({ error: 'Agendamento não encontrado.' });
      return;
    }
    booking.status = 'cancelled';
    saveDb(db);
    res.json({ booking });
  });

  // Owner Authentication (Login + Password)
  app.get('/api/owner/session', (req, res) => {
    const db = ensureDb();
    const authenticated = isOwnerAuthenticated(req, db);
    res.json({
      authenticated,
      login: authenticated ? db.ownerAccount.login : undefined,
      isDefaultPassword: db.ownerAccount.isDefaultPassword,
      ownerWhatsApp: authenticated ? db.ownerWhatsApp || '' : undefined,
    });
  });

  app.post('/api/owner/login', (req, res) => {
    const { login, password } = req.body as { login?: string; password?: string };
    const cleanLogin = (login || '').trim().toLowerCase();
    const cleanPassword = password || '';
    const db = ensureDb();

    if (cleanLogin !== db.ownerAccount.login.toLowerCase() || !verifyPassword(cleanPassword, db.ownerAccount)) {
      res.status(401).json({ error: 'Login ou senha incorretos.' });
      return;
    }

    const ownerToken = setOwnerCookie(req, res, db.ownerAccount.login);
    res.json({
      authenticated: true,
      login: db.ownerAccount.login,
      isDefaultPassword: db.ownerAccount.isDefaultPassword,
      ownerWhatsApp: db.ownerWhatsApp || '',
      ownerToken,
    });
  });

  app.post('/api/owner/logout', (req, res) => {
    res.clearCookie(OWNER_COOKIE_NAME, getCookieFlags(req));
    res.json({ ok: true });
  });

  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    const db = ensureDb();
    if (!isOwnerAuthenticated(req, db)) {
      res.status(401).json({ error: 'Autenticação do dono necessária.' });
      return;
    }
    next();
  };

  app.post('/api/owner/credentials', requireOwner, (req, res) => {
    const { newLogin, newPassword } = req.body as { newLogin?: string; newPassword?: string };
    const cleanLogin = (newLogin || '').trim().toLowerCase();
    const cleanPassword = (newPassword || '').trim();
    if (cleanLogin.length < 3) {
      res.status(400).json({ error: 'O login deve ter pelo menos 3 caracteres.' });
      return;
    }
    if (cleanPassword.length < 4) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
      return;
    }
    const db = ensureDb();
    const { salt, hash } = hashPassword(cleanPassword);
    db.ownerAccount = {
      login: cleanLogin.slice(0, 60),
      passwordSalt: salt,
      passwordHash: hash,
      isDefaultPassword: false,
      updatedAt: new Date().toISOString(),
    };
    saveDb(db);
    const ownerToken = setOwnerCookie(req, res, db.ownerAccount.login);
    res.json({
      authenticated: true,
      login: db.ownerAccount.login,
      isDefaultPassword: false,
      ownerWhatsApp: db.ownerWhatsApp || '',
      ownerToken,
    });
  });

  app.post('/api/owner/whatsapp', requireOwner, (req, res) => {
    const { whatsapp } = req.body as { whatsapp?: string };
    const clean = (whatsapp || '').trim().slice(0, 24);
    const digits = normalizeDigits(clean);
    if (clean && digits.length < 10) {
      res.status(400).json({ error: 'Informe um WhatsApp válido com DDD (ex: (11) 99999-9999).' });
      return;
    }
    const db = ensureDb();
    db.ownerWhatsApp = clean;
    saveDb(db);
    res.json({ ownerWhatsApp: db.ownerWhatsApp });
  });

  // Protected Owner Reservations & Confirmations API
  app.get('/api/owner/overview', requireOwner, (_req, res) => {
    const db = ensureDb();
    const bookings = [...db.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ bookings, ownerWhatsApp: db.ownerWhatsApp || '' });
  });

  app.post('/api/owner/bookings/import', requireOwner, (req, res) => {
    const { booking } = req.body as { booking?: Partial<StoredBooking> };
    if (!booking || !booking.id || !booking.customerName || !booking.serviceId || !booking.date || !booking.time) {
      res.status(400).json({ error: 'Dados da reserva inválidos para importação.' });
      return;
    }
    const db = ensureDb();
    const existing = db.bookings.find((b) => b.id === booking.id);
    if (existing) {
      res.json({ booking: existing, imported: false });
      return;
    }
    const service = SALON_SERVICES.find((s) => s.id === booking.serviceId);
    const specialist = SPECIALISTS.find((sp) => sp.id === booking.specialistId);
    const importedRecord: StoredBooking = {
      id: String(booking.id).slice(0, 24),
      userId: String(booking.userId || 'imported_client').slice(0, 40),
      customerName: String(booking.customerName).slice(0, 80),
      customerPhone: String(booking.customerPhone || '').slice(0, 24),
      notes: booking.notes ? String(booking.notes).slice(0, 400) : undefined,
      serviceId: service ? service.id : String(booking.serviceId),
      serviceName: service ? service.name : String(booking.serviceName || 'Serviço'),
      specialistId: specialist ? specialist.id : String(booking.specialistId || ''),
      specialistName: specialist ? specialist.name : String(booking.specialistName || 'Especialista'),
      date: String(booking.date).slice(0, 10),
      time: String(booking.time).slice(0, 5),
      durationMin: service ? service.durationMin : Number(booking.durationMin) || 60,
      totalBrl: service ? service.priceBrl : Number(booking.totalBrl) || 0,
      status: 'pending',
      createdAt: booking.createdAt ? String(booking.createdAt) : new Date().toISOString(),
    };
    db.bookings.push(importedRecord);
    saveDb(db);
    res.status(201).json({ booking: importedRecord, imported: true });
  });

  app.post('/api/owner/bookings/:id/confirm', requireOwner, (req, res) => {
    const db = ensureDb();
    const booking = db.bookings.find((b) => b.id === req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }
    const { message } = req.body as { message?: string };
    const cleanMessage = (message || '').trim();
    if (cleanMessage.length < 5) {
      res.status(400).json({ error: 'Escreva uma mensagem de confirmação para o cliente.' });
      return;
    }
    booking.status = 'confirmed';
    booking.confirmationMessage = cleanMessage.slice(0, 500);
    booking.confirmedAt = new Date().toISOString();
    saveDb(db);
    res.json({ booking });
  });

  app.post('/api/owner/bookings/:id/cancel', requireOwner, (req, res) => {
    const db = ensureDb();
    const booking = db.bookings.find((b) => b.id === req.params.id);
    if (!booking) {
      res.status(404).json({ error: 'Reserva não encontrada.' });
      return;
    }
    const { message } = req.body as { message?: string };
    booking.status = 'cancelled';
    if (message && message.trim()) {
      booking.confirmationMessage = message.trim().slice(0, 500);
    }
    booking.confirmedAt = new Date().toISOString();
    saveDb(db);
    res.json({ booking });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Yummy Salão server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
