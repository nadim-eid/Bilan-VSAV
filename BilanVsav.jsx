import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Square, Save, RotateCcw, Check, History, X, Trash2, Flashlight, FlashlightOff, FileText, MessageSquare, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Torch } from '@capawesome/capacitor-torch';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

const ACCENT = '#D6362A';
const DRAFT_STORAGE_KEY = 'bilan_draft:current';
const DRAFT_SCHEMA_VERSION = 4;
const AUTOSAVE_DELAY_MS = 700;

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

const STEPS = [
  'TYPE',
  'X',
  'A',
  'B',
  'C',
  'D',
  'E',
  'BRULURE',
  'FAST',
  'SAMPLER',
  'RECAP',
  'SURVEILLANCE',
];
const LEGACY_STEPS_V3 = [...STEPS.slice(0, -2), 'SURVEILLANCE', 'RECAP'];
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
  SURVEILLANCE: 'Bilan de suivi (facultatif)',
  RECAP: 'Récapitulatif et transmission',
};
const SECTION_BADGE = {
  X: 'X',
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  BRULURE: 'Br',
  FAST: 'F',
  SAMPLER: 'S',
  SURVEILLANCE: 'Sv',
};

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
    // Une cible individualisée prescrite (BPCO, oxygénothérapie au long cours...)
    // et le référentiel local priment toujours sur cette plage indicative.
    ranges: { fr: [12, 20], fc: [60, 100], spo2: [92, 100], pa_sys: [100, 160], temperature: [36, 37.5], glycemie: [0.7, 1.1] },
  },
};

const OUI_NON = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];
const POSITIF_NEGATIF = [{ value: 'positif', label: 'Positif' }, { value: 'negatif', label: 'Négatif' }];
const SPO2_MODE = [{ value: 'air', label: 'Sous air' }, { value: 'o2', label: 'Sous O2' }];
const GLYCEMIE_UNIT_OPTIONS = [
  { value: 'mg/dL', label: 'mg/dL' },
  { value: 'g/L', label: 'g/L' },
];
const O2_INTERFACE_OPTIONS = [
  { value: 'lunettes', label: 'Lunettes nasales' },
  { value: 'masque_simple', label: 'Masque simple' },
  { value: 'masque_haute_concentration', label: 'Masque haute concentration' },
  { value: 'bavu', label: 'BAVU avec O2' },
  { value: 'autre', label: 'Autre interface' },
];

// Plages de débit habituellement associées à chaque interface — sert uniquement à
// signaler une incohérence probable, jamais à imposer ou corriger la saisie.
const O2_INTERFACE_DEBIT_RANGE = {
  lunettes: [0.5, 6],
  masque_simple: [6, 10],
  masque_haute_concentration: [10, 15],
};

// Débit initial usuel par dispositif (protocole secourisme) — proposé automatiquement
// dès qu'un dispositif est choisi, mais uniquement si aucun débit n'a déjà été saisi.
const O2_INTERFACE_DEFAULT_DEBIT = {
  lunettes: '2',
  masque_simple: '10',
  masque_haute_concentration: '15',
  bavu: '15',
};

function getO2InterfaceDebitWarning(interfaceValue, debitValue) {
  const range = O2_INTERFACE_DEBIT_RANGE[interfaceValue];
  if (!range || !debitValue) return null;
  const debit = parseFloat(String(debitValue).replace(',', '.'));
  if (isNaN(debit)) return null;
  if (debit < range[0] || debit > range[1]) {
    return `Débit inhabituel pour cette interface (plage usuelle : ${range[0]}-${range[1]} L/min) — à vérifier.`;
  }
  return null;
}

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
  { value: 'traumatisme', label: 'Traumatisme (mécanisme à préciser)' },
  { value: 'chute_traumatisme', label: 'Chute / traumatisme' },
  { value: 'accident_circulation', label: 'Accident de circulation' },
  { value: 'agression', label: 'Agression' },
  { value: 'brulure', label: 'Brûlure' },
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
  { title: 'Traumatisme / accident', values: ['traumatisme', 'chute_traumatisme', 'accident_circulation', 'agression', 'brulure'] },
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

// Croisements automatiques entre sections du SAMPLER. Seuls les liens qui répètent
// exactement un fait déjà confirmé restent automatiques. L'indication supposée d'un
// médicament est traitée plus bas comme une suggestion à confirmer.
const SAMPLER_CROSS_LINK_RULES = {
  sampler_m_choices: {},
  sampler_p_choices: {
    hta: [['sampler_r_choices', 'hta']],
    diabete: [['sampler_r_choices', 'diabete']],
    dyslipidemie: [['sampler_r_choices', 'dyslipidemie']],
    cancer: [['sampler_r_choices', 'cancer_connu']],
    grossesse: [['sampler_r_choices', 'grossesse']],
    post_partum: [['sampler_r_choices', 'post_partum']],
    chirurgie_recente: [['sampler_r_choices', 'chirurgie_recente']],
    hospitalisation_recente: [['sampler_r_choices', 'hospitalisation_recente']],
  },
};

// Ces correspondances peuvent être fréquentes sans constituer une certitude médicale.
// Elles sont donc proposées à l'équipier, puis deviennent des choix manuels uniquement
// après confirmation explicite.
const SAMPLER_SUGGESTION_RULES = {
  antihypertenseur: { targetField: 'sampler_p_choices', targetValue: 'hta', targetLabel: 'HTA' },
  antidiabetique: { targetField: 'sampler_p_choices', targetValue: 'diabete', targetLabel: 'Diabète' },
  insuline: { targetField: 'sampler_p_choices', targetValue: 'diabete', targetLabel: 'Diabète' },
  antiepileptique: { targetField: 'sampler_p_choices', targetValue: 'epilepsie', targetLabel: 'Épilepsie' },
  bronchodilatateur: { targetField: 'sampler_p_choices', targetValue: 'respiratoire', targetLabel: 'Antécédent respiratoire' },
};

function computeSamplerSuggestions(sampler) {
  const dismissed = sampler.sampler_dismissed_suggestions || [];
  const confirmed = (sampler.sampler_confirmed_links || []).map((link) => link.id);
  return uniqueValues(sampler.sampler_m_choices || [])
    .map((sourceValue) => {
      const rule = SAMPLER_SUGGESTION_RULES[sourceValue];
      if (!rule) return null;
      const id = `sampler_m:${sourceValue}->${rule.targetField}:${rule.targetValue}`;
      if (
        dismissed.includes(id) ||
        confirmed.includes(id) ||
        (sampler[rule.targetField] || []).includes(rule.targetValue)
      )
        return null;
      const sourceLabel = MEDICAMENT_OPTIONS.find((option) => option.value === sourceValue)?.label || sourceValue;
      return { id, sourceValue, sourceLabel, ...rule };
    })
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

// Recalcule les liens automatiques P -> R en conservant séparément les choix manuels.
// Ainsi, une valeur ajoutée automatiquement disparaît si sa source est retirée, sans
// effacer une valeur que l'utilisateur avait réellement saisie lui-même.
function reconcileSamplerCrossLinks(sampler, changedField, nextValues) {
  const previousAuto = sampler.sampler_auto_links || {};
  const valuesFor = (field) => (field === changedField ? nextValues : sampler[field] || []);
  const withoutPreviousAuto = (field) =>
    valuesFor(field).filter((value) => !(previousAuto[field] || []).includes(value));

  const manualM = valuesFor('sampler_m_choices');
  const manualP = withoutPreviousAuto('sampler_p_choices');
  const manualR = withoutPreviousAuto('sampler_r_choices');

  const autoP = [];
  const autoRFromM = [];
  manualM.forEach((sourceValue) => {
    (SAMPLER_CROSS_LINK_RULES.sampler_m_choices[sourceValue] || []).forEach(([targetField, targetValue]) => {
      if (targetField === 'sampler_p_choices') autoP.push(targetValue);
      if (targetField === 'sampler_r_choices') autoRFromM.push(targetValue);
    });
  });

  // Une valeur déjà saisie manuellement ne doit jamais devenir la propriété du
  // moteur automatique, sinon elle serait supprimée avec la source du lien.
  const resolvedAutoP = uniqueValues(autoP).filter((value) => !manualP.includes(value));
  const resolvedP = uniqueValues([
    ...manualP.filter((value) => value !== 'aucun' || resolvedAutoP.length === 0),
    ...resolvedAutoP,
  ]);

  const autoRFromP = [];
  resolvedP.forEach((sourceValue) => {
    (SAMPLER_CROSS_LINK_RULES.sampler_p_choices[sourceValue] || []).forEach(([targetField, targetValue]) => {
      if (targetField === 'sampler_r_choices') autoRFromP.push(targetValue);
    });
  });
  const resolvedAutoR = uniqueValues([...autoRFromM, ...autoRFromP]).filter(
    (value) => !manualR.includes(value)
  );
  const resolvedR = uniqueValues([...manualR, ...resolvedAutoR]);

  return {
    ...sampler,
    sampler_m_choices: uniqueValues(manualM),
    sampler_p_choices: resolvedP,
    sampler_r_choices: resolvedR,
    sampler_auto_links: {
      ...previousAuto,
      sampler_p_choices: resolvedAutoP,
      sampler_r_choices: resolvedAutoR,
    },
  };
}

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
  { value: 'inconnu', label: 'Délai inconnu' },
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
  {
    title: 'Général',
    values: [
      'fievre_frissons',
      'saignement',
      'eruption_urticaire',
      'agitation',
      'somnolence',
      'sensation_froid',
      'sensation_chaleur',
    ],
  },
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
  obstruction: 'Voies aériennes libres actuellement',
  liberation_effectuee: 'Libération effectuée',
  fr: 'Fréquence respiratoire',
  fr_ample: 'Amplitude ample',
  fr_reguliere: 'Respiration régulière',
  fr_signes: 'Signes associés',
  fr_signes_heure: "Heure d'apparition (respiratoire)",
  spo2_air: 'SpO2 (SAT) — sous air',
  spo2_o2: 'SpO2 (SAT) — sous O2',
  o2_interface: 'Interface O2',
  o2_start_time: 'Heure de début O2',
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
  glycemie_unit: 'Unité de glycémie',
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
  A: ['obstruction', 'liberation_effectuee'],
  B: [
    'fr',
    'fr_ample',
    'fr_reguliere',
    'fr_signes',
    'fr_signes_heure',
    'spo2_air',
    'spo2_o2',
    'o2_interface',
    'o2_start_time',
    'o2_bottle_size',
    'o2_pressure',
    'o2_debit',
    'o2_autonomie',
  ],
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
  temperature: '°C',
  pa_gauche: 'mmHg',
  pa_droite: 'mmHg',
  brulure_etendue: '% SC',
  cooling_duration_min: 'min',
};

function currentTimeString() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// Formate automatiquement une saisie de chiffres en heure:minute (ex. "1430" -> "14:30").
// La validité réelle (00:00–23:59) est contrôlée séparément afin de ne pas modifier
// silencieusement une heure saisie par l'équipier.
function formatTimeInput(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidTime(rawValue) {
  if (!rawValue) return false;
  const match = String(rawValue).match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function isPositiveNumber(rawValue) {
  if (rawValue === '' || rawValue === undefined || rawValue === null) return false;
  const num = Number(String(rawValue).replace(',', '.'));
  return Number.isFinite(num) && num > 0;
}

function isNumberInRange(rawValue, min, max) {
  if (rawValue === '' || rawValue === undefined || rawValue === null) return true;
  const num = Number(String(rawValue).replace(',', '.'));
  return Number.isFinite(num) && num >= min && num <= max;
}

function normalizeNumberInput(rawValue, allowDecimal) {
  let value = String(rawValue).replace(/\s/g, '');
  value = allowDecimal ? value.replace(/[^\d.,]/g, '') : value.replace(/\D/g, '');
  if (allowDecimal) {
    const firstSeparator = value.search(/[.,]/);
    if (firstSeparator >= 0) {
      value =
        value.slice(0, firstSeparator + 1) +
        value.slice(firstSeparator + 1).replace(/[.,]/g, '');
    }
  }
  return value.slice(0, 8);
}

// Compatibilité des anciens bilans enregistrés avant l'ajout du sélecteur d'unité.
function detectLegacyGlycemieUnit(rawValue) {
  if (!rawValue) return 'g/L';
  return /[.,]/.test(String(rawValue)) ? 'g/L' : 'mg/dL';
}

// Convertit une valeur de glycémie saisie vers l'équivalent en g/L selon l'unité
// explicitement choisie. L'inférence ne sert qu'aux anciens bilans sans unité stockée.
function glycemieToGL(rawValue, unit) {
  const num = parseFloat(String(rawValue).replace(',', '.'));
  if (isNaN(num)) return NaN;
  const resolvedUnit = unit || detectLegacyGlycemieUnit(rawValue);
  return resolvedUnit === 'mg/dL' ? num / 100 : num;
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
  liberation_effectuee: optsToLabels(OUI_NON),
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
  o2_interface: optsToLabels(O2_INTERFACE_OPTIONS),
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
  face: optsToLabels(POSITIF_NEGATIF),
  arm: optsToLabels(POSITIF_NEGATIF),
  speech: optsToLabels(POSITIF_NEGATIF),
};

function formatValue(field, value, data) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (
      field === 'brulure_zones' &&
      ['nouveau_ne', 'enfant'].includes(data?.TYPE?.categorie)
    ) {
      return value
        .map((v) => BRULURE_ZONES_9.find((zone) => zone.value === v)?.label || v)
        .join(', ');
    }
    return value.map((v) => (VALUE_LABELS[field] && VALUE_LABELS[field][v]) || v).join(', ');
  }
  if (value === '' || value === undefined || value === null) return null;
  const label = VALUE_LABELS[field] && VALUE_LABELS[field][value];
  if (label) return label;
  if (field === 'glycemie') {
    const unit = data?.D?.glycemie_unit || detectLegacyGlycemieUnit(value);
    return `${value} ${unit}`;
  }
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
  A: { obstruction: '', liberation_effectuee: '' },
  B: {
    fr: '',
    fr_ample: '',
    fr_reguliere: '',
    fr_signes: [],
    fr_signes_heure: '',
    spo2_air: '',
    o2_active: '',
    spo2_o2: '',
    o2_interface: '',
    o2_start_time: '',
    o2_started_at_ms: null,
    o2_bottle_size: '5',
    o2_pressure: '200',
    o2_debit: '',
    o2_sessions: [],
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
    glycemie_unit: 'mg/dL',
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
    sampler_auto_links: {
      sampler_p_choices: [],
      sampler_r_choices: [],
      sampler_e_choices: [],
    },
    sampler_dismissed_suggestions: [],
    sampler_confirmed_links: [],
  },
  SURVEILLANCE: { releves: [] },
});

// Rend les anciens brouillons compatibles avec les nouveaux champs sans perdre les
// données déjà saisies. Chaque section est fusionnée avec sa structure actuelle.
function normalizeFormData(rawData) {
  const base = initialForm();
  const raw = rawData && typeof rawData === 'object' ? rawData : {};
  const normalized = {};
  Object.keys(base).forEach((page) => {
    normalized[page] = { ...base[page], ...(raw[page] || {}) };
  });
  normalized.B.o2_sessions = Array.isArray(raw.B?.o2_sessions) ? raw.B.o2_sessions : [];
  normalized.SAMPLER.sampler_auto_links = {
    ...base.SAMPLER.sampler_auto_links,
    ...(raw.SAMPLER?.sampler_auto_links || {}),
  };
  normalized.SAMPLER.sampler_dismissed_suggestions = Array.isArray(
    raw.SAMPLER?.sampler_dismissed_suggestions
  )
    ? raw.SAMPLER.sampler_dismissed_suggestions
    : [];
  normalized.SAMPLER.sampler_confirmed_links = Array.isArray(raw.SAMPLER?.sampler_confirmed_links)
    ? raw.SAMPLER.sampler_confirmed_links
    : [];
  // La libération n'a de sens que lorsque les voies aériennes ne sont pas libres.
  // On nettoie ainsi aussi les anciens bilans qui avaient une réponse affichée à tort.
  if (normalized.A.obstruction !== 'non') normalized.A.liberation_effectuee = '';
  if (!raw.D?.glycemie_unit && raw.D?.glycemie) {
    normalized.D.glycemie_unit = detectLegacyGlycemieUnit(raw.D.glycemie);
  }
  normalized.SURVEILLANCE.releves = Array.isArray(raw.SURVEILLANCE?.releves)
    ? raw.SURVEILLANCE.releves.map((reading) => ({
        ...reading,
        glycemie_unit:
          reading?.glycemie_unit ||
          (reading?.glycemie ? detectLegacyGlycemieUnit(reading.glycemie) : 'mg/dL'),
      }))
    : [];
  return normalized;
}

function isPristineForm(data) {
  return JSON.stringify(normalizeFormData(data)) === JSON.stringify(initialForm());
}

const emptySurveillanceDraft = () => ({
  heure: currentTimeString(),
  fr: '',
  fc: '',
  spo2: '',
  spo2_mode: 'air',
  pa_sys: '',
  pa_dia: '',
  temperature: '',
  glycemie: '',
  glycemie_unit: 'mg/dL',
});

function formatSurveillanceReading(reading) {
  return [
    reading.fr && `FR ${reading.fr}/min`,
    reading.fc && `FC ${reading.fc}/min`,
    reading.spo2 && `SpO2 ${reading.spo2}% ${reading.spo2_mode === 'o2' ? 'sous O2' : 'sous air'}`,
    (reading.pa_sys || reading.pa_dia) && `PA ${reading.pa_sys || '?'}/${reading.pa_dia || '?'} mmHg`,
    reading.temperature && `T° ${reading.temperature} °C`,
    reading.glycemie &&
      `Gly ${reading.glycemie} ${reading.glycemie_unit || detectLegacyGlycemieUnit(reading.glycemie)}`,
  ]
    .filter(Boolean)
    .join(' — ');
}

