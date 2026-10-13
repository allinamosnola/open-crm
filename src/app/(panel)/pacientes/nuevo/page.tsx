import type { Metadata } from 'next';
import Link from 'next/link';

import { PatientForm } from '@/components/patients/patient-form';

export const metadata: Metadata = { title: 'Nuevo paciente · CitaBot Dental' };

export default function NewPatientPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/pacientes" className="text-sm text-muted-foreground hover:underline">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nuevo paciente</h1>
      </div>
      <PatientForm mode="create" onCancelHref="/pacientes" />
    </div>
  );
}
