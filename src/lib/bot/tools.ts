// Herramientas del agente. Las reglas duras viven aquí, no en el prompt: si una
// regla falla, la herramienta lanza BotToolError con una explicación para el
// modelo (el Tool Runner la devuelve como tool_result con is_error).
//
// Cada herramienta opera sobre el consultorio y el paciente de la conversación
// (ToolContext); el modelo nunca elige de quién son los datos.

import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import type { AttentionCategory } from '@/lib/db/types';
import { Constants } from '@/types/database';

import type { BotRepository, ClinicInfo, PatientInfo, UpcomingAppointment } from './repository';
import { bookingWindow, findSlots, formatSlotLabel, HORIZON_DAYS, MIN_LEAD_MINUTES } from './slots';
import { MAX_OFFERED_SLOTS, type BotState, type OfferedSlot } from './state';
import { reportError } from '@/lib/observability';

// Con menos de esto no se cancela ni se reagenda por WhatsApp (se escala).
export const CANCEL_MIN_HOURS = 24;

// Error de regla de negocio: el mensaje es para el modelo.
export class BotToolError extends Error {}

export type EscalationNotifier = (params: {
  clinic: ClinicInfo;
  patient: PatientInfo;
  conversationId: string;
  category: AttentionCategory;
  reason: string;
}) => Promise<void>;

