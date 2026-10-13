import { ImageResponse } from 'next/og';

import { SITE_NAME } from '@/lib/site';

export const alt = `${SITE_NAME}: agenda y WhatsApp para tu consultorio`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Imagen que se ve al compartir la landing (WhatsApp, redes). Color de marca = logo.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: '#07797b',
          color: '#ffffff',
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, opacity: 0.9 }}>{SITE_NAME}</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 24 }}>
          Tu consultorio agenda solo, incluso fuera de horario.
        </div>
        <div style={{ fontSize: 34, marginTop: 36, opacity: 0.9 }}>
          Agenda, pacientes y bot de WhatsApp para dentistas
        </div>
      </div>
    ),
    size,
  );
}
