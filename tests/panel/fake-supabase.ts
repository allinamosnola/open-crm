// Cliente de Supabase en memoria para probar las server actions del panel sin
// base de datos. Implementa solo lo que usan src/lib/db/staff.ts y account.ts:
// from(tabla).select/insert/update + eq + maybeSingle, rpc() y auth.
//
// No aplica RLS a propósito: así se prueba que la app elige la fila correcta
// aunque le lleguen varias (p. ej. un usuario con dos membresías).

import type { Entitlements } from '@/lib/db/types';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: FakeError | null };
export type FakeError = { code: string; message: string; hint: string | null; details: string | null };

export const fake = {
  // Usuario de la sesión (null = sin sesión).
  userId: null as string | null,
  clinics: [] as Row[],
  staff: [] as Row[],
  // Resultado de my_entitlements() para la sesión (null = sin membresía activa).
  entitlements: null as Entitlements | null,
  // Error que devolverá la próxima escritura en staff (simula un trigger).
  nextWriteError: null as FakeError | null,
  invited: [] as string[],
  deletedUsers: [] as string[],
  // Correos que ya existen en Auth (inviteUserByEmail -> email_exists).
  authEmails: new Set<string>(),
  reset() {
    this.userId = null;
    this.clinics = [];
    this.staff = [];
    this.entitlements = null;
    this.nextWriteError = null;
    this.invited = [];
    this.deletedUsers = [];
    this.authEmails = new Set();
  },
};

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private filters: [string, unknown][] = [];
  private payload: Row = {};
  private single = false;

  constructor(private table: 'staff' | 'clinics') {}

  select() {
    return this;
  }
  insert(payload: Row) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private rows(): Row[] {
    return (fake[this.table] as Row[]).filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  private withClinic(row: Row): Row {
    if (this.table !== 'staff') return { ...row };
    const clinic = fake.clinics.find((c) => c.id === row.clinic_id) ?? null;
    return { ...row, clinic };
  }

  private exec(): Result {
    if (this.op !== 'select' && this.table === 'staff' && fake.nextWriteError) {
      const error = fake.nextWriteError;
      fake.nextWriteError = null;
      return { data: null, error };
    }
    if (this.op === 'insert') {
      const dup = fake.staff.some((r) => r.id === this.payload.id && r.clinic_id === this.payload.clinic_id);
      if (dup) return { data: null, error: { code: '23505', message: 'staff_pkey', hint: null, details: null } };
      fake.staff.push({ active: true, ...this.payload });
      return { data: null, error: null };
    }
    const matched = this.rows();
    if (this.op === 'update') for (const r of matched) Object.assign(r, this.payload);
    const data = matched.map((r) => this.withClinic(r));
    if (this.single) {
      if (data.length > 1) {
        return { data: null, error: { code: 'PGRST116', message: 'varias filas', hint: null, details: null } };
      }
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}

const auth = {
  async getUser() {
    return { data: { user: fake.userId ? { id: fake.userId } : null }, error: null };
  },
};

// Cliente con la sesión del usuario (createClient de @/lib/supabase/server).
export function createServerFake() {
  return {
    auth,
    from: (table: 'staff' | 'clinics') => new Query(table),
    async rpc(fn: string) {
      if (fn === 'my_entitlements') {
        return { data: fake.entitlements ? [fake.entitlements] : [], error: null };
      }
      throw new Error(`rpc no simulada: ${fn}`);
    },
  };
}

// Cliente con la service role (createAdminClient).
export function createAdminFake() {
  return {
    from: (table: 'staff' | 'clinics') => new Query(table),
    auth: {
      admin: {
        async inviteUserByEmail(email: string) {
          if (fake.authEmails.has(email)) {
            return { data: { user: null }, error: { code: 'email_exists', message: 'existe' } };
          }
          fake.invited.push(email);
          fake.authEmails.add(email);
          return { data: { user: { id: `user-${email}` } }, error: null };
        },
        async deleteUser(id: string) {
          fake.deletedUsers.push(id);
          return { data: null, error: null };
        },
      },
    },
  };
}
