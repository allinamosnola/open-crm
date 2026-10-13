// Textos para la UI sobre errores de entrega de WhatsApp (sin 'server-only':
// los usa también el panel para mostrar el estado de cada mensaje).

// Twilio 63016: mensaje libre fuera de la ventana de 24 h de WhatsApp.
export const OUTSIDE_WINDOW_ERROR_CODE = '63016';
export const OUTSIDE_WINDOW_MESSAGE =
  'Fuera de la ventana de 24 h: el paciente debe escribir primero';

export function describeMessageError(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;
  if (errorCode === OUTSIDE_WINDOW_ERROR_CODE) return OUTSIDE_WINDOW_MESSAGE;
  return `No se pudo entregar el mensaje (error ${errorCode} de Twilio)`;
}
