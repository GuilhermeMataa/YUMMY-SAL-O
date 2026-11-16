import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Send,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  Search,
  Lock,
  LogOut,
  KeyRound,
  MessageSquare,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import {
  cancelOwnerBooking,
  confirmOwnerBooking,
  connectOwnerGoogle,
  fetchOwnerOverview,
  fetchOwnerSession,
  importBookingToOwner,
  loginOwner,
  logoutOwner,
  seedInitialBookingsIfEmpty,
  subscribeOwnerBookings,
  updateOwnerCredentials,
  updateOwnerWhatsApp,
} from '../services/salonApi';
import type { BookingRecord } from '../types';
import { formatBrl, formatDateBr, formatDateTimeBr } from '../utils/format';

interface OwnerPanelProps {
  onBackToSalon: () => void;
  onDataUpdated: () => void;
  onWhatsAppUpdated?: (whatsapp: string) => void;
  pendingImportBooking?: BookingRecord | null;
  onImportHandled?: () => void;
}

type OwnerFilter = 'all' | 'pending' | 'confirmed' | 'cancelled';

function buildDefaultMessage(booking: BookingRecord): string {
  return `Olá ${booking.customerName}, sua reserva de ${booking.serviceName} no Yummy Salão para ${formatDateBr(booking.date)} às ${booking.time} com ${booking.specialistName} foi confirmada. Esperamos você!`;
}

function buildAddressMessage(booking: BookingRecord): string {
  return `Olá ${booking.customerName}, confirmamos seu horário para ${formatDateBr(booking.date)} às ${booking.time} (${booking.serviceName}). Nosso endereço: Alameda Lorena, 1420 — Jardins, São Paulo.`;
}

function buildReminderMessage(booking: BookingRecord): string {
  return `Olá ${booking.customerName}, tudo confirmado para ${booking.serviceName} em ${formatDateBr(booking.date)} às ${booking.time} com ${booking.specialistName}. Recomendamos chegar 10 minutos antes.`;
}

function buildWhatsAppUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export const OwnerPanel: React.FC<OwnerPanelProps> = ({
  onBackToSalon,
  onDataUpdated,
  onWhatsAppUpdated,
  pendingImportBooking,
  onImportHandled,
}) => {
  const [session, setSession] = useState<{
    authenticated: boolean;
    passwordVerified: boolean;
    cloudConnected: boolean;
    wrongAccountEmail?: string;
    login?: string;
    isDefaultPassword?: boolean;
    ownerWhatsApp?: string;
  } | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [showCredsEditor, setShowCredsEditor] = useState(false);
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsMessage, setCredsMessage] = useState<string | null>(null);

  const [showWhatsAppEditor, setShowWhatsAppEditor] = useState(false);
  const [ownerWhatsAppInput, setOwnerWhatsAppInput] = useState('');
  const [whatsAppSaving, setWhatsAppSaving] = useState(false);

  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<OwnerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const applyBookingsList = useCallback((listBookings: BookingRecord[]) => {
    setBookings(listBookings);
    setDraftMessages((prev) => {
      const next = { ...prev };
      for (const b of listBookings) {
        if (!next[b.id]) {
          next[b.id] = b.confirmationMessage || buildDefaultMessage(b);
        }
      }
      return next;
    });
  }, []);

  const fetchOverview = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setErrorMsg(null);
      }
      try {
        const result = await fetchOwnerOverview();
        if (result.unauthorized) {
          const freshSession = await fetchOwnerSession();
          setSession(freshSession);
          return;
        }
        if (result.error) {
          if (!silent) setErrorMsg(result.error);
          return;
        }
        applyBookingsList(result.bookings);
        if (typeof result.ownerWhatsApp === 'string' && !silent) {
          setOwnerWhatsAppInput(result.ownerWhatsApp);
        }
      } catch {
        if (!silent) setErrorMsg('Não foi possível carregar as reservas do salão.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyBookingsList]
  );

  useEffect(() => {
    const checkSession = async () => {
      setSessionLoading(true);
      try {
        const data = await fetchOwnerSession();
        setSession(data);
        setNewLogin(data.login || 'admin');
        setOwnerWhatsAppInput(data.ownerWhatsApp || '');
      } finally {
        setSessionLoading(false);
      }
    };
    checkSession();
  }, []);

  // Real-time Firestore listener when owner is fully authenticated (admin password + cloud Google connected)
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    setLoading(true);

    seedInitialBookingsIfEmpty().catch(() => {});

    const unsubscribe = subscribeOwnerBookings(
      (list) => {
        if (!active) return;
        applyBookingsList(list);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setErrorMsg(err);
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [session?.authenticated, applyBookingsList]);

  useEffect(() => {
    if (!session?.authenticated || !pendingImportBooking) return;
    const runImport = async () => {
      await importBookingToOwner(pendingImportBooking);
      setFeedbackBanner(
        `Reserva ${pendingImportBooking.id} de ${pendingImportBooking.customerName} carregada no painel.`
      );
      onImportHandled?.();
    };
    runImport();
  }, [session?.authenticated, pendingImportBooking, onImportHandled]);

  const handleOwnerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const data = await loginOwner(loginInput, passwordInput);
      if (!data.passwordVerified) {
        setLoginError(data.error || 'Login ou senha inválidos.');
        return;
      }
      setSession(data);
      setNewLogin(data.login || 'admin');
      setOwnerWhatsAppInput(data.ownerWhatsApp || '');
      setPasswordInput('');
    } catch {
      setLoginError('Falha ao validar acesso.');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleConnectGoogleOwner = async () => {
    setLoginError(null);
    setCloudConnecting(true);
    try {
      const data = await connectOwnerGoogle();
      setSession(data);
      if (data.error) {
        setLoginError(data.error);
      }
    } catch {
      setLoginError('Não foi possível conectar a conta Google do dono.');
    } finally {
      setCloudConnecting(false);
    }
  };

  const handleOwnerLogout = async () => {
    await logoutOwner();
    const fresh = await fetchOwnerSession();
    setSession(fresh);
    setBookings([]);
    setShowCredsEditor(false);
    setShowWhatsAppEditor(false);
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredsSaving(true);
    setCredsMessage(null);
    setErrorMsg(null);
    try {
      const data = await updateOwnerCredentials(newLogin, newPassword);
      if (!data.authenticated) {
        setErrorMsg(data.error || 'Não foi possível atualizar login e senha.');
        return;
      }
      setSession((prev) => ({
        authenticated: true,
        passwordVerified: true,
        cloudConnected: true,
        login: data.login,
        isDefaultPassword: false,
        ownerWhatsApp: prev?.ownerWhatsApp,
      }));
      setNewPassword('');
      setCredsMessage('Login e senha atualizados com sucesso.');
      setShowCredsEditor(false);
    } catch {
      setErrorMsg('Falha ao salvar credenciais.');
    } finally {
      setCredsSaving(false);
    }
  };

  const handleUpdateWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setWhatsAppSaving(true);
    setCredsMessage(null);
    setErrorMsg(null);
    try {
      const res = await updateOwnerWhatsApp(ownerWhatsAppInput);
      if (res.error !== undefined) {
        setErrorMsg(res.error);
        return;
      }
      const saved = res.ownerWhatsApp || '';
      setOwnerWhatsAppInput(saved);
      onWhatsAppUpdated?.(saved);
      setCredsMessage(
        saved
          ? `WhatsApp do salão (${saved}) salvo na nuvem para todos os clientes.`
          : 'Número de WhatsApp do salão removido.'
      );
      setShowWhatsAppEditor(false);
    } catch {
      setErrorMsg('Falha ao salvar o WhatsApp do salão.');
    } finally {
      setWhatsAppSaving(false);
    }
  };

  const handleConfirmBooking = async (booking: BookingRecord) => {
    const message = (draftMessages[booking.id] || buildDefaultMessage(booking)).trim();
    setSubmittingId(booking.id);
    setErrorMsg(null);
    setFeedbackBanner(null);
    try {
      const data = await confirmOwnerBooking(booking.id, message);
      if (!data.booking) {
        setErrorMsg(data.error || 'Erro ao enviar confirmação.');
        return;
      }
      setBookings((prev) => prev.map((b) => (b.id === booking.id ? data.booking! : b)));
      setFeedbackBanner(
        `Confirmação sincronizada na nuvem para ${booking.customerName} (${booking.customerPhone}).`
      );
      onDataUpdated();
    } catch {
      setErrorMsg('Falha de rede ao enviar confirmação.');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleCancelBooking = async (booking: BookingRecord) => {
    setSubmittingId(booking.id);
    setErrorMsg(null);
    setFeedbackBanner(null);
    try {
      const data = await cancelOwnerBooking(
        booking,
        `Olá ${booking.customerName}, infelizmente precisamos reagendar sua reserva ${booking.id}. Entre em contato conosco para escolher um novo horário.`
      );
      if (!data.booking) {
        setErrorMsg(data.error || 'Erro ao cancelar reserva.');
        return;
      }
      setBookings((prev) => prev.map((b) => (b.id === booking.id ? data.booking! : b)));
      setFeedbackBanner(`Reserva ${booking.id} marcada como cancelada.`);
      onDataUpdated();
    } catch {
      setErrorMsg('Falha de rede ao atualizar reserva.');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  if (sessionLoading) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-16 lg:px-8">
        <div className="rounded-xl border border-[#EADCE1] bg-white p-12 text-center text-sm text-[#755F67]">
          Verificando sessão do painel...
        </div>
      </main>
    );
  }

  // Step 1: Ask for admin login & password first
  if (!session?.passwordVerified) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-14 lg:px-8">
        <button
          type="button"
          onClick={onBackToSalon}
          className="inline-flex items-center gap-2 text-xs font-medium text-[#755F67] hover:text-[#1F181B]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar para o salão</span>
        </button>

        <div className="mx-auto mt-8 max-w-md rounded-xl border border-[#EADCE1] bg-white p-8 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wider text-[#9E3556] uppercase">
            <Lock className="h-3.5 w-3.5 text-[#A63A5B]" />
            <span>Área Administrativa</span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#1F181B]">
            Acesso do Dono
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#755F67]">
            Informe o login e a senha do administrador para receber as reservas e mensagens dos clientes sincronizadas em tempo real.
          </p>

          <form onSubmit={handleOwnerLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="owner-login" className="block text-xs font-medium text-[#1F181B]">
                Login
              </label>
              <input
                id="owner-login"
                type="text"
                required
                autoComplete="username"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="admin"
                className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3.5 py-2.5 text-sm text-[#1F181B] placeholder:text-[#A38F96] focus:border-[#A63A5B] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="owner-password" className="block text-xs font-medium text-[#1F181B]">
                Senha
              </label>
              <input
                id="owner-password"
                type="password"
                required
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="•••••"
                className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3.5 py-2.5 text-sm text-[#1F181B] placeholder:text-[#A38F96] focus:border-[#A63A5B] focus:outline-none"
              />
            </div>

            {loginError && (
              <p className="text-xs font-medium text-[#9B2226]" role="alert">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full rounded-lg bg-[#A63A5B] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8C2D4A] disabled:opacity-60"
            >
              {loginSubmitting ? 'Verificando...' : 'Entrar no Painel'}
            </button>
          </form>

          {session?.isDefaultPassword && (
            <p className="mt-5 border-t border-[#EADCE1] pt-4 text-xs text-[#755F67]">
              Acesso padrão: login <strong className="font-mono text-[#1F181B]">admin</strong> e senha{' '}
              <strong className="font-mono text-[#1F181B]">admin</strong>.
            </p>
          )}
        </div>
      </main>
    );
  }

  // Step 2: Admin password verified -> Connect owner Google account for automatic cloud sync (no Client ID needed)
  if (!session.cloudConnected) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-14 lg:px-8">
        <button
          type="button"
          onClick={onBackToSalon}
          className="inline-flex items-center gap-2 text-xs font-medium text-[#755F67] hover:text-[#1F181B]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar para o salão</span>
        </button>

        <div className="mx-auto mt-8 max-w-md rounded-xl border border-[#EADCE1] bg-white p-8 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wider text-[#9E3556] uppercase">
            <ShieldCheck className="h-4 w-4 text-[#A63A5B]" />
            <span>Senha Verificada · Etapa Final</span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#1F181B]">
            Sincronizar Nuvem do Dono
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#755F67]">
            Conecte sua conta Google de proprietário com 1 clique para receber automaticamente todas as reservas vindas de clientes (sem que os clientes precisem fazer login).
          </p>

          {loginError && (
            <p className="mt-4 rounded-lg border border-[#9B2226]/30 bg-[#9B2226]/5 px-3.5 py-2.5 text-xs font-medium text-[#9B2226]" role="alert">
              {loginError}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={handleConnectGoogleOwner}
              disabled={cloudConnecting}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#A63A5B] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8C2D4A] disabled:opacity-60"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81"
                />
              </svg>
              <span>
                {cloudConnecting ? 'Conectando...' : 'Conectar Conta Google do Dono'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOwnerLogout}
              className="w-full rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#755F67] hover:bg-[#FDF2F5] hover:text-[#1F181B]"
            >
              Trocar login de administrador
            </button>
          </div>
        </div>
      </main>
    );
  }

  const pendingCount = bookings.filter((b) => b.status === 'pending').length;
  const confirmedCount = bookings.filter((b) => b.status === 'confirmed').length;
  const cancelledCount = bookings.filter((b) => b.status === 'cancelled').length;

  const q = searchQuery.trim().toLowerCase();
  const filteredBookings = bookings.filter((b) => {
    const matchesStatus = filter === 'all' ? true : b.status === filter;
    const matchesQuery =
      !q ||
      b.customerName.toLowerCase().includes(q) ||
      b.customerPhone.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      b.serviceName.toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-12 lg:px-8">
      <div className="flex flex-col gap-6 border-b border-[#EADCE1] pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <button
            type="button"
            onClick={onBackToSalon}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#755F67] hover:text-[#1F181B]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Voltar para a visão do cliente</span>
          </button>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-[#1F181B]">
            Painel do Dono — Reservas & Confirmações
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#755F67]">
            Sincronização automática na nuvem ativa: todas as reservas enviadas de qualquer celular ou navegador chegam aqui em tempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowWhatsAppEditor((v) => !v);
              setShowCredsEditor(false);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
          >
            <Phone className="h-3.5 w-3.5 text-[#A63A5B]" />
            <span>WhatsApp do Salão</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCredsEditor((v) => !v);
              setShowWhatsAppEditor(false);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Alterar Senha</span>
          </button>
          <button
            type="button"
            onClick={() => fetchOverview(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
          <button
            type="button"
            onClick={handleOwnerLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#755F67] hover:text-[#1F181B] whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sair</span>
          </button>
        </div>
      </div>

      {showWhatsAppEditor && (
        <form
          onSubmit={handleUpdateWhatsApp}
          className="mt-6 space-y-4 rounded-xl border border-[#EADCE1] bg-white p-6"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-end">
            <div className="md:col-span-2">
              <label htmlFor="owner-whatsapp" className="block text-xs font-medium text-[#1F181B]">
                WhatsApp do Dono para receber mensagens das reservas (com DDD)
              </label>
              <input
                id="owner-whatsapp"
                type="tel"
                value={ownerWhatsAppInput}
                onChange={(e) => setOwnerWhatsAppInput(e.target.value)}
                placeholder="(11) 99999-9999"
                className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3.5 py-2 text-sm tabular-nums text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={whatsAppSaving}
                className="rounded-lg bg-[#A63A5B] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#8C2D4A] disabled:opacity-60 whitespace-nowrap"
              >
                {whatsAppSaving ? 'Salvando...' : 'Salvar WhatsApp'}
              </button>
              <button
                type="button"
                onClick={() => setShowWhatsAppEditor(false)}
                className="rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#755F67] hover:text-[#1F181B]"
              >
                Cancelar
              </button>
            </div>
          </div>

          {ownerWhatsAppInput.replace(/\D/g, '').length >= 10 && typeof window !== 'undefined' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EADCE1] pt-3 text-xs text-[#755F67]">
              <span>
                Link direto de agendamento para compartilhar com clientes:
              </span>
              <button
                type="button"
                onClick={() => {
                  const digits = ownerWhatsAppInput.replace(/\D/g, '');
                  const full = digits.startsWith('55') ? digits : `55${digits}`;
                  handleCopy('salon-share-link', `${window.location.origin}/?w=${full}`);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2CFD6] bg-[#FCF9FA] px-3 py-1.5 font-medium text-[#1F181B] hover:bg-[#FDF2F5]"
              >
                {copiedId === 'salon-share-link' ? (
                  <Check className="h-3.5 w-3.5 text-[#A63A5B]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>
                  {copiedId === 'salon-share-link'
                    ? 'Link copiado'
                    : 'Copiar Link para Clientes'}
                </span>
              </button>
            </div>
          )}
        </form>
      )}

      {showCredsEditor && (
        <form
          onSubmit={handleUpdateCredentials}
          className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-[#EADCE1] bg-white p-6 md:grid-cols-3 md:items-end"
        >
          <div>
            <label htmlFor="new-owner-login" className="block text-xs font-medium text-[#1F181B]">
              Novo login
            </label>
            <input
              id="new-owner-login"
              type="text"
              required
              minLength={3}
              value={newLogin}
              onChange={(e) => setNewLogin(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="new-owner-pass" className="block text-xs font-medium text-[#1F181B]">
              Nova senha (mín. 4 caracteres)
            </label>
            <input
              id="new-owner-pass"
              type="password"
              required
              minLength={4}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Digite a nova senha"
              className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={credsSaving}
              className="rounded-lg bg-[#A63A5B] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#8C2D4A] disabled:opacity-60 whitespace-nowrap"
            >
              {credsSaving ? 'Salvando...' : 'Salvar Acesso'}
            </button>
            <button
              type="button"
              onClick={() => setShowCredsEditor(false)}
              className="rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#755F67] hover:text-[#1F181B]"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {credsMessage && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-[#E8C5D0] bg-[#FDF2F5] px-4 py-3 text-sm text-[#9E3556]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{credsMessage}</span>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 divide-y divide-[#EADCE1] overflow-hidden rounded-xl border border-[#EADCE1] bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-6">
          <p className="text-xs font-medium text-[#755F67]">Aguardando Confirmação</p>
          <p className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#9A5B13]">
            {pendingCount}
          </p>
          <p className="mt-1 text-xs text-[#755F67]">Solicitações para responder</p>
        </div>
        <div className="p-6">
          <p className="text-xs font-medium text-[#755F67]">Reservas Confirmadas</p>
          <p className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#A63A5B]">
            {confirmedCount}
          </p>
          <p className="mt-1 text-xs text-[#755F67]">Clientes já notificados</p>
        </div>
        <div className="p-6">
          <p className="text-xs font-medium text-[#755F67]">Total de Agendamentos</p>
          <p className="mt-2 font-mono tabular-nums text-3xl font-semibold text-[#1F181B]">
            {bookings.length}
          </p>
          <p className="mt-1 text-xs text-[#755F67]">{cancelledCount} cancelada(s)</p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#F7EFF2] p-1">
          {(
            [
              { id: 'all', label: `Todas (${bookings.length})` },
              { id: 'pending', label: `Pendentes (${pendingCount})` },
              { id: 'confirmed', label: `Confirmadas (${confirmedCount})` },
              { id: 'cancelled', label: `Canceladas (${cancelledCount})` },
            ] as { id: OwnerFilter; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white text-[#1F181B] shadow-sm'
                  : 'text-[#755F67] hover:text-[#1F181B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A38F96]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar cliente, WhatsApp ou código..."
            className="w-full rounded-lg border border-[#E2CFD6] bg-white py-2 pl-9 pr-3 text-sm text-[#1F181B] placeholder:text-[#A38F96] focus:border-[#A63A5B] focus:outline-none"
          />
        </div>
      </div>

      {feedbackBanner && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-[#E8C5D0] bg-[#FDF2F5] px-4 py-3 text-sm text-[#9E3556]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedbackBanner}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mt-6 rounded-lg border border-[#9B2226]/30 bg-[#9B2226]/5 px-4 py-3 text-sm text-[#9B2226]">
          {errorMsg}
        </div>
      )}

      <section className="mt-6 space-y-4">
        {loading ? (
          <div className="rounded-xl border border-[#EADCE1] bg-white p-10 text-center text-sm text-[#755F67]">
            Carregando reservas dos clientes na nuvem...
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="rounded-xl border border-[#EADCE1] bg-white p-10 text-center text-sm text-[#755F67]">
            Nenhuma reserva encontrada para os filtros selecionados.
          </div>
        ) : (
          filteredBookings.map((booking) => {
            const draft = draftMessages[booking.id] ?? buildDefaultMessage(booking);
            const whatsappUrl = buildWhatsAppUrl(booking.customerPhone, draft);

            return (
              <article key={booking.id} className="rounded-xl border border-[#EADCE1] bg-white p-6">
                <div className="flex flex-col gap-4 border-b border-[#EADCE1] pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#755F67]">
                      <span className="font-mono font-medium text-[#1F181B]">
                        {booking.id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {formatDateBr(booking.date)} às {booking.time}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{booking.durationMin} min</span>
                      <span aria-hidden="true">·</span>
                      {booking.status === 'confirmed' ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#A63A5B]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirmada
                        </span>
                      ) : booking.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#755F67]">
                          <XCircle className="h-3.5 w-3.5" />
                          Cancelada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-[#9A5B13]">
                          <Clock className="h-3.5 w-3.5" />
                          Aguardando confirmação
                        </span>
                      )}
                    </div>

                    <h2 className="font-display text-2xl font-semibold text-[#1F181B]">
                      {booking.customerName}
                    </h2>
                    <p className="text-sm tabular-nums text-[#755F67]">
                      WhatsApp: {booking.customerPhone || 'Não informado'}
                    </p>
                  </div>

                  <div className="text-left lg:text-right">
                    <p className="text-sm font-semibold text-[#1F181B]">
                      {booking.serviceName}
                    </p>
                    <p className="text-xs text-[#755F67]">
                      Profissional: {booking.specialistName}
                    </p>
                    <p className="mt-1 font-mono tabular-nums text-base font-semibold text-[#1F181B]">
                      {formatBrl(booking.totalBrl)}
                    </p>
                  </div>
                </div>

                {booking.notes && (
                  <div className="mt-4 rounded-lg border border-[#E8C5D0] bg-[#FDF2F5] px-4 py-3 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-[#9E3556]">
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                      <span>Mensagem do cliente para o dono</span>
                    </div>
                    <p className="mt-1 leading-relaxed text-[#1F181B]">{booking.notes}</p>
                  </div>
                )}

                {booking.status !== 'cancelled' && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor={`msg-${booking.id}`}
                        className="text-xs font-medium text-[#1F181B]"
                      >
                        Mensagem de confirmação para o cliente
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setDraftMessages((prev) => ({
                              ...prev,
                              [booking.id]: buildDefaultMessage(booking),
                            }))
                          }
                          className="text-[#755F67] hover:text-[#A63A5B] hover:underline"
                        >
                          Modelo padrão
                        </button>
                        <span className="text-[#E2CFD6]">·</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftMessages((prev) => ({
                              ...prev,
                              [booking.id]: buildAddressMessage(booking),
                            }))
                          }
                          className="text-[#755F67] hover:text-[#A63A5B] hover:underline"
                        >
                          Com endereço
                        </button>
                        <span className="text-[#E2CFD6]">·</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftMessages((prev) => ({
                              ...prev,
                              [booking.id]: buildReminderMessage(booking),
                            }))
                          }
                          className="text-[#755F67] hover:text-[#A63A5B] hover:underline"
                        >
                          Lembrete 10 min
                        </button>
                      </div>
                    </div>

                    <textarea
                      id={`msg-${booking.id}`}
                      rows={2}
                      value={draft}
                      onChange={(e) =>
                        setDraftMessages((prev) => ({
                          ...prev,
                          [booking.id]: e.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-lg border border-[#E2CFD6] bg-[#FCF9FA] px-3.5 py-2.5 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:bg-white focus:outline-none"
                    />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(booking.id, draft)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
                        >
                          {copiedId === booking.id ? (
                            <Check className="h-3.5 w-3.5 text-[#A63A5B]" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          <span>{copiedId === booking.id ? 'Copiada' : 'Copiar'}</span>
                        </button>

                        {whatsappUrl && (
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>WhatsApp do Cliente</span>
                          </a>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCancelBooking(booking)}
                          disabled={submittingId === booking.id}
                          className="rounded-lg border border-[#E2CFD6] bg-white px-4 py-2 text-xs font-medium text-[#755F67] hover:text-[#9B2226] disabled:opacity-60 whitespace-nowrap"
                        >
                          Recusar / Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmBooking(booking)}
                          disabled={submittingId === booking.id}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#A63A5B] px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#8C2D4A] disabled:opacity-60 whitespace-nowrap"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>
                            {submittingId === booking.id
                              ? 'Enviando...'
                              : booking.status === 'confirmed'
                              ? 'Reenviar Confirmação'
                              : 'Enviar Confirmação'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {booking.confirmedAt && booking.status === 'confirmed' && (
                      <p className="mt-2 text-xs text-[#755F67]">
                        Última confirmação enviada em {formatDateTimeBr(booking.confirmedAt)}.
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
};