export interface ToolContext {
  repo: BotRepository;
  now: Date;
  conversationId: string;
  clinic: ClinicInfo;
  patient: PatientInfo;
  // Se modifica durante el turno y se guarda al soltar el candado.
  state: BotState;
  // Escalamiento hecho en este turno (el agente responde con el texto fijo).
  escalation: { category: AttentionCategory; reason: string } | null;
  notify: EscalationNotifier;
  // Observabilidad (eval y tests): cada llamada a una herramienta.
  onToolCall?: (name: string, input: unknown) => void;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function assertNotEscalated(ctx: ToolContext) {
  if (ctx.escalation) {
    throw new BotToolError(
      'La conversación ya pasó a la recepción en este turno. No hagas nada más; no escribas respuesta.',
    );
  }
}

async function findPatientAppointment(ctx: ToolContext, appointmentId: string): Promise<UpcomingAppointment> {
  const upcoming = await ctx.repo.listUpcomingAppointments(ctx.clinic.id, ctx.patient.id, ctx.now.toISOString());
  const appointment = upcoming.find((a) => a.id === appointmentId);
  if (!appointment) {
    throw new BotToolError(
      'Esa cita no existe, ya pasó, ya está cancelada o no es de este paciente. Usa mis_citas para ver sus citas próximas.',
    );
  }
  return appointment;
}

function assertOutsideCancelWindow(ctx: ToolContext, appointment: UpcomingAppointment, action: string) {
  const hoursLeft = (new Date(appointment.starts_at).getTime() - ctx.now.getTime()) / 3_600_000;
  if (hoursLeft < CANCEL_MIN_HOURS) {
    throw new BotToolError(
      `Faltan menos de ${CANCEL_MIN_HOURS} horas para esa cita: por política no se puede ${action} por WhatsApp. ` +
        'Escala a la recepción con escalar_a_recepcion, categoria "policy".',
    );
  }
}

// Hueco ofrecido en esta conversación y todavía dentro de la ventana de reserva.
function findOfferedSlot(ctx: ToolContext, slotId: string): OfferedSlot {
  const slot = ctx.state.offered_slots.find((s) => s.id === slotId);
  if (!slot) {
    throw new BotToolError(
      'Ese hueco_id no se ofreció en esta conversación. Solo puedes usar huecos que devolvió buscar_horarios; vuelve a buscar.',
    );
  }
  const { earliest } = bookingWindow(ctx.now);
  if (new Date(slot.starts_at) < earliest) {
    removeOfferedSlot(ctx, slot.id);
    throw new BotToolError(
      `Ese horario ya no cumple la anticipación mínima de ${MIN_LEAD_MINUTES / 60} horas. Vuelve a usar buscar_horarios y ofrece otros.`,
    );
  }
  return slot;
}

function removeOfferedSlot(ctx: ToolContext, slotId: string) {
  ctx.state.offered_slots = ctx.state.offered_slots.filter((s) => s.id !== slotId);
}

// Pausa el bot, marca "requiere atención" y avisa por email. Idempotente en el turno.
export async function escalateConversation(
  ctx: ToolContext,
  category: AttentionCategory,
  reason: string,
): Promise<void> {
  if (ctx.escalation) return;
  await ctx.repo.escalate({ conversationId: ctx.conversationId, category, reason });
  ctx.escalation = { category, reason };
  ctx.state.not_understood = 0;
  try {
    await ctx.notify({
      clinic: ctx.clinic,
      patient: ctx.patient,
      conversationId: ctx.conversationId,
      category,
      reason,
    });
  } catch (error) {
    // El aviso en el panel ya quedó; el email es un extra.
    reportError('No se pudo enviar el aviso de escalamiento:', error, { where: 'tools.escalationNotifier' });
  }
}

// ---------------------------------------------------------------------------
// Lógica de cada herramienta (se prueba directo, sin el SDK)
// ---------------------------------------------------------------------------

export const buscarHorariosInput = z.object({
  desde: z
    .string()
    .regex(DATE)
    .optional()
    .describe('Primer día a buscar, AAAA-MM-DD (hora local del consultorio). Si no se da, desde hoy.'),
  hasta: z
    .string()
    .regex(DATE)
    .optional()
    .describe('Último día a buscar, AAAA-MM-DD, inclusive. Si no se da, hasta el límite de 14 días.'),
  parte_del_dia: z
    .enum(['manana', 'tarde', 'noche'])
    .optional()
    .describe('manana: antes de las 12:00; tarde: de 12:00 a 19:00; noche: desde las 19:00.'),
});

export async function buscarHorarios(ctx: ToolContext, input: z.infer<typeof buscarHorariosInput>): Promise<string> {
  assertNotEscalated(ctx);
  if (input.desde && input.hasta && input.hasta < input.desde) {
    throw new BotToolError('"hasta" es anterior a "desde". Corrige las fechas.');
  }
  if (!Object.values(ctx.clinic.business_hours).some((ranges) => ranges?.length)) {
    throw new BotToolError(
      'El consultorio no tiene horario de atención configurado, así que no puedo proponer citas. ' +
        'Escala a la recepción con categoria "other".',
    );
  }
  const dentists = await ctx.repo.listDentists(ctx.clinic.id);
  if (!dentists.length) {
    throw new BotToolError('El consultorio no tiene dentistas activos. Escala a la recepción con categoria "other".');
  }

  const { earliest, latest } = bookingWindow(ctx.now);
  const [busy, usualDentistId] = await Promise.all([
    ctx.repo.listBusy(ctx.clinic.id, earliest.toISOString(), latest.toISOString()),
    ctx.repo.findUsualDentistId(ctx.clinic.id, ctx.patient.id),
  ]);

  const slots = findSlots({
    now: ctx.now,
    timeZone: ctx.clinic.timezone,
    businessHours: ctx.clinic.business_hours,
    durationMinutes: ctx.clinic.default_appointment_minutes,
    dentists,
    busy,
    preferredDentistId: usualDentistId,
    from: input.desde ?? null,
    to: input.hasta ?? null,
    partOfDay: input.parte_del_dia ?? null,
  });

  if (!slots.length) {
    return json({
      huecos: [],
      nota:
        `No hay horarios disponibles con esos criterios. Solo se agenda con al menos ${MIN_LEAD_MINUTES / 60} horas ` +
        `de anticipación y hasta ${HORIZON_DAYS} días adelante (hasta ${formatSlotLabel(latest, ctx.clinic.timezone)}). ` +
        'Ofrece buscar en otras fechas u otra parte del día.',
    });
  }

  const offered: OfferedSlot[] = slots.map((slot) => ({
    id: `H${++ctx.state.slot_seq}`,
    dentist_id: slot.dentist_id,
    dentist_name: slot.dentist_name,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    label: formatSlotLabel(slot.starts_at, ctx.clinic.timezone),
  }));
  ctx.state.offered_slots = [...ctx.state.offered_slots, ...offered].slice(-MAX_OFFERED_SLOTS);

  return json({
    huecos: offered.map((s) => ({ hueco_id: s.id, horario: s.label, dentista: s.dentist_name })),
    nota: 'Ofrece estas opciones tal cual, numeradas, sin mostrar el hueco_id.',
  });
}

export const agendarCitaInput = z.object({
  hueco_id: z.string().min(1).describe('hueco_id que devolvió buscar_horarios y que eligió el paciente.'),
});

export async function agendarCita(ctx: ToolContext, input: z.infer<typeof agendarCitaInput>): Promise<string> {
  assertNotEscalated(ctx);
  if (ctx.patient.status === 'unidentified') {
    throw new BotToolError(
      'El paciente está por identificar. Antes de agendar pídele su nombre completo y guárdalo con guardar_nombre.',
    );
  }
  const slot = findOfferedSlot(ctx, input.hueco_id);
  const result = await ctx.repo.createAppointment({
    clinicId: ctx.clinic.id,
    patientId: ctx.patient.id,
    dentistId: slot.dentist_id,
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
  });
  removeOfferedSlot(ctx, slot.id);
  if (!result.ok) {
    throw new BotToolError('Ese horario se acaba de ocupar. Vuelve a usar buscar_horarios y ofrece otros.');
  }
  return json({ ok: true, horario: slot.label, dentista: slot.dentist_name });
}

export const misCitasInput = z.object({});

export async function misCitas(ctx: ToolContext): Promise<string> {
  const upcoming = await ctx.repo.listUpcomingAppointments(ctx.clinic.id, ctx.patient.id, ctx.now.toISOString());
  return json({
    citas: upcoming.map((a) => ({
      cita_id: a.id,
      horario: formatSlotLabel(a.starts_at, ctx.clinic.timezone),
      dentista: a.dentist_name,
      estado: a.status === 'confirmed' ? 'confirmada' : 'agendada',
    })),
  });
}

export const cancelarCitaInput = z.object({
  cita_id: z.string().min(1).describe('cita_id de la cita a cancelar (de mis_citas o del contexto).'),
});

export async function cancelarCita(ctx: ToolContext, input: z.infer<typeof cancelarCitaInput>): Promise<string> {
  assertNotEscalated(ctx);
  const appointment = await findPatientAppointment(ctx, input.cita_id);
  assertOutsideCancelWindow(ctx, appointment, 'cancelar');
  const result = await ctx.repo.cancelAppointment({
    clinicId: ctx.clinic.id,
    patientId: ctx.patient.id,
    appointmentId: appointment.id,
  });
  if (!result.ok) throw new BotToolError('No se encontró la cita para cancelarla. Usa mis_citas.');
  return json({ ok: true, cancelada: formatSlotLabel(appointment.starts_at, ctx.clinic.timezone) });
}

export const reagendarCitaInput = z.object({
  cita_id: z.string().min(1).describe('cita_id de la cita que se va a mover.'),
  hueco_id: z.string().min(1).describe('hueco_id del nuevo horario (de buscar_horarios) que eligió el paciente.'),
});

export async function reagendarCita(ctx: ToolContext, input: z.infer<typeof reagendarCitaInput>): Promise<string> {
  assertNotEscalated(ctx);
  const appointment = await findPatientAppointment(ctx, input.cita_id);
  assertOutsideCancelWindow(ctx, appointment, 'reagendar');
  const slot = findOfferedSlot(ctx, input.hueco_id);
  const result = await ctx.repo.rescheduleAppointment({
    clinicId: ctx.clinic.id,
    patientId: ctx.patient.id,
    appointmentId: appointment.id,
    dentistId: slot.dentist_id,
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
  });
  removeOfferedSlot(ctx, slot.id);
  if (!result.ok) {
    throw new BotToolError(
      result.reason === 'overlap'
        ? 'Ese horario se acaba de ocupar; la cita original sigue igual. Vuelve a usar buscar_horarios.'
        : 'No se encontró la cita para moverla. Usa mis_citas.',
    );
  }
  return json({
    ok: true,
    antes: formatSlotLabel(appointment.starts_at, ctx.clinic.timezone),
    ahora: slot.label,
    dentista: slot.dentist_name,
  });
}

export const guardarNombreInput = z.object({
  nombre_completo: z.string().describe('Nombre y apellido del paciente, tal como los escribió.'),
});

// Letras (con acentos), espacios, apóstrofo, guion y punto; al menos nombre y apellido.
const NAME = /^[\p{L}][\p{L}'’.\-]*(\s+[\p{L}][\p{L}'’.\-]*)+$/u;

