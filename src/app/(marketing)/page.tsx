import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, MessageCircle, Users } from 'lucide-react';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { PricingCards } from '@/components/marketing/pricing-cards';
import { CONTACTO, PRECIO_BASICA_CON_BOT, PRECIOS } from '@/lib/planes-publicos';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

const TITULO = 'CitaBot Dental · Agenda y WhatsApp para tu consultorio';

export const metadata: Metadata = {
  title: TITULO,
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    url: '/',
    siteName: SITE_NAME,
    title: TITULO,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: TITULO, description: SITE_DESCRIPTION },
};

const OFERTAS = [
  { nombre: 'Básico', precio: PRECIOS.basica },
  { nombre: 'Básico + complemento Bot de WhatsApp', precio: PRECIO_BASICA_CON_BOT },
  { nombre: 'Pro', precio: PRECIOS.pro },
  { nombre: 'Plus', precio: PRECIOS.plus },
];

// Datos estructurados: producto (SaaS) con sus tarifas y la organización de contacto.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'es-MX',
      description: SITE_DESCRIPTION,
      offers: OFERTAS.map(({ nombre, precio }) => ({
        '@type': 'Offer',
        name: nombre,
        price: precio,
        priceCurrency: 'MXN',
        description: 'Precio mensual en pesos mexicanos, más IVA.',
      })),
    },
    {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      email: CONTACTO.email,
      telephone: CONTACTO.whatsappTexto,
    },
  ],
};

const CTA_PRIMARIO =
  'inline-flex min-h-12 items-center rounded-full bg-primary px-7 font-bold text-primary-foreground transition-colors hover:bg-primary/85';
const CTA_SECUNDARIO =
  'inline-flex min-h-12 items-center rounded-full border-[1.5px] border-primary px-7 font-bold text-primary transition-colors hover:bg-accent';

const MENSAJES = [
  { de: 'paciente', texto: 'Hola, ¿tienen espacio para una limpieza esta semana?' },
  { de: 'bot', texto: '¡Claro! Tengo disponible el jueves a las 10:00 o a las 16:30. ¿Cuál prefieres?' },
  { de: 'paciente', texto: 'El jueves a las 10:00.' },
  { de: 'bot', texto: 'Listo, quedó agendada tu cita. Te enviaré un recordatorio.' },
] as const;

const FUNCIONES = [
  {
    icono: CalendarDays,
    titulo: 'Agenda',
    texto: 'Citas por doctor y consultorio, en una sola vista.',
    clases: 'bg-section-agenda-soft text-section-agenda',
  },
  {
    icono: Users,
    titulo: 'Pacientes',
    texto: 'Expediente e historial de cada paciente al alcance.',
    clases: 'bg-section-pacientes-soft text-section-pacientes',
  },
  {
    icono: MessageCircle,
    titulo: 'Conversaciones',
    texto: 'Un 🤖 bot de WhatsApp atiende y agenda mientras tú trabajas.',
    clases: 'bg-section-conversaciones-soft text-section-conversaciones',
  },
];

export default function LandingPage() {
  return (
    <div className="flex-1 bg-background text-foreground">
      <script
        type="application/ld+json"
        // `<` escapado para que ningún texto cierre el script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }}
      />
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <span className="text-xl font-extrabold">
          CitaBot <span className="text-primary">Dental</span>
        </span>
        <nav className="flex flex-wrap items-center justify-end gap-4 text-[15px] font-semibold">
          <a href="#tarifas" className="text-secondary-foreground hover:text-primary">
            Tarifas
          </a>
          <ThemeToggle compact />
          <Link href="/login" className={`${CTA_SECUNDARIO} min-h-11 px-5`}>
            Iniciar sesión
          </Link>
          <a href="#contacto" className={`${CTA_PRIMARIO} min-h-11 px-5`}>
            Solicitar demo
          </a>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-14 pb-20 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <span className="self-start rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-bold text-accent-foreground">
            Agenda y WhatsApp para tu consultorio
          </span>
          <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
            Tu consultorio agenda solo,{' '}
            <span className="text-primary">incluso fuera de horario.</span>
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            CitaBot Dental junta agenda, pacientes y un bot de WhatsApp que responde y agenda citas
            por ti. Elige el plan que se ajusta al tamaño de tu clínica.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="#tarifas" className={CTA_PRIMARIO}>
              Ver tarifas
            </a>
            <a href="#contacto" className={CTA_SECUNDARIO}>
              Solicitar demo
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-xl">
          <div className="flex items-center gap-2.5 border-b pb-3 font-bold">
            <span className="size-2.5 rounded-full bg-success" aria-hidden />
            Conversación de tu asistente 🤖
          </div>
          {MENSAJES.map((m) => (
            <p
              key={m.texto}
              className={
                m.de === 'bot'
                  ? 'max-w-[80%] self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2.5 text-[15px] text-primary-foreground'
                  : 'max-w-[80%] self-start rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-[15px]'
              }
            >
              {m.texto}
            </p>
          ))}
          <p className="mt-1 flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-[13px] font-bold text-accent-foreground">
            <CalendarDays className="size-4" aria-hidden />
            Aparece en la agenda de tu consultorio
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-6 pb-20 sm:grid-cols-3">
        {FUNCIONES.map(({ icono: Icono, titulo, texto, clases }) => (
          <div key={titulo} className={`flex flex-col gap-2 rounded-2xl p-6 ${clases}`}>
            <Icono className="size-6" aria-hidden />
            <h2 className="text-lg font-extrabold">{titulo}</h2>
            <p className="text-[15px] leading-relaxed">{texto}</p>
          </div>
        ))}
      </section>

      <section id="tarifas" className="border-y bg-sidebar">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-20">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="text-4xl font-extrabold tracking-tight">Tarifas</h2>
            <p className="max-w-xl text-[17px] text-muted-foreground">
              Precios en pesos mexicanos por mes, más IVA. Empieza con la agenda y suma el bot
              cuando lo necesites.
            </p>
          </div>
          <PricingCards />
        </div>
      </section>

      <section id="contacto" className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-col items-center gap-5 rounded-[2rem] bg-primary px-8 py-14 text-center text-primary-foreground">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Prueba CitaBot Dental en tu consultorio
          </h2>
          <p className="max-w-lg text-[17px] leading-relaxed">
            Te mostramos la agenda y el bot funcionando y te ayudamos a elegir el plan.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={CONTACTO.whatsappUrl}
              className="inline-flex min-h-12 items-center rounded-full bg-primary-foreground px-8 font-extrabold text-primary"
            >
              WhatsApp {CONTACTO.whatsappTexto}
            </a>
            <a
              href={`mailto:${CONTACTO.email}`}
              className="inline-flex min-h-12 items-center rounded-full border-[1.5px] border-primary-foreground px-8 font-extrabold"
            >
              {CONTACTO.email}
            </a>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-6 pb-10 text-sm text-muted-foreground">
        <span>© maoli.ws</span>
        <span>Precios en MXN, más IVA.</span>
      </footer>
    </div>
  );
}
