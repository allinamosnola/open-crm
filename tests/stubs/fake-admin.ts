// Cliente admin de Supabase en memoria para probar el alta de cuentas: solo lo
// que usan src/lib/provisioning y src/lib/stripe/provision (accounts, clinics,
// staff y auth.admin). Los errores se inyectan con `fail`.
type Row = Record<string, unknown>;
type DbError = { code?: string; message: string; details?: string; hint?: string };

export function createFakeAdmin() {
  const tables: Record<string, Row[]> = { accounts: [], clinics: [], staff: [] };
  const authUsers = new Map<string, string>(); // email -> id
  const state = {
    tables,
    authUsers,
    invites: [] as string[],
    // Falla la siguiente operación `${table}.insert` con este error (una vez).
    fail: {} as Record<string, DbError | undefined>,
    inviteError: null as { code?: string; message: string } | null,
    seq: 0,
  };
  const id = (prefix: string) => `${prefix}_${++state.seq}`;

  function from(table: string) {
    const rows = tables[table];
    const filters: [string, unknown][] = [];
    let pendingInsert: Row | null = null;
    let deleting = false;
    const match = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));

    const q = {
      insert(row: Row) {
        pendingInsert = row;
        return q;
      },
      select: () => q,
      limit: () => q,
      delete() {
        deleting = true;
        return q;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        if (deleting) {
          rows.splice(0, rows.length, ...rows.filter((r) => r[column] !== value));
          return Promise.resolve({ error: null });
        }
        return q;
      },
      single() {
        if (!pendingInsert) return Promise.resolve({ data: match()[0] ?? null, error: null });
        const failure = state.fail[`${table}.insert`];
        if (failure) {
          state.fail[`${table}.insert`] = undefined;
          return Promise.resolve({ data: null, error: failure });
        }
        const row: Row = { id: id(table), ...pendingInsert };
        // accounts.stripe_checkout_session_id es único.
        const sessionId = row.stripe_checkout_session_id;
        if (table === 'accounts' && sessionId && rows.some((r) => r.stripe_checkout_session_id === sessionId)) {
          return Promise.resolve({
            data: null,
            error: { code: '23505', message: 'duplicate key', details: 'Key (stripe_checkout_session_id)' },
          });
        }
        if (table === 'clinics' && rows.some((r) => r.slug === row.slug)) {
          return Promise.resolve({
            data: null,
            error: { code: '23505', message: 'duplicate key', details: `Key (slug)=(${row.slug}) already exists.` },
          });
        }
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      // Insert de staff sin .select(): se espera con await.
      then(resolve: (v: { error: DbError | null }) => void) {
        if (pendingInsert) {
          const failure = state.fail[`${table}.insert`];
          if (failure) {
            state.fail[`${table}.insert`] = undefined;
            return resolve({ error: failure });
          }
          rows.push({ ...pendingInsert });
        }
        return resolve({ error: null });
      },
    };
    return q;
  }

  const admin = {
    from,
    auth: {
      admin: {
        async inviteUserByEmail(email: string) {
          if (state.inviteError) return { data: { user: null }, error: state.inviteError };
          if (authUsers.has(email)) {
            return { data: { user: null }, error: { code: 'email_exists', message: 'already registered' } };
          }
          const userId = id('user');
          authUsers.set(email, userId);
          state.invites.push(email);
          return { data: { user: { id: userId } }, error: null };
        },
        async deleteUser(userId: string) {
          for (const [email, uid] of authUsers) if (uid === userId) authUsers.delete(email);
          return { error: null };
        },
      },
    },
  };
  return { admin, state };
}
