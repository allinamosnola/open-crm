import type { ErrorEvent } from '@sentry/nextjs';

// Configuración común de Sentry (servidor, edge y navegador). Los mensajes de
// WhatsApp y los datos de pacientes son información de salud: solo viajan stack
// traces y contexto técnico (ruta, clinic_id), nunca cuerpos, cookies ni headers.

// Twilio y Postgres incluyen a veces el teléfono o el correo dentro del mensaje.
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const redact = (text: string) => text.replace(EMAIL, '[email]').replace(PHONE, '[tel]');

// Quita de un evento todo lo que pueda contener datos personales.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
  }
  delete event.user;
  if (event.message) event.message = redact(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redact(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = redact(crumb.message);
  }
  return event;
}

export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: scrubEvent,
};
