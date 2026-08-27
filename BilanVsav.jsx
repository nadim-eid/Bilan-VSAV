import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Square, Save, RotateCcw, Check, History, X, Trash2, Flashlight, FlashlightOff, FileText, MessageSquare, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Torch } from '@capawesome/capacitor-torch';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

const ACCENT = '#D6362A';

const storage = {
  async list(prefix = '') {
    return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) };
  },
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};
const AMBER = '#F2A73B';
const EMERALD = '#34D399';

const STEPS = ['TYPE', 'X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER', 'RECAP'];
const PAGE_TITLES = {
  TYPE: 'Type de victime',
  X: 'Trauma & hémorragie',
  A: 'Voies aériennes',
  B: 'Respiration',
  C: 'Circulation',
  D: 'Neurologique',
  E: 'Exposition',
  BRULURE: 'Brûlure',
  FAST: 'FAST — Suspicion AVC',
  SAMPLER: 'SAMPLER — Anamnèse',
};
const SECTION_BADGE = { X: 'X', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', BRULURE: 'Br', FAST: 'F', SAMPLER: 'S' };

// Valeurs normales indicatives par catégorie de victime (ordres de grandeur usuels
// en secourisme — à recaler sur le référentiel SUAP exact de ton service si besoin).
const PATIENT_CATEGORIES = {
  nouveau_ne: {
    label: 'Nouveau-né / Nourrisson',
    ageRange: '0 - 2 ans',
    ranges: { fr: [40, 60], fc: [120, 160], spo2: [95, 100], pa_sys: [60, 90], temperature: [36.5, 37.5], glycemie: [0.4, 1.0] },
  },
  enfant: {
    label: 'Enfant',
    ageRange: '2 - 12 ans',
    ranges: { fr: [20, 30], fc: [80, 120], spo2: [95, 100], pa_sys: [90, 110], temperature: [36.5, 37.5], glycemie: [0.7, 1.1] },
  },
  adulte: {
    label: 'Adulte',
    ageRange: '12 - 65 ans',
    ranges: { fr: [12, 20], fc: [60, 100], spo2: [95, 100], pa_sys: [100, 140], temperature: [36, 37.5], glycemie: [0.7, 1.1] },
  },
  age: {
    label: 'Personne âgée',
    ageRange: '65 ans et +',
    ranges: { fr: [12, 20], fc: [60, 100], spo2: [92, 100], pa_sys: [100, 160], temperature: [36, 37.5], glycemie: [0.7, 1.1] },
  },
};

// Conduites à tenir proposées lorsqu'une valeur sort de la plage normale
const CAT_MESSAGES = {
  spo2: {
    low: { title: 'SpO2 basse', message: "Position d'attente : demi-assise si possible. Mettre sous oxygène (O2), réévaluer la SpO2." },
  },
  fr: {
    low: { title: 'Fréquence respiratoire basse', message: "Position d'attente : allongée, tête en légère extension si pas de trauma. Surveiller étroitement, être prêt à assister la ventilation." },
    high: { title: 'Fréquence respiratoire élevée', message: "Position d'attente : demi-assise. Rechercher une détresse respiratoire, alerter le 15." },
  },
  fc: {
    low: { title: 'Fréquence cardiaque basse', message: "Position d'attente : allongée, au calme. Surveillance rapprochée, alerter le médecin régulateur (15)." },
    high: { title: 'Fréquence cardiaque élevée', message: "Position d'attente : demi-assise, au calme. Surveillance rapprochée, alerter le médecin régulateur (15)." },
  },
  pa_sys: {
    low: { title: 'Tension basse', message: "Position d'attente : allongée, jambes surélevées si pas de contre-indication. Alerter le 15." },
    high: { title: 'Tension élevée', message: "Position d'attente : demi-assise. Surveillance, alerter le 15 si signes associés." },
  },
  temperature: {
    low: { title: 'Hypothermie', message: "Position d'attente : allongée, isolée du sol. Réchauffer (couverture), retirer les vêtements mouillés." },
    high: { title: 'Fièvre', message: "Position d'attente : allongée, au repos. Découvrir la victime, hydrater si consciente, surveiller la température." },
  },
  glycemie: {
    low: { title: 'Hypoglycémie suspectée', message: "Position d'attente : allongée. Resucrage par voie orale si la victime est consciente et peut déglutir." },
    high: { title: 'Hyperglycémie suspectée', message: "Position d'attente : allongée, au repos. Surveillance, alerter le médecin régulateur." },
  },
};

// Conduites à tenir spécifiques selon le type de brûlure
const BURN_CAT_BY_TYPE = {
  thermique: {
    title: 'Brûlure thermique',
    message: "Position d'attente : assise ou allongée, selon confort. Refroidir immédiatement à l'eau tempérée (15-20 °C) pendant 15-20 min si moins de 2h, ne pas percer les phlyctènes, couvrir d'un pansement stérile, alerter le 15.",
  },
  electrique: {
    title: 'Brûlure électrique',
    message: "Position d'attente : allongée, surveillance rapprochée. Ne pas toucher la victime avant coupure du courant, rechercher les points d'entrée et de sortie, surveiller (risque de trouble du rythme cardiaque), alerter le 15 systématiquement.",
  },
  chimique: {
    title: 'Brûlure chimique',
    message: "Position d'attente : assise ou allongée. Retirer les vêtements contaminés, rincer abondamment à l'eau claire pendant au moins 20 min (sauf produit réagissant à l'eau), ne pas neutraliser le produit, alerter le 15.",
  },
  radiologique: {
    title: 'Brûlure radiologique',
    message: "Position d'attente : à distance de la source. Éloigner la victime de la source si possible sans se mettre en danger, alerter le 15 et les services spécialisés, ne pas toucher sans protection adaptée.",
  },
};
const BURN_CAT_DEFAULT = {
  title: 'Brûlure',
  message: "Position d'attente : assise ou allongée, selon confort. Refroidir à l'eau tempérée (15-20 °C) pendant 15-20 min si moins de 2h, ne pas percer les phlyctènes, couvrir d'un pansement stérile, alerter le 15.",
};

// Message immédiat dès que "Brûlure = Oui" est coché, avant même le degré/type
const BURN_INITIAL_CAT = {
  title: 'Brûlure confirmée',
  message: "Position d'attente : écarter la victime de la source. Refroidir immédiatement à l'eau tempérée si moins de 15 min depuis l'accident.",
};

// Conduites à tenir spécifiques selon le degré de la brûlure
const BURN_CAT_BY_DEGREE = {
  '1': {
    title: '1er degré',
    message: "Position d'attente : assise ou allongée, selon confort. Brûlure superficielle : refroidir à l'eau tempérée 15-20 min, pas de pansement nécessaire si peu étendue.",
  },
  '2s': {
    title: '2e degré superficiel',
    message: 'Position d\u2019attente : assise ou allongée, selon confort. Phlyctènes possibles : ne pas les percer, refroidir, couvrir d\u2019un pansement stérile non adhérent.',
  },
  '2p': {
    title: '2e degré profond',
    message: 'Position d\u2019attente : allongée. Risque cicatriciel et infectieux : ne pas percer les phlyctènes, pansement stérile, avis médical recommandé.',
  },
  '3': {
    title: '3e degré',
    message: 'Position d\u2019attente : allongée, isolée du sol. Brûlure grave : ne pas refroidir de façon prolongée (risque d\u2019hypothermie), couvrir avec un linge propre/stérile, alerter le 15 en urgence.',
  },
};

const OUI_NON = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];
const SPO2_MODE = [{ value: 'air', label: 'Sous air' }, { value: 'o2', label: 'Sous O2' }];
const TRC_OPTIONS = [{ value: '<2s', label: '< 2 s' }, { value: '>2s', label: '> 2 s' }];
const AVPU_OPTIONS = [
  { value: 'A', label: 'A' },
  { value: 'V', label: 'V' },
  { value: 'P', label: 'P' },
  { value: 'U', label: 'U' },
];

const EVA_OPTIONS = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: String(i) }));

const BRULURE_DEGRE_OPTIONS = [
  { value: '1', label: '1er degré' },
  { value: '2s', label: '2e superficiel' },
  { value: '2p', label: '2e profond' },
  { value: '3', label: '3e degré' },
];

const BRULURE_TYPE_OPTIONS = [
  { value: 'thermique', label: 'Thermique' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'chimique', label: 'Chimique' },
  { value: 'radiologique', label: 'Radiologique' },
];

// Règle des 9 de Wallace (référence SUAP) — adulte
const BRULURE_ZONES_9 = [
  { value: 'tete_cou', label: 'Tête et cou', pct: 9 },
  { value: 'bras_droit', label: 'Bras droit', pct: 9 },
  { value: 'bras_gauche', label: 'Bras gauche', pct: 9 },
  { value: 'tronc_avant', label: 'Tronc (avant)', pct: 18 },
  { value: 'tronc_arriere', label: 'Tronc (arrière)', pct: 18 },
  { value: 'jambe_droite', label: 'Jambe droite', pct: 18 },
  { value: 'jambe_gauche', label: 'Jambe gauche', pct: 18 },
  { value: 'perinee', label: 'Périnée', pct: 1 },
];
const BRULURE_ZONE_OPTIONS = BRULURE_ZONES_9.map((z) => ({
  value: z.value,
  label: `${z.label} (${z.pct}%)`,
}));

const BRULURE_LOC_OPTIONS = [
  { value: 'visage', label: 'Visage' },
  { value: 'mains', label: 'Mains' },
  { value: 'pieds', label: 'Pieds' },
  { value: 'perinee', label: 'Périnée / organes génitaux' },
  { value: 'thorax', label: 'Thorax' },
  { value: 'dos', label: 'Dos' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'membre_sup', label: 'Membre supérieur' },
  { value: 'membre_inf', label: 'Membre inférieur' },
];

// "Blood box" — les 4 compartiments classiques d'hémorragie interne occulte chez le
// traumatisé (en plus de l'hémorragie extériorisée déjà relevée sur la page X).
const BLOOD_BOX_OPTIONS = [
  { value: 'thorax', label: 'Thorax' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'bassin', label: 'Bassin / Pelvis' },
  { value: 'cuisses', label: 'Cuisses' },
  { value: 'non_detecte', label: 'Non détecté' },
];

const COINCE_ZONE_OPTIONS = [
  { value: 'jambe', label: 'Jambe' },
  { value: 'bras', label: 'Bras' },
  { value: 'bassin', label: 'Bassin' },
  { value: 'thorax', label: 'Thorax' },
  { value: 'pied', label: 'Pied' },
  { value: 'main', label: 'Main' },
  { value: 'tete', label: 'Tête' },
  { value: 'autre', label: 'Autre' },
];

const BREATH_SIGNS = [
  { value: 'battement_ailes_nez', label: 'Battement des ailes du nez' },
  { value: 'balancement_thoraco_abdo', label: 'Balancement thoraco-abdominal' },
  { value: 'sueurs', label: 'Sueurs' },
  { value: 'cyanose', label: 'Cyanose' },
  { value: 'tirage', label: 'Tirage' },
  { value: 'sifflements', label: 'Sifflements / sibilants' },
  { value: 'toux', label: 'Toux' },
  { value: 'difficulte_parler', label: 'Difficulté à parler' },
  { value: 'paleur', label: 'Pâleur' },
  { value: 'aucun', label: 'Pas de signe associé détecté' },
];

const CIRC_SIGNS = [
  { value: 'sueurs', label: 'Sueurs' },
  { value: 'marbrures', label: 'Marbrures' },
  { value: 'paleur', label: 'Pâleur' },
  { value: 'extremites_froides', label: 'Extrémités froides' },
  { value: 'soif', label: 'Soif' },
  { value: 'anxiete', label: 'Anxiété / agitation' },
  { value: 'vertiges', label: 'Vertiges / malaise' },
  { value: 'douleur_thoracique', label: 'Douleur thoracique' },
  { value: 'aucun', label: 'Pas de signe associé détecté' },
];

const NEURO_SIGNS = [
  { value: 'troubles_visuels', label: 'Troubles visuels' },
  { value: 'troubles_sensitifs', label: 'Troubles sensitifs' },
  { value: 'fourmillements', label: 'Fourmillements' },
  { value: 'trouble_equilibre', label: "Trouble de l'équilibre" },
  { value: 'convulsions', label: 'Convulsions' },
  { value: 'aucun', label: 'Pas de signe associé détecté' },
];

