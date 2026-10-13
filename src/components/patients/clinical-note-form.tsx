'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createClinicalNote } from '@/lib/db/notes';
import { clinicalNoteSchema } from '@/lib/db/schemas';

export function ClinicalNoteForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { patient_id: patientId, body };
    const parsed = clinicalNoteSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues.filter((i) => i.path[0] === 'body').map((i) => i.message));
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await createClinicalNote(input);
      if (!result.ok) {
        setError(result.fieldErrors?.body);
        toast.error(result.error);
        return;
      }
      toast.success('Nota guardada');
      setBody('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-2">
      <FormField id="note-body" label="Nueva nota clínica" error={error}>
        <Textarea
          id="note-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hallazgos, procedimiento realizado, indicaciones…"
          {...errorProps('note-body', error)}
        />
      </FormField>
      <div>
        <Button type="submit" disabled={pending || readOnly} title={readOnly ? READ_ONLY_HINT : undefined}>
          {pending ? 'Guardando…' : 'Guardar nota'}
        </Button>
      </div>
    </form>
  );
}
