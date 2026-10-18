import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import { DEPOT_COUNT, ROAD_COLUMNS, type WeekSheet } from './weekSheet';

/*
 * Feuille de semaine en PDF, redessinée d'après la feuille papier (A3 pliée en deux) :
 * page 1 en A4, l'intérieur (pages 2-3) en A3 paysage, page 4 (carburant) en A4 paysage.
 * Mesures en millimètres, relevées sur la feuille. Le cadre est imprimé en bordeaux, les données en bleu.
 */

const FRAME = '#7d2a3a';
const LABEL = '#1f1f1f';
const INK = '#1b3a8a';

type Align = 'left' | 'center' | 'right';

/** Les polices standard du PDF ne connaissent que l'alphabet latin de base : on remplace le reste. */
function clean(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[^\u0000-ÿ]/g, '?');
}

/** « 307397 » → « 307 397 », « 1062.5 » → « 1 062,5 ». */
function num(n: number | null): string {
  if (n == null) return '';
  const [int, dec] = String(n).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (dec ? `,${dec}` : '');
}
const tonnes = (kg: number | null) =>
  kg == null ? '' : `${String(Number((kg / 1000).toFixed(2))).replace('.', ',')} t`;

class Sheet {
  constructor(readonly doc: jsPDF) {}

  font(size: number, bold = false, color = LABEL) {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(color);
  }

  /** Texte imprimé du formulaire. */
  label(
    text: string,
    x: number,
    y: number,
    size: number,
    opts: { bold?: boolean; align?: Align; color?: string } = {},
  ) {
    this.font(size, opts.bold, opts.color ?? LABEL);
    this.doc.text(text, x, y, { align: opts.align ?? 'left' });
  }

  /** Plusieurs lignes centrées autour de `y`. */
  lines(texts: string[], x: number, y: number, size: number, bold = false) {
    const step = size * 0.42;
    texts.forEach((t, i) =>
      this.label(t, x, y + (i - (texts.length - 1) / 2) * step + size * 0.13, size, { bold, align: 'center' }),
    );
  }

  underline(text: string, x: number, y: number, align: Align = 'left') {
    const w = this.doc.getTextWidth(text);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    this.stroke(0.3);
    this.doc.line(left, y + 0.8, left + w, y + 0.8);
  }

  /** Texte de travers (en-têtes de colonnes), écrit depuis (x, y). */
  rotated(text: string, x: number, y: number, size: number, angle: number, bold = false) {
    this.font(size, bold);
    this.doc.text(text, x, y, { angle });
  }

  /** Donnée écrite dans une case de largeur `w` : rapetisse, puis coupe, plutôt que de déborder. */
  data(text: string, x: number, y: number, w: number, size: number, align: Align = 'left') {
    const t0 = clean(text.trim());
    if (!t0) return;
    let s = size;
    this.font(s, false, INK);
    while (s > 6 && this.doc.getTextWidth(t0) > w) this.doc.setFontSize((s -= 0.5));
    let t = t0;
    if (this.doc.getTextWidth(t) > w) {
      while (t.length > 1 && this.doc.getTextWidth(`${t}...`) > w) t = t.slice(0, -1);
      t = `${t}...`;
    }
    this.doc.text(t, align === 'center' ? x + w / 2 : align === 'right' ? x + w : x, y, { align });
  }

  stroke(width: number) {
    this.doc.setDrawColor(FRAME);
    this.doc.setLineWidth(width);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.35) {
    this.stroke(width);
    this.doc.line(x1, y1, x2, y2);
  }

  box(x: number, y: number, w: number, h: number, width = 0.5) {
    this.stroke(width);
    this.doc.rect(x, y, w, h, 'S');
  }

  /** Ligne pointillée où l'on écrit (« Agence de rattachement : ........ »). */
  dots(x1: number, x2: number, y: number) {
    this.stroke(0.25);
    this.doc.setLineDashPattern([0.3, 0.7], 0);
    this.doc.line(x1, y, x2, y);
    this.doc.setLineDashPattern([], 0);
  }

