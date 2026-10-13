# CitaBot Dental (open-crm)

Multi-clinic SaaS for dental practices: a web panel (Next.js + Supabase) for scheduling, patients,
treatment plans, payments and WhatsApp conversations, plus a Claude-powered bot that books, cancels
and reschedules appointments and hands anything it cannot resolve to the front desk.

The full documentation is in Spanish in [README.md](README.md). This page is a short technical summary.

## Stack

- **App:** Next.js (App Router) + React 19 + TypeScript (strict) + Tailwind, deployed on Vercel.
- **Data:** Postgres on Supabase: SQL migrations, Row Level Security keyed by `clinic_id`, Auth
  (invitations, password recovery), pgTAP tests in `supabase/tests`.
- **Billing:** Stripe subscriptions (Checkout, Customer Portal, plan changes with proration) and an
  idempotent webhook that provisions the account, clinic and owner after payment.
- **Messaging:** Twilio WhatsApp (signed webhooks, idempotent by `MessageSid`) and Resend for email alerts.
- **AI:** tool-using agent on the Anthropic API; hard business rules (opening hours, 24 h policy,
  offered slots) are enforced in code, not in the prompt. `npm run eval:bot` runs an eval against the real model.
- **Observability:** Sentry with PII scrubbing.

## Run the tests

```bash
npm ci
npm run lint && npx tsc --noEmit
npm test                      # vitest (server, bot, Stripe, WhatsApp)
npx supabase start && npx supabase test db   # pgTAP (RLS, plan limits)
```

## Roadmap

Work in this repository follows [docs/plans/](docs/plans/) (plans are timestamped and logged in its README).
The current one is `2026-10-12_1748_brecha-puesto-valsnapp.md`: CI, component and E2E tests, retries
for third-party APIs, feature flags, Storage + PDF receipts, and audit logging.

## License

MIT, see [LICENSE](LICENSE).
