import { fillEdcDocx, sanitizeFilename, normalizeMac } from './docxFiller';
import { docxToPdf, isPdfEngineAvailable, type PdfStage } from './pdfConvert';
import { coerceFormFields, hasFormContent, logToFormFields, formDateOf, type FormFields, type UpacSourceLog } from './upacFields';

export interface RenderedForm {
  /** The finished PDF. */
  buffer: Buffer;
  filename: string;
  /** The MAC address as written on the form (normalised), so the caller can save it back to the record. */
  mac: string;
}

/** Every stage a form goes through on the server, in order, as it really happens. */
export type FormStage = { id: 'fill' } | PdfStage;

export interface RenderOptions {
  /** Aborted when the person closes the progress window or leaves the page. */
  signal?: AbortSignal;
  onStage?: (stage: FormStage) => void;
}

/** Fills the template from form fields and returns it as a PDF (the Word file is only an intermediate step and is never kept). Used by the Form Maker (typed values) and by the download on a saved connection. */
export async function renderUpacForm(data: unknown, dateYmd: string, opts: RenderOptions = {}): Promise<RenderedForm> {
  const fields: FormFields = coerceFormFields(data);
  if (fields.router_mac) fields.router_mac = normalizeMac(fields.router_mac);
  opts.onStage?.({ id: 'fill' });
  await new Promise<void>((r) => setImmediate(r)); // let the 'fill' message leave before the (blocking) template work starts
  const docx = fillEdcDocx(fields, dateYmd);
  const buffer = await docxToPdf(docx, { signal: opts.signal, onStage: opts.onStage });
  const baseName = sanitizeFilename(fields.connection_nms || fields.source_no || fields.name || 'form');
  return { buffer, filename: `${baseName}.pdf`, mac: fields.router_mac || '' };
}

/** Builds the form of a saved connection. Returns null when the record has nothing to identify the form by. */
export async function renderUpacFormForLog(log: UpacSourceLog, now: Date = new Date(), opts: RenderOptions = {}): Promise<RenderedForm | null> {
  const fields = logToFormFields(log);
  if (!hasFormContent(fields)) return null;
  return renderUpacForm(fields, formDateOf(log, now), opts);
}

/** Runs one blank conversion in the background when the server starts, so LibreOffice has built its profile and font list
 *  before the first real form is asked for (the first run is by far the slowest). */
export function warmUpUpacPdf(): void {
  if (!isPdfEngineAvailable()) {
    console.warn('[Pace IT] LibreOffice was not found: UPAC forms cannot be made as PDF until it is installed (see README).');
    return;
  }
  const t0 = Date.now();
  let docx: Buffer;
  try { docx = fillEdcDocx(coerceFormFields({}), new Date().toISOString().slice(0, 10)); } catch (e) { console.error('[Pace IT] PDF warm-up skipped:', e); return; }
  docxToPdf(docx, { record: false })
    .then(() => console.log(`[Pace IT] PDF maker ready (warm-up took ${((Date.now() - t0) / 1000).toFixed(1)} s)`))
    .catch((e) => console.error('[Pace IT] PDF warm-up failed:', e?.message || e));
}
