import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry/options';

// Sin Session Replay: el panel muestra datos de pacientes.
Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
