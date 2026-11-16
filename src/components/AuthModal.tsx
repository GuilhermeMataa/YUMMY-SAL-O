import React, { useEffect, useState } from 'react';
import { X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { loginClientWithGoogle } from '../services/salonApi';
import type { UserProfile } from '../types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  onAuthenticated,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const result = await loginClientWithGoogle();
      if (result.error || !result.user) {
        setErrorMsg(result.error || 'Erro ao entrar com Google.');
        return;
      }
      onAuthenticated(result.user);
      onClose();
    } catch {
      setErrorMsg('Falha de conexão ao autenticar com o Google.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F181B]/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-[#EADCE1] bg-white p-8 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar janela de acesso"
          className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-lg text-[#755F67] transition-colors hover:bg-[#FDF2F5] hover:text-[#1F181B] focus-visible:outline-2 focus-visible:outline-[#A63A5B]"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="text-xs font-medium tracking-wider text-[#9E3556] uppercase">
          Acesso Opcional do Cliente
        </p>
        <h2
          id="auth-modal-title"
          className="mt-1 font-display text-3xl font-semibold text-[#1F181B]"
        >
          Entrar com Google
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#755F67]">
          Você não precisa fazer login para agendar. Se preferir, entre com sua conta Google para acompanhar sua agenda e confirmações em qualquer dispositivo.
        </p>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-[#EADCE1] bg-[#FCF9FA] p-4 text-xs leading-relaxed text-[#755F67]">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#A63A5B]" />
              <span>
                Para apenas agendar um horário, basta preencher seu nome e WhatsApp direto no formulário da página.
              </span>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-[#9B2226]" role="alert">
              {errorMsg}
            </p>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#A63A5B] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#8C2D4A] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[#A63A5B]"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81"
              />
            </svg>
            <span className="whitespace-nowrap">
              {submitting ? 'Conectando Google...' : 'Continuar com Google'}
            </span>
            <ArrowRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-[#E2CFD6] bg-white px-4 py-2.5 text-xs font-medium text-[#755F67] hover:bg-[#FDF2F5] hover:text-[#1F181B]"
          >
            Agendar sem fazer login
          </button>
        </div>
      </div>
    </div>
  );
};