function signedDelta(currentValue, previousValue, decimals = 0) {
  if (currentValue === '' || currentValue === null || currentValue === undefined) return null;
  if (previousValue === '' || previousValue === null || previousValue === undefined) return null;
  const current = Number(String(currentValue).replace(',', '.'));
  const previous = Number(String(previousValue).replace(',', '.'));
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 10 ** -decimals / 2) return 'stable';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(decimals).replace('.', ',')}`;
}

function formatSurveillanceDelta(reading, previous) {
  if (!previous) return '';
  const parts = [];
  const add = (label, value) => {
    if (value) parts.push(`${label} ${value}`);
  };
  add('FR', signedDelta(reading.fr, previous.fr));
  add('FC', signedDelta(reading.fc, previous.fc));
  add('SpO2', signedDelta(reading.spo2, previous.spo2));
  add('PAS', signedDelta(reading.pa_sys, previous.pa_sys));
  add('PAD', signedDelta(reading.pa_dia, previous.pa_dia));
  add('T°', signedDelta(reading.temperature, previous.temperature, 1));
  if (reading.glycemie && previous.glycemie) {
    const currentGly = glycemieToGL(reading.glycemie, reading.glycemie_unit);
    const previousGly = glycemieToGL(previous.glycemie, previous.glycemie_unit);
    add('Gly', signedDelta(currentGly, previousGly, 2));
  }
  return parts.join(' · ');
}

function surveillanceElapsedLabel(reading, previous) {
  if (!previous) return '';
  if (isValidTime(reading.heure) && isValidTime(previous.heure)) {
    const toMinutes = (value) => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    };
    let elapsed = toMinutes(reading.heure) - toMinutes(previous.heure);
    if (elapsed < 0) elapsed += 24 * 60;
    return `+${elapsed} min`;
  }
  const currentMs = Number(reading.createdAt);
  const previousMs = Number(previous.createdAt);
  if (Number.isFinite(currentMs) && Number.isFinite(previousMs) && currentMs >= previousMs) {
    return `+${Math.max(0, Math.round((currentMs - previousMs) / 60000))} min`;
  }
  return '';
}

function formatO2Session(session) {
  const interfaceLabel = O2_INTERFACE_OPTIONS.find((option) => option.value === session.interface)?.label;
  return [
    `${session.start_time || '?'} → ${session.end_time || 'en cours'}`,
    interfaceLabel,
    session.debit && `${session.debit} L/min`,
    session.spo2 && `SpO2 ${session.spo2}%`,
    session.bottle_size && `bouteille ${session.bottle_size}`,
    session.pressure && `${session.pressure} bars`,
  ]
    .filter(Boolean)
    .join(' — ');
}

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

function AutoLinkNotice({ values, options }) {
  if (!values?.length) return null;
  const labels = values.map(
    (value) => options.find((option) => option.value === value)?.label || value
  );
  return (
    <div className="text-xs text-neutral-400 border-l-2 border-neutral-700 pl-2">
      Ajout automatique lié à une autre réponse : {labels.join(', ')}. La valeur sera retirée si sa source est décochée.
    </div>
  );
}

function ConfirmedLinkNotice({ links }) {
  if (!links?.length) return null;
  return (
    <div className="text-xs border-l-2 pl-2" style={{ borderColor: EMERALD, color: '#A7F3D0' }}>
      Confirmé manuellement : {links.map((link) => `${link.targetLabel} depuis ${link.sourceLabel}`).join(', ')}.
    </div>
  );
}

// Horloge en lecture seule affichée à côté des saisies d'heure, pour que l'utilisateur
// voie l'heure actuelle sans avoir à sortir son téléphone/sa montre.
function LiveClock({ onUse }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (onUse) {
    return (
      <button
        type="button"
        onClick={() => onUse(`${hh}:${mm}`)}
        className="text-xs shrink-0 border border-neutral-800 rounded px-2 py-1 text-neutral-400"
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        Maintenant {hh}:{mm}
      </button>
    );
  }
  return (
    <span
      className="text-xs text-neutral-600 shrink-0"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      (actuellement {hh}:{mm})
    </span>
  );
}

function InputBox({ value, onChange, unit, placeholder, numeric, width, onBlur, abnormal, invalid, disabled }) {
  const inputMode = numeric === 'decimal' ? 'decimal' : numeric ? 'numeric' : 'text';
  const hasError = abnormal || invalid;
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) =>
          onChange(numeric ? normalizeNumberInput(e.target.value, numeric === 'decimal') : e.target.value)
        }
        onBlur={onBlur}
        disabled={disabled}
        aria-invalid={invalid ? 'true' : undefined}
        placeholder={placeholder || 'valeur'}
        inputMode={inputMode}
        className={`${width || 'w-28'} bg-neutral-950 border rounded-md px-3 py-2 text-lg focus:outline-none disabled:opacity-50`}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          borderColor: hasError ? '#DC2626' : '#262626',
          color: hasError ? '#F87171' : '#F5F5F5',
        }}
      />
      {unit && <span className="text-neutral-500 text-sm">{unit}</span>}
      {invalid && (
        <span className="text-xs font-semibold" style={{ color: '#F87171' }}>
          saisie invalide
        </span>
      )}
      {abnormal && !invalid && (
        <span className="text-xs font-semibold" style={{ color: '#F87171' }}>
          alerte seuil
        </span>
      )}
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

function FieldCard({ label, filled, children, id, highlighted }) {
  return (
    <div
      id={id}
      className="bg-neutral-900 border rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between transition-colors"
      style={{
        borderColor: highlighted ? AMBER : '#262626',
        boxShadow: highlighted ? `0 0 0 2px ${AMBER}` : 'none',
      }}
    >
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
  const num =
    field === 'glycemie'
      ? glycemieToGL(rawValue, data.D?.glycemie_unit)
      : parseFloat(String(rawValue).replace(',', '.'));
  if (isNaN(num)) return null;
  if (num < range[0]) return 'low';
  if (num > range[1]) return 'high';
  return null;
}

// Repère des éléments qui nécessitent l'attention de l'équipier. Il s'agit d'alertes
// documentaires, pas de diagnostics : une anomalie isolée reste visible et aucune
// absence d'alerte ne permet de conclure à l'absence de détresse.
function computeAlertSummary(data) {
  const results = [];
  const hasReal = (arr, noneValue) => (arr || []).some((v) => v !== noneValue);
  const add = (page, label, reasons) => {
    const details = reasons.filter(Boolean);
    if (details.length > 0) results.push({ page, label, details });
  };

  add('A', 'Voies aériennes', [
    data.A.obstruction === 'non' && 'liberté des voies aériennes : non',
    data.A.obstruction === 'non' &&
      data.A.liberation_effectuee === 'non' &&
      'geste de libération non effectué',
  ]);

  const o2Threshold = o2BottleThreshold(data.B?.o2_bottle_size);
  const o2Pressure = Number(String(data.B?.o2_pressure || '').replace(',', '.'));
  const o2AtReserve =
    data.B?.o2_active === 'oui' &&
    !!data.B?.o2_pressure &&
    o2Threshold !== null &&
    Number.isFinite(o2Pressure) &&
    o2Pressure <= o2Threshold;

  add('B', 'Respiratoire', [
    getAbnormalDirectionPure(data, 'fr', data.B.fr) !== null && `FR ${data.B.fr}/min hors seuil de repérage`,
    getAbnormalDirectionPure(data, 'spo2', data.B.spo2_air) !== null &&
      `SpO2 ${data.B.spo2_air}% sous air hors seuil`,
    getAbnormalDirectionPure(data, 'spo2', data.B.spo2_o2) !== null &&
      `SpO2 ${data.B.spo2_o2}% sous O2 hors seuil`,
    hasReal(data.B.fr_signes, 'aucun') && 'signe(s) respiratoire(s) associé(s)',
    data.B.fr_ample === 'non' && 'amplitude non ample',
    data.B.fr_reguliere === 'non' && 'respiration irrégulière',
    o2AtReserve && `pression O2 au seuil de réserve ou en dessous (${o2Threshold} bars)`,
  ]);

  const paAnormale =
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_gauche_sys) !== null ||
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_droite_sys) !== null;
  add('C', 'Circulatoire', [
    getAbnormalDirectionPure(data, 'fc', data.C.fc) !== null && `FC ${data.C.fc}/min hors seuil de repérage`,
    paAnormale && 'pression artérielle systolique hors seuil de repérage',
    data.C.pouls_sym === 'non' && 'pouls non symétrique',
    data.C.pouls_frappe === 'non' && 'pouls mal frappé',
    data.C.trc === '>2s' && 'TRC > 2 s',
    hasReal(data.C.signes, 'aucun') && 'signe(s) circulatoire(s) associé(s)',
    hasReal(data.C.blood_box, 'non_detecte') && 'blood box positive',
  ]);

  add('D', 'Neurologique', [
    data.D.pci === 'oui' && 'perte de connaissance',
    data.D.pc_repete === 'oui' && 'pertes de connaissance répétées',
    data.D.etat && data.D.etat !== 'A' && `AVPU : ${data.D.etat}`,
    data.D.orientation === 'non' && 'désorientation',
    hasReal(data.D.neuro_signes, 'aucun') && 'signe(s) neurologique(s) associé(s)',
    data.D.pupilles === 'non' && 'pupilles anormales',
    data.D.sens_mains === 'non' && 'sensibilité/motricité des mains anormale',
    data.D.sens_pieds === 'non' && 'sensibilité/motricité des pieds anormale',
    getAbnormalDirectionPure(data, 'glycemie', data.D.glycemie) !== null &&
      `glycémie ${formatValue('glycemie', data.D.glycemie, data)} hors seuil`,
  ]);

  add('E', 'Exposition', [
    getAbnormalDirectionPure(data, 'temperature', data.E.temperature) !== null &&
      `température ${data.E.temperature} °C hors seuil`,
    hasReal(data.E.victime_env_signes, 'aucun') && 'signe(s) associé(s) à une exposition chaude',
  ]);

  const fastPositifs = [
    data.FAST.face === 'positif' && 'Face',
    data.FAST.arm === 'positif' && 'Arm',
    data.FAST.speech === 'positif' && 'Speech',
  ];
  add('FAST', 'FAST (suspicion AVC)', fastPositifs);

  const categoryRanges = PATIENT_CATEGORIES[data.TYPE?.categorie]?.ranges;
  const surveillanceReasons = [];
  (data.SURVEILLANCE?.releves || []).forEach((reading) => {
    const outOfRange = (field, rawValue) => {
      if (!rawValue || !categoryRanges?.[field]) return false;
      const number =
        field === 'glycemie'
          ? glycemieToGL(rawValue, reading.glycemie_unit)
          : Number(String(rawValue).replace(',', '.'));
      const [min, max] = categoryRanges[field];
      return Number.isFinite(number) && (number < min || number > max);
    };
    const abnormalValues = [
      outOfRange('fr', reading.fr) && `FR ${reading.fr}/min`,
      outOfRange('fc', reading.fc) && `FC ${reading.fc}/min`,
      outOfRange('spo2', reading.spo2) &&
        `SpO2 ${reading.spo2}% ${reading.spo2_mode === 'o2' ? 'sous O2' : 'sous air'}`,
      outOfRange('pa_sys', reading.pa_sys) && `PA systolique ${reading.pa_sys} mmHg`,
      outOfRange('temperature', reading.temperature) && `T° ${reading.temperature} °C`,
      outOfRange('glycemie', reading.glycemie) &&
        `Gly ${reading.glycemie} ${reading.glycemie_unit || detectLegacyGlycemieUnit(reading.glycemie)}`,
    ].filter(Boolean);
    if (abnormalValues.length) {
      surveillanceReasons.push(`${reading.heure || 'heure non renseignée'} : ${abnormalValues.join(', ')}`);
    }
  });
  add('SURVEILLANCE', 'Bilan de suivi', surveillanceReasons);

  return results;
}

// Éléments rapportés dans le bilan qui ne constituent pas, à eux seuls, la preuve
// d'une détresse physiologique (un mécanisme ou une circonstance n'est pas une
// détresse confirmée) — affichés séparément comme repères pour la transmission.
function computeRemarkableElements(data) {
  const results = [];
  if (data.X.hemorragie === 'oui') results.push('Hémorragie rapportée');
  if (data.X.trauma === 'oui') results.push('Mécanisme traumatique rapporté');
  if (data.BRULURE.brulure === 'oui') results.push('Brûlure présente');
  if (data.E.lesion === 'oui') results.push('Lésion cachée détectée');
  if (data.E.coince === 'oui') results.push('Victime coincée / comprimée');
  if (data.E.amputation === 'oui') results.push('Amputation');
  if (data.E.victime_env === 'froid') results.push('Victime retrouvée au froid');
  return results;
}

// Détecte les données importantes manquantes ou incohérentes par croisement de champs
// déjà existants — n'invente jamais une information, se contente de signaler l'absence.
function computeMissingChecks(data) {
  const items = [];
  const add = (page, message, field) => {
    if (page && message && !items.some((item) => item.page === page && item.message === message)) {
      items.push({ page, message, field: field || null });
    }
  };
  const hasReal = (arr) => (arr || []).some((v) => v !== 'aucun');
  const missingLabels = (pairs) => pairs.filter(([, value]) => !value).map(([label]) => label);
  const firstMissingField = (pairs) => {
    const hit = pairs.find(([, value]) => !value);
    return hit ? hit[2] : null;
  };

  if (!data.TYPE?.categorie) add('TYPE', 'Catégorie de victime non renseignée', 'TYPE_categorie');

  const xPairs = [
    ['traumatisme', data.X?.trauma, 'X_trauma'],
    ['hémorragie', data.X?.hemorragie, 'X_hemorragie'],
  ];
  const xMissing = missingLabels(xPairs);
  if (xMissing.length) add('X', `X non évalué : ${xMissing.join(', ')}`, firstMissingField(xPairs));

  const aPairs = [['liberté des voies aériennes', data.A?.obstruction, 'A_obstruction']];
  const aMissing = missingLabels(aPairs);
  if (data.A?.obstruction === 'non' && !data.A?.liberation_effectuee) {
    aMissing.push('libération effectuée');
    aPairs.push(['libération effectuée', data.A?.liberation_effectuee, 'A_liberation_effectuee']);
  }
  if (aMissing.length) add('A', `A non évalué : ${aMissing.join(', ')}`, firstMissingField(aPairs));

  const bPairs = [
    ['FR', data.B?.fr, 'B_fr'],
    ['amplitude', data.B?.fr_ample, 'B_fr_ample'],
    ['régularité', data.B?.fr_reguliere, 'B_fr_reguliere'],
    ['SpO2 sous air', data.B?.spo2_air, 'B_spo2_air'],
  ];
  const bMissing = missingLabels(bPairs);
  if (!(data.B?.fr_signes || []).length) {
    bMissing.push('signes associés');
    bPairs.push(['signes associés', null, 'B_fr_signes']);
  }
  if (bMissing.length) add('B', `B incomplet : ${bMissing.join(', ')}`, firstMissingField(bPairs));

  const hasCompletePa =
    (!!data.C?.pa_gauche_sys && !!data.C?.pa_gauche_dia) ||
    (!!data.C?.pa_droite_sys && !!data.C?.pa_droite_dia);
  const cPairs = [
    ['FC', data.C?.fc, 'C_fc'],
    ['pouls symétrique', data.C?.pouls_sym, 'C_pouls_sym'],
    ['pouls bien frappé', data.C?.pouls_frappe, 'C_pouls_frappe'],
    ['TRC', data.C?.trc, 'C_trc'],
  ];
  const cMissing = missingLabels(cPairs);
  if (!hasCompletePa) {
    cMissing.push('au moins une PA complète');
    cPairs.push(['au moins une PA complète', null, 'C_pa_gauche_sys']);
  }
  if (!(data.C?.signes || []).length) {
    cMissing.push('signes associés');
    cPairs.push(['signes associés', null, 'C_signes']);
  }
  if (cMissing.length) add('C', `C incomplet : ${cMissing.join(', ')}`, firstMissingField(cPairs));

  const dPairs = [
    ['PCI', data.D?.pci, 'D_pci'],
    ['état de conscience', data.D?.etat, 'D_etat'],
    ['orientation', data.D?.orientation, 'D_orientation'],
    ['pupilles', data.D?.pupilles, 'D_pupilles'],
    ['sensibilité/motricité mains', data.D?.sens_mains, 'D_sens_mains'],
    ['sensibilité/motricité pieds', data.D?.sens_pieds, 'D_sens_pieds'],
  ];
  const dMissing = missingLabels(dPairs);
  if (!(data.D?.neuro_signes || []).length) {
    dMissing.push('signes associés');
    dPairs.push(['signes associés', null, 'D_neuro_signes']);
  }
  if (dMissing.length) add('D', `D incomplet : ${dMissing.join(', ')}`, firstMissingField(dPairs));

  const ePairs = [
    ['température', data.E?.temperature, 'E_temperature'],
    ['lésion cachée', data.E?.lesion, 'E_lesion'],
    ['victime coincée/comprimée', data.E?.coince, 'E_coince'],
    ['amputation', data.E?.amputation, 'E_amputation'],
  ];
  const eMissing = missingLabels(ePairs);
  if (eMissing.length) add('E', `E incomplet : ${eMissing.join(', ')}`, firstMissingField(ePairs));

  if (!data.BRULURE?.brulure) add('BRULURE', 'Évaluation de brûlure non renseignée', 'BRULURE_brulure');

  if (data.B.o2_active === 'oui') {
    if (!data.B.o2_interface) add('B', 'Interface O2 à renseigner', 'B_o2_interface');
    if (!data.B.o2_start_time) add('B', 'Heure de début O2 à renseigner', 'B_o2_start_time');
    if (!data.B.o2_bottle_size) add('B', 'Taille de bouteille O2 à renseigner', 'B_o2_bottle_size');
    if (!data.B.o2_pressure) add('B', 'Pression de la bouteille O2 à renseigner', 'B_o2_pressure');
    if (!data.B.o2_debit) add('B', 'Débit O2 à renseigner', 'B_o2_debit');
    if (!data.B.spo2_o2) add('B', 'SpO2 sous O2 non renseignée', 'B_spo2_o2');
  }
  (data.B?.o2_sessions || []).forEach((session, index) => {
    const missing = missingLabels([
      ['interface', session.interface],
      ['heure de début', session.start_time],
      ['heure de fin', session.end_time],
      ['taille de bouteille', session.bottle_size],
      ['pression', session.pressure],
      ['débit', session.debit],
      ['SpO2', session.spo2],
    ]);
    if (missing.length) add('B', `Épisode O2 ${index + 1} incomplet : ${missing.join(', ')}`);
    if (session.start_time && !isValidTime(session.start_time)) add('B', `Épisode O2 ${index + 1} : heure de début invalide`);
    if (session.end_time && !isValidTime(session.end_time)) add('B', `Épisode O2 ${index + 1} : heure de fin invalide`);
  });

  if (data.X.garrot_pose === 'oui' && !data.X.garrot_heure) {
    add('X', 'Heure de pose du garrot manquante', 'X_garrot_heure');
  }
  if (data.E.amputation === 'oui' && data.E.amputation_garrot === 'oui' && !data.E.amputation_garrot_heure) {
    add('E', 'Heure de pose du garrot (amputation) manquante', 'E_amputation_garrot_heure');
  }

  if (data.X.hemorragie === 'oui' && (!data.X.hemorragie_sites || data.X.hemorragie_sites.length === 0)) {
    add('X', "Localisation de l'hémorragie non renseignée", 'X_hemorragie_sites');
  }

  if (data.E.amputation === 'oui' && !data.E.amputation_localisation) {
    add('E', "Localisation de l'amputation à renseigner", 'E_amputation_localisation');
  }

  if (data.E.amputation_segment_retrouve === 'oui' && !data.E.amputation_conditionnement) {
    add('E', 'Conditionnement du segment non renseigné', 'E_amputation_conditionnement');
  }

  const fastPositif = data.FAST.face === 'positif' || data.FAST.arm === 'positif' || data.FAST.speech === 'positif';
  if (fastPositif && !data.FAST.temps && !data.FAST.temps_choice) {
    add('FAST', "Heure d'apparition des signes FAST à renseigner", 'FAST_temps');
  }
  const fastStarted = !!data.FAST?.face || !!data.FAST?.arm || !!data.FAST?.speech;
  if (fastStarted && (!data.FAST?.face || !data.FAST?.arm || !data.FAST?.speech)) {
    add('FAST', 'FAST commencé mais incomplet', 'FAST_face');
  }

  if (hasReal(data.D.neuro_signes) && !data.D.neuro_signes_depuis_heure) {
    add('D', "Heure d'apparition des signes neurologiques manquante", 'D_neuro_signes_depuis_heure');
  }
  if (hasReal(data.B.fr_signes) && !data.B.fr_signes_heure) {
    add('B', "Heure d'apparition des signes respiratoires manquante", 'B_fr_signes_heure');
  }
  if (hasReal(data.C.signes) && !data.C.signes_heure) {
    add('C', "Heure d'apparition des signes circulatoires manquante", 'C_signes_heure');
  }

  if (data.D.pci === 'oui' && !data.D.pci_duree) {
    add('D', 'Durée de la PCI non renseignée', 'D_pci_duree');
  }
  if (data.D.pc_repete === 'oui' && !data.D.pc_nombre) {
    add('D', 'Nombre de pertes de connaissance non renseigné', 'D_pc_nombre');
  }

  if (data.BRULURE.brulure === 'oui') {
    if (!data.BRULURE.brulure_etendue) {
      add('BRULURE', 'Étendue de la brûlure non renseignée', 'BRULURE_brulure_etendue');
    }
    const hasLoc =
      (data.BRULURE.brulure_loc_choices && data.BRULURE.brulure_loc_choices.length > 0) || !!data.BRULURE.brulure_loc;
    if (!hasLoc) {
      add('BRULURE', 'Localisation de la brûlure non renseignée', 'BRULURE_brulure_loc');
    }
  }

  const timeFields = [
    ['X', 'Heure de pose du garrot', data.X?.garrot_heure],
    ['B', "Heure d'apparition respiratoire", data.B?.fr_signes_heure],
    ['B', 'Heure de début O2', data.B?.o2_start_time],
    ['C', "Heure d'apparition circulatoire", data.C?.signes_heure],
    ['D', "Heure d'apparition neurologique", data.D?.neuro_signes_depuis_heure],
    ['E', 'Heure de début de compression', data.E?.coince_depuis],
    ['E', 'Heure du garrot d’amputation', data.E?.amputation_garrot_heure],
    ['FAST', "Heure d'apparition FAST", data.FAST?.temps],
    ['SAMPLER', 'Heure de dernière prise orale', data.SAMPLER?.sampler_l_time],
    ['SAMPLER', "Heure de l'événement", data.SAMPLER?.sampler_e_time],
  ];
  timeFields.forEach(([page, label, value]) => {
    if (value && !isValidTime(value)) add(page, `${label} invalide (format attendu : HH:MM)`);
  });

  const numericChecks = [
    ['B', 'FR', data.B?.fr, 1, 100],
    ['B', 'SpO2 sous air', data.B?.spo2_air, 1, 100],
    ['B', 'SpO2 sous O2', data.B?.spo2_o2, 1, 100],
    ['B', 'Pression O2', data.B?.o2_pressure, 1, 300],
    ['B', 'Débit O2', data.B?.o2_debit, 0.1, 100],
    ['C', 'FC', data.C?.fc, 1, 300],
    ['C', 'PA gauche systolique', data.C?.pa_gauche_sys, 1, 300],
    ['C', 'PA gauche diastolique', data.C?.pa_gauche_dia, 1, 200],
    ['C', 'PA droite systolique', data.C?.pa_droite_sys, 1, 300],
    ['C', 'PA droite diastolique', data.C?.pa_droite_dia, 1, 200],
    ['E', 'Température', data.E?.temperature, 15, 45],
    ['BRULURE', 'Étendue de brûlure', data.BRULURE?.brulure_etendue, 0, 100],
  ];
  numericChecks.forEach(([page, label, value, min, max]) => {
    if (value && !isNumberInRange(value, min, max)) add(page, `${label} : valeur invalide`);
  });
  if (data.D?.glycemie && !isPositiveNumber(data.D.glycemie)) add('D', 'Glycémie : valeur invalide');

  [
    ['gauche', data.C?.pa_gauche_sys, data.C?.pa_gauche_dia],
    ['droite', data.C?.pa_droite_sys, data.C?.pa_droite_dia],
  ].forEach(([side, sysRaw, diaRaw]) => {
    if (!sysRaw || !diaRaw) return;
    const sys = Number(String(sysRaw).replace(',', '.'));
    const dia = Number(String(diaRaw).replace(',', '.'));
    if (Number.isFinite(sys) && Number.isFinite(dia) && dia >= sys) {
      add('C', `PA ${side} incohérente : la diastolique doit être inférieure à la systolique`);
    }
  });

  (data.SURVEILLANCE?.releves || []).forEach((reading, index) => {
    const prefix = `Bilan de suivi — relevé ${index + 1}`;
    if (!isValidTime(reading.heure)) add('SURVEILLANCE', `${prefix} : heure invalide`);
    const readingChecks = [
      [reading.fr, 1, 100],
      [reading.fc, 1, 300],
      [reading.spo2, 1, 100],
      [reading.pa_sys, 1, 300],
      [reading.pa_dia, 1, 200],
      [reading.temperature, 15, 45],
    ];
    if (readingChecks.some(([value, min, max]) => value && !isNumberInRange(value, min, max))) {
      add('SURVEILLANCE', `${prefix} : une constante est invalide`);
    }
    if (reading.pa_sys && reading.pa_dia) {
      const sys = Number(String(reading.pa_sys).replace(',', '.'));
      const dia = Number(String(reading.pa_dia).replace(',', '.'));
      if (Number.isFinite(sys) && Number.isFinite(dia) && dia >= sys) {
        add('SURVEILLANCE', `${prefix} : PA incohérente (diastolique ≥ systolique)`);
      }
    }
    if (reading.glycemie && !isPositiveNumber(reading.glycemie)) add('SURVEILLANCE', `${prefix} : glycémie invalide`);
  });
  (data.SAMPLER?.pqrst_list || []).forEach((entry, index) => {
    if (entry.t_heure && !isValidTime(entry.t_heure)) add('SAMPLER', `PQRST ${index + 1} : heure de début invalide`);
    if (entry.t_duree && !isPositiveNumber(entry.t_duree)) add('SAMPLER', `PQRST ${index + 1} : durée invalide`);
  });

  [
    ['B', 'signes respiratoires', data.B?.fr_signes],
    ['C', 'signes circulatoires', data.C?.signes],
    ['D', 'signes neurologiques', data.D?.neuro_signes],
    ['SAMPLER', 'traitements', data.SAMPLER?.sampler_m_choices],
    ['SAMPLER', 'antécédents', data.SAMPLER?.sampler_p_choices],
  ].forEach(([page, label, values]) => {
    if ((values || []).includes('aucun') && (values || []).some((value) => value !== 'aucun')) {
      add(page, `${page} incohérent : « Aucun » est sélectionné avec d'autres ${label}`);
    }
  });
  if (
    data.SAMPLER?.allergy_status !== 'oui' &&
    ((data.SAMPLER?.sampler_a_choices || []).length > 0 ||
      (data.SAMPLER?.allergy_reactions || []).length > 0 ||
      !!data.SAMPLER?.sampler_a)
  ) {
    add('SAMPLER', 'SAMPLER incohérent : détails d’allergie présents sans allergie confirmée');
  }

  return items;
}