  /** Case à cocher vide. */
  check(x: number, y: number) {
    this.stroke(0.25);
    this.doc.rect(x, y - 2.2, 2.4, 2.4, 'S');
  }
}

const DAYS_P1 = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAYS_P23 = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const DAYS_P4 = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];

/** Page 1 : conducteur, véhicule, semaine et départ de chaque jour. */
function page1(s: Sheet, w: WeekSheet) {
  // Conducteur et véhicule.
  s.box(54, 13, 70, 30);
  s.label('ETIQUETTE', 57, 18, 7.5);
  s.label('NOM DU CONDUCTEUR :', 57, 23, 10.5, { bold: true });
  s.underline('NOM DU CONDUCTEUR :', 57, 23);
  s.data(w.driver, 57, 35, 64, 13, 'center');

  s.box(131.5, 13, 70, 30);
  s.label('IMMATRICULATION', 134.5, 18, 7.5);
  s.label('VÉHICULE MOTEUR :', 134.5, 23, 10.5, { bold: true });
  s.underline('VÉHICULE MOTEUR :', 134.5, 23);
  s.data(w.tractor, 134.5, 35, 64, 13, 'center');

  s.box(131.5, 49, 70, 30.5);
  s.label('IMPORTANT', 166.5, 55, 10, { bold: true, align: 'center' });
  s.underline('IMPORTANT', 166.5, 55, 'center');
  s.lines(
    ['Si vous utilisez', 'plusieurs véhicules moteur :', 'Faire une feuille de rapport', 'pour chacun.'],
    166.5,
    67.5,
    9,
  );

  // Agence et semaine.
  s.label('AGENCE DE RATTACHEMENT :', 10.5, 96.5, 10.5);
  s.dots(66, 201.5, 97);
  s.data(w.agency, 90, 95.8, 100, 13);

  s.label('Semaine N°', 10.5, 118, 11.5, { bold: true, color: FRAME });
  s.dots(36, 59, 118.5);
  s.data(String(w.week), 36, 117.3, 23, 13, 'center');
  s.label('du :', 61, 118, 11.5, { bold: true, color: FRAME });
  s.dots(70, 128, 118.5);
  s.data(format(w.monday, 'dd/MM/yy'), 70, 117.3, 58, 13, 'center');
  s.label('au :', 131, 118, 11.5, { bold: true, color: FRAME });
  s.dots(140, 201.5, 118.5);
  s.data(format(w.saturday, 'dd/MM/yy'), 140, 117.3, 61, 13, 'center');

  // Tableau des départs.
  const x = [9.7, 46.3, 74.6, 116.5, 201.5];
  const top = 142;
  const head = 10.5;
  const row = 10;
  const bottom = top + head + row * 7;
  s.box(x[0], top, x[4] - x[0], bottom - top, 0.6);
  x.slice(1, -1).forEach((cx) => s.line(cx, top, cx, bottom));
  for (let i = 0; i < 7; i++) s.line(x[0], top + head + row * i, x[4], top + head + row * i);
  ['Jour', 'Date', 'Lieu de Départ', 'Kilométrage Compteur Départ'].forEach((t, i) =>
    s.label(t, (x[i] + x[i + 1]) / 2, top + 7, 10.5, { align: 'center' }),
  );
  DAYS_P1.forEach((day, i) => {
    const y = top + head + row * i + 6.8;
    s.label(day, x[0] + 2, y, 10.5);
    const d = w.departures[i];
    if (!d) return;
    s.data(format(d.date, 'dd/MM'), x[1] + 1.5, y, x[2] - x[1] - 3, 12, 'center');
    s.data(d.place, x[2] + 1.5, y, x[3] - x[2] - 3, 12);
    s.data(num(d.km), x[3] + 2, y, x[4] - x[3] - 4, 12, 'center');
  });

  // Rappel du bas de page.
  s.label('IMPORTANT', 105, 246, 17, { bold: true, color: FRAME, align: 'center' });
  s.label('ENVOYEZ OU DÉPOSEZ VOS RAPPORTS AU BUREAU', 105, 263, 12, { bold: true, color: FRAME, align: 'center' });
  s.label('CHAQUE FIN DE SEMAINE', 105, 278, 16, { bold: true, color: FRAME, align: 'center' });
}

