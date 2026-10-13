'use client';

import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createPayment } from '@/lib/db/payments';
import { paymentSchema, type PaymentInput } from '@/lib/db/schemas';
import { formatCurrency, PAYMENT_METHOD_LABEL } from '@/lib/format';
import { Constants, type Enums } from '@/types/database';

const NO_PLAN = 'none';

export type PlanOption = { id: string; title: string; balance: number };

export function CreatePaymentDialog({
  patientId,
  plans,
}: {
  patientId: string;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Enums<'payment_method'>>('cash');
  const [planId, setPlanId] = useState(NO_PLAN);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  function reset() {
    setAmount('');
    setMethod('cash');
    setPlanId(NO_PLAN);
    setNotes('');
    setErrors({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (amount.trim() === '' || Number.isNaN(Number(amount))) {
      setErrors({ amount: ['Escribe el monto'] });
      return;
    }
    const input: PaymentInput = {
      patient_id: patientId,
      plan_id: planId === NO_PLAN ? null : planId,
      amount,
      method,
      notes,
    };
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await createPayment(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success('Pago registrado');
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}>
          <PlusIcon />
          Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Registrar pago</DialogTitle>
            <DialogDescription>El pago se registra con la fecha y hora actuales.</DialogDescription>
          </DialogHeader>
          <FormField id="pay-amount" label="Monto (MXN) *" error={errors.amount}>
            <Input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              {...errorProps('pay-amount', errors.amount)}
            />
          </FormField>
          <FormField id="pay-method" label="Método *" error={errors.method}>
            <Select value={method} onValueChange={(v) => setMethod(v as Enums<'payment_method'>)}>
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Constants.public.Enums.payment_method.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="pay-plan" label="Plan de tratamiento" error={errors.plan_id}>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="pay-plan" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PLAN}>Sin plan</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title} · saldo {formatCurrency(p.balance)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="pay-notes" label="Notas" error={errors.notes}>
            <Textarea
              id="pay-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Registrar pago'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
