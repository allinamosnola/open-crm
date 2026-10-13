import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

// Solo la landing es pública; el panel y la API no deben rastrearse.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/agenda', '/pacientes', '/conversaciones', '/configuracion', '/auth/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
