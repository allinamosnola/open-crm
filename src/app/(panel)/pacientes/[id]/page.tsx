import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  MailIcon,
  PhoneIcon,
  UserRoundSearchIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LocalDateTime } from '@/components/local-date-time';
import { ConversationThread } from '@/components/conversations/conversation-thread';
import { ClinicalNoteForm } from '@/components/patients/clinical-note-form';
import { CreatePaymentDialog } from '@/components/patients/create-payment-dialog';
import { CreatePlanDialog } from '@/components/patients/create-plan-dialog';
import { PatientForm } from '@/components/patients/patient-form';
import { PatientTabs, type PatientTab } from '@/components/patients/patient-tabs';
import {
  AppointmentStatusBadge,
  ItemStatusBadge,
  PlanStatusBadge,
  UnidentifiedBadge,
  WhatsAppBadge,
} from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPatientAppointments } from '@/lib/db/appointments';
import { getConversation, listMessages } from '@/lib/db/conversations';
import { listPatientNotes } from '@/lib/db/notes';
import { getPatient } from '@/lib/db/patients';
import { getPatientBalances, listPatientPayments } from '@/lib/db/payments';
import { listPatientPlans, listTreatments } from '@/lib/db/plans';
import { getCurrentStaff } from '@/lib/db/staff';
import {
  actsAsDentist,
  type AppointmentWithRelations,
  type ClinicalNoteWithAuthor,
  type PatientBalance,
  type PaymentWithReceiver,
  type PlanWithItems,
} from '@/lib/db/types';
import {
  ageFrom,
  APPT_SOURCE_LABEL,
  formatCurrency,
  formatDateOnly,
  PAYMENT_METHOD_LABEL,
  patientName,
} from '@/lib/format';

