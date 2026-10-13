import 'server-only';

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

import type { DocumentModel } from './model';

// Dibuja un DocumentModel (model.ts) como PDF tamaño carta con la fuente
// Helvetica integrada (cubre acentos y ñ; sin descargar fuentes). Solo
// servidor: @react-pdf/renderer queda fuera del bundle (serverExternalPackages
// por defecto de Next).

const TEAL = '#0f766e';
const MUTED = '#64748b';

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'Helvetica', color: '#0f172a' },
  header: { borderBottomWidth: 2, borderBottomColor: TEAL, paddingBottom: 10, marginBottom: 16 },
  clinic: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: TEAL },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, color: MUTED },
  field: { flexDirection: 'row', marginBottom: 4 },
  label: { width: 130, color: MUTED },
  value: { flex: 1 },
  table: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#cbd5e1' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingVertical: 4 },
  headRow: { backgroundColor: '#f1f5f9' },
  headCell: { fontFamily: 'Helvetica-Bold' },
  totals: { marginTop: 16, alignSelf: 'flex-end', width: 220 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalValue: { fontFamily: 'Helvetica-Bold' },
  notes: { marginTop: 16, color: MUTED },
  footer: { position: 'absolute', bottom: 32, left: 48, right: 48, fontSize: 8, color: MUTED },
});

// Ancho relativo de cada columna (la última, precio, alineada a la derecha).
const COLUMN_FLEX = [3, 1, 1.4, 1.4];

function DocumentPdf({ model }: { model: DocumentModel }) {
  return (
    <Document title={`${model.title} ${model.folio}`} author={model.clinicName} creator="CitaBot Dental" language="es-MX">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinic}>{model.clinicName}</Text>
          <Text style={styles.title}>{model.title}</Text>
          <View style={styles.meta}>
            <Text>Folio: {model.folio}</Text>
            <Text>Emitido: {model.issuedAt}</Text>
          </View>
        </View>

        {model.fields.map((field) => (
          <View key={field.label} style={styles.field}>
            <Text style={styles.label}>{field.label}</Text>
            <Text style={styles.value}>{field.value}</Text>
          </View>
        ))}

        {model.table ? (
          <View style={styles.table}>
            <View style={[styles.row, styles.headRow]}>
              {model.table.columns.map((column, i) => (
                <Text
                  key={column}
                  style={[styles.headCell, { flex: COLUMN_FLEX[i] ?? 1, textAlign: i === model.table!.columns.length - 1 ? 'right' : 'left' }]}
                >
                  {column}
                </Text>
              ))}
            </View>
            {model.table.rows.map((row, r) => (
              <View key={r} style={styles.row} wrap={false}>
                {row.map((cell, i) => (
                  <Text key={i} style={{ flex: COLUMN_FLEX[i] ?? 1, textAlign: i === row.length - 1 ? 'right' : 'left' }}>
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.totals}>
          {model.totals.map((total) => (
            <View key={total.label} style={styles.totalRow}>
              <Text>{total.label}</Text>
              <Text style={styles.totalValue}>{total.value}</Text>
            </View>
          ))}
        </View>

        {model.notes.length ? (
          <View style={styles.notes}>
            {model.notes.map((note, i) => (
              <Text key={i}>{note}</Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {model.footer}
        </Text>
      </Page>
    </Document>
  );
}

export function renderDocumentPdf(model: DocumentModel): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf model={model} />);
}