function computeMissingInfo(data) {
  return computeMissingChecks(data).map((item) => item.message);
}

// Les contrôles suggérés par croisement ne doivent pas rendre le bilan « incomplet ».
// Ils restent visibles, actionnables et séparés des champs réellement manquants.
function computeRecommendations(data) {
  const items = [];
  const add = (page, message) => {
    if (page && message && !items.some((item) => item.page === page && item.message === message)) {
      items.push({ page, message });
    }
  };
  const hasReal = (arr) => (arr || []).some((value) => value !== 'aucun');

  const fastIndicated =
    hasReal(data.D?.neuro_signes) ||
    data.D?.sens_mains === 'non' ||
    data.D?.sens_pieds === 'non' ||
    (data.SAMPLER?.symptom_choices || []).some((value) =>
      ['trouble_parole', 'faiblesse_membre', 'troubles_visuels'].includes(value)
    );
  const fastStarted = !!data.FAST?.face || !!data.FAST?.arm || !!data.FAST?.speech;
  if (fastIndicated && !fastStarted) {
    add('FAST', 'Éléments neurologiques renseignés — FAST à vérifier');
  }

  if (!data.D?.glycemie) {
    const symptoms = data.SAMPLER?.symptom_choices || [];
    const hasMalaise = symptoms.includes('malaise_faiblesse');
    const hasAlcool =
      (data.SAMPLER?.sampler_l_nature || []).includes('alcool') ||
      (data.SAMPLER?.sampler_r_choices || []).includes('alcool');
    const hasDiabetesContext =
      (data.SAMPLER?.sampler_p_choices || []).includes('diabete') ||
      (data.SAMPLER?.sampler_m_choices || []).some((value) =>
        ['antidiabetique', 'insuline'].includes(value)
      );
    const hasNeurologicContext =
      data.D?.pci === 'oui' ||
      data.D?.pc_repete === 'oui' ||
      ['V', 'P', 'U'].includes(data.D?.etat) ||
      hasReal(data.D?.neuro_signes);
    const reasons = [
      hasMalaise && 'malaise/faiblesse',
      hasAlcool && 'alcool',
      hasDiabetesContext && 'diabète ou traitement associé',
      hasNeurologicContext && 'élément neurologique ou conscience altérée',
    ].filter(Boolean);
    if (reasons.length) {
      add('D', `Glycémie non renseignée — contrôle à envisager (${reasons.join(', ')}).`);
    }
  }

  return items;
}

// Associe chaque contrôle documentaire à la page où il peut être corrigé. Cette
// correspondance alimente les raccourcis du récap et le mode « champs manquants ».
function missingItemPage(message) {
  if (!message) return null;
  if (/^Catégorie/.test(message)) return 'TYPE';
  if (/FAST/i.test(message)) return 'FAST';
  if (/Surveillance|Bilan de suivi/i.test(message)) return 'SURVEILLANCE';
  if (/SAMPLER|PQRST|dernière prise orale|événement/i.test(message)) return 'SAMPLER';
  if (/brûlure/i.test(message)) return 'BRULURE';
  if (/^X |hémorragie|garrot/i.test(message) && !/amputation/i.test(message)) return 'X';
  if (/^A non évalué/.test(message)) return 'A';
  if (
    /^B |respiratoire|SpO2|Interface O2|Heure de début O2|Taille de bouteille O2|Pression(?: de la bouteille)? O2|Débit O2|Épisode O2/i.test(
      message
    )
  )
    return 'B';
  if (/^C |circulatoire|^FC|^PA /i.test(message)) return 'C';
  if (/^D |neurologique|PCI|connaissance|Glycémie/i.test(message)) return 'D';
  if (/^E |Température|compression|amputation|segment/i.test(message)) return 'E';
  return null;
}

function getMissingPages(data) {
  return uniqueValues(computeMissingChecks(data).map((item) => item.page));
}

// Navigation testable du récapitulatif vers les corrections. Une ligne précise
// revient toujours au récap ; le bouton global parcourt les autres pages incomplètes.
function resolveMissingReviewNext(mode, currentStep, data) {
  const recapStep = STEPS.indexOf('RECAP');
  if (mode === 'single') return { nextStep: recapStep, nextMode: null };
  if (mode !== 'all') return null;

  const missingIndexes = getMissingPages(data)
    .map((page) => STEPS.indexOf(page))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const nextMissing = missingIndexes.find((index) => index > currentStep);
  if (nextMissing !== undefined) return { nextStep: nextMissing, nextMode: 'all' };
  const earlierMissing = missingIndexes.find((index) => index < currentStep);
  if (earlierMissing !== undefined) return { nextStep: earlierMissing, nextMode: 'all' };
  return { nextStep: recapStep, nextMode: null };
}

function sectionHasMeaningfulData(page, data) {
  if (page === 'SURVEILLANCE') return (data.SURVEILLANCE?.releves || []).length > 0;
  const value = data[page];
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (key.startsWith('sampler_auto_') || key.startsWith('sampler_dismissed_')) return false;
    if (Array.isArray(item)) return item.length > 0;
    return item !== '' && item !== null && item !== undefined;
  });
}

function getStepStatus(page, data) {
  const missingPages = getMissingPages(data);
  const hasAlert = computeAlertSummary(data).some((alert) => alert.page === page);
  if (hasAlert) return 'alert';
  if (page === 'RECAP') return missingPages.length ? 'incomplete' : 'complete';
  if (missingPages.includes(page)) return 'incomplete';
  if (sectionHasMeaningfulData(page, data)) return 'complete';
  return 'empty';
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
  const o2WasUsed = data.B.o2_active === 'oui' || (data.B.o2_sessions || []).length > 0;
  if (o2WasUsed) {
    verifier.push('Bouteille O2 (pression / autonomie) à vérifier');
    const usedInterfaces = uniqueValues([
      data.B.o2_active === 'oui' && data.B.o2_interface,
      ...(data.B.o2_sessions || []).map((session) => session.interface),
    ]).filter(Boolean);
    if (usedInterfaces.length) {
      usedInterfaces.forEach((value) => {
        const label = O2_INTERFACE_OPTIONS.find((option) => option.value === value)?.label;
        if (label) remplacer.push(label);
      });
    } else verifier.push('Interface O2 utilisée à vérifier');
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

// Regroupement des champs SAMPLER par lettre, pour n'afficher qu'une seule case par
// lettre dans le récap (au lieu d'une grille de petites cases mélangeant tout).
const SAMPLER_LETTER_GROUPS = [
  { letter: 'S', title: 'Signes et symptômes', fields: ['symptom_choices', 'symptom_other'] },
  { letter: 'A', title: 'Allergies', fields: ['allergy_status', 'sampler_a_choices', 'allergy_reactions', 'sampler_a'] },
  { letter: 'M', title: 'Médicaments / traitements', fields: ['sampler_m_choices', 'sampler_m', 'meds_taken_today'] },
  { letter: 'P', title: 'Passé médical', fields: ['sampler_p_choices', 'sampler_p'] },
  { letter: 'L', title: 'Dernière prise orale', fields: ['sampler_l_time', 'sampler_l_choice', 'sampler_l_nature', 'sampler_l'] },
  { letter: 'E', title: 'Événement', fields: ['sampler_e_choices', 'sampler_e_time', 'sampler_e'] },
  { letter: 'R', title: 'Facteurs de risque', fields: ['sampler_r_choices', 'sampler_r'] },
];

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
  const missingInfo = computeMissingInfo(data);
  if (missingInfo.length > 0) {
    lines.push('⚠ À COMPLÉTER AVANT TRANSMISSION');
    missingInfo.forEach((item) => lines.push(`  ${item}`));
    lines.push('');
  }
  if (data.TYPE && data.TYPE.categorie) {
    lines.push(`Catégorie : ${PATIENT_CATEGORIES[data.TYPE.categorie].label}`);
  }
  if (data.TYPE && data.TYPE.commentaire) {
    lines.push(`Commentaire : ${data.TYPE.commentaire}`);
  }
  lines.push('');
  ['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].forEach((page) => {
    const rows = PAGE_FIELDS[page]
      .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data), data) }))
      .filter((r) => r.v !== null);
    const pqrstList = page === 'SAMPLER' ? data.SAMPLER.pqrst_list || [] : [];
    lines.push(`${PAGE_TITLES[page] || page}`);
    if (rows.length === 0 && pqrstList.length === 0) {
      lines.push('  Bilan non effectué / non renseigné');
      lines.push('');
      return;
    }
    if (page === 'SAMPLER') {
      SAMPLER_LETTER_GROUPS.forEach((group) => {
        const letterRows = group.fields
          .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data), data) }))
          .filter((r) => r.v !== null);
        const isS = group.letter === 'S';
        const hasContent = letterRows.length > 0 || (isS && pqrstList.length > 0);
        lines.push(`  ${group.letter} — ${group.title}`);
        if (!hasContent) {
          lines.push('    Non renseigné');
          return;
        }
        letterRows.forEach(({ f, v }) => lines.push(`    ${FIELD_LABELS[f]} : ${v}`));
        if (isS) {
          pqrstList.forEach((entry, i) => {
            const n = i + 1;
            lines.push(`    ${entry.title || `PQRST ${n}`}`);
            formatPqrstEntry(entry, n).forEach((row) => lines.push(`      ${row.num} ${row.label} : ${row.value}`));
          });
        }
      });
      lines.push('');
      return;
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
  const o2Sessions = data.B?.o2_sessions || [];
  if (o2Sessions.length > 0) {
    lines.push('HISTORIQUE O2');
    o2Sessions.forEach((session, index) => lines.push(`  ${index + 1}. ${formatO2Session(session)}`));
    lines.push('');
  }
  const surveillanceReadings = data.SURVEILLANCE?.releves || [];
  if (surveillanceReadings.length > 0) {
    lines.push('BILAN DE SUIVI');
    surveillanceReadings.forEach((reading, index) => {
      const previous = index > 0 ? surveillanceReadings[index - 1] : null;
      const delta = formatSurveillanceDelta(reading, previous);
      const elapsed = surveillanceElapsedLabel(reading, previous);
      lines.push(
        `  ${index + 1}. ${reading.heure || 'Heure non renseignée'}${elapsed ? ` (${elapsed})` : ''} : ${formatSurveillanceReading(reading)}${delta ? ` | Évolution : ${delta}` : ''}`
      );
    });
    lines.push('');
  }
  lines.push('SYNTHÈSE TRANSMISSION');
  const transmissionHighlights = getTransmissionHighlights(data);
  if (transmissionHighlights.length > 0) {
    transmissionHighlights.forEach((item) => lines.push(`  ${item}`));
  } else {
    lines.push('  Aucun élément de synthèse renseigné');
  }
  lines.push('');

  lines.push('ALERTES AUTOMATIQUES');
  const summary = computeAlertSummary(data);
  if (summary.length === 0) {
    lines.push(
      missingInfo.length > 0
        ? '  Aucune alerte automatique sur les seules données renseignées — bilan incomplet'
        : '  Aucune alerte automatique détectée sur les données renseignées'
    );
  } else {
    summary.forEach((item) => {
      lines.push(`  ALERTE ${item.label}`);
      item.details.forEach((detail) => lines.push(`    ${detail}`));
    });
  }
  lines.push('');

  const recommendations = computeRecommendations(data);
  const automationAudit = getAutomationAudit(data);
  if (recommendations.length > 0 || automationAudit.length > 0) {
    lines.push('AUTOMATISATIONS ET SUGGESTIONS');
    recommendations.forEach((item) => lines.push(`  Suggestion : ${item.message}`));
    automationAudit.forEach((item) => lines.push(`  ${item}`));
    lines.push('');
  }

  const remarkable = computeRemarkableElements(data);
  if (remarkable.length > 0) {
    lines.push('ÉLÉMENTS REMARQUABLES DU BILAN');
    remarkable.forEach((item) => lines.push(`  ${item}`));
    lines.push('');
  }
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

