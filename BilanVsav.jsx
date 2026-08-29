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
  spo2: { low: { title: 'SpO2 — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' } },
  fr: {
    low: { title: 'Fréquence respiratoire — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes de détresse, réévaluer et se référer au protocole / référentiel utilisé.' },
    high: { title: 'Fréquence respiratoire — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes de détresse, réévaluer et se référer au protocole / référentiel utilisé.' },
  },
  fc: {
    low: { title: 'Fréquence cardiaque — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
    high: { title: 'Fréquence cardiaque — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
  },
  pa_sys: {
    low: { title: 'Pression artérielle — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Contrôler la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
    high: { title: 'Pression artérielle — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Contrôler la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
  },
  temperature: {
    low: { title: 'Température — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
    high: { title: 'Température — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
  },
  glycemie: {
    low: { title: 'Glycémie — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
    high: { title: 'Glycémie — point d’attention', message: 'Valeur en dehors de la plage paramétrée. Vérifier la mesure, rechercher les signes associés, réévaluer et se référer au protocole / référentiel utilisé.' },
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
const POSITIF_NEGATIF = [{ value: 'positif', label: 'Positif' }, { value: 'negatif', label: 'Négatif' }];
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

const AMPUTATION_TYPE_OPTIONS = [
  { value: 'complete', label: 'Complète' },
  { value: 'partielle', label: 'Partielle' },
];

const AMPUTATION_MEMBRE_OPTIONS = [
  { value: 'superieur', label: 'Membre supérieur' },
  { value: 'inferieur', label: 'Membre inférieur' },
];

const AMPUTATION_LOC_SUPERIEUR_OPTIONS = [
  { value: 'main', label: 'Main' },
  { value: 'doigt', label: 'Doigt' },
  { value: 'avant_bras', label: 'Avant-bras' },
  { value: 'bras', label: 'Bras' },
];

const AMPUTATION_LOC_INFERIEUR_OPTIONS = [
  { value: 'pied', label: 'Pied' },
  { value: 'orteil', label: 'Orteil' },
  { value: 'jambe', label: 'Jambe' },
  { value: 'cuisse', label: 'Cuisse' },
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

const HYPERTHERMIE_SIGNS = [
  { value: 'cephalees', label: 'Céphalées' },
  { value: 'peau_seche_rouge_chaude', label: 'Peau sèche, rouge, très chaude' },
  { value: 'nausees_vomissements', label: 'Nausées, vomissements' },
  { value: 'vertiges_photophobie', label: 'Vertiges et photophobie' },
  { value: 'troubles_comportement', label: 'Troubles du comportement' },
  { value: 'somnolence', label: 'Somnolence' },
  { value: 'aucun', label: 'Pas de signe associé' },
];

const HYPERTHERMIE_CAT_STEPS = [
  "Installer la victime dans un endroit frais, à l'ombre.",
  "Respecter la position qu'elle adopte spontanément.",
  'Déshabiller la victime complètement si possible (sauf les sous-vêtements).',
  "Refroidir en ventilant, en pulvérisant de l'eau à température ambiante ou en appliquant un linge humide (champ américain humide sur le corps, draps, vêtement…).",
  "Donner à boire, de l'eau, par petites gorgées si la victime est consciente.",
  "Placer de la glace, dans un linge, au niveau des aisselles et du pli de l'aine, tête et nuque.",
];

// Une valeur est considérée "hors seuil" pour le repérage d'hyperthermie si elle est
// renseignée ET dépasse le seuil — une case vide n'est jamais comptée comme un signe.
function isPastThreshold(rawValue, compare) {
  if (!rawValue) return false;
  const num = parseFloat(String(rawValue).replace(',', '.'));
  if (isNaN(num)) return false;
  return compare(num);
}

function isHyperthermieDetected(form) {
  if (form.E.victime_env !== 'chaud') return false;
  const tempHigh = isPastThreshold(form.E.temperature, (n) => n >= 39);
  const frHigh = isPastThreshold(form.B.fr, (n) => n > 30);
  const spo2Low = isPastThreshold(form.B.spo2_air, (n) => n < 94);
  const fcHigh = isPastThreshold(form.C.fc, (n) => n > 100);
  const taLow =
    isPastThreshold(form.C.pa_gauche_sys, (n) => n < 90) ||
    isPastThreshold(form.C.pa_droite_sys, (n) => n < 90);
  // Au moins 3 des 5 conditions doivent être réunies (hors signes associés).
  const count = [tempHigh, frHigh, spo2Low, fcHigh, taLow].filter(Boolean).length;
  return count >= 3;
}

const ALLERGY_STATUS_OPTIONS = [
  { value: 'aucune', label: 'Aucune connue' },
  { value: 'oui', label: 'Oui' },
  { value: 'inconnu', label: 'Inconnu' },
];

const ALLERGY_OPTIONS = [
  { value: 'antibiotique', label: 'Antibiotique' },
  { value: 'antalgique_ains_allergie', label: 'Antalgique / AINS' },
  { value: 'anesthesique', label: 'Anesthésique' },
  { value: 'autre_medicament_allergie', label: 'Autre médicament' },
  { value: 'fruits_coque', label: 'Fruits à coque' },
  { value: 'crustaces', label: 'Crustacés' },
  { value: 'oeuf', label: 'Œuf' },
  { value: 'lait', label: 'Lait' },
  { value: 'autre_aliment', label: 'Autre aliment' },
  { value: 'insecte', label: "Piqûre d'insecte" },
  { value: 'latex', label: 'Latex' },
  { value: 'produit_chimique', label: 'Produit chimique' },
  { value: 'autre_environnement', label: 'Autre' },
];

const ALLERGY_GROUPS = [
  { title: 'Médicaments', values: ['antibiotique', 'antalgique_ains_allergie', 'anesthesique', 'autre_medicament_allergie'] },
  { title: 'Aliments', values: ['fruits_coque', 'crustaces', 'oeuf', 'lait', 'autre_aliment'] },
  { title: 'Environnement / contact', values: ['insecte', 'latex', 'produit_chimique', 'autre_environnement'] },
];

const ALLERGY_REACTION_OPTIONS = [
  { value: 'urticaire', label: 'Urticaire' },
  { value: 'oedeme', label: 'Œdème' },
  { value: 'gene_respiratoire', label: 'Gêne respiratoire' },
  { value: 'anaphylaxie', label: 'Réaction anaphylactique / choc' },
  { value: 'digestive', label: 'Troubles digestifs' },
  { value: 'inconnue', label: 'Réaction inconnue' },
];

const ANTECEDENTS_OPTIONS = [
  { value: 'hta', label: 'HTA' },
  { value: 'cardiopathie', label: 'Cardiopathie' },
  { value: 'infarctus_sca', label: 'Infarctus / syndrome coronarien' },
  { value: 'trouble_rythme', label: 'Trouble du rythme' },
  { value: 'insuffisance_cardiaque', label: 'Insuffisance cardiaque' },
  { value: 'avc_ait', label: 'AVC / AIT' },
  { value: 'epilepsie', label: 'Épilepsie' },
  { value: 'neurologique', label: 'Autre maladie neurologique' },
  { value: 'asthme', label: 'Asthme' },
  { value: 'bpco', label: 'BPCO' },
  { value: 'respiratoire', label: 'Autre maladie respiratoire' },
  { value: 'diabete', label: 'Diabète' },
  { value: 'insuffisance_renale', label: 'Insuffisance rénale' },
  { value: 'dyslipidemie', label: 'Dyslipidémie' },
  { value: 'cancer', label: 'Cancer' },
  { value: 'immunodepression', label: 'Immunodépression' },
  { value: 'grossesse', label: 'Grossesse' },
  { value: 'post_partum', label: 'Post-partum' },
  { value: 'chirurgie_recente', label: 'Chirurgie récente' },
  { value: 'hospitalisation_recente', label: 'Hospitalisation récente' },
  { value: 'autre', label: 'Autre antécédent' },
  { value: 'aucun', label: 'Aucun antécédent connu' },
];

const ANTECEDENTS_GROUPS = [
  { title: 'Cardiovasculaire', values: ['hta', 'cardiopathie', 'infarctus_sca', 'trouble_rythme', 'insuffisance_cardiaque'] },
  { title: 'Neurologique', values: ['avc_ait', 'epilepsie', 'neurologique'] },
  { title: 'Respiratoire', values: ['asthme', 'bpco', 'respiratoire'] },
  { title: 'Métabolique / rénal', values: ['diabete', 'insuffisance_renale', 'dyslipidemie'] },
  { title: 'Cancer / immunité', values: ['cancer', 'immunodepression'] },
  { title: 'Grossesse / gynéco', values: ['grossesse', 'post_partum'] },
  { title: 'Hospitalisation / chirurgie', values: ['chirurgie_recente', 'hospitalisation_recente', 'autre'] },
];

const REPAS_OPTIONS = [
  { value: 'moins_2h', label: '< 2 h' },
  { value: '2_6h', label: '2 à 6 h' },
  { value: '6_12h', label: '6 à 12 h' },
  { value: 'plus_12h', label: '> 12 h' },
  { value: 'inconnu', label: 'Inconnu' },
];

const PRISE_ORALE_NATURE_OPTIONS = [
  { value: 'repas', label: 'Repas' },
  { value: 'collation', label: 'Collation' },
  { value: 'boisson', label: 'Eau / boisson' },
  { value: 'alcool', label: 'Alcool' },
  { value: 'medicament', label: 'Médicament' },
  { value: 'autre', label: 'Substance / autre' },
];

const PRISE_ORALE_GROUPS = [
  { title: 'Alimentation', values: ['repas', 'collation'] },
  { title: 'Boissons', values: ['boisson', 'alcool'] },
  { title: 'Médicaments / autres prises', values: ['medicament', 'autre'] },
];

const MEDICAMENT_OPTIONS = [
  { value: 'anticoagulant', label: 'Anticoagulant' },
  { value: 'antiagregant', label: 'Antiagrégant' },
  { value: 'antihypertenseur', label: 'Antihypertenseur' },
  { value: 'cardiaque', label: 'Traitement cardiaque' },
  { value: 'antidiabetique', label: 'Antidiabétique oral' },
  { value: 'insuline', label: 'Insuline' },
  { value: 'antiepileptique', label: 'Antiépileptique' },
  { value: 'anxiolytique', label: 'Anxiolytique' },
  { value: 'antidepresseur', label: 'Antidépresseur' },
  { value: 'autre_psychotrope', label: 'Autre psychotrope' },
  { value: 'bronchodilatateur', label: 'Bronchodilatateur' },
  { value: 'respiratoire', label: 'Traitement respiratoire' },
  { value: 'corticoide_inhale', label: 'Corticoïde inhalé' },
  { value: 'antalgique', label: 'Antalgique' },
  { value: 'anti_inflammatoire', label: 'Anti-inflammatoire' },
  { value: 'corticoides', label: 'Corticoïde' },
  { value: 'hormonal', label: 'Contraception / hormonal' },
  { value: 'traitement_chronique_autre', label: 'Traitement chronique autre' },
  { value: 'autre', label: 'Autre médicament' },
  { value: 'aucun', label: 'Aucun traitement connu' },
];

const MEDICAMENT_GROUPS = [
  { title: 'Cardio / vasculaire', values: ['anticoagulant', 'antiagregant', 'antihypertenseur', 'cardiaque'] },
  { title: 'Diabète', values: ['antidiabetique', 'insuline'] },
  { title: 'Neurologique / psychiatrique', values: ['antiepileptique', 'anxiolytique', 'antidepresseur', 'autre_psychotrope'] },
  { title: 'Respiratoire', values: ['bronchodilatateur', 'respiratoire', 'corticoide_inhale'] },
  { title: 'Douleur / inflammation', values: ['antalgique', 'anti_inflammatoire', 'corticoides'] },
  { title: 'Autres traitements', values: ['hormonal', 'traitement_chronique_autre', 'autre'] },
];

const TRAITEMENT_PRIS_OPTIONS = [
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
  { value: 'inconnu', label: 'Inconnu' },
];

const EVENEMENT_OPTIONS = [
  { value: 'chute_traumatisme', label: 'Chute / traumatisme' },
  { value: 'accident_circulation', label: 'Accident de circulation' },
  { value: 'agression', label: 'Agression' },
  { value: 'effort', label: 'Effort' },
  { value: 'activite_sportive', label: 'Activité sportive' },
  { value: 'travail', label: 'Travail' },
  { value: 'debut_spontane', label: 'Début spontané' },
  { value: 'repos_sommeil', label: 'Repos / sommeil' },
  { value: 'exposition_chaleur', label: 'Chaleur' },
  { value: 'exposition_froid', label: 'Froid' },
  { value: 'incendie_fumees', label: 'Incendie / fumées' },
  { value: 'exposition_toxique_produit', label: 'Exposition toxique / produit' },
  { value: 'electrisation', label: 'Électrisation' },
  { value: 'immersion_noyade', label: 'Immersion / noyade' },
  { value: 'repas', label: 'Repas' },
  { value: 'medicament_substance', label: 'Prise de médicament / substance' },
  { value: 'piqure_morsure', label: 'Piqûre / morsure' },
  { value: 'stress_emotion', label: 'Stress / émotion' },
  { value: 'apres_chirurgie', label: 'Après intervention / chirurgie' },
  { value: 'voyage_prolonge', label: 'Voyage / déplacement prolongé' },
  { value: 'autre', label: 'Autre' },
];

const EVENEMENT_GROUPS = [
  { title: 'Traumatisme / accident', values: ['chute_traumatisme', 'accident_circulation', 'agression'] },
  { title: 'Effort / activité', values: ['effort', 'activite_sportive', 'travail'] },
  { title: 'Repos / circonstance spontanée', values: ['debut_spontane', 'repos_sommeil'] },
  {
    title: 'Environnement',
    values: ['exposition_chaleur', 'exposition_froid', 'incendie_fumees', 'exposition_toxique_produit', 'electrisation', 'immersion_noyade'],
  },
  { title: 'Ingestion / exposition biologique', values: ['repas', 'medicament_substance', 'piqure_morsure'] },
  { title: 'Contexte particulier', values: ['stress_emotion', 'apres_chirurgie', 'voyage_prolonge', 'autre'] },
];

const RISQUE_OPTIONS = [
  { value: 'tabac', label: 'Tabac' },
  { value: 'alcool', label: 'Alcool chronique' },
  { value: 'drogues', label: 'Drogues / substances' },
  { value: 'diabete', label: 'Diabète' },
  { value: 'hta', label: 'HTA' },
  { value: 'dyslipidemie', label: 'Dyslipidémie' },
  { value: 'obesite', label: 'Obésité' },
  { value: 'cancer_connu', label: 'Cancer' },
  { value: 'antecedents_cardio_familiaux', label: 'Antécédents cardio familiaux' },
  { value: 'immobilisation_recente', label: 'Immobilisation' },
  { value: 'chirurgie_recente', label: 'Chirurgie récente' },
  { value: 'hospitalisation_recente', label: 'Hospitalisation récente' },
  { value: 'voyage_prolonge', label: 'Voyage prolongé' },
  { value: 'grossesse', label: 'Grossesse' },
  { value: 'post_partum', label: 'Post-partum' },
  { value: 'contraception_hormonale', label: 'Contraception hormonale' },
  { value: 'traitement_hormonal', label: 'Traitement hormonal' },
  { value: 'autre', label: 'Autre facteur de risque' },
];

const RISQUE_GROUPS = [
  { title: 'Cardiovasculaires', values: ['hta', 'diabete', 'dyslipidemie', 'obesite', 'antecedents_cardio_familiaux'] },
  { title: 'Habitudes / toxiques', values: ['tabac', 'alcool', 'drogues'] },
  { title: 'Thromboemboliques / immobilisation', values: ['immobilisation_recente', 'chirurgie_recente', 'hospitalisation_recente', 'voyage_prolonge'] },
  { title: 'Hormonal / grossesse', values: ['grossesse', 'post_partum', 'contraception_hormonale', 'traitement_hormonal'] },
  { title: 'Autres terrains', values: ['cancer_connu', 'autre'] },
];

const DEPUIS_DUREE_OPTIONS = [
  { value: '6h', label: '6h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '48h', label: '48h' },
  { value: '72h', label: '72h' },
];

const FAST_TEMPS_CHOICE_OPTIONS = [
  { value: '+24h', label: '+ 24h' },
  { value: '+48h', label: '+ 48h' },
];

const PQRST_P_AGGRAVE_OPTIONS = [
  { value: 'effort', label: 'Effort' },
  { value: 'inspiration', label: 'Inspiration' },
  { value: 'toux', label: 'Toux' },
  { value: 'palpation', label: 'Palpation' },
  { value: 'mobilisation', label: 'Mobilisation' },
  { value: 'position', label: 'Position' },
  { value: 'repas', label: 'Repas' },
  { value: 'autre', label: 'Autre' },
  { value: 'rien', label: 'Rien identifié' },
];

const PQRST_P_SOULAGE_OPTIONS = [
  { value: 'repos', label: 'Repos' },
  { value: 'position', label: 'Position' },
  { value: 'traitement', label: 'Traitement' },
  { value: 'immobilisation', label: 'Immobilisation' },
  { value: 'autre', label: 'Autre' },
  { value: 'rien', label: 'Rien' },
];

const PQRST_Q_OPTIONS = [
  { value: 'brulure', label: 'Brûlure' },
  { value: 'serrement', label: 'Serrement' },
  { value: 'oppression', label: 'Oppression' },
  { value: 'poignard', label: 'Coup de poignard' },
  { value: 'piqure', label: 'Piqûre' },
  { value: 'elancement', label: 'Élancement' },
  { value: 'pincement', label: 'Pincement' },
  { value: 'tiraillement', label: 'Tiraillement' },
  { value: 'pulsatile', label: 'Pulsatile' },
  { value: 'crampe', label: 'Crampes' },
  { value: 'pesanteur', label: 'Pesanteur' },
  { value: 'diffuse', label: 'Diffuse' },
  { value: 'indefinissable', label: 'Indéfinissable' },
  { value: 'autre', label: 'Autre' },
];

const PQRST_REGION_OPTIONS = [
  { value: 'thorax', label: 'Thorax' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'tete', label: 'Tête' },
  { value: 'dos', label: 'Dos' },
  { value: 'cou', label: 'Cou' },
  { value: 'epaule', label: 'Épaule' },
  { value: 'bras_gauche', label: 'Bras gauche' },
  { value: 'bras_droit', label: 'Bras droit' },
  { value: 'membre_inferieur', label: 'Membre inférieur' },
  { value: 'autre', label: 'Autre' },
];

const PQRST_IRRADIATION_OPTIONS = [
  { value: 'aucune', label: 'Aucune' },
  { value: 'bras_gauche', label: 'Bras gauche' },
  { value: 'bras_droit', label: 'Bras droit' },
  { value: 'deux_bras', label: 'Deux bras' },
  { value: 'epaule', label: 'Épaule' },
  { value: 'machoire', label: 'Mâchoire' },
  { value: 'cou', label: 'Cou' },
  { value: 'dos', label: 'Dos' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'autre', label: 'Autre' },
];

const EVS_OPTIONS = [
  { value: 'faible', label: 'Faible' },
  { value: 'moderee', label: 'Modérée' },
  { value: 'intense', label: 'Intense' },
  { value: 'tres_intense', label: 'Très intense' },
];

const PQRST_T_UNITE_OPTIONS = [
  { value: 'min', label: 'min' },
  { value: 'h', label: 'h' },
  { value: 'jours', label: 'jours' },
];
const PQRST_T_DEBUT_OPTIONS = [
  { value: 'brutal', label: 'Brutal' },
  { value: 'progressif', label: 'Progressif' },
];
const PQRST_T_EVOLUTION_OPTIONS = [
  { value: 'stable', label: 'Stable' },
  { value: 'aggravation', label: 'Aggravation' },
  { value: 'amelioration', label: 'Amélioration' },
];
const PQRST_T_TEMPORALITE_OPTIONS = [
  { value: 'continue', label: 'Continue' },
  { value: 'intermittente', label: 'Intermittente' },
];
const PQRST_T_SIMILAIRE_OPTIONS = [
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
  { value: 'inconnu', label: 'Inconnu' },
];

const PQRST_ELIGIBLE_SYMPTOMS = new Set(['douleur', 'douleur_thoracique', 'douleur_abdominale', 'cephalees', 'palpitations']);

// Regroupement thématique des symptômes pour l'affichage en accordéons
const SYMPTOME_GROUPS = [
  { title: 'Douleurs', values: ['douleur', 'douleur_thoracique', 'douleur_abdominale', 'cephalees'] },
  { title: 'Digestif', values: ['nausees', 'vomissements', 'diarrhee', 'difficulte_avaler'] },
  { title: 'Respiratoire', values: ['gene_respiratoire', 'toux'] },
  {
    title: 'Neurologique',
    values: [
      'vertiges',
      'troubles_visuels',
      'fourmillements',
      'perte_sensibilite',
      'trouble_parole',
      'faiblesse_membre',
      'convulsions_rapportees',
      'pc_rapportee',
    ],
  },
  { title: 'Cardio / circulatoire', values: ['palpitations', 'malaise_faiblesse', 'sueurs'] },
  { title: 'Général', values: ['fievre_frissons', 'saignement', 'eruption_urticaire', 'agitation'] },
];
const SYMPTOME_OPTIONS = [
  { value: 'douleur', label: 'Douleur' },
  { value: 'douleur_thoracique', label: 'Douleur thoracique' },
  { value: 'douleur_abdominale', label: 'Douleur abdominale' },
  { value: 'cephalees', label: 'Céphalées' },
  { value: 'palpitations', label: 'Palpitations' },
  { value: 'gene_respiratoire', label: 'Gêne respiratoire / essoufflement' },
  { value: 'malaise_faiblesse', label: 'Malaise / faiblesse' },
  { value: 'vertiges', label: 'Vertiges' },
  { value: 'nausees', label: 'Nausées' },
  { value: 'vomissements', label: 'Vomissements' },
  { value: 'toux', label: 'Toux' },
  { value: 'troubles_visuels', label: 'Troubles visuels' },
  { value: 'fourmillements', label: 'Fourmillements' },
  { value: 'perte_sensibilite', label: 'Perte de sensibilité' },
  { value: 'trouble_parole', label: 'Trouble de la parole' },
  { value: 'faiblesse_membre', label: "Faiblesse d’un membre" },
  { value: 'convulsions_rapportees', label: 'Convulsions rapportées' },
  { value: 'pc_rapportee', label: 'Perte de connaissance rapportée' },
  { value: 'fievre_frissons', label: 'Fièvre / frissons' },
  { value: 'difficulte_avaler', label: 'Difficulté à avaler' },
  { value: 'saignement', label: 'Saignement' },
  { value: 'diarrhee', label: 'Diarrhée' },
  { value: 'eruption_urticaire', label: 'Éruption / urticaire' },
  { value: 'sueurs', label: 'Sueurs' },
  { value: 'agitation', label: 'Agitation' },
  { value: 'somnolence', label: 'Somnolence' },
  { value: 'sensation_froid', label: 'Sensation de froid' },
  { value: 'sensation_chaleur', label: 'Sensation de chaleur' },
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
  fr_signes_heure: "Heure d'apparition (respiratoire)",
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
  signes_heure: "Heure d'apparition (circulatoire)",
  blood_box: 'Blood box — hémorragie interne suspectée',
  hemorragie: 'Hémorragie',
  collier_pose: 'Pose collier',
  hemorragie_sites: 'Localisation(s) hémorragie',
  garrot_pose: 'Pose garrot',
  garrot_heure: 'Heure de pose du garrot',
  pci: 'PCI',
  pc_repete: 'PC à répétition',
  pc_nombre: 'Nombre de fois',
  etat: 'État de conscience',
  orientation: 'Orientation temps-espace',
  neuro_signes: 'Signes associés',
  neuro_signes_depuis_choice: 'Signes présents depuis',
  neuro_signes_depuis_heure: 'Heure de début des signes',
  pci_duree: 'Durée de la PCI',
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
  cooling_done: 'Refroidissement déjà effectué',
  cooling_duration_min: 'Durée du refroidissement',
  brulure_loc_choices: 'Zone(s) brûlée(s)',
  brulure_loc: 'Localisation brûlure (détail)',
  brulure_type: 'Type de brûlure',
  lesion: 'Lésion cachée',
  victime_env_signes: 'Signes associés (hyperthermie)',
  coince: 'Victime coincée / comprimée',
  coince_depuis: "Heure d'apparition / début de compression",
  coince_zone_choices: 'Membre / zone coincé(e)',
  coince_zone: 'Membre / zone (détail)',
  amputation: 'Amputation',
  amputation_type: 'Type d\u2019amputation',
  amputation_membre: 'Membre concerné',
  amputation_localisation: 'Localisation',
  amputation_hemorragie: 'Hémorragie associée',
  amputation_garrot: 'Garrot',
  amputation_garrot_heure: 'Heure de pose du garrot',
  amputation_segment_retrouve: 'Segment amputé retrouvé',
  amputation_conditionnement: 'Conditionnement du segment',
  face: 'Face',
  arm: 'Arm (bras)',
  speech: 'Speech (parole)',
  temps: "Heure d'apparition",
  temps_choice: "Délai d'apparition",
  symptom_choices: 'S — Signes et symptômes',
  symptom_other: 'S — Autre symptôme / précision',
  allergy_status: 'A — Allergies connues',
  allergy_reactions: 'A — Réaction connue',
  meds_taken_today: 'M — Traitement pris aujourd’hui',
  sampler_l_time: 'L — Heure de la dernière prise orale',
  sampler_l_nature: 'L — Nature de la prise',
  sampler_e_time: 'E — Heure de l’événement',
  sampler_a_choices: "A — Type d'allergie",
  sampler_a: 'A — Allergies (détail)',
  sampler_m_choices: 'M — Traitements en cours',
  sampler_m: 'M — Médicaments',
  sampler_p_choices: 'P — Antécédents',
  sampler_p: 'P — Passé médical (détail)',
  sampler_l_choice: 'L — Moment du dernier repas',
  sampler_l: 'L — Dernier repas (détail)',
  sampler_e_choices: 'E — Type d\u2019événement',
  sampler_e: 'E — Événement',
  sampler_r_choices: 'R — Facteurs de risque',
  sampler_r: 'R — Risques',
};

const PAGE_FIELDS = {
  TYPE: ['commentaire'],
  X: ['trauma', 'collier_pose', 'hemorragie', 'hemorragie_sites', 'garrot_pose', 'garrot_heure'],
  A: ['obstruction'],
  B: ['fr', 'fr_ample', 'fr_reguliere', 'fr_signes', 'fr_signes_heure', 'spo2_air', 'spo2_o2', 'o2_debit'],
  C: ['fc', 'pa_gauche', 'pa_droite', 'pouls_sym', 'pouls_frappe', 'trc', 'signes', 'signes_heure', 'blood_box'],
  D: ['pci', 'pci_duree', 'pc_repete', 'pc_nombre', 'etat', 'orientation', 'neuro_signes', 'neuro_signes_depuis_choice', 'neuro_signes_depuis_heure', 'pupilles', 'sens_mains', 'sens_pieds', 'glycemie'],
  E: [
    'temperature',
    'victime_env',
    'victime_env_signes',
    'lesion',
    'coince',
    'coince_depuis',
    'coince_zone_choices',
    'coince_zone',
    'amputation',
    'amputation_type',
    'amputation_membre',
    'amputation_localisation',
    'amputation_hemorragie',
    'amputation_garrot',
    'amputation_garrot_heure',
    'amputation_segment_retrouve',
    'amputation_conditionnement',
  ],
  BRULURE: ['brulure', 'brulure_degre', 'brulure_type', 'brulure_zones', 'brulure_etendue', 'brulure_loc_choices', 'brulure_loc', 'cooling_done', 'cooling_duration_min'],
  FAST: ['face', 'arm', 'speech', 'temps', 'temps_choice'],
  SAMPLER: [
    'symptom_choices', 'symptom_other',
    'allergy_status', 'sampler_a_choices', 'allergy_reactions', 'sampler_a',
    'sampler_m_choices', 'sampler_m', 'meds_taken_today',
    'sampler_p_choices', 'sampler_p',
    'sampler_l_time', 'sampler_l_choice', 'sampler_l_nature', 'sampler_l',
    'sampler_e_choices', 'sampler_e_time', 'sampler_e',
    'sampler_r_choices', 'sampler_r',
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
  pci_duree: 'min',
  glycemie: 'g/L',
  temperature: '°C',
  pa_gauche: 'mmHg',
  pa_droite: 'mmHg',
  brulure_etendue: '% SC',
  cooling_duration_min: 'min',
};

// Formate automatiquement une saisie de chiffres en heure:minute (ex. "1430" -> "14:30")
function formatTimeInput(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

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
  cooling_done: optsToLabels([{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }, { value: 'inconnu', label: 'Inconnu' }]),
  brulure_zones: optsToLabels(BRULURE_ZONE_OPTIONS),
  symptom_choices: optsToLabels(SYMPTOME_OPTIONS),
  allergy_status: optsToLabels(ALLERGY_STATUS_OPTIONS),
  sampler_a_choices: optsToLabels(ALLERGY_OPTIONS),
  allergy_reactions: optsToLabels(ALLERGY_REACTION_OPTIONS),
  sampler_p_choices: optsToLabels(ANTECEDENTS_OPTIONS),
  sampler_l_choice: optsToLabels(REPAS_OPTIONS),
  sampler_l_nature: optsToLabels(PRISE_ORALE_NATURE_OPTIONS),
  sampler_m_choices: optsToLabels(MEDICAMENT_OPTIONS),
  meds_taken_today: optsToLabels(TRAITEMENT_PRIS_OPTIONS),
  sampler_e_choices: optsToLabels(EVENEMENT_OPTIONS),
  sampler_r_choices: optsToLabels(RISQUE_OPTIONS),
  neuro_signes_depuis_choice: optsToLabels(DEPUIS_DUREE_OPTIONS),
  temps_choice: optsToLabels(FAST_TEMPS_CHOICE_OPTIONS),
  fr_signes: optsToLabels(BREATH_SIGNS),
  pouls_sym: optsToLabels(OUI_NON),
  pouls_frappe: optsToLabels(OUI_NON),
  trc: optsToLabels(TRC_OPTIONS),
  signes: optsToLabels(CIRC_SIGNS),
  blood_box: optsToLabels(BLOOD_BOX_OPTIONS),
  brulure_loc_choices: optsToLabels(BRULURE_LOC_OPTIONS),
  hemorragie: optsToLabels(OUI_NON),
  collier_pose: optsToLabels(OUI_NON),
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
  victime_env_signes: optsToLabels(HYPERTHERMIE_SIGNS),
  coince: optsToLabels(OUI_NON),
  coince_zone_choices: optsToLabels(COINCE_ZONE_OPTIONS),
  amputation: optsToLabels(OUI_NON),
  amputation_type: optsToLabels(AMPUTATION_TYPE_OPTIONS),
  amputation_membre: optsToLabels(AMPUTATION_MEMBRE_OPTIONS),
  amputation_localisation: optsToLabels([...AMPUTATION_LOC_SUPERIEUR_OPTIONS, ...AMPUTATION_LOC_INFERIEUR_OPTIONS]),
  amputation_hemorragie: optsToLabels(OUI_NON),
  amputation_garrot: optsToLabels(OUI_NON),
  amputation_segment_retrouve: optsToLabels(OUI_NON),
  amputation_conditionnement: optsToLabels(OUI_NON),
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
    collier_pose: '',
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
    fr_signes_heure: '',
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
    signes_heure: '',
    blood_box: [],
  },
  D: {
    pci: '',
    pci_duree: '',
    pc_repete: '',
    pc_nombre: '',
    etat: '',
    orientation: '',
    neuro_signes: [],
    neuro_signes_depuis_choice: '',
    neuro_signes_depuis_heure: '',
    pupilles: '',
    sens_mains: '',
    sens_pieds: '',
    glycemie: '',
  },
  E: {
    temperature: '',
    victime_env: '',
    victime_env_signes: [],
    lesion: '',
    coince: '',
    coince_depuis: '',
    coince_zone_choices: [],
    coince_zone: '',
    amputation: '',
    amputation_type: '',
    amputation_membre: '',
    amputation_localisation: '',
    amputation_hemorragie: '',
    amputation_garrot: '',
    amputation_garrot_heure: '',
    amputation_segment_retrouve: '',
    amputation_conditionnement: '',
  },
  BRULURE: {
    brulure: '',
    brulure_degre: '',
    brulure_zones: [],
    brulure_etendue: '',
    brulure_loc_choices: [],
    brulure_loc: '',
    brulure_type: '',
    cooling_duration_min: '',
    cooling_timer_min: '20',
    cooling_done: '',
  },
  FAST: { face: '', arm: '', speech: '', temps: '', temps_choice: '' },
  SAMPLER: {
    symptom_choices: [],
    symptom_other: '',
    pqrst_list: [],
    allergy_status: '',
    sampler_a_choices: [],
    allergy_reactions: [],
    sampler_a: '',
    sampler_m_choices: [],
    sampler_m: '',
    meds_taken_today: '',
    sampler_p_choices: [],
    sampler_p: '',
    sampler_l_choice: '',
    sampler_l_time: '',
    sampler_l_nature: [],
    sampler_l: '',
    sampler_e_choices: [],
    sampler_e_time: '',
    sampler_e: '',
    sampler_r_choices: [],
    sampler_r: '',
  },
});

function playBeep(freq = 880, duration = 0.4) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
    osc.onended = () => ctx.close();
  } catch (e) {
    // ignore
  }
}

function vibrate(duration) {
  try {
    // Haptics.vibrate() renvoie une promesse : sans .catch(), un rejet passait
    // inaperçu (le try/catch autour d'un appel non attendu ne le voit pas).
    Haptics.vibrate({ duration }).catch(() => {});
  } catch (e) {
    // ignore
  }
}

function alertTimerDone() {
  vibrate(400);
  playBeep(880, 0.4);
}

function useCountdown(initialSeconds) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const intervalRef = useRef(null);
  const initialRef = useRef(initialSeconds);
  initialRef.current = initialSeconds;

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
    setRemaining(initialRef.current);
    setDone(false);
    setRunning(true);
  };
  const reset = () => {
    clearInterval(intervalRef.current);
    setRemaining(initialRef.current);
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

function TimerBox({ timer, label }) {
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
            <Play size={12} /> {label || 'Chrono 1 min'}
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

// Section repliable avec un petit badge indiquant le nombre d'éléments sélectionnés
// dans le groupe. Utilisé pour regrouper le SAMPLER en catégories.
function Accordion({ title, count, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <span
          className="text-sm font-semibold uppercase tracking-wide text-neutral-200"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {title}
        </span>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: ACCENT }}
            >
              {count}
            </span>
          )}
          <ChevronRight
            size={16}
            className="text-neutral-500 transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </div>
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3 border-t border-neutral-800 pt-3">{children}</div>}
    </div>
  );
}

// Horloge en lecture seule affichée à côté des saisies d'heure, pour que l'utilisateur
// voie l'heure actuelle sans avoir à sortir son téléphone/sa montre.
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return (
    <span
      className="text-xs text-neutral-600 shrink-0"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      (actuellement {hh}:{mm})
    </span>
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

function CoolingModal({ active, minutes, onStop }) {
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
          Fin des {minutes} minutes — arrêt du refroidissement
        </h3>
        <p className="text-sm text-neutral-400">
          Le temps de refroidissement de la brûlure à l'eau tempérée est écoulé.
        </p>
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

function HyperthermieModal({ active, onStop }) {
  if (!active) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="bg-neutral-950 border-2 rounded-2xl w-full sm:max-w-sm p-6 flex flex-col gap-4 overflow-y-auto"
        style={{ borderColor: AMBER, maxHeight: '85vh' }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={40} style={{ color: AMBER }} />
          <h3 className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Hyperthermie détectée
          </h3>
        </div>
        <ol className="flex flex-col gap-2.5 text-sm text-neutral-200 leading-relaxed list-decimal pl-5">
          {HYPERTHERMIE_CAT_STEPS.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="text-xs text-neutral-500 italic border-t border-neutral-800 pt-3">
          Cette procédure peut entraîner des convulsions.
        </p>
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

function ReconditionSection({ title, items, color }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
        {title}
      </span>
      <ul className="flex flex-col gap-1 pl-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-neutral-200 flex items-start gap-2">
            <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReconditionModal({ active, data, onClose }) {
  if (!active) return null;
  const { remplacer, verifier, nettoyage } = computeReconditionnement(data);
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="bg-neutral-950 border-2 rounded-2xl w-full sm:max-w-md p-6 flex flex-col gap-4 overflow-y-auto"
        style={{ borderColor: ACCENT, maxHeight: '85vh' }}
      >
        <h3
          className="text-lg font-bold text-center"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          Reconditionnement VSAV
        </h3>
        <p className="text-xs text-neutral-500 text-center -mt-2">
          Généré à partir des informations déjà renseignées dans ce bilan.
        </p>
        <ReconditionSection title="À remplacer / réapprovisionner" items={remplacer} color={ACCENT} />
        <ReconditionSection title="Matériel à vérifier" items={verifier} color={AMBER} />
        <ReconditionSection title="Nettoyage / désinfection" items={nettoyage} color={EMERALD} />
        <button
          onClick={onClose}
          className="w-full py-3 rounded-md font-semibold text-base mt-1"
          style={{ backgroundColor: ACCENT, color: '#fff' }}
        >
          Fermer
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

function RefConstRow({ label, value, unit, isAbnormal }) {
  const filled = !!value;
  const abnormal = filled && isAbnormal(value);
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-500">{label}</span>
      <span
        className={filled ? 'font-semibold' : 'italic text-neutral-600'}
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          color: filled ? (abnormal ? '#F87171' : '#F5F5F5') : undefined,
        }}
      >
        {filled ? `${value} ${unit}` : 'à renseigner'}
      </span>
    </div>
  );
}

function SamplerField({ letter, label, value, onChange, choiceOptions, choiceValue, onChoiceChange, choiceMulti, hideHeader }) {
  const hasChoice = choiceValue !== undefined
    ? (Array.isArray(choiceValue) ? choiceValue.length > 0 : !!choiceValue)
    : false;
  const isFilled = !!value || hasChoice;
  return (
    <div className={hideHeader ? 'flex flex-col gap-2' : 'bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-2'}>
      {!hideHeader && (
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
      )}
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
  if (data.FAST.face === 'positif' || data.FAST.arm === 'positif' || data.FAST.speech === 'positif') {
    results.push({ page: 'FAST', label: 'FAST (AVC)' });
  }

  return results;
}

// Calcule la liste de reconditionnement VSAV à partir des données déjà renseignées dans
// le bilan — aucune nouvelle saisie n'est nécessaire. Les éléments dont l'usage est
// confirmé par une réponse directe vont en "à remplacer" ; ceux dont l'usage est
// seulement probable (déduit d'une situation) vont en "à vérifier", sans jamais
// affirmer avec certitude qu'un consommable précis a été utilisé.
function computeReconditionnement(data) {
  const remplacer = [];
  const verifier = [];
  const nettoyage = [];

  if (data.X.collier_pose === 'oui') {
    remplacer.push('Collier cervical');
  }
  if (data.X.hemorragie === 'oui') {
    verifier.push('Matériel hémorragie à vérifier : compresses, pansement compressif / hémostatique, bandes');
  }
  if (data.X.garrot_pose === 'oui') {
    remplacer.push('Garrot (hémorragie)');
  }
  if (data.B.o2_active === 'oui') {
    verifier.push('Bouteille O2 (pression / autonomie) et consommables O2');
    const debit = parseFloat(String(data.B.o2_debit).replace(',', '.'));
    if (!isNaN(debit)) {
      if (debit >= 10) verifier.push('Masque haute concentration (débit élevé renseigné)');
      else if (debit <= 6) verifier.push('Lunettes à oxygène (débit faible renseigné)');
      else verifier.push('Masque simple (débit intermédiaire renseigné)');
    }
  }
  if (data.D.glycemie) {
    remplacer.push('Lancette');
    remplacer.push('Bandelette de glycémie');
    remplacer.push('Compresse (glycémie capillaire)');
  }
  if (data.BRULURE.brulure === 'oui') {
    verifier.push('Matériel brûlure à vérifier : pansement stérile / non adhérent, compresses');
  }
  if (data.E.amputation === 'oui' && data.E.amputation_garrot === 'oui') {
    remplacer.push('Garrot (amputation)');
  }
  if (data.E.amputation_conditionnement === 'oui') {
    remplacer.push('Compresses / pansement stérile (conditionnement du segment)');
    remplacer.push('Sac de conditionnement du segment amputé');
  }
  if (data.E.victime_env === 'froid') {
    verifier.push("Couverture de survie / matériel d'isolation (à vérifier si utilisé)");
  }

  // Systématique, à chaque bilan
  remplacer.push('Gants à réapprovisionner');
  remplacer.push('Drap / alèse de brancard à remplacer');
  nettoyage.push('Brancard à nettoyer / désinfecter');
  nettoyage.push('Cellule sanitaire / véhicule à nettoyer / désinfecter');

  return { remplacer, verifier, nettoyage };
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
  const labels = (values, options) => (values || []).map((v) => options.find((o) => o.value === v)?.label || v).join(', ');
  const single = (value, options) => options.find((o) => o.value === value)?.label || value || '';
  const pParts = [];
  if (entry.p_aggrave?.length) pParts.push(`Aggravé par : ${labels(entry.p_aggrave, PQRST_P_AGGRAVE_OPTIONS)}`);
  if (entry.p_soulage?.length) pParts.push(`Soulagé par : ${labels(entry.p_soulage, PQRST_P_SOULAGE_OPTIONS)}`);
  if (entry.p_text) pParts.push(entry.p_text);
  const rParts = [];
  if (entry.region) rParts.push(`Localisation : ${single(entry.region, PQRST_REGION_OPTIONS)}`);
  if (entry.irradiation?.length) rParts.push(`Irradiation : ${labels(entry.irradiation, PQRST_IRRADIATION_OPTIONS)}`);
  if (entry.r_text) rParts.push(entry.r_text);
  const sParts = [];
  if (entry.s !== '') sParts.push(`EVA ${entry.s}/10`);
  if (entry.evs) sParts.push(`EVS ${single(entry.evs, EVS_OPTIONS)}`);
  if (entry.s_text) sParts.push(entry.s_text);
  const tParts = [];
  if (entry.t_heure) tParts.push(`Début ${entry.t_heure}`);
  if (entry.t_duree) tParts.push(`Depuis ${entry.t_duree} ${entry.t_unite || ''}`.trim());
  if (entry.t_debut) tParts.push(`Début ${single(entry.t_debut, PQRST_T_DEBUT_OPTIONS)}`);
  if (entry.t_evolution) tParts.push(`Évolution ${single(entry.t_evolution, PQRST_T_EVOLUTION_OPTIONS)}`);
  if (entry.t_temporalite) tParts.push(single(entry.t_temporalite, PQRST_T_TEMPORALITE_OPTIONS));
  if (entry.t_similaire) tParts.push(`Épisode similaire : ${single(entry.t_similaire, PQRST_T_SIMILAIRE_OPTIONS)}`);
  if (entry.t_text) tParts.push(entry.t_text);
  const rows = [
    { num: `${n}.1`, label: 'P — Provoqué / Palliatif', value: pParts.join(' — ') },
    { num: `${n}.2`, label: 'Q — Qualité', value: [labels(entry.q, PQRST_Q_OPTIONS), entry.q_text].filter(Boolean).join(' — ') },
    { num: `${n}.3`, label: 'R — Région / Irradiation', value: rParts.join(' — ') },
    { num: `${n}.4`, label: 'S — Sévérité', value: sParts.join(' — ') },
    { num: `${n}.5`, label: 'T — Temps', value: tParts.join(' — ') },
  ];
  return rows.filter((row) => row.value);
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
    if (pqrstList.length > 0) {
      pqrstList.forEach((entry, i) => {
        const n = i + 1;
        lines.push(`  ${entry.title || `PQRST ${n}`}`);
        formatPqrstEntry(entry, n).forEach((row) => lines.push(`    ${row.num} ${row.label} : ${row.value}`));
      });
    }
    rows.forEach(({ f, v }) => lines.push(`  ${FIELD_LABELS[f]} : ${v}`));
    if (
      page === 'FAST' &&
      data.FAST.face === 'negatif' &&
      data.FAST.arm === 'negatif' &&
      data.FAST.speech === 'negatif'
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

function getTransmissionHighlights(data) {
  const items = [];
  const symptoms = data.SAMPLER?.symptom_choices || [];
  const symptomLabels = symptoms.map((v) => SYMPTOME_OPTIONS.find((o) => o.value === v)?.label).filter(Boolean);
  if (symptomLabels.length) items.push(`Motif / symptômes : ${symptomLabels.join(', ')}`);
  const highEva = (data.SAMPLER?.pqrst_list || [])
    .filter((p) => p.s !== '' && !Number.isNaN(Number(p.s)))
    .sort((a, b) => Number(b.s) - Number(a.s))[0];
  if (highEva) items.push(`${highEva.title || 'Douleur'} — EVA ${highEva.s}/10`);
  if (data.B?.spo2_air) items.push(`SpO2 ${data.B.spo2_air}% sous air`);
  else if (data.B?.spo2_o2) items.push(`SpO2 ${data.B.spo2_o2}% sous O2`);
  const meds = data.SAMPLER?.sampler_m_choices || [];
  if (meds.includes('anticoagulant')) items.push('⚠ Anticoagulant');
  if (meds.includes('antiagregant')) items.push('⚠ Antiagrégant');
  const antecedents = data.SAMPLER?.sampler_p_choices || [];
  const major = antecedents.filter((v) => ['cardiopathie', 'infarctus_sca', 'insuffisance_cardiaque', 'avc_ait', 'epilepsie', 'diabete'].includes(v));
  if (major.length) items.push(`ATCD : ${major.map((v) => ANTECEDENTS_OPTIONS.find((o) => o.value === v)?.label || v).join(', ')}`);
  return items;
}

function RecapView({ data }) {
  const sections = ['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].map((page) => {
    const rows = PAGE_FIELDS[page]
      .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data)) }))
      .filter((r) => r.v !== null);
    const pqrstList = page === 'SAMPLER' ? data.SAMPLER.pqrst_list || [] : [];
    return { page, rows, pqrstList };
  });

  const transmissionHighlights = getTransmissionHighlights(data);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: ACCENT }}>Synthèse transmission</span>
        {data.TYPE?.categorie && <div className="text-sm"><span className="text-neutral-500">Victime : </span><span className="font-semibold">{PATIENT_CATEGORIES[data.TYPE.categorie]?.label}</span></div>}
        {transmissionHighlights.length > 0 ? transmissionHighlights.map((item, i) => (
          <div key={`${item}_${i}`} className="text-sm text-neutral-200 border-l-2 pl-2" style={{ borderColor: item.startsWith('⚠') ? AMBER : '#404040' }}>{item}</div>
        )) : <span className="text-sm text-neutral-600 italic">Aucun élément de synthèse renseigné.</span>}
      </div>
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
              {pqrstList.length > 0 && (
                <div className="flex flex-col gap-3 mb-2">
                  {pqrstList.map((entry, i) => {
                    const n = i + 1;
                    const pqrstRows = formatPqrstEntry(entry, n);
                    return (
                      <div key={entry.id} className="border-l-2 pl-3" style={{ borderColor: ACCENT }}>
                        <div
                          className="text-sm font-bold text-neutral-100 mb-1"
                          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                        >
                          {entry.title || `PQRST ${n}`}
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
            </>
          )}
          {page === 'FAST' &&
            data.FAST.face === 'negatif' &&
            data.FAST.arm === 'negatif' &&
            data.FAST.speech === 'negatif' && (
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
  const o2DismissedRef = useRef(false);
  const [hyperthermieActive, setHyperthermieActive] = useState(false);
  const [showRecondition, setShowRecondition] = useState(false);
  const [autreSymptome, setAutreSymptome] = useState('');
  const hyperthermieShownRef = useRef(false);

  const frTimer = useCountdown(60);
  const fcTimer = useCountdown(60);
  const coolingMinutes = parseFloat(String(form.BRULURE.cooling_timer_min).replace(',', '.')) || 20;
  const coolingTimer = useCountdown(Math.max(1, Math.round(coolingMinutes * 60)));
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

    o2DismissedRef.current = false;
    o2CheckIntervalRef.current = setInterval(() => {
      const elapsedMin = (Date.now() - o2StartRef.current) / 60000;
      const remaining = autonomy - elapsedMin;
      setO2RemainingMin(remaining);
      if (remaining <= 10 && !o2DismissedRef.current && !o2VibrateIntervalRef.current) {
        setO2AlarmActive(true);
        vibrate(700);
        playBeep(1046, 0.5);
        o2VibrateIntervalRef.current = setInterval(() => {
          vibrate(700);
          playBeep(1046, 0.5);
        }, 2000);
      }
    }, 5000);

    return () => {
      if (o2CheckIntervalRef.current) clearInterval(o2CheckIntervalRef.current);
    };
  }, [form.B.o2_active, form.B.o2_bottle_size, form.B.o2_pressure, form.B.o2_debit]);

  // Détection d'hyperthermie : déclenche le popup plein écran une seule fois par
  // épisode (pas à chaque frappe), et autorise un nouveau déclenchement si la
  // situation redevient normale puis se redégrade.
  useEffect(() => {
    const detected = isHyperthermieDetected(form);
    if (detected && !hyperthermieShownRef.current) {
      hyperthermieShownRef.current = true;
      setHyperthermieActive(true);
      vibrate(700);
      playBeep(1046, 0.5);
    }
    if (!detected) {
      hyperthermieShownRef.current = false;
    }
  }, [
    form.E.victime_env,
    form.E.victime_env_signes,
    form.E.temperature,
    form.B.fr,
    form.B.spo2_air,
    form.C.fc,
    form.C.pa_gauche_sys,
    form.C.pa_droite_sys,
  ]);

  function stopHyperthermieAlert() {
    setHyperthermieActive(false);
  }

  function stopO2Alarm() {
    o2DismissedRef.current = true;
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

  function toggleSamplerSymptom(value) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => {
      const current = f.SAMPLER.symptom_choices || [];
      const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
      return { ...f, SAMPLER: { ...f.SAMPLER, symptom_choices: next } };
    });
    if (saved) setSaved(false);
  }

  function addPqrst(title) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    const entry = {
      id: `pqrst_${Date.now()}`,
      title: title || '',
      p_aggrave: [],
      p_soulage: [],
      p_text: '',
      q: [],
      q_text: '',
      region: '',
      irradiation: [],
      r_text: '',
      s: '',
      evs: '',
      s_text: '',
      t_heure: '',
      t_duree: '',
      t_unite: '',
      t_debut: '',
      t_evolution: '',
      t_temporalite: '',
      t_similaire: '',
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

  function getAmputationCat() {
    if (form.E.amputation !== 'oui') return [];
    return catItem(
      'amputation',
      'Amputation',
      'Position d\u2019attente : allongée. Contrôler l\u2019hémorragie (compression, garrot si nécessaire), conditionner le segment amputé s\u2019il est retrouvé (linge/pansement stérile sec, sac étanche, posé sur un bain de glace sans contact direct avec le segment), transporter le segment avec la victime, alerter le 15 en urgence.'
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
    if (form.FAST.face !== 'positif' && form.FAST.arm !== 'positif' && form.FAST.speech !== 'positif') return [];
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
    coolingTimer.reset();
    setStep(0);
    setSaved(false);
    setSavedAt(null);
    setPatientNum((n) => n + 1);
    bilanStartRef.current = null;
    setBilanDuration(null);
    stopO2Alarm();
    hyperthermieShownRef.current = false;
    setHyperthermieActive(false);
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
              onChange={(v) => {
                updateField('X', 'trauma', v);
                if (v !== 'oui') updateField('X', 'collier_pose', '');
              }}
              options={OUI_NON}
            />
            <span className="text-xs text-neutral-600 italic mt-1.5 block">
              Si on ne sait pas = Oui.
            </span>
          </FieldCard>
          <InlineCatBox items={getTraumaCat()} />
          {form.X.trauma === 'oui' && (
            <FieldCard label="Pose collier" filled={!!form.X.collier_pose}>
              <ToggleGroup
                value={form.X.collier_pose}
                onChange={(v) => updateField('X', 'collier_pose', v)}
                options={OUI_NON}
              />
            </FieldCard>
          )}
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
                      <div className="flex items-center gap-2">
                        <InputBox
                          value={form.X.garrot_heure}
                          onChange={(v) => updateField('X', 'garrot_heure', formatTimeInput(v))}
                          placeholder="hh:mm"
                          width="w-28"
                          numeric
                        />
                        <LiveClock />
                      </div>
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
          {form.B.fr_signes.some((s) => s !== 'aucun') && (
            <FieldCard label="Heure d'apparition" filled={!!form.B.fr_signes_heure}>
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.B.fr_signes_heure}
                  onChange={(v) => updateField('B', 'fr_signes_heure', formatTimeInput(v))}
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock />
              </div>
            </FieldCard>
          )}
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
          {form.C.signes.some((s) => s !== 'aucun') && (
            <FieldCard label="Heure d'apparition" filled={!!form.C.signes_heure}>
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.C.signes_heure}
                  onChange={(v) => updateField('C', 'signes_heure', formatTimeInput(v))}
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock />
              </div>
            </FieldCard>
          )}
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
                  updateField('D', 'pci_duree', '');
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getPciCat()} />
          {form.D.pci === 'oui' && (
            <>
              <FieldCard label="Durée de la PCI" filled={!!form.D.pci_duree}>
                <InputBox
                  value={form.D.pci_duree}
                  onChange={(v) => updateField('D', 'pci_duree', v)}
                  unit="min"
                  placeholder="Valeur"
                  width="w-28"
                  numeric
                />
              </FieldCard>
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
          {form.D.neuro_signes.some((s) => s !== 'aucun') && (
            <FieldCard
              label="Heure d'apparition"
              filled={!!form.D.neuro_signes_depuis_heure}
            >
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.D.neuro_signes_depuis_heure}
                  onChange={(v) => updateField('D', 'neuro_signes_depuis_heure', formatTimeInput(v))}
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock />
              </div>
            </FieldCard>
          )}
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
              onChange={(v) => {
                updateField('E', 'victime_env', v);
                if (v !== 'chaud') updateField('E', 'victime_env_signes', []);
              }}
              options={ENV_OPTIONS}
            />
          </FieldCard>
          <InlineCatBox items={getVictimeFroidCat()} />
          {form.E.victime_env === 'chaud' && (
            <div className="flex flex-col gap-4 pl-1 border-l-2 border-neutral-800">
              <div className="flex flex-col gap-1.5 pl-3">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">
                  Signes associés
                </span>
                <MultiToggleGroup
                  value={form.E.victime_env_signes}
                  onChange={(v) =>
                    updateField('E', 'victime_env_signes', withExclusiveNone(form.E.victime_env_signes, v, 'aucun'))
                  }
                  options={HYPERTHERMIE_SIGNS}
                />
              </div>
              <div className="flex flex-col gap-2 pl-3 bg-neutral-900 border border-neutral-800 rounded-md p-3">
                <span className="text-xs text-neutral-500 uppercase tracking-wide mb-1">
                  Constantes du bilan (seuils d'alerte)
                </span>
                <RefConstRow
                  label="Température"
                  value={form.E.temperature}
                  unit="°C"
                  isAbnormal={(v) => parseFloat(String(v).replace(',', '.')) >= 39}
                />
                <RefConstRow
                  label="Fréquence respiratoire"
                  value={form.B.fr}
                  unit="/min"
                  isAbnormal={(v) => parseFloat(v) > 30}
                />
                <RefConstRow
                  label="SpO2"
                  value={form.B.spo2_air}
                  unit="%"
                  isAbnormal={(v) => parseFloat(v) < 94}
                />
                <RefConstRow
                  label="Fréquence cardiaque"
                  value={form.C.fc}
                  unit="/min"
                  isAbnormal={(v) => parseFloat(v) > 100}
                />
                <RefConstRow
                  label="Tension systolique"
                  value={form.C.pa_gauche_sys || form.C.pa_droite_sys}
                  unit="mmHg"
                  isAbnormal={(v) => parseFloat(v) < 90}
                />
              </div>
            </div>
          )}
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
              <FieldCard label="Heure d'apparition / début de compression" filled={!!form.E.coince_depuis}>
                <div className="flex items-center gap-2">
                  <InputBox
                    value={form.E.coince_depuis}
                    onChange={(v) => updateField('E', 'coince_depuis', formatTimeInput(v))}
                    placeholder="hh:mm"
                    width="w-28"
                    numeric
                  />
                  <LiveClock />
                </div>
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

          <FieldCard label="Amputation" filled={!!form.E.amputation}>
            <ToggleGroup
              value={form.E.amputation}
              onChange={(v) => {
                updateField('E', 'amputation', v);
                if (v !== 'oui') {
                  updateField('E', 'amputation_type', '');
                  updateField('E', 'amputation_membre', '');
                  updateField('E', 'amputation_localisation', '');
                  updateField('E', 'amputation_hemorragie', '');
                  updateField('E', 'amputation_garrot', '');
                  updateField('E', 'amputation_garrot_heure', '');
                  updateField('E', 'amputation_segment_retrouve', '');
                  updateField('E', 'amputation_conditionnement', '');
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <InlineCatBox items={getAmputationCat()} />
          {form.E.amputation === 'oui' && (
            <>
              <FieldCard label="Type d'amputation" filled={!!form.E.amputation_type}>
                <ToggleGroup
                  value={form.E.amputation_type}
                  onChange={(v) => updateField('E', 'amputation_type', v)}
                  options={AMPUTATION_TYPE_OPTIONS}
                />
              </FieldCard>
              <FieldCard label="Membre concerné" filled={!!form.E.amputation_membre}>
                <ToggleGroup
                  value={form.E.amputation_membre}
                  onChange={(v) => {
                    updateField('E', 'amputation_membre', v);
                    updateField('E', 'amputation_localisation', '');
                  }}
                  options={AMPUTATION_MEMBRE_OPTIONS}
                />
              </FieldCard>
              {form.E.amputation_membre && (
                <FieldCard label="Localisation" filled={!!form.E.amputation_localisation}>
                  <ToggleGroup
                    value={form.E.amputation_localisation}
                    onChange={(v) => updateField('E', 'amputation_localisation', v)}
                    options={
                      form.E.amputation_membre === 'superieur'
                        ? AMPUTATION_LOC_SUPERIEUR_OPTIONS
                        : AMPUTATION_LOC_INFERIEUR_OPTIONS
                    }
                  />
                </FieldCard>
              )}
              <FieldCard label="Hémorragie associée" filled={!!form.E.amputation_hemorragie}>
                <ToggleGroup
                  value={form.E.amputation_hemorragie}
                  onChange={(v) => updateField('E', 'amputation_hemorragie', v)}
                  options={OUI_NON}
                />
              </FieldCard>
              <FieldCard label="Garrot" filled={!!form.E.amputation_garrot}>
                <div className="flex flex-col gap-2">
                  <ToggleGroup
                    value={form.E.amputation_garrot}
                    onChange={(v) => {
                      updateField('E', 'amputation_garrot', v);
                      if (v === 'oui' && !form.E.amputation_garrot_heure) {
                        const now = new Date();
                        const hh = String(now.getHours()).padStart(2, '0');
                        const mm = String(now.getMinutes()).padStart(2, '0');
                        updateField('E', 'amputation_garrot_heure', `${hh}:${mm}`);
                      }
                      if (v !== 'oui') updateField('E', 'amputation_garrot_heure', '');
                    }}
                    options={OUI_NON}
                  />
                  {form.E.amputation_garrot === 'oui' && (
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">
                        Heure de pose (capturée automatiquement, modifiable)
                      </span>
                      <div className="flex items-center gap-2">
                        <InputBox
                          value={form.E.amputation_garrot_heure}
                          onChange={(v) => updateField('E', 'amputation_garrot_heure', formatTimeInput(v))}
                          placeholder="hh:mm"
                          width="w-28"
                          numeric
                        />
                        <LiveClock />
                      </div>
                    </div>
                  )}
                </div>
              </FieldCard>
              <FieldCard label="Segment amputé retrouvé" filled={!!form.E.amputation_segment_retrouve}>
                <ToggleGroup
                  value={form.E.amputation_segment_retrouve}
                  onChange={(v) => updateField('E', 'amputation_segment_retrouve', v)}
                  options={OUI_NON}
                />
              </FieldCard>
              <FieldCard label="Conditionnement du segment" filled={!!form.E.amputation_conditionnement}>
                <ToggleGroup
                  value={form.E.amputation_conditionnement}
                  onChange={(v) => updateField('E', 'amputation_conditionnement', v)}
                  options={OUI_NON}
                />
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
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">
                      Minuteur de refroidissement — durée réglable
                    </span>
                    <div className="flex items-center gap-2">
                      <InputBox
                        value={form.BRULURE.cooling_timer_min}
                        onChange={(v) => updateField('BRULURE', 'cooling_timer_min', v)}
                        unit="min"
                        placeholder="20"
                        numeric
                        width="w-20"
                      />
                      {coolingTimer.running && (
                        <span className="text-xs text-neutral-600 italic">
                          en cours — arrêter le chrono pour modifier la durée
                        </span>
                      )}
                    </div>
                    <TimerBox timer={coolingTimer} label={`Démarrer ${Math.round(coolingMinutes)} min`} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Refroidissement déjà effectué ?</span>
                    <ToggleGroup
                      value={form.BRULURE.cooling_done}
                      onChange={(v) => {
                        updateField('BRULURE', 'cooling_done', v);
                        if (v !== 'oui') updateField('BRULURE', 'cooling_duration_min', '');
                      }}
                      options={[{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }, { value: 'inconnu', label: 'Inconnu' }]}
                    />
                    {form.BRULURE.cooling_done === 'oui' && (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">Durée du refroidissement (déjà effectué)</span>
                        <InputBox
                          value={form.BRULURE.cooling_duration_min}
                          onChange={(v) => updateField('BRULURE', 'cooling_duration_min', v)}
                          unit="min"
                          placeholder="durée"
                          numeric
                          width="w-24"
                        />
                      </div>
                    )}
                  </div>
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
              options={POSITIF_NEGATIF}
            />
          </FieldCard>
          <FieldCard label="Arm (bras)" filled={!!form.FAST.arm}>
            <ToggleGroup
              value={form.FAST.arm}
              onChange={(v) => updateField('FAST', 'arm', v)}
              options={POSITIF_NEGATIF}
            />
          </FieldCard>
          <FieldCard label="Speech (parole)" filled={!!form.FAST.speech}>
            <ToggleGroup
              value={form.FAST.speech}
              onChange={(v) => updateField('FAST', 'speech', v)}
              options={POSITIF_NEGATIF}
            />
          </FieldCard>
          <InlineCatBox items={getFastCat()} />
          <FieldCard label="Heure d'apparition" filled={!!form.FAST.temps || !!form.FAST.temps_choice}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.FAST.temps}
                  onChange={(v) => updateField('FAST', 'temps', formatTimeInput(v))}
                  placeholder="hh:mm"
                  numeric
                />
                <LiveClock />
              </div>
              <ToggleGroup
                value={form.FAST.temps_choice}
                onChange={(v) => updateField('FAST', 'temps_choice', v)}
                options={FAST_TEMPS_CHOICE_OPTIONS}
              />
            </div>
          </FieldCard>
        </>
      );
    if (s === 'SAMPLER') {
      const selectedSymptoms = form.SAMPLER.symptom_choices || [];
      const neuroPrompt = selectedSymptoms.some((v) => ['trouble_parole', 'faiblesse_membre'].includes(v));
      const respiratoryPrompt = selectedSymptoms.includes('gene_respiratoire');
      const traumaPrompt = (form.SAMPLER.sampler_e_choices || []).some((v) => ['chute_traumatisme', 'accident_circulation', 'agression'].includes(v));
      const autoRisks = [];
      if ((form.SAMPLER.sampler_p_choices || []).includes('diabete')) autoRisks.push('Diabète — déjà renseigné dans P');
      if ((form.SAMPLER.sampler_p_choices || []).includes('hta')) autoRisks.push('HTA — déjà renseignée dans P');
      if ((form.SAMPLER.sampler_p_choices || []).includes('chirurgie_recente')) autoRisks.push('Chirurgie récente — déjà renseignée dans P');
      if ((form.SAMPLER.sampler_p_choices || []).includes('hospitalisation_recente')) autoRisks.push('Hospitalisation récente — déjà renseignée dans P');
      if ((form.SAMPLER.sampler_p_choices || []).includes('cancer')) autoRisks.push('Cancer — déjà renseigné dans P');
      const hasAntithrombotic = (form.SAMPLER.sampler_m_choices || []).some((v) => ['anticoagulant', 'antiagregant'].includes(v));
      return (
        <>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: ACCENT }}>S</span>
              <span className="text-sm font-semibold text-neutral-200 uppercase tracking-wide">Signes et symptômes</span>
            </div>
            <p className="text-xs text-neutral-500">Sélection simple. Un PQRST est proposé uniquement pour les symptômes où il est pertinent.</p>
            <div className="flex flex-col gap-2">
              {SYMPTOME_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => selectedSymptoms.includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <div className="flex flex-wrap gap-2">
                      {SYMPTOME_OPTIONS.filter((opt) => group.values.includes(opt.value)).map((opt) => {
                        const active = selectedSymptoms.includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            onClick={() => toggleSamplerSymptom(opt.value)}
                            className="text-xs font-semibold px-3 py-2 rounded-md border"
                            style={active ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' } : { backgroundColor: '#171717', borderColor: '#2C3136', color: '#e5e5e5' }}
                          >
                            {active ? '✓ ' : ''}{opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </Accordion>
                );
              })}
            </div>
            <InputBox
              value={form.SAMPLER.symptom_other}
              onChange={(v) => updateField('SAMPLER', 'symptom_other', v)}
              placeholder="Autre symptôme / précision"
              width="w-full"
            />
            {selectedSymptoms.filter((v) => PQRST_ELIGIBLE_SYMPTOMS.has(v)).length > 0 && (
              <div className="border-t border-neutral-800 pt-3 flex flex-col gap-2">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">PQRST à compléter si utile</span>
                <div className="flex flex-wrap gap-2">
                  {selectedSymptoms.filter((v) => PQRST_ELIGIBLE_SYMPTOMS.has(v)).map((value) => {
                    const opt = SYMPTOME_OPTIONS.find((o) => o.value === value);
                    const already = form.SAMPLER.pqrst_list.some((p) => p.title === opt?.label);
                    return (
                      <button
                        key={`pqrst_add_${value}`}
                        disabled={already}
                        onClick={() => addPqrst(opt?.label || value)}
                        className="text-xs font-semibold px-3 py-2 rounded-md border"
                        style={already ? { borderColor: '#064E3B', color: EMERALD, opacity: 0.8 } : { borderColor: ACCENT, color: '#fff', backgroundColor: ACCENT }}
                      >
                        {already ? `✓ PQRST ${opt?.label}` : `+ PQRST ${opt?.label}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {(neuroPrompt || respiratoryPrompt || traumaPrompt) && (
              <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-3">
                {neuroPrompt && <button onClick={() => setStep(STEPS.indexOf('FAST'))} className="text-xs px-3 py-2 rounded-md border" style={{ borderColor: AMBER, color: AMBER }}>Éléments neurologiques — ouvrir FAST</button>}
                {respiratoryPrompt && <button onClick={() => setStep(STEPS.indexOf('B'))} className="text-xs px-3 py-2 rounded-md border" style={{ borderColor: AMBER, color: AMBER }}>Voir / compléter B — Respiration</button>}
                {traumaPrompt && <button onClick={() => setStep(STEPS.indexOf('X'))} className="text-xs px-3 py-2 rounded-md border" style={{ borderColor: AMBER, color: AMBER }}>Contexte traumatique — revoir X / Blood Box</button>}
              </div>
            )}
          </div>

          {form.SAMPLER.pqrst_list.map((entry, idx) => (
            <div key={entry.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-wide text-neutral-300" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {entry.title || `PQRST ${idx + 1}`}
                </h4>
                <button onClick={() => removePqrst(entry.id)} className="flex items-center gap-1 text-xs text-red-400 border border-neutral-800 rounded-md px-2 py-1">
                  <Trash2 size={13} /> Supprimer
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-neutral-300 uppercase">P — Aggravé par</span>
                <MultiToggleGroup value={entry.p_aggrave || []} onChange={(v) => updatePqrstField(entry.id, 'p_aggrave', v)} options={PQRST_P_AGGRAVE_OPTIONS} />
                <span className="text-xs font-semibold text-neutral-300 uppercase mt-1">P — Soulagé par</span>
                <MultiToggleGroup value={entry.p_soulage || []} onChange={(v) => updatePqrstField(entry.id, 'p_soulage', v)} options={PQRST_P_SOULAGE_OPTIONS} />
                <InputBox value={entry.p_text || ''} onChange={(v) => updatePqrstField(entry.id, 'p_text', v)} placeholder="Précision P" width="w-full" />
              </div>
              <PqrstRow letter="Q" label="Qualité" options={PQRST_Q_OPTIONS} value={entry.q || []} onChange={(v) => updatePqrstField(entry.id, 'q', v)} textValue={entry.q_text || ''} onTextChange={(v) => updatePqrstField(entry.id, 'q_text', v)} />
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-neutral-300 uppercase">R — Localisation principale</span>
                <ToggleGroup value={entry.region || ''} onChange={(v) => updatePqrstField(entry.id, 'region', v)} options={PQRST_REGION_OPTIONS} />
                <span className="text-xs font-semibold text-neutral-300 uppercase mt-1">R — Irradiation</span>
                <MultiToggleGroup value={entry.irradiation || []} onChange={(v) => updatePqrstField(entry.id, 'irradiation', withExclusiveNone(entry.irradiation || [], v, 'aucune'))} options={PQRST_IRRADIATION_OPTIONS} />
                <InputBox value={entry.r_text || ''} onChange={(v) => updatePqrstField(entry.id, 'r_text', v)} placeholder="Précision localisation / irradiation" width="w-full" />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-neutral-300 uppercase">S — Sévérité</span>
                <span className="text-xs text-neutral-500">EVA 0–10</span>
                <ToggleGroup value={entry.s || ''} onChange={(v) => updatePqrstField(entry.id, 's', v)} options={EVA_OPTIONS} />
                <span className="text-xs text-neutral-500 mt-1">EVS facultative</span>
                <ToggleGroup value={entry.evs || ''} onChange={(v) => updatePqrstField(entry.id, 'evs', v)} options={EVS_OPTIONS} />
              </div>
              <div className="flex flex-col gap-3 border-t border-neutral-800 pt-3">
                <span className="text-xs font-semibold text-neutral-300 uppercase">T — Temps</span>
                <div className="flex flex-wrap gap-3 items-end">
                  <div><span className="text-xs text-neutral-500">Heure de début</span><div className="flex items-center gap-2"><InputBox value={entry.t_heure || ''} onChange={(v) => updatePqrstField(entry.id, 't_heure', formatTimeInput(v))} placeholder="hh:mm" numeric width="w-24" /><LiveClock /></div></div>
                  <div><span className="text-xs text-neutral-500">Depuis</span><InputBox value={entry.t_duree || ''} onChange={(v) => updatePqrstField(entry.id, 't_duree', v)} placeholder="durée" numeric="decimal" width="w-24" /></div>
                  <div><span className="text-xs text-neutral-500">Unité</span><ToggleGroup value={entry.t_unite || ''} onChange={(v) => updatePqrstField(entry.id, 't_unite', v)} options={PQRST_T_UNITE_OPTIONS} /></div>
                </div>
                <div><span className="text-xs text-neutral-500">Mode de début</span><ToggleGroup value={entry.t_debut || ''} onChange={(v) => updatePqrstField(entry.id, 't_debut', v)} options={PQRST_T_DEBUT_OPTIONS} /></div>
                <div><span className="text-xs text-neutral-500">Évolution</span><ToggleGroup value={entry.t_evolution || ''} onChange={(v) => updatePqrstField(entry.id, 't_evolution', v)} options={PQRST_T_EVOLUTION_OPTIONS} /></div>
                <div><span className="text-xs text-neutral-500">Temporalité</span><ToggleGroup value={entry.t_temporalite || ''} onChange={(v) => updatePqrstField(entry.id, 't_temporalite', v)} options={PQRST_T_TEMPORALITE_OPTIONS} /></div>
                <div><span className="text-xs text-neutral-500">Épisode similaire auparavant</span><ToggleGroup value={entry.t_similaire || ''} onChange={(v) => updatePqrstField(entry.id, 't_similaire', v)} options={PQRST_T_SIMILAIRE_OPTIONS} /></div>
                <InputBox value={entry.t_text || ''} onChange={(v) => updatePqrstField(entry.id, 't_text', v)} placeholder="Précision temporelle" width="w-full" />
              </div>
            </div>
          ))}

          <Accordion
            title="A — Allergies"
            count={(form.SAMPLER.sampler_a_choices || []).length + (form.SAMPLER.allergy_reactions || []).length}
          >
            <ToggleGroup value={form.SAMPLER.allergy_status} onChange={(v) => {
              updateField('SAMPLER', 'allergy_status', v);
              if (v !== 'oui') { updateField('SAMPLER', 'sampler_a_choices', []); updateField('SAMPLER', 'allergy_reactions', []); }
            }} options={ALLERGY_STATUS_OPTIONS} />
            {form.SAMPLER.allergy_status === 'oui' && (
              <div className="flex flex-col gap-2">
                {ALLERGY_GROUPS.map((group) => {
                  const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_a_choices || []).includes(v)).length;
                  return (
                    <Accordion key={group.title} title={group.title} count={groupCount}>
                      <MultiToggleGroup
                        value={form.SAMPLER.sampler_a_choices}
                        onChange={(v) => updateField('SAMPLER', 'sampler_a_choices', v)}
                        options={ALLERGY_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                      />
                    </Accordion>
                  );
                })}
                <Accordion title="Réaction connue" count={(form.SAMPLER.allergy_reactions || []).length}>
                  <MultiToggleGroup value={form.SAMPLER.allergy_reactions} onChange={(v) => updateField('SAMPLER', 'allergy_reactions', v)} options={ALLERGY_REACTION_OPTIONS} />
                </Accordion>
                <InputBox value={form.SAMPLER.sampler_a} onChange={(v) => updateField('SAMPLER', 'sampler_a', v)} placeholder="Allergène / précision" width="w-full" />
              </div>
            )}
          </Accordion>

          <Accordion title="M — Médicaments / traitements" count={(form.SAMPLER.sampler_m_choices || []).length}>
            <button
              onClick={() => updateField('SAMPLER', 'sampler_m_choices', withExclusiveNone(form.SAMPLER.sampler_m_choices || [], (form.SAMPLER.sampler_m_choices || []).includes('aucun') ? [] : ['aucun'], 'aucun'))}
              className="text-xs font-semibold px-3 py-2 rounded-md border self-start"
              style={(form.SAMPLER.sampler_m_choices || []).includes('aucun') ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' } : { backgroundColor: '#171717', borderColor: '#2C3136', color: '#e5e5e5' }}
            >
              {(form.SAMPLER.sampler_m_choices || []).includes('aucun') ? '✓ ' : ''}Aucun traitement connu
            </button>
            <div className="flex flex-col gap-2">
              {MEDICAMENT_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_m_choices || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_m_choices}
                      onChange={(v) => updateField('SAMPLER', 'sampler_m_choices', withExclusiveNone(form.SAMPLER.sampler_m_choices || [], v, 'aucun'))}
                      options={MEDICAMENT_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <InputBox value={form.SAMPLER.sampler_m} onChange={(v) => updateField('SAMPLER', 'sampler_m', v)} placeholder="Nom exact des médicaments" width="w-full" />
            <div className="border-t border-neutral-800 pt-3 flex flex-col gap-2">
              <span className="text-xs text-neutral-500 uppercase">Traitement pris aujourd’hui ?</span>
              <ToggleGroup value={form.SAMPLER.meds_taken_today} onChange={(v) => updateField('SAMPLER', 'meds_taken_today', v)} options={TRAITEMENT_PRIS_OPTIONS} />
              {hasAntithrombotic && <div className="text-xs font-bold px-3 py-2 rounded-md border" style={{ borderColor: AMBER, color: AMBER }}>⚠ Anticoagulant / antiagrégant renseigné — information mise en évidence dans le récapitulatif.</div>}
            </div>
          </Accordion>

          <Accordion title="P — Passé médical" count={(form.SAMPLER.sampler_p_choices || []).length}>
            <button
              onClick={() => updateField('SAMPLER', 'sampler_p_choices', withExclusiveNone(form.SAMPLER.sampler_p_choices || [], (form.SAMPLER.sampler_p_choices || []).includes('aucun') ? [] : ['aucun'], 'aucun'))}
              className="text-xs font-semibold px-3 py-2 rounded-md border self-start"
              style={(form.SAMPLER.sampler_p_choices || []).includes('aucun') ? { backgroundColor: ACCENT, borderColor: ACCENT, color: '#fff' } : { backgroundColor: '#171717', borderColor: '#2C3136', color: '#e5e5e5' }}
            >
              {(form.SAMPLER.sampler_p_choices || []).includes('aucun') ? '✓ ' : ''}Aucun antécédent connu
            </button>
            <div className="flex flex-col gap-2">
              {ANTECEDENTS_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_p_choices || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_p_choices}
                      onChange={(v) => updateField('SAMPLER', 'sampler_p_choices', withExclusiveNone(form.SAMPLER.sampler_p_choices || [], v, 'aucun'))}
                      options={ANTECEDENTS_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <InputBox value={form.SAMPLER.sampler_p} onChange={(v) => updateField('SAMPLER', 'sampler_p', v)} placeholder="Précision" width="w-full" />
          </Accordion>

          <Accordion
            title="L — Dernière prise orale"
            count={(form.SAMPLER.sampler_l_choice ? 1 : 0) + (form.SAMPLER.sampler_l_nature || []).length}
          >
            <div className="flex flex-wrap gap-3 items-end"><div><span className="text-xs text-neutral-500">Heure</span><InputBox value={form.SAMPLER.sampler_l_time} onChange={(v) => updateField('SAMPLER', 'sampler_l_time', formatTimeInput(v))} placeholder="hh:mm" numeric width="w-24" /><LiveClock /></div><ToggleGroup value={form.SAMPLER.sampler_l_choice} onChange={(v) => updateField('SAMPLER', 'sampler_l_choice', v)} options={REPAS_OPTIONS} /></div>
            <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
              <span className="text-xs text-neutral-500 uppercase">Nature</span>
              {PRISE_ORALE_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_l_nature || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_l_nature}
                      onChange={(v) => updateField('SAMPLER', 'sampler_l_nature', v)}
                      options={PRISE_ORALE_NATURE_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <InputBox value={form.SAMPLER.sampler_l} onChange={(v) => updateField('SAMPLER', 'sampler_l', v)} placeholder="Quoi ? / précision" width="w-full" />
          </Accordion>

          <Accordion title="E — Événement" count={(form.SAMPLER.sampler_e_choices || []).length}>
            <div><span className="text-xs text-neutral-500">Heure de l’événement</span><InputBox value={form.SAMPLER.sampler_e_time} onChange={(v) => updateField('SAMPLER', 'sampler_e_time', formatTimeInput(v))} placeholder="hh:mm" numeric width="w-24" /><LiveClock /></div>
            <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
              {EVENEMENT_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_e_choices || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_e_choices}
                      onChange={(v) => updateField('SAMPLER', 'sampler_e_choices', v)}
                      options={EVENEMENT_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <textarea value={form.SAMPLER.sampler_e} onChange={(e) => updateField('SAMPLER', 'sampler_e', e.target.value)} rows={3} placeholder="Circonstances / que s’est-il passé ?" className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 resize-none" />
          </Accordion>

          <Accordion title="R — Facteurs de risque" count={(form.SAMPLER.sampler_r_choices || []).length}>
            <div className="flex flex-col gap-2">
              {RISQUE_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_r_choices || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_r_choices}
                      onChange={(v) => updateField('SAMPLER', 'sampler_r_choices', v)}
                      options={RISQUE_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <InputBox value={form.SAMPLER.sampler_r} onChange={(v) => updateField('SAMPLER', 'sampler_r', v)} placeholder="Précision" width="w-full" />
            {autoRisks.length > 0 && <div className="border-t border-neutral-800 pt-3"><span className="text-xs text-neutral-500 uppercase">Déjà détecté ailleurs — sans double saisie</span><div className="flex flex-wrap gap-2 mt-2">{autoRisks.map((r) => <span key={r} className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300">✓ {r}</span>)}</div></div>}
          </Accordion>
        </>
      );
    }
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
            <button
              onClick={() => setShowRecondition(true)}
              className="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-md border border-neutral-800 text-neutral-300"
            >
              <RotateCcw size={16} /> Reconditionnement VSAV
            </button>
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
      <CoolingModal active={coolingTimer.done} minutes={Math.round(coolingMinutes)} onStop={coolingTimer.reset} />
      <HyperthermieModal active={hyperthermieActive} onStop={stopHyperthermieAlert} />
      <ReconditionModal active={showRecondition} data={form} onClose={() => setShowRecondition(false)} />
    </div>
  );
}
