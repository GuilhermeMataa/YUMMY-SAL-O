import type { SalonService, SignatureRitual, Specialist } from '../types';

export const SALON_SERVICES: SalonService[] = [
  {
    id: 'srv-corte-visagismo',
    name: 'Corte Visagista & Finalização',
    category: 'Cabelo',
    durationMin: 60,
    priceBrl: 220,
    description:
      'Consultoria de proporções faciais, lavagem relaxante com óleos essenciais e corte a seco ou úmido.',
    includes: ['Diagnóstico capilar', 'Massagem craniana', 'Escova modeladora'],
  },
  {
    id: 'srv-morena-iluminada',
    name: 'Iluminação Botânica & Matização',
    category: 'Coloração',
    durationMin: 150,
    priceBrl: 540,
    description:
      'Mechas orgânicas livres de amônia com proteção lipídica para luminosidade natural sem ressecamento.',
    includes: ['Teste de mecha', 'Proteção de pontes', 'Reconstrução pós-cor'],
  },
  {
    id: 'srv-coloracao-global',
    name: 'Coloração Global Sem Amônia',
    category: 'Coloração',
    durationMin: 90,
    priceBrl: 340,
    description:
      'Cobertura uniforme com pigmentos vegetais e manteiga de karité para brilho espelhado.',
    includes: ['Pigmento botânico', 'Selagem ácida', 'Finalização natural'],
  },
  {
    id: 'srv-terapia-couro',
    name: 'Detox & Terapia do Couro Cabeludo',
    category: 'Tratamentos',
    durationMin: 75,
    priceBrl: 280,
    description:
      'Esfoliação enzimática, ozonioterapia e infusão de ativos calmantes para estimular o folículo.',
    includes: ['Tricoscopia digital', 'Vapor de ozônio', 'Ampola concentrada'],
  },
  {
    id: 'srv-nutricao-seda',
    name: 'Ritual Nutrição de Seda',
    category: 'Tratamentos',
    durationMin: 60,
    priceBrl: 250,
    description:
      'Reposição intensa de aminoácidos e óleos amazônicos para fios porosos ou sensibilizados.',
    includes: ['Banho de lipídios', 'Massagem miofascial', 'Escova ou difusor'],
  },
  {
    id: 'srv-design-laminacao',
    name: 'Design de Sobrancelhas & Brow Lamination',
    category: 'Estética',
    durationMin: 50,
    priceBrl: 185,
    description:
      'Alinhamento estrutural dos fios com nutrição de queratina vegetal e acabamento natural.',
    includes: ['Mapeamento facial', 'Laminação suave', 'Sérum fortalecedor'],
  },
];

export const SPECIALISTS: Specialist[] = [
  {
    id: 'esp-sofia',
    name: 'Sofia Mendes',
    role: 'Diretora Criativa & Visagista',
    specialty: 'Cortes arquitetônicos e textura natural',
    bio: 'Formada em visagismo em Paris e Milão, lidera o olhar estético do Yummy Salão há 9 anos.',
    experienceYears: 11,
  },
  {
    id: 'esp-lucas',
    name: 'Lucas Ferreira',
    role: 'Colorista Master',
    specialty: 'Iluminação botânica e transição suave',
    bio: 'Especialista em colorimetria limpa e formulações livres de amônia para máxima saúde dos fios.',
    experienceYears: 8,
  },
  {
    id: 'esp-camila',
    name: 'Camila Rocha',
    role: 'Terapeuta Capilar',
    specialty: 'Saúde do couro cabeludo e tricologia',
    bio: 'Tricologista clínica dedicada a rituais de recuperação profunda e equilíbrio da microbiota capilar.',
    experienceYears: 7,
  },
  {
    id: 'esp-beatriz',
    name: 'Beatriz Lima',
    role: 'Especialista em Estética Facial',
    specialty: 'Design de sobrancelhas e revitalização',
    bio: 'Focada em simetria natural e protocolos minimalistas de cuidados com o olhar.',
    experienceYears: 6,
  },
];

export const SIGNATURE_RITUALS: SignatureRitual[] = [
  {
    id: 'rit-elixir',
    serviceId: 'srv-terapia-couro',
    title: 'Terapia com Elixir Botânico',
    subtitle: 'Tricologia · 75 min',
    imageKey: 'elixir',
    description:
      'Infusão de óleos de pracaxi e alecrim orgânico combinada com vapor de ozônio para revitalizar o couro cabeludo.',
  },
  {
    id: 'rit-mascara',
    serviceId: 'srv-nutricao-seda',
    title: 'Ritual de Nutrição em Camadas',
    subtitle: 'Tratamento · 60 min',
    imageKey: 'mask',
    description:
      'Reposição lipídica profunda com manteiga de cupuaçu, jojoba e rosa mosqueta para brilho imediato.',
  },
  {
    id: 'rit-bruma',
    serviceId: 'srv-corte-visagismo',
    title: 'Visagismo & Bruma de Seda',
    subtitle: 'Corte & Estilo · 60 min',
    imageKey: 'mist',
    description:
      'Corte arquitetônico personalizado finalizado com bruma aromática de jasmim branco e cedro.',
  },
];

export const TIME_SLOTS: string[] = ['09:30', '11:00', '13:30', '15:00', '16:30', '18:00'];