export async function guardarNombre(ctx: ToolContext, input: z.infer<typeof guardarNombreInput>): Promise<string> {
  assertNotEscalated(ctx);
  const name = input.nombre_completo.trim().replace(/\s+/g, ' ');
  if (ctx.patient.status !== 'unidentified') {
    throw new BotToolError(
      `El paciente ya está registrado${ctx.patient.full_name ? ` como ${ctx.patient.full_name}` : ''}; no hace falta guardar el nombre. ` +
        'Si hay que corregirlo, lo hace la recepción.',
    );
  }
  if (name.length < 3 || name.length > 100 || !NAME.test(name)) {
    throw new BotToolError('Eso no parece un nombre completo. Pide al paciente su nombre y apellido.');
  }
  const saved = await ctx.repo.savePatientName({ clinicId: ctx.clinic.id, patientId: ctx.patient.id, fullName: name });
  if (!saved) throw new BotToolError('El paciente ya estaba identificado; no se cambió el nombre.');
  ctx.patient = { ...ctx.patient, full_name: name, status: 'active' };
  return json({ ok: true, nombre: name });
}

export const escalarInput = z.object({
  categoria: z
    .enum(Constants.public.Enums.attention_category)
    .describe('human_requested, urgent, policy u other (ver instrucciones).'),
  motivo: z.string().min(1).max(500).describe('Una frase para la recepción: qué necesita el paciente.'),
});

