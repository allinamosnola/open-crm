import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type FieldErrors = Record<string, string[] | undefined>;

// Convierte los issues de zod en { campo: [mensajes] } (mismo formato que ActionResult).
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// Etiqueta + control + mensaje de error accesible (aria-describedby).
export function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string[];
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error?.length ? (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error[0]}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// Props de accesibilidad para el control de un campo con error.
export function errorProps(id: string, error?: string[]) {
  return error?.length
    ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` }
    : {};
}
