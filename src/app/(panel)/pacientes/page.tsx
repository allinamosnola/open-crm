import { PlusIcon, SearchIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { WriteLinkButton } from '@/components/layout/read-only';
import { UnidentifiedBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPatients } from '@/lib/db/patients';
import { ageFrom, patientName } from '@/lib/format';

export const metadata: Metadata = { title: 'Pacientes · CitaBot Dental' };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q: rawQ } = await searchParams;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim() ?? '';
  const patients = await listPatients(q || undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <WriteLinkButton href="/pacientes/nuevo">
          <PlusIcon />
          Nuevo paciente
        </WriteLinkButton>
      </div>

      {/* Formulario GET: la búsqueda queda en la URL (?q=) y funciona sin JS. */}
      <form role="search" className="flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar por nombre o teléfono
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          placeholder="Buscar por nombre o teléfono"
          defaultValue={q}
        />
        <Button type="submit" variant="outline">
          <SearchIcon />
          Buscar
        </Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="hidden md:table-cell">Correo</TableHead>
              <TableHead className="hidden md:table-cell">Edad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {q ? `No hay pacientes que coincidan con “${q}”.` : 'Aún no hay pacientes.'}
                </TableCell>
              </TableRow>
            ) : (
              patients.map((p) => (
                <TableRow key={p.id} className="relative">
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* El enlace cubre toda la fila (after:absolute). */}
                      <Link
                        href={`/pacientes/${p.id}`}
                        className={
                          p.full_name
                            ? 'after:absolute after:inset-0 hover:underline'
                            : 'text-muted-foreground italic after:absolute after:inset-0 hover:underline'
                        }
                      >
                        {patientName(p)}
                      </Link>
                      {p.status === 'unidentified' && <UnidentifiedBadge />}
                    </div>
                  </TableCell>
                  <TableCell>{p.phone ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">{p.email ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {ageFrom(p.birthdate) ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {patients.length === 200 && (
        <p className="text-sm text-muted-foreground">
          Se muestran los primeros 200 resultados. Usa la búsqueda para acotar.
        </p>
      )}
    </div>
  );
}
