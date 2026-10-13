// Datos de supabase/seed.sql que usan los flujos E2E (contraseña de todos: demo1234).
export const PASSWORD = 'demo1234';

export const USERS = {
  ownerA: 'dentista@demo.local', // Consultorio Sonrisas (Pro), owner y dentista
  receptionA: 'recepcion@demo.local',
  ownerB: 'dueno.norte@demo.local', // Dental Norte (Pro)
  ownerBasic: 'dueno.basico@demo.local', // Consultorio Básico (sin bot)
} as const;

export const CLINIC_A_WHATSAPP = '+14155238886';

export const PATIENTS = {
  // Consultorio A
  carlosA: { id: 'b0000000-0000-0000-0000-000000000001', name: 'Carlos Hernández' },
  mariaA: { id: 'b0000000-0000-0000-0000-000000000002', name: 'María González' },
  // Consultorio B
  carlosB: { id: 'b0000000-0000-0000-0000-0000000000b1', name: 'Carlos Hernández (Norte)' },
  anaB: { id: 'b0000000-0000-0000-0000-0000000000b2', name: 'Ana Villarreal' },
} as const;

// Conversación de María (A): la recepción ya la tomó, así que el bot está
// pausado y un mensaje entrante se guarda sin que responda Claude ni se envíe nada.
export const MARIA_CONVERSATION = {
  id: '90000000-0000-0000-0000-000000000002',
  from: '+5215522223333',
};
