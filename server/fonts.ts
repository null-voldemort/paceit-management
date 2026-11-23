/** Fonts used in the generated Word form. Keep in sync with src/utils/fonts.ts (English letters/digits: Times New Roman, Bangla: Kalpurush). */
export const FONT_EN = 'Times New Roman';
export const FONT_BN = 'Kalpurush';

/** The <w:rFonts> element for every value filled into the form (the printed template text keeps its original fonts so the official layout stays on 2 pages): Latin letters/digits use Times New Roman, Bangla (complex script) uses Kalpurush. */
export const RFONTS_XML = `<w:rFonts w:ascii="${FONT_EN}" w:hAnsi="${FONT_EN}" w:eastAsia="${FONT_EN}" w:cs="${FONT_BN}"/>`;