export const metadata: Metadata = { title: 'Paciente · CitaBot Dental' };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  if (!GUID.test(id)) notFound();
  const { tab } = await searchParams;

  const [patient, staff] = await Promise.all([getPatient(id), getCurrentStaff()]);
  if (!patient || !staff) notFound();
  // El owner cuenta como dentista (notas clínicas y planes).
  const isDentist = actsAsDentist(staff.role);

  const [appointments, plans, payments, balances, notes, treatments, conversation] = await Promise.all([
    listPatientAppointments(id),
    listPatientPlans(id),
    listPatientPayments(id),
    getPatientBalances(id),
    isDentist ? listPatientNotes(id) : Promise.resolve([]),
    isDentist ? listTreatments() : Promise.resolve([]),
    getConversation(id),
  ]);
  const messages = conversation ? await listMessages(conversation.id) : [];
  const unidentified = patient.status === 'unidentified' || !patient.full_name;

  const age = ageFrom(patient.birthdate);
  const totalBalance = balances.reduce((sum, b) => sum + Number(b.balance ?? 0), 0);
  const upcoming = appointments
    .filter((a) => a.status !== 'cancelled' && new Date(a.starts_at) > new Date())
    .at(-1); // vienen ordenadas de la más reciente a la más antigua

  const tabs: PatientTab[] = [
    {
      value: 'datos',
      label: 'Datos',
      content: <PatientForm mode="edit" patient={patient} />,
    },
    {
      value: 'citas',
      label: `Citas (${appointments.length})`,
      content: <AppointmentsTab appointments={appointments} />,
    },
    {
      value: 'planes',
      label: `Planes (${plans.length})`,
      content: (
        <PlansTab
          plans={plans}
          action={
            isDentist ? (
              <CreatePlanDialog patientId={id} dentistId={staff.id} treatments={treatments} />
            ) : null
          }
        />
      ),
    },
    {
      value: 'pagos',
      label: 'Pagos',
      content: (
        <PaymentsTab
          patientId={id}
          plans={plans}
          balances={balances}
          payments={payments}
          totalBalance={totalBalance}
        />
      ),
    },
  ];
  // La recepción no ve la pestaña (y RLS tampoco le devuelve notas).
  if (isDentist) {
    tabs.push({
      value: 'notas',
      label: 'Notas clínicas',
      content: <NotesTab patientId={id} notes={notes} />,
    });
  }
  tabs.push({
    value: 'conversacion',
    label:
      conversation && conversation.unread_count > 0
        ? `Conversación (${conversation.unread_count} sin leer)`
        : 'Conversación',
    content: !staff.clinic.account.bot_enabled ? (
      <p className="py-8 text-center text-muted-foreground">
        Sube de plan para ver los mensajes del paciente aquí.
      </p>
    ) : conversation ? (
      <ConversationThread
        conversation={conversation}
        messages={messages}
        className="h-[min(70vh,44rem)] rounded-lg border"
      />
    ) : (
      <p className="py-8 text-center text-muted-foreground">
        Este paciente aún no ha escrito por WhatsApp.
      </p>
    ),
  });

  const tabValue = Array.isArray(tab) ? tab[0] : tab;
  const defaultTab = tabs.some((t) => t.value === tabValue) ? tabValue! : 'datos';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pacientes" className="text-sm text-muted-foreground hover:underline">
          ← Pacientes
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={unidentified ? 'text-2xl font-semibold italic' : 'text-2xl font-semibold'}>
                {patientName(patient)}
              </h1>
              {unidentified && <UnidentifiedBadge />}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {patient.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <PhoneIcon className="size-3.5" />
                  {patient.phone}
                </span>
              )}
              {patient.email && (
                <span className="inline-flex items-center gap-1.5">
                  <MailIcon className="size-3.5" />
                  {patient.email}
                </span>
              )}
              {patient.birthdate && (
                <span>
                  {formatDateOnly(patient.birthdate)}
                  {age !== null && ` (${age} años)`}
                </span>
              )}
            </div>
            {patient.allergies && (
              <p className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                <AlertTriangleIcon className="size-4" />
                Alergias: {patient.allergies}
              </p>
            )}
          </div>
          <div className="grid gap-1 text-sm sm:text-right">
            <span className="text-muted-foreground">Saldo pendiente</span>
            <span className="text-xl font-semibold">{formatCurrency(Math.max(totalBalance, 0))}</span>
            {totalBalance < 0 && (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">
                Saldo a favor {formatCurrency(-totalBalance)}
              </span>
            )}
            {upcoming && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground sm:justify-end">
                <CalendarDaysIcon className="size-3.5" />
                Próxima cita: <LocalDateTime value={upcoming.starts_at} />
                {upcoming.source === 'whatsapp' && <WhatsAppBadge />}
              </span>
            )}
          </div>
        </div>
      </div>

      {unidentified && (
        <Alert
          role="status"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <UserRoundSearchIcon />
          <AlertTitle>Paciente por identificar</AlertTitle>
          <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
            Escribió por WhatsApp y aún no tiene nombre. Complétalo en la pestaña Datos.
          </AlertDescription>
        </Alert>
      )}

      <PatientTabs tabs={tabs} defaultTab={defaultTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function AppointmentsTab({ appointments }: { appointments: AppointmentWithRelations[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Dentista</TableHead>
            <TableHead className="hidden md:table-cell">Motivo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden md:table-cell">Origen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.length === 0 ? (
            <EmptyRow colSpan={5}>Sin citas registradas.</EmptyRow>
          ) : (
            appointments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <LocalDateTime value={a.starts_at} endValue={a.ends_at} />
                  {a.source === 'whatsapp' && (
                    <span className="mt-1 block md:hidden">
                      <WhatsAppBadge />
                    </span>
                  )}
                </TableCell>
                <TableCell>{a.dentist?.full_name ?? '—'}</TableCell>
                <TableCell className="hidden max-w-xs truncate md:table-cell">
                  {a.reason ?? '—'}
                </TableCell>
                <TableCell>
                  <AppointmentStatusBadge status={a.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {a.source === 'whatsapp' ? <WhatsAppBadge /> : APPT_SOURCE_LABEL[a.source]}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// Mismo cálculo que la vista patient_balances: los items cancelados no suman.
function planTotal(plan: PlanWithItems) {
  return plan.items
    .filter((i) => i.status !== 'cancelled')
    .reduce((sum, i) => sum + Number(i.price), 0);
}

function PlansTab({ plans, action }: { plans: PlanWithItems[]; action: React.ReactNode }) {
  const grandTotal = plans
    .filter((p) => p.status !== 'cancelled')
    .reduce((sum, p) => sum + planTotal(p), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Total de planes vigentes:{' '}
          <span className="font-semibold text-foreground">{formatCurrency(grandTotal)}</span>
        </p>
        {action}
      </div>
      {plans.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">Sin planes de tratamiento.</p>
      )}
      {plans.map((plan) => (
        <Card key={plan.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {plan.title}
              <PlanStatusBadge status={plan.status} />
            </CardTitle>
            <CardDescription>
              {plan.dentist?.full_name ?? '—'} · creado <LocalDateTime value={plan.created_at} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tratamiento</TableHead>
                  <TableHead>Diente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.treatment?.name ?? '—'}</TableCell>
                    <TableCell>{item.tooth ?? '—'}</TableCell>
                    <TableCell>
                      <ItemStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell
                      className={
                        item.status === 'cancelled'
                          ? 'text-right text-muted-foreground line-through'
                          : 'text-right'
                      }
                    >
                      {formatCurrency(item.price)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(planTotal(plan))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PaymentsTab({
  patientId,
  plans,
  balances,
  payments,
  totalBalance,
}: {
  patientId: string;
  plans: PlanWithItems[];
  balances: PatientBalance[];
  payments: PaymentWithReceiver[];
  totalBalance: number;
}) {
  const planTitle = new Map(plans.map((p) => [p.id, p.title]));
  const balanceByPlan = new Map(balances.map((b) => [b.plan_id, Number(b.balance ?? 0)]));
  const planOptions = plans
    .filter((p) => p.status !== 'cancelled')
    .map((p) => ({ id: p.id, title: p.title, balance: balanceByPlan.get(p.id) ?? 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Saldos</h2>
        <CreatePaymentDialog patientId={patientId} plans={planOptions} />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.length === 0 ? (
              <EmptyRow colSpan={4}>Sin planes ni pagos.</EmptyRow>
            ) : (
              balances.map((b) => (
                <TableRow key={b.plan_id ?? 'sin-plan'}>
                  <TableCell>
                    {b.plan_id ? (planTitle.get(b.plan_id) ?? 'Plan') : 'Pagos sin plan'}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(b.total)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(b.paid)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(b.balance)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {balances.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>
                  {totalBalance < 0 ? 'Saldo a favor del paciente' : 'Saldo pendiente'}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(Math.abs(totalBalance))}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <h2 className="text-base font-semibold">Pagos</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="hidden md:table-cell">Plan</TableHead>
              <TableHead className="hidden lg:table-cell">Recibió</TableHead>
              <TableHead className="hidden lg:table-cell">Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <EmptyRow colSpan={6}>Sin pagos registrados.</EmptyRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <LocalDateTime value={p.paid_at} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(p.amount)}
                  </TableCell>
                  <TableCell>{PAYMENT_METHOD_LABEL[p.method]}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.plan_id ? (planTitle.get(p.plan_id) ?? '—') : 'Sin plan'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {p.receiver?.full_name ?? '—'}
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate lg:table-cell">
                    {p.notes ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function NotesTab({ patientId, notes }: { patientId: string; notes: ClinicalNoteWithAuthor[] }) {
  return (
    <div className="grid max-w-3xl gap-6">
      <ClinicalNoteForm patientId={patientId} />
      <div className="grid gap-3">
        {notes.length === 0 && <p className="text-muted-foreground">Sin notas clínicas.</p>}
        {notes.map((n) => (
          <article key={n.id} className="rounded-lg border p-4">
            <header className="mb-2 text-xs text-muted-foreground">
              <LocalDateTime value={n.created_at} /> · {n.author?.full_name ?? '—'}
            </header>
            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
