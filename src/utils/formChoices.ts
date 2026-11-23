// The router models and cable brands that can be written on the UPAC form. The browser (record form, bulk fill) and the
// server (the form itself, validation) all read this one list, so adding a model here adds it everywhere.
// The first entry of each list is the standard one, used when a connection has none chosen.

/** Wi-Fi router brand & model. */
export const ROUTER_MODELS: string[] = ['H3C - NX30', 'TP-Link - AX15'];

/** Optical fiber cable brand. */
export const CABLE_BRANDS: string[] = ['BRB', 'Usha Martin', 'OFS', 'LEO', 'Claron', 'Corning', 'Keman Indo', 'BCSL', 'Poly Cable'];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Finds which listed choice a typed or pasted value means. "nx30", "H3C NX30" and "h3c-nx30" all give "H3C - NX30".
 * A part of a name only counts when it is at least 4 letters or digits long and fits exactly one choice
 * (so "ax15" works, "tp" does not). Returns null when nothing, or more than one thing, fits.
 */
export function matchChoice(raw: string | undefined | null, choices: readonly string[]): string | null {
  const key = squash(String(raw ?? ''));
  if (!key) return null;
  const exact = choices.filter((c) => squash(c) === key);
  if (exact.length === 1) return exact[0];
  if (key.length < 4) return null;
  const part = choices.filter((c) => squash(c).includes(key));
  return part.length === 1 ? part[0] : null;
}

/** The router-model filter value that means "no model set". */
export const NO_ROUTER = '__none__';

/**
 * The group a connection falls under in the router filter: the listed model name (a short form like "nx30" counts as the
 * listed one), NO_ROUTER when nothing is set, or the name exactly as written when it is not on the list (so it is never hidden).
 */
export function routerKeyOf(model: string | undefined | null): string {
  const raw = String(model ?? '').trim();
  if (!raw) return NO_ROUTER;
  return matchChoice(raw, ROUTER_MODELS) || raw;
}
