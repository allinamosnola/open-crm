// Tarifas que se muestran en la landing (MXN al mes, sin IVA). Fuente:
// un plan de negocio no incluido en la copia pública
export const PRECIOS = {
  basica: 699,
  complementoBot: 899,
  pro: 2990,
  plus: 5990,
  plusConsultorioExtra: 999,
} as const;

export const PRECIO_BASICA_CON_BOT = PRECIOS.basica + PRECIOS.complementoBot;

export const CONTACTO = {
  email: 'ventas@maoli.ws',
  whatsappTexto: '+52 56 5513 9819',
  whatsappUrl: 'https://wa.me/525655139819',
} as const;

export function formatoMxn(n: number): string {
  return `$${n.toLocaleString('es-MX')}`;
}