export async function escalarARecepcion(ctx: ToolContext, input: z.infer<typeof escalarInput>): Promise<string> {
  await escalateConversation(ctx, input.categoria, input.motivo.trim());
  return 'Listo: la recepción fue avisada y el bot quedó pausado. No escribas nada más; el sistema avisa al paciente.';
}

// ---------------------------------------------------------------------------
// Herramientas para el Tool Runner (orden fijo: forma parte del prefijo cacheado)
// ---------------------------------------------------------------------------

function runner<I>(ctx: ToolContext, name: string, handler: (ctx: ToolContext, input: I) => Promise<string>) {
  return async (input: I): Promise<string> => {
    ctx.onToolCall?.(name, input);
    try {
      return await handler(ctx, input);
    } catch (error) {
      if (error instanceof BotToolError) throw error;
      reportError(`Error en la herramienta ${name}:`, error, { where: 'tools.runner', extra: { tool: name } });
      throw new Error(
        'Error interno al consultar la agenda. Discúlpate con el paciente y escala a la recepción con categoria "other".',
      );
    }
  };
}

export function createAgentTools(ctx: ToolContext) {
  return [
    betaZodTool({
      name: 'buscar_horarios',
      description:
        'Busca hasta 3 horarios libres para una cita nueva o para reagendar, dentro del horario del consultorio, ' +
        'con al menos 2 horas de anticipación y hasta 14 días adelante. Devuelve hueco_id, horario y dentista.',
      inputSchema: buscarHorariosInput,
      run: runner(ctx, 'buscar_horarios', buscarHorarios),
    }),
    betaZodTool({
      name: 'agendar_cita',
      description:
        'Agenda una cita en un hueco que ofreciste con buscar_horarios en esta conversación. ' +
        'El paciente debe estar identificado (si no, usa antes guardar_nombre).',
      inputSchema: agendarCitaInput,
      run: runner(ctx, 'agendar_cita', agendarCita),
    }),
    betaZodTool({
      name: 'mis_citas',
      description: 'Lista las próximas citas del paciente con su cita_id, horario y dentista.',
      inputSchema: misCitasInput,
      run: runner(ctx, 'mis_citas', (c) => misCitas(c)),
    }),
    betaZodTool({
      name: 'cancelar_cita',
      description:
        'Cancela una cita del paciente. Solo con 24 horas o más de anticipación; con menos, se rechaza y hay que escalar.',
      inputSchema: cancelarCitaInput,
      run: runner(ctx, 'cancelar_cita', cancelarCita),
    }),
    betaZodTool({
      name: 'reagendar_cita',
      description:
        'Mueve una cita del paciente a un hueco ofrecido con buscar_horarios. Solo con 24 horas o más de ' +
        'anticipación respecto a la cita original; con menos, se rechaza y hay que escalar.',
      inputSchema: reagendarCitaInput,
      run: runner(ctx, 'reagendar_cita', reagendarCita),
    }),
    betaZodTool({
      name: 'guardar_nombre',
      description:
        'Guarda el nombre completo de un paciente "por identificar". Úsala cuando el paciente te lo dé, antes de agendar.',
      inputSchema: guardarNombreInput,
      run: runner(ctx, 'guardar_nombre', guardarNombre),
    }),
    betaZodTool({
      name: 'escalar_a_recepcion',
      description:
        'Pasa la conversación a la recepción: pausa el bot, la marca como "requiere atención" y avisa por email. ' +
        'Úsala en los casos de las instrucciones (persona, urgencia, política de 24 h, temas fuera de agenda).',
      inputSchema: escalarInput,
      run: runner(ctx, 'escalar_a_recepcion', escalarARecepcion),
    }),
  ];
}
