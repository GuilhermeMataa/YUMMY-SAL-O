import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Calendar,
  ArrowRight,
  CheckCircle2,
  User,
  Send,
  MessageSquare,
} from 'lucide-react';
import type {
  BookingRecord,
  SalonService,
  ServiceCategory,
  SignatureRitual,
  Specialist,
  UserProfile,
} from './types';
import { SALON_IMAGES } from './data/assets';
import {
  SALON_SERVICES,
  SIGNATURE_RITUALS,
  SPECIALISTS,
  TIME_SLOTS,
} from './data/catalog';
import {
  cancelClientBooking,
  createClientBooking,
  decodeBookingShareParam,
  encodeBookingShareParam,
  fetchAvailability,
  fetchCatalog,
  fetchClientBookings,
  logoutClient,
  saveOwnerWhatsAppLocally,
  subscribeAvailability,
  subscribeClientAuth,
  subscribeClientBookings,
} from './services/salonApi';
import {
  buildWhatsAppLink,
  formatBrl,
  formatDateBr,
  getNextAvailableDateIso,
  getTodayIso,
} from './utils/format';
import { AuthModal } from './components/AuthModal';
import { AccountDrawer } from './components/AccountDrawer';
import { OwnerPanel } from './components/OwnerPanel';

type CategoryFilter = 'Todos' | ServiceCategory;

function buildClientToOwnerMessage(booking: BookingRecord, includeImportLink = false): string {
  const base = `Olá! Acabei de solicitar uma reserva (${booking.id}) no Yummy Salão:\n• Cliente: ${booking.customerName}\n• WhatsApp: ${booking.customerPhone}\n• Serviço: ${booking.serviceName}\n• Especialista: ${booking.specialistName}\n• Data e horário: ${formatDateBr(booking.date)} às ${booking.time}`;
  const withNotes = booking.notes ? `${base}\n• Mensagem: ${booking.notes}` : base;
  if (!includeImportLink || typeof window === 'undefined') return withNotes;
  const link = `${window.location.origin}/?reserva=${encodeBookingShareParam(booking)}`;
  return `${withNotes}\n\nAbrir reserva no Painel do Dono:\n${link}`;
}

