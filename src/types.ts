export type ServiceCategory = 'Cabelo' | 'Coloração' | 'Tratamentos' | 'Estética';

export interface SalonService {
  id: string;
  name: string;
  category: ServiceCategory;
  durationMin: number;
  priceBrl: number;
  description: string;
  includes: string[];
}

export interface Specialist {
  id: string;
  name: string;
  role: string;
  specialty: string;
  bio: string;
  experienceYears: number;
}

export interface SignatureRitual {
  id: string;
  serviceId: string;
  title: string;
  subtitle: string;
  imageKey: 'elixir' | 'mask' | 'mist';
  description: string;
}

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  createdAt: string;
}

export interface OwnerSessionInfo {
  authenticated: boolean;
  login?: string;
  isDefaultPassword?: boolean;
  ownerWhatsApp?: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

export interface BookingRecord {
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
  status: BookingStatus;
  confirmationMessage?: string;
  confirmedAt?: string;
  createdAt: string;
}