/** Pages 2-3 (A3 paysage) : chargements et livraisons, jour par jour. */
function page23(s: Sheet, w: WeekSheet) {
  s.label('Semaine du', 12, 11, 13, { bold: true, color: FRAME });
  s.dots(42, 118, 11.5);
  s.data(format(w.monday, 'dd/MM/yy'), 42, 10.3, 76, 13, 'center');
  s.label('au', 122, 11, 13, { bold: true, color: FRAME });
  s.dots(130, 205, 11.5);
  s.data(format(w.saturday, 'dd/MM/yy'), 130, 10.3, 75, 13, 'center');
  s.label('Chauffeur', 290, 11, 13, { bold: true, color: FRAME });
  s.dots(314, 410, 11.5);
  s.data(w.driver, 314, 10.3, 96, 13, 'center');

  // Colonnes : jour, remorque, expéditeur (nom, ville, km), destinataire (nom, ville, km), nature, poids, LV, prix.
  const x = [10, 19, 45, 89, 128, 158, 205, 244, 274, 310, 332, 360, 410];
  const top = 15;
  const sub = 24;
  const head = 44;
  const block = 40;
  const bottom = head + block * 6;

  s.box(x[0], top, x[12] - x[0], bottom - top, 0.6);
  x.slice(1, -1).forEach((cx, i) => {
    // Les colonnes Nom / Ville / Km ne commencent que sous « Expéditeur » et « Destinataire ».
    const grouped = [3, 4, 6, 7].includes(i + 1);
    s.line(cx, grouped ? sub : top, cx, bottom);
  });
  s.line(x[2], sub, x[8], sub);
  s.line(x[0], head, x[12], head, 0.6);
  s.label('EXPÉDITEUR', (x[2] + x[5]) / 2, 21, 10, { bold: true, align: 'center' });
  s.label('DESTINATAIRE', (x[5] + x[8]) / 2, 21, 10, { bold: true, align: 'center' });
  const mid = (sub + head) / 2;
  s.lines(['NOM'], (x[2] + x[3]) / 2, mid, 9, true);
  s.lines(['Ville / Pays'], (x[3] + x[4]) / 2, mid, 9);
  s.lines(['Km Compteur'], (x[4] + x[5]) / 2, mid, 9);
  s.lines(['NOM'], (x[5] + x[6]) / 2, mid, 9, true);
  s.lines(['Ville / Pays'], (x[6] + x[7]) / 2, mid, 9);
  s.lines(['Km Compteur'], (x[7] + x[8]) / 2, mid, 9);
  const full = (top + head) / 2;
  s.lines(['Immat.', 'SREM', 'ou REM'], (x[1] + x[2]) / 2, full, 8.5, true);
  s.lines(['Nature', 'du', 'Chargement'], (x[8] + x[9]) / 2, full, 8.5, true);
  s.lines(['Poids', 'ou', 'Volume'], (x[9] + x[10]) / 2, full, 8.5, true);
  s.lines(['N° Lettre', 'de', 'Voiture'], (x[10] + x[11]) / 2, full, 8.5, true);
  s.lines(['Prix'], (x[11] + x[12]) / 2, full, 9, true);

  DAYS_P23.forEach((day, d) => {
    const t = head + block * d;
    if (d > 0) s.line(x[0], t, x[12], t, 0.6);
    // Jour écrit de bas en haut dans sa colonne étroite.
    s.font(11, true);
    const dw = s.doc.getTextWidth(day);
    s.rotated(day, (x[0] + x[1]) / 2 + 1.4, t + block / 2 + dw / 2, 11, 90, true);
    // Réserves, en bas de la case Prix.
    s.line(x[11], t + block - 10, x[12], t + block - 10, 0.25);
    s.label('Réserves', (x[11] + x[12]) / 2, t + block - 6, 8, { align: 'center' });
    const cx = (x[11] + x[12]) / 2;
    s.label('OUI', cx - 18, t + block - 2, 7.5);
    s.check(cx - 12, t + block - 2);
    s.label('NON', cx + 4, t + block - 2, 7.5);
    s.check(cx + 11, t + block - 2);

    const rows = w.operations[d];
    const lineH = rows.length <= 6 ? 6 : (block - 4) / rows.length;
    const size = Math.min(10, lineH * 1.75);
    rows.forEach((r, i) => {
      const y = t + 2 + lineH * i + lineH * 0.72;
      const cell = (text: string, col: number, align: Align = 'left') =>
        s.data(text, x[col] + 1.5, y, x[col + 1] - x[col] - 3, size, align);
      cell(r.trailer, 1);
      cell(r.shipper, 2);
      cell(r.shipperPlace, 3);
      cell(num(r.shipperKm), 4, 'center');
      cell(r.consignee, 5);
      cell(r.consigneePlace, 6);
      cell(num(r.consigneeKm), 7, 'center');
      cell(r.goods, 8);
      cell(tonnes(r.weightKg), 9, 'center');
      cell(r.number, 10);
    });
  });

  // Bas de page : morceaux écrits l'un après l'autre (le mot en gras au milieu), avec un petit écart.
  let fx = 10;
  for (const [part, bold] of [
    ['ATTENTION : En cas de mouvement de palettes, le signaler', false],
    ['IMPÉRATIVEMENT', true],
    ['sur la Lettre de Voiture.', false],
  ] as const) {
    s.label(part, fx, 291, 10, { bold, color: FRAME });
    fx += s.doc.getTextWidth(part) + 1.6;
  }
  s.label('Mise à jour le 26/03/2008', 410, 291, 7, { align: 'right' });
}