const HEMORRAGIE_SITES = [
  { value: 'abdominal', label: 'Abdominal' },
  { value: 'femoral', label: 'Fémoral' },
  { value: 'thoracique', label: 'Thoracique' },
  { value: 'cervical', label: 'Cervical' },
  { value: 'axillaire', label: 'Axillaire' },
  { value: 'pelvien', label: 'Pelvien' },
  { value: 'membre_sup', label: 'Membre supérieur' },
  { value: 'membre_inf', label: 'Membre inférieur' },
];

const ENV_OPTIONS = [
  { value: 'chaud', label: 'Chaud' },
  { value: 'froid', label: 'Froid' },
];

const ALLERGY_OPTIONS = [
  { value: 'alimentaire', label: 'Alimentaire' },
  { value: 'medicamenteuse', label: 'Médicamenteuse' },
  { value: 'insecte', label: "Piqûre d'insecte" },
  { value: 'latex', label: 'Latex' },
  { value: 'autre', label: 'Autre' },
  { value: 'aucune', label: 'Pas d\u2019allergies connues' },
];

const ANTECEDENTS_OPTIONS = [
  { value: 'hospitalisation', label: 'Hospitalisation' },
  { value: 'avc', label: 'AVC' },
  { value: 'infarctus', label: 'Infarctus' },
];

const REPAS_OPTIONS = [
  { value: '+24h', label: '+ 24h' },
  { value: '+12h', label: '+ 12h' },
  { value: 'matin', label: 'Matin' },
  { value: 'midi', label: 'Midi' },
  { value: 'soir', label: 'Soir' },
];

const PQRST_P_OPTIONS = [
  { value: 'effort', label: 'Effort / mouvement' },
  { value: 'repos', label: 'Repos' },
  { value: 'inspiration', label: 'Inspiration profonde' },
  { value: 'palpation', label: 'Palpation' },
  { value: 'position', label: 'Position' },
  { value: 'stress', label: 'Stress / émotion' },
  { value: 'repas', label: 'Repas' },
];

const PQRST_Q_OPTIONS = [
  { value: 'brulure', label: 'Brûlure' },
  { value: 'oppression', label: 'Oppression' },
  { value: 'poignard', label: 'Coup de poignard' },
  { value: 'serrement', label: 'Serrement' },
  { value: 'crampe', label: 'Crampe' },
  { value: 'pesanteur', label: 'Pesanteur' },
  { value: 'decharge', label: 'Décharge électrique' },
];

const PQRST_R_OPTIONS = [
  { value: 'thorax', label: 'Thorax' },
  { value: 'bras_gauche', label: 'Bras gauche' },
  { value: 'bras_droit', label: 'Bras droit' },
  { value: 'machoire', label: 'Mâchoire' },
  { value: 'dos', label: 'Dos' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'epaule', label: 'Épaule' },
  { value: 'cou', label: 'Cou' },
  { value: 'sans_irradiation', label: 'Sans irradiation' },
];

const PQRST_T_OPTIONS = [
  { value: 'brutal', label: 'Début brutal' },
  { value: 'progressif', label: 'Début progressif' },
  { value: 'continue', label: 'Continue' },
  { value: 'intermittente', label: 'Intermittente' },
  { value: 'aggravation', label: 'En aggravation' },
  { value: 'stable', label: 'Stable' },
  { value: 'amelioration', label: 'En amélioration' },
];

const optsToLabels = (opts) => Object.fromEntries(opts.map((o) => [o.value, o.label]));

// Pour les multi-sélections avec une option "aucun/non détecté" : la cocher
// efface les autres choix, et cocher un autre choix la retire automatiquement.
function withExclusiveNone(current, next, noneValue) {
  const justAddedNone = next.includes(noneValue) && !current.includes(noneValue);
  if (justAddedNone) return [noneValue];
  if (next.includes(noneValue) && next.length > 1) return next.filter((x) => x !== noneValue);
  return next;
}

const FIELD_LABELS = {
  commentaire: 'Commentaire',
  trauma: 'Victime traumatisée',
  obstruction: 'Liberté des voies aériennes',
  fr: 'Fréquence respiratoire',
  fr_ample: 'Amplitude ample',
  fr_reguliere: 'Respiration régulière',
  fr_signes: 'Signes associés',
  spo2_air: 'SpO2 (SAT) — sous air',
  spo2_o2: 'SpO2 (SAT) — sous O2',
  o2_bottle_size: 'Taille bouteille O2',
  o2_pressure: 'Pression au manomètre',
  o2_debit: 'Débit O2',
  o2_autonomie: 'Autonomie estimée bouteille O2',
  fc: 'Fréquence cardiaque',
  pa_gauche: 'Pression artérielle bras gauche',
  pa_droite: 'Pression artérielle bras droit',
  pouls_sym: 'Pouls symétrique',
  pouls_frappe: 'Pouls bien frappé',
  trc: 'TRC',
  signes: 'Signes associés',
  blood_box: 'Blood box — hémorragie interne suspectée',
  hemorragie: 'Hémorragie',
  hemorragie_sites: 'Localisation(s) hémorragie',
  garrot_pose: 'Pose garrot',
  garrot_heure: 'Heure de pose du garrot',
  pci: 'PCI',
  pc_repete: 'PC à répétition',
  pc_nombre: 'Nombre de fois',
  etat: 'État de conscience',
  orientation: 'Orientation temps-espace',
  neuro_signes: 'Signes associés',
  pupilles: 'Pupilles sym., taille normale, réactives',
  sens_mains: 'Sensibilité / motricité mains',
  sens_pieds: 'Sensibilité / motricité pieds',
  glycemie: 'Glycémie',
  temperature: 'Température',
  victime_env: 'Victime retrouvée au',
  brulure: 'Brûlure',
  brulure_degre: 'Degré',
  brulure_zones: 'Zones atteintes (règle des 9)',
  brulure_etendue: 'Étendue',
  brulure_loc_choices: 'Zone(s) brûlée(s)',
  brulure_loc: 'Localisation brûlure (détail)',
  brulure_type: 'Type de brûlure',
  lesion: 'Lésion cachée',
  coince: 'Victime coincée / comprimée',
  coince_depuis: 'Depuis',
  coince_zone_choices: 'Membre / zone coincé(e)',
  coince_zone: 'Membre / zone (détail)',
  face: 'Face',
  arm: 'Arm (bras)',
  speech: 'Speech (parole)',
  temps: "Heure d'apparition",
  sampler_s: 'S — Signes et symptômes',
  sampler_a_choices: "A — Type d'allergie",
  sampler_a: 'A — Allergies (détail)',
  sampler_m: 'M — Médicaments',
  sampler_p_choices: 'P — Antécédents',
  sampler_p: 'P — Passé médical (détail)',
  sampler_l_choice: 'L — Moment du dernier repas',
  sampler_l: 'L — Dernier repas (détail)',
  sampler_e: 'E — Événement',
  sampler_r: 'R — Risques',
};

const PAGE_FIELDS = {
  TYPE: ['commentaire'],
  X: ['trauma', 'hemorragie', 'hemorragie_sites', 'garrot_pose', 'garrot_heure'],
  A: ['obstruction'],
  B: ['fr', 'fr_ample', 'fr_reguliere', 'fr_signes', 'spo2_air', 'spo2_o2', 'o2_bottle_size', 'o2_pressure', 'o2_debit', 'o2_autonomie'],
  C: ['fc', 'pa_gauche', 'pa_droite', 'pouls_sym', 'pouls_frappe', 'trc', 'signes', 'blood_box'],
  D: ['pci', 'pc_repete', 'pc_nombre', 'etat', 'orientation', 'neuro_signes', 'pupilles', 'sens_mains', 'sens_pieds', 'glycemie'],
  E: ['temperature', 'victime_env', 'lesion', 'coince', 'coince_depuis', 'coince_zone_choices', 'coince_zone'],
  BRULURE: ['brulure', 'brulure_degre', 'brulure_type', 'brulure_zones', 'brulure_etendue', 'brulure_loc_choices', 'brulure_loc'],
  FAST: ['face', 'arm', 'speech', 'temps'],
  SAMPLER: [
    'sampler_s',
    'sampler_a_choices',
    'sampler_a',
    'sampler_m',
    'sampler_p_choices',
    'sampler_p',
    'sampler_l_choice',
    'sampler_l',
    'sampler_e',
    'sampler_r',
  ],
};

const UNITS = {
  fr: '/min',
  fc: '/min',
  spo2_air: '%',
  spo2_o2: '%',
  o2_pressure: 'bars',
  o2_debit: 'L/min',
  o2_autonomie: 'min',
  glycemie: 'g/L',
  temperature: '°C',
  pa_gauche: 'mmHg',
  pa_droite: 'mmHg',
  brulure_etendue: '% SC',
};

// Détecte automatiquement l'unité de la glycémie selon le format saisi :
// une décimale (0.85, 1,15…) → g/L ; un nombre entier (85, 110…) → mg/dL.
function detectGlycemieUnit(rawValue) {
  if (!rawValue) return 'g/L';
  return /[.,]/.test(String(rawValue)) ? 'g/L' : 'mg/dL';
}

// Convertit une valeur de glycémie saisie vers l'équivalent en g/L, quelle que
// soit l'unité détectée — utilisé pour comparer aux plages de référence.
function glycemieToGL(rawValue) {
  const num = parseFloat(String(rawValue).replace(',', '.'));
  if (isNaN(num)) return NaN;
  return detectGlycemieUnit(rawValue) === 'mg/dL' ? num / 100 : num;
}

const O2_BOTTLE_OPTIONS = [
  { value: '5', label: '5 L' },
  { value: '15', label: '15 L' },
];

// Seuil minimal de pression sous lequel la bouteille ne doit plus être utilisée
function o2BottleThreshold(size) {
  if (size === '5') return 50;
  if (size === '15') return 30;
  return null;
}

// Autonomie (min) = (Volume bouteille x (Pression lue - seuil minimal)) / Débit
function computeO2Autonomy(size, pressure, debit) {
  const vol = parseFloat(size);
  const pres = parseFloat(String(pressure).replace(',', '.'));
  const deb = parseFloat(String(debit).replace(',', '.'));
  const threshold = o2BottleThreshold(size);
  if (isNaN(vol) || isNaN(pres) || isNaN(deb) || deb <= 0 || threshold === null) return null;
  const usablePressure = Math.max(0, pres - threshold);
  return (vol * usablePressure) / deb;
}

const VALUE_LABELS = {
  obstruction: optsToLabels(OUI_NON),
  trauma: optsToLabels(OUI_NON),
  brulure: optsToLabels(OUI_NON),
  brulure_degre: optsToLabels(BRULURE_DEGRE_OPTIONS),
  brulure_type: optsToLabels(BRULURE_TYPE_OPTIONS),
  brulure_zones: optsToLabels(BRULURE_ZONE_OPTIONS),
  sampler_a_choices: optsToLabels(ALLERGY_OPTIONS),
  sampler_p_choices: optsToLabels(ANTECEDENTS_OPTIONS),
  sampler_l_choice: optsToLabels(REPAS_OPTIONS),
  fr_signes: optsToLabels(BREATH_SIGNS),
  pouls_sym: optsToLabels(OUI_NON),
  pouls_frappe: optsToLabels(OUI_NON),
  trc: optsToLabels(TRC_OPTIONS),
  signes: optsToLabels(CIRC_SIGNS),
  blood_box: optsToLabels(BLOOD_BOX_OPTIONS),
  brulure_loc_choices: optsToLabels(BRULURE_LOC_OPTIONS),
  hemorragie: optsToLabels(OUI_NON),
  garrot_pose: optsToLabels(OUI_NON),
  fr_ample: optsToLabels(OUI_NON),
  fr_reguliere: optsToLabels(OUI_NON),
  o2_bottle_size: optsToLabels(O2_BOTTLE_OPTIONS),
  hemorragie_sites: optsToLabels(HEMORRAGIE_SITES),
  pci: optsToLabels(OUI_NON),
  pc_repete: optsToLabels(OUI_NON),
  etat: {
    A: 'A — Alerte',
    V: 'V — Réagit à la voix',
    P: 'P — Réagit à la douleur',
    U: 'U — Inconscient',
  },
  orientation: optsToLabels(OUI_NON),
  neuro_signes: optsToLabels(NEURO_SIGNS),
  pupilles: optsToLabels(OUI_NON),
  sens_mains: optsToLabels(OUI_NON),
  sens_pieds: optsToLabels(OUI_NON),
  victime_env: optsToLabels(ENV_OPTIONS),
  lesion: optsToLabels(OUI_NON),
  coince: optsToLabels(OUI_NON),
  coince_zone_choices: optsToLabels(COINCE_ZONE_OPTIONS),
  face: optsToLabels(OUI_NON),
  arm: optsToLabels(OUI_NON),
  speech: optsToLabels(OUI_NON),
};

