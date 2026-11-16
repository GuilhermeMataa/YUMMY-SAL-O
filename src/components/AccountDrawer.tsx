import React from 'react';
import { X, Calendar, LogOut, CheckCircle2, Clock, XCircle, MessageSquare } from 'lucide-react';
import type { BookingRecord, UserProfile } from '../types';
import { formatBrl, formatDateBr, formatDateTimeBr } from '../utils/format';

interface AccountDrawerProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile | null;
  bookings: BookingRecord[];
  onCancelBooking: (booking: BookingRecord) => void;
  onRequestAuth: () => void;
  onLogout: () => void;
  actionFeedback?: string | null;
}

export const AccountDrawer: React.FC<AccountDrawerProps> = ({
  open,
  onClose,
  user,
  bookings,
  onCancelBooking,
  onRequestAuth,
  onLogout,
  actionFeedback,
}) => {
  if (!open) return null;

  const renderBookingStatus = (status: BookingRecord['status']) => {
    if (status === 'confirmed') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#A63A5B]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Confirmada pelo salão
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#755F67]">
          <XCircle className="h-3.5 w-3.5" />
          Cancelada
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#9A5B13]">
        <Clock className="h-3.5 w-3.5" />
        Aguardando confirmação
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#1F181B]/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-drawer-title"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-[#EADCE1] bg-white">
        <div className="flex items-center justify-between border-b border-[#EADCE1] px-6 py-5">
          <div>
            <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
              Minha Agenda
            </p>
            <h2 id="account-drawer-title" className="font-display text-2xl font-semibold text-[#1F181B]">
              Reservas & Confirmações
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel de agenda"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#755F67] hover:bg-[#FDF2F5] hover:text-[#1F181B]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {user ? (
            <div className="flex items-center justify-between rounded-xl border border-[#EADCE1] bg-[#FDF2F5] p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#A63A5B] text-sm font-semibold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#1F181B]">{user.name}</p>
                  <p className="truncate text-xs text-[#755F67]">{user.email || user.phone}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#E2CFD6] bg-white px-3 py-1.5 text-xs font-medium text-[#1F181B] hover:bg-[#F7EFF2]"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sair</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EADCE1] bg-[#FDF2F5] p-4">
              <div>
                <p className="text-sm font-medium text-[#1F181B]">Agendando sem login</p>
                <p className="text-xs text-[#755F67]">
                  Você recebe confirmações neste navegador, ou pode entrar com Google para sincronizar entre aparelhos.
                </p>
              </div>
              <button
                type="button"
                onClick={onRequestAuth}
                className="shrink-0 rounded-lg bg-[#A63A5B] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#8C2D4A] whitespace-nowrap"
              >
                Entrar com Google
              </button>
            </div>
          )}

          {actionFeedback && (
            <div className="rounded-lg border border-[#E8C5D0] bg-[#FDF2F5] px-4 py-3 text-xs text-[#9E3556]">
              {actionFeedback}
            </div>
          )}

          <section>
            <div className="flex items-center gap-2 border-b border-[#EADCE1] pb-2.5">
              <Calendar className="h-4 w-4 text-[#A63A5B]" />
              <h3 className="text-sm font-semibold text-[#1F181B]">
                Minhas Reservas ({bookings.length})
              </h3>
            </div>

            {bookings.length === 0 ? (
              <p className="mt-4 text-sm text-[#755F67]">
                Você ainda não possui reservas registradas neste dispositivo.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-[#EADCE1] overflow-hidden rounded-xl border border-[#EADCE1]">
                {bookings.map((b) => (
                  <div key={b.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs text-[#755F67]">
                          {b.id} · {formatDateBr(b.date)} às {b.time}
                        </p>
                        <h4 className="mt-1 text-sm font-semibold text-[#1F181B]">
                          {b.serviceName}
                        </h4>
                        <p className="text-xs text-[#755F67]">
                          Com {b.specialistName} · {b.durationMin} min
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono tabular-nums text-sm font-semibold text-[#1F181B]">
                          {formatBrl(b.totalBrl)}
                        </p>
                        <div className="mt-1">{renderBookingStatus(b.status)}</div>
                      </div>
                    </div>

                    {b.confirmationMessage && (
                      <div className="mt-3 rounded-lg border border-[#E8C5D0] bg-[#FDF2F5] p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-[#9E3556]">
                          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                          <span>Mensagem do Yummy Salão</span>
                          {b.confirmedAt && (
                            <span className="ml-auto font-mono text-[11px] font-normal text-[#755F67]">
                              {formatDateTimeBr(b.confirmedAt)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 leading-relaxed text-[#1F181B]">
                          {b.confirmationMessage}
                        </p>
                      </div>
                    )}

                    {b.status !== 'cancelled' && user && (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => onCancelBooking(b)}
                          className="rounded-lg border border-[#E2CFD6] px-3 py-1.5 text-xs font-medium text-[#755F67] hover:text-[#9B2226]"
                        >
                          Cancelar Horário
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