/** Page 4 (A4 paysage) : prises de carburant. */
function page4(s: Sheet, w: WeekSheet) {
  s.stroke(0.6);
  s.doc.roundedRect(97, 9.5, 92, 12, 3, 3, 'S');
  s.label('PRISES DE CARBURANT', 143, 17.8, 16, { bold: true, color: FRAME, align: 'center' });

  s.label('Arrivée à :', 14, 31, 10.5);
  s.dots(34, 110, 31.5);
  s.data(w.endPlace, 36, 30.3, 72, 12);
  s.label('Km Fin de Semaine :', 150, 31, 10.5);
  s.dots(186, 278, 31.5);
  s.data(num(w.endKm), 186, 30.3, 92, 12, 'center');
  s.label('Départ de :', 14, 43, 10.5);
  s.dots(34, 110, 43.5);
  s.data(w.startPlace, 36, 42.3, 72, 12);
  s.label('Km Début de Semaine :', 150, 43, 10.5);
  s.dots(190, 278, 43.5);
  s.data(num(w.startKm), 190, 42.3, 88, 12, 'center');

  s.label('TOTAL Km :', 170, 56, 12, { bold: true, align: 'right', color: FRAME });
  s.box(172, 49.5, 88, 9.5);
  s.data(num(w.totalKm), 172, 56, 88, 12, 'center');

  // Colonnes : jour, date, véhicule, km, plein (oui, non), 5 dépôts, 3 sur route, AdBlue.
  const fixed = [14, 36, 58, 80, 100, 108, 116];
  const litresX = Array.from({ length: DEPOT_COUNT + ROAD_COLUMNS.length + 1 }, (_, i) => 116 + 18 * (i + 1));
  const x = [...fixed, ...litresX];
  const right = x[x.length - 1];
  const roadStart = x[6 + DEPOT_COUNT];
  const adblue = x[x.length - 2];
  const top = 62;
  const head = 98;
  const row = 11.15;
  const bottom = head + row * 7;

  s.box(x[0], top, right - x[0], bottom - top, 0.6);
  // Traits verticaux : en-têtes « Litrages », « Dépôts », « Sur route » au-dessus des colonnes de litres.
  x.slice(1, -1).forEach((cx, i) => {
    const col = i + 1;
    let from = top;
    if (col === 5)
      from = 90; // OUI | NON sous « Plein »
    else if (col > 6 && cx !== roadStart && cx !== adblue) from = 76;
    else if (cx === roadStart) from = 69;
    s.line(cx, from, cx, bottom, cx === x[6] || cx === adblue ? 0.6 : 0.35);
  });
  s.line(x[6], 69, adblue, 69);
  s.line(x[6], 76, adblue, 76);
  s.line(x[4], 90, x[6], 90);
  s.line(x[0], head, right, head, 0.6);
  s.label('LITRAGES', (x[6] + adblue) / 2, 67, 10, { bold: true, align: 'center' });
  s.label('DÉPÔTS', (x[6] + roadStart) / 2, 74, 9.5, { bold: true, align: 'center' });
  s.label('SUR ROUTE', (roadStart + adblue) / 2, 74, 9.5, { bold: true, align: 'center' });
  const full = (top + head) / 2;
  s.lines(['JOUR'], (x[0] + x[1]) / 2, full, 9.5, true);
  s.lines(['DATE'], (x[1] + x[2]) / 2, full, 9.5, true);
  s.lines(['N° Immat.', 'Véhicule', 'utilisé'], (x[2] + x[3]) / 2, full, 8, true);
  s.lines(['Km Compteur', 'au moment', 'de la prise'], (x[3] + x[4]) / 2, full, 7.5, true);
  s.lines(['Plein'], (x[4] + x[6]) / 2, 77, 8.5, true);
  s.lines(['OUI'], (x[4] + x[5]) / 2, 94, 6.5);
  s.lines(['NON'], (x[5] + x[6]) / 2, 94, 6.5);
  // Noms des colonnes de litres, de travers comme sur la feuille.
  const names = [...w.depotLabels, ...ROAD_COLUMNS];
  names.forEach((name, i) => name && s.rotated(clean(name), x[6 + i] + 4, head - 2, 9, 50, true));
  s.rotated('AD Blue', adblue + 4, head - 2, 9, 50, true);

  DAYS_P4.forEach((day, d) => {
    const t = head + row * d;
    if (d > 0) s.line(x[0], t, right, t);
    s.label(day, x[0] + 1.5, t + row / 2 + 1.3, 8, { bold: true });
    const lines = w.fuel[d];
    const lineH = row / Math.max(lines.length, 1);
    const size = Math.min(10, lineH * 2.4);
    lines.forEach((f, i) => {
      const y = t + lineH * i + lineH / 2 + size * 0.13;
      const cell = (text: string, col: number) => s.data(text, x[col] + 1, y, x[col + 1] - x[col] - 2, size, 'center');
      cell(format(f.date, 'dd/MM/yy'), 1);
      cell(f.tractor, 2);
      cell(num(f.km), 3);
      if (f.full != null) cell('X', f.full ? 4 : 5);
      cell(num(f.litres), 6 + f.column);
      cell(num(f.adblue), x.length - 2);
    });
  });

  s.label('TOTAL des Prises :', 182, 191, 13, { bold: true, color: FRAME, align: 'right' });
  s.box(184, 184, 60, 10);
  s.data(num(w.totalLitres || null), 184, 190.8, 60, 12, 'center');

  // Consommation : laissée vide, comme sur papier.
  s.label('Consommation :', 14, 199, 10.5, { bold: true, color: FRAME });
  s.line(46, 198, 92, 198, 0.3);
  s.label('Litrage', 69, 196.5, 8, { align: 'center', color: FRAME });
  s.label('Km parcourus', 69, 201.8, 8, { align: 'center', color: FRAME });
  s.label('x 100 =', 95, 199, 10.5, { color: FRAME });
  s.dots(110, 150, 199.5);
}

/** Les 4 pages de la feuille de semaine, en PDF. */
export function weekSheetPdf(w: WeekSheet): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({ title: `Feuille de semaine ${w.week}` });
  const s = new Sheet(doc);
  page1(s, w);
  doc.addPage('a3', 'landscape');
  page23(s, w);
  doc.addPage('a4', 'landscape');
  page4(s, w);
  return doc.output('blob');
}