// Ces trois champs "signes associés" affichent toujours une ligne dans le récap,
// même vides — l'absence de signe est une information en soi.
const SIGNES_FIELDS_ALWAYS_SHOWN = ['fr_signes', 'signes', 'neuro_signes'];

function formatValue(field, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return SIGNES_FIELDS_ALWAYS_SHOWN.includes(field) ? 'Pas de signes associés' : null;
    }
    return value.map((v) => (VALUE_LABELS[field] && VALUE_LABELS[field][v]) || v).join(', ');
  }
  if (value === '' || value === undefined || value === null) return null;
  const label = VALUE_LABELS[field] && VALUE_LABELS[field][value];
  if (label) return label;
  if (field === 'glycemie') return `${value} ${detectGlycemieUnit(value)}`;
  const unit = UNITS[field];
  return unit ? `${value} ${unit}` : value;
}

const initialForm = () => ({
  TYPE: { categorie: '', commentaire: '' },
  X: {
    trauma: '',
    hemorragie: '',
    hemorragie_sites: [],
    garrot_pose: '',
    garrot_heure: '',
  },
  A: { obstruction: '' },
  B: {
    fr: '',
    fr_ample: '',
    fr_reguliere: '',
    fr_signes: [],
    spo2_air: '',
    o2_active: '',
    spo2_o2: '',
    o2_bottle_size: '',
    o2_pressure: '200',
    o2_debit: '15',
  },
  C: {
    fc: '',
    pa_gauche_sys: '',
    pa_gauche_dia: '',
    pa_droite_sys: '',
    pa_droite_dia: '',
    pouls_sym: '',
    pouls_frappe: '',
    trc: '',
    signes: [],
    blood_box: [],
  },
  D: {
    pci: '',
    pc_repete: '',
    pc_nombre: '',
    etat: '',
    orientation: '',
    neuro_signes: [],
    pupilles: '',
    sens_mains: '',
    sens_pieds: '',
    glycemie: '',
  },
  E: {
    temperature: '',
    victime_env: '',
    lesion: '',
    coince: '',
    coince_depuis: '',
    coince_zone_choices: [],
    coince_zone: '',
  },
  BRULURE: {
    brulure: '',
    brulure_degre: '',
    brulure_zones: [],
    brulure_etendue: '',
    brulure_loc_choices: [],
    brulure_loc: '',
    brulure_type: '',
  },
  FAST: { face: '', arm: '', speech: '', temps: '' },
  SAMPLER: {
    sampler_s: '',
    pqrst_list: [],
    sampler_a_choices: [],
    sampler_a: '',
    sampler_m: '',
    sampler_p_choices: [],
    sampler_p: '',
    sampler_l_choice: '',
    sampler_l: '',
    sampler_e: '',
    sampler_r: '',
  },
});

function alertTimerDone() {
  try {
    Haptics.vibrate({ duration: 400 });
  } catch (e) {
    // ignore
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch (e) {
    // ignore
  }
}

function useCountdown(initialSeconds) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            setDone(true);
            alertTimerDone();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
      return () => clearInterval(intervalRef.current);
    }
  }, [running]);

  const start = () => {
    setRemaining(initialSeconds);
    setDone(false);
    setRunning(true);
  };
  const reset = () => {
    clearInterval(intervalRef.current);
    setRemaining(initialSeconds);
    setRunning(false);
    setDone(false);
  };

  return { remaining, running, done, start, reset };
}

// Torche du téléphone (plugin natif — permission normale, pas de popup nécessaire)
function useTorch() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const native = Capacitor.isNativePlatform();

  const toggle = async () => {
    if (!native) {
      setError("Torche disponible uniquement dans l'app installée (pas dans le navigateur).");
      return;
    }
    setError('');
    try {
      if (!on) {
        await Torch.enable();
      } else {
        await Torch.disable();
      }
      setOn((v) => !v);
    } catch (e) {
      setError(e.message || 'Erreur torche');
    }
  };

  return { on, error, toggle };
}

function TimerBox({ timer }) {
  const mm = String(Math.floor(timer.remaining / 60)).padStart(2, '0');
  const ss = String(timer.remaining % 60).padStart(2, '0');
  const stateColor = timer.running ? AMBER : timer.done ? EMERALD : '#6B7280';
  return (
    <div className="flex items-center gap-3 bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2">
      <button
        onClick={timer.running ? timer.reset : timer.start}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded shrink-0"
        style={{ backgroundColor: timer.running ? '#3A2E1A' : ACCENT, color: '#fff' }}
      >
        {timer.running ? (
          <>
            <Square size={12} /> Stop
          </>
        ) : (
          <>
            <Play size={12} /> Chrono 1 min
          </>
        )}
      </button>
      <span
        className={`text-2xl tabular-nums ${timer.running ? 'animate-pulse' : ''}`}
        style={{ color: stateColor, fontFamily: "'IBM Plex Mono', monospace" }}
      >
        {mm}:{ss}
      </span>
      {timer.done && (
        <span className="text-xs uppercase tracking-widest" style={{ color: EMERALD }}>
          Terminé
        </span>
      )}
    </div>
  );
}

function ToggleGroup({ value, onChange, options }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(active ? '' : opt.value)}
            className="px-4 py-2 rounded-md border text-sm font-semibold tracking-wide transition-colors"
            style={
              active
                ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' }
                : { borderColor: '#2C3136', color: '#D4D4D4', backgroundColor: 'transparent' }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiToggleGroup({ value, onChange, options }) {
  const selected = value || [];
  const toggle = (v) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className="px-4 py-2 rounded-md border text-sm font-semibold tracking-wide transition-colors"
            style={
              active
                ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' }
                : { borderColor: '#2C3136', color: '#D4D4D4', backgroundColor: 'transparent' }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function InputBox({ value, onChange, unit, placeholder, numeric, width, onBlur, abnormal }) {
  const inputMode = numeric === 'decimal' ? 'decimal' : numeric ? 'numeric' : 'text';
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder || 'valeur'}
        inputMode={inputMode}
        className={`${width || 'w-28'} bg-neutral-950 border rounded-md px-3 py-2 text-lg focus:outline-none`}
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          borderColor: abnormal ? '#DC2626' : '#262626',
          color: abnormal ? '#F87171' : '#F5F5F5',
        }}
      />
      {unit && <span className="text-neutral-500 text-sm">{unit}</span>}
      {abnormal && (
        <span className="text-xs font-semibold" style={{ color: '#F87171' }}>
          hors norme
        </span>
      )}
    </div>
  );
}

function InlineCatBox({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mt-1">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex flex-col gap-1.5 rounded-lg border-2 px-3 py-2.5"
          style={{ borderColor: AMBER, backgroundColor: '#1A1508' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: AMBER }} />
            <span className="font-bold text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {item.title}
            </span>
          </div>
          <p className="text-xs text-neutral-300 leading-relaxed">{item.message}</p>
        </div>
      ))}
    </div>
  );
}

function O2AlarmModal({ active, remaining, onStop }) {
  if (!active) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="bg-neutral-950 border-2 rounded-2xl w-full sm:max-w-sm p-6 flex flex-col items-center gap-4 text-center"
        style={{ borderColor: AMBER }}
      >
        <AlertTriangle size={40} style={{ color: AMBER }} />
        <h3 className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Autonomie de la bouteille d'O2 est inférieure à 10 min
        </h3>
        {remaining !== null && (
          <p className="text-sm text-neutral-400">
            Temps restant estimé : {Math.max(0, Math.round(remaining))} min
          </p>
        )}
        <button
          onClick={onStop}
          className="w-full py-3 rounded-md font-semibold text-base"
          style={{ backgroundColor: AMBER, color: '#1a1200' }}
        >
          Arrêter
        </button>
      </div>
    </div>
  );
}

function FieldCard({ label, filled, children }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 sm:min-w-[240px]">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: filled ? EMERALD : '#404040' }}
        />
        <span className="text-sm font-semibold text-neutral-200 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function TorchButton() {
  const torch = useTorch();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={torch.toggle}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded shrink-0"
        style={{ backgroundColor: torch.on ? AMBER : '#2C3136', color: torch.on ? '#1a1200' : '#fff' }}
      >
        {torch.on ? <FlashlightOff size={13} /> : <Flashlight size={13} />}
        {torch.on ? 'Éteindre' : 'Lampe torche'}
      </button>
      {torch.error && <span className="text-xs text-red-400">{torch.error}</span>}
    </div>
  );
}

function PqrstRow({ letter, label, options, value, onChange, textValue, onTextChange, multi = true }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: ACCENT, fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {letter}
        </span>
        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">{label}</span>
      </div>
      {multi ? (
        <MultiToggleGroup value={value} onChange={onChange} options={options} />
      ) : (
        <ToggleGroup value={value} onChange={onChange} options={options} />
      )}
      <InputBox
        value={textValue}
        onChange={onTextChange}
        placeholder="Détail complémentaire (optionnel)"
        width="w-full"
      />
    </div>
  );
}

function SamplerField({ letter, label, value, onChange, choiceOptions, choiceValue, onChoiceChange, choiceMulti }) {
  const hasChoice = choiceValue !== undefined
    ? (Array.isArray(choiceValue) ? choiceValue.length > 0 : !!choiceValue)
    : false;
  const isFilled = !!value || hasChoice;
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: ACCENT, fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {letter}
        </span>
        <span className="text-sm font-semibold text-neutral-200 uppercase tracking-wide">{label}</span>
        <span
          className="w-1.5 h-1.5 rounded-full ml-auto shrink-0"
          style={{ backgroundColor: isFilled ? EMERALD : '#404040' }}
        />
      </div>
      {choiceOptions && (
        <div className="pb-1">
          {choiceMulti ? (
            <MultiToggleGroup value={choiceValue} onChange={onChoiceChange} options={choiceOptions} />
          ) : (
            <ToggleGroup value={choiceValue} onChange={onChoiceChange} options={choiceOptions} />
          )}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Texte libre pour plus de détails…"
        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-neutral-500 resize-none"
        style={{ fontFamily: "'Inter', sans-serif" }}
      />
    </div>
  );
}

// Version "pure" de la détection de valeur hors norme, réutilisable partout où on n'a
// que les données enregistrées (pas l'état live du formulaire) — écran de récap, PDF/SMS,
// et consultation de l'historique.
function getAbnormalDirectionPure(data, field, rawValue) {
  const categorie = data.TYPE && data.TYPE.categorie;
  if (!categorie || !rawValue) return null;
  const range = PATIENT_CATEGORIES[categorie]?.ranges[field];
  if (!range) return null;
  const num = field === 'glycemie' ? glycemieToGL(rawValue) : parseFloat(String(rawValue).replace(',', '.'));
  if (isNaN(num)) return null;
  if (num < range[0]) return 'low';
  if (num > range[1]) return 'high';
  return null;
}

// Calcule, pour chaque catégorie du bilan, si une détresse a été détectée — utilisé pour
// le résumé en tête du récap ("Détresse X détectée" / "Pas de détresse détectée").
function computeDetresseSummary(data) {
  const results = [];
  const hasReal = (arr, noneValue) => (arr || []).some((v) => v !== noneValue);

  if (data.X.trauma === 'oui' || data.X.hemorragie === 'oui') {
    results.push({ page: 'X', label: 'Trauma / hémorragie' });
  }
  if (data.A.obstruction === 'non') {
    results.push({ page: 'A', label: 'Voies aériennes' });
  }
  if (
    getAbnormalDirectionPure(data, 'fr', data.B.fr) !== null ||
    getAbnormalDirectionPure(data, 'spo2', data.B.spo2_air) !== null ||
    hasReal(data.B.fr_signes, 'aucun') ||
    data.B.fr_ample === 'non' ||
    data.B.fr_reguliere === 'non'
  ) {
    results.push({ page: 'B', label: 'Respiratoire' });
  }
  if (
    getAbnormalDirectionPure(data, 'fc', data.C.fc) !== null ||
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_gauche_sys) !== null ||
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_droite_sys) !== null ||
    data.C.pouls_sym === 'non' ||
    data.C.pouls_frappe === 'non' ||
    data.C.trc === '>2s' ||
    hasReal(data.C.signes, 'aucun') ||
    hasReal(data.C.blood_box, 'non_detecte')
  ) {
    results.push({ page: 'C', label: 'Circulatoire' });
  }
  if (
    data.D.pci === 'oui' ||
    data.D.pc_repete === 'oui' ||
    (data.D.etat && data.D.etat !== 'A') ||
    data.D.orientation === 'non' ||
    hasReal(data.D.neuro_signes, 'aucun') ||
    data.D.pupilles === 'non' ||
    data.D.sens_mains === 'non' ||
    data.D.sens_pieds === 'non' ||
    getAbnormalDirectionPure(data, 'glycemie', data.D.glycemie) !== null
  ) {
    results.push({ page: 'D', label: 'Neurologique' });
  }
  if (
    getAbnormalDirectionPure(data, 'temperature', data.E.temperature) !== null ||
    data.E.victime_env === 'froid' ||
    data.E.lesion === 'oui' ||
    data.E.coince === 'oui'
  ) {
    results.push({ page: 'E', label: 'Exposition' });
  }
  if (data.BRULURE.brulure === 'oui') {
    results.push({ page: 'BRULURE', label: 'Brûlure' });
  }
  if (data.FAST.face === 'oui' || data.FAST.arm === 'oui' || data.FAST.speech === 'oui') {
    results.push({ page: 'FAST', label: 'FAST (AVC)' });
  }

  return results;
}

