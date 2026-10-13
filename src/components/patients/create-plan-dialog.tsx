'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createPlan } from '@/lib/db/plans';
import { planSchema, type PlanInput } from '@/lib/db/schemas';
import type { Treatment } from '@/lib/db/types';
import { formatCurrency } from '@/lib/format';

type ItemDraft = { key: number; treatment_id: string; tooth: string; price: string };

let nextKey = 1;
const emptyItem = (): ItemDraft => ({ key: nextKey++, treatment_id: '', tooth: '', price: '' });

export function CreatePlanDialog({
  patientId,
  dentistId,
  treatments,
}: {
  patientId: string;
  // El plan queda a nombre de quien lo crea (solo dentistas y owners crean planes).
  dentistId: string;
  treatments: Treatment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem()]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  function reset() {
    setTitle('');
    setItems([emptyItem()]);
    setErrors({});
  }

  function updateItem(key: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input: PlanInput = {
      patient_id: patientId,
      dentist_id: dentistId,
      title,
      items: items.map((it) => ({
        treatment_id: it.treatment_id,
        tooth: it.tooth,
        // '' se manda tal cual para que la validación marque el campo.
        price: it.price === '' ? Number.NaN : it.price,
      })),
    };
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await createPlan(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success('Plan de tratamiento creado');
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
          Nuevo plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo plan de tratamiento</DialogTitle>
            <DialogDescription>
              Elige los tratamientos del catálogo. El precio sugerido se puede ajustar.
            </DialogDescription>
          </DialogHeader>

          <FormField id="plan-title" label="Título *" error={errors.title}>
            <Input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="p. ej. Rehabilitación sector superior"
              {...errorProps('plan-title', errors.title)}
            />
          </FormField>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Tratamientos *</legend>
            {items.map((it, index) => {
              const tErr = errors[`items.${index}.treatment_id`];
              const pErr = errors[`items.${index}.price`];
              const toothErr = errors[`items.${index}.tooth`];
              return (
                <div
                  key={it.key}
                  className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_6rem_8rem_auto] sm:items-start"
                >
                  <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                    <Label htmlFor={`item-${it.key}-treatment`}>Tratamiento</Label>
                    <Select
                      value={it.treatment_id}
                      onValueChange={(value) => {
                        const t = treatments.find((x) => x.id === value);
                        updateItem(it.key, {
                          treatment_id: value,
                          price: t ? String(t.default_price) : it.price,
                        });
                      }}
                    >
                      <SelectTrigger
                        id={`item-${it.key}-treatment`}
                        className="w-full"
                        aria-invalid={tErr ? true : undefined}
                      >
                        <SelectValue placeholder="Elegir…" />
                      </SelectTrigger>
                      <SelectContent>
                        {treatments.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} · {formatCurrency(t.default_price)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {tErr && <p className="text-sm text-destructive">Elige un tratamiento</p>}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`item-${it.key}-tooth`}>Diente</Label>
                    <Input
                      id={`item-${it.key}-tooth`}
                      value={it.tooth}
                      onChange={(e) => updateItem(it.key, { tooth: e.target.value })}
                      placeholder="Opcional"
                      aria-invalid={toothErr ? true : undefined}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`item-${it.key}-price`}>Precio (MXN)</Label>
                    <Input
                      id={`item-${it.key}-price`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={it.price}
                      onChange={(e) => updateItem(it.key, { price: e.target.value })}
                      aria-invalid={pErr ? true : undefined}
                    />
                    {pErr && <p className="text-sm text-destructive">Precio inválido</p>}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="self-end"
                    disabled={items.length === 1}
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                    aria-label="Quitar tratamiento"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            {errors.items && <p className="text-sm text-destructive">{errors.items[0]}</p>}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setItems((prev) => [...prev, emptyItem()])}
              >
                <PlusIcon />
                Agregar tratamiento
              </Button>
              <p className="text-sm">
                Total: <span className="font-semibold">{formatCurrency(total)}</span>
              </p>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Crear plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