export default function App() {
  const [services, setServices] = useState<SalonService[]>(SALON_SERVICES);
  const [specialists, setSpecialists] = useState<Specialist[]>(SPECIALISTS);
  const [rituals, setRituals] = useState<SignatureRitual[]>(SIGNATURE_RITUALS);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);

  const [activeView, setActiveView] = useState<'salon' | 'owner'>('salon');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('Todos');

  // Booking form state
  const [selectedServiceId, setSelectedServiceId] = useState<string>(SALON_SERVICES[0].id);
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string>(SPECIALISTS[0].id);
  const [selectedDate, setSelectedDate] = useState<string>(getNextAvailableDateIso());
  const [selectedTime, setSelectedTime] = useState<string>(TIME_SLOTS[0]);
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>(() =>
    TIME_SLOTS.map((time) => ({ time, available: true }))
  );
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [ownerWhatsApp, setOwnerWhatsApp] = useState('');
  const [pendingImportBooking, setPendingImportBooking] = useState<BookingRecord | null>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [latestBooking, setLatestBooking] = useState<BookingRecord | null>(null);

  // Modals / Drawers
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState<string | null>(null);

  const refreshBookings = useCallback(async () => {
    try {
      const list = await fetchClientBookings();
      setBookings(list);
    } catch {
      // Non-blocking refresh
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wParam = params.get('w');
    const reservaParam = params.get('reserva');
    let hasHandledParam = false;

    if (wParam && wParam.replace(/\D/g, '').length >= 10) {
      saveOwnerWhatsAppLocally(wParam);
      setOwnerWhatsApp(wParam);
      hasHandledParam = true;
    }

    if (reservaParam) {
      const decoded = decodeBookingShareParam(reservaParam);
      if (decoded) {
        setPendingImportBooking(decoded);
        setActiveView('owner');
        hasHandledParam = true;
      }
    }

    if (hasHandledParam) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }

    const loadInitial = async () => {
      try {
        const catalog = await fetchCatalog();
        setServices(catalog.services);
        setSpecialists(catalog.specialists);
        setRituals(catalog.rituals);
        if (catalog.ownerWhatsApp) {
          setOwnerWhatsApp(catalog.ownerWhatsApp);
        }
        if (catalog.services[0]) {
          setSelectedServiceId((prev) => prev || catalog.services[0].id);
        }
        if (catalog.specialists[0]) {
          setSelectedSpecialistId((prev) => prev || catalog.specialists[0].id);
        }
      } finally {
        setCatalogLoading(false);
      }
    };
    loadInitial();

    const unsubAuth = subscribeClientAuth((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setCustomerName((prev) => prev || currentUser.name);
        if (currentUser.phone) {
          setCustomerPhone((prev) => prev || currentUser.phone);
        }
      }
    });

    return () => {
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    const unsubBookings = subscribeClientBookings((list) => {
      setBookings(list);
    });
    return () => {
      unsubBookings();
    };
  }, [user?.id, latestBooking?.id]);

  const loadAvailability = useCallback(async (date: string, specialistId: string) => {
    if (!date || !specialistId) return;
    setSlotsLoading(true);
    try {
      const nextSlots = await fetchAvailability(date, specialistId);
      setSlots(nextSlots);
      setSelectedTime((prev) => {
        const stillAvailable = nextSlots.some((s) => s.time === prev && s.available);
        if (stillAvailable) return prev;
        return nextSlots.find((s) => s.available)?.time || '';
      });
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedDate || !selectedSpecialistId) return;
    setSlotsLoading(true);
    const unsub = subscribeAvailability(selectedDate, selectedSpecialistId, (nextSlots) => {
      setSlots(nextSlots);
      setSelectedTime((prev) => {
        const stillAvailable = nextSlots.some((s) => s.time === prev && s.available);
        if (stillAvailable) return prev;
        return nextSlots.find((s) => s.available)?.time || '';
      });
      setSlotsLoading(false);
    });
    return () => {
      unsub();
    };
  }, [selectedDate, selectedSpecialistId]);

  const handleAuthenticated = (loggedUser: UserProfile) => {
    setUser(loggedUser);
    setCustomerName((prev) => prev || loggedUser.name);
    if (loggedUser.phone) {
      setCustomerPhone((prev) => prev || loggedUser.phone);
    }
    setAccountFeedback(null);
    refreshBookings();
  };

  const handleLogout = async () => {
    await logoutClient();
    setUser(null);
    setAccountOpen(false);
    refreshBookings();
  };

  const handleSelectService = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setLatestBooking(null);
    setActiveView('salon');
    setTimeout(() => {
      const el = document.getElementById('agendar');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);

    if (!selectedTime) {
      setBookingError('Selecione um horário disponível para agendar.');
      return;
    }
    if (customerName.trim().length < 2) {
      setBookingError('Informe seu nome completo.');
      return;
    }
    if (customerPhone.replace(/\D/g, '').length < 8) {
      setBookingError('Informe seu WhatsApp com DDD para receber a confirmação.');
      return;
    }

    setBookingSubmitting(true);
    try {
      const result = await createClientBooking({
        serviceId: selectedServiceId,
        specialistId: selectedSpecialistId,
        date: selectedDate,
        time: selectedTime,
        customerName,
        customerPhone,
        notes,
      });
      if (result.error || !result.booking) {
        setBookingError(result.error || 'Não foi possível enviar sua reserva.');
        return;
      }
      if (typeof result.ownerWhatsApp === 'string') {
        setOwnerWhatsApp(result.ownerWhatsApp);
      }
      setLatestBooking(result.booking);
      setNotes('');
      await refreshBookings();
      await loadAvailability(selectedDate, selectedSpecialistId);
    } catch {
      setBookingError('Erro de conexão ao registrar reserva.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const handleCancelBooking = async (booking: BookingRecord) => {
    setAccountFeedback(null);
    const res = await cancelClientBooking(booking);
    if (res.ok) {
      await refreshBookings();
      await loadAvailability(selectedDate, selectedSpecialistId);
    } else if (res.error) {
      setAccountFeedback(res.error);
    }
  };

  const navigateToSection = (sectionId: string) => {
    setActiveView('salon');
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 40);
  };

  const selectedService = services.find((s) => s.id === selectedServiceId);
  const filteredServices =
    categoryFilter === 'Todos'
      ? services
      : services.filter((s) => s.category === categoryFilter);
  const confirmedClientCount = bookings.filter((b) => b.status === 'confirmed').length;

  return (
    <div className="min-h-screen bg-[#FCF9FA] text-[#1F181B]">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-[#EADCE1] bg-[#FCF9FA]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-6 py-4 lg:px-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => {
              setActiveView('salon');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-2xl font-semibold tracking-tight text-[#1F181B] whitespace-nowrap shrink-0"
          >
            Yummy Salão
          </button>

          {/* Zone 2: 5 concise single-line navigation links */}
          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#755F67]"
          >
            <button
              type="button"
              onClick={() => navigateToSection('servicos')}
              className="hover:text-[#A63A5B] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Serviços
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('agendar')}
              className="hover:text-[#A63A5B] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Agendar
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('rituais')}
              className="hover:text-[#A63A5B] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Rituais
            </button>
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="hover:text-[#A63A5B] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 tabular-nums"
            >
              Minha Agenda ({bookings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveView(activeView === 'owner' ? 'salon' : 'owner')}
              className={`transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
                activeView === 'owner'
                  ? 'text-[#A63A5B] font-semibold underline'
                  : 'hover:text-[#A63A5B] hover:underline'
              }`}
            >
              Painel do Dono
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#E2CFD6] bg-white px-4 py-2 text-xs font-medium text-[#1F181B] transition-colors hover:bg-[#FDF2F5] whitespace-nowrap shrink-0"
              >
                <User className="h-3.5 w-3.5 text-[#A63A5B]" />
                <span className="max-w-[140px] truncate">{user.name.split(' ')[0]}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="rounded-lg bg-[#A63A5B] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#8C2D4A] whitespace-nowrap shrink-0"
              >
                Entrar
              </button>
            )}
          </div>
        </div>

        {/* Compact mobile sub-nav */}
        <div className="flex md:hidden items-center justify-between gap-4 overflow-x-auto border-t border-[#EADCE1] px-6 py-2.5 text-xs font-medium text-[#755F67]">
          <button type="button" onClick={() => navigateToSection('servicos')} className="whitespace-nowrap shrink-0">
            Serviços
          </button>
          <button type="button" onClick={() => navigateToSection('agendar')} className="whitespace-nowrap shrink-0">
            Agendar
          </button>
          <button type="button" onClick={() => navigateToSection('rituais')} className="whitespace-nowrap shrink-0">
            Rituais
          </button>
          <button type="button" onClick={() => setAccountOpen(true)} className="whitespace-nowrap shrink-0 tabular-nums">
            Agenda ({bookings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView(activeView === 'owner' ? 'salon' : 'owner')}
            className={`whitespace-nowrap shrink-0 ${activeView === 'owner' ? 'text-[#A63A5B] font-semibold' : ''}`}
          >
            Painel do Dono
          </button>
        </div>
      </header>

      {activeView === 'owner' ? (
        <OwnerPanel
          onBackToSalon={() => setActiveView('salon')}
          onDataUpdated={refreshBookings}
          onWhatsAppUpdated={(wa) => setOwnerWhatsApp(wa)}
          pendingImportBooking={pendingImportBooking}
          onImportHandled={() => setPendingImportBooking(null)}
        />
      ) : (
        <>
          {/* 1. Storefront Hero Split */}
          <section className="mx-auto max-w-[1200px] px-6 pt-10 pb-14 lg:px-8 lg:pt-14">
            <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="flex flex-col justify-between py-2 lg:col-span-5">
                <div>
                  <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
                    Jardins · São Paulo
                  </p>
                  <h1 className="mt-4 font-display text-[clamp(2.5rem,4vw,3.75rem)] font-semibold leading-[1.06] tracking-tight text-[#1F181B] [text-wrap:balance]">
                    Beleza botânica, corte preciso e ritual sem pressa.
                  </h1>
                  <p className="mt-5 max-w-md text-base leading-relaxed text-[#755F67]">
                    Unimos visagismo autoral, coloração livre de amônia e terapia capilar em um estúdio desenhado para o silêncio e o cuidado genuíno.
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => navigateToSection('agendar')}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#A63A5B] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8C2D4A] whitespace-nowrap"
                  >
                    <span>Agendar Horário</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountOpen(true)}
                    className="rounded-lg border border-[#E2CFD6] bg-white px-5 py-3 text-sm font-medium text-[#1F181B] transition-colors hover:bg-[#FDF2F5] whitespace-nowrap"
                  >
                    {confirmedClientCount > 0
                      ? `Confirmações (${confirmedClientCount})`
                      : `Minha Agenda (${bookings.length})`}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="relative h-full min-h-[340px] w-full overflow-hidden rounded-2xl border border-[#EADCE1] bg-[#F4E9ED]">
                  <img
                    src={SALON_IMAGES.hero}
                    alt="Interior iluminado do Yummy Salão com espelhos em arco de carvalho e bancadas de travertino"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover lg:h-full"
                  />
                </div>
              </div>
            </div>

            {/* 4-Column Studio Strip */}
            <div className="mt-10 grid grid-cols-1 divide-y divide-[#EADCE1] overflow-hidden rounded-xl border border-[#EADCE1] bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
              <div className="px-5 py-4">
                <p className="text-xs text-[#755F67]">Horário de Atendimento</p>
                <p className="mt-1 text-sm font-medium text-[#1F181B]">Terça a Sábado · 09h às 20h</p>
              </div>
              <div className="px-5 py-4 sm:border-t sm:border-[#EADCE1] lg:border-t-0">
                <p className="text-xs text-[#755F67]">Fórmulas & Colorimetria</p>
                <p className="mt-1 text-sm font-medium text-[#1F181B]">Ativos 100% Botânicos</p>
              </div>
              <div className="px-5 py-4 sm:border-t sm:border-[#EADCE1] lg:border-t-0">
                <p className="text-xs text-[#755F67]">Agendamento do Cliente</p>
                <p className="mt-1 text-sm font-medium text-[#1F181B]">Sem login obrigatório (Google opcional)</p>
              </div>
              <div className="px-5 py-4 sm:border-t sm:border-[#EADCE1] lg:border-t-0">
                <p className="text-xs text-[#755F67]">Atendimento</p>
                <p className="mt-1 text-sm font-medium text-[#1F181B]">Confirmação Direta pelo Salão</p>
              </div>
            </div>
          </section>

          {/* 2. Menu de Serviços & Solicitação de Reserva */}
          <section id="servicos" className="scroll-mt-24 border-t border-[#EADCE1] bg-white py-16">
            <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
                    Menu de Serviços
                  </p>
                  <h2 className="mt-2 font-display text-4xl font-semibold text-[#1F181B]">
                    Rituais & Especialidades
                  </h2>
                </div>

                {/* Interactive Category Filter Buttons */}
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#F7EFF2] p-1">
                  {(['Todos', 'Cabelo', 'Coloração', 'Tratamentos', 'Estética'] as CategoryFilter[]).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                          categoryFilter === cat
                            ? 'bg-white text-[#A63A5B] shadow-sm'
                            : 'text-[#755F67] hover:text-[#1F181B]'
                        }`}
                      >
                        {cat}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
                {/* Services List */}
                <div className="lg:col-span-7">
                  {catalogLoading ? (
                    <div className="border-t border-[#EADCE1] py-12 text-sm text-[#755F67]">
                      Carregando menu de serviços...
                    </div>
                  ) : (
                    <div className="divide-y divide-[#EADCE1] border-y border-[#EADCE1]">
                      {filteredServices.map((srv) => {
                        const isSelected = srv.id === selectedServiceId;
                        return (
                          <div
                            key={srv.id}
                            className={`py-6 transition-colors ${
                              isSelected ? 'rounded-lg bg-[#FDF2F5] px-4 -mx-4' : ''
                            }`}
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="max-w-lg">
                                <div className="flex items-center gap-2 text-xs text-[#755F67]">
                                  <span className="font-medium text-[#9E3556]">{srv.category}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums">{srv.durationMin} min</span>
                                </div>
                                <h3 className="mt-1.5 font-display text-2xl font-semibold text-[#1F181B]">
                                  {srv.name}
                                </h3>
                                <p className="mt-2 text-sm leading-relaxed text-[#755F67]">
                                  {srv.description}
                                </p>
                                <p className="mt-2.5 text-xs text-[#755F67]">
                                  Inclui: {srv.includes.join(' · ')}
                                </p>
                              </div>

                              <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end">
                                <span className="font-mono tabular-nums text-base font-semibold text-[#1F181B]">
                                  {formatBrl(srv.priceBrl)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleSelectService(srv.id)}
                                  className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                                    isSelected
                                      ? 'bg-[#A63A5B] text-white'
                                      : 'border border-[#E2CFD6] bg-white text-[#1F181B] hover:bg-[#FDF2F5]'
                                  }`}
                                >
                                  {isSelected ? 'Selecionado' : 'Selecionar'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Contiguous Reservation Module */}
                <div id="agendar" className="scroll-mt-24 lg:col-span-5">
                  <div className="sticky top-24 rounded-xl border border-[#EADCE1] bg-[#FCF9FA] p-7 shadow-sm">
                    <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
                      Solicitar Horário
                    </p>
                    <h3 className="mt-1 font-display text-3xl font-semibold text-[#1F181B]">
                      Agende sua visita
                    </h3>

                    {latestBooking ? (
                      <div className="mt-6 space-y-5">
                        <div className="rounded-xl border border-[#E8C5D0] bg-white p-5">
                          <div className="flex items-center gap-2 text-[#A63A5B]">
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                            <span className="text-xs font-semibold tracking-wider uppercase">
                              Reserva e Mensagem Enviadas
                            </span>
                          </div>
                          <p className="mt-2 font-mono text-xs text-[#755F67]">
                            Código {latestBooking.id}
                          </p>
                          <h4 className="mt-1 font-display text-2xl font-semibold text-[#1F181B]">
                            {latestBooking.serviceName}
                          </h4>
                          <p className="mt-1 text-sm text-[#755F67]">
                            {formatDateBr(latestBooking.date)} às {latestBooking.time} ·{' '}
                            {latestBooking.specialistName}
                          </p>

                          <div className="mt-4 rounded-lg border border-[#EADCE1] bg-[#FDF2F5] p-3.5 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold text-[#9E3556]">
                              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                              <span>Mensagem disparada para o dono</span>
                            </div>
                            <p className="mt-1.5 whitespace-pre-line leading-relaxed text-[#1F181B]">
                              {buildClientToOwnerMessage(latestBooking)}
                            </p>
                          </div>

                          <p className="mt-3 text-xs leading-relaxed text-[#755F67]">
                            Sua reserva já está no painel do dono aguardando confirmação. Você também pode disparar essa mensagem direto no WhatsApp do salão abaixo.
                          </p>
                        </div>

                        <a
                          href={buildWhatsAppLink(
                            ownerWhatsApp,
                            buildClientToOwnerMessage(latestBooking, true)
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#A63A5B] px-5 py-3 text-xs font-medium text-white transition-colors hover:bg-[#8C2D4A]"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Enviar Mensagem no WhatsApp do Dono</span>
                        </a>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setActiveView('owner')}
                            className="rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
                          >
                            Ver no Painel do Dono
                          </button>
                          <button
                            type="button"
                            onClick={() => setAccountOpen(true)}
                            className="rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#1F181B] hover:bg-[#FDF2F5] whitespace-nowrap"
                          >
                            Abrir Minha Agenda
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setLatestBooking(null)}
                          className="w-full text-center text-xs font-medium text-[#755F67] hover:text-[#A63A5B] hover:underline"
                        >
                          Fazer outro agendamento
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleCreateBooking} className="mt-5 space-y-4">
                        <div>
                          <label
                            htmlFor="booking-service"
                            className="block text-xs font-medium text-[#1F181B]"
                          >
                            Serviço
                          </label>
                          <select
                            id="booking-service"
                            value={selectedServiceId}
                            onChange={(e) => setSelectedServiceId(e.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3.5 py-2.5 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                          >
                            {services.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} — {formatBrl(s.priceBrl)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="booking-specialist"
                            className="block text-xs font-medium text-[#1F181B]"
                          >
                            Especialista
                          </label>
                          <select
                            id="booking-specialist"
                            value={selectedSpecialistId}
                            onChange={(e) => setSelectedSpecialistId(e.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-[#E2CFD6] bg-white px-3.5 py-2.5 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                          >
                            {specialists.map((sp) => (
                              <option key={sp.id} value={sp.id}>
                                {sp.name} · {sp.role}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="booking-date"
                            className="block text-xs font-medium text-[#1F181B]"
                          >
                            Data desejada
                          </label>
                          <div className="relative mt-1.5">
                            <Calendar className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A38F96]" />
                            <input
                              id="booking-date"
                              type="date"
                              required
                              min={getTodayIso()}
                              value={selectedDate}
                              onChange={(e) => setSelectedDate(e.target.value)}
                              className="w-full rounded-lg border border-[#E2CFD6] bg-white py-2.5 pl-10 pr-3.5 text-sm tabular-nums text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-[#1F181B]">
                              Horários disponíveis
                            </span>
                            {slotsLoading && (
                              <span className="text-xs text-[#755F67]">Atualizando...</span>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {slots.map((slot) => (
                              <button
                                key={slot.time}
                                type="button"
                                disabled={!slot.available}
                                onClick={() => setSelectedTime(slot.time)}
                                className={`rounded-lg border py-2 font-mono text-xs tabular-nums transition-colors ${
                                  !slot.available
                                    ? 'border-[#EADCE1] bg-[#F7EFF2] text-[#BAA8B0] line-through cursor-not-allowed'
                                    : selectedTime === slot.time
                                    ? 'border-[#A63A5B] bg-[#A63A5B] font-medium text-white'
                                    : 'border-[#E2CFD6] bg-white text-[#1F181B] hover:border-[#A63A5B]'
                                }`}
                              >
                                {slot.time}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="client-name"
                              className="block text-xs font-medium text-[#1F181B]"
                            >
                              Seu nome
                            </label>
                            <input
                              id="client-name"
                              type="text"
                              required
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              placeholder="Nome completo"
                              className="mt-1 w-full rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="client-phone"
                              className="block text-xs font-medium text-[#1F181B]"
                            >
                              WhatsApp
                            </label>
                            <input
                              id="client-phone"
                              type="tel"
                              required
                              value={customerPhone}
                              onChange={(e) => setCustomerPhone(e.target.value)}
                              placeholder="(11) 99999-9999"
                              className="mt-1 w-full rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-sm tabular-nums text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="client-notes"
                            className="block text-xs font-medium text-[#1F181B]"
                          >
                            Mensagem para o dono (opcional)
                          </label>
                          <textarea
                            id="client-notes"
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Envie um recado ou preferência de corte/cor para o dono..."
                            className="mt-1 w-full rounded-lg border border-[#E2CFD6] bg-white px-3 py-2 text-sm text-[#1F181B] focus:border-[#A63A5B] focus:outline-none"
                          />
                        </div>

                        {selectedService && (
                          <div className="flex items-center justify-between border-t border-[#EADCE1] pt-3 text-sm">
                            <span className="flex items-center gap-1.5 text-[#755F67]">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{selectedService.durationMin} min estimados</span>
                            </span>
                            <span className="font-mono tabular-nums font-semibold text-[#1F181B]">
                              {formatBrl(selectedService.priceBrl)}
                            </span>
                          </div>
                        )}

                        {bookingError && (
                          <p className="text-xs font-medium text-[#9B2226]" role="alert">
                            {bookingError}
                          </p>
                        )}

                        <button
                          type="submit"
                          disabled={bookingSubmitting}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#A63A5B] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8C2D4A] disabled:opacity-60"
                        >
                          <Send className="h-4 w-4" />
                          <span>
                            {bookingSubmitting ? 'Enviando para o dono...' : 'Solicitar Reserva e Enviar Mensagem'}
                          </span>
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3. Rituais Assinatura */}
          <section id="rituais" className="scroll-mt-24 border-t border-[#EADCE1] bg-[#FCF9FA] py-16">
            <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
                    Ativos Botânicos
                  </p>
                  <h2 className="mt-2 font-display text-4xl font-semibold text-[#1F181B]">
                    Rituais Assinatura do Estúdio
                  </h2>
                </div>
                <p className="max-w-md text-sm text-[#755F67]">
                  Protocolos exclusivos aplicados durante o seu atendimento com extratos vegetais prensados a frio.
                </p>
              </div>

              <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
                {rituals.map((ritual) => (
                  <article
                    key={ritual.id}
                    className="group flex flex-col overflow-hidden rounded-xl border border-[#EADCE1] bg-white transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#F7EFF2]">
                      <img
                        src={SALON_IMAGES[ritual.imageKey]}
                        alt={ritual.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </div>

                    <div className="flex flex-1 flex-col justify-between p-6">
                      <div>
                        <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
                          {ritual.subtitle}
                        </p>
                        <h3 className="mt-1.5 font-display text-2xl font-semibold text-[#1F181B]">
                          {ritual.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-[#755F67]">
                          {ritual.description}
                        </p>
                      </div>

                      <div className="mt-6 border-t border-[#EADCE1] pt-4">
                        <button
                          type="button"
                          onClick={() => handleSelectService(ritual.serviceId)}
                          className="inline-flex items-center gap-2 text-xs font-semibold text-[#A63A5B] hover:underline whitespace-nowrap"
                        >
                          <span>Agendar este ritual</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* 4. Craftsmanship & Especialistas (Dark Rosewood Contrast Band) */}
          <section id="equipe" className="scroll-mt-24 bg-[#24161B] py-16 text-white">
            <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
              <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
                <div className="lg:col-span-5">
                  <div className="h-full min-h-[320px] overflow-hidden rounded-2xl bg-[#332027]">
                    <img
                      src={SALON_IMAGES.ritual}
                      alt="Especialista realizando tratamento capilar botânico no Yummy Salão"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover lg:h-full"
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-between lg:col-span-7">
                  <div>
                    <p className="text-xs font-medium tracking-wider text-[#E5A9B9] uppercase">
                      Nossa Equipe
                    </p>
                    <h2 className="mt-2 font-display text-4xl font-semibold text-white">
                      Especialistas em Saúde e Forma dos Fios
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#DDD0D5]">
                      Cada atendimento começa com escuta atenta e diagnóstico personalizado. Trabalhamos com agenda enxuta para dedicar tempo real a cada cliente.
                    </p>
                  </div>

                  <div className="mt-8 grid grid-cols-1 divide-y divide-[#3D2830] border-y border-[#3D2830] sm:grid-cols-2 sm:divide-y-0 sm:gap-x-8">
                    {specialists.map((sp) => (
                      <div key={sp.id} className="py-5 sm:border-b sm:border-[#3D2830]">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-xl font-semibold text-white">
                            {sp.name}
                          </h3>
                          <span className="font-mono text-xs text-[#C7B3BA] tabular-nums">
                            {sp.experienceYears} anos
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-[#E5A9B9]">{sp.role}</p>
                        <p className="mt-2 text-xs leading-relaxed text-[#DDD0D5]">{sp.bio}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Clean Editorial Footer */}
      <footer className="border-t border-[#EADCE1] bg-white py-10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 text-sm text-[#755F67] md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="font-display text-xl font-semibold text-[#1F181B]">Yummy Salão</p>
            <p className="mt-1 text-xs">
              Alameda Lorena, 1420 · Jardins, São Paulo · Terça a Sábado, 09h às 20h
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <button
              type="button"
              onClick={() => navigateToSection('servicos')}
              className="hover:text-[#A63A5B]"
            >
              Serviços
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('rituais')}
              className="hover:text-[#A63A5B]"
            >
              Rituais
            </button>
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="hover:text-[#A63A5B]"
            >
              Minha Agenda
            </button>
            <button
              type="button"
              onClick={() => setActiveView('owner')}
              className="hover:text-[#A63A5B]"
            >
              Painel do Dono
            </button>
          </div>
        </div>
      </footer>

      {/* Client Access Modal */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      {/* Client Account & Confirmations Drawer */}
      <AccountDrawer
        open={accountOpen}
        onClose={() => {
          setAccountOpen(false);
          setAccountFeedback(null);
        }}
        user={user}
        bookings={bookings}
        onCancelBooking={handleCancelBooking}
        onRequestAuth={() => {
          setAccountOpen(false);
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
        actionFeedback={accountFeedback}
      />
    </div>
  );
}