function sanitizePdfText(value) {
  return String(value)
    .replace(/⚠/g, 'ATTENTION')
    .replace(/[→↦]/g, '->')
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ');
}

async function exportAndSharePdf(form, patientNum, recordedAt = Date.now()) {
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(sanitizePdfText(`Bilan de l’équipier n°${patientNum}`), 14, y);
  doc.setFont(undefined, 'normal');
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(new Date(recordedAt).toLocaleString('fr-FR'), 14, y);
  doc.setTextColor(0);
  y += 10;

  const lines = buildRecapLines(form);
  doc.setFontSize(11);
  lines.forEach((line) => {
    if (!line) {
      y += 3;
      return;
    }
    const indented = line.startsWith(' ');
    const x = indented ? 18 : 14;
    const safeLine = sanitizePdfText(line.trimStart());
    const wrappedLines = doc.splitTextToSize(safeLine, pageWidth - x - 14);
    if (!indented) {
      doc.setFont(undefined, 'bold');
    }
    wrappedLines.forEach((wrappedLine) => {
      if (y > pageHeight - 15) {
        doc.addPage();
        y = 18;
      }
      doc.text(wrappedLine, x, y);
      y += 5.5;
    });
    doc.setFont(undefined, 'normal');
  });

  const base64 = arrayBufferToBase64(doc.output('arraybuffer'));
  const fileName = `bilan-equipier-${patientNum}-${Date.now()}.pdf`;
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

function buildCompactSms(form, patientNum, recordedAt = Date.now()) {
  const lines = [`BILAN EQUIPIER N°${patientNum} - ${new Date(recordedAt).toLocaleString('fr-FR')}`];
  if (form.TYPE?.categorie) lines.push(`Victime: ${PATIENT_CATEGORIES[form.TYPE.categorie]?.label}`);

  const missingInfo = computeMissingInfo(form);
  if (missingInfo.length > 0) lines.push(`INCOMPLET: ${missingInfo.length} point(s) à vérifier`);

  const alerts = computeAlertSummary(form);
  alerts.forEach((alert) => lines.push(`ALERTE ${alert.label}: ${alert.details.join(', ')}`));

  computeRecommendations(form)
    .slice(0, 3)
    .forEach((item) => lines.push(`SUGGESTION: ${item.message}`));

  const highlights = getTransmissionHighlights(form);
  highlights.slice(0, 10).forEach((item) => lines.push(item.replace(/^⚠\s*/, 'ATTENTION: ')));

  const constants = [
    form.B?.fr && `FR ${form.B.fr}/min`,
    form.C?.fc && `FC ${form.C.fc}/min`,
    (form.C?.pa_gauche_sys || form.C?.pa_droite_sys) &&
      `PA ${form.C.pa_gauche_sys || form.C.pa_droite_sys}/${form.C.pa_gauche_dia || form.C.pa_droite_dia || '?'}`,
    form.B?.spo2_air && `SpO2 AA ${form.B.spo2_air}%`,
    form.E?.temperature && `T° ${form.E.temperature}°C`,
    form.D?.glycemie && `Gly ${formatValue('glycemie', form.D.glycemie, form)}`,
  ].filter(Boolean);
  if (constants.length) lines.push(`Constantes: ${constants.join(' | ')}`);

  let text = lines.join('\n');
  const maxLength = 1800;
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 34)}\n[Résumé tronqué - voir le PDF complet]`;
  return text;
}

function sendBilanBySms(form, patientNum, recordedAt) {
  const text = buildCompactSms(form, patientNum, recordedAt);
  const url = `sms:?body=${encodeURIComponent(text)}`;
  window.open(url, '_system');
}

function ExportButtons({ form, patientNum, recordedAt }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const confirmIncompleteExport = () => {
    const missingCount = computeMissingInfo(form).length;
    if (missingCount === 0) return true;
    return window.confirm(
      `${missingCount} point(s) restent à vérifier. Exporter quand même ce bilan incomplet ?`
    );
  };

  const handlePdf = async () => {
    if (!confirmIncompleteExport()) return;
    setWorking(true);
    setError('');
    try {
      await exportAndSharePdf(form, patientNum, recordedAt);
    } catch (e) {
      setError(e.message || "Erreur lors de l'export PDF");
    }
    setWorking(false);
  };

  const handleSms = () => {
    if (!confirmIncompleteExport()) return;
    setError('');
    try {
      sendBilanBySms(form, patientNum, recordedAt);
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

  // Motif / symptômes
  const symptoms = data.SAMPLER?.symptom_choices || [];
  const symptomLabels = symptoms.map((v) => SYMPTOME_OPTIONS.find((o) => o.value === v)?.label).filter(Boolean);
  if (symptomLabels.length) items.push(`Motif / symptômes : ${symptomLabels.join(', ')}`);

  // Circonstances de l'événement
  const evenements = data.SAMPLER?.sampler_e_choices || [];
  const eventLabels = evenements.map((v) => EVENEMENT_OPTIONS.find((o) => o.value === v)?.label).filter(Boolean);
  if (eventLabels.length) items.push(`Circonstances : ${eventLabels.join(', ')}`);

  // Hémorragie
  if (data.X?.hemorragie === 'oui') {
    const sites = (data.X.hemorragie_sites || [])
      .map((v) => HEMORRAGIE_SITES.find((o) => o.value === v)?.label)
      .filter(Boolean);
    items.push(`Hémorragie${sites.length ? ' : ' + sites.join(', ') : ' (localisation non renseignée)'}`);
  }

  // Garrot(s) et heure de pose
  if (data.X?.garrot_pose === 'oui') {
    items.push(`Garrot posé${data.X.garrot_heure ? ' à ' + data.X.garrot_heure : ' (heure non renseignée)'}`);
  }
  if (data.E?.amputation === 'oui' && data.E?.amputation_garrot === 'oui') {
    items.push(
      `Garrot amputation posé${data.E.amputation_garrot_heure ? ' à ' + data.E.amputation_garrot_heure : ' (heure non renseignée)'}`
    );
  }

  // Constantes anormales / importantes
  const abnormalConsts = [];
  if (getAbnormalDirectionPure(data, 'fr', data.B?.fr) !== null) abnormalConsts.push(`FR ${data.B.fr}/min`);
  if (getAbnormalDirectionPure(data, 'fc', data.C?.fc) !== null) abnormalConsts.push(`FC ${data.C.fc}/min`);
  if (getAbnormalDirectionPure(data, 'temperature', data.E?.temperature) !== null)
    abnormalConsts.push(`Température ${data.E.temperature}°C`);
  if (getAbnormalDirectionPure(data, 'glycemie', data.D?.glycemie) !== null)
    abnormalConsts.push(`Glycémie ${formatValue('glycemie', data.D.glycemie, data)}`);
  const paSys = data.C?.pa_gauche_sys || data.C?.pa_droite_sys;
  if (
    (getAbnormalDirectionPure(data, 'pa_sys', data.C?.pa_gauche_sys) !== null ||
      getAbnormalDirectionPure(data, 'pa_sys', data.C?.pa_droite_sys) !== null) &&
    paSys
  ) {
    abnormalConsts.push(`TA systolique ${paSys} mmHg`);
  }
  if (abnormalConsts.length) items.push(`Constantes anormales : ${abnormalConsts.join(', ')}`);

  // Évolution de la SpO2 (sous air vs sous O2) — plutôt que la seule première valeur
  if (data.B?.spo2_air && data.B?.spo2_o2) {
    const debitTxt = data.B.o2_debit ? ` ${data.B.o2_debit} L/min` : '';
    items.push(`SpO2 : ${data.B.spo2_air}% AA → ${data.B.spo2_o2}% sous O2${debitTxt}`);
  } else if (data.B?.spo2_air) {
    items.push(`SpO2 ${data.B.spo2_air}% sous air`);
  } else if (data.B?.spo2_o2) {
    items.push(`SpO2 ${data.B.spo2_o2}% sous O2${data.B.o2_debit ? ' ' + data.B.o2_debit + ' L/min' : ''}`);
  }

  // O2 et débit, si non déjà mentionné via l'évolution de la SpO2
  if (data.B?.o2_active === 'oui' && !data.B?.spo2_o2 && data.B?.o2_debit) {
    items.push(`O2 en cours : ${data.B.o2_debit} L/min`);
  }
  if (data.B?.o2_active === 'oui') {
    const interfaceLabel = O2_INTERFACE_OPTIONS.find((option) => option.value === data.B.o2_interface)?.label;
    const details = [interfaceLabel, data.B.o2_start_time && `début ${data.B.o2_start_time}`].filter(Boolean);
    if (details.length) items.push(`O2 : ${details.join(' — ')}`);
  }
  (data.B?.o2_sessions || []).forEach((session, index) => {
    items.push(`O2 épisode ${index + 1} : ${formatO2Session(session)}`);
  });

  // État neurologique
  const neuroFindings = [];
  if (data.D?.pci === 'oui') neuroFindings.push(`PCI${data.D.pci_duree ? ' (' + data.D.pci_duree + ' min)' : ''}`);
  if (data.D?.etat && data.D.etat !== 'A') neuroFindings.push(`Conscience : ${data.D.etat}`);
  if (data.D?.orientation === 'non') neuroFindings.push('Désorienté');
  if (neuroFindings.length) items.push(`État neurologique : ${neuroFindings.join(', ')}`);

  // FAST positif
  if (data.FAST?.face === 'positif' || data.FAST?.arm === 'positif' || data.FAST?.speech === 'positif') {
    const heure = data.FAST.temps || data.FAST.temps_choice;
    items.push(`FAST positif${heure ? ' — apparition ' + heure : ' (heure non renseignée)'}`);
  }

  // Douleur et EVA maximale
  const highEva = (data.SAMPLER?.pqrst_list || [])
    .filter((p) => p.s !== '' && !Number.isNaN(Number(p.s)))
    .sort((a, b) => Number(b.s) - Number(a.s))[0];
  if (highEva) items.push(`${highEva.title || 'Douleur'} — EVA ${highEva.s}/10`);

  // Anticoagulant / antiagrégant
  const meds = data.SAMPLER?.sampler_m_choices || [];
  if (meds.includes('anticoagulant')) items.push('⚠ Anticoagulant');
  if (meds.includes('antiagregant')) items.push('⚠ Antiagrégant');

  // Antécédents réellement pertinents
  const antecedents = data.SAMPLER?.sampler_p_choices || [];
  const major = antecedents.filter((v) =>
    ['cardiopathie', 'infarctus_sca', 'insuffisance_cardiaque', 'trouble_rythme', 'avc_ait', 'epilepsie', 'diabete'].includes(v)
  );
  if (major.length)
    items.push(`ATCD : ${major.map((v) => ANTECEDENTS_OPTIONS.find((o) => o.value === v)?.label || v).join(', ')}`);

  // Heures d'apparition renseignées
  const heures = [];
  if (data.B?.fr_signes_heure) heures.push(`respi ${data.B.fr_signes_heure}`);
  if (data.C?.signes_heure) heures.push(`circu ${data.C.signes_heure}`);
  if (data.D?.neuro_signes_depuis_heure) heures.push(`neuro ${data.D.neuro_signes_depuis_heure}`);
  if (heures.length) items.push(`Heures d'apparition : ${heures.join(', ')}`);

  const surveillance = data.SURVEILLANCE?.releves || [];
  if (surveillance.length > 0) {
    const latest = surveillance[surveillance.length - 1];
    items.push(`Dernier relevé (${latest.heure || 'heure non renseignée'}) : ${formatSurveillanceReading(latest)}`);
  }

  return items;
}

function getAutomationAudit(data) {
  const items = [];
  const sampler = data.SAMPLER || {};
  const addAutoValues = (field, options, targetLabel) => {
    (sampler.sampler_auto_links?.[field] || []).forEach((value) => {
      const label = options.find((option) => option.value === value)?.label || value;
      items.push(`${targetLabel} : ${label} ajouté automatiquement depuis une donnée confirmée`);
    });
  };
  addAutoValues('sampler_p_choices', ANTECEDENTS_OPTIONS, 'P');
  addAutoValues('sampler_r_choices', RISQUE_OPTIONS, 'R');
  addAutoValues('sampler_e_choices', EVENEMENT_OPTIONS, 'E');
  (sampler.sampler_confirmed_links || []).forEach((link) => {
    items.push(`${link.sourceLabel} → ${link.targetLabel} confirmé manuellement`);
  });
  return uniqueValues(items);
}