function getRawValue(page, field, data) {
  if (page === 'C' && field === 'pa_gauche') {
    const { pa_gauche_sys: sys, pa_gauche_dia: dia } = data.C;
    if (!sys && !dia) return '';
    return `${sys || '?'}/${dia || '?'}`;
  }
  if (page === 'C' && field === 'pa_droite') {
    const { pa_droite_sys: sys, pa_droite_dia: dia } = data.C;
    if (!sys && !dia) return '';
    return `${sys || '?'}/${dia || '?'}`;
  }
  if (page === 'B' && field === 'o2_autonomie') {
    const autonomy = computeO2Autonomy(data.B.o2_bottle_size, data.B.o2_pressure, data.B.o2_debit);
    return autonomy === null ? '' : String(Math.round(autonomy));
  }
  return data[page][field];
}

// Transforme une entrée PQRST en lignes numérotées (n.1 P, n.2 Q, n.3 R, n.4 S, n.5 T)
// pour qu'elle reste clairement identifiable dans le récap même s'il y en a plusieurs.
function formatPqrstEntry(entry, n) {
  const specs = [
    { num: `${n}.1`, label: 'P — Provoqué / Palliatif', choice: entry.p, text: entry.p_text, opts: PQRST_P_OPTIONS, single: false },
    { num: `${n}.2`, label: 'Q — Qualité', choice: entry.q, text: entry.q_text, opts: PQRST_Q_OPTIONS, single: false },
    { num: `${n}.3`, label: 'R — Région / Irradiation', choice: entry.r, text: entry.r_text, opts: PQRST_R_OPTIONS, single: false },
    { num: `${n}.4`, label: 'S — Sévérité', choice: entry.s, text: entry.s_text, opts: EVA_OPTIONS, single: true },
    { num: `${n}.5`, label: 'T — Temps', choice: entry.t, text: entry.t_text, opts: PQRST_T_OPTIONS, single: false },
  ];
  return specs
    .map((spec) => {
      const choiceLabel = spec.single
        ? (spec.opts.find((o) => o.value === spec.choice)?.label || spec.choice || '')
        : (spec.choice && spec.choice.length
            ? spec.choice.map((v) => spec.opts.find((o) => o.value === v)?.label || v).join(', ')
            : '');
      const value = [choiceLabel, spec.text].filter(Boolean).join(' — ');
      return { num: spec.num, label: spec.label, value };
    })
    .filter((row) => row.value);
}

// Construit le contenu texte du bilan (réutilisé pour le PDF et le SMS)
function buildRecapLines(data) {
  const lines = [];
  const summary = computeDetresseSummary(data);
  if (summary.length === 0) {
    lines.push('Pas de détresse détectée');
  } else {
    summary.forEach((s) => lines.push(`Détresse ${s.label} détectée`));
  }
  lines.push('');
  if (data.TYPE && data.TYPE.categorie) {
    lines.push(`Catégorie : ${PATIENT_CATEGORIES[data.TYPE.categorie].label}`);
  }
  if (data.TYPE && data.TYPE.commentaire) {
    lines.push(`Commentaire : ${data.TYPE.commentaire}`);
  }
  lines.push('');
  ['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].forEach((page) => {
    const rows = PAGE_FIELDS[page]
      .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data)) }))
      .filter((r) => r.v !== null);
    const pqrstList = page === 'SAMPLER' ? data.SAMPLER.pqrst_list || [] : [];
    lines.push(`${PAGE_TITLES[page] || page}`);
    if (rows.length === 0 && pqrstList.length === 0) {
      lines.push('  Bilan non effectué / non renseigné');
      lines.push('');
      return;
    }
    rows.forEach(({ f, v }) => lines.push(`  ${FIELD_LABELS[f]} : ${v}`));
    if (pqrstList.length > 0) {
      pqrstList.forEach((entry, i) => {
        const n = i + 1;
        lines.push(`  PQRST ${n}`);
        formatPqrstEntry(entry, n).forEach((row) => lines.push(`    ${row.num} ${row.label} : ${row.value}`));
      });
    }
    if (
      page === 'FAST' &&
      data.FAST.face === 'non' &&
      data.FAST.arm === 'non' &&
      data.FAST.speech === 'non'
    ) {
      lines.push('  FAST négatif');
    }
    lines.push('');
  });
  lines.push(
    "Cet outil est une aide à la documentation du bilan secouriste. Il ne remplace pas le protocole officiel ni le jugement clinique du secouriste."
  );
  return lines;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min} min ${String(sec).padStart(2, '0')} s`;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function exportAndSharePdf(form, patientNum) {
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(`Bilan de l’équipier n°${patientNum}`, 14, y);
  doc.setFont(undefined, 'normal');
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString('fr-FR'), 14, y);
  doc.setTextColor(0);
  y += 10;

  const lines = buildRecapLines(form);
  doc.setFontSize(11);
  lines.forEach((line) => {
    if (y > pageHeight - 15) {
      doc.addPage();
      y = 18;
    }
    if (line && !line.startsWith(' ')) {
      doc.setFont(undefined, 'bold');
      doc.text(line, 14, y);
      doc.setFont(undefined, 'normal');
    } else {
      doc.text(line, 18, y);
    }
    y += 6;
  });

  const base64 = arrayBufferToBase64(doc.output('arraybuffer'));
  const fileName = `bilan-vsav-${patientNum}-${Date.now()}.pdf`;
  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({
    title: `Bilan de l’équipier n°${patientNum}`,
    text: `Bilan de l’équipier n°${patientNum}`,
    url: written.uri,
    dialogTitle: 'Partager le bilan',
  });
}

function sendBilanBySms(form, patientNum) {
  const lines = buildRecapLines(form);
  const text = `Bilan de l’équipier n°${patientNum} — ${new Date().toLocaleString('fr-FR')}\n\n${lines.join('\n')}`;
  const url = `sms:?body=${encodeURIComponent(text)}`;
  window.open(url, '_system');
}

function ExportButtons({ form, patientNum }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const handlePdf = async () => {
    setWorking(true);
    setError('');
    try {
      await exportAndSharePdf(form, patientNum);
    } catch (e) {
      setError(e.message || "Erreur lors de l'export PDF");
    }
    setWorking(false);
  };

  const handleSms = () => {
    setError('');
    try {
      sendBilanBySms(form, patientNum);
    } catch (e) {
      setError(e.message || "Erreur lors de l'ouverture des SMS");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <button
          onClick={handlePdf}
          disabled={working}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2.5 rounded-md border border-neutral-800 text-neutral-200 disabled:opacity-50"
        >
          <FileText size={14} /> {working ? 'Génération…' : 'Exporter en PDF'}
        </button>
        <button
          onClick={handleSms}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2.5 rounded-md border border-neutral-800 text-neutral-200"
        >
          <MessageSquare size={14} /> Envoyer par SMS
        </button>
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

function RecapView({ data }) {
  const sections = ['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].map((page) => {
    const rows = PAGE_FIELDS[page]
      .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data)) }))
      .filter((r) => r.v !== null);
    const pqrstList = page === 'SAMPLER' ? data.SAMPLER.pqrst_list || [] : [];
    return { page, rows, pqrstList };
  });

  return (
    <div className="flex flex-col gap-5">
      {(() => {
        const summary = computeDetresseSummary(data);
        if (summary.length === 0) {
          return (
            <div
              className="flex items-center gap-2 text-sm border-2 rounded-md px-3 py-2"
              style={{ borderColor: '#065F46', backgroundColor: '#0B1F17', color: EMERALD }}
            >
              <Check size={16} /> Pas de détresse détectée
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-1.5">
            {summary.map((s) => (
              <div
                key={s.page}
                className="flex items-center gap-2 text-sm border-2 rounded-md px-3 py-2 font-semibold"
                style={{ borderColor: AMBER, backgroundColor: '#1A1508' }}
              >
                <AlertTriangle size={16} style={{ color: AMBER }} /> Détresse {s.label} détectée
              </div>
            ))}
          </div>
        );
      })()}
      {data.TYPE && (data.TYPE.categorie || data.TYPE.commentaire) && (
        <div className="flex flex-col gap-2">
          {data.TYPE.categorie && (
            <div className="flex items-center gap-2 text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2">
              <span className="text-neutral-500">Catégorie :</span>
              <span className="font-semibold text-neutral-100">
                {PATIENT_CATEGORIES[data.TYPE.categorie].label}
              </span>
            </div>
          )}
          {data.TYPE.commentaire && (
            <div className="flex flex-col gap-1 text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2">
              <span className="text-neutral-500 text-xs">Commentaire</span>
              <span className="text-neutral-100">{data.TYPE.commentaire}</span>
            </div>
          )}
        </div>
      )}
      {sections.map(({ page, rows, pqrstList }) => (
        <div key={page}>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: ACCENT, fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              {SECTION_BADGE[page]}
            </span>
            <h3
              className="text-sm font-semibold uppercase tracking-widest text-neutral-300"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              {PAGE_TITLES[page]}
            </h3>
          </div>
          {rows.length === 0 && pqrstList.length === 0 ? (
            <p className="text-sm text-neutral-600 italic px-1">Bilan non effectué / non renseigné</p>
          ) : (
            <>
              {rows.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rows.map(({ f, v }) => (
                    <div
                      key={f}
                      className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 gap-3"
                    >
                      <span className="text-xs text-neutral-500">{FIELD_LABELS[f]}</span>
                      <span
                        className="text-sm text-neutral-100 text-right"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {pqrstList.length > 0 && (
                <div className="flex flex-col gap-3 mt-2">
                  {pqrstList.map((entry, i) => {
                    const n = i + 1;
                    const pqrstRows = formatPqrstEntry(entry, n);
                    return (
                      <div key={entry.id} className="border-l-2 pl-3" style={{ borderColor: ACCENT }}>
                        <div
                          className="text-sm font-bold text-neutral-100 mb-1"
                          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                        >
                          PQRST {n}
                        </div>
                        {pqrstRows.length === 0 ? (
                          <p className="text-xs text-neutral-600 italic">Non renseigné</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {pqrstRows.map((row) => (
                              <div key={row.num} className="flex items-start justify-between gap-3 text-xs">
                                <span className="text-neutral-500 shrink-0">
                                  {row.num} {row.label}
                                </span>
                                <span
                                  className="text-neutral-100 text-right"
                                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                                >
                                  {row.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {page === 'FAST' &&
            data.FAST.face === 'non' &&
            data.FAST.arm === 'non' &&
            data.FAST.speech === 'non' && (
              <div
                className="mt-2 flex items-center gap-2 text-sm bg-neutral-900 border rounded-md px-3 py-2"
                style={{ borderColor: '#065F46', color: EMERALD }}
              >
                <Check size={14} /> FAST négatif
              </div>
            )}
        </div>
      ))}
      <p className="text-xs text-neutral-600 italic leading-relaxed border-t border-neutral-800 pt-3 mt-1">
        Cet outil est une aide à la documentation du bilan secouriste. Il ne remplace pas le
        protocole officiel ni le jugement clinique du secouriste.
      </p>
    </div>
  );
}

export default function BilanVsav() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm());
  const [patientNum, setPatientNum] = useState(1);
  const [saved, setSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const bilanStartRef = useRef(null);
  const [bilanDuration, setBilanDuration] = useState(null);
  const [o2AlarmActive, setO2AlarmActive] = useState(false);
  const [o2RemainingMin, setO2RemainingMin] = useState(null);
  const o2StartRef = useRef(null);
  const o2CheckIntervalRef = useRef(null);
  const o2VibrateIntervalRef = useRef(null);

  const frTimer = useCountdown(60);
  const fcTimer = useCountdown(60);
  const mainRef = useRef(null);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [step]);

  // Chrono du bilan : capture la durée dès la première arrivée sur le récap,
  // à partir du tout premier champ renseigné.
  useEffect(() => {
    if (STEPS[step] === 'RECAP' && bilanStartRef.current !== null && bilanDuration === null) {
      setBilanDuration(Date.now() - bilanStartRef.current);
    }
  }, [step]);

  useEffect(() => {
    loadHistory();
  }, []);

  // Suivi de l'autonomie de la bouteille O2 : redémarre le chrono dès que la config
  // change (taille, pression, débit), et déclenche une vibration répétée 10 min avant
  // la fin de l'autonomie estimée (en respectant le seuil minimal de pression).
  useEffect(() => {
    const autonomy = computeO2Autonomy(form.B.o2_bottle_size, form.B.o2_pressure, form.B.o2_debit);
    if (o2CheckIntervalRef.current) clearInterval(o2CheckIntervalRef.current);
    if (o2VibrateIntervalRef.current) {
      clearInterval(o2VibrateIntervalRef.current);
      o2VibrateIntervalRef.current = null;
    }
    setO2AlarmActive(false);

    if (form.B.o2_active !== 'oui' || autonomy === null) {
      setO2RemainingMin(null);
      return;
    }

    o2StartRef.current = Date.now();
    setO2RemainingMin(autonomy);

    o2CheckIntervalRef.current = setInterval(() => {
      const elapsedMin = (Date.now() - o2StartRef.current) / 60000;
      const remaining = autonomy - elapsedMin;
      setO2RemainingMin(remaining);
      if (remaining <= 10 && !o2VibrateIntervalRef.current) {
        setO2AlarmActive(true);
        try {
          Haptics.vibrate({ duration: 700 });
        } catch (e) {
          // ignore
        }
        o2VibrateIntervalRef.current = setInterval(() => {
          try {
            Haptics.vibrate({ duration: 700 });
          } catch (e) {
            // ignore
          }
        }, 2000);
      }
    }, 5000);

    return () => {
      if (o2CheckIntervalRef.current) clearInterval(o2CheckIntervalRef.current);
    };
  }, [form.B.o2_active, form.B.o2_bottle_size, form.B.o2_pressure, form.B.o2_debit]);

  function stopO2Alarm() {
    setO2AlarmActive(false);
    if (o2VibrateIntervalRef.current) {
      clearInterval(o2VibrateIntervalRef.current);
      o2VibrateIntervalRef.current = null;
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await storage.list('bilan:', false);
      const items = [];
      if (res && res.keys) {
        for (const k of res.keys) {
          try {
            const r = await storage.get(k, false);
            if (r) items.push(JSON.parse(r.value));
          } catch (e) {
            // skip unreadable entry
          }
        }
      }
      items.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(items);
    } catch (e) {
      console.error('Erreur de chargement de l\'historique', e);
    }
    setLoadingHistory(false);
  }

  function updateField(page, field, value) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => ({ ...f, [page]: { ...f[page], [field]: value } }));
    if (saved) setSaved(false);
  }

  function addPqrst() {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    const entry = {
      id: `pqrst_${Date.now()}`,
      p: [],
      p_text: '',
      q: [],
      q_text: '',
      r: [],
      r_text: '',
      s: '',
      s_text: '',
      t: [],
      t_text: '',
    };
    setForm((f) => ({
      ...f,
      SAMPLER: { ...f.SAMPLER, pqrst_list: [...f.SAMPLER.pqrst_list, entry] },
    }));
    if (saved) setSaved(false);
  }

  function removePqrst(id) {
    setForm((f) => ({
      ...f,
      SAMPLER: { ...f.SAMPLER, pqrst_list: f.SAMPLER.pqrst_list.filter((p) => p.id !== id) },
    }));
    if (saved) setSaved(false);
  }

  function updatePqrstField(id, field, value) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => ({
      ...f,
      SAMPLER: {
        ...f.SAMPLER,
        pqrst_list: f.SAMPLER.pqrst_list.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
      },
    }));
    if (saved) setSaved(false);
  }

  // Compare une valeur à la plage normale de la catégorie de victime sélectionnée.
  // Renvoie 'low', 'high', ou null si dans la norme / non évaluable.
  function getAbnormalDirection(field, rawValue) {
    const categorie = form.TYPE.categorie;
    if (!categorie || !rawValue) return null;
    const range = PATIENT_CATEGORIES[categorie]?.ranges[field];
    if (!range) return null;
    const num = field === 'glycemie' ? glycemieToGL(rawValue) : parseFloat(String(rawValue).replace(',', '.'));
    if (isNaN(num)) return null;
    if (num < range[0]) return 'low';
    if (num > range[1]) return 'high';
    return null;
  }

  function isAbnormalField(field, rawValue) {
    return getAbnormalDirection(field, rawValue) !== null;
  }

  // Calcule, à chaque rendu, les conduites à tenir applicables à la page en cours —
  // affichées en direct sous la saisie, jamais en popup, jamais sur le récap.
  function catItem(id, title, message) {
    return [{ id, title, message }];
  }

  function getSimpleCat(field, rawValue) {
    const dir = getAbnormalDirection(field, rawValue);
    if (!dir) return [];
    return catItem(`${field}_${dir}`, CAT_MESSAGES[field][dir].title, CAT_MESSAGES[field][dir].message);
  }

  function getTraumaCat() {
    if (form.X.trauma !== 'oui') return [];
    return catItem(
      'trauma',
      'Victime traumatisée',
      'Position d\u2019attente : allongée en rectitude, ne pas laisser la victime bouger. Maintien de la tête (ne pas mobiliser le rachis), pose d\u2019un collier cervical si disponible, alerter le 15.'
    );
  }

  function getHemorragieCat() {
    if (form.X.hemorragie !== 'oui') return [];
    return catItem(
      'hemorragie',
      'Hémorragie',
      'Position d\u2019attente : allongée sur le dos, jambes légèrement surélevées si pas de contre-indication. Compression manuelle directe sur la plaie (ou garrot si hémorragie massive incontrôlable), couvrir pour prévenir l\u2019hypothermie, oxygénothérapie si disponible, alerter le 15.'
    );
  }

  function getObstructionCat() {
    if (form.A.obstruction !== 'non') return [];
    return catItem(
      'airway_obstruee',
      'Voies aériennes obstruées',
      'Désobstruction immédiate (claques dans le dos puis compressions abdominales si conscient ; LVA et recherche de corps étranger si inconscient).'
    );
  }

  function getRespSignesCat() {
    if (form.B.fr_signes.filter((s) => s !== 'aucun').length === 0) return [];
    return catItem(
      'resp_signes',
      'Signes de détresse respiratoire',
      "Position d'attente : demi-assise. Oxygénothérapie si disponible, surveillance rapprochée, alerter le 15."
    );
  }

  function getAmpleCat() {
    if (form.B.fr_ample !== 'non') return [];
    return catItem(
      'fr_ample',
      'Amplitude respiratoire anormale',
      "Position d'attente : demi-assise. Surveiller étroitement, rechercher une détresse respiratoire, alerter le 15 si aggravation."
    );
  }

  function getReguliereCat() {
    if (form.B.fr_reguliere !== 'non') return [];
    return catItem(
      'fr_reguliere',
      'Respiration irrégulière',
      "Position d'attente : demi-assise. Surveiller étroitement, alerter le 15."
    );
  }

  function getPaSysCat() {
    const dir = getAbnormalDirection('pa_sys', form.C.pa_gauche_sys) || getAbnormalDirection('pa_sys', form.C.pa_droite_sys);
    if (!dir) return [];
    return catItem(`pa_sys_${dir}`, CAT_MESSAGES.pa_sys[dir].title, CAT_MESSAGES.pa_sys[dir].message);
  }

  function getPoulsSymCat() {
    if (form.C.pouls_sym !== 'non') return [];
    return catItem(
      'pouls_asym',
      'Pouls asymétrique',
      "Position d'attente : allongée, ne pas mobiliser le membre concerné. Suspicion d'atteinte vasculaire, alerter le 15."
    );
  }

  function getPoulsFrappeCat() {
    if (form.C.pouls_frappe !== 'non') return [];
    return catItem(
      'pouls_faible',
      'Pouls mal frappé',
      'Signe de choc possible : position d\u2019attente (allongée, jambes surélevées sauf contre-indication), alerter le 15.'
    );
  }

  function getTrcCat() {
    if (form.C.trc !== '>2s') return [];
    return catItem(
      'trc_long',
      'TRC > 2 secondes',
      'Signe de choc : position d\u2019attente (allongée, jambes surélevées sauf contre-indication), couvrir, alerter le 15.'
    );
  }

  function getChocSignesCat() {
    if (form.C.signes.filter((s) => s !== 'aucun').length === 0) return [];
    return catItem(
      'choc_signes',
      'Signes de choc',
      'Position d\u2019attente (allongée, jambes surélevées sauf contre-indication), couvrir, alerter le 15.'
    );
  }

  function getBloodBoxCat() {
    const positive = form.C.blood_box.filter((v) => v !== 'non_detecte');
    if (positive.length === 0) return [];
    return catItem(
      'blood_box',
      'Suspicion d\u2019hémorragie interne',
      'Position d\u2019attente : allongée, ne pas mobiliser inutilement. Alerter le 15 en urgence, transport médicalisé prioritaire, surveiller étroitement les signes de choc.'
    );
  }

  function getPciCat() {
    if (form.D.pci !== 'oui') return [];
    return catItem(
      'pci',
      'Perte de connaissance',
      'Position d\u2019attente : PLS si respiration spontanée et pas de trauma suspecté (sinon maintien tête). Surveillance rapprochée, alerter le 15.'
    );
  }

  function getPcRepeteCat() {
    if (form.D.pc_repete !== 'oui') return [];
    return catItem(
      'pc_repete',
      'Pertes de connaissance répétées',
      'Position d\u2019attente : allongée, en sécurité. Alerter le 15, transport médicalisé à prévoir, surveiller étroitement.'
    );
  }

  function getEtatCat() {
    if (!form.D.etat || form.D.etat === 'A') return [];
    return catItem(
      'etat_conscience',
      'Trouble de la conscience',
      'Position d\u2019attente : PLS si respiration spontanée et pas de trauma suspecté. Surveillance rapprochée, alerter le 15.'
    );
  }

  function getOrientationCat() {
    if (form.D.orientation !== 'non') return [];
    return catItem(
      'orientation',
      "Trouble de l'orientation",
      "Position d'attente : allongée, au calme. Surveillance neurologique rapprochée, alerter le 15."
    );
  }

  function getNeuroSignesCat() {
    if (form.D.neuro_signes.filter((s) => s !== 'aucun').length === 0) return [];
    return catItem(
      'neuro_signes',
      'Signes neurologiques associés',
      "Position d'attente : allongée, au calme. Surveillance neurologique rapprochée, alerter le 15."
    );
  }

  function getPupillesCat() {
    if (form.D.pupilles !== 'non') return [];
    return catItem(
      'pupilles',
      'Anomalie pupillaire',
      "Position d'attente : allongée. Suspicion d'atteinte neurologique, alerter le 15 en urgence."
    );
  }

  function getSensMainsCat() {
    if (form.D.sens_mains !== 'non') return [];
    return catItem(
      'sens_mains',
      'Déficit sensitivo-moteur (mains)',
      "Position d'attente : ne pas mobiliser le membre, immobiliser. Alerter le 15."
    );
  }

  function getSensPiedsCat() {
    if (form.D.sens_pieds !== 'non') return [];
    return catItem(
      'sens_pieds',
      'Déficit sensitivo-moteur (pieds)',
      "Position d'attente : ne pas mobiliser le membre, immobiliser. Alerter le 15."
    );
  }

  function getVictimeFroidCat() {
    if (form.E.victime_env !== 'froid') return [];
    return catItem(
      'victime_froid',
      'Victime en ambiance froide',
      'Position d\u2019attente : réchauffement progressif, couverture, isolation du sol, retirer les vêtements mouillés.'
    );
  }

  function getLesionCat() {
    if (form.E.lesion !== 'oui') return [];
    return catItem(
      'lesion_cachee',
      'Lésion cachée détectée',
      "Position d'attente : allongée. Réexaminer entièrement la victime, couvrir/protéger la zone, alerter le 15 si nécessaire."
    );
  }

  function getCoinceCat() {
    if (form.E.coince !== 'oui') return [];
    return catItem(
      'coince',
      'Victime coincée / comprimée',
      'Position d\u2019attente : ne pas dégager précipitamment si compression prolongée (risque de syndrome de revascularisation à la levée de la compression). Alerter le 15, coordonner la désincarcération avec les secours.'
    );
  }

  function getBruleInitialCat() {
    if (form.BRULURE.brulure !== 'oui') return [];
    return catItem('brulure_initial', BURN_INITIAL_CAT.title, BURN_INITIAL_CAT.message);
  }

  function getBruleDegreCat() {
    const entry = BURN_CAT_BY_DEGREE[form.BRULURE.brulure_degre];
    if (!entry) return [];
    return catItem(`brulure_degre_${form.BRULURE.brulure_degre}`, entry.title, entry.message);
  }

  function getBruleTypeCat() {
    const entry = BURN_CAT_BY_TYPE[form.BRULURE.brulure_type];
    if (!entry) return [];
    return catItem(`brulure_type_${form.BRULURE.brulure_type}`, entry.title, entry.message);
  }

  function getBruleEtendueCat() {
    const num = parseFloat(String(form.BRULURE.brulure_etendue).replace(',', '.'));
    if (isNaN(num) || num < 10) return [];
    return catItem(
      'brulure_etendue',
      'Brûlure étendue (≥ 10 % SC)',
      'Risque de choc hypovolémique : surveillance hémodynamique rapprochée, transport médicalisé à prévoir, alerter le 15.'
    );
  }

  function getFastCat() {
    if (form.FAST.face !== 'oui' && form.FAST.arm !== 'oui' && form.FAST.speech !== 'oui') return [];
    return catItem(
      'fast_positif',
      'Signe FAST positif — suspicion AVC',
      "Position d'attente : demi-assise ou position confortable, ne pas laisser seul. Noter précisément l'heure d'apparition des signes, alerter le 15 en urgence, ne rien donner par voie orale."
    );

  }

  function goNext() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goPrev() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function saveBilan() {
    const now = new Date();
    const record = {
      id: `${now.getTime()}`,
      timestamp: now.getTime(),
      date: now.toLocaleDateString('fr-FR'),
      heure: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      patientNum,
      data: form,
    };
    try {
      const res = await storage.set(`bilan:${record.id}`, JSON.stringify(record), false);
      if (res) {
        setHistory((h) => [record, ...h]);
        setSaved(true);
        setSavedAt(record.heure);
      }
    } catch (e) {
      console.error('Erreur d\'enregistrement du bilan', e);
    }
  }

  function newBilan() {
    if (!window.confirm('Effacer le bilan en cours et repartir de zéro ?')) return;
    setForm(initialForm());
    frTimer.reset();
    fcTimer.reset();
    setStep(0);
    setSaved(false);
    setSavedAt(null);
    setPatientNum((n) => n + 1);
    bilanStartRef.current = null;
    setBilanDuration(null);
    stopO2Alarm();
  }

  async function clearHistory() {
    if (history.length === 0) return;
    const ok = window.confirm(
      "Effacer tout l'historique des bilans ? Cette action est irréversible."
    );
    if (!ok) return;
    try {
      for (const rec of history) {
        await storage.delete(`bilan:${rec.id}`);
      }
      setHistory([]);
      setViewing(null);
    } catch (e) {
      console.error("Erreur lors de l'effacement de l'historique", e);
    }
  }

  function renderStepContent() {
    const s = STEPS[step];
    if (s === 'TYPE')
      return (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-600 italic leading-relaxed border-l-2 border-neutral-800 pl-3">
            Cet outil est une aide à la documentation du bilan secouriste. Il ne remplace pas le
            protocole officiel de ton service ni le jugement clinique du secouriste.
          </p>
          <p className="text-sm text-neutral-400 mb-1 leading-relaxed">
            Sélectionne la catégorie de la victime pour activer la détection des valeurs hors
            normes et les conduites à tenir associées.
          </p>
          {Object.entries(PATIENT_CATEGORIES).map(([key, cat]) => {
            const active = form.TYPE.categorie === key;
            return (
              <button
                key={key}
                onClick={() => updateField('TYPE', 'categorie', active ? '' : key)}
                className="text-left px-4 py-4 rounded-lg border flex items-center justify-between"
                style={
                  active
                    ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' }
                    : { backgroundColor: '#171717', borderColor: '#262626', color: '#e5e5e5' }
                }
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {cat.label}
                  </span>
                  <span className="text-xs" style={{ color: active ? 'rgba(255,255,255,0.75)' : '#737373' }}>
                    {cat.ageRange}
                  </span>
                </div>
                {active && <Check size={18} />}
              </button>
            );
          })}
          <div className="flex flex-col gap-1.5 mt-2">
            <span className="text-xs text-neutral-500 uppercase tracking-wide">
              Commentaire (optionnel)
            </span>
            <textarea
              value={form.TYPE.commentaire}
              onChange={(e) => updateField('TYPE', 'commentaire', e.target.value)}
              rows={3}
              placeholder="Contexte, remarque générale…"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-neutral-500 resize-none"
              style={{ fontFamily: "'Inter', sans-serif" }}
            />
          </div>
        </div>
      );
    if (s === 'X')
      return (
        <>
          <FieldCard label="Victime traumatisée" filled={!!form.X.trauma}>
            <ToggleGroup
              value={form.X.trauma}
              onChange={(v) => updateField('X', 'trauma', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getTraumaCat()} />
          <FieldCard label="Hémorragie" filled={!!form.X.hemorragie}>
            <div className="flex flex-col gap-3 items-stretch">
              <ToggleGroup
                value={form.X.hemorragie}
                onChange={(v) => {
                  updateField('X', 'hemorragie', v);
                  if (v !== 'oui') {
                    updateField('X', 'hemorragie_sites', []);
                    updateField('X', 'garrot_pose', '');
                    updateField('X', 'garrot_heure', '');
                  }
                }}
                options={OUI_NON}
              />
              {form.X.hemorragie === 'oui' && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide">
                    Localisation(s)
                  </span>
                  <MultiToggleGroup
                    value={form.X.hemorragie_sites}
                    onChange={(v) => updateField('X', 'hemorragie_sites', v)}
                    options={HEMORRAGIE_SITES}
                  />
                </div>
              )}
              {form.X.hemorragie === 'oui' && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide">Pose garrot</span>
                  <ToggleGroup
                    value={form.X.garrot_pose}
                    onChange={(v) => {
                      updateField('X', 'garrot_pose', v);
                      if (v === 'oui' && !form.X.garrot_heure) {
                        const now = new Date();
                        const hh = String(now.getHours()).padStart(2, '0');
                        const mm = String(now.getMinutes()).padStart(2, '0');
                        updateField('X', 'garrot_heure', `${hh}:${mm}`);
                      }
                      if (v !== 'oui') updateField('X', 'garrot_heure', '');
                    }}
                    options={OUI_NON}
                  />
                  {form.X.garrot_pose === 'oui' && (
                    <div className="flex flex-col gap-1.5 pt-2">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">
                        Heure de pose (capturée automatiquement, modifiable)
                      </span>
                      <InputBox
                        value={form.X.garrot_heure}
                        onChange={(v) => updateField('X', 'garrot_heure', v)}
                        placeholder="hh:mm"
                        width="w-28"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </FieldCard>
          <InlineCatBox items={getHemorragieCat()} />
        </>
      );
    if (s === 'A')
      return (
        <>
          <FieldCard label="Liberté des voies aériennes" filled={!!form.A.obstruction}>
            <ToggleGroup
              value={form.A.obstruction}
              onChange={(v) => updateField('A', 'obstruction', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getObstructionCat()} />
        </>
      );
    if (s === 'B')
      return (
        <>
          <FieldCard label="Fréquence respiratoire" filled={!!form.B.fr}>
            <div className="flex flex-col gap-2 items-stretch sm:flex-row sm:items-center">
              <TimerBox timer={frTimer} />
              <InputBox
                value={form.B.fr}
                onChange={(v) => updateField('B', 'fr', v)}
                abnormal={isAbnormalField('fr', form.B.fr)}
                unit="/min"
                numeric
              />
            </div>
          </FieldCard>
          <InlineCatBox items={getSimpleCat('fr', form.B.fr)} />
          <FieldCard label="Amplitude ample" filled={!!form.B.fr_ample}>
            <ToggleGroup
              value={form.B.fr_ample}
              onChange={(v) => updateField('B', 'fr_ample', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getAmpleCat()} />
          <FieldCard label="Respiration régulière" filled={!!form.B.fr_reguliere}>
            <ToggleGroup
              value={form.B.fr_reguliere}
              onChange={(v) => updateField('B', 'fr_reguliere', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getReguliereCat()} />
          <FieldCard label="Signes associés" filled={form.B.fr_signes.length > 0}>
            <MultiToggleGroup
              value={form.B.fr_signes}
              onChange={(v) => updateField('B', 'fr_signes', withExclusiveNone(form.B.fr_signes, v, 'aucun'))}
              options={BREATH_SIGNS}
            />
          </FieldCard>
          <InlineCatBox items={getRespSignesCat()} />
          <FieldCard label="SpO2 (SAT) — sous air" filled={!!form.B.spo2_air}>
            <InputBox
              value={form.B.spo2_air}
              onChange={(v) => updateField('B', 'spo2_air', v)}
              abnormal={isAbnormalField('spo2', form.B.spo2_air)}
              unit="%"
              placeholder="Valeur"
              numeric
            />
          </FieldCard>
          <InlineCatBox items={getSimpleCat('spo2', form.B.spo2_air)} />

          {form.B.o2_active !== 'oui' && (
            <button
              onClick={() => updateField('B', 'o2_active', 'oui')}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-md self-start"
              style={{ backgroundColor: ACCENT, color: '#fff' }}
            >
              <Check size={13} /> Ajouter une SAT sous O2
            </button>
          )}

          {form.B.o2_active === 'oui' && (
            <>
              <FieldCard label="SpO2 (SAT) — sous O2" filled={!!form.B.spo2_o2}>
                <InputBox
                  value={form.B.spo2_o2}
                  onChange={(v) => updateField('B', 'spo2_o2', v)}
                  unit="%"
                  placeholder="Valeur"
                  numeric
                />
              </FieldCard>

              <FieldCard label="Autonomie bouteille — Taille" filled={!!form.B.o2_bottle_size}>
                <ToggleGroup
                  value={form.B.o2_bottle_size}
                  onChange={(v) => updateField('B', 'o2_bottle_size', v)}
                  options={O2_BOTTLE_OPTIONS}
                />
              </FieldCard>

              <FieldCard label="Pression au manomètre" filled={!!form.B.o2_pressure}>
                <InputBox
                  value={form.B.o2_pressure}
                  onChange={(v) => updateField('B', 'o2_pressure', v)}
                  unit="bars"
                  placeholder="200"
                  numeric
                />
              </FieldCard>

              <FieldCard label="Débit" filled={!!form.B.o2_debit}>
                <InputBox
                  value={form.B.o2_debit}
                  onChange={(v) => updateField('B', 'o2_debit', v)}
                  unit="L/min"
                  placeholder="15"
                  numeric
                />
              </FieldCard>

              {(() => {
                const autonomy = computeO2Autonomy(form.B.o2_bottle_size, form.B.o2_pressure, form.B.o2_debit);
                if (autonomy === null) return null;
                return (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">Autonomie estimée</span>
                      <span
                        className="font-semibold text-neutral-100"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {Math.round(autonomy)} min
                      </span>
                    </div>
                    {o2RemainingMin !== null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-500">Temps restant</span>
                        <span
                          className="font-semibold"
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: o2RemainingMin <= 10 ? '#F87171' : '#F5F5F5',
                          }}
                        >
                          {Math.max(0, Math.round(o2RemainingMin))} min
                        </span>
                      </div>
                    )}
                    <span className="text-xs text-neutral-600 italic">
                      Seuil minimal de pression respecté : {o2BottleThreshold(form.B.o2_bottle_size)} bars.
                    </span>
                  </div>
                );
              })()}


            </>
          )}
        </>
      );
    if (s === 'C')
      return (
        <>
          <FieldCard label="Fréquence cardiaque" filled={!!form.C.fc}>
            <div className="flex flex-col gap-2 items-stretch sm:flex-row sm:items-center">
              <TimerBox timer={fcTimer} />
              <InputBox
                value={form.C.fc}
                onChange={(v) => updateField('C', 'fc', v)}
                abnormal={isAbnormalField('fc', form.C.fc)}
                unit="/min"
                numeric
              />
            </div>
          </FieldCard>
          <InlineCatBox items={getSimpleCat('fc', form.C.fc)} />
          <FieldCard
            label="Pression artérielle bras gauche"
            filled={!!form.C.pa_gauche_sys || !!form.C.pa_gauche_dia}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Systolique</span>
                <InputBox
                  value={form.C.pa_gauche_sys}
                  onChange={(v) => updateField('C', 'pa_gauche_sys', v)}
                  abnormal={isAbnormalField('pa_sys', form.C.pa_gauche_sys)}
                  placeholder="Valeur"
                  numeric
                  width="w-20"
                />
              </div>
              <span className="text-neutral-600 text-lg mt-4">/</span>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Diastolique</span>
                <InputBox
                  value={form.C.pa_gauche_dia}
                  onChange={(v) => updateField('C', 'pa_gauche_dia', v)}
                  unit="mmHg"
                  placeholder="Valeur"
                  numeric
                  width="w-20"
                />
              </div>
            </div>
          </FieldCard>
          <FieldCard
            label="Pression artérielle bras droit"
            filled={!!form.C.pa_droite_sys || !!form.C.pa_droite_dia}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Systolique</span>
                <InputBox
                  value={form.C.pa_droite_sys}
                  onChange={(v) => updateField('C', 'pa_droite_sys', v)}
                  abnormal={isAbnormalField('pa_sys', form.C.pa_droite_sys)}
                  placeholder="Valeur"
                  numeric
                  width="w-20"
                />
              </div>
              <span className="text-neutral-600 text-lg mt-4">/</span>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Diastolique</span>
                <InputBox
                  value={form.C.pa_droite_dia}
                  onChange={(v) => updateField('C', 'pa_droite_dia', v)}
                  unit="mmHg"
                  placeholder="Valeur"
                  numeric
                  width="w-20"
                />
              </div>
            </div>
          </FieldCard>
          <InlineCatBox items={getPaSysCat()} />
          <FieldCard label="Pouls symétrique" filled={!!form.C.pouls_sym}>
            <ToggleGroup
              value={form.C.pouls_sym}
              onChange={(v) => updateField('C', 'pouls_sym', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getPoulsSymCat()} />
          <FieldCard label="Pouls bien frappé" filled={!!form.C.pouls_frappe}>
            <ToggleGroup
              value={form.C.pouls_frappe}
              onChange={(v) => updateField('C', 'pouls_frappe', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getPoulsFrappeCat()} />
          <FieldCard label="TRC" filled={!!form.C.trc}>
            <ToggleGroup
              value={form.C.trc}
              onChange={(v) => updateField('C', 'trc', v)}
              options={TRC_OPTIONS}
            />
          </FieldCard>
          <InlineCatBox items={getTrcCat()} />
          <FieldCard label="Signes associés" filled={form.C.signes.length > 0}>
            <MultiToggleGroup
              value={form.C.signes}
              onChange={(v) => updateField('C', 'signes', withExclusiveNone(form.C.signes, v, 'aucun'))}
              options={CIRC_SIGNS}
            />
          </FieldCard>
          <InlineCatBox items={getChocSignesCat()} />
          {form.X.trauma === 'oui' && (
            <>
              <FieldCard
                label="Blood box — hémorragie interne suspectée"
                filled={form.C.blood_box.length > 0}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-neutral-600 italic">
                    Compartiments à évaluer chez le traumatisé : thorax → abdomen → bassin/pelvis →
                    cuisses.
                  </span>
                  <MultiToggleGroup
                    value={form.C.blood_box}
                    onChange={(v) => {
                      const justAddedNonDetecte =
                        v.includes('non_detecte') && !form.C.blood_box.includes('non_detecte');
                      let next = v;
                      if (justAddedNonDetecte) {
                        next = ['non_detecte'];
                      } else if (v.includes('non_detecte') && v.length > 1) {
                        next = v.filter((x) => x !== 'non_detecte');
                      }
                      updateField('C', 'blood_box', next);
                    }}
                    options={BLOOD_BOX_OPTIONS}
                  />
                </div>
              </FieldCard>
              <InlineCatBox items={getBloodBoxCat()} />
            </>
          )}
        </>
      );
    if (s === 'D')
      return (
        <>
          <FieldCard label="PCI" filled={!!form.D.pci}>
            <ToggleGroup
              value={form.D.pci}
              onChange={(v) => {
                updateField('D', 'pci', v);
                if (v !== 'oui') {
                  updateField('D', 'pc_repete', '');
                  updateField('D', 'pc_nombre', '');
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getPciCat()} />
          {form.D.pci === 'oui' && (
            <>
              <FieldCard label="PC à répétition" filled={!!form.D.pc_repete}>
                <div className="flex flex-col gap-3 items-stretch">
                  <ToggleGroup
                    value={form.D.pc_repete}
                    onChange={(v) => updateField('D', 'pc_repete', v)}
                    options={OUI_NON}
                  />
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">
                      Nombre de fois
                    </span>
                    <InputBox
                      value={form.D.pc_nombre}
                      onChange={(v) => updateField('D', 'pc_nombre', v)}
                      placeholder="Valeur"
                      numeric
                    />
                  </div>
                </div>
              </FieldCard>
              <InlineCatBox items={getPcRepeteCat()} />
            </>
          )}
          <FieldCard label="État de conscience" filled={!!form.D.etat}>
            <ToggleGroup
              value={form.D.etat}
              onChange={(v) => updateField('D', 'etat', v)}
              options={AVPU_OPTIONS}
            />
          </FieldCard>
          <InlineCatBox items={getEtatCat()} />
          <FieldCard label="Orientation temps-espace" filled={!!form.D.orientation}>
            <ToggleGroup
              value={form.D.orientation}
              onChange={(v) => updateField('D', 'orientation', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getOrientationCat()} />
          <FieldCard label="Signes associés" filled={form.D.neuro_signes.length > 0}>
            <MultiToggleGroup
              value={form.D.neuro_signes}
              onChange={(v) => updateField('D', 'neuro_signes', withExclusiveNone(form.D.neuro_signes, v, 'aucun'))}
              options={NEURO_SIGNS}
            />
          </FieldCard>
          <InlineCatBox items={getNeuroSignesCat()} />
          <FieldCard label="Pupilles sym., taille normale, réactives" filled={!!form.D.pupilles}>
            <div className="flex flex-col gap-3 items-stretch sm:flex-row sm:items-center">
              <ToggleGroup
                value={form.D.pupilles}
                onChange={(v) => updateField('D', 'pupilles', v)}
                options={OUI_NON}
              />
              <TorchButton />
            </div>
          </FieldCard>
          <InlineCatBox items={getPupillesCat()} />
          <FieldCard label="Sensibilité / motricité mains" filled={!!form.D.sens_mains}>
            <ToggleGroup
              value={form.D.sens_mains}
              onChange={(v) => updateField('D', 'sens_mains', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getSensMainsCat()} />
          <FieldCard label="Sensibilité / motricité pieds" filled={!!form.D.sens_pieds}>
            <ToggleGroup
              value={form.D.sens_pieds}
              onChange={(v) => updateField('D', 'sens_pieds', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getSensPiedsCat()} />
          <FieldCard label="Glycémie" filled={!!form.D.glycemie}>
            <div className="flex flex-col gap-1">
              <InputBox
                value={form.D.glycemie}
                onChange={(v) => updateField('D', 'glycemie', v)}
                abnormal={isAbnormalField('glycemie', form.D.glycemie)}
                unit={form.D.glycemie ? detectGlycemieUnit(form.D.glycemie) : undefined}
                placeholder="Valeur"
                numeric="decimal"
              />
              {!form.D.glycemie && (
                <span className="text-xs text-neutral-600 italic">Détection d'unité automatique</span>
              )}
            </div>
          </FieldCard>
          <InlineCatBox items={getSimpleCat('glycemie', form.D.glycemie)} />
        </>
      );
    if (s === 'E')
      return (
        <>
          <FieldCard label="Température" filled={!!form.E.temperature}>
            <InputBox
              value={form.E.temperature}
              onChange={(v) => updateField('E', 'temperature', v)}
              abnormal={isAbnormalField('temperature', form.E.temperature)}
              unit="°C"
              numeric="decimal"
            />
          </FieldCard>
          <InlineCatBox items={getSimpleCat('temperature', form.E.temperature)} />
          <FieldCard label="Victime retrouvée au" filled={!!form.E.victime_env}>
            <ToggleGroup
              value={form.E.victime_env}
              onChange={(v) => updateField('E', 'victime_env', v)}
              options={ENV_OPTIONS}
            />
          </FieldCard>
          <InlineCatBox items={getVictimeFroidCat()} />
          <FieldCard label="Lésion cachée" filled={!!form.E.lesion}>
            <ToggleGroup
              value={form.E.lesion}
              onChange={(v) => updateField('E', 'lesion', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getLesionCat()} />
          <FieldCard label="Victime coincée / comprimée" filled={!!form.E.coince}>
            <ToggleGroup
              value={form.E.coince}
              onChange={(v) => {
                updateField('E', 'coince', v);
                if (v !== 'oui') {
                  updateField('E', 'coince_depuis', '');
                  updateField('E', 'coince_zone_choices', []);
                  updateField('E', 'coince_zone', '');
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getCoinceCat()} />
          {form.E.coince === 'oui' && (
            <>
              <FieldCard label="Depuis" filled={!!form.E.coince_depuis}>
                <InputBox
                  value={form.E.coince_depuis}
                  onChange={(v) => updateField('E', 'coince_depuis', v)}
                  placeholder="ex. 1h30"
                  width="w-28"
                />
              </FieldCard>
              <FieldCard
                label="Membre / zone"
                filled={form.E.coince_zone_choices.length > 0 || !!form.E.coince_zone}
              >
                <div className="flex flex-col gap-2">
                  <MultiToggleGroup
                    value={form.E.coince_zone_choices}
                    onChange={(v) => updateField('E', 'coince_zone_choices', v)}
                    options={COINCE_ZONE_OPTIONS}
                  />
                  <InputBox
                    value={form.E.coince_zone}
                    onChange={(v) => updateField('E', 'coince_zone', v)}
                    placeholder="Précision si besoin"
                    width="w-full"
                  />
                </div>
              </FieldCard>
            </>
          )}
        </>
      );
    if (s === 'BRULURE')
      return (
        <>
          <FieldCard label="Brûlure" filled={!!form.BRULURE.brulure}>
            <div className="flex flex-col gap-3 items-stretch">
              <ToggleGroup
                value={form.BRULURE.brulure}
                onChange={(v) => {
                  updateField('BRULURE', 'brulure', v);
                  if (v !== 'oui') {
                    updateField('BRULURE', 'brulure_degre', '');
                    updateField('BRULURE', 'brulure_zones', []);
                    updateField('BRULURE', 'brulure_etendue', '');
                    updateField('BRULURE', 'brulure_loc', '');
                    updateField('BRULURE', 'brulure_type', '');
                  }
                }}
                options={OUI_NON}
              />
              <InlineCatBox items={getBruleInitialCat()} />
              {form.BRULURE.brulure === 'oui' && (
                <div className="flex flex-col gap-4 pt-2 border-t border-neutral-800">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Degré</span>
                    <ToggleGroup
                      value={form.BRULURE.brulure_degre}
                      onChange={(v) => updateField('BRULURE', 'brulure_degre', v)}
                      options={BRULURE_DEGRE_OPTIONS}
                    />
                    <InlineCatBox items={getBruleDegreCat()} />
                  </div>
                  {form.BRULURE.brulure_degre && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">Type</span>
                      <ToggleGroup
                        value={form.BRULURE.brulure_type}
                        onChange={(v) => updateField('BRULURE', 'brulure_type', v)}
                        options={BRULURE_TYPE_OPTIONS}
                      />
                      <InlineCatBox items={getBruleTypeCat()} />
                    </div>
                  )}
                  {form.BRULURE.brulure_type && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">
                          Zones atteintes — règle des 9 de Wallace
                        </span>
                        <MultiToggleGroup
                          value={form.BRULURE.brulure_zones}
                          onChange={(zones) => {
                            updateField('BRULURE', 'brulure_zones', zones);
                            const total = zones.reduce((sum, z) => {
                              const zone = BRULURE_ZONES_9.find((zz) => zz.value === z);
                              return sum + (zone ? zone.pct : 0);
                            }, 0);
                            updateField('BRULURE', 'brulure_etendue', total > 0 ? String(total) : '');
                          }}
                          options={BRULURE_ZONE_OPTIONS}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">
                          Étendue totale (calculée, modifiable)
                        </span>
                        <InputBox
                          value={form.BRULURE.brulure_etendue}
                          onChange={(v) => updateField('BRULURE', 'brulure_etendue', v)}
                          unit="% SC"
                          placeholder="Valeur"
                          numeric
                        />
                        <span className="text-xs text-neutral-600 italic">
                          Règle de la paume : la paume de la victime (doigts compris) ≈ 1 % de sa
                          surface corporelle — pratique pour ajuster sur des brûlures dispersées ou
                          plus petites qu'une zone entière.
                        </span>
                        <InlineCatBox items={getBruleEtendueCat()} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">Localisation</span>
                        <MultiToggleGroup
                          value={form.BRULURE.brulure_loc_choices}
                          onChange={(v) => updateField('BRULURE', 'brulure_loc_choices', v)}
                          options={BRULURE_LOC_OPTIONS}
                        />
                        <InputBox
                          value={form.BRULURE.brulure_loc}
                          onChange={(v) => updateField('BRULURE', 'brulure_loc', v)}
                          placeholder="Précision si besoin"
                          width="w-full"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </FieldCard>
        </>
      );
    if (s === 'FAST')
      return (
        <>
          <FieldCard label="Face" filled={!!form.FAST.face}>
            <ToggleGroup
              value={form.FAST.face}
              onChange={(v) => updateField('FAST', 'face', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Arm (bras)" filled={!!form.FAST.arm}>
            <ToggleGroup
              value={form.FAST.arm}
              onChange={(v) => updateField('FAST', 'arm', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Speech (parole)" filled={!!form.FAST.speech}>
            <ToggleGroup
              value={form.FAST.speech}
              onChange={(v) => updateField('FAST', 'speech', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getFastCat()} />
          <FieldCard label="Heure d'apparition" filled={!!form.FAST.temps}>
            <InputBox
              value={form.FAST.temps}
              onChange={(v) => updateField('FAST', 'temps', v)}
              placeholder="hh:mm"
            />
          </FieldCard>
        </>
      );
    if (s === 'SAMPLER')
      return (
        <>
          <SamplerField
            letter="S"
            label="Signes et symptômes"
            value={form.SAMPLER.sampler_s}
            onChange={(v) => updateField('SAMPLER', 'sampler_s', v)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
              Douleur(s) — PQRST
            </span>
            <button
              onClick={addPqrst}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-1.5 rounded-md"
              style={{ backgroundColor: ACCENT, color: '#fff' }}
            >
              <Check size={13} /> Ajouter un PQRST
            </button>
          </div>
          {form.SAMPLER.pqrst_list.map((entry, idx) => (
            <div key={entry.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h4
                  className="text-sm font-bold uppercase tracking-wide text-neutral-300"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  PQRST {idx + 1}
                </h4>
                <button
                  onClick={() => removePqrst(entry.id)}
                  className="flex items-center gap-1 text-xs text-red-400 border border-neutral-800 rounded-md px-2 py-1 hover:border-red-800"
                >
                  <Trash2 size={13} /> Supprimer
                </button>
              </div>
              <PqrstRow
                letter="P"
                label="Provoqué / Palliatif"
                options={PQRST_P_OPTIONS}
                value={entry.p}
                onChange={(v) => updatePqrstField(entry.id, 'p', v)}
                textValue={entry.p_text}
                onTextChange={(v) => updatePqrstField(entry.id, 'p_text', v)}
              />
              <PqrstRow
                letter="Q"
                label="Qualité"
                options={PQRST_Q_OPTIONS}
                value={entry.q}
                onChange={(v) => updatePqrstField(entry.id, 'q', v)}
                textValue={entry.q_text}
                onTextChange={(v) => updatePqrstField(entry.id, 'q_text', v)}
              />
              <PqrstRow
                letter="R"
                label="Région / Irradiation"
                options={PQRST_R_OPTIONS}
                value={entry.r}
                onChange={(v) => updatePqrstField(entry.id, 'r', v)}
                textValue={entry.r_text}
                onTextChange={(v) => updatePqrstField(entry.id, 'r_text', v)}
              />
              <PqrstRow
                letter="S"
                label="Sévérité (EVA 0-10)"
                options={EVA_OPTIONS}
                value={entry.s}
                onChange={(v) => updatePqrstField(entry.id, 's', v)}
                textValue={entry.s_text}
                onTextChange={(v) => updatePqrstField(entry.id, 's_text', v)}
                multi={false}
              />
              <PqrstRow
                letter="T"
                label="Temps"
                options={PQRST_T_OPTIONS}
                value={entry.t}
                onChange={(v) => updatePqrstField(entry.id, 't', v)}
                textValue={entry.t_text}
                onTextChange={(v) => updatePqrstField(entry.id, 't_text', v)}
              />
            </div>
          ))}
          <SamplerField
            letter="A"
            label="Allergies"
            value={form.SAMPLER.sampler_a}
            onChange={(v) => updateField('SAMPLER', 'sampler_a', v)}
            choiceOptions={ALLERGY_OPTIONS}
            choiceValue={form.SAMPLER.sampler_a_choices}
            onChoiceChange={(v) => updateField('SAMPLER', 'sampler_a_choices', v)}
            choiceMulti
          />
          <SamplerField
            letter="M"
            label="Médicaments"
            value={form.SAMPLER.sampler_m}
            onChange={(v) => updateField('SAMPLER', 'sampler_m', v)}
          />
          <SamplerField
            letter="P"
            label="Passé médical"
            value={form.SAMPLER.sampler_p}
            onChange={(v) => updateField('SAMPLER', 'sampler_p', v)}
            choiceOptions={ANTECEDENTS_OPTIONS}
            choiceValue={form.SAMPLER.sampler_p_choices}
            onChoiceChange={(v) => updateField('SAMPLER', 'sampler_p_choices', v)}
            choiceMulti
          />
          <SamplerField
            letter="L"
            label="Dernier repas"
            value={form.SAMPLER.sampler_l}
            onChange={(v) => updateField('SAMPLER', 'sampler_l', v)}
            choiceOptions={REPAS_OPTIONS}
            choiceValue={form.SAMPLER.sampler_l_choice}
            onChoiceChange={(v) => updateField('SAMPLER', 'sampler_l_choice', v)}
          />
          <SamplerField
            letter="E"
            label="Événement"
            value={form.SAMPLER.sampler_e}
            onChange={(v) => updateField('SAMPLER', 'sampler_e', v)}
          />
          <SamplerField
            letter="R"
            label="Risques"
            value={form.SAMPLER.sampler_r}
            onChange={(v) => updateField('SAMPLER', 'sampler_r', v)}
          />
        </>
      );
    return (
      <div className="flex flex-col gap-4">
        <ExportButtons form={form} patientNum={patientNum} />
        <RecapView data={form} />
        {saved && (
          <div className="flex items-center gap-2 text-sm bg-neutral-900 border rounded-md px-3 py-2" style={{ borderColor: '#065F46', color: EMERALD }}>
            <Check size={16} /> Bilan n°{patientNum} enregistré à {savedAt}
          </div>
        )}
        {bilanDuration !== null && (
          <div className="flex items-center justify-between text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2">
            <span className="text-neutral-500">Durée du bilan</span>
            <span className="font-semibold text-neutral-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              {formatDuration(bilanDuration)}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!accepted) {
    return (
      <div
        className="h-screen w-full flex flex-col items-center justify-center bg-neutral-950 text-neutral-100 px-6"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap');
        `}</style>
        <div className="flex flex-col items-center gap-3 mb-8">
          <span
            className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-2xl font-bold"
            style={{ backgroundColor: ACCENT, fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            +
          </span>
          <h1
            className="text-2xl font-bold text-center"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            Bilan de l'équipier
          </h1>
        </div>
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <p className="text-sm text-neutral-300 leading-relaxed text-center">
            Cet outil est une aide à la documentation du bilan secouriste. Il ne remplace pas le
            protocole officiel ni le jugement clinique du secouriste.
          </p>
          <p className="text-xs text-neutral-500 leading-relaxed text-center border-t border-neutral-800 pt-4">
            Cette application est une propriété privée. Toute utilisation, reproduction ou
            diffusion non autorisée est strictement interdite.
          </p>
        </div>
        <button
          onClick={() => setAccepted(true)}
          className="mt-8 w-full max-w-sm py-3 rounded-md font-semibold text-base"
          style={{ backgroundColor: ACCENT, color: '#fff' }}
        >
          J'accepte
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-neutral-950 text-neutral-100" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .step-fade { animation: fadeIn 0.2s ease; }
      `}</style>

      <header className="border-b border-neutral-800 px-4 pt-4 pb-3 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-xs uppercase tracking-widest text-neutral-500"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              Bilan de l’équipier · Protocole ABCDE
            </div>
            <div className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              Bilan n°{patientNum}
              {form.TYPE.categorie && (
                <span className="text-sm font-normal text-neutral-500">
                  {' '}
                  · {PATIENT_CATEGORIES[form.TYPE.categorie].label}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-xs text-neutral-400 border border-neutral-800 rounded-md px-2.5 py-1.5 hover:border-neutral-600"
          >
            <History size={14} /> Historique{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className="flex-1 h-1.5 rounded-full"
              style={{ backgroundColor: i <= step ? ACCENT : '#292929' }}
            />
          ))}
        </div>
        <div className="text-xs text-neutral-500 -mt-1">
          Étape {step + 1}/{STEPS.length} ·{' '}
          <span className="text-neutral-100 font-semibold">
            {PAGE_TITLES[STEPS[step]] || STEPS[step]}
          </span>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div key={step} className="step-fade flex flex-col gap-3">
          {renderStepContent()}
        </div>
      </main>

      <footer className="border-t border-neutral-800 px-4 py-3 flex gap-3 shrink-0">
        {STEPS[step] !== 'RECAP' ? (
          <>
            <button
              disabled={step === 0}
              onClick={goPrev}
              className="flex items-center gap-1 px-4 py-2.5 rounded-md border border-neutral-800 text-neutral-300 disabled:opacity-30"
            >
              <ChevronLeft size={16} /> Précédent
            </button>
            <button
              onClick={goNext}
              style={{ backgroundColor: ACCENT }}
              className="flex-1 flex items-center justify-center gap-1 px-4 py-2.5 rounded-md text-white font-semibold"
            >
              Suivant <ChevronRight size={16} />
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex gap-3">
              <button
                onClick={goPrev}
                className="flex items-center gap-1 px-4 py-2.5 rounded-md border border-neutral-800 text-neutral-300"
              >
                <ChevronLeft size={16} /> Modifier
              </button>
              <button
                onClick={newBilan}
                className="flex-1 flex items-center justify-center gap-1 px-4 py-2.5 rounded-md border border-neutral-800 text-neutral-300"
              >
                <RotateCcw size={16} /> Nouveau bilan
              </button>
            </div>
            {!saved && (
              <button
                onClick={saveBilan}
                style={{ backgroundColor: ACCENT }}
                className="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-md text-white font-semibold"
              >
                <Save size={16} /> Enregistrer le bilan
              </button>
            )}
          </div>
        )}
      </footer>

      {showHistory && (
        <div
          className="fixed inset-0 flex items-end sm:items-center sm:justify-center z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => {
            setShowHistory(false);
            setViewing(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-neutral-950 border border-neutral-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg overflow-y-auto p-4"
            style={{ maxHeight: '85vh' }}
          >
            {!viewing ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    Historique des bilans
                  </h2>
                  <div className="flex items-center gap-3">
                    {history.length > 0 && (
                      <button
                        onClick={clearHistory}
                        className="flex items-center gap-1 text-xs text-red-400 border border-neutral-800 rounded-md px-2 py-1 hover:border-red-800"
                      >
                        <Trash2 size={13} /> Effacer
                      </button>
                    )}
                    <button onClick={() => setShowHistory(false)}>
                      <X size={18} />
                    </button>
                  </div>
                </div>
                {loadingHistory ? (
                  <p className="text-neutral-500 text-sm">Chargement…</p>
                ) : history.length === 0 ? (
                  <p className="text-neutral-500 text-sm">Aucun bilan enregistré.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {history.map((rec) => (
                      <button
                        key={rec.id}
                        onClick={() => setViewing(rec)}
                        className="text-left bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5 flex items-center justify-between hover:border-neutral-600"
                      >
                        <span className="font-semibold text-sm">Bilan n°{rec.patientNum}</span>
                        <span className="text-xs text-neutral-500" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          {rec.date} · {rec.heure}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                      Bilan n°{viewing.patientNum}
                    </h2>
                    <p className="text-xs text-neutral-500" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {viewing.date} · {viewing.heure}
                    </p>
                  </div>
                  <button onClick={() => setViewing(null)}>
                    <ChevronLeft size={18} />
                  </button>
                </div>
                <RecapView data={viewing.data} />
              </>
            )}
          </div>
        </div>
      )}

      <O2AlarmModal active={o2AlarmActive} remaining={o2RemainingMin} onStop={stopO2Alarm} />
    </div>
  );
}