function RecapView({ data, onNavigate }) {
  const sections = ['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].map((page) => {
    const rows = PAGE_FIELDS[page]
      .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data), data) }))
      .filter((r) => r.v !== null);
    const pqrstList = page === 'SAMPLER' ? data.SAMPLER.pqrst_list || [] : [];
    return { page, rows, pqrstList };
  });

  const transmissionHighlights = getTransmissionHighlights(data);
  const missingChecks = computeMissingChecks(data);
  const missingInfo = missingChecks.map((item) => item.message);
  const recommendations = computeRecommendations(data);
  const automationAudit = getAutomationAudit(data);

  return (
    <div className="flex flex-col gap-5">
      {missingInfo.length > 0 && (
        <div
          className="flex flex-col gap-1.5 border-2 rounded-md px-3 py-2.5"
          style={{ borderColor: AMBER, backgroundColor: '#1A1508' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: AMBER }} />
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: AMBER }}>
              À compléter avant transmission
            </span>
          </div>
          <ul className="flex flex-col gap-1 pl-1">
            {missingChecks.map(({ page, message, field }, i) => {
              const content = (
                <>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: AMBER }} />
                  <span className="flex-1">{message}</span>
                  {page && onNavigate && <ChevronRight size={15} className="shrink-0 mt-0.5" />}
                </>
              );
              return (
                <li key={`${page}_${message}_${i}`}>
                  {page && onNavigate ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(page, 'single', field)}
                      className="w-full text-left text-sm text-neutral-200 flex items-start gap-2 rounded px-1 py-1.5 hover:bg-neutral-900"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="text-sm text-neutral-200 flex items-start gap-2 px-1 py-1">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate(missingChecks[0].page, 'all', missingChecks[0].field)}
              className="mt-1 w-full py-2 rounded-md text-xs font-bold uppercase tracking-wide border"
              style={{ borderColor: AMBER, color: AMBER }}
            >
              Compléter uniquement les points manquants
            </button>
          )}
        </div>
      )}
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
          {page === 'SAMPLER' ? (
            <div className="flex flex-col gap-3">
              {SAMPLER_LETTER_GROUPS.map((group) => {
                const letterRows = group.fields
                  .map((f) => ({ f, v: formatValue(f, getRawValue(page, f, data), data) }))
                  .filter((r) => r.v !== null);
                const isS = group.letter === 'S';
                const hasContent = letterRows.length > 0 || (isS && pqrstList.length > 0);
                return (
                  <div
                    key={group.letter}
                    className="bg-neutral-900 border border-neutral-800 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: ACCENT, fontFamily: "'Barlow Condensed', sans-serif" }}
                      >
                        {group.letter}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                        {group.title}
                      </span>
                    </div>
                    {!hasContent ? (
                      <p className="text-xs text-neutral-600 italic">Non renseigné</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {letterRows.map(({ f, v }) => (
                          <div key={f} className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-neutral-500 shrink-0">{FIELD_LABELS[f]}</span>
                            <span
                              className="text-neutral-100 text-right"
                              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                              {v}
                            </span>
                          </div>
                        ))}
                        {isS &&
                          pqrstList.map((entry, i) => {
                            const n = i + 1;
                            const pqrstRows = formatPqrstEntry(entry, n);
                            return (
                              <div key={entry.id} className="border-l-2 pl-2 mt-1" style={{ borderColor: ACCENT }}>
                                <div className="text-xs font-bold text-neutral-100 mb-1">
                                  {entry.title || `PQRST ${n}`}
                                </div>
                                {pqrstRows.length === 0 ? (
                                  <p className="text-xs text-neutral-600 italic">Non renseigné</p>
                                ) : (
                                  pqrstRows.map((row) => (
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
                                  ))
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : rows.length === 0 && pqrstList.length === 0 ? (
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
      {(data.B?.o2_sessions || []).length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: ACCENT }}>
              O2
            </span>
            <h3 className="text-base font-bold uppercase tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              Historique O2
            </h3>
          </div>
          {(data.B.o2_sessions || []).map((session, index) => (
            <div key={session.id || index} className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5">
              <p className="text-sm text-neutral-200">{formatO2Session(session)}</p>
            </div>
          ))}
        </div>
      )}
      {(data.SURVEILLANCE?.releves || []).length > 0 && (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: ACCENT }}>
            Sv
          </span>
          <h3 className="text-base font-bold uppercase tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Bilan de suivi — Relevés successifs
          </h3>
        </div>
          {(data.SURVEILLANCE?.releves || []).map((reading, index, readings) => {
            const previous = index > 0 ? readings[index - 1] : null;
            const delta = formatSurveillanceDelta(reading, previous);
            const elapsed = surveillanceElapsedLabel(reading, previous);
            return (
              <div key={reading.id || `${reading.heure}_${index}`} className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold" style={{ color: ACCENT }}>{reading.heure || 'Heure non renseignée'}</span>
                  {elapsed && <span className="text-xs text-neutral-500">{elapsed}</span>}
                </div>
                <p className="text-sm text-neutral-200 mt-1">{formatSurveillanceReading(reading)}</p>
                {delta && <p className="text-xs text-neutral-500 mt-1">Évolution : {delta}</p>}
              </div>
            );
          })}
      </div>
      )}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: ACCENT }}>Synthèse transmission</span>
        {data.TYPE?.categorie && <div className="text-sm"><span className="text-neutral-500">Victime : </span><span className="font-semibold">{PATIENT_CATEGORIES[data.TYPE.categorie]?.label}</span></div>}
        {transmissionHighlights.length > 0 ? transmissionHighlights.map((item, i) => (
          <div key={`${item}_${i}`} className="text-sm text-neutral-200 border-l-2 pl-2" style={{ borderColor: item.startsWith('⚠') ? AMBER : '#404040' }}>{item}</div>
        )) : <span className="text-sm text-neutral-600 italic">Aucun élément de synthèse renseigné.</span>}
      </div>
      {(() => {
        const summary = computeAlertSummary(data);
        if (summary.length === 0) {
          const incomplete = missingInfo.length > 0;
          return (
            <div
              className="flex items-center gap-2 text-sm border-2 rounded-md px-3 py-2"
              style={
                incomplete
                  ? { borderColor: AMBER, backgroundColor: '#1A1508', color: AMBER }
                  : { borderColor: '#065F46', backgroundColor: '#0B1F17', color: EMERALD }
              }
            >
              {incomplete ? <AlertTriangle size={16} /> : <Check size={16} />}
              {incomplete
                ? 'Aucune alerte automatique sur les seules données renseignées — bilan incomplet'
                : 'Aucune alerte automatique détectée sur les données renseignées'}
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
                <AlertTriangle size={16} style={{ color: AMBER }} />
                <span>
                  Alerte {s.label}
                  <span className="block text-xs font-normal text-neutral-300 mt-0.5">
                    {s.details.join(' · ')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        );
      })()}
      {(recommendations.length > 0 || automationAudit.length > 0) && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            Automatisations et suggestions
          </span>
          {recommendations.map(({ page, message }) =>
            onNavigate ? (
              <button
                key={`${page}_${message}`}
                type="button"
                onClick={() => onNavigate(page, false)}
                className="w-full text-left text-xs rounded-md border px-3 py-2 flex items-start gap-2"
                style={{ borderColor: AMBER, color: AMBER, backgroundColor: '#1A1508' }}
              >
                <span className="flex-1">Suggestion : {message}</span>
                <ChevronRight size={14} className="shrink-0" />
              </button>
            ) : (
              <div
                key={`${page}_${message}`}
                className="text-xs border-l-2 pl-2"
                style={{ borderColor: AMBER, color: '#FCD58D' }}
              >
                Suggestion : {message}
              </div>
            )
          )}
          {automationAudit.map((item) => (
            <div key={item} className="text-xs text-neutral-300 border-l-2 border-neutral-700 pl-2">
              {item}
            </div>
          ))}
        </div>
      )}
      {(() => {
        const remarkable = computeRemarkableElements(data);
        if (remarkable.length === 0) return null;
        return (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              Éléments remarquables du bilan
            </span>
            {remarkable.map((item, i) => (
              <div
                key={i}
                className="text-sm text-neutral-200 border-l-2 pl-2"
                style={{ borderColor: '#404040' }}
              >
                {item}
              </div>
            ))}
          </div>
        );
      })()}
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
  const [currentRecordId, setCurrentRecordId] = useState(null);
  const [currentRecordTimestamp, setCurrentRecordTimestamp] = useState(null);
  const [saved, setSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [draftCandidate, setDraftCandidate] = useState(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState('idle');
  const [missingReviewMode, setMissingReviewMode] = useState(null);
  const [highlightedFieldId, setHighlightedFieldId] = useState(null);
  const bilanStartRef = useRef(null);
  const [bilanDuration, setBilanDuration] = useState(null);
  const [o2AlarmActive, setO2AlarmActive] = useState(false);
  const [o2RemainingMin, setO2RemainingMin] = useState(null);
  const o2CheckIntervalRef = useRef(null);
  const o2VibrateIntervalRef = useRef(null);
  const o2DebounceTimerRef = useRef(null);
  const o2DismissedRef = useRef(false);
  const [showRecondition, setShowRecondition] = useState(false);
  const [autreSymptome, setAutreSymptome] = useState('');
  const [surveillanceDraft, setSurveillanceDraft] = useState(emptySurveillanceDraft());
  const [surveillanceError, setSurveillanceError] = useState('');
  const [editingReadingId, setEditingReadingId] = useState(null);
  const autosaveTimerRef = useRef(null);

  const frTimer = useCountdown(60);
  const fcTimer = useCountdown(60);
  const coolingMinutes = parseFloat(String(form.BRULURE.cooling_timer_min).replace(',', '.')) || 20;
  const coolingTimer = useCountdown(Math.max(1, Math.round(coolingMinutes * 60)));
  const mainRef = useRef(null);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [step]);

  // Scrolle jusqu'au champ précis signalé depuis "À compléter avant transmission" et le
  // surligne brièvement, plutôt que de laisser l'utilisateur chercher sur toute la page.
  useEffect(() => {
    if (!highlightedFieldId) return;
    const id = highlightedFieldId;
    let el = null;
    const scrollTimer = setTimeout(() => {
      el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.2s ease, border-color 0.2s ease';
        el.style.borderColor = AMBER;
        el.style.boxShadow = `0 0 0 2px ${AMBER}`;
      }
    }, 150);
    const clearTimer = setTimeout(() => {
      if (el) {
        el.style.borderColor = '';
        el.style.boxShadow = '';
      }
      setHighlightedFieldId(null);
    }, 2500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [step, highlightedFieldId]);

  // Chrono du bilan : capture la durée dès la première arrivée sur le récap,
  // à partir du tout premier champ renseigné.
  useEffect(() => {
    if (STEPS[step] === 'RECAP' && bilanStartRef.current !== null && bilanDuration === null) {
      setBilanDuration(Date.now() - bilanStartRef.current);
    }
  }, [step]);

  useEffect(() => {
    loadHistory();
    loadDraftCandidate();
  }, []);

  // Sauvegarde locale différée : chaque changement remplace le même brouillon, sans
  // multiplier les entrées dans l'historique. Un bilan enregistré n'est plus conservé
  // comme brouillon actif.
  useEffect(() => {
    if (!draftChecked) return undefined;
    if (draftCandidate) return undefined;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    if (saved || isPristineForm(form)) {
      storage.delete(DRAFT_STORAGE_KEY).catch(() => {});
      setAutosaveStatus('idle');
      return undefined;
    }
    setAutosaveStatus('saving');
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const draft = {
          schemaVersion: DRAFT_SCHEMA_VERSION,
          updatedAt: Date.now(),
          patientNum,
          currentRecordId,
          currentRecordTimestamp,
          step,
          stepPage: STEPS[step],
          bilanStartedAt: bilanStartRef.current,
          form,
        };
        await storage.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        setAutosaveStatus('saved');
      } catch (error) {
        console.error('Erreur de sauvegarde automatique du brouillon', error);
        setAutosaveStatus('error');
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [form, patientNum, currentRecordId, currentRecordTimestamp, step, saved, draftChecked, draftCandidate]);

  // Suivi de l'autonomie à partir de l'heure de début réellement capturée. Modifier
  // le débit ou la pression recalcule l'estimation sans remettre le chrono à zéro.
  useEffect(() => {
    const autonomy = computeO2Autonomy(form.B.o2_bottle_size, form.B.o2_pressure, form.B.o2_debit);
    if (o2CheckIntervalRef.current) clearInterval(o2CheckIntervalRef.current);
    if (o2DebounceTimerRef.current) clearTimeout(o2DebounceTimerRef.current);
    if (o2VibrateIntervalRef.current) {
      clearInterval(o2VibrateIntervalRef.current);
      o2VibrateIntervalRef.current = null;
    }
    setO2AlarmActive(false);

    if (form.B.o2_active !== 'oui' || autonomy === null) {
      setO2RemainingMin(null);
      return;
    }

    const startedAt = Number(form.B.o2_started_at_ms) || Date.now();
    o2DismissedRef.current = false;
    const updateRemaining = () => {
      const elapsedMin = Math.max(0, (Date.now() - startedAt) / 60000);
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
    };

    // Le temps restant s'affiche tout de suite (confort de lecture), mais l'évaluation
    // qui peut déclencher l'alarme attend 5 s de saisie stable — sinon taper "2" puis
    // "20" puis "200" dans la pression générerait une alerte sur une valeur incomplète.
    const elapsedNow = Math.max(0, (Date.now() - startedAt) / 60000);
    setO2RemainingMin(autonomy - elapsedNow);

    o2DebounceTimerRef.current = setTimeout(() => {
      updateRemaining();
      o2CheckIntervalRef.current = setInterval(updateRemaining, 5000);
    }, 5000);

    return () => {
      if (o2DebounceTimerRef.current) clearTimeout(o2DebounceTimerRef.current);
      if (o2CheckIntervalRef.current) clearInterval(o2CheckIntervalRef.current);
      if (o2VibrateIntervalRef.current) {
        clearInterval(o2VibrateIntervalRef.current);
        o2VibrateIntervalRef.current = null;
      }
    };
  }, [
    form.B.o2_active,
    form.B.o2_started_at_ms,
    form.B.o2_bottle_size,
    form.B.o2_pressure,
    form.B.o2_debit,
  ]);

  // Prépare le contexte air/O2 du prochain relevé sans modifier une SpO2 déjà saisie
  // manuellement dans le brouillon de surveillance.
  useEffect(() => {
    setSurveillanceDraft((draft) =>
      draft.spo2
        ? draft
        : { ...draft, spo2_mode: form.B.o2_active === 'oui' ? 'o2' : 'air' }
    );
  }, [form.B.o2_active]);

  function stopO2Alarm() {
    o2DismissedRef.current = true;
    setO2AlarmActive(false);
    if (o2VibrateIntervalRef.current) {
      clearInterval(o2VibrateIntervalRef.current);
      o2VibrateIntervalRef.current = null;
    }
  }

  function startO2() {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    const now = Date.now();
    setForm((f) => ({
      ...f,
      B: {
        ...f.B,
        o2_active: 'oui',
        o2_start_time: currentTimeString(),
        o2_started_at_ms: now,
      },
    }));
    setSaved(false);
  }

  function resetO2Start() {
    const now = Date.now();
    setForm((f) => ({
      ...f,
      B: { ...f.B, o2_start_time: currentTimeString(), o2_started_at_ms: now },
    }));
    setSaved(false);
  }

  function updateO2StartTime(rawValue) {
    const value = formatTimeInput(rawValue);
    setForm((f) => {
      let startedAt = f.B.o2_started_at_ms;
      if (isValidTime(value)) {
        const [hours, minutes] = value.split(':').map(Number);
        const candidate = new Date();
        candidate.setHours(hours, minutes, 0, 0);
        if (candidate.getTime() > Date.now() + 5 * 60 * 1000) {
          candidate.setDate(candidate.getDate() - 1);
        }
        startedAt = candidate.getTime();
      }
      return { ...f, B: { ...f.B, o2_start_time: value, o2_started_at_ms: startedAt } };
    });
    setSaved(false);
  }

  function stopO2() {
    const now = Date.now();
    setForm((f) => {
      if (f.B.o2_active !== 'oui') return f;
      const session = {
        id: `o2_${now}`,
        start_time: f.B.o2_start_time,
        started_at_ms: f.B.o2_started_at_ms,
        end_time: currentTimeString(),
        ended_at_ms: now,
        interface: f.B.o2_interface,
        spo2: f.B.spo2_o2,
        bottle_size: f.B.o2_bottle_size,
        pressure: f.B.o2_pressure,
        debit: f.B.o2_debit,
      };
      return {
        ...f,
        B: {
          ...f.B,
          o2_active: 'non',
          spo2_o2: '',
          o2_interface: '',
          o2_start_time: '',
          o2_started_at_ms: null,
          o2_bottle_size: '5',
          o2_pressure: '200',
          o2_debit: '',
          o2_sessions: [...(f.B.o2_sessions || []), session],
        },
      };
    });
    stopO2Alarm();
    setO2RemainingMin(null);
    setSaved(false);
  }

  function removeO2Session(id) {
    if (!window.confirm('Supprimer cet épisode O2 de la chronologie ?')) return;
    setForm((f) => ({
      ...f,
      B: { ...f.B, o2_sessions: (f.B.o2_sessions || []).filter((session) => session.id !== id) },
    }));
    setSaved(false);
  }

  function reopenO2Session(id) {
    setForm((f) => {
      if (f.B.o2_active === 'oui') return f;
      const session = (f.B.o2_sessions || []).find((item) => item.id === id);
      if (!session) return f;
      return {
        ...f,
        B: {
          ...f.B,
          o2_active: 'oui',
          spo2_o2: session.spo2 || '',
          o2_interface: session.interface || '',
          o2_start_time: session.start_time || '',
          o2_started_at_ms: session.started_at_ms || Date.now(),
          o2_bottle_size: session.bottle_size || '',
          o2_pressure: session.pressure || '',
          o2_debit: session.debit || '',
          o2_sessions: (f.B.o2_sessions || []).filter((item) => item.id !== id),
        },
      };
    });
    setSaved(false);
  }

  // Les événements déduits des pages X et Brûlure sont marqués comme automatiques.
  // Ils sont donc retirés si leur source est décochée, sans laisser une information
  // obsolète dans le SAMPLER.
  useEffect(() => {
    setForm((f) => {
      const previousAuto = f.SAMPLER.sampler_auto_links?.sampler_e_choices || [];
      const manualEvents = (f.SAMPLER.sampler_e_choices || []).filter(
        (value) => !previousAuto.includes(value)
      );
      const autoEvents = uniqueValues([
        f.X.trauma === 'oui' && 'traumatisme',
        f.BRULURE.brulure === 'oui' && 'brulure',
      ]);
      const nextEvents = uniqueValues([...manualEvents, ...autoEvents]);
      if (
        JSON.stringify(nextEvents) === JSON.stringify(f.SAMPLER.sampler_e_choices || []) &&
        JSON.stringify(autoEvents) === JSON.stringify(previousAuto)
      ) {
        return f;
      }
      return {
        ...f,
        SAMPLER: {
          ...f.SAMPLER,
          sampler_e_choices: nextEvents,
          sampler_auto_links: {
            ...(f.SAMPLER.sampler_auto_links || {}),
            sampler_e_choices: autoEvents,
          },
        },
      };
    });
  }, [form.X.trauma, form.BRULURE.brulure]);

  async function loadDraftCandidate() {
    try {
      const result = await storage.get(DRAFT_STORAGE_KEY);
      if (!result?.value) return;
      const candidate = JSON.parse(result.value);
      if (candidate?.form && !isPristineForm(candidate.form)) {
        setDraftCandidate(candidate);
      } else {
        await storage.delete(DRAFT_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Erreur de lecture du brouillon', error);
      await storage.delete(DRAFT_STORAGE_KEY).catch(() => {});
    } finally {
      setDraftChecked(true);
    }
  }

  function resumeDraft() {
    if (!draftCandidate?.form) return;
    const normalized = normalizeFormData(draftCandidate.form);
    setForm(normalized);
    setPatientNum(Number(draftCandidate.patientNum) || patientNum);
    setCurrentRecordId(draftCandidate.currentRecordId || null);
    setCurrentRecordTimestamp(Number(draftCandidate.currentRecordTimestamp) || null);
    const legacyStep = Math.max(
      0,
      Math.min(Number(draftCandidate.step) || 0, LEGACY_STEPS_V3.length - 1)
    );
    const savedStepPage =
      draftCandidate.stepPage ||
      (!draftCandidate.schemaVersion || Number(draftCandidate.schemaVersion) <= 3
        ? LEGACY_STEPS_V3[legacyStep]
        : STEPS[legacyStep]);
    const savedStepIndex = STEPS.indexOf(savedStepPage);
    setStep(savedStepIndex >= 0 ? savedStepIndex : 0);
    bilanStartRef.current = Number(draftCandidate.bilanStartedAt) || Number(draftCandidate.updatedAt) || Date.now();
    setSaved(false);
    setSavedAt(null);
    setBilanDuration(null);
    setSurveillanceDraft(emptySurveillanceDraft());
    setDraftCandidate(null);
    setAutosaveStatus('saved');
  }

  async function discardDraft() {
    try {
      await storage.delete(DRAFT_STORAGE_KEY);
    } catch (error) {
      console.error('Erreur lors de la suppression du brouillon', error);
    }
    setDraftCandidate(null);
    setAutosaveStatus('idle');
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
            if (r) {
              const record = JSON.parse(r.value);
              if (record?.data) items.push({ ...record, data: normalizeFormData(record.data) });
            }
          } catch (e) {
            // skip unreadable entry
          }
        }
      }
      items.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(items);
      const maxPatientNum = items.reduce(
        (max, item) => Math.max(max, Number(item.patientNum) || 0),
        0
      );
      setPatientNum(maxPatientNum + 1);
    } catch (e) {
      console.error('Erreur de chargement de l\'historique', e);
    }
    setLoadingHistory(false);
  }

  function updateField(page, field, value) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => {
      const nextPage = { ...f[page], [field]: value };
      if (page === 'A' && field === 'obstruction' && value !== 'non') {
        nextPage.liberation_effectuee = '';
      }
      return { ...f, [page]: nextPage };
    });
    if (saved) setSaved(false);
  }

  // Met à jour une liste M/P/R et recalcule les valeurs automatiques avec provenance.
  function updateSamplerChoices(field, nextArray) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => {
      let nextSampler = reconcileSamplerCrossLinks(f.SAMPLER, field, nextArray);
      if (field === 'sampler_m_choices') {
        const retainedSources = new Set(nextArray || []);
        nextSampler = {
          ...nextSampler,
          sampler_dismissed_suggestions: (nextSampler.sampler_dismissed_suggestions || []).filter(
            (id) => [...retainedSources].some((source) => id.startsWith(`sampler_m:${source}->`))
          ),
          sampler_confirmed_links: (nextSampler.sampler_confirmed_links || []).filter(
            (link) => !link.sourceValue || retainedSources.has(link.sourceValue)
          ),
        };
      }
      return { ...f, SAMPLER: nextSampler };
    });
    if (saved) setSaved(false);
  }

  function confirmSamplerSuggestion(suggestion) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => {
      const current = f.SAMPLER[suggestion.targetField] || [];
      const nextValues = uniqueValues([
        ...current.filter((value) => value !== 'aucun'),
        suggestion.targetValue,
      ]);
      const reconciled = reconcileSamplerCrossLinks(
        f.SAMPLER,
        suggestion.targetField,
        nextValues
      );
      const existing = reconciled.sampler_confirmed_links || [];
      return {
        ...f,
        SAMPLER: {
          ...reconciled,
          sampler_confirmed_links: existing.some((link) => link.id === suggestion.id)
            ? existing
            : [
                ...existing,
                {
                  id: suggestion.id,
                  sourceValue: suggestion.sourceValue,
                  sourceLabel: suggestion.sourceLabel,
                  targetLabel: suggestion.targetLabel,
                  confirmedAt: Date.now(),
                },
              ],
        },
      };
    });
    setSaved(false);
  }

  function dismissSamplerSuggestion(id) {
    setForm((f) => ({
      ...f,
      SAMPLER: {
        ...f.SAMPLER,
        sampler_dismissed_suggestions: uniqueValues([
          ...(f.SAMPLER.sampler_dismissed_suggestions || []),
          id,
        ]),
      },
    }));
    setSaved(false);
  }

  function updateSamplerEvents(nextArray) {
    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
    setForm((f) => {
      const autoEvents = f.SAMPLER.sampler_auto_links?.sampler_e_choices || [];
      const manualEvents = nextArray.filter((value) => !autoEvents.includes(value));
      return {
        ...f,
        SAMPLER: {
          ...f.SAMPLER,
          sampler_e_choices: uniqueValues([...manualEvents, ...autoEvents]),
        },
      };
    });
    if (saved) setSaved(false);
  }

  function prefillSurveillanceDraft() {
    const readings = form.SURVEILLANCE?.releves || [];
    const latest = readings.length > 0 ? readings[readings.length - 1] : null;
    const o2Active = form.B.o2_active === 'oui';
    setSurveillanceDraft({
      heure: currentTimeString(),
      fr: latest?.fr || form.B.fr,
      fc: latest?.fc || form.C.fc,
      spo2:
        (o2Active
          ? form.B.spo2_o2 || (latest?.spo2_mode === 'o2' ? latest.spo2 : '')
          : latest?.spo2 || form.B.spo2_air),
      spo2_mode: o2Active ? 'o2' : latest?.spo2_mode || 'air',
      pa_sys: latest?.pa_sys || form.C.pa_gauche_sys || form.C.pa_droite_sys,
      pa_dia: latest?.pa_dia || form.C.pa_gauche_dia || form.C.pa_droite_dia,
      temperature: latest?.temperature || form.E.temperature,
      glycemie: latest?.glycemie || form.D.glycemie,
      glycemie_unit: latest?.glycemie_unit || form.D.glycemie_unit || 'mg/dL',
    });
    setSurveillanceError('');
  }

  function openFollowUp() {
    prefillSurveillanceDraft();
    setMissingReviewMode(null);
    setStep(STEPS.indexOf('SURVEILLANCE'));
  }

  function returnToRecap() {
    setMissingReviewMode(null);
    setStep(STEPS.indexOf('RECAP'));
  }

  function updateSurveillanceDraft(field, value) {
    setSurveillanceDraft((draft) => ({ ...draft, [field]: value }));
    if (surveillanceError) setSurveillanceError('');
  }

  function addSurveillanceReading() {
    const draft = surveillanceDraft;
    const hasValue = ['fr', 'fc', 'spo2', 'pa_sys', 'pa_dia', 'temperature', 'glycemie'].some(
      (field) => !!draft[field]
    );
    if (!hasValue) {
      setSurveillanceError('Renseigne au moins une constante avant d’ajouter le relevé.');
      return;
    }
    const invalid =
      !isValidTime(draft.heure) ||
      !isNumberInRange(draft.fr, 1, 100) ||
      !isNumberInRange(draft.fc, 1, 300) ||
      !isNumberInRange(draft.spo2, 1, 100) ||
      !isNumberInRange(draft.pa_sys, 1, 300) ||
      !isNumberInRange(draft.pa_dia, 1, 200) ||
      !isNumberInRange(draft.temperature, 15, 45) ||
      (!!draft.glycemie && !isPositiveNumber(draft.glycemie));
    const paSys = Number(String(draft.pa_sys).replace(',', '.'));
    const paDia = Number(String(draft.pa_dia).replace(',', '.'));
    const paIncoherent =
      !!draft.pa_sys && !!draft.pa_dia && Number.isFinite(paSys) && Number.isFinite(paDia) && paDia >= paSys;
    if (invalid || paIncoherent) {
      setSurveillanceError('Corrige les saisies signalées avant d’ajouter le relevé.');
      return;
    }
    const existingReadings = form.SURVEILLANCE?.releves || [];
    const duplicateHeure = existingReadings.some(
      (r) => r.heure === draft.heure && r.id !== editingReadingId
    );
    if (duplicateHeure) {
      setSurveillanceError('Un relevé existe déjà à cette heure — modifie l’heure ou corrige le relevé existant.');
      return;
    }
    if (editingReadingId) {
      setForm((f) => ({
        ...f,
        SURVEILLANCE: {
          ...(f.SURVEILLANCE || {}),
          releves: (f.SURVEILLANCE?.releves || []).map((r) =>
            r.id === editingReadingId ? { ...draft, id: editingReadingId, createdAt: r.createdAt } : r
          ),
        },
      }));
      setEditingReadingId(null);
    } else {
      const reading = { ...draft, id: `surv_${Date.now()}`, createdAt: Date.now() };
      if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
      setForm((f) => ({
        ...f,
        SURVEILLANCE: {
          ...(f.SURVEILLANCE || {}),
          releves: [...(f.SURVEILLANCE?.releves || []), reading],
        },
      }));
    }
    setSurveillanceDraft(emptySurveillanceDraft());
    setSurveillanceError('');
    setSaved(false);
  }

  function startEditReading(reading) {
    setSurveillanceDraft({ ...reading });
    setEditingReadingId(reading.id);
    setSurveillanceError('');
  }

  function cancelEditReading() {
    setSurveillanceDraft(emptySurveillanceDraft());
    setEditingReadingId(null);
    setSurveillanceError('');
  }

  function removeSurveillanceReading(id) {
    setForm((f) => ({
      ...f,
      SURVEILLANCE: {
        ...(f.SURVEILLANCE || {}),
        releves: (f.SURVEILLANCE?.releves || []).filter((reading) => reading.id !== id),
      },
    }));
    if (editingReadingId === id) cancelEditReading();
    setSaved(false);
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
    const num =
      field === 'glycemie'
        ? glycemieToGL(rawValue, form.D.glycemie_unit)
        : parseFloat(String(rawValue).replace(',', '.'));
    if (isNaN(num)) return null;
    if (num < range[0]) return 'low';
    if (num > range[1]) return 'high';
    return null;
  }

  function isAbnormalField(field, rawValue) {
    return getAbnormalDirection(field, rawValue) !== null;
  }

  function navigateToMissing(page, mode = null, field = null) {
    const targetIndex = STEPS.indexOf(page);
    if (targetIndex < 0) return;
    setMissingReviewMode(mode === 'single' || mode === 'all' ? mode : null);
    setStep(targetIndex);
    setHighlightedFieldId(field || null);
  }

  function goNext() {
    const reviewTarget = resolveMissingReviewNext(missingReviewMode, step, form);
    if (reviewTarget) {
      setStep(reviewTarget.nextStep);
      setMissingReviewMode(reviewTarget.nextMode);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goPrev() {
    if (missingReviewMode === 'single') {
      setStep(STEPS.indexOf('RECAP'));
      setMissingReviewMode(null);
      return;
    }
    if (missingReviewMode === 'all') {
      const missingIndexes = getMissingPages(form)
        .map((page) => STEPS.indexOf(page))
        .filter((index) => index >= 0 && index < step)
        .sort((a, b) => b - a);
      if (missingIndexes.length > 0) {
        setStep(missingIndexes[0]);
        return;
      }
      setMissingReviewMode(null);
    }
    setStep((s) => Math.max(s - 1, 0));
  }

  async function saveBilan() {
    const missingCount = computeMissingInfo(form).length;
    if (
      missingCount > 0 &&
      !window.confirm(`${missingCount} point(s) restent à compléter. Enregistrer quand même ce bilan incomplet ?`)
    ) {
      return;
    }
    const now = new Date();
    const existing = currentRecordId ? history.find((item) => item.id === currentRecordId) : null;
    const timestamp = existing?.timestamp || currentRecordTimestamp || now.getTime();
    const recordedAt = new Date(timestamp);
    const record = {
      id: currentRecordId || `${now.getTime()}`,
      timestamp,
      updatedAt: now.getTime(),
      date: recordedAt.toLocaleDateString('fr-FR'),
      heure: recordedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      patientNum,
      data: form,
    };
    try {
      const res = await storage.set(`bilan:${record.id}`, JSON.stringify(record), false);
      if (res) {
        setHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
        setCurrentRecordId(record.id);
        setCurrentRecordTimestamp(record.timestamp);
        setSaved(true);
        setSavedAt(record.heure);
        setDraftCandidate(null);
        await storage.delete(DRAFT_STORAGE_KEY);
      }
    } catch (e) {
      console.error('Erreur d\'enregistrement du bilan', e);
    }
  }

  async function newBilan() {
    if (!window.confirm('Effacer le bilan en cours et repartir de zéro ?')) return;
    try {
      await storage.delete(DRAFT_STORAGE_KEY);
    } catch (error) {
      console.error('Erreur lors de la suppression du brouillon', error);
    }
    setForm(initialForm());
    frTimer.reset();
    fcTimer.reset();
    coolingTimer.reset();
    setStep(0);
    setCurrentRecordId(null);
    setCurrentRecordTimestamp(null);
    setSaved(false);
    setSavedAt(null);
    setPatientNum((n) => n + 1);
    setSurveillanceDraft(emptySurveillanceDraft());
    setSurveillanceError('');
    bilanStartRef.current = null;
    setBilanDuration(null);
    setMissingReviewMode(null);
    setDraftCandidate(null);
    setAutosaveStatus('idle');
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
      setCurrentRecordId(null);
      setCurrentRecordTimestamp(null);
      setSaved(false);
      setSavedAt(null);
    } catch (e) {
      console.error("Erreur lors de l'effacement de l'historique", e);
    }
  }

  async function deleteHistoryRecord(record) {
    if (!record) return;
    const ok = window.confirm(`Effacer définitivement le bilan n°${record.patientNum} ?`);
    if (!ok) return;
    try {
      await storage.delete(`bilan:${record.id}`);
      setHistory((items) => items.filter((item) => item.id !== record.id));
      if (viewing?.id === record.id) setViewing(null);
      if (currentRecordId === record.id) {
        setCurrentRecordId(null);
        setCurrentRecordTimestamp(null);
        setSaved(false);
        setSavedAt(null);
      }
    } catch (e) {
      console.error("Erreur lors de l'effacement du bilan", e);
    }
  }

  function renderStepContent() {
    const s = STEPS[step];
    const pediatricPatient = ['nouveau_ne', 'enfant'].includes(form.TYPE.categorie);
    if (s === 'TYPE')
      return (
        <div id="TYPE_categorie" className="flex flex-col gap-3">
          <p className="text-xs text-neutral-600 italic leading-relaxed border-l-2 border-neutral-800 pl-3">
            Cet outil est une aide à la documentation du bilan secouriste. Il ne remplace pas le
            protocole officiel de ton service ni le jugement clinique du secouriste.
          </p>
          <p className="text-sm text-neutral-400 mb-1 leading-relaxed">
            Sélectionne la catégorie de la victime pour activer des seuils de repérage indicatifs
            et les contrôles de cohérence. Toute cible individualisée ou consigne du service prime.
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
          <FieldCard id="X_trauma" label="Victime traumatisée" filled={!!form.X.trauma}>
            <ToggleGroup
              value={form.X.trauma}
              onChange={(v) => {
                updateField('X', 'trauma', v);
                if (v !== 'oui') {
                  updateField('X', 'collier_pose', '');
                  updateField('C', 'blood_box', []);
                }
              }}
              options={OUI_NON}
            />
            <span className="text-xs text-neutral-600 italic mt-1.5 block">
              En cas de doute, appliquer le protocole de ton service et documenter le contexte.
            </span>
          </FieldCard>
          {form.X.trauma === 'oui' && (
            <FieldCard label="Pose collier" filled={!!form.X.collier_pose}>
              <ToggleGroup
                value={form.X.collier_pose}
                onChange={(v) => updateField('X', 'collier_pose', v)}
                options={OUI_NON}
              />
            </FieldCard>
          )}
          <FieldCard id="X_hemorragie" label="Hémorragie" filled={!!form.X.hemorragie}>
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
                <div id="X_hemorragie_sites" className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
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
                    <div id="X_garrot_heure" className="flex flex-col gap-1.5 pt-2">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">
                        Heure de pose (capturée automatiquement, modifiable)
                      </span>
                      <div className="flex items-center gap-2">
                        <InputBox
                          value={form.X.garrot_heure}
                          onChange={(v) => updateField('X', 'garrot_heure', formatTimeInput(v))}
                          invalid={!!form.X.garrot_heure && !isValidTime(form.X.garrot_heure)}
                          placeholder="hh:mm"
                          width="w-28"
                          numeric
                        />
                        <LiveClock onUse={(v) => updateField('X', 'garrot_heure', v)} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </FieldCard>
        </>
      );
    if (s === 'A')
      return (
        <>
          <FieldCard id="A_obstruction" label="Voies aériennes libres actuellement ?" filled={!!form.A.obstruction}>
            <ToggleGroup
              value={form.A.obstruction}
              onChange={(v) => updateField('A', 'obstruction', v)}
              options={OUI_NON}
            />
          </FieldCard>
          {form.A.obstruction === 'non' && (
            <FieldCard id="A_liberation_effectuee" label="Libération effectuée" filled={!!form.A.liberation_effectuee}>
              <ToggleGroup
                value={form.A.liberation_effectuee}
                onChange={(v) => updateField('A', 'liberation_effectuee', v)}
                options={OUI_NON}
              />
            </FieldCard>
          )}
        </>
      );
    if (s === 'B')
      return (
        <>
          <FieldCard id="B_fr" label="Fréquence respiratoire" filled={!!form.B.fr}>
            <div className="flex flex-col gap-2 items-stretch sm:flex-row sm:items-center">
              <TimerBox timer={frTimer} />
              <InputBox
                value={form.B.fr}
                onChange={(v) => updateField('B', 'fr', v)}
                abnormal={isAbnormalField('fr', form.B.fr)}
                invalid={!isNumberInRange(form.B.fr, 1, 100)}
                unit="/min"
                numeric
              />
            </div>
          </FieldCard>
          <FieldCard id="B_fr_ample" label="Amplitude ample" filled={!!form.B.fr_ample}>
            <ToggleGroup
              value={form.B.fr_ample}
              onChange={(v) => updateField('B', 'fr_ample', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="B_fr_reguliere" label="Respiration régulière" filled={!!form.B.fr_reguliere}>
            <ToggleGroup
              value={form.B.fr_reguliere}
              onChange={(v) => updateField('B', 'fr_reguliere', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="B_fr_signes" label="Signes associés" filled={form.B.fr_signes.length > 0}>
            <MultiToggleGroup
              value={form.B.fr_signes}
              onChange={(v) => {
                const next = withExclusiveNone(form.B.fr_signes, v, 'aucun');
                updateField('B', 'fr_signes', next);
                if (!next.some((sign) => sign !== 'aucun')) updateField('B', 'fr_signes_heure', '');
              }}
              options={BREATH_SIGNS}
            />
          </FieldCard>
          {form.B.fr_signes.some((s) => s !== 'aucun') && (
            <FieldCard id="B_fr_signes_heure" label="Heure d'apparition" filled={!!form.B.fr_signes_heure}>
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.B.fr_signes_heure}
                  onChange={(v) => updateField('B', 'fr_signes_heure', formatTimeInput(v))}
                  invalid={!!form.B.fr_signes_heure && !isValidTime(form.B.fr_signes_heure)}
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock onUse={(v) => updateField('B', 'fr_signes_heure', v)} />
              </div>
            </FieldCard>
          )}
          <FieldCard id="B_spo2_air" label="SpO2 (SAT) — sous air" filled={!!form.B.spo2_air}>
            <InputBox
              value={form.B.spo2_air}
              onChange={(v) => updateField('B', 'spo2_air', v)}
              abnormal={isAbnormalField('spo2', form.B.spo2_air)}
              invalid={!isNumberInRange(form.B.spo2_air, 1, 100)}
              unit="%"
              placeholder="Valeur"
              numeric
            />
          </FieldCard>

          {form.B.o2_active !== 'oui' && (
            <button
              onClick={startO2}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-md self-start"
              style={{ backgroundColor: ACCENT, color: '#fff' }}
            >
              <Check size={13} /> Démarrer un suivi sous O2
            </button>
          )}

          {form.B.o2_active === 'oui' && (
            <>
              <FieldCard id="B_o2_interface" label="Interface O2" filled={!!form.B.o2_interface}>
                <ToggleGroup
                  value={form.B.o2_interface}
                  onChange={(v) => {
                    updateField('B', 'o2_interface', v);
                    if (!form.B.o2_debit && O2_INTERFACE_DEFAULT_DEBIT[v]) {
                      updateField('B', 'o2_debit', O2_INTERFACE_DEFAULT_DEBIT[v]);
                    }
                  }}
                  options={O2_INTERFACE_OPTIONS}
                />
              </FieldCard>

              <FieldCard id="B_o2_start_time" label="Heure de début O2" filled={!!form.B.o2_start_time}>
                <div className="flex items-center gap-2 flex-wrap">
                  <InputBox
                    value={form.B.o2_start_time}
                    onChange={updateO2StartTime}
                    invalid={!!form.B.o2_start_time && !isValidTime(form.B.o2_start_time)}
                    placeholder="hh:mm"
                    width="w-28"
                    numeric
                  />
                  <LiveClock onUse={resetO2Start} />
                </div>
              </FieldCard>

              <FieldCard id="B_spo2_o2" label="SpO2 (SAT) — sous O2" filled={!!form.B.spo2_o2}>
                <InputBox
                  value={form.B.spo2_o2}
                  onChange={(v) => updateField('B', 'spo2_o2', v)}
                  abnormal={isAbnormalField('spo2', form.B.spo2_o2)}
                  invalid={!isNumberInRange(form.B.spo2_o2, 1, 100)}
                  unit="%"
                  placeholder="Valeur"
                  numeric
                />
              </FieldCard>

              <FieldCard id="B_o2_bottle_size" label="Autonomie bouteille — Taille" filled={!!form.B.o2_bottle_size}>
                <ToggleGroup
                  value={form.B.o2_bottle_size}
                  onChange={(v) => updateField('B', 'o2_bottle_size', v)}
                  options={O2_BOTTLE_OPTIONS}
                />
              </FieldCard>

              <FieldCard id="B_o2_pressure" label="Pression au manomètre" filled={!!form.B.o2_pressure}>
                <InputBox
                  value={form.B.o2_pressure}
                  onChange={(v) => updateField('B', 'o2_pressure', v)}
                  invalid={!isNumberInRange(form.B.o2_pressure, 1, 300)}
                  unit="bars"
                  placeholder="200"
                  numeric
                />
                <span className="text-xs text-neutral-600 italic mt-1 block">
                  Pression lue à l'instant de la saisie (pas la pression de début de bouteille) —
                  modifie cette valeur si tu relèves le manomètre à nouveau, le décompte
                  d'autonomie repart alors de cette nouvelle lecture.
                </span>
              </FieldCard>

              <FieldCard id="B_o2_debit" label="Débit" filled={!!form.B.o2_debit}>
                <InputBox
                  value={form.B.o2_debit}
                  onChange={(v) => updateField('B', 'o2_debit', v)}
                  invalid={!isNumberInRange(form.B.o2_debit, 0.1, 100)}
                  unit="L/min"
                  placeholder="15"
                  numeric
                />
                {(() => {
                  const warning = getO2InterfaceDebitWarning(form.B.o2_interface, form.B.o2_debit);
                  if (!warning) return null;
                  return (
                    <span className="text-xs mt-1.5 block" style={{ color: AMBER }}>
                      ⚠ {warning}
                    </span>
                  );
                })()}
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
                    {(() => {
                      const threshold = o2BottleThreshold(form.B.o2_bottle_size);
                      const pressure = Number(String(form.B.o2_pressure).replace(',', '.'));
                      const reserveReached = threshold !== null && Number.isFinite(pressure) && pressure <= threshold;
                      return (
                        <span className="text-xs italic" style={{ color: reserveReached ? '#F87171' : '#737373' }}>
                          {reserveReached
                            ? `Pression au seuil de réserve ou en dessous (${threshold} bars).`
                            : `Seuil de réserve pris en compte : ${threshold} bars.`}
                        </span>
                      );
                    })()}
                  </div>
                );
              })()}
              <button
                type="button"
                onClick={stopO2}
                className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-md border border-neutral-700 text-neutral-200 self-start"
              >
                <Square size={13} /> Arrêter et conserver l'épisode O2
              </button>
            </>
          )}
          {(form.B.o2_sessions || []).length > 0 && (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                Épisodes O2 conservés ({form.B.o2_sessions.length})
              </span>
              {form.B.o2_sessions.map((session, index) => (
                <div key={session.id || index} className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5 flex items-start gap-3">
                  <p className="text-sm text-neutral-200 flex-1">{formatO2Session(session)}</p>
                  <div className="flex items-center gap-1">
                    {form.B.o2_active !== 'oui' && (
                      <button
                        type="button"
                        onClick={() => reopenO2Session(session.id)}
                        className="text-neutral-300 p-1"
                        aria-label={`Corriger l'épisode O2 ${index + 1}`}
                        title="Corriger cet épisode"
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeO2Session(session.id)}
                      className="text-red-400 p-1"
                      aria-label={`Supprimer l'épisode O2 ${index + 1}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      );
    if (s === 'C')
      return (
        <>
          <FieldCard id="C_fc" label="Fréquence cardiaque" filled={!!form.C.fc}>
            <div className="flex flex-col gap-2 items-stretch sm:flex-row sm:items-center">
              <TimerBox timer={fcTimer} />
              <InputBox
                value={form.C.fc}
                onChange={(v) => updateField('C', 'fc', v)}
                abnormal={isAbnormalField('fc', form.C.fc)}
                invalid={!isNumberInRange(form.C.fc, 1, 300)}
                unit="/min"
                numeric
              />
            </div>
          </FieldCard>
          <FieldCard
            id="C_pa_gauche_sys"
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
                  invalid={!isNumberInRange(form.C.pa_gauche_sys, 1, 300)}
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
                  invalid={!isNumberInRange(form.C.pa_gauche_dia, 1, 200)}
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
                  invalid={!isNumberInRange(form.C.pa_droite_sys, 1, 300)}
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
                  invalid={!isNumberInRange(form.C.pa_droite_dia, 1, 200)}
                  unit="mmHg"
                  placeholder="Valeur"
                  numeric
                  width="w-20"
                />
              </div>
            </div>
          </FieldCard>
          <FieldCard id="C_pouls_sym" label="Pouls symétrique" filled={!!form.C.pouls_sym}>
            <ToggleGroup
              value={form.C.pouls_sym}
              onChange={(v) => updateField('C', 'pouls_sym', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="C_pouls_frappe" label="Pouls bien frappé" filled={!!form.C.pouls_frappe}>
            <ToggleGroup
              value={form.C.pouls_frappe}
              onChange={(v) => updateField('C', 'pouls_frappe', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="C_trc" label="TRC" filled={!!form.C.trc}>
            <ToggleGroup
              value={form.C.trc}
              onChange={(v) => updateField('C', 'trc', v)}
              options={TRC_OPTIONS}
            />
          </FieldCard>
          <FieldCard id="C_signes" label="Signes associés" filled={form.C.signes.length > 0}>
            <MultiToggleGroup
              value={form.C.signes}
              onChange={(v) => {
                const next = withExclusiveNone(form.C.signes, v, 'aucun');
                updateField('C', 'signes', next);
                if (!next.some((sign) => sign !== 'aucun')) updateField('C', 'signes_heure', '');
              }}
              options={CIRC_SIGNS}
            />
          </FieldCard>
          {form.C.signes.some((s) => s !== 'aucun') && (
            <FieldCard id="C_signes_heure" label="Heure d'apparition" filled={!!form.C.signes_heure}>
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.C.signes_heure}
                  onChange={(v) => updateField('C', 'signes_heure', formatTimeInput(v))}
                  invalid={!!form.C.signes_heure && !isValidTime(form.C.signes_heure)}
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock onUse={(v) => updateField('C', 'signes_heure', v)} />
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
            </>
          )}
        </>
      );
    if (s === 'D')
      return (
        <>
          <FieldCard id="D_pci" label="PCI" filled={!!form.D.pci}>
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
          {form.D.pci === 'oui' && (
            <>
              <FieldCard id="D_pci_duree" label="Durée de la PCI" filled={!!form.D.pci_duree}>
                <InputBox
                  value={form.D.pci_duree}
                  onChange={(v) => updateField('D', 'pci_duree', v)}
                  invalid={!!form.D.pci_duree && !isPositiveNumber(form.D.pci_duree)}
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
                    onChange={(v) => {
                      updateField('D', 'pc_repete', v);
                      if (v !== 'oui') updateField('D', 'pc_nombre', '');
                    }}
                    options={OUI_NON}
                  />
                  {form.D.pc_repete === 'oui' && (
                    <div id="D_pc_nombre" className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">
                        Nombre de fois
                      </span>
                      <InputBox
                        value={form.D.pc_nombre}
                        onChange={(v) => updateField('D', 'pc_nombre', v)}
                        invalid={!!form.D.pc_nombre && !isPositiveNumber(form.D.pc_nombre)}
                        placeholder="Valeur"
                        numeric
                      />
                    </div>
                  )}
                </div>
              </FieldCard>
            </>
          )}
          <FieldCard id="D_etat" label="État de conscience" filled={!!form.D.etat}>
            <ToggleGroup
              value={form.D.etat}
              onChange={(v) => updateField('D', 'etat', v)}
              options={AVPU_OPTIONS}
            />
          </FieldCard>
          <FieldCard id="D_orientation" label="Orientation temps-espace" filled={!!form.D.orientation}>
            <ToggleGroup
              value={form.D.orientation}
              onChange={(v) => updateField('D', 'orientation', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="D_neuro_signes" label="Signes associés" filled={form.D.neuro_signes.length > 0}>
            <MultiToggleGroup
              value={form.D.neuro_signes}
              onChange={(v) => {
                const next = withExclusiveNone(form.D.neuro_signes, v, 'aucun');
                updateField('D', 'neuro_signes', next);
                if (!next.some((sign) => sign !== 'aucun')) {
                  updateField('D', 'neuro_signes_depuis_heure', '');
                  updateField('D', 'neuro_signes_depuis_choice', '');
                }
              }}
              options={NEURO_SIGNS}
            />
          </FieldCard>
          {form.D.neuro_signes.some((s) => s !== 'aucun') && (
            <FieldCard
              id="D_neuro_signes_depuis_heure"
              label="Heure d'apparition"
              filled={!!form.D.neuro_signes_depuis_heure}
            >
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.D.neuro_signes_depuis_heure}
                  onChange={(v) => updateField('D', 'neuro_signes_depuis_heure', formatTimeInput(v))}
                  invalid={
                    !!form.D.neuro_signes_depuis_heure &&
                    !isValidTime(form.D.neuro_signes_depuis_heure)
                  }
                  placeholder="hh:mm"
                  width="w-28"
                  numeric
                />
                <LiveClock onUse={(v) => updateField('D', 'neuro_signes_depuis_heure', v)} />
              </div>
            </FieldCard>
          )}
          <FieldCard id="D_pupilles" label="Pupilles sym., taille normale, réactives" filled={!!form.D.pupilles}>
            <div className="flex flex-col gap-3 items-stretch sm:flex-row sm:items-center">
              <ToggleGroup
                value={form.D.pupilles}
                onChange={(v) => updateField('D', 'pupilles', v)}
                options={OUI_NON}
              />
              <TorchButton />
            </div>
          </FieldCard>
          <FieldCard id="D_sens_mains" label="Sensibilité / motricité mains" filled={!!form.D.sens_mains}>
            <ToggleGroup
              value={form.D.sens_mains}
              onChange={(v) => updateField('D', 'sens_mains', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="D_sens_pieds" label="Sensibilité / motricité pieds" filled={!!form.D.sens_pieds}>
            <ToggleGroup
              value={form.D.sens_pieds}
              onChange={(v) => updateField('D', 'sens_pieds', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Glycémie" filled={!!form.D.glycemie}>
            <div className="flex flex-col gap-2">
              <div>
                <span className="text-xs text-neutral-500 uppercase tracking-wide block mb-1.5">
                  Unité de mesure
                </span>
                <ToggleGroup
                  value={form.D.glycemie_unit}
                  onChange={(v) => updateField('D', 'glycemie_unit', v || 'mg/dL')}
                  options={GLYCEMIE_UNIT_OPTIONS}
                />
              </div>
              <InputBox
                value={form.D.glycemie}
                onChange={(v) => updateField('D', 'glycemie', v)}
                abnormal={isAbnormalField('glycemie', form.D.glycemie)}
                invalid={!!form.D.glycemie && !isPositiveNumber(form.D.glycemie)}
                unit={form.D.glycemie_unit}
                placeholder="Valeur"
                numeric="decimal"
              />
              <span className="text-xs text-neutral-600 italic">
                L'unité est enregistrée avec la valeur ; elle n'est plus déduite du séparateur décimal.
              </span>
            </div>
          </FieldCard>
        </>
      );
    if (s === 'E')
      return (
        <>
          <FieldCard id="E_temperature" label="Température" filled={!!form.E.temperature}>
            <InputBox
              value={form.E.temperature}
              onChange={(v) => updateField('E', 'temperature', v)}
              abnormal={isAbnormalField('temperature', form.E.temperature)}
              invalid={!isNumberInRange(form.E.temperature, 15, 45)}
              unit="°C"
              numeric="decimal"
            />
          </FieldCard>
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
          <FieldCard id="E_lesion" label="Lésion cachée" filled={!!form.E.lesion}>
            <ToggleGroup
              value={form.E.lesion}
              onChange={(v) => updateField('E', 'lesion', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="E_coince" label="Victime coincée / comprimée" filled={!!form.E.coince}>
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
          {form.E.coince === 'oui' && (
            <>
              <FieldCard label="Heure d'apparition / début de compression" filled={!!form.E.coince_depuis}>
                <div className="flex items-center gap-2">
                  <InputBox
                    value={form.E.coince_depuis}
                    onChange={(v) => updateField('E', 'coince_depuis', formatTimeInput(v))}
                    invalid={!!form.E.coince_depuis && !isValidTime(form.E.coince_depuis)}
                    placeholder="hh:mm"
                    width="w-28"
                    numeric
                  />
                  <LiveClock onUse={(v) => updateField('E', 'coince_depuis', v)} />
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

          <FieldCard id="E_amputation" label="Amputation" filled={!!form.E.amputation}>
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
                <FieldCard id="E_amputation_localisation" label="Localisation" filled={!!form.E.amputation_localisation}>
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
                    <div id="E_amputation_garrot_heure" className="flex flex-col gap-1.5 pt-2 border-t border-neutral-800">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">
                        Heure de pose (capturée automatiquement, modifiable)
                      </span>
                      <div className="flex items-center gap-2">
                        <InputBox
                          value={form.E.amputation_garrot_heure}
                          onChange={(v) => updateField('E', 'amputation_garrot_heure', formatTimeInput(v))}
                          invalid={
                            !!form.E.amputation_garrot_heure &&
                            !isValidTime(form.E.amputation_garrot_heure)
                          }
                          placeholder="hh:mm"
                          width="w-28"
                          numeric
                        />
                        <LiveClock onUse={(v) => updateField('E', 'amputation_garrot_heure', v)} />
                      </div>
                    </div>
                  )}
                </div>
              </FieldCard>
              <FieldCard label="Segment amputé retrouvé" filled={!!form.E.amputation_segment_retrouve}>
                <ToggleGroup
                  value={form.E.amputation_segment_retrouve}
                  onChange={(v) => {
                    updateField('E', 'amputation_segment_retrouve', v);
                    if (v !== 'oui') updateField('E', 'amputation_conditionnement', '');
                  }}
                  options={OUI_NON}
                />
              </FieldCard>
              {form.E.amputation_segment_retrouve === 'oui' && (
                <FieldCard id="E_amputation_conditionnement" label="Conditionnement du segment" filled={!!form.E.amputation_conditionnement}>
                  <ToggleGroup
                    value={form.E.amputation_conditionnement}
                    onChange={(v) => updateField('E', 'amputation_conditionnement', v)}
                    options={OUI_NON}
                  />
                </FieldCard>
              )}
            </>
          )}
        </>
      );
    if (s === 'BRULURE')
      return (
        <>
          <FieldCard id="BRULURE_brulure" label="Brûlure" filled={!!form.BRULURE.brulure}>
            <div className="flex flex-col gap-3 items-stretch">
              <ToggleGroup
                value={form.BRULURE.brulure}
                onChange={(v) => {
                  updateField('BRULURE', 'brulure', v);
                  if (v !== 'oui') {
                    updateField('BRULURE', 'brulure_degre', '');
                    updateField('BRULURE', 'brulure_zones', []);
                    updateField('BRULURE', 'brulure_etendue', '');
                    updateField('BRULURE', 'brulure_loc_choices', []);
                    updateField('BRULURE', 'brulure_loc', '');
                    updateField('BRULURE', 'brulure_type', '');
                    updateField('BRULURE', 'cooling_done', '');
                    updateField('BRULURE', 'cooling_duration_min', '');
                    coolingTimer.reset();
                  }
                }}
                options={OUI_NON}
              />
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
                        invalid={
                          !!form.BRULURE.cooling_timer_min &&
                          !isPositiveNumber(form.BRULURE.cooling_timer_min)
                        }
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
                          invalid={
                            !!form.BRULURE.cooling_duration_min &&
                            !isPositiveNumber(form.BRULURE.cooling_duration_min)
                          }
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
                  </div>
                  {form.BRULURE.brulure_degre && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-neutral-500 uppercase tracking-wide">Type</span>
                      <ToggleGroup
                        value={form.BRULURE.brulure_type}
                        onChange={(v) => updateField('BRULURE', 'brulure_type', v)}
                        options={BRULURE_TYPE_OPTIONS}
                      />
                    </div>
                  )}
                  {form.BRULURE.brulure_type && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">
                          {pediatricPatient
                            ? 'Zones atteintes — repérage sans calcul automatique'
                            : 'Zones atteintes — règle des 9 de Wallace (adulte)'}
                        </span>
                        {pediatricPatient && (
                          <span className="text-xs font-semibold rounded-md border px-3 py-2" style={{ borderColor: AMBER, color: AMBER }}>
                            Calcul Wallace adulte désactivé chez l'enfant/nourrisson. Reporter l'étendue selon le référentiel pédiatrique de ton service (ex. Lund-Browder ou paume).
                          </span>
                        )}
                        <MultiToggleGroup
                          value={form.BRULURE.brulure_zones}
                          onChange={(zones) => {
                            updateField('BRULURE', 'brulure_zones', zones);
                            if (!pediatricPatient) {
                              const total = zones.reduce((sum, z) => {
                                const zone = BRULURE_ZONES_9.find((zz) => zz.value === z);
                                return sum + (zone ? zone.pct : 0);
                              }, 0);
                              updateField('BRULURE', 'brulure_etendue', total > 0 ? String(total) : '');
                            }
                          }}
                          options={
                            pediatricPatient
                              ? BRULURE_ZONES_9.map((zone) => ({ value: zone.value, label: zone.label }))
                              : BRULURE_ZONE_OPTIONS
                          }
                        />
                      </div>
                      <div id="BRULURE_brulure_etendue" className="flex flex-col gap-1.5">
                        <span className="text-xs text-neutral-500 uppercase tracking-wide">
                          Étendue totale (calculée, modifiable)
                        </span>
                        <InputBox
                          value={form.BRULURE.brulure_etendue}
                          onChange={(v) => updateField('BRULURE', 'brulure_etendue', v)}
                          invalid={!isNumberInRange(form.BRULURE.brulure_etendue, 0, 100)}
                          unit="% SC"
                          placeholder="Valeur"
                          numeric
                        />
                        <span className="text-xs text-neutral-600 italic">
                          Règle de la paume : la paume de la victime (doigts compris) ≈ 1 % de sa
                          surface corporelle — pratique pour ajuster sur des brûlures dispersées ou
                          plus petites qu'une zone entière.
                        </span>
                      </div>
                      <div id="BRULURE_brulure_loc" className="flex flex-col gap-1.5">
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
          <FieldCard id="FAST_face" label="Face" filled={!!form.FAST.face}>
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
          <FieldCard id="FAST_temps" label="Heure d'apparition" filled={!!form.FAST.temps || !!form.FAST.temps_choice}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.FAST.temps}
                  onChange={(v) => {
                    updateField('FAST', 'temps', formatTimeInput(v));
                    if (v) updateField('FAST', 'temps_choice', '');
                  }}
                  invalid={!!form.FAST.temps && !isValidTime(form.FAST.temps)}
                  placeholder="hh:mm"
                  numeric
                />
                <LiveClock onUse={(v) => updateField('FAST', 'temps', v)} />
              </div>
              <ToggleGroup
                value={form.FAST.temps_choice}
                onChange={(v) => {
                  updateField('FAST', 'temps_choice', v);
                  if (v) updateField('FAST', 'temps', '');
                }}
                options={FAST_TEMPS_CHOICE_OPTIONS}
              />
            </div>
          </FieldCard>
        </>
      );
    if (s === 'SAMPLER') {
      const selectedSymptoms = form.SAMPLER.symptom_choices || [];
      const hasAntithrombotic = (form.SAMPLER.sampler_m_choices || []).some((v) => ['anticoagulant', 'antiagregant'].includes(v));
      const samplerSuggestions = computeSamplerSuggestions(form.SAMPLER);
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
                  <div>
                    <span className="text-xs text-neutral-500">Heure de début</span>
                    <div className="flex items-center gap-2">
                      <InputBox
                        value={entry.t_heure || ''}
                        onChange={(v) => updatePqrstField(entry.id, 't_heure', formatTimeInput(v))}
                        invalid={!!entry.t_heure && !isValidTime(entry.t_heure)}
                        placeholder="hh:mm"
                        numeric
                        width="w-24"
                      />
                      <LiveClock onUse={(v) => updatePqrstField(entry.id, 't_heure', v)} />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-500">Depuis</span>
                    <InputBox
                      value={entry.t_duree || ''}
                      onChange={(v) => updatePqrstField(entry.id, 't_duree', v)}
                      invalid={!!entry.t_duree && !isPositiveNumber(entry.t_duree)}
                      placeholder="durée"
                      numeric="decimal"
                      width="w-24"
                    />
                  </div>
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
              if (v !== 'oui') {
                updateField('SAMPLER', 'sampler_a_choices', []);
                updateField('SAMPLER', 'allergy_reactions', []);
                updateField('SAMPLER', 'sampler_a', '');
              }
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
              onClick={() => {
                const next = withExclusiveNone(
                  form.SAMPLER.sampler_m_choices || [],
                  (form.SAMPLER.sampler_m_choices || []).includes('aucun') ? [] : ['aucun'],
                  'aucun'
                );
                updateSamplerChoices('sampler_m_choices', next);
                if (next.includes('aucun')) {
                  updateField('SAMPLER', 'sampler_m', '');
                  updateField('SAMPLER', 'meds_taken_today', '');
                }
              }}
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
                      onChange={(v) => updateSamplerChoices('sampler_m_choices', withExclusiveNone(form.SAMPLER.sampler_m_choices || [], v, 'aucun'))}
                      options={MEDICAMENT_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <InputBox value={form.SAMPLER.sampler_m} onChange={(v) => updateField('SAMPLER', 'sampler_m', v)} placeholder="Nom exact des médicaments" width="w-full" />
            {samplerSuggestions.length > 0 && (
              <div className="border rounded-md p-3 flex flex-col gap-2" style={{ borderColor: AMBER, backgroundColor: '#1A1508' }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: AMBER }}>
                  Liens à confirmer
                </span>
                {samplerSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="flex flex-col gap-2 border-t border-neutral-800 pt-2 first:border-0 first:pt-0">
                    <span className="text-xs text-neutral-200">
                      {suggestion.sourceLabel} peut correspondre à « {suggestion.targetLabel} » dans P. Confirmer ?
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => confirmSamplerSuggestion(suggestion)}
                        className="flex-1 px-3 py-2 rounded-md text-xs font-semibold text-white"
                        style={{ backgroundColor: ACCENT }}
                      >
                        Confirmer le lien
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissSamplerSuggestion(suggestion.id)}
                        className="px-3 py-2 rounded-md text-xs border border-neutral-700 text-neutral-300"
                      >
                        Ignorer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-neutral-800 pt-3 flex flex-col gap-2">
              <span className="text-xs text-neutral-500 uppercase">Traitement pris aujourd’hui ?</span>
              <ToggleGroup value={form.SAMPLER.meds_taken_today} onChange={(v) => updateField('SAMPLER', 'meds_taken_today', v)} options={TRAITEMENT_PRIS_OPTIONS} />
              {hasAntithrombotic && <div className="text-xs font-bold px-3 py-2 rounded-md border" style={{ borderColor: AMBER, color: AMBER }}>⚠ Anticoagulant / antiagrégant renseigné — information mise en évidence dans le récapitulatif.</div>}
            </div>
          </Accordion>

          <Accordion title="P — Passé médical" count={(form.SAMPLER.sampler_p_choices || []).length}>
            <button
              onClick={() => {
                const next = withExclusiveNone(
                  form.SAMPLER.sampler_p_choices || [],
                  (form.SAMPLER.sampler_p_choices || []).includes('aucun') ? [] : ['aucun'],
                  'aucun'
                );
                updateSamplerChoices('sampler_p_choices', next);
                if (next.includes('aucun')) updateField('SAMPLER', 'sampler_p', '');
              }}
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
                      onChange={(v) => updateSamplerChoices('sampler_p_choices', withExclusiveNone(form.SAMPLER.sampler_p_choices || [], v, 'aucun'))}
                      options={ANTECEDENTS_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <AutoLinkNotice
              values={form.SAMPLER.sampler_auto_links?.sampler_p_choices}
              options={ANTECEDENTS_OPTIONS}
            />
            <ConfirmedLinkNotice links={form.SAMPLER.sampler_confirmed_links} />
            <InputBox value={form.SAMPLER.sampler_p} onChange={(v) => updateField('SAMPLER', 'sampler_p', v)} placeholder="Précision" width="w-full" />
          </Accordion>

          <Accordion
            title="L — Dernière prise orale"
            count={(form.SAMPLER.sampler_l_choice ? 1 : 0) + (form.SAMPLER.sampler_l_nature || []).length}
          >
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <span className="text-xs text-neutral-500">Heure</span>
                <div className="flex items-center gap-2">
                  <InputBox
                    value={form.SAMPLER.sampler_l_time}
                    onChange={(v) => updateField('SAMPLER', 'sampler_l_time', formatTimeInput(v))}
                    invalid={!!form.SAMPLER.sampler_l_time && !isValidTime(form.SAMPLER.sampler_l_time)}
                    placeholder="hh:mm"
                    numeric
                    width="w-24"
                  />
                  <LiveClock onUse={(v) => updateField('SAMPLER', 'sampler_l_time', v)} />
                </div>
              </div>
              <ToggleGroup value={form.SAMPLER.sampler_l_choice} onChange={(v) => updateField('SAMPLER', 'sampler_l_choice', v)} options={REPAS_OPTIONS} />
            </div>
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
            <div>
              <span className="text-xs text-neutral-500">Heure de l’événement</span>
              <div className="flex items-center gap-2">
                <InputBox
                  value={form.SAMPLER.sampler_e_time}
                  onChange={(v) => updateField('SAMPLER', 'sampler_e_time', formatTimeInput(v))}
                  invalid={!!form.SAMPLER.sampler_e_time && !isValidTime(form.SAMPLER.sampler_e_time)}
                  placeholder="hh:mm"
                  numeric
                  width="w-24"
                />
                <LiveClock onUse={(v) => updateField('SAMPLER', 'sampler_e_time', v)} />
              </div>
            </div>
            <AutoLinkNotice
              values={form.SAMPLER.sampler_auto_links?.sampler_e_choices}
              options={EVENEMENT_OPTIONS}
            />
            <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
              {EVENEMENT_GROUPS.map((group) => {
                const groupCount = group.values.filter((v) => (form.SAMPLER.sampler_e_choices || []).includes(v)).length;
                return (
                  <Accordion key={group.title} title={group.title} count={groupCount}>
                    <MultiToggleGroup
                      value={form.SAMPLER.sampler_e_choices}
                      onChange={updateSamplerEvents}
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
                      onChange={(v) => updateSamplerChoices('sampler_r_choices', v)}
                      options={RISQUE_OPTIONS.filter((opt) => group.values.includes(opt.value))}
                    />
                  </Accordion>
                );
              })}
            </div>
            <AutoLinkNotice
              values={form.SAMPLER.sampler_auto_links?.sampler_r_choices}
              options={RISQUE_OPTIONS}
            />
            <InputBox value={form.SAMPLER.sampler_r} onChange={(v) => updateField('SAMPLER', 'sampler_r', v)} placeholder="Précision" width="w-full" />
          </Accordion>
        </>
      );
    }
    if (s === 'SURVEILLANCE') {
      const readings = form.SURVEILLANCE?.releves || [];
      return (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border px-3 py-2.5" style={{ borderColor: '#065F46', backgroundColor: '#071A14' }}>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: EMERALD }}>
              Option après le récapitulatif
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed mt-1">
              Ajoute uniquement les relevés nécessaires au suivi de la victime. Le bilan initial et sa transmission restent inchangés.
            </p>
          </div>
          <button
            type="button"
            onClick={prefillSurveillanceDraft}
            className="self-start text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-md border border-neutral-700 text-neutral-200"
          >
            {readings.length > 0 ? 'Reprendre le dernier relevé' : 'Reprendre les constantes initiales'}
          </button>

          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-4">
            <div>
              <span className="text-xs text-neutral-500 uppercase tracking-wide block mb-1.5">Heure du relevé</span>
              <div className="flex items-center gap-2 flex-wrap">
                <InputBox
                  value={surveillanceDraft.heure}
                  onChange={(v) => updateSurveillanceDraft('heure', formatTimeInput(v))}
                  invalid={!!surveillanceDraft.heure && !isValidTime(surveillanceDraft.heure)}
                  placeholder="hh:mm"
                  numeric
                  width="w-28"
                />
                <LiveClock onUse={(v) => updateSurveillanceDraft('heure', v)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-xs text-neutral-500">FR</span>
                <InputBox value={surveillanceDraft.fr} onChange={(v) => updateSurveillanceDraft('fr', v)} invalid={!isNumberInRange(surveillanceDraft.fr, 1, 100)} unit="/min" numeric />
              </div>
              <div>
                <span className="text-xs text-neutral-500">FC</span>
                <InputBox value={surveillanceDraft.fc} onChange={(v) => updateSurveillanceDraft('fc', v)} invalid={!isNumberInRange(surveillanceDraft.fc, 1, 300)} unit="/min" numeric />
              </div>
              <div>
                <span className="text-xs text-neutral-500">SpO2</span>
                <ToggleGroup value={surveillanceDraft.spo2_mode} onChange={(v) => updateSurveillanceDraft('spo2_mode', v || 'air')} options={SPO2_MODE} />
                <InputBox value={surveillanceDraft.spo2} onChange={(v) => updateSurveillanceDraft('spo2', v)} invalid={!isNumberInRange(surveillanceDraft.spo2, 1, 100)} unit="%" numeric />
              </div>
              <div>
                <span className="text-xs text-neutral-500">PA</span>
                <div className="flex items-center gap-1">
                  <InputBox value={surveillanceDraft.pa_sys} onChange={(v) => updateSurveillanceDraft('pa_sys', v)} invalid={!isNumberInRange(surveillanceDraft.pa_sys, 1, 300)} placeholder="SYS" numeric width="w-20" />
                  <span className="text-neutral-600">/</span>
                  <InputBox value={surveillanceDraft.pa_dia} onChange={(v) => updateSurveillanceDraft('pa_dia', v)} invalid={!isNumberInRange(surveillanceDraft.pa_dia, 1, 200)} placeholder="DIA" numeric width="w-20" />
                </div>
              </div>
              <div>
                <span className="text-xs text-neutral-500">Température</span>
                <InputBox value={surveillanceDraft.temperature} onChange={(v) => updateSurveillanceDraft('temperature', v)} invalid={!isNumberInRange(surveillanceDraft.temperature, 15, 45)} unit="°C" numeric="decimal" />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-neutral-500">Glycémie</span>
                <ToggleGroup value={surveillanceDraft.glycemie_unit} onChange={(v) => updateSurveillanceDraft('glycemie_unit', v || 'mg/dL')} options={GLYCEMIE_UNIT_OPTIONS} />
                <InputBox value={surveillanceDraft.glycemie} onChange={(v) => updateSurveillanceDraft('glycemie', v)} invalid={!!surveillanceDraft.glycemie && !isPositiveNumber(surveillanceDraft.glycemie)} unit={surveillanceDraft.glycemie_unit} numeric="decimal" />
              </div>
            </div>

            {surveillanceError && <span className="text-xs text-red-400">{surveillanceError}</span>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addSurveillanceReading}
                className="flex-1 py-2.5 rounded-md text-sm font-semibold text-white"
                style={{ backgroundColor: ACCENT }}
              >
                {editingReadingId ? 'Enregistrer les modifications' : 'Ajouter ce relevé'}
              </button>
              {editingReadingId && (
                <button
                  type="button"
                  onClick={cancelEditReading}
                  className="px-4 py-2.5 rounded-md text-sm font-semibold border border-neutral-700 text-neutral-300"
                >
                  Annuler
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              Relevés enregistrés ({readings.length})
            </span>
            {readings.length === 0 ? (
              <span className="text-sm text-neutral-600 italic">Aucun relevé de surveillance ajouté.</span>
            ) : (
              readings.map((reading, index) => {
                const previous = index > 0 ? readings[index - 1] : null;
                const delta = formatSurveillanceDelta(reading, previous);
                const elapsed = surveillanceElapsedLabel(reading, previous);
                const isEditingThis = editingReadingId === reading.id;
                return (
                  <div
                    key={reading.id || `${reading.heure}_${index}`}
                    className="bg-neutral-900 border rounded-md px-3 py-2.5 flex gap-3 items-start"
                    style={{ borderColor: isEditingThis ? ACCENT : '#262626' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold" style={{ color: ACCENT }}>{reading.heure || 'Heure non renseignée'}</div>
                        {elapsed && <span className="text-xs text-neutral-500">{elapsed}</span>}
                      </div>
                      <div className="text-sm text-neutral-200 mt-1">{formatSurveillanceReading(reading)}</div>
                      {delta && <div className="text-xs text-neutral-500 mt-1">Évolution : {delta}</div>}
                    </div>
                    <button type="button" onClick={() => startEditReading(reading)} className="text-neutral-400 p-1" aria-label={`Modifier le relevé de ${reading.heure}`}>
                      <Play size={15} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button type="button" onClick={() => removeSurveillanceReading(reading.id)} className="text-red-400 p-1" aria-label={`Supprimer le relevé de ${reading.heure}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <ExportButtons
          form={form}
          patientNum={patientNum}
          recordedAt={currentRecordTimestamp || bilanStartRef.current || Date.now()}
        />
        <RecapView data={form} onNavigate={navigateToMissing} />
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
        className="w-full flex flex-col items-center justify-center bg-neutral-950 text-neutral-100 px-6"
        style={{
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          minHeight: '100svh',
          height: '100dvh',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
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
    <div
      className="w-full flex flex-col bg-neutral-950 text-neutral-100"
      style={{
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        minHeight: '100svh',
        height: '100dvh',
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .step-fade { animation: fadeIn 0.2s ease; }
        button, input, textarea { -webkit-tap-highlight-color: transparent; }
      `}</style>

      <header
        className="border-b border-neutral-800 px-4 pt-4 pb-3 flex flex-col gap-3 shrink-0"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
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
            {autosaveStatus !== 'idle' && (
              <div className="text-[11px] mt-0.5" style={{ color: autosaveStatus === 'error' ? '#F87171' : '#737373' }}>
                {autosaveStatus === 'saving' && 'Sauvegarde du brouillon…'}
                {autosaveStatus === 'saved' && 'Brouillon sauvegardé automatiquement'}
                {autosaveStatus === 'error' && 'Brouillon non sauvegardé'}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-xs text-neutral-400 border border-neutral-800 rounded-md px-2.5 py-1.5 hover:border-neutral-600"
          >
            <History size={14} /> Historique{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>
        <div className="flex gap-1" aria-label="État des étapes du bilan">
          {STEPS.map((s, i) => {
            const status = getStepStatus(s, form);
            const statusLabel = {
              empty: 'non renseigné',
              incomplete: 'incomplet',
              complete: 'complet',
              alert: 'alerte présente',
            }[status];
            const color = {
              empty: '#292929',
              incomplete: AMBER,
              complete: EMERALD,
              alert: ACCENT,
            }[status];
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setMissingReviewMode(null);
                  setStep(i);
                }}
                className="flex-1 h-7 flex items-center justify-center rounded"
                aria-label={`${PAGE_TITLES[s] || s} : ${statusLabel}`}
                title={`${PAGE_TITLES[s] || s} — ${statusLabel}`}
              >
                <span
                  className="w-full rounded-full"
                  style={{ backgroundColor: color, height: i === step ? '0.55rem' : '0.35rem' }}
                />
              </button>
            );
          })}
        </div>
        <div className="text-xs text-neutral-500 -mt-1">
          {STEPS[step] === 'SURVEILLANCE'
            ? 'Option après le récapitulatif'
            : `Étape ${step + 1}/${STEPS.indexOf('RECAP') + 1}`}{' '}
          ·{' '}
          <span className="text-neutral-100 font-semibold">
            {PAGE_TITLES[STEPS[step]] || STEPS[step]}
          </span>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4">
        {missingReviewMode && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ borderColor: AMBER, backgroundColor: '#1A1508' }}>
            <span className="text-xs font-semibold" style={{ color: AMBER }}>
              {missingReviewMode === 'single'
                ? 'Correction ciblée : Suivant retourne directement au récapitulatif'
                : 'Mode vérification : seules les étapes incomplètes sont parcourues'}
            </span>
            <button
              type="button"
              onClick={() => setMissingReviewMode(null)}
              className="text-xs text-neutral-300 underline shrink-0"
            >
              Quitter
            </button>
          </div>
        )}
        <div key={step} className="step-fade flex flex-col gap-3">
          {renderStepContent()}
        </div>
      </main>

      <footer
        className="border-t border-neutral-800 px-4 py-3 flex gap-3 shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {STEPS[step] === 'SURVEILLANCE' ? (
          <div className="w-full flex flex-col gap-2">
            <button
              onClick={missingReviewMode === 'all' ? goNext : returnToRecap}
              style={{ backgroundColor: ACCENT }}
              className="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-md text-white font-semibold"
            >
              <ChevronLeft size={16} />
              {missingReviewMode === 'all' ? 'Point suivant' : 'Retour au récapitulatif'}
            </button>
            <span className="text-center text-[11px] text-neutral-500">
              Le suivi est facultatif et peut être complété plusieurs fois.
            </span>
          </div>
        ) : STEPS[step] !== 'RECAP' ? (
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
              {missingReviewMode === 'single'
                ? 'Suivant — Récapitulatif'
                : missingReviewMode === 'all'
                  ? 'Point suivant'
                  : 'Suivant'}{' '}
              <ChevronRight size={16} />
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={openFollowUp}
              className="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-md border font-semibold"
              style={{ borderColor: '#065F46', color: EMERALD, backgroundColor: '#071A14' }}
            >
              <FileText size={16} />
              {(form.SURVEILLANCE?.releves || []).length > 0
                ? `Bilan de suivi (${form.SURVEILLANCE.releves.length} relevé${form.SURVEILLANCE.releves.length > 1 ? 's' : ''})`
                : 'Ajouter un bilan de suivi (facultatif)'}
            </button>
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
                <p className="text-xs text-neutral-500 border border-neutral-800 rounded-md px-3 py-2 mb-3">
                  Données conservées localement sur cet appareil. Supprime chaque bilan dès que sa conservation n'est plus nécessaire.
                </p>
                {loadingHistory ? (
                  <p className="text-neutral-500 text-sm">Chargement…</p>
                ) : history.length === 0 ? (
                  <p className="text-neutral-500 text-sm">Aucun bilan enregistré.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {history.map((rec) => (
                      <div key={rec.id} className="flex gap-2">
                        <button
                          onClick={() => setViewing(rec)}
                          className="flex-1 text-left bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2.5 flex items-center justify-between hover:border-neutral-600"
                        >
                          <span className="font-semibold text-sm">Bilan n°{rec.patientNum}</span>
                          <span className="text-xs text-neutral-500" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                            {rec.date} · {rec.heure}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteHistoryRecord(rec)}
                          aria-label={`Effacer le bilan n°${rec.patientNum}`}
                          className="px-3 rounded-md border border-neutral-800 text-red-400 hover:border-red-800"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => deleteHistoryRecord(viewing)}
                      className="text-red-400 border border-neutral-800 rounded-md p-1.5"
                      aria-label={`Effacer le bilan n°${viewing.patientNum}`}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button onClick={() => setViewing(null)} aria-label="Retour à l'historique">
                      <ChevronLeft size={18} />
                    </button>
                  </div>
                </div>
                <div className="mb-4">
                  <ExportButtons
                    form={viewing.data}
                    patientNum={viewing.patientNum}
                    recordedAt={viewing.timestamp}
                  />
                </div>
                <RecapView data={viewing.data} />
              </>
            )}
          </div>
        </div>
      )}

      {draftCandidate && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.78)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="draft-resume-title"
        >
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-neutral-800 bg-neutral-950 p-5 flex flex-col gap-4">
            <div>
              <h2 id="draft-resume-title" className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                Reprendre le bilan en cours ?
              </h2>
              <p className="text-sm text-neutral-400 mt-1">
                Un brouillon du bilan n°{draftCandidate.patientNum || patientNum} a été retrouvé
                {draftCandidate.updatedAt
                  ? `, sauvegardé le ${new Date(draftCandidate.updatedAt).toLocaleString('fr-FR')}`
                  : ''}.
              </p>
            </div>
            <button
              type="button"
              onClick={resumeDraft}
              className="w-full py-3 rounded-md text-sm font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Reprendre ce bilan
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="w-full py-2.5 rounded-md text-sm border border-neutral-800 text-neutral-300"
            >
              Effacer le brouillon et recommencer
            </button>
          </div>
        </div>
      )}

      <O2AlarmModal active={o2AlarmActive} remaining={o2RemainingMin} onStop={stopO2Alarm} />
      <CoolingModal active={coolingTimer.done} minutes={Math.round(coolingMinutes)} onStop={coolingTimer.reset} />
      <ReconditionModal active={showRecondition} data={form} onClose={() => setShowRecondition(false)} />
    </div>
  );
}
