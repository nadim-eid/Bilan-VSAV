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
const DRAFT_SCHEMA_VERSION = 6;
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
  'CONTEXTE',
  'PRIMAIRE',
  'X',
  'A',
  'B',
  'C',
  'D',
  'E',
  'BRULURE',
  'FAST',
  'SAMPLER',
  'BILANS',
  'LESIONS',
  'POSITION',
  'RECAP',
  'SURVEILLANCE',
];
const LEGACY_STEPS_V5 = ['TYPE', 'X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER', 'RECAP', 'SURVEILLANCE'];
const LEGACY_STEPS_V3 = [...LEGACY_STEPS_V5.slice(0, -2), 'SURVEILLANCE', 'RECAP'];
const PAGE_TITLES = {
  TYPE: 'Victime et références',
  CONTEXTE: 'Bilan circonstanciel et premier contact',
  PRIMAIRE: 'Appréciation primaire rapide',
  BILANS: 'Bilans ciblés',
  LESIONS: 'Lésions et hémorragies localisées',
  POSITION: 'Position et conditionnement',
  X: 'Trauma & hémorragie',
  A: 'Voies aériennes',
  B: 'Respiration',
  C: 'Circulation',
  D: 'Neurologique',
  E: 'Exposition',
  BRULURE: 'Brûlure',
  FAST: 'FAST — Suspicion AVC',
  SAMPLER: 'SAMPLER — Anamnèse',
  SURVEILLANCE: 'Surveillance et réévaluation',
  RECAP: 'Récapitulatif et transmission',
};
const SECTION_BADGE = { CONTEXTE: 'Ct', PRIMAIRE: 'Pr', BILANS: 'Bc', LESIONS: 'L', POSITION: 'Po',
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

// Constantes extraites des deux références fournies ; les règles contextuelles
// (PA, glycémie, O2, naissance) sont centralisées dans referenceRange().
const PATIENT_CATEGORIES = {
  nouveau_ne: { label: 'Nouveau-né', ageRange: '0 à 28 jours inclus, hors adaptation à la naissance', ranges: { fr: [40, 60], fc: [120, 160], spo2: [94, 100] } },
  nourrisson: { label: 'Nourrisson', ageRange: 'Après 28 jours et avant 2 ans', ranges: { fr: [30, 40], fc: [100, 160], spo2: [94, 100] } },
  enfant: { label: 'Enfant', ageRange: 'À partir de 2 ans jusqu’à la puberté ; doute = enfant', ranges: { fr: [20, 30], fc: [70, 140], spo2: [94, 100] } },
  adulte: { label: 'Adulte', ageRange: 'Puberté connue ; contexte gériatrique séparé', ranges: { fr: [12, 20], fc: [60, 100], spo2: [94, 100] } },
};

const OUI_NON = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];
const POSITIF_NEGATIF = [{ value: 'positif', label: 'Positif' }, { value: 'negatif', label: 'Négatif' }];
const SPO2_MODE = [{ value: 'air', label: 'Sous air' }, { value: 'o2', label: 'Sous O2' }];
const GLYCEMIE_UNIT_OPTIONS = [
  { value: 'mg/dL', label: 'mg/dL' },
  { value: 'g/L', label: 'g/L' },
  { value: 'mmol/L', label: 'mmol/L' },
];
const O2_INTERFACE_OPTIONS = [
  { value: 'lunettes', label: 'Lunettes nasales' },
  { value: 'masque_simple', label: 'Masque simple' },
  { value: 'masque_haute_concentration', label: 'Masque haute concentration' },
  { value: 'bavu', label: 'BAVU avec O2' },
  { value: 'pediatrique', label: 'Interface pédiatrique' },
  { value: 'tracheotomie', label: 'Masque de trachéotomie' },
  { value: 'nebuliseur', label: 'Nébuliseur (débit réellement utilisé)' },
  { value: 'autre', label: 'Autre interface' },
];

// Plages de débit habituellement associées à chaque interface — sert uniquement à
// signaler une incohérence probable, jamais à imposer ou corriger la saisie.
const O2_INTERFACE_DEBIT_RANGE = {
  lunettes: [1, 6],
  masque_simple: [6, 10],
  masque_haute_concentration: [9, 15],
};

// Débit initial usuel par dispositif (protocole secourisme) — proposé automatiquement
// dès qu'un dispositif est choisi, mais uniquement si aucun débit n'a déjà été saisi.
const O2_INTERFACE_DEFAULT_DEBIT = {
  lunettes: '2',
  masque_simple: '6',
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

const TRC_OPTIONS = [{ value: '<2s', label: '< 2 s' }, { value: '=2s', label: '= 2 s' }, { value: '>2s', label: '> 2 s' }];
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
  airway_free: 'Liberté des voies aériennes',
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
  X: ['hemorragie', 'hemorragie_sites', 'garrot_pose', 'garrot_heure'],
  A: ['airway_free', 'liberation_effectuee', 'trauma', 'collier_pose'],
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
  const num = numberValue(rawValue);
  if (!Number.isFinite(num)) return NaN;
  const resolvedUnit = unit || detectLegacyGlycemieUnit(rawValue);
  return resolvedUnit === 'mg/dL' ? num / 100 : resolvedUnit === 'mmol/L' ? num * 0.18016 : num;
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
  airway_free: optsToLabels(OUI_NON),
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
  const page = Object.keys(MEASUREMENT_FIELDS).find((key) => MEASUREMENT_FIELDS[key].includes(field));
  const result = page && data?.META?.assessments?.[`${page}.${field}`];
  if (result?.status && result.status !== 'valeur') return `${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (
      field === 'brulure_zones' &&
      isPediatric(data)
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

// Audit SSUAP : périmètre demandé, sans R22/R51/R57/R58/R59/R60/R64/R66.
// Les références locales fournies sont conservées ; les discordances sont visibles.
const RULESET = Object.freeze({
  id: 'SSUAP-01-audit-2026-10-07', schema: 6,
  sources: ['Application SSUAP SDIS 01 — tome théorique fourni', 'Application SSUAP SDIS 01 — tome technique fourni'],
  excluded: [22, 51, 57, 58, 59, 60, 64, 66],
  references: {
    age: 'T1 bilan pédiatrique ; T2 FT M.01 / S.03',
    constants: 'T1 bilan secondaire ; T2 FT S.03 à S.03',
    oxygen: 'T2 FT M.07 : air 94–100 %, cible O2 94–98 %, IRC 89–92 %',
    pa: 'Discordance T1 (PAS adulte 100–160) / T2 S.02 (<90/60 et >140/90)',
    gly: 'T1 / T2 S.03 : à jeun 0,8–1,1 g/L ; hypoglycémie certaine <0,6 g/L',
    birth: 'T1 accouchement et adaptation à la naissance ; T2 M.04/M.24. Cadence néonatale à valider.',
  },
});
const ASSESSMENT_OPTIONS = [
  { value: 'valeur', label: 'Renseigné / évalué' }, { value: 'inconnu', label: 'Inconnu' },
  { value: 'non_evalue', label: 'Non évalué' }, { value: 'non_applicable', label: 'Non applicable' },
  { value: 'impossible', label: 'Impossible' },
];
const RESULT_OPTIONS = [
  { value: 'valeur', label: 'Valeur' }, { value: 'absent', label: 'Absent' },
  { value: 'non_mesurable', label: 'Non mesurable' }, { value: 'non_realise', label: 'Non réalisé' },
  { value: 'non_fiable', label: 'Non fiable' }, { value: 'LO', label: 'LO' }, { value: 'HI', label: 'HI' },
];
const EXT_YN = ['oui', 'non', 'inconnu', 'non_evalue', 'non_applicable', 'impossible'];
const EXT_LABELS = { oui: 'Oui', non: 'Non', inconnu: 'Inconnu', non_evalue: 'Non évalué', non_applicable: 'Non applicable', impossible: 'Impossible' };
const hasValue = (value) => value !== '' && value !== null && value !== undefined;
const numberValue = (raw) => hasValue(raw) && /^-?\d+(?:[.,]\d+)?$/.test(String(raw).trim()) ? Number(String(raw).replace(',', '.')) : NaN;
const toLocalDateTime = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
};
function dateTimeISO(local) {
  if (!local) return null;
  const parsed = new Date(local);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function ageContext(data) {
  const type = data.TYPE || {};
  let days = NaN;
  let years = NaN;
  if (type.birth_date && data.META?.referenceAt) {
    const birth = new Date(`${type.birth_date}T00:00:00`);
    const ref = new Date(data.META.referenceAt);
    const daySerial = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    days = (daySerial(ref) - daySerial(birth)) / 86400000;
    years = ref.getFullYear() - birth.getFullYear();
    if (ref.getMonth() < birth.getMonth() || (ref.getMonth() === birth.getMonth() && ref.getDate() < birth.getDate())) years -= 1;
  } else if (hasValue(type.age_value)) {
    const age = numberValue(type.age_value);
    if (type.age_unit === 'jours') { days = age; years = age / 365.25; }
    if (type.age_unit === 'mois') { days = age * 365.25 / 12; years = age / 12; }
    if (type.age_unit === 'ans') { days = age * 365.25; years = age; }
  }
  if (Number.isFinite(days) && days < 0) return { category: null, days, years, issue: 'Date de naissance ou âge incohérent' };
  let category = null;
  if (Number.isFinite(days)) {
    if (days <= 28) category = 'nouveau_ne';
    else if (years < 2) category = 'nourrisson';
    else category = type.puberty === 'oui' || type.categorie === 'adulte' ? 'adulte' : 'enfant';
  } else if (!type.legacy_age_uncertain) category = type.categorie === 'age' ? 'adulte' : type.categorie || null;
  return { category, days, years, issue: type.legacy_age_uncertain && !Number.isFinite(days) ? 'Ancien groupe 0–2 ans : préciser l’âge ; aucune reclassification automatique.' : null };
}
function isPediatric(data) { return ['nouveau_ne', 'nourrisson', 'enfant'].includes(ageContext(data).category); }
function pressureReference(data) {
  const context = ageContext(data);
  if (context.category === 'nouveau_ne') return { min: 60, source: 'T2 S.02 : minimum PAS nouveau-né' };
  if (context.category === 'nourrisson') return { min: 70, source: 'T2 S.02 : minimum PAS nourrisson' };
  if (context.category === 'enfant') return Number.isFinite(context.years)
    ? { min: context.years < 10 ? 70 + 2 * context.years : 90, source: 'T2 S.02 : PAS minimale 70 + 2 × âge (<10 ans), puis 90' }
    : { min: null, source: 'Âge exact requis pour la PAS pédiatrique' };
  if (context.category === 'adulte') {
    if (data.TYPE?.pa_profile === 'T1') return { min: 100, max: 160, source: 'T1, profil explicitement confirmé', discordant: true };
    if (data.TYPE?.pa_profile === 'T2') return { min: 90, max: 140, diaMin: 60, diaMax: 90, source: 'T2 S.02, profil explicitement confirmé', discordant: true };
    return { min: null, source: RULESET.references.pa, discordant: true };
  }
  return { min: null, source: 'Population non précisée' };
}
function oxygenTarget(data, mode = 'o2') {
  if (data.TYPE?.birth_context === 'naissance') return { min: null, max: null, source: 'Adaptation à la naissance : consigne spécifique et âge depuis T0 ; cible générale désactivée' };
  if (mode === 'air') return { min: 94, max: 100, source: 'T1 / T2 S.05 : air ambiant' };
  const b = data.B || {};
  if (b.target_confirmed === 'oui' && b.target_source && hasValue(b.target_min) && hasValue(b.target_max)) {
    const min = numberValue(b.target_min), max = numberValue(b.target_max);
    if (min >= 0 && max <= 100 && min <= max) return { min, max, source: b.target_source, prescribed: true };
  }
  const irc = moduleValue(data, 'irc', 'irc') === 'oui';
  return irc ? { min: 89, max: 92, source: 'T2 M.07 IRC : 89–92 %. Comparaison externe 88–92 % : faire confirmer la consigne.' }
    : { min: 94, max: 98, source: 'T2 M.07 : cible sous O2 hors naissance' };
}

function entryText(entry) {
  if (!entry) return null;
  if (typeof entry !== 'object') return String(entry);
  const status = entry.status && entry.status !== 'valeur' ? EXT_LABELS[entry.status] || entry.status : '';
  const content = status || (hasValue(entry.value) ? EXT_LABELS[entry.value] || entry.value : '');
  if (!content && !entry.reason) return null;
  return [content, entry.reason && `motif : ${entry.reason}`, entry.source && `source : ${entry.source}`,
    entry.observedAt ? `observé ${new Date(entry.observedAt).toLocaleString('fr-FR')}` : 'heure d’observation non confirmée',
    entry.eventAt && `événement ISO : ${entry.eventAt}`, entry.recordedAt && `saisi ${new Date(entry.recordedAt).toLocaleString('fr-FR')}`].filter(Boolean).join(' ; ');
}
function clinicalSummaryLines(data) {
  const lines = [];
  const context = ageContext(data);
  if (data.TYPE?.age_value) lines.push(`Âge : ${data.TYPE.age_value} ${data.TYPE.age_unit || 'ans'}`);
  if (data.TYPE?.birth_date) lines.push(`Naissance : ${data.TYPE.birth_date}`);
  if (data.TYPE?.weight) lines.push(`Poids connu : ${data.TYPE.weight} kg`);
  if (context.issue) lines.push(`À vérifier : ${context.issue}`);
  if (data.TYPE?.pa_profile) lines.push(`Profil PA : ${pressureReference(data).source}`);
  if (data.B?.o2_active === 'oui') {
    const target = oxygenTarget(data);
    lines.push(`Cible O2 : ${target.min === null ? 'consigne spécifique naissance' : `${target.min}–${target.max} %`} ; ${target.source}`);
  }
  const section = (title, fields, values) => {
    const entries = fields.map(([key, label]) => { const value = entryText(values?.[key]); return value ? `  ${label} : ${value}` : null; }).filter(Boolean);
    if (entries.length) lines.push(title, ...entries, '');
  };
  Object.entries(EXT_FIELDS).forEach(([page, fields]) => section(PAGE_TITLES[page] || page, fields, data[page]?.clinical));
  (data.BILANS?.selected || []).forEach((id) => { const module = CLINICAL_MODULES[id]; if (module) section(`${module.title} — ${module.source}`, module.fields, data.BILANS.values[id]); });
  for (const [page, key, fields, label] of [['LESIONS', 'items', REPEAT_FIELDS.lesion, 'Lésion'], ['LESIONS', 'hemorrhages', REPEAT_FIELDS.hemorrhage, 'Hémorragie / garrot'], ['NAISSANCE', 'babies', REPEAT_FIELDS.baby, 'Nouveau-né'], ['VENTILATION', 'episodes', REPEAT_FIELDS.ventilation, 'Ventilation'], ['VENTILATION', 'aspirations', REPEAT_FIELDS.aspiration, 'Aspiration']]) {
    (data[page]?.[key] || []).forEach((item, i) => { lines.push(`${label} ${i + 1} — identifiant ${item.id}`); section(label, fields, item); if (page === 'NAISSANCE') (item.readings || []).forEach((reading, index) => section(`Bébé ${item.id} — relevé ${index + 1}`, REPEAT_FIELDS.baby_reading, reading)); });
  }
  Object.entries(data.META?.assessments || {}).forEach(([key, meta]) => {
    if (!meta.status && !meta.observedAt && !meta.reason) return;
    lines.push(`${key} : ${meta.status || 'état non confirmé'}${meta.reason ? ` ; ${meta.reason}` : ''} ; ${meta.observedAt ? `observé ${new Date(meta.observedAt).toLocaleString('fr-FR')}` : 'date de mesure non confirmée'}${meta.recordedAt ? ` ; saisi ${new Date(meta.recordedAt).toLocaleString('fr-FR')}` : ''}`);
  });
  const gcs = Object.fromEntries(Object.entries(data.D?.clinical || {}).filter(([key]) => key.startsWith('gcs_')).map(([key, item]) => [key, item.status === 'valeur' ? item.value : 'NT']));
  if (['gcs_y', 'gcs_v', 'gcs_m'].some((key) => hasValue(gcs[key]))) lines.push(`Glasgow Y${gcs.gcs_y || '?'} V${gcs.gcs_v || '?'} M${gcs.gcs_m || '?'} ; total ${gcsTotal(gcs) ?? 'non calculable'}`);
  (data.META?.migration || []).forEach((note) => lines.push(`Migration : ${note}`));
  lines.push(`Référentiel de repérage : ${data.META?.ruleset || RULESET.id} ; ${RULESET.sources.join(' ; ')}`);
  return lines;
}
function ClinicalSummary({ data }) {
  return <Accordion title="Bilans ciblés, chronologie et provenance" defaultOpen>
    <div className="flex flex-col gap-1">{clinicalSummaryLines(data).map((line, index) => <p key={index} className="text-xs text-neutral-300 whitespace-pre-wrap break-words">{line || '\u00a0'}</p>)}</div>
  </Accordion>;
}
function criticalClinicalLines(data) {
  const lines = [];
  if (data.X?.hemorragie === 'oui') lines.push(`Hémorragie: ${(data.X.hemorragie_sites || []).join(', ') || 'site à préciser'}`);
  if (data.X?.garrot_pose === 'oui') lines.push(`Garrot X: ${data.X.garrot_heure || 'heure à préciser'}`);
  if (data.E?.amputation === 'oui') lines.push(`Amputation: ${data.E.amputation_localisation || '?'} ; garrot ${data.E.amputation_garrot || '?'} ${data.E.amputation_garrot_heure || ''}`);
  const primary = effectiveEntries(data.PRIMAIRE?.clinical);
  if (primary.critical?.value) lines.push(`Primaire critique: ${primary.critical.value}`);
  if (['absente', 'inefficace', 'gasps'].includes(primary.breathing?.value)) lines.push(`Respiration: ${primary.breathing.value}`);
  if (clinicalValue(data, 'B', 'breathing')) lines.push(`Respiration: ${clinicalValue(data, 'B', 'breathing')}`);
  if (data.D?.etat && (!data.META?.assessments?.['D.etat']?.status || data.META.assessments['D.etat'].status === 'valeur')) lines.push(`AVPU ${data.D.etat}`);
  const g = Object.fromEntries(Object.entries(data.D?.clinical || {}).filter(([key]) => key.startsWith('gcs_')).map(([key, item]) => [key, item.status === 'valeur' ? item.value : 'NT']));
  if (g.gcs_y || g.gcs_v || g.gcs_m) lines.push(`GCS Y${g.gcs_y || '?'} V${g.gcs_v || '?'} M${g.gcs_m || '?'} = ${gcsTotal(g) ?? 'NT'}`);
  for (const key of ['last_well', 'last_well_status', 'last_well_source', 'discovered_at', 'onset_at', 'onset_status', 'laterality', 'resolved']) {
    const value = clinicalValue(data, 'FAST', key); if (value) lines.push(`${EXT_FIELDS.FAST.find((d) => d[0] === key)?.[1]}: ${value}`);
  }
  for (const [id, keys] of [['grossesse', ['status', 'term', 'bleeding', 'abdominal_pain', 'headache', 'vision', 'epigastric', 'seizure', 'postpartum', 'delivery_at']], ['irc', ['irc', 'bpco', 'usual_spo2', 'usual_condition', 'home_flow', 'prescribed_target']], ['convulsions', ['start', 'end', 'count', 'between']], ['co', ['source', 'measure_kind', 'measure_value', 'pregnancy']], ['allergie', ['edema', 'voice', 'breathing', 'circulation', 'injector', 'injector_at', 'consign', 'effect']], ['glycemie', ['swallow', 'resugar', 'resugar_at', 'effect', 'recheck']], ['naissance', ['mother_id', 'mother_loss', 'mother_state', 'placenta', 'placenta_at', 'maternal_response']]]) {
    if (!data.BILANS?.selected?.includes(id)) continue;
    const parts = keys.map((key) => { const v = moduleValue(data, id, key); return hasValue(v) ? `${CLINICAL_MODULES[id].fields.find((d) => d[0] === key)?.[1]} ${v}` : null; }).filter(Boolean);
    lines.push(`${CLINICAL_MODULES[id].title}: ${parts.join('; ') || 'ouvert, données à compléter'}`);
  }
  for (const entry of data.LESIONS?.hemorrhages || []) lines.push(`Hémorragie/garrot ${entry.tourniquet_id?.value || entry.id}: ${entry.site?.value || '?'} ${entry.technique?.value || '?'} ${entry.at?.value || 'date inconnue'} effet ${entry.response?.value || '?'}`);
  for (const baby of data.NAISSANCE?.babies || []) lines.push(`Bébé ${baby.id} mère ${baby.mother_id?.value || '?'} T0 ${baby.birth_at?.value || '?'} respiration ${baby.breathing?.value || '?'} FC ${baby.fc?.value || '?'} SpO2 ${baby.spo2?.value || '?'} mesure ${baby.reading_at?.value || '?'}`);
  for (const baby of data.NAISSANCE?.babies || []) { const readings = baby.readings || []; const reading = readings[readings.length - 1]; if (reading) lines.push(`Dernier relevé bébé ${baby.id}: ${reading.at?.eventAt || reading.at?.value || '?'} respiration ${reading.breathing?.value || '?'} tonus ${reading.tone?.value || '?'} FC ${reading.fc?.value || '?'} SpO2 ${reading.spo2?.value || '?'} ${reading.o2?.value || ''}`); }
  for (const v of data.VENTILATION?.episodes || []) lines.push(`Ventilation ${v.start?.value || '?'} → ${v.end?.value || 'fin non renseignée'} ${v.device?.value || '?'} gaz ${v.air_o2?.value || '?'} débit ${v.flow?.value || '?'} effet ${v.response?.value || '?'}`);
  for (const a of data.VENTILATION?.aspirations || []) lines.push(`Aspiration ${a.start?.eventAt || a.start?.value || '?'} → ${a.end?.eventAt || a.end?.value || '?'} ${a.indication?.value || '?'} réglage ${a.setting?.value || '?'} effet ${a.response?.value || '?'}`);
  const lastO2 = data.B?.o2_sessions?.[data.B.o2_sessions.length - 1];
  if (lastO2) lines.push(`Dernier épisode O2 : ${formatO2Session(lastO2)}`);
  return lines;
}
function clinicalAlerts(data) {
  const alerts = [];
  const add = (page, label, details) => { const found = details.filter(Boolean); if (found.length) alerts.push({ page, label, details: found }); };
  const p = effectiveEntries(data.PRIMAIRE?.clinical);
  add('PRIMAIRE', 'Appréciation primaire', [p.critical?.value === 'oui' && 'victime critique', p.massive_bleed?.value === 'oui' && 'hémorragie massive', p.airway?.value === 'non' && 'voies aériennes non libres', ['absente', 'inefficace', 'gasps'].includes(p.breathing?.value) && `respiration ${p.breathing.value}`, p.pulse?.value === 'absent' && 'pouls absent', ['V', 'P', 'U'].includes(p.avpu?.value) && `réactivité ${p.avpu.value}`]);
  add('B', 'Signes respiratoires', [['absente', 'inefficace', 'gasps'].includes(clinicalValue(data, 'B', 'breathing')) && `respiration ${clinicalValue(data, 'B', 'breathing')}`, numberValue(data.B?.fr) === 0 && 'FR nulle rapportée', clinicalValue(data, 'B', 'exhaustion') === 'oui' && 'épuisement respiratoire']);
  add('C', 'Perfusion', [numberValue(data.C?.fc) === 0 && 'FC nulle rapportée', data.META?.assessments?.['C.fc']?.status === 'absent' && 'FC / pouls absent rapporté', clinicalValue(data, 'C', 'pulse_presence') === 'absent' && 'pouls absent', numberValue(clinicalValue(data, 'C', 'trc_seconds')) > 2 && 'TRC >2 s']);
  const gly = glycemieToGL(data.D?.glycemie, data.D?.glycemie_unit), status = data.META?.assessments?.['D.glycemie']?.status;
  const neonatal = ageContext(data).category === 'nouveau_ne' || data.TYPE?.birth_context === 'naissance';
  add('D', 'Glycémie', [status === 'LO' && 'résultat LO', status === 'HI' && 'résultat HI', !neonatal && (!status || status === 'valeur') && Number.isFinite(gly) && gly < 0.6 && 'glycémie <0,6 g/L (seuil certain du guide)', !neonatal && (!status || status === 'valeur') && gly >= 0.6 && gly < 0.7 && 'glycémie 0,6–0,7 g/L : vigilance conservée, règle locale à confirmer']);
  const pa = selectedPa(data);
  if (ageContext(data).category === 'adulte' && !data.TYPE.pa_profile && pa) add('C', 'PA : discordance entre tomes', [(numberValue(pa.sys) <= 100 || numberValue(pa.sys) > 140 || numberValue(pa.dia) < 60 || numberValue(pa.dia) > 90) && `PA ${pa.sys}/${pa.dia} : repère d’au moins un tome ; profil local à confirmer`]);
  if (data.BILANS?.selected?.includes('grossesse')) {
    const danger = ['bleeding', 'abdominal_pain', 'headache', 'vision', 'epigastric', 'malaise', 'seizure'].filter((key) => moduleValue(data, 'grossesse', key) === 'oui');
    add('BILANS', 'Grossesse / post-partum', danger.map((key) => CLINICAL_MODULES.grossesse.fields.find((d) => d[0] === key)?.[1]));
  }
  add('BILANS', 'Infection', [moduleValue(data, 'infection', 'purpura_exam') === 'positif' && 'purpura constaté', moduleValue(data, 'infection', 'confusion') === 'oui' && 'confusion nouvelle']);
  add('BILANS', 'Allergie actuelle', [moduleValue(data, 'allergie', 'edema') === 'oui' && 'œdème langue/gorge/face', moduleValue(data, 'allergie', 'voice') === 'oui' && 'voix modifiée / gêne à avaler']);
  return alerts;
}
function clinicalMissingChecks(data, existing) {
  const deferred = ['différé pour urgence', 'impossible'].includes(clinicalValue(data, 'PRIMAIRE', 'secondary'));
  const items = existing.filter((item) => {
    if (deferred && !['TYPE', 'X', 'A'].includes(item.page) && /non évalué|incomplet|non renseignée/.test(item.message)) return false;
    const pageFields = PAGE_FIELDS[item.page] || [];
    const meta = data.META?.assessments || {};
    const relevant = item.field ? item.field.replace(`${item.page}_`, '') : null;
    if (relevant && meta[`${item.page}.${relevant}`]?.status && meta[`${item.page}.${relevant}`].status !== 'valeur') return false;
    if (/^[ABCDE] (?:non évalué|incomplet)/.test(item.message)) return !pageFields.every((field) => hasValue(data[item.page]?.[field]) || ['non_applicable', 'impossible', 'non_mesurable', 'non_realise', 'absent'].includes(meta[`${item.page}.${field}`]?.status));
    return true;
  });
  const add = (page, message, field) => items.push({ page, message, field: field || null });
  for (const [page, keys] of [['CONTEXTE', ['event', 'security', 'victim_count']], ['PRIMAIRE', ['massive_bleed', 'airway', 'breathing', 'pulse', 'avpu']]]) {
    const missing = keys.filter((key) => !entryText(data[page]?.clinical?.[key]));
    if (missing.length) add(page, `${PAGE_TITLES[page]} : ${missing.map((key) => EXT_FIELDS[page].find((d) => d[0] === key)?.[1]).join(', ')} à renseigner ou qualifier`);
  }
  const gcs = data.D?.clinical || {};
  if (['gcs_y', 'gcs_v', 'gcs_m'].some((key) => gcs[key]?.value === 'NT') && !entryText(gcs.gcs_nt_reason)) add('D', 'Glasgow : préciser le motif des composantes non testables');
  if ((data.FAST?.face === 'positif' || data.FAST?.arm === 'positif' || data.FAST?.speech === 'positif') && !entryText(data.FAST?.clinical?.last_well) && !entryText(data.FAST?.clinical?.last_well_status)) add('FAST', 'AVC : dernière fois sans déficit (LKW) et source à préciser, ou marquer inconnue');
  const context = ageContext(data);
  if (context.issue) add('TYPE' , context.issue);
  if (context.category === 'enfant' && !Number.isFinite(context.years)) add('TYPE', 'Âge exact requis pour calculer le minimum de PAS pédiatrique');
  if (context.category === 'adulte' && !data.TYPE.pa_profile) add('TYPE', 'Discordance PA T1/T2 : profil du service à confirmer');
  if (data.D?.glycemie_unit_inferred) add('D', 'Unité glycémique héritée par inférence : confirmer explicitement l’unité');
  if (data.B?.target_confirmed === 'oui') { const min = numberValue(data.B.target_min), max = numberValue(data.B.target_max); if (!(min >= 0 && max <= 100 && min <= max) || !data.B.target_source) add('B', 'Cible O2 confirmée sans bornes valides ou sans source'); }
  const required = { grossesse: ['status'], travail: ['start', 'duration', 'interval', 'waters', 'urge'], irc: ['bpco', 'irc', 'source', 'usual_spo2', 'usual_condition'], convulsions: ['start', 'count', 'between'], co: ['source', 'duration', 'extracted_at'], allergie: ['start', 'allergen', 'progression'], pediatrie: ['usual', 'appearance', 'breathing', 'circulation'], geriatrie: ['autonomy', 'cognition'], trauma: ['event', 'impact'], glycemie: ['symptoms', 'treatment', 'meal', 'swallow'] };
  for (const id of data.BILANS?.selected || []) {
    const fields = required[id] || CLINICAL_MODULES[id]?.fields.slice(0, 2).map((d) => d[0]) || [];
    const missing = fields.filter((key) => { const e = data.BILANS.values[id]?.[key]; return !entryText(e); });
    if (missing.length) add('BILANS', `${CLINICAL_MODULES[id].title} : ${missing.map((key) => CLINICAL_MODULES[id].fields.find((d) => d[0] === key)?.[1]).join(', ')} à renseigner ou qualifier`);
  }
  if (data.BILANS?.selected?.includes('naissance') && !data.NAISSANCE?.babies?.length) add('BILANS', 'Naissance : ajouter le dossier du nouveau-né et son T0');
  (data.NAISSANCE?.babies || []).forEach((baby, i) => { if (!baby.birth_at?.value || !baby.mother_id?.value) add('BILANS', `Bébé ${i + 1} : T0 et lien mère à renseigner`); });
  Object.entries(data.META?.assessments || {}).forEach(([key, e]) => {
    if (['impossible', 'non_applicable', 'non_mesurable', 'non_fiable'].includes(e.status) && !e.reason) add(key.split('.')[0], `${key} : motif de ${e.status} manquant`);
    if (e.status === 'valeur' && !e.observedAt) add(key.split('.')[0], `${key} : date de mesure à confirmer`);
  });
  const pa = selectedPa(data);
  if (data.C?.pa_reference_side && !pa) add('C', 'PA de référence : les deux chiffres du même bras sont requis');
  for (const side of ['gauche', 'droite']) {
    const sys = numberValue(data.C?.[`pa_${side}_sys`]), dia = numberValue(data.C?.[`pa_${side}_dia`]);
    const ref = pressureReference(data);
    if (Number.isFinite(dia) && (dia < (ref.diaMin ?? -Infinity) || dia > (ref.diaMax ?? Infinity))) add('C', `PA diastolique ${side} hors seuil du profil confirmé`);
  }
  return items;
}
function latestConstants(data) {
  const measured = (page, field) => { const state = data.META?.assessments?.[`${page}.${field}`]?.status; return (!state || state === 'valeur') && hasValue(data[page]?.[field]); };
  const readings = (data.SURVEILLANCE?.releves || []).filter((r) => r.observedAt).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const latest = readings[readings.length - 1];
  const lastByField = [];
  for (const key of ['fr', 'fc', 'spo2', 'temperature', 'glycemie']) {
    const reading = [...readings].reverse().find((r) => hasValue(r[key]) || (r.results?.[key]?.status && r.results[key].status !== 'valeur'));
    if (!reading || reading === latest) continue;
    const partial = { ...reading, fr: '', fc: '', spo2: '', temperature: '', glycemie: '', pa_sys: '', pa_dia: '', conscience: '', eva: '', gcs_y: '', gcs_v: '', gcs_m: '', evolution: '', phase: '', results: { [key]: reading.results?.[key] }, [key]: reading[key] };
    lastByField.push(`Dernière mesure ${key}: ${formatSurveillanceReading(partial)}`);
  }
  const paReading = [...readings].reverse().find((r) => hasValue(r.pa_sys) || hasValue(r.pa_dia) || r.results?.pa_sys?.status || r.results?.pa_dia?.status);
  if (paReading && paReading !== latest) lastByField.push(`Dernière PA: ${new Date(paReading.observedAt).toLocaleString('fr-FR')} ${paReading.results?.pa_sys?.status && paReading.results.pa_sys.status !== 'valeur' ? paReading.results.pa_sys.status : paReading.pa_sys || '?'}/${paReading.results?.pa_dia?.status && paReading.results.pa_dia.status !== 'valeur' ? paReading.results.pa_dia.status : paReading.pa_dia || '?'} (même relevé)`);
  const pa = selectedPa(data);
  const base = [measured('B', 'fr') && `FR ${data.B.fr}/min`, measured('C', 'fc') && `FC ${data.C.fc}/min`, pa && `PA ${pa.sys}/${pa.dia} (${pa.side})`, measured('B', 'spo2_air') && `SpO2 air ${data.B.spo2_air}%`, measured('B', 'spo2_o2') && `SpO2 O2 ${data.B.spo2_o2}%`, measured('D', 'glycemie') && `Gly ${formatValue('glycemie', data.D.glycemie, data)}`, measured('E', 'temperature') && `T ${data.E.temperature}°C`].filter(Boolean);
  const statuses = Object.entries(data.META?.assessments || {}).filter(([key, e]) => (MEASUREMENT_FIELDS[key.split('.')[0]] || []).includes(key.split('.')[1]) && e.status && e.status !== 'valeur').map(([key, e]) => `${key}: ${e.status}${e.reason ? ` (${e.reason})` : ''}`);
  return [base.length && `Bilan initial (dates propres aux mesures): ${base.join(' | ')}`, ...statuses, ...lastByField, latest && `Dernier relevé daté ${new Date(latest.observedAt).toLocaleString('fr-FR')}: ${formatSurveillanceReading(latest)}`, data.B?.o2_active === 'oui' && `O2 en cours: ${data.B.o2_interface || '?'} ${data.B.o2_debit || 'débit non confirmé'} L/min, début ${data.B.o2_start_iso || data.B.o2_start_time || '?'} ; cible ${oxygenTarget(data).min ?? '?'}–${oxygenTarget(data).max ?? '?'}%`].filter(Boolean);
}
function prepareSms(data, patientNum, recordedAt = Date.now()) {
  const header = [`BILAN EQUIPIER ${patientNum} - ${new Date(recordedAt).toLocaleString('fr-FR')}`, `Victime: ${PATIENT_CATEGORIES[ageContext(data).category]?.label || 'âge à préciser'}${data.TYPE?.age_value ? `, ${data.TYPE.age_value} ${data.TYPE.age_unit}` : ''}`];
  const critical = [...buildRcpLines(data.RCP, true), ...latestConstants(data), ...criticalClinicalLines(data), ...computeAlertSummary(data).map((a) => `ALERTE ${a.label}: ${a.details.join(', ')}`)];
  const optional = [...getTransmissionHighlights(data), ...buildRecapLines(data)].filter((v, i, all) => v && all.indexOf(v) === i && !critical.includes(v));
  const lines = [...header, ...critical];
  const omitted = [];
  for (const line of optional) { if (lines.join('\n').length + line.length + 100 <= 1800) lines.push(line); else omitted.push(line); }
  if (omitted.length) lines.push(`[${omitted.length} ligne(s) complémentaire(s) omise(s) : voir PDF complet]`);
  return { text: lines.join('\n'), omitted, criticalLength: [...header, ...critical].join('\n').length };
}
function SmsPreview({ data, patientNum, recordedAt, onClose }) {
  const sms = prepareSms(data, patientNum, recordedAt);
  return <div role="dialog" aria-modal="true" aria-label="Aperçu SMS" className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"><div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 max-w-xl w-full max-h-[90vh] overflow-auto flex flex-col gap-3"><h3 className="font-bold">Aperçu de transmission SMS</h3><textarea aria-label="Texte SMS" readOnly value={sms.text} rows={12} className="bg-neutral-950 p-3 text-xs w-full" />{sms.criticalLength > 1800 && <p className="text-xs text-amber-300">Les informations prioritaires dépassent 1 800 caractères : elles sont conservées. Plusieurs segments SMS pourront être nécessaires.</p>}{!!sms.omitted.length && <details><summary className="text-xs text-amber-300">{sms.omitted.length} compléments omis du SMS</summary>{sms.omitted.map((line, i) => <p key={i} className="text-xs">{line}</p>)}</details>}<button type="button" onClick={() => { sendBilanBySms(data, patientNum, recordedAt); onClose(); }} className="bg-red-700 p-3 rounded font-semibold">Ouvrir la messagerie avec ce texte</button><button onClick={onClose} className="border border-neutral-600 p-2 rounded">Fermer</button></div></div>;
}
function referenceRange(data, field, context = {}) {
  if (field === 'spo2') { const t = oxygenTarget(data, context.mode || 'air'); return t.min === null ? null : [t.min, t.max]; }
  if (field === 'pa_sys') { const p = pressureReference(data); return p.min === null ? null : [p.min, p.max ?? Infinity]; }
  if (field === 'temperature') return [35, 37.5];
  if (field === 'glycemie') {
    if (ageContext(data).category === 'nouveau_ne' || data.TYPE?.birth_context === 'naissance') return null;
    return clinicalValue(data, 'D', 'gly_context') === 'à jeun' ? [0.8, 1.1] : null; // référence à jeun, pas un diagnostic isolé
  }
  return PATIENT_CATEGORIES[ageContext(data).category]?.ranges[field] || null;
}
function selectedPa(data) {
  const c = data.C || {};
  const side = c.pa_reference_side || (hasValue(c.pa_gauche_sys) && hasValue(c.pa_gauche_dia) ? 'gauche' : hasValue(c.pa_droite_sys) && hasValue(c.pa_droite_dia) ? 'droite' : null);
  if (!side) return null;
  const sys = c[`pa_${side}_sys`], dia = c[`pa_${side}_dia`];
  if ([`C.pa_${side}_sys`, `C.pa_${side}_dia`].some((key) => data.META?.assessments?.[key]?.status && data.META.assessments[key].status !== 'valeur')) return null;
  return hasValue(sys) && hasValue(dia) ? { side, sys, dia } : null;
}
function gcsTotal(values) {
  const y = numberValue(values?.gcs_y), v = numberValue(values?.gcs_v), m = numberValue(values?.gcs_m);
  return Number.isInteger(y) && y >= 1 && y <= 4 && Number.isInteger(v) && v >= 1 && v <= 5 && Number.isInteger(m) && m >= 1 && m <= 6 ? y + v + m : null;
}
function birthElapsed(baby, now = Date.now()) {
  const start = Date.parse(baby?.birth_at?.eventAt || baby?.birth_at?.value || '');
  return Number.isFinite(start) && now >= start ? Math.floor((now - start) / 1000) : null;
}
function fractionalBurnArea(burn, pediatric) {
  if (pediatric || burn?.brulure_degre === '1' || burn?.surface_method !== 'wallace') return null;
  if (!(burn.brulure_zones || []).length) return null;
  let sum = 0;
  for (const id of burn.brulure_zones) {
    const fraction = numberValue(burn.zone_fractions?.[id]);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
    sum += (BRULURE_ZONES_9.find((zone) => zone.value === id)?.pct || 0) * fraction;
  }
  return Math.round(sum * 100) / 100;
}
function clinicalInitialForm() {
  return { META: { schema: RULESET.schema, ruleset: RULESET.id, referenceAt: null, assessments: {}, migration: [] },
    CONTEXTE: {}, PRIMAIRE: {}, BILANS: { selected: [], values: {}, status: {} },
    LESIONS: { items: [], hemorrhages: [] }, POSITION: {},
    NAISSANCE: { babies: [] }, VENTILATION: { episodes: [], aspirations: [] }, RCP_CONTEXT: {} };
}
function normalizeClinicalData(normalized, raw) {
  normalized.META.assessments = raw.META?.assessments && typeof raw.META.assessments === 'object' ? raw.META.assessments : {};
  normalized.META.migration = Array.isArray(raw.META?.migration) ? raw.META.migration : [];
  normalized.BILANS.selected = Array.isArray(raw.BILANS?.selected) ? raw.BILANS.selected.filter((id) => CLINICAL_MODULES[id]) : [];
  normalized.BILANS.values = raw.BILANS?.values && typeof raw.BILANS.values === 'object' ? raw.BILANS.values : {};
  for (const [page, key] of [['LESIONS', 'items'], ['LESIONS', 'hemorrhages'], ['NAISSANCE', 'babies'], ['VENTILATION', 'episodes'], ['VENTILATION', 'aspirations']]) {
    normalized[page][key] = Array.isArray(raw[page]?.[key]) ? raw[page][key] : [];
  }
  if (!raw.META?.schema && raw.TYPE?.categorie === 'nouveau_ne') normalized.TYPE.legacy_age_uncertain = true;
  if (!raw.META?.schema && raw.TYPE?.categorie === 'age') { normalized.TYPE.categorie = 'adulte'; normalized.TYPE.geriatric = 'oui'; }
  if (!raw.META?.schema && raw.B?.o2_debit_auto) { normalized.B.o2_proposal = raw.B.o2_debit; normalized.B.o2_debit = ''; normalized.B.o2_debit_auto = false; }
  if (!raw.META?.schema && raw.B?.o2_pressure === '200') {
    normalized.B.o2_pressure = ''; normalized.B.o2_previous_pressure = '200';
    if (!normalized.META.migration.includes('Pression 200 bars héritée : vérifier la bouteille')) normalized.META.migration.push('Pression 200 bars héritée : vérifier la bouteille');
  }
  normalized.A.airway_free = raw.A?.airway_free ?? raw.A?.obstruction ?? '';
  if (raw.D?.glycemie && !raw.D.glycemie_unit) normalized.D.glycemie_unit_inferred = true;
  normalized.SURVEILLANCE.releves = normalized.SURVEILLANCE.releves.map((r) => ({ ...r, legacy_time_unknown: !r.observedAt, date_local: r.date_local || '' }));
  normalized.LESIONS.hemorrhages = legacyTourniquets(normalized);
  normalized.META.schema = RULESET.schema;
  return normalized;
}

// Chaque donnée nouvelle distingue valeur, état de recherche, source et horodatage.
function ClinicalField({ descriptor, entry = {}, onChange }) {
  const [key, label, type = 'text', help] = descriptor;
  const item = entry && typeof entry === 'object' ? entry : { value: entry };
  const choices = Array.isArray(type) ? type : type === 'yn' ? EXT_YN : null;
  const update = (patch) => onChange({ ...item, ...patch, recordedAt: new Date().toISOString() });
  const numeric = type === 'number';
  return <div className="border border-neutral-800 rounded-lg p-3 flex flex-col gap-2" id={`clinical_${key}`}>
    <label className="text-sm font-semibold" htmlFor={`clinical_input_${key}`}>{label}</label>
    {help && <p className="text-xs text-neutral-400">{help}</p>}
    {!['inconnu', 'non_evalue', 'non_applicable', 'impossible'].includes(item.status) && (choices
      ? <select aria-label={label} value={item.value || ''} onChange={(e) => update({ value: e.target.value, status: 'valeur' })} className="bg-neutral-950 border border-neutral-700 rounded p-2 w-full">
          <option value="">Choisir…</option>{choices.map((choice) => <option key={choice} value={choice}>{EXT_LABELS[choice] || choice}</option>)}
        </select>
      : type === 'textarea' ? <textarea id={`clinical_input_${key}`} value={item.value || ''} onChange={(e) => update({ value: e.target.value, status: 'valeur' })} rows={2} className="bg-neutral-950 border border-neutral-700 rounded p-2 w-full" />
      : <input id={`clinical_input_${key}`} type={type === 'datetime' ? 'datetime-local' : type === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={item.value ?? ''} onChange={(e) => update({ value: e.target.value, status: 'valeur', ...(type === 'datetime' ? { eventAt: dateTimeISO(e.target.value), timezoneOffset: new Date(e.target.value).getTimezoneOffset() } : {}) })} className="bg-neutral-950 border border-neutral-700 rounded p-2 w-full" />)}
    <details><summary className="text-xs text-neutral-400 cursor-pointer">État de recherche, source et heure</summary>
      <select aria-label={`État — ${label}`} value={item.status || ''} onChange={(e) => update({ status: e.target.value })} className="bg-neutral-950 p-2 w-full"><option value="">Non renseigné</option>{ASSESSMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      {['impossible', 'non_applicable'].includes(item.status) && <input aria-label={`Motif — ${label}`} placeholder="Motif" value={item.reason || ''} onChange={(e) => update({ reason: e.target.value })} className="bg-neutral-950 p-2 w-full" />}
      <input aria-label={`Source — ${label}`} placeholder="Source : victime, proche, observation, document…" value={item.source || ''} onChange={(e) => update({ source: e.target.value })} className="bg-neutral-950 p-2 w-full" />
      <input aria-label={`Date et heure — ${label}`} type="datetime-local" value={item.observed_local || ''} onChange={(e) => update({ observed_local: e.target.value, observedAt: dateTimeISO(e.target.value) })} className="bg-neutral-950 p-2 w-full" />
      <button type="button" onClick={() => update({ observed_local: toLocalDateTime(), observedAt: new Date().toISOString() })} className="text-xs border border-neutral-700 p-2 rounded">Observé maintenant</button>
      {item.recordedAt && <p className="text-xs text-neutral-500">Saisie : {new Date(item.recordedAt).toLocaleString('fr-FR')}</p>}
    </details>
  </div>;
}
function ClinicalFields({ fields, values = {}, onChange, scope = 'field' }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{fields.map((d) => <ClinicalField key={d[0]} descriptor={[`${scope}_${d[0]}`, ...d.slice(1)]} entry={values[d[0]]} onChange={(v) => onChange(d[0], v)} />)}</div>;
}

const MODULE_SUGGESTIONS = (data) => {
  const p = data.SAMPLER?.sampler_p_choices || [], s = data.SAMPLER?.symptom_choices || [];
  const ids = [];
  if (isPediatric(data)) ids.push('pediatrie');
  if (data.TYPE?.geriatric === 'oui' || ageContext(data).years >= 65) ids.push('geriatrie');
  if (p.includes('grossesse') || p.includes('post_partum')) ids.push('grossesse');
  if (p.includes('bpco')) ids.push('irc');
  if (p.includes('asthme')) ids.push('asthme');
  if (p.includes('diabete')) ids.push('glycemie');
  if (s.includes('douleur_thoracique')) ids.push('thorax');
  if (s.includes('convulsions') || data.D?.neuro_signes?.includes('convulsions')) ids.push('convulsions');
  if (data.A?.trauma === 'oui') ids.push('trauma');
  return [...new Set(ids)].filter((id) => !data.BILANS?.selected?.includes(id));
};
function moduleValue(data, id, key) { const entry = data.BILANS?.values?.[id]?.[key]; return entry?.status && entry.status !== 'valeur' ? entry.status : entry?.value; }
function clinicalValue(data, page, key) { const entry = data[page]?.clinical?.[key]; return entry?.status && entry.status !== 'valeur' ? entry.status : entry?.value; }
const MEASUREMENT_FIELDS = {
  B: ['fr', 'spo2_air', 'spo2_o2'], C: ['fc', 'pa_gauche_sys', 'pa_gauche_dia', 'pa_droite_sys', 'pa_droite_dia'],
  D: ['glycemie'], E: ['temperature'],
};
function MeasurementRecords({ data, page, onChange }) {
  const fields = MEASUREMENT_FIELDS[page] || [];
  if (!fields.length) return null;
  return <Accordion title="Résultats et dates des mesures" defaultOpen={false}>
    <p className="text-xs text-neutral-400 mb-2">Les états remplacent l’interprétation d’une valeur, jamais un résultat inventé. Date d’observation distincte de l’heure de saisie.</p>
    {fields.map((field) => {
      const key = `${page}.${field}`, meta = data.META?.assessments?.[key] || {};
      const options = RESULT_OPTIONS.filter((o) => field === 'glycemie' || !['LO', 'HI'].includes(o.value)).filter((o) => ['fc', 'fr'].includes(field) || o.value !== 'absent');
      return <div key={field} className="border-t border-neutral-800 py-2 flex flex-col gap-2">
        <strong className="text-sm">{FIELD_LABELS[field] || field}</strong>
        <select aria-label={`Résultat — ${FIELD_LABELS[field] || field}`} value={meta.status || ''} onChange={(e) => onChange(key, { ...meta, status: e.target.value })} className="bg-neutral-950 rounded p-2"><option value="">{hasValue(data[page]?.[field]) ? 'Valeur héritée / état à confirmer' : 'Non renseigné'}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {meta.status && meta.status !== 'valeur' && <input aria-label={`Motif résultat — ${field}`} placeholder="Motif / contexte" value={meta.reason || ''} onChange={(e) => onChange(key, { ...meta, reason: e.target.value })} className="bg-neutral-950 p-2" />}
        <input aria-label={`Mesuré le — ${field}`} type="datetime-local" value={meta.observed_local || ''} onChange={(e) => onChange(key, { ...meta, observed_local: e.target.value, observedAt: dateTimeISO(e.target.value) })} className="bg-neutral-950 p-2" />
        <button type="button" onClick={() => onChange(key, { ...meta, observed_local: toLocalDateTime(), observedAt: new Date().toISOString() })} className="text-xs border border-neutral-700 p-2 rounded">Mesuré maintenant</button>
        {meta.recordedAt && <span className="text-xs text-neutral-500">Saisie : {new Date(meta.recordedAt).toLocaleString('fr-FR')}</span>}
      </div>;
    })}
  </Accordion>;
}
function ClinicalExtension({ data, page, update, patientNum }) {
  const clinical = data[page]?.clinical || {};
  const setClinical = (key, value) => update(page, 'clinical', (current = {}) => ({ ...current, [key]: value }));
  const setMeta = (key, value) => update('META', 'assessments', (current = {}) => ({ ...current, [key]: value }));
  const context = ageContext(data);
  const selected = data.BILANS.selected || [];
  const selectModule = (id) => update('BILANS', 'selected', selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  const moduleUpdate = (id, key, value) => update('BILANS', 'values', (current = {}) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  return <div className="flex flex-col gap-3">
    {page === 'TYPE' && <>
      <FieldCard label="Âge chronologique et contexte" filled={Number.isFinite(context.days)}>
        <div className="flex gap-2"><input aria-label="Âge exact" inputMode="decimal" value={data.TYPE.age_value || ''} onChange={(e) => { update('TYPE', 'age_value', e.target.value); update('TYPE', 'birth_date', ''); }} className="bg-neutral-950 p-2 w-24" /><select aria-label="Unité de l'âge" value={data.TYPE.age_unit || 'ans'} onChange={(e) => update('TYPE', 'age_unit', e.target.value)} className="bg-neutral-950 p-2">{['jours', 'mois', 'ans'].map((v) => <option key={v}>{v}</option>)}</select></div>
        <label className="text-xs text-neutral-400">Ou date de naissance</label><input aria-label="Date de naissance" type="date" value={data.TYPE.birth_date || ''} onChange={(e) => update('TYPE', 'birth_date', e.target.value)} className="bg-neutral-950 p-2" />
        <label className="text-xs text-neutral-400">Poids connu (kg)</label><input aria-label="Poids connu" inputMode="decimal" value={data.TYPE.weight || ''} onChange={(e) => update('TYPE', 'weight', e.target.value)} className="bg-neutral-950 p-2" />
        <label className="text-xs text-neutral-400">Puberté connue / rapportée ; en cas de doute, référence enfant. Aucun examen intime.</label><ToggleGroup options={[{ value: 'oui', label: 'Oui, connue' }, { value: 'non', label: 'Non' }, { value: 'doute', label: 'Doute' }]} value={data.TYPE.puberty || ''} onChange={(v) => update('TYPE', 'puberty', v)} />
        <ToggleGroup options={[{ value: 'oui', label: 'Contexte gériatrique' }]} value={data.TYPE.geriatric || ''} onChange={(v) => update('TYPE', 'geriatric', v)} />
        <p className="text-xs" style={{ color: context.issue ? AMBER : EMERALD }}>{context.issue || `Référence appliquée : ${PATIENT_CATEGORIES[context.category]?.label || 'population à préciser'}`}</p>
        <p className="text-xs text-neutral-400">0–28 jours inclus : nouveau-né ; ensuite nourrisson avant 2 ans ; à partir de 2 ans : enfant jusqu’à la puberté. La borne de 2 ans et les seuils locaux sont explicités pour validation du service.</p>
      </FieldCard>
      {context.category === 'adulte' && <FieldCard label="PA adulte : discordance entre les tomes" filled={!!data.TYPE.pa_profile}>
        <p className="text-xs text-amber-300">{RULESET.references.pa}. Aucune plage unique activée sans confirmation du profil local.</p>
        <select aria-label="Profil PA confirmé" value={data.TYPE.pa_profile || ''} onChange={(e) => update('TYPE', 'pa_profile', e.target.value)} className="bg-neutral-950 p-2"><option value="">À valider avec le service</option><option value="T1">Profil T1 confirmé : PAS 100–160</option><option value="T2">Profil T2 S.02 confirmé : 90–140 / 60–90</option></select>
      </FieldCard>}
      <ToggleGroup options={[{ value: 'naissance', label: 'Ce dossier est le nouveau-né à la naissance' }]} value={data.TYPE.birth_context || ''} onChange={(v) => update('TYPE', 'birth_context', v)} />
      <ReferenceNotice data={data} />
    </>}
    {page === 'PRIMAIRE' && <p className="text-sm text-amber-300">Appréciation rapide XABCDE et gestes urgents avant le bilan secondaire. Les mesures détaillées et l’anamnèse peuvent être différées ; aucune complétude ne bloque l’accès à la RCP ou à la transmission.</p>}
    {EXT_FIELDS[page] && <Accordion title={['CONTEXTE', 'PRIMAIRE', 'POSITION', 'RCP_CONTEXT'].includes(page) ? PAGE_TITLES[page] || 'Contexte de l’arrêt' : 'Compléments du bilan'} defaultOpen={['CONTEXTE', 'PRIMAIRE', 'POSITION', 'RCP_CONTEXT'].includes(page)}><ClinicalFields scope={page} fields={EXT_FIELDS[page]} values={clinical} onChange={setClinical} /></Accordion>}
    {page === 'C' && <FieldCard label="PA de référence : paire du même bras" filled={!!selectedPa(data)}><ToggleGroup options={[{ value: 'gauche', label: 'Gauche' }, { value: 'droite', label: 'Droite' }]} value={data.C.pa_reference_side || ''} onChange={(v) => update('C', 'pa_reference_side', v)} /><p className="text-xs text-neutral-400">Systolique et diastolique du même bras ; les deux bras restent présents dans le PDF.</p></FieldCard>}
    {page === 'D' && data.D.glycemie_unit_inferred && <button type="button" onClick={() => update('D', 'glycemie_unit', data.D.glycemie_unit)} className="border border-amber-600 rounded p-2 text-xs">Confirmer l’unité héritée : {data.D.glycemie_unit}</button>}
    {page === 'D' && <>
      <p className="text-xs text-neutral-300">Glasgow : {gcsTotal(Object.fromEntries(Object.entries(clinical).map(([k, v]) => [k, v.status === 'valeur' ? v.value : 'NT']))) ?? 'total non calculable (composante manquante ou NT)'} — Y/V/M conservés séparément. {context.years < 5 ? 'Utiliser les réponses pédiatriques adaptées à moins de 5 ans.' : ''}</p>
      <p className="text-xs text-neutral-400">Y : 4 spontané, 3 à la voix, 2 à la douleur, 1 aucune. M : 6 ordre, 5 localise, 4 retrait, 3 flexion anormale, 2 extension, 1 aucune. V adulte : 5 orientée, 4 confuse, 3 mots, 2 sons, 1 aucune ; moins de 5 ans (T1 20.4) : V5 babille/sourit/interaction normale, V4 pleurs consolables/irritable, V3 pleurs inconsolables/cris incessants, V2 gémissements, V1 aucune. M6 inclut mouvements spontanés normaux avant 1 an ; composante NT si non testable.</p>
    </>}
    {page === 'E' && context.days < 90 && <p className="text-xs text-amber-300">Moins de 3 mois : méthode auriculaire à vérifier dans la fiche locale. Conserver la température brute ; aucun ajout automatique de 0,5 ou 1 °C.</p>}
    {page === 'B' && <FieldCard label="Cible O2 et débit effectivement réglé" filled={data.B.target_confirmed === 'oui'}>
      <p className="text-xs text-neutral-300">{oxygenTarget(data).source} : {oxygenTarget(data).min === null ? 'pas de cible générale' : `${oxygenTarget(data).min}–${oxygenTarget(data).max} %`}</p>
      <div className="flex gap-2"><input aria-label="Cible SpO2 minimale" placeholder="Cible min %" inputMode="decimal" value={data.B.target_min || ''} onChange={(e) => update('B', 'target_min', e.target.value)} className="bg-neutral-950 p-2 w-28" /><input aria-label="Cible SpO2 maximale" placeholder="Cible max %" inputMode="decimal" value={data.B.target_max || ''} onChange={(e) => update('B', 'target_max', e.target.value)} className="bg-neutral-950 p-2 w-28" /></div>
      <input aria-label="Source cible O2" placeholder="Prescription / consigne : source et heure" value={data.B.target_source || ''} onChange={(e) => update('B', 'target_source', e.target.value)} className="bg-neutral-950 p-2" />
      <label className="text-xs">Début O2 : date et heure confirmées</label><input aria-label="Date complète début O2" type="datetime-local" value={data.B.o2_start_local || (data.B.o2_started_at_ms ? toLocalDateTime(new Date(data.B.o2_started_at_ms)) : '')} onChange={(e) => { update('B', 'o2_start_local', e.target.value); update('B', 'o2_start_iso', dateTimeISO(e.target.value)); if (dateTimeISO(e.target.value)) update('B', 'o2_started_at_ms', Date.parse(dateTimeISO(e.target.value))); }} className="bg-neutral-950 p-2" />
      <ToggleGroup options={[{ value: 'oui', label: 'Cible confirmée' }]} value={data.B.target_confirmed || ''} onChange={(v) => update('B', 'target_confirmed', v)} />
      {data.B.o2_proposal && !data.B.o2_debit && <button type="button" onClick={() => { update('B', 'o2_debit', data.B.o2_proposal); update('B', 'o2_proposal', ''); }} className="text-sm border border-amber-600 rounded p-2">Confirmer le réglage réel : {data.B.o2_proposal} L/min proposé</button>}
      {data.B.o2_previous_pressure && <p className="text-xs text-amber-300">Ancienne pression préremplie : {data.B.o2_previous_pressure} bars. Mesurer et saisir la pression actuelle.</p>}
    </FieldCard>}
    <MeasurementRecords data={data} page={page} onChange={setMeta} />
    {page === 'FAST' && <p className="text-xs text-amber-300">FAST négatif n’exclut pas un AVC. Le LKW et la découverte sont distincts ; aucun filtre automatique à 6 heures.</p>}
    {page === 'BRULURE' && data.BRULURE.brulure === 'oui' && <BurnSurfaceFields data={data} update={update} />}
    {page === 'BILANS' && <>
      <p className="text-sm text-neutral-300">Ouvrir les bilans pertinents. Un module suggéré demande une confirmation ; aucun antécédent ne devient un diagnostic.</p>
      {!!MODULE_SUGGESTIONS(data).length && <div className="border border-amber-700 rounded p-3"><p className="text-xs text-amber-300">Bilans suggérés</p>{MODULE_SUGGESTIONS(data).map((id) => <button key={id} onClick={() => selectModule(id)} className="border border-neutral-700 rounded p-2 m-1 text-xs">Ouvrir : {CLINICAL_MODULES[id].title}</button>)}</div>}
      <div className="flex flex-wrap gap-2">{Object.entries(CLINICAL_MODULES).map(([id, m]) => <button key={id} type="button" onClick={() => selectModule(id)} className="text-xs border rounded p-2" style={{ borderColor: selected.includes(id) ? ACCENT : '#404040', background: selected.includes(id) ? ACCENT : 'transparent' }}>{selected.includes(id) ? '✓ ' : ''}{m.title}</button>)}</div>
      {selected.map((id) => { const module = CLINICAL_MODULES[id]; if (!module) return null; return <Accordion key={id} title={module.title} defaultOpen>
        <p className="text-xs text-neutral-500 mb-2">{module.source}</p>{module.note && <p className="text-xs text-amber-300 mb-3">{module.note}</p>}
        <ClinicalFields scope={id} fields={module.fields} values={data.BILANS.values[id]} onChange={(key, value) => moduleUpdate(id, key, value)} />
        {id === 'travail' && <ObservationStopwatch label="Durée d’une contraction observée" onStop={(start, end) => { moduleUpdate(id, 'duration', { value: String(Math.round((end - start) / 1000)), status: 'valeur', observedAt: new Date(end).toISOString(), source: 'chronométrage observé', recordedAt: new Date().toISOString() }); moduleUpdate(id, 'progression', { value: `Contraction chronométrée du ${new Date(start).toLocaleString('fr-FR')} au ${new Date(end).toLocaleString('fr-FR')}`, status: 'valeur', source: 'chronométrage observé', recordedAt: new Date().toISOString() }); }} />}
        {id === 'convulsions' && <ObservationStopwatch label="Crise observée en cours" onStop={(start, end) => { moduleUpdate(id, 'start', { value: toLocalDateTime(new Date(start)), status: 'valeur', source: 'début du chronométrage, début réel à confirmer', recordedAt: new Date().toISOString() }); moduleUpdate(id, 'end', { value: toLocalDateTime(new Date(end)), status: 'valeur', source: 'arrêt du chronométrage, fin réelle à confirmer', recordedAt: new Date().toISOString() }); moduleUpdate(id, 'duration', { value: `${Math.round((end - start) / 1000)} s observées`, status: 'valeur', source: 'chronométrage observé', recordedAt: new Date().toISOString() }); }} />}
        {id === 'naissance' && <><p className="text-xs text-neutral-400 my-2">Identifiant mère proposé : bilan-{patientNum}. Confirmer le lien dans chaque bébé.</p><ClinicalRepeat title="Nouveau-né" prefix="baby" fields={REPEAT_FIELDS.baby} items={data.NAISSANCE.babies} onChange={(v) => update('NAISSANCE', 'babies', v)} /><BirthClocks babies={data.NAISSANCE.babies} /></>}
      </Accordion>; })}
    </>}
    {page === 'LESIONS' && <>
      <ClinicalRepeat title="Lésion" prefix="lesion" fields={REPEAT_FIELDS.lesion} items={data.LESIONS.items} onChange={(v) => update('LESIONS', 'items', v)} />
      <ClinicalRepeat title="Hémorragie / garrot" prefix="bleed" fields={REPEAT_FIELDS.hemorrhage} items={data.LESIONS.hemorrhages} onChange={(v) => update('LESIONS', 'hemorrhages', v)} />
      <p className="text-xs text-neutral-400">Un enregistrement par garrot ; distinguer sa provenance et sa date de pose. Les anciens champs X / amputation restent disponibles dans le bilan historique.</p>
    </>}
    {page === 'B' && <>
      <ClinicalRepeat title="Ventilation" prefix="vent" fields={REPEAT_FIELDS.ventilation} items={data.VENTILATION.episodes} onChange={(v) => update('VENTILATION', 'episodes', v)} />
      <ClinicalRepeat title="Aspiration" prefix="asp" fields={REPEAT_FIELDS.aspiration} items={data.VENTILATION.aspirations} onChange={(v) => update('VENTILATION', 'aspirations', v)} />
    </>}
    {['X', 'A', 'B', 'C', 'D', 'E', 'BRULURE', 'FAST', 'SAMPLER'].includes(page) && <AssessmentPanel data={data} page={page} update={update} />}
    {page === 'RECAP' && <ReferenceNotice data={data} />}
  </div>;
}
function ObservationStopwatch({ label, onStop }) {
  const [start, setStart] = useState(null), [end, setEnd] = useState(null), [now, setNow] = useState(Date.now());
  useEffect(() => { if (!start || end) return; const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, [start, end]);
  return <div className="border border-neutral-700 p-3 my-2 rounded"><strong>{label} : {start ? formatDuration((end || now) - start) : 'non démarré'}</strong><div className="flex gap-2 mt-2"><button onClick={() => { const at = Date.now(); setStart(at); setNow(at); setEnd(null); }} className="border p-2 rounded">Démarrer</button><button disabled={!start || !!end} onClick={() => { const at = Date.now(); setEnd(at); if (onStop) onStop(start, at); }} className="border p-2 rounded">Arrêter et reporter</button></div><p className="text-xs text-neutral-400">Le temps observé est reporté dans le bilan ; confirmer les heures réelles si le début précède le chronométrage.</p></div>;
}
function BirthClocks({ babies }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return babies.map((baby, index) => <p key={baby.id} className="text-xs text-amber-300 mt-2">Bébé {index + 1} — depuis T0 : {birthElapsed(baby, now) === null ? 'T0 à renseigner' : formatDuration(birthElapsed(baby, now) * 1000)}. SpO2 à interpréter selon l’âge depuis la naissance et la consigne.</p>);
}
function ReferenceNotice({ data }) {
  const ranges = ['fr', 'fc', 'spo2', 'glycemie', 'temperature'].map((field) => { const range = referenceRange(data, field); return range ? `${FIELD_LABELS[field] || field} : ${range[0]}–${range[1]} ${UNITS[field] || ''}` : `${FIELD_LABELS[field] || field} : contexte / consigne spécifique`; });
  return <details className="border border-neutral-800 p-3 rounded"><summary className="text-sm">Références utilisées et limites</summary><p className="text-xs text-neutral-400">{RULESET.id} — {RULESET.sources.join(' ; ')}</p><p className="text-xs">{ranges.join(' · ')}</p><p className="text-xs">{pressureReference(data).source}</p><p className="text-xs">Glycémie : référence à jeun ; nouveau-né et adaptation à la naissance : consigne spécifique. Température : valeur brute, hypothermie &lt;35 °C, hyperthermie &gt;37,5 °C distinctes de la méthode de mesure.</p><p className="text-xs">Les éditions fournies doivent être validées par le service avant utilisation opérationnelle. Les discordances PA, borne de 2 ans, IRC et réanimation à la naissance sont affichées.</p></details>;
}
function AssessmentPanel({ data, page, update }) {
  const fields = PAGE_FIELDS[page] || [];
  const assessment = data.META.assessments || {};
  return <Accordion title="État des éléments du bilan" defaultOpen={false}>
    {fields.filter((f) => !(MEASUREMENT_FIELDS[page] || []).includes(f)).map((field) => {
      const key = `${page}.${field}`, entry = assessment[key] || {};
      return <div key={field} className="flex flex-col gap-1 my-2"><label className="text-xs">{FIELD_LABELS[field] || field}</label><select aria-label={`Évaluation — ${field}`} value={entry.status || ''} onChange={(e) => update('META', 'assessments', { ...assessment, [key]: { ...entry, status: e.target.value, recordedAt: new Date().toISOString() } })} className="bg-neutral-950 p-2"><option value="">Non renseigné</option>{ASSESSMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{['impossible', 'non_applicable'].includes(entry.status) && <input placeholder="Motif" aria-label={`Motif — ${field}`} value={entry.reason || ''} onChange={(e) => update('META', 'assessments', { ...assessment, [key]: { ...entry, reason: e.target.value } })} className="bg-neutral-950 p-2" />}
        <input aria-label={`Source observation — ${field}`} placeholder="Source de l’observation" value={entry.source || ''} onChange={(e) => update('META', 'assessments', (current = {}) => ({ ...current, [key]: { ...entry, source: e.target.value } }))} className="bg-neutral-950 p-2" />
        <input aria-label={`Date observation — ${field}`} type="datetime-local" value={entry.observed_local || ''} onChange={(e) => update('META', 'assessments', (current = {}) => ({ ...current, [key]: { ...entry, observed_local: e.target.value, observedAt: dateTimeISO(e.target.value) } }))} className="bg-neutral-950 p-2" />
      </div>;
    })}
  </Accordion>;
}
function BurnSurfaceFields({ data, update }) {
  const b = data.BRULURE;
  const computed = fractionalBurnArea(b, isPediatric(data));
  return <FieldCard label="Surface brûlée : méthode et fractions réellement atteintes" filled={hasValue(b.brulure_etendue)}>
    <select aria-label="Méthode de surface brûlée" value={b.surface_method || ''} onChange={(e) => update('BRULURE', 'surface_method', e.target.value)} className="bg-neutral-950 p-2"><option value="">Choisir la méthode</option>{!isPediatric(data) && <option value="wallace">Wallace adulte, zones partielles</option>}<option value="paume">Paume de la victime (doigts compris) ≈ 1 %</option><option value="lund">Lund-Browder : résultat d’une table validée</option><option value="rapportee">Estimation rapportée / méthode à préciser</option></select>
    {b.surface_method === 'wallace' && !isPediatric(data) && (b.brulure_zones || []).map((id) => <label key={id} className="text-xs">{BRULURE_ZONES_9.find((z) => z.value === id)?.label} : fraction atteinte (0–1)<input aria-label={`Fraction — ${id}`} value={b.zone_fractions?.[id] ?? ''} inputMode="decimal" onChange={(e) => update('BRULURE', 'zone_fractions', { ...b.zone_fractions, [id]: e.target.value })} className="bg-neutral-950 p-2 ml-2 w-20" /></label>)}
    {computed !== null && <button onClick={() => update('BRULURE', 'brulure_etendue', String(computed))} className="border border-neutral-600 p-2 rounded">Reporter le calcul confirmé : {computed} % SC</button>}
    <p className="text-xs text-amber-300">Ne pas inclure le 1er degré dans la surface cutanée brûlée de référence. Aucun pourcentage de zone entière déduit d’un simple clic.</p>
    <p className="text-xs text-neutral-400">Refroidissement thermique (T2 T1 13.2 / M.32) : début dans les 30 minutes, durée documentée 10–20 minutes ; seuils de surface adulte 20 % / enfant 10 % et égalité à confirmer localement. Surveiller froid et circulation. Un hydrogel n’est pas un rinçage chimique ; FDS et consigne pour les produits chimiques.</p>
  </FieldCard>;
}
function ClinicalRepeat({ title, fields, items = [], onChange, prefix }) {
  return <Accordion title={title} count={items.length} defaultOpen={items.length > 0}>
    <div className="flex flex-col gap-3">{items.map((item, index) => <div key={item.id} className="border border-neutral-700 p-3 rounded">
      <div className="flex justify-between gap-2"><strong>{title} {index + 1}</strong><button type="button" onClick={() => onChange(items.filter((v) => v.id !== item.id))} className="text-xs text-red-400">Supprimer</button></div>
      <ClinicalFields fields={fields.map((d) => [`${prefix}_${item.id}_${d[0]}`, ...d.slice(1)])} values={Object.fromEntries(fields.map((d) => [`${prefix}_${item.id}_${d[0]}`, item[d[0]]]))} onChange={(key, value) => onChange(items.map((v) => v.id === item.id ? { ...v, [key.slice(`${prefix}_${item.id}_`.length)]: value } : v))} />
      {prefix === 'baby' && <ClinicalRepeat title="Relevé du bébé" prefix={`babyreading_${item.id}`} fields={REPEAT_FIELDS.baby_reading} items={item.readings || []} onChange={(readings) => onChange(items.map((v) => v.id === item.id ? { ...v, readings } : v))} />}
    </div>)}<button type="button" onClick={() => onChange([...items, { id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }])} className="border border-neutral-600 rounded p-3 font-semibold">Ajouter : {title}</button></div>
  </Accordion>;
}

const EXT_FIELDS = {
  "CONTEXTE": [
    [
      "event",
      "Nature de l'événement",
      "text"
    ],
    [
      "location",
      "Lieu et accès",
      "text"
    ],
    [
      "event_at",
      "Date et heure de l'événement",
      "datetime"
    ],
    [
      "source",
      "Source des informations",
      "text"
    ],
    [
      "hazards",
      "Dangers persistants / évolutifs",
      "textarea"
    ],
    [
      "security",
      "Sécurité assurée",
      "yn"
    ],
    [
      "victim_count",
      "Nombre de victimes",
      "number"
    ],
    [
      "resources",
      "Moyens présents / nécessaires",
      "textarea"
    ],
    [
      "reinforcement",
      "Renfort demandé : motif, moyens, heure",
      "textarea"
    ],
    [
      "ca",
      "Bilan circonstanciel partagé et confirmé avec le chef d'agrès",
      "yn"
    ],
    [
      "found_position",
      "Position à la découverte",
      "text"
    ],
    [
      "contact_at",
      "Date et heure du premier contact",
      "datetime"
    ],
    [
      "complaint",
      "Plainte principale / mots de la victime",
      "textarea"
    ],
    [
      "impression",
      "Impression globale et signes d'emblée inquiétants",
      "textarea"
    ]
  ],
  "PRIMAIRE": [
    [
      "critical",
      "Victime critique sur appréciation primaire",
      [
        "oui",
        "non",
        "doute",
        "non_evalue"
      ]
    ],
    [
      "massive_bleed",
      "Hémorragie massive visible",
      "yn"
    ],
    [
      "airway",
      "Voies aériennes libres",
      "yn"
    ],
    [
      "breathing",
      "Respiration présente et efficace",
      [
        "efficace",
        "absente",
        "inefficace",
        "gasps",
        "non_evalue"
      ]
    ],
    [
      "pulse",
      "Pouls présent",
      [
        "oui",
        "absent",
        "doute",
        "non_evalue"
      ]
    ],
    [
      "avpu",
      "Réactivité rapide",
      [
        "A",
        "V",
        "P",
        "U",
        "non_evalue"
      ]
    ],
    [
      "skin",
      "Aspect rapide : pâleur, sueurs, cyanose, marbrures",
      "textarea"
    ],
    [
      "primary_at",
      "Date et heure de l'appréciation primaire",
      "datetime"
    ],
    [
      "response",
      "Évolution constatée après gestes immédiats",
      "textarea"
    ],
    [
      "secondary",
      "Bilan secondaire possible après appréciation primaire",
      [
        "oui",
        "différé pour urgence",
        "impossible"
      ]
    ]
  ],
  "A": [
    [
      "obstruction_type",
      "Obstruction : type",
      [
        "aucune",
        "partielle",
        "totale",
        "inconnu",
        "non_evalue"
      ]
    ],
    [
      "cough",
      "Toux efficace",
      "yn"
    ],
    [
      "voice",
      "Voix / possibilité de parler",
      "text"
    ],
    [
      "foreign_body",
      "Corps étranger / liquide observé ou rapporté",
      "text"
    ],
    [
      "before",
      "État respiratoire avant désobstruction",
      "textarea"
    ],
    [
      "after",
      "État respiratoire après désobstruction",
      "textarea"
    ]
  ],
  "B": [
    [
      "breathing",
      "Respiration",
      [
        "efficace",
        "absente",
        "inefficace",
        "gasps",
        "non_evalue"
      ]
    ],
    [
      "apnea_duration",
      "Durée d'apnée / source",
      "text"
    ],
    [
      "can_speak",
      "Possibilité de parler",
      [
        "phrases",
        "mots",
        "impossible",
        "inconnu"
      ]
    ],
    [
      "exhaustion",
      "Épuisement respiratoire",
      "yn"
    ],
    [
      "thorax_symmetry",
      "Mouvements thoraciques symétriques",
      "yn"
    ],
    [
      "noise",
      "Bruits observés / silence respiratoire",
      "textarea"
    ],
    [
      "trach",
      "Trachéotomie / laryngectomie",
      [
        "non",
        "trachéotomie",
        "laryngectomie",
        "type inconnu"
      ]
    ],
    [
      "stoma",
      "Respiration habituelle par stomie / canule et source",
      "text"
    ],
    [
      "secretions",
      "Obstruction / sécrétions / incident de canule",
      "textarea"
    ],
    [
      "trach_interface",
      "Interface réellement utilisée et adaptation au dispositif",
      "text"
    ],
    [
      "trach_response",
      "Réponse clinique / consignes de régulation",
      "textarea"
    ],
    [
      "o2_indication",
      "Indication rapportée de l'O2 : signes ABC, hypoxémie, consigne…",
      "textarea"
    ],
    [
      "o2_tolerance",
      "Tolérance et évolution avant / après O2",
      "textarea"
    ],
    [
      "o2_consign",
      "Consigne : source, date, changement / arrêt",
      "textarea"
    ]
  ],
  "C": [
    [
      "pulse_site",
      "Site du pouls évalué",
      "text"
    ],
    [
      "pulse_presence",
      "Présence du pouls",
      [
        "présent",
        "absent",
        "doute",
        "non_evalue"
      ]
    ],
    [
      "pulse_rhythm",
      "Rythme",
      [
        "régulier",
        "irrégulier",
        "inconnu",
        "non_evalue"
      ]
    ],
    [
      "trc_seconds",
      "TRC mesuré (secondes)",
      "number"
    ],
    [
      "perfusion",
      "Perfusion : couleur, chaleur, marbrures, extrémités",
      "textarea"
    ],
    [
      "shock_clues",
      "Signes de choc observés et évolution",
      "textarea"
    ]
  ],
  "D": [
    [
      "gcs_y",
      "Glasgow Y — ouverture des yeux",
      [
        "4",
        "3",
        "2",
        "1",
        "NT"
      ]
    ],
    [
      "gcs_v",
      "Glasgow V — réponse verbale",
      [
        "5",
        "4",
        "3",
        "2",
        "1",
        "NT"
      ]
    ],
    [
      "gcs_m",
      "Glasgow M — réponse motrice",
      [
        "6",
        "5",
        "4",
        "3",
        "2",
        "1",
        "NT"
      ]
    ],
    [
      "gcs_variant",
      "Version utilisée",
      [
        "adulte",
        "pédiatrique moins de 5 ans",
        "inconnue"
      ]
    ],
    [
      "gcs_nt_reason",
      "Motif de composante non testable / conditions",
      "textarea"
    ],
    [
      "pupil_left_size",
      "Pupille gauche : diamètre (mm)",
      "number"
    ],
    [
      "pupil_left_reaction",
      "Pupille gauche : réactivité",
      [
        "réactive",
        "non réactive",
        "non_evalue",
        "impossible"
      ]
    ],
    [
      "pupil_right_size",
      "Pupille droite : diamètre (mm)",
      "number"
    ],
    [
      "pupil_right_reaction",
      "Pupille droite : réactivité",
      [
        "réactive",
        "non réactive",
        "non_evalue",
        "impossible"
      ]
    ],
    [
      "motor_left",
      "Motricité gauche : main, bras, jambe, pied",
      "textarea"
    ],
    [
      "motor_right",
      "Motricité droite : main, bras, jambe, pied",
      "textarea"
    ],
    [
      "sensation_left",
      "Sensibilité gauche",
      "textarea"
    ],
    [
      "sensation_right",
      "Sensibilité droite",
      "textarea"
    ],
    [
      "neuro_usual",
      "Déficit antérieur / état neurologique habituel et source",
      "textarea"
    ],
    [
      "neuro_new",
      "Modification nouvelle et latéralité",
      "textarea"
    ],
    [
      "gly_context",
      "Glycémie : contexte",
      [
        "à jeun",
        "après repas",
        "contexte inconnu"
      ]
    ],
    [
      "gly_sample",
      "Résultat utilisé",
      [
        "capillaire",
        "interstitiel rapporté",
        "autre résultat rapporté"
      ]
    ],
    [
      "pain_nonverbal",
      "Douleur non verbale : mimique, comportement, tonus, plainte",
      "textarea"
    ]
  ],
  "E": [
    [
      "temperature_site",
      "Site de mesure de température",
      [
        "auriculaire",
        "frontale",
        "axillaire",
        "buccale",
        "rectale",
        "autre",
        "inconnu"
      ]
    ],
    [
      "temperature_method",
      "Méthode / appareil de température",
      "text"
    ],
    [
      "temperature_context",
      "Température réellement mesurée : contexte et évolution",
      "textarea"
    ],
    [
      "exam_coverage",
      "Examen corps entier : zones examinées, non examinées et motifs",
      "textarea"
    ]
  ],
  "BRULURE": [
    [
      "burn_at",
      "Date et heure de la brûlure",
      "datetime"
    ],
    [
      "multiple_depths",
      "Degrés / surfaces distincts par localisation",
      "textarea"
    ],
    [
      "circumferential",
      "Brûlure circulaire",
      "yn"
    ],
    [
      "critical_location",
      "Visage, voies aériennes, mains, articulations, périnée…",
      "textarea"
    ],
    [
      "inhalation",
      "Suies, voix modifiée, expectoration noire, inhalation suspectée",
      "textarea"
    ],
    [
      "electrical",
      "Électricité : tension, entrée / sortie, trajet, chute",
      "textarea"
    ],
    [
      "chemical",
      "Produit chimique, forme, concentration, FDS / consigne",
      "textarea"
    ],
    [
      "cool_start",
      "Début du refroidissement réellement effectué",
      "datetime"
    ],
    [
      "cool_end",
      "Fin du refroidissement réellement effectué",
      "datetime"
    ],
    [
      "cool_method",
      "Méthode réellement utilisée",
      [
        "eau",
        "hydrogel",
        "rinçage chimique",
        "autre",
        "inconnu"
      ]
    ],
    [
      "cool_previous",
      "Refroidissement avant arrivée : méthode, durée, source",
      "textarea"
    ],
    [
      "cool_water",
      "Température de l'eau / conditions si connues",
      "text"
    ],
    [
      "cool_stop",
      "Motif d'interruption / hypothermie / détresse circulatoire",
      "textarea"
    ],
    [
      "cool_consign",
      "Consigne médicale, source et heure",
      "textarea"
    ],
    [
      "cool_response",
      "Tolérance, température et évolution",
      "textarea"
    ]
  ],
  "FAST": [
    [
      "last_well",
      "Dernière fois vue sans déficit (LKW) : date et heure",
      "datetime"
    ],
    [
      "last_well_status",
      "Certitude LKW",
      [
        "certaine",
        "estimée",
        "inconnue"
      ]
    ],
    [
      "last_well_source",
      "Source LKW",
      "text"
    ],
    [
      "discovered_at",
      "Date et heure de découverte des signes",
      "datetime"
    ],
    [
      "onset_at",
      "Début des signes si connu : date et heure",
      "datetime"
    ],
    [
      "onset_status",
      "Début",
      [
        "certain",
        "estimé",
        "inconnu",
        "AVC au réveil"
      ]
    ],
    [
      "laterality",
      "Latéralité / territoire atteint",
      "text"
    ],
    [
      "resolved",
      "Signes résolus avant arrivée",
      "yn"
    ],
    [
      "vision_balance",
      "Troubles visuels, équilibre, céphalée inhabituelle",
      "textarea"
    ],
    [
      "prior_deficit",
      "Déficit ancien / séquelles et source",
      "textarea"
    ],
    [
      "usual_autonomy",
      "Autonomie habituelle avant les signes",
      "text"
    ],
    [
      "anticoag",
      "Anticoagulant : nom, dernière dose, heure / source",
      "textarea"
    ]
  ],
  "SAMPLER": [
    [
      "search_source",
      "Sources de l'anamnèse : victime, proche, ordonnances, dossier…",
      "textarea"
    ],
    [
      "allergy_search",
      "Recherche d'allergie",
      [
        "faite",
        "inconnue",
        "non_evalue",
        "impossible"
      ]
    ],
    [
      "med_search",
      "Recherche des traitements",
      [
        "faite",
        "inconnue",
        "non_evalue",
        "impossible"
      ]
    ],
    [
      "med_detail",
      "Noms exacts, doses habituelles, dernière prise utile, source",
      "textarea"
    ],
    [
      "history_search",
      "Recherche d'antécédents",
      [
        "faite",
        "inconnue",
        "non_evalue",
        "impossible"
      ]
    ],
    [
      "prior_hospital",
      "Hospitalisation / réanimation antérieure pertinente",
      "textarea"
    ],
    [
      "documents",
      "Documents et ordonnances disponibles / consultés",
      "textarea"
    ],
    [
      "nonverbal_pain",
      "Douleur non verbale : observations descriptives, sans score inventé",
      "textarea"
    ]
  ],
  "POSITION": [
    [
      "found",
      "Position à la découverte",
      "text"
    ],
    [
      "adopted",
      "Position adoptée et changements",
      "text"
    ],
    [
      "reason",
      "Motif : tolérance, confort, ventilation, immobilisation…",
      "textarea"
    ],
    [
      "position_at",
      "Date et heure du changement de position",
      "datetime"
    ],
    [
      "tolerance",
      "Tolérance et état avant / après",
      "textarea"
    ],
    [
      "devices",
      "Dispositifs de conditionnement utilisés et justification",
      "textarea"
    ],
    [
      "distal_before",
      "Contrôle distal avant conditionnement",
      "textarea"
    ],
    [
      "distal_after",
      "Contrôle distal après conditionnement",
      "textarea"
    ],
    [
      "transfer_at",
      "Date et heure de mobilisation / transfert",
      "datetime"
    ],
    [
      "transfer_incident",
      "Incident / modification de l'état pendant transfert",
      "textarea"
    ],
    [
      "restraint",
      "Enfant : dispositif de retenue adapté / poids connu",
      "text"
    ],
    [
      "parent",
      "Accompagnement du parent et conditions",
      "textarea"
    ]
  ],
  "RCP_CONTEXT": [
    [
      "discovery",
      "Découverte de l'arrêt : date et heure",
      "datetime"
    ],
    [
      "witness",
      "Arrêt devant témoin",
      "yn"
    ],
    [
      "first_witness",
      "Premiers gestes du témoin : nature / date / source",
      "textarea"
    ],
    [
      "initial_breathing",
      "Respiration à la découverte : absente / gasps / autre",
      "text"
    ],
    [
      "arrest_context",
      "Contexte : traumatique, noyade, naissance, cause rapportée",
      "textarea"
    ],
    [
      "note",
      "Précisions / motif des interruptions / état au RACS",
      "textarea"
    ]
  ]
};
const CLINICAL_MODULES = {
  "grossesse": {
    "title": "Grossesse / post-partum",
    "source": "T1 14.2.1–14.2.3 / 14.3.1",
    "fields": [
      [
        "status",
        "Grossesse",
        [
          "confirmée",
          "possible",
          "inconnue",
          "non"
        ]
      ],
      [
        "term",
        "Terme en semaines d'aménorrhée (SA)",
        "number"
      ],
      [
        "term_source",
        "Source du terme / date des dernières règles",
        "text"
      ],
      [
        "gestity",
        "Gestité",
        "number"
      ],
      [
        "parity",
        "Parité",
        "number"
      ],
      [
        "multiple",
        "Grossesse multiple",
        "yn"
      ],
      [
        "followup",
        "Suivi / maternité de référence / dossier",
        "text"
      ],
      [
        "complications",
        "Complications rapportées / antécédents obstétricaux",
        "textarea"
      ],
      [
        "fetal_movements",
        "Mouvements fœtaux rapportés, changement habituel",
        "text"
      ],
      [
        "bleeding",
        "Saignement vaginal actuel",
        "yn"
      ],
      [
        "bleeding_detail",
        "Quantité, évolution, début du saignement",
        "textarea"
      ],
      [
        "abdominal_pain",
        "Douleur abdominale / pelvienne",
        "yn"
      ],
      [
        "headache",
        "Céphalée inhabituelle",
        "yn"
      ],
      [
        "vision",
        "Troubles visuels",
        "yn"
      ],
      [
        "epigastric",
        "Douleur épigastrique",
        "yn"
      ],
      [
        "malaise",
        "Malaise / perte de connaissance",
        "yn"
      ],
      [
        "seizure",
        "Convulsion pendant grossesse / post-partum",
        "yn"
      ],
      [
        "postpartum",
        "Post-partum",
        "yn"
      ],
      [
        "delivery_at",
        "Date et heure de l'accouchement si post-partum",
        "datetime"
      ],
      [
        "contractions",
        "Contractions / travail suspecté",
        "yn"
      ],
      [
        "regulation",
        "Informations obstétricales transmises / consignes et heure",
        "textarea"
      ]
    ],
    "note": "Grossesse possible : douleur, malaise ou saignement nécessitent le bilan ciblé. Renseigner les deux chiffres de PA et la conscience. Signes obstétricaux à transmettre sans diagnostic automatique."
  },
  "travail": {
    "title": "Travail / accouchement imminent",
    "source": "T1 14.3.1 ; T2 M.24",
    "fields": [
      [
        "start",
        "Début des contractions",
        "datetime"
      ],
      [
        "duration",
        "Durée d'une contraction (secondes)",
        "number"
      ],
      [
        "interval",
        "Intervalle entre contractions (minutes)",
        "number"
      ],
      [
        "progression",
        "Régularité / rapprochement / intensité",
        "textarea"
      ],
      [
        "waters",
        "Rupture de la poche des eaux",
        "yn"
      ],
      [
        "waters_at",
        "Date et heure de rupture",
        "datetime"
      ],
      [
        "liquid",
        "Couleur / aspect / odeur du liquide",
        "text"
      ],
      [
        "urge",
        "Envie irrépressible de pousser",
        "yn"
      ],
      [
        "descent",
        "Sensation de descente / présentation visible",
        "textarea"
      ],
      [
        "presentation",
        "Présentation connue et source",
        "textarea"
      ],
      [
        "term",
        "Terme / grossesse multiple confirmé et source",
        "text"
      ],
      [
        "fever",
        "Fièvre rapportée / mesurée",
        "text"
      ],
      [
        "maternity",
        "Maternité de référence et temps d'accès estimé",
        "text"
      ],
      [
        "consign",
        "Consignes de régulation : source, heure, contenu",
        "textarea"
      ]
    ],
    "note": "Observation externe et informations rapportées ; aucun examen vaginal proposé. Chronométrer les contractions ne doit pas retarder les gestes urgents."
  },
  "naissance": {
    "title": "Naissance : mère et nouveau-né liés",
    "source": "T1 14.3–14.4 ; T2 M.04/M.24/G.13",
    "fields": [
      [
        "mother_id",
        "Identifiant du dossier mère",
        "text"
      ],
      [
        "mother_loss",
        "Pertes sanguines maternelles : quantité estimée, évolution",
        "textarea"
      ],
      [
        "mother_state",
        "Conscience, FC et PA maternelles datées",
        "textarea"
      ],
      [
        "placenta",
        "Délivrance / placenta",
        [
          "non délivré",
          "délivré",
          "inconnu"
        ]
      ],
      [
        "placenta_at",
        "Date et heure de délivrance",
        "datetime"
      ],
      [
        "maternal_response",
        "Évolution de la mère / consignes",
        "textarea"
      ]
    ],
    "note": "Ajouter un dossier par bébé. Chaque nouveau-né a son propre T0 ; les constantes générales de la mère ne sont pas copiées dans son bilan. Le bilan de chaque bébé utilise un contexte de naissance distinct ; la cible O2 maternelle reste indépendante. La cadence néonatale contradictoire entre références doit être confirmée par la régulation."
  },
  "irc": {
    "title": "BPCO / insuffisance respiratoire chronique",
    "source": "T1 5.4 ; T2 M.07",
    "fields": [
      [
        "bpco",
        "BPCO connue",
        "yn"
      ],
      [
        "irc",
        "Insuffisance respiratoire chronique connue",
        "yn"
      ],
      [
        "source",
        "Source : victime / proche / prescription / document",
        "text"
      ],
      [
        "usual_spo2",
        "SpO2 habituelle (%)",
        "number"
      ],
      [
        "usual_condition",
        "Conditions de la SpO2 habituelle",
        [
          "air",
          "O2",
          "inconnu"
        ]
      ],
      [
        "home_o2",
        "O2 à domicile",
        "yn"
      ],
      [
        "home_flow",
        "Débit habituel (L/min)",
        "number"
      ],
      [
        "home_interface",
        "Interface habituelle",
        "text"
      ],
      [
        "home_hours",
        "Durée quotidienne / modalités de l'O2",
        "text"
      ],
      [
        "usual_ventilation",
        "Ventilation habituelle / VNI rapportée",
        "text"
      ],
      [
        "prescribed_target",
        "Cible prescrite et source documentaire",
        "text"
      ],
      [
        "onset",
        "Début / aggravation de la dyspnée",
        "datetime"
      ],
      [
        "change",
        "Différence avec l'état habituel",
        "textarea"
      ],
      [
        "cough",
        "Toux : habituelle / nouvelle / aggravée",
        "text"
      ],
      [
        "sputum",
        "Expectorations : couleur / quantité / modification",
        "text"
      ],
      [
        "fever",
        "Fièvre actuelle / rapportée",
        "text"
      ],
      [
        "o2_break",
        "Rupture / panne / changement du traitement O2",
        "textarea"
      ],
      [
        "therapy",
        "Traitements pris avant arrivée : nom, dose, heure, source",
        "textarea"
      ],
      [
        "response",
        "Effet observé / rapporté des traitements",
        "textarea"
      ],
      [
        "icu",
        "Hospitalisation / réanimation / intubation antérieure",
        "text"
      ],
      [
        "consciousness",
        "Modification de conscience actuelle",
        "yn"
      ]
    ],
    "note": "BPCO seule ≠ IRC confirmée. Cible locale IRC 89–92 % (M.07) ; 88–92 % dans des recommandations externes : faire confirmer une consigne individualisée, sans transformer la SpO2 habituelle en cible."
  },
  "asthme": {
    "title": "Crise d’asthme / gêne bronchique",
    "source": "T1 5.2",
    "fields": [
      [
        "onset",
        "Début de la crise",
        "datetime"
      ],
      [
        "trigger",
        "Déclencheur / exposition",
        "text"
      ],
      [
        "usual",
        "Crises habituelles et différence actuelle",
        "textarea"
      ],
      [
        "recent",
        "Crises récentes / crise grave antérieure",
        "text"
      ],
      [
        "icu",
        "Réanimation / intubation antérieure",
        "yn"
      ],
      [
        "treatment",
        "Traitement habituel et secours : noms",
        "text"
      ],
      [
        "taken",
        "Prises avant arrivée : dose, heure, source",
        "textarea"
      ],
      [
        "effect",
        "Effet des prises",
        "textarea"
      ],
      [
        "expiration",
        "Expiration prolongée / sibilants / silence respiratoire",
        "textarea"
      ],
      [
        "speech",
        "Parole",
        [
          "phrases",
          "mots",
          "impossible",
          "inconnu"
        ]
      ],
      [
        "exhaustion",
        "Épuisement / modification de conscience",
        "yn"
      ]
    ],
    "note": "Un silence respiratoire ou l’absence de sibilants ne permet pas d’exclure une crise grave."
  },
  "oap": {
    "title": "Suspicion d’OAP / dyspnée cardiaque",
    "source": "T1 5.3",
    "fields": [
      [
        "onset",
        "Début de la dyspnée",
        "datetime"
      ],
      [
        "orthopnea",
        "Orthopnée",
        "yn"
      ],
      [
        "tolerated_position",
        "Position tolérée / aggravation en décubitus",
        "text"
      ],
      [
        "sputum",
        "Toux / expectoration mousseuse ou rosée",
        "textarea"
      ],
      [
        "sounds",
        "Bruits respiratoires observés / rapportés",
        "text"
      ],
      [
        "pain",
        "Douleur thoracique associée",
        "yn"
      ],
      [
        "history",
        "Insuffisance cardiaque / OAP antérieur",
        "text"
      ],
      [
        "treatment",
        "Traitements déjà pris : noms, dose, heure",
        "textarea"
      ],
      [
        "effect",
        "Évolution / effet des prises",
        "textarea"
      ]
    ],
    "note": "Reporter FC, rythme, PA, conscience et réponse clinique ; les signes ne posent pas un diagnostic."
  },
  "thorax": {
    "title": "Douleur thoracique / EP / dissection : éléments utiles",
    "source": "T1 6.2–6.4 ; T2 S.02",
    "fields": [
      [
        "new",
        "Douleur nouvelle ou habituelle",
        "text"
      ],
      [
        "onset",
        "Début de la douleur",
        "datetime"
      ],
      [
        "migrating",
        "Douleur migratrice / irradiation inhabituelle",
        "yn"
      ],
      [
        "dyspnea",
        "Dyspnée associée",
        "yn"
      ],
      [
        "hemoptysis",
        "Hémoptysie",
        "yn"
      ],
      [
        "pci",
        "Perte de connaissance associée",
        "yn"
      ],
      [
        "dvt",
        "Douleur / gonflement unilatéral de jambe / TVP connue",
        "textarea"
      ],
      [
        "immobility",
        "Immobilisation / chirurgie / voyage récent, dates",
        "textarea"
      ],
      [
        "pregnancy",
        "Grossesse / post-partum : préciser les dates",
        "text"
      ],
      [
        "drug",
        "Médicaments pris : nom, dose, dernière heure",
        "textarea"
      ],
      [
        "anticoag",
        "Anticoagulants / antiagrégants : noms et dernière dose",
        "textarea"
      ],
      [
        "device",
        "Pacemaker / défibrillateur implanté rapporté",
        "text"
      ],
      [
        "pa_context",
        "PA des deux bras : contexte et écart observé",
        "textarea"
      ]
    ],
    "note": "Un écart de PAS >20 mmHg entre deux bras, s’il est mesuré dans un contexte comparable, est un élément à transmettre. PQRST complète ce bilan."
  },
  "convulsions": {
    "title": "Convulsions",
    "source": "T1 7.3 ; 20.3",
    "fields": [
      [
        "start",
        "Début de la crise",
        "datetime"
      ],
      [
        "end",
        "Fin de la crise",
        "datetime"
      ],
      [
        "duration",
        "Durée rapportée si début / fin inconnus",
        "text"
      ],
      [
        "count",
        "Nombre de crises",
        "number"
      ],
      [
        "type",
        "Crise",
        [
          "généralisée",
          "focale",
          "inconnue"
        ]
      ],
      [
        "lateral",
        "Territoire / latéralité / signes observés",
        "textarea"
      ],
      [
        "between",
        "Récupération entre les crises",
        [
          "complète",
          "incomplète",
          "aucune",
          "inconnue"
        ]
      ],
      [
        "first",
        "Première crise",
        "yn"
      ],
      [
        "epilepsy",
        "Épilepsie connue",
        "yn"
      ],
      [
        "treatment",
        "Traitement / interruption / dernière prise",
        "textarea"
      ],
      [
        "fever",
        "Fièvre",
        "yn"
      ],
      [
        "pregnancy",
        "Grossesse / post-partum",
        "yn"
      ],
      [
        "purpura",
        "Purpura observé",
        "yn"
      ],
      [
        "trauma",
        "Traumatisme / morsure de langue / autres lésions",
        "textarea"
      ],
      [
        "after",
        "Conscience et respiration après la crise",
        "textarea"
      ]
    ],
    "note": "Le chronomètre aide à documenter la durée réelle ; il ne remplace pas l’horodatage rapporté par les témoins."
  },
  "glycemie": {
    "title": "Trouble glycémique",
    "source": "T1 7.2 ; T2 S.03",
    "fields": [
      [
        "symptoms",
        "Signes et début du malaise",
        "textarea"
      ],
      [
        "diabetes",
        "Diabète connu / type et source",
        "text"
      ],
      [
        "treatment",
        "Insuline / antidiabétiques : nom, dose et dernière prise",
        "textarea"
      ],
      [
        "meal",
        "Dernier repas : date, heure, quantité",
        "text"
      ],
      [
        "effort",
        "Effort / jeûne / événement associé",
        "text"
      ],
      [
        "swallow",
        "Déglutition sûre / conscience compatible",
        [
          "oui",
          "non",
          "doute",
          "non_evalue"
        ]
      ],
      [
        "resugar",
        "Resucrage réellement effectué : nature, quantité",
        "textarea"
      ],
      [
        "resugar_at",
        "Date et heure du resucrage",
        "datetime"
      ],
      [
        "effect",
        "Effet et évolution de la conscience",
        "textarea"
      ],
      [
        "recheck",
        "Contrôle ultérieur : date, heure, résultat et unité",
        "textarea"
      ],
      [
        "vomit",
        "Vomissements / douleur abdominale",
        "yn"
      ],
      [
        "dehydration",
        "Déshydratation : signes observés",
        "textarea"
      ],
      [
        "polypnea",
        "Polypnée / respiration inhabituelle",
        "yn"
      ]
    ],
    "note": "LO / HI sont des résultats bruts, jamais remplacés par une valeur numérique. <0,6 g/L : seuil certain du guide ; 0,6–0,7 g/L : vigilance conservée, consigne à confirmer. Les valeurs 0,8–1,1 g/L correspondent au contexte à jeun."
  },
  "allergie": {
    "title": "Réaction allergique actuelle",
    "source": "T1 8",
    "fields": [
      [
        "start",
        "Début de la réaction",
        "datetime"
      ],
      [
        "allergen",
        "Allergène suspect / certain et source",
        "text"
      ],
      [
        "exposure",
        "Voie, date, heure de l'exposition",
        "text"
      ],
      [
        "progression",
        "Progression des signes",
        "textarea"
      ],
      [
        "edema",
        "Œdème langue / gorge / face",
        "yn"
      ],
      [
        "voice",
        "Voix modifiée / gêne à avaler",
        "yn"
      ],
      [
        "breathing",
        "Signes respiratoires actuels",
        "textarea"
      ],
      [
        "circulation",
        "Signes circulatoires / malaise actuel",
        "textarea"
      ],
      [
        "skin",
        "Signes cutanés actuels",
        "textarea"
      ],
      [
        "digestive",
        "Signes digestifs actuels",
        "textarea"
      ],
      [
        "injector",
        "Auto-injecteur effectivement utilisé : nom / dose rapportée",
        "textarea"
      ],
      [
        "injector_at",
        "Date et heure de l'auto-injecteur",
        "datetime"
      ],
      [
        "consign",
        "Consigne / source / heure",
        "text"
      ],
      [
        "effect",
        "Effet observé / rapporté",
        "textarea"
      ]
    ],
    "note": "Le module concerne la réaction actuelle. L’absence de signes cutanés n’exclut pas une réaction grave."
  },
  "co": {
    "title": "CO / fumées",
    "source": "T1 11.6 ; T2 S.06",
    "fields": [
      [
        "source",
        "Source probable / appareil / incendie",
        "text"
      ],
      [
        "closed",
        "Local clos / ventilation / circonstances",
        "textarea"
      ],
      [
        "others",
        "Autres personnes ou animaux exposés et symptômes",
        "textarea"
      ],
      [
        "duration",
        "Durée d'exposition rapportée et source",
        "text"
      ],
      [
        "extracted_at",
        "Date et heure de mise hors exposition",
        "datetime"
      ],
      [
        "pregnancy",
        "Grossesse possible / connue",
        "yn"
      ],
      [
        "pci",
        "Perte de connaissance",
        "yn"
      ],
      [
        "o2_before",
        "O2 avant mesures : début, interface et débit connus",
        "textarea"
      ],
      [
        "measure_kind",
        "Type de mesure",
        [
          "CO ambiant ppm",
          "CO expiré ppm",
          "SpCO %",
          "HbCO sanguine %",
          "aucun",
          "inconnu"
        ]
      ],
      [
        "measure_value",
        "Résultat brut et unité (aucune conversion automatique)",
        "text"
      ],
      [
        "measure_at",
        "Date et heure de mesure",
        "datetime"
      ],
      [
        "measure_source",
        "Méthode réellement utilisée et source du résultat",
        "text"
      ],
      [
        "soot",
        "Suies / expectoration noire / brûlure faciale",
        "textarea"
      ],
      [
        "voice",
        "Modification de voix / gêne respiratoire",
        "textarea"
      ],
      [
        "reported_hbco",
        "Estimation fournie par un dispositif : libellé exact, distinct d'une HbCO sanguine",
        "textarea"
      ]
    ],
    "note": "Une SpO2 normale n’exclut pas une intoxication au CO. Ne pas convertir CO expiré ou SpCO en résultat sanguin."
  },
  "toxique": {
    "title": "Intoxication / substances",
    "source": "T1 11",
    "fields": [
      [
        "substance",
        "Substance / produit / nom exact",
        "text"
      ],
      [
        "amount",
        "Quantité supposée / maximale possible et source",
        "text"
      ],
      [
        "concentration",
        "Concentration / présentation",
        "text"
      ],
      [
        "route",
        "Voie d'exposition",
        "text"
      ],
      [
        "at",
        "Date et heure de prise / exposition",
        "datetime"
      ],
      [
        "mixed",
        "Produits associés / alcool / médicaments",
        "textarea"
      ],
      [
        "vomit",
        "Vomissements / aspiration suspectée",
        "text"
      ],
      [
        "intent",
        "Contexte rapporté : accidentel / volontaire / inconnu",
        "text"
      ],
      [
        "packaging",
        "Emballage / ordonnance / FDS disponibles",
        "text"
      ],
      [
        "contamination",
        "Contamination persistante / exposition des intervenants",
        "textarea"
      ],
      [
        "consign",
        "Consignes reçues et source / heure",
        "textarea"
      ],
      [
        "evolution",
        "Signes observés et évolution",
        "textarea"
      ]
    ],
    "note": "Une consommation d’alcool rapportée ne suffit pas à expliquer une altération neurologique ; poursuivre le bilan somatique."
  },
  "infection": {
    "title": "Infection / signes de gravité / purpura",
    "source": "T1 18 ; 20.3",
    "fields": [
      [
        "onset",
        "Début des symptômes",
        "datetime"
      ],
      [
        "focus",
        "Point d'appel infectieux / symptômes",
        "textarea"
      ],
      [
        "immuno",
        "Immunodépression / traitements associés",
        "text"
      ],
      [
        "headache",
        "Céphalée",
        "yn"
      ],
      [
        "photophobia",
        "Photophobie",
        "yn"
      ],
      [
        "stiffness",
        "Raideur rapportée / observée, source",
        "text"
      ],
      [
        "confusion",
        "Confusion nouvelle / état habituel",
        "yn"
      ],
      [
        "perfusion",
        "Perfusion périphérique / TRC / marbrures",
        "textarea"
      ],
      [
        "purpura_exam",
        "Recherche de purpura",
        [
          "positif",
          "négatif sur zones examinées",
          "non_evalue",
          "impossible"
        ]
      ],
      [
        "exam_zones",
        "Zones examinées / zones non examinées et motifs",
        "textarea"
      ],
      [
        "purpura_extent",
        "Localisation / extension du purpura",
        "textarea"
      ],
      [
        "purpura_at",
        "Date et heure de constat / évolution",
        "datetime"
      ],
      [
        "temperature",
        "Fièvre : valeur mesurée ou rapportée / contexte",
        "text"
      ],
      [
        "consign",
        "Consignes et évolution",
        "textarea"
      ]
    ],
    "note": "Documenter les signes neurologiques et de perfusion ; aucun score de sepsis automatique. Un purpura constaté est un élément urgent de transmission."
  },
  "pediatrie": {
    "title": "Bilan pédiatrique complémentaire",
    "source": "T1 20.3–20.4",
    "fields": [
      [
        "premature",
        "Prématurité connue",
        "yn"
      ],
      [
        "gestational_age",
        "Terme à la naissance / âge corrigé rapporté et source",
        "text"
      ],
      [
        "parent",
        "Parent / témoin et source",
        "text"
      ],
      [
        "usual",
        "État habituel / différence actuelle",
        "textarea"
      ],
      [
        "appearance",
        "Apparence : tonus, interaction, consolabilité, regard, cri",
        "textarea"
      ],
      [
        "breathing",
        "Travail respiratoire : tirage, bruits, position",
        "textarea"
      ],
      [
        "circulation",
        "Circulation cutanée : pâleur, marbrures, cyanose",
        "textarea"
      ],
      [
        "feeding",
        "Alimentation / quantité de lait / dernière prise",
        "text"
      ],
      [
        "wet",
        "Dernière couche mouillée / diurèse",
        "text"
      ],
      [
        "vomit",
        "Vomissements / diarrhée / pertes",
        "text"
      ],
      [
        "dehydration",
        "Déshydratation : signes observés",
        "textarea"
      ],
      [
        "purpura",
        "Recherche de purpura / zones examinées",
        "textarea"
      ],
      [
        "cry",
        "Cri / comportement / douleur non verbale",
        "textarea"
      ],
      [
        "weight_source",
        "Source du poids : mesuré / parent / document / estimation",
        "text"
      ],
      [
        "last_normal",
        "Dernier état habituel constaté et source",
        "textarea"
      ]
    ],
    "note": "L’âge corrigé apporte du contexte ; il ne remplace pas silencieusement l’âge chronologique pour les constantes. Le triangle pédiatrique décrit les observations, sans score inventé."
  },
  "geriatrie": {
    "title": "Personne âgée / fragilité",
    "source": "T1 21.1",
    "fields": [
      [
        "autonomy",
        "Autonomie habituelle / GIR si connu et source",
        "text"
      ],
      [
        "cognition",
        "État cognitif habituel",
        "text"
      ],
      [
        "mobility",
        "Mobilité / aide habituelle",
        "text"
      ],
      [
        "confusion",
        "Confusion nouvelle / modification récente",
        "yn"
      ],
      [
        "meds",
        "Traitements à risque / noms et dernières prises",
        "textarea"
      ],
      [
        "anticoag",
        "Anticoagulant / antiagrégant : nom, dernière prise",
        "text"
      ],
      [
        "fall",
        "Chute / malaise : mécanisme, date, témoins",
        "textarea"
      ],
      [
        "ground_start",
        "Début du temps au sol",
        "datetime"
      ],
      [
        "ground_end",
        "Fin du temps au sol",
        "datetime"
      ],
      [
        "cold",
        "Exposition au froid / hypothermie constatée",
        "text"
      ],
      [
        "dehydration",
        "Alimentation, hydratation / signes de déshydratation",
        "textarea"
      ],
      [
        "compression",
        "Lésions de compression / douleur / déficit",
        "textarea"
      ],
      [
        "before_after",
        "État neurologique et tolérance avant / après mobilisation",
        "textarea"
      ]
    ],
    "note": "Les constantes utilisent les références adultes ; aucun seuil de SpO2 abaissé du seul fait de l’âge."
  },
  "trauma": {
    "title": "Mécanisme traumatique",
    "source": "T1 15–17",
    "fields": [
      [
        "event",
        "Nature du traumatisme",
        "text"
      ],
      [
        "fall_height",
        "Hauteur de chute / sol / source",
        "text"
      ],
      [
        "speed",
        "Vitesse estimée / source / cinétique",
        "text"
      ],
      [
        "ejection",
        "Éjection / intrusion / désincarcération",
        "textarea"
      ],
      [
        "belt",
        "Ceinture / casque / protections",
        "text"
      ],
      [
        "impact",
        "Point d'impact / direction / zones atteintes",
        "text"
      ],
      [
        "penetration",
        "Plaie pénétrante / objet",
        "text"
      ],
      [
        "compression",
        "Compression : début, zone, durée, dégagement",
        "textarea"
      ],
      [
        "position",
        "Position à la découverte / mobilisation avant arrivée",
        "text"
      ],
      [
        "anticoag",
        "Anticoagulants / antiagrégants : nom et dernière prise",
        "text"
      ],
      [
        "spine",
        "Douleur rachidienne / neurologie / maintien effectué",
        "textarea"
      ],
      [
        "immobilization",
        "Dispositif choisi, justification et tolérance",
        "textarea"
      ]
    ],
    "note": "Le collier n’est pas une conséquence automatique d’un mécanisme traumatique. Documenter les signes et la justification du conditionnement."
  },
  "noyade": {
    "title": "Noyade",
    "source": "T1 12.4",
    "fields": [
      [
        "immersion",
        "Début d'immersion / source",
        "datetime"
      ],
      [
        "extraction",
        "Fin d'immersion / extraction",
        "datetime"
      ],
      [
        "duration",
        "Durée estimée, certitude et source",
        "text"
      ],
      [
        "water",
        "Milieu / température de l'eau si connue",
        "text"
      ],
      [
        "breathing",
        "Respiration / gasps / toux / écume après extraction",
        "textarea"
      ],
      [
        "trauma",
        "Traumatisme associé / plongeon",
        "text"
      ],
      [
        "response",
        "Évolution après extraction et gestes ciblés",
        "textarea"
      ]
    ],
    "note": ""
  },
  "thermique": {
    "title": "Froid / chaleur",
    "source": "T1 12.1–12.2",
    "fields": [
      [
        "environment",
        "Ambiance, exposition, durée et activité",
        "textarea"
      ],
      [
        "extraction",
        "Date et heure de fin d'exposition",
        "datetime"
      ],
      [
        "wet",
        "Vêtements mouillés / protection / hydratation",
        "text"
      ],
      [
        "neuro",
        "Conscience, comportement, frissons, tonus",
        "textarea"
      ],
      [
        "skin",
        "Peau / température réellement mesurée",
        "text"
      ],
      [
        "actions",
        "Refroidissement / protection thermique réellement effectués, heure, effet",
        "textarea"
      ]
    ],
    "note": "Les signes cliniques priment ; les seuils FR/FC dépendent de l’âge. Ne pas compter automatiquement trois critères adultes pour conclure à un coup de chaleur."
  },
  "electrique": {
    "title": "Électrisation / foudre",
    "source": "T1 12.5",
    "fields": [
      [
        "source",
        "Source / tension / type de courant / source de l'information",
        "text"
      ],
      [
        "cut",
        "Mise hors tension / danger persistant",
        "text"
      ],
      [
        "contact",
        "Début / fin / durée du contact électrique",
        "text"
      ],
      [
        "path",
        "Points d'entrée et sortie / trajet supposé",
        "text"
      ],
      [
        "fall",
        "Chute / projection / lésions associées",
        "textarea"
      ],
      [
        "neuro",
        "Perte de connaissance / conscience et évolution",
        "textarea"
      ]
    ],
    "note": ""
  },
  "compression": {
    "title": "Compression / pendaison / strangulation",
    "source": "T1 12.6–12.7",
    "fields": [
      [
        "mechanism",
        "Compression / pendaison / strangulation : circonstances",
        "text"
      ],
      [
        "start",
        "Début de compression",
        "datetime"
      ],
      [
        "release",
        "Date et heure de dégagement / libération",
        "datetime"
      ],
      [
        "duration",
        "Durée supposée / source",
        "text"
      ],
      [
        "zone",
        "Zones comprimées / signes locaux",
        "textarea"
      ],
      [
        "resp_neuro",
        "Respiration et neurologie avant / après libération",
        "textarea"
      ]
    ],
    "note": ""
  },
  "plongee": {
    "title": "Accident de plongée",
    "source": "T1 12.10",
    "fields": [
      [
        "depth",
        "Profondeur / gaz / équipement et source",
        "text"
      ],
      [
        "timeline",
        "Heures de début, remontée, sortie, apparition des symptômes",
        "textarea"
      ],
      [
        "ascent",
        "Profil de remontée / paliers / incident rapporté",
        "textarea"
      ],
      [
        "symptoms",
        "Signes respiratoires, neurologiques, douleurs, évolution",
        "textarea"
      ],
      [
        "others",
        "Autres plongeurs concernés / témoins",
        "text"
      ],
      [
        "consign",
        "Consignes médicales reçues et heure",
        "textarea"
      ]
    ],
    "note": ""
  },
  "explosion": {
    "title": "Explosion / avalanche",
    "source": "T1 12.8–12.9",
    "fields": [
      [
        "event",
        "Explosion / avalanche : circonstances et dangers",
        "text"
      ],
      [
        "at",
        "Date et heure de l'événement",
        "datetime"
      ],
      [
        "burial",
        "Ensevelissement / espace respiratoire / source",
        "text"
      ],
      [
        "release",
        "Date et heure de dégagement",
        "datetime"
      ],
      [
        "duration",
        "Durée estimée d'ensevelissement / certitude",
        "text"
      ],
      [
        "injury",
        "Cinétique, surpression, projections, froid, lésions",
        "textarea"
      ],
      [
        "resp_neuro",
        "Évolution respiratoire / neurologique après dégagement",
        "textarea"
      ]
    ],
    "note": ""
  },
  "psy": {
    "title": "Comportement / crise psychique",
    "source": "T1 10",
    "fields": [
      [
        "speech",
        "Propos exacts / source, distinction observé ou rapporté",
        "textarea"
      ],
      [
        "behavior",
        "Comportement observé, agitation, coopération",
        "textarea"
      ],
      [
        "orientation",
        "Orientation / modification neurologique",
        "text"
      ],
      [
        "immediate_harm",
        "Danger immédiat rapporté ou observé",
        "textarea"
      ],
      [
        "weapons",
        "Arme / objet dangereux présent ou rapporté",
        "text"
      ],
      [
        "attempt",
        "Tentative : méthode / date / substance / traumatisme",
        "textarea"
      ],
      [
        "history",
        "Antécédents / traitements rapportés",
        "text"
      ],
      [
        "support",
        "Entourage / soutien présent",
        "text"
      ],
      [
        "somatic",
        "Éléments somatiques recherchés : glycémie, trauma, toxiques…",
        "textarea"
      ],
      [
        "calm",
        "Apaisement / environnement / effet observé",
        "textarea"
      ]
    ],
    "note": "Décrire les faits et poursuivre le bilan somatique. Aucun diagnostic psychiatrique ni disposition juridique automatisés."
  },
  "digestif": {
    "title": "Digestif / urinaire",
    "source": "T1 9",
    "fields": [
      [
        "onset",
        "Début des symptômes",
        "datetime"
      ],
      [
        "pain",
        "Douleur : région, irradiation, évolution / PQRST",
        "textarea"
      ],
      [
        "vomit",
        "Vomissements : fréquence / aspect / sang",
        "text"
      ],
      [
        "stool",
        "Selles : diarrhée / sang / selles noires / dernière selle",
        "text"
      ],
      [
        "urine",
        "Diurèse, dernière miction, douleur, sang",
        "text"
      ],
      [
        "fever",
        "Fièvre / symptômes associés",
        "text"
      ],
      [
        "pregnancy",
        "Grossesse possible / post-partum",
        "text"
      ],
      [
        "history",
        "Antécédents / chirurgie / traitements",
        "textarea"
      ]
    ],
    "note": ""
  },
  "drepanocytose": {
    "title": "Drépanocytose",
    "source": "T1 9",
    "fields": [
      [
        "history",
        "Drépanocytose connue et source",
        "text"
      ],
      [
        "usual",
        "Crises habituelles / différence actuelle",
        "text"
      ],
      [
        "pain",
        "Douleur, localisation, durée / PQRST",
        "textarea"
      ],
      [
        "fever",
        "Fièvre",
        "yn"
      ],
      [
        "thorax",
        "Douleur thoracique / dyspnée",
        "yn"
      ],
      [
        "neuro",
        "Signes neurologiques nouveaux",
        "yn"
      ],
      [
        "treat",
        "Traitements pris : noms, dose, heure, effet",
        "textarea"
      ]
    ],
    "note": ""
  },
  "obesite": {
    "title": "Obésité : adaptation du bilan et du transport",
    "source": "T1 21",
    "fields": [
      [
        "weight",
        "Poids connu, source / estimation",
        "text"
      ],
      [
        "mobility",
        "Mobilité habituelle / position tolérée",
        "text"
      ],
      [
        "resp",
        "Gêne respiratoire / ventilation habituelle",
        "text"
      ],
      [
        "equipment",
        "Dispositifs adaptés / besoins de mobilisation et renfort",
        "textarea"
      ],
      [
        "skin",
        "Zones difficiles à examiner, lésions et motifs",
        "textarea"
      ]
    ],
    "note": ""
  }
};
const REPEAT_FIELDS = {
  "lesion": [
    [
      "zone",
      "Zone anatomique et côté",
      "text"
    ],
    [
      "type",
      "Type de lésion : plaie, déformation, hématome…",
      "text"
    ],
    [
      "extent",
      "Étendue / dimensions / profondeur apparente",
      "text"
    ],
    [
      "mechanism",
      "Mécanisme / objet / contamination",
      "text"
    ],
    [
      "pain",
      "Douleur / évolution",
      "text"
    ],
    [
      "distal_before",
      "Avant immobilisation : pouls, couleur, chaleur, sensibilité, motricité",
      "textarea"
    ],
    [
      "distal_before_at",
      "Date et heure contrôle distal avant",
      "datetime"
    ],
    [
      "device",
      "Dispositif de protection / immobilisation utilisé",
      "text"
    ],
    [
      "distal_after",
      "Après immobilisation : pouls, couleur, chaleur, sensibilité, motricité",
      "textarea"
    ],
    [
      "distal_after_at",
      "Date et heure contrôle distal après",
      "datetime"
    ],
    [
      "tetanus",
      "Vaccination antitétanique : connue / inconnue, date rapportée",
      "text"
    ],
    [
      "amputation",
      "Amputation : niveau, complète / partielle, segment / conditionnement",
      "textarea"
    ]
  ],
  "hemorrhage": [
    [
      "site",
      "Site / côté de l'hémorragie",
      "text"
    ],
    [
      "technique",
      "Technique réellement utilisée",
      [
        "compression",
        "pansement compressif",
        "pansement hémostatique",
        "garrot",
        "autre"
      ]
    ],
    [
      "at",
      "Date et heure de réalisation",
      "datetime"
    ],
    [
      "origin",
      "Provenance : X / amputation / autre localisation",
      "text"
    ],
    [
      "tourniquet_id",
      "Identifiant du garrot (un enregistrement par garrot)",
      "text"
    ],
    [
      "response",
      "Efficacité / saignement résiduel / évolution",
      "textarea"
    ],
    [
      "consign",
      "Consigne, source / heure si pertinente",
      "text"
    ]
  ],
  "baby": [
    [
      "mother_id",
      "Identifiant du dossier mère (lien)",
      "text"
    ],
    [
      "birth_at",
      "T0 : date et heure de naissance",
      "datetime"
    ],
    [
      "term",
      "Terme / prématurité / poids connu et source",
      "text"
    ],
    [
      "tone",
      "Tonus",
      [
        "bon",
        "faible",
        "absent",
        "non_evalue"
      ]
    ],
    [
      "cry",
      "Cri",
      [
        "vigoureux",
        "faible",
        "absent",
        "non_evalue"
      ]
    ],
    [
      "breathing",
      "Respiration",
      [
        "efficace",
        "absente",
        "gasps",
        "inefficace",
        "non_evalue"
      ]
    ],
    [
      "fc",
      "FC mesurée (/min)",
      "number"
    ],
    [
      "spo2",
      "SpO2 mesurée (%)",
      "number"
    ],
    [
      "reading_at",
      "Date et heure des observations / mesures du bébé",
      "datetime"
    ],
    [
      "temperature",
      "Température mesurée (°C) / méthode",
      "text"
    ],
    [
      "thermal",
      "Protection thermique / séchage / peau à peau réellement effectués",
      "textarea"
    ],
    [
      "clamp_at",
      "Date et heure du clampage",
      "datetime"
    ],
    [
      "cut_at",
      "Date et heure de section du cordon",
      "datetime"
    ],
    [
      "cord_consign",
      "Consigne / circonstances de clampage et source",
      "text"
    ],
    [
      "bleeding",
      "Saignement du cordon / efficacité de l'hémostase",
      "text"
    ],
    [
      "aspiration",
      "Encombrement / aspiration indiquée, consigne et effet",
      "textarea"
    ],
    [
      "resuscitation",
      "Ventilation / compressions réellement effectuées, heures, réponse",
      "textarea"
    ],
    [
      "consign",
      "Consignes spécifiques de régulation, source et heure",
      "textarea"
    ]
  ],
  "ventilation": [
    [
      "start",
      "Début effectif de ventilation",
      "datetime"
    ],
    [
      "end",
      "Fin effective de ventilation",
      "datetime"
    ],
    [
      "indication",
      "Indication / respiration avant ventilation",
      "textarea"
    ],
    [
      "context",
      "Contexte",
      [
        "adulte",
        "enfant",
        "nourrisson",
        "nouveau-né hors naissance",
        "adaptation à la naissance"
      ]
    ],
    [
      "device",
      "BAVU : modèle / taille adaptés, poids connu, masque / canule",
      "text"
    ],
    [
      "air_o2",
      "Gaz réellement utilisé",
      [
        "air",
        "O2",
        "inconnu"
      ]
    ],
    [
      "flow",
      "Débit O2 réel (L/min)",
      "number"
    ],
    [
      "airway",
      "Liberté des voies aériennes / dispositif",
      "text"
    ],
    [
      "rise",
      "Soulèvement thoracique observé",
      "yn"
    ],
    [
      "seal",
      "Étanchéité / fuite / difficulté",
      "text"
    ],
    [
      "frequency",
      "Fréquence réellement effectuée (/min)",
      "number"
    ],
    [
      "vomit",
      "Vomissement / interruption / motif / heure",
      "textarea"
    ],
    [
      "response",
      "Respiration, FC, SpO2, conscience après ventilation",
      "textarea"
    ]
  ],
  "aspiration": [
    [
      "start",
      "Début effectif d'aspiration",
      "datetime"
    ],
    [
      "end",
      "Fin effective d'aspiration",
      "datetime"
    ],
    [
      "indication",
      "Indication : sécrétions, encombrement, liquide observé",
      "text"
    ],
    [
      "context",
      "Contexte",
      [
        "adulte",
        "enfant",
        "nourrisson",
        "naissance"
      ]
    ],
    [
      "material",
      "Matériel et sonde réellement utilisés",
      "text"
    ],
    [
      "setting",
      "Réglage réel et unité",
      "text"
    ],
    [
      "consign",
      "Consigne / source et heure",
      "text"
    ],
    [
      "response",
      "Effet observé, incidents / tolérance",
      "textarea"
    ]
  ],
  "baby_reading": [
    [
      "at",
      "Date et heure du relevé du bébé",
      "datetime"
    ],
    [
      "breathing",
      "Respiration",
      [
        "efficace",
        "absente",
        "inefficace",
        "gasps",
        "non_evalue"
      ]
    ],
    [
      "tone",
      "Tonus",
      [
        "bon",
        "faible",
        "absent",
        "non_evalue"
      ]
    ],
    [
      "cry",
      "Cri",
      [
        "vigoureux",
        "faible",
        "absent",
        "non_evalue"
      ]
    ],
    [
      "fc",
      "FC mesurée (/min)",
      "number"
    ],
    [
      "spo2",
      "SpO2 mesurée (%)",
      "number"
    ],
    [
      "o2",
      "Air / O2 : interface et débit réels",
      "text"
    ],
    [
      "temperature",
      "Température mesurée / méthode",
      "text"
    ],
    [
      "evolution",
      "Évolution / consigne / réponse après intervention",
      "textarea"
    ]
  ]
};

const initialForm = () => ({
  ...clinicalInitialForm(),
  RCP: { events: [] },
  TYPE: { categorie: '', commentaire: '', age_value: '', age_unit: 'ans', birth_date: '', puberty: '', weight: '', geriatric: '', pa_profile: '' },
  X: {
    hemorragie: '',
    hemorragie_sites: [],
    garrot_pose: '',
    garrot_heure: '',
  },
  A: { airway_free: '', liberation_effectuee: '', trauma: '', collier_pose: '' },
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
    o2_pressure: '',
    o2_debit: '',
    o2_debit_auto: false,
    o2_proposal: '',
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
  normalized.RCP.events = normalizeRcpEvents(raw.RCP?.events);
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
  normalized.A.airway_free = raw.A?.airway_free ?? raw.A?.obstruction ?? '';
  if (normalized.A.airway_free !== 'non') normalized.A.liberation_effectuee = '';
  if (!raw.D?.glycemie_unit && raw.D?.glycemie) {
    normalized.D.glycemie_unit = detectLegacyGlycemieUnit(raw.D.glycemie);
  }
  normalized.SURVEILLANCE.releves = Array.isArray(raw.SURVEILLANCE?.releves)
    ? raw.SURVEILLANCE.releves.map((reading) => ({
        ...reading,
        glycemie_unit:
          reading?.glycemie_unit ||
          (reading?.glycemie ? detectLegacyGlycemieUnit(reading.glycemie) : 'mg/dL'),
        glycemie_unit_inferred: reading?.glycemie_unit_inferred || (!reading?.glycemie_unit && !!reading?.glycemie),
      }))
    : [];
  return normalizeClinicalData(normalized, raw);
}

function isPristineForm(data) {
  return JSON.stringify(normalizeFormData(data)) === JSON.stringify(initialForm());
}

const emptySurveillanceDraft = () => ({
  heure: currentTimeString(),
  date_local: toLocalDateTime().slice(0, 10),
  results: {}, o2_interface: '', o2_debit: '', evolution: '', phase: '', gcs_y: '', gcs_v: '', gcs_m: '',
  fr: '',
  fc: '',
  spo2: '',
  spo2_mode: 'air',
  pa_sys: '',
  pa_dia: '',
  temperature: '',
  glycemie: '',
  glycemie_unit: 'mg/dL',
  conscience: '',
  eva: '',
});

function formatSurveillanceReading(reading) {
  const result = (key, suffix) => {
    const state = reading.results?.[key];
    if (state?.status && state.status !== 'valeur') return `${key}: ${state.status}${state.reason ? ` (${state.reason})` : ''}`;
    return hasValue(reading[key]) ? `${key}: ${reading[key]}${suffix}` : null;
  };
  const gcs = gcsTotal(reading);
  return [reading.observedAt ? `Mesuré ${new Date(reading.observedAt).toLocaleString('fr-FR')}` : `${reading.heure || '?'} (date de mesure non confirmée)`,
    result('fr', '/min'), result('fc', '/min'), result('spo2', `% ${reading.spo2_mode === 'o2' ? `O2 ${reading.o2_interface || '?'} ${reading.o2_debit || '?'} L/min` : 'air'}`),
    hasValue(reading.pa_sys) || hasValue(reading.pa_dia) ? `PA ${reading.pa_sys || '?'}/${reading.pa_dia || '?'} mmHg` : null,
    result('pa_sys', ' mmHg'), result('pa_dia', ' mmHg'), result('temperature', ` °C ${reading.temperature_site || ''} ${reading.temperature_method || ''}`), result('glycemie', ` ${reading.glycemie_unit || 'unité inconnue'}${reading.glycemie_unit_inferred ? ' (unité héritée à confirmer)' : ''}`),
    reading.conscience && `Conscience: ${['A', 'V', 'P', 'U'].includes(reading.conscience) ? `AVPU ${reading.conscience}` : `ancien oui/non: ${reading.conscience}`}`,
    hasValue(reading.eva) && `EN ${reading.eva}/10`, (reading.gcs_y || reading.gcs_v || reading.gcs_m) && `GCS Y${reading.gcs_y || '?'} V${reading.gcs_v || '?'} M${reading.gcs_m || '?'} = ${gcs ?? 'NT'}`,
    reading.phase, reading.evolution && `Évolution: ${reading.evolution}`, reading.pa_warning].filter(Boolean).join(' — ');
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
  const comparable = (key) => (!reading.results?.[key]?.status || reading.results[key].status === 'valeur') && (!previous.results?.[key]?.status || previous.results[key].status === 'valeur');
  if (comparable('fr')) add('FR', signedDelta(reading.fr, previous.fr));
  if (comparable('fc')) add('FC', signedDelta(reading.fc, previous.fc));
  if (comparable('spo2') && reading.spo2_mode === previous.spo2_mode && reading.o2_interface === previous.o2_interface && reading.o2_debit === previous.o2_debit) add('SpO2', signedDelta(reading.spo2, previous.spo2));
  if (comparable('pa_sys')) add('PAS', signedDelta(reading.pa_sys, previous.pa_sys));
  if (comparable('pa_dia')) add('PAD', signedDelta(reading.pa_dia, previous.pa_dia));
  if (comparable('temperature') && reading.temperature_site === previous.temperature_site && reading.temperature_method === previous.temperature_method) add('T°', signedDelta(reading.temperature, previous.temperature, 1));
  if (reading.glycemie && previous.glycemie && (!reading.results?.glycemie?.status || reading.results.glycemie.status === 'valeur') && (!previous.results?.glycemie?.status || previous.results.glycemie.status === 'valeur')) {
    const currentGly = glycemieToGL(reading.glycemie, reading.glycemie_unit);
    const previousGly = glycemieToGL(previous.glycemie, previous.glycemie_unit);
    add('Gly', signedDelta(currentGly, previousGly, 2));
  }
  add('EN', signedDelta(reading.eva, previous.eva));
  return parts.join(' · ');
}

function surveillanceElapsedLabel(reading, previous) {
  if (!previous || !reading.observedAt || !previous.observedAt) return 'intervalle non confirmé';
  const delta = Date.parse(reading.observedAt) - Date.parse(previous.observedAt);
  return Number.isFinite(delta) ? `${delta < 0 ? '−' : '+'}${Math.abs(Math.round(delta / 60000))} min` : 'intervalle non confirmé';
}

function formatO2Session(session) {
  const interfaceLabel = O2_INTERFACE_OPTIONS.find((option) => option.value === session.interface)?.label;
  return [
    `${session.start_iso || session.start_time || '?'} → ${session.end_iso || session.end_time || 'en cours'}`,
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
function getAbnormalDirectionPure(data, field, rawValue, context = {}) {
  const page = field === 'fr' || field === 'spo2' ? 'B' : field === 'fc' || field === 'pa_sys' ? 'C' : field === 'glycemie' ? 'D' : 'E';
  const rawField = context.rawField || field;
  const status = context.status ?? data.META?.assessments?.[`${page}.${rawField}`]?.status;
  if (status && status !== 'valeur') return null;
  const num = field === 'glycemie' ? glycemieToGL(rawValue, context.unit || data.D?.glycemie_unit) : numberValue(rawValue);
  if (!Number.isFinite(num)) return null;
  if (['fr', 'fc'].includes(field) && num === 0) return 'low';
  if (field === 'glycemie' && ageContext(data).category !== 'nouveau_ne' && data.TYPE?.birth_context !== 'naissance' && num < 0.7) return 'low';
  const range = referenceRange(data, field, context);
  if (!range) return null;
  if (num < range[0]) return 'low';
  if (num > range[1]) return 'high';
  return null;
}

// Repère des éléments qui nécessitent l'attention de l'équipier. Il s'agit d'alertes
// documentaires, pas de diagnostics : une anomalie isolée reste visible et aucune
// absence d'alerte ne permet de conclure à l'absence de détresse.
function computeAlertSummary(data) {
  data = maskAssessmentValues(data);
  const results = [];
  const hasReal = (arr, noneValue) => (arr || []).some((v) => v !== noneValue);
  const add = (page, label, reasons) => {
    const details = reasons.filter(Boolean);
    if (details.length > 0) results.push({ page, label, details });
  };

  add('A', 'Voies aériennes', [
    data.A.airway_free === 'non' && 'liberté des voies aériennes : non',
    data.A.airway_free === 'non' &&
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
    getAbnormalDirectionPure(data, 'spo2', data.B.spo2_air, { mode: 'air', rawField: 'spo2_air' }) !== null &&
      `SpO2 ${data.B.spo2_air}% sous air hors seuil`,
    getAbnormalDirectionPure(data, 'spo2', data.B.spo2_o2, { mode: 'o2', rawField: 'spo2_o2' }) !== null &&
      `SpO2 ${data.B.spo2_o2}% sous O2 hors seuil`,
    hasReal(data.B.fr_signes, 'aucun') && 'signe(s) respiratoire(s) associé(s)',
    data.B.fr_ample === 'non' && 'amplitude non ample',
    data.B.fr_reguliere === 'non' && 'respiration irrégulière',
    o2AtReserve && `pression O2 au seuil de réserve ou en dessous (${o2Threshold} bars)`,
  ]);

  const paAnormale =
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_gauche_sys, { rawField: 'pa_gauche_sys' }) !== null ||
    getAbnormalDirectionPure(data, 'pa_sys', data.C.pa_droite_sys, { rawField: 'pa_droite_sys' }) !== null;
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

  const surveillanceReasons = [];
  (data.SURVEILLANCE?.releves || []).forEach((reading) => {
    const outOfRange = (field, rawValue) => getAbnormalDirectionPure(data, field, rawValue, {
      mode: reading.spo2_mode, unit: reading.glycemie_unit, status: reading.results?.[field]?.status || 'valeur',
    }) !== null;
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

  return [...results, ...clinicalAlerts(data)];
}

// Éléments rapportés dans le bilan qui ne constituent pas, à eux seuls, la preuve
// d'une détresse physiologique (un mécanisme ou une circonstance n'est pas une
// détresse confirmée) — affichés séparément comme repères pour la transmission.
function computeRemarkableElements(data) {
  const results = [];
  if (data.X.hemorragie === 'oui') results.push('Hémorragie rapportée');
  if (data.A.trauma === 'oui') results.push('Mécanisme traumatique rapporté');
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
  const pairAssessed = (value, id) => {
    if (hasValue(value) && (!Array.isArray(value) || value.length)) return true;
    if (!id) return false;
    const page = id.split('_')[0], field = id.slice(page.length + 1);
    const entry = data.META?.assessments?.[`${page}.${field}`];
    return ['absent', 'LO', 'HI', 'non_realise'].includes(entry?.status) ||
      (['impossible', 'non_applicable', 'non_mesurable', 'non_fiable'].includes(entry?.status) && !!entry.reason);
  };
  const missingLabels = (pairs) => pairs.filter(([, value, id]) => !pairAssessed(value, id)).map(([label]) => label);
  const firstMissingField = (pairs) => {
    const hit = pairs.find(([, value, id]) => !pairAssessed(value, id));
    return hit ? hit[2] : null;
  };

  if (!ageContext(data).category) add('TYPE', 'Catégorie de victime non renseignée', 'TYPE_categorie');

  const xPairs = [
    ['hémorragie', data.X?.hemorragie, 'X_hemorragie'],
  ];
  const xMissing = missingLabels(xPairs);
  if (xMissing.length) add('X', `X non évalué : ${xMissing.join(', ')}`, firstMissingField(xPairs));

  const aPairs = [
    ['liberté des voies aériennes', data.A?.airway_free, 'A_obstruction'],
    ['traumatisme', data.A?.trauma, 'A_trauma'],
  ];
  const aMissing = missingLabels(aPairs);
  if (data.A?.airway_free === 'non' && !data.A?.liberation_effectuee) {
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
    ['B', 'FR', data.B?.fr, 0, 300],
    ['B', 'SpO2 sous air', data.B?.spo2_air, 1, 100],
    ['B', 'SpO2 sous O2', data.B?.spo2_o2, 1, 100],
    ['B', 'Pression O2', data.B?.o2_pressure, 1, 300],
    ['B', 'Débit O2', data.B?.o2_debit, 0.1, 100],
    ['C', 'FC', data.C?.fc, 0, 500],
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
  if (data.D?.glycemie && !['LO', 'HI'].includes(data.META?.assessments?.['D.glycemie']?.status) && !isPositiveNumber(data.D.glycemie)) add('D', 'Glycémie : valeur invalide');

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
      [reading.fr, 0, Infinity],
      [reading.fc, 0, Infinity],
      [reading.spo2, 1, 100],
      [reading.pa_sys, 0, Infinity],
      [reading.pa_dia, 0, Infinity],
      [reading.temperature, -Infinity, Infinity],
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
    if (reading.glycemie && !['LO', 'HI'].includes(reading.results?.glycemie?.status) && !isPositiveNumber(reading.glycemie)) add('SURVEILLANCE', `${prefix} : glycémie invalide`);
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

  return clinicalMissingChecks(data, items);
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
  const meaningful = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => !['ruleset', 'schema', 'age_unit', 'glycemie_unit', 'o2_bottle_size', 'cooling_timer_min'].includes(key) && meaningful(item));
    return value !== false && value !== '' && value !== null && value !== undefined;
  };
  return meaningful(data[page]);
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

  if (data.A.collier_pose === 'oui') {
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
  const result = data.META?.assessments?.[`${page}.${field}`];
  return result?.status && result.status !== 'valeur' ? result.status : data[page]?.[field];
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
  if (entry.s !== '') sParts.push(`EN ${entry.s}/10`);
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
  const lines = buildRcpLines(data.RCP);
  const missingInfo = computeMissingInfo(data);
  if (missingInfo.length > 0) {
    lines.push('⚠ À COMPLÉTER AVANT TRANSMISSION');
    missingInfo.forEach((item) => lines.push(`  ${item}`));
    lines.push('');
  }
  if (data.TYPE && data.TYPE.categorie) {
    lines.push(`Catégorie : ${PATIENT_CATEGORIES[ageContext(data).category]?.label || 'âge à préciser'}`);
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
  lines.push(...clinicalSummaryLines(data));
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
    .replace(/[—–−]/g, '-')
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
  return prepareSms(form, patientNum, recordedAt).text;
}

function sendBilanBySms(form, patientNum, recordedAt) {
  const text = buildCompactSms(form, patientNum, recordedAt);
  const url = `sms:?body=${encodeURIComponent(text)}`;
  window.open(url, '_system');
}

function ExportButtons({ form, patientNum, recordedAt, rcpOnly = false }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [smsPreview, setSmsPreview] = useState(false);

  const confirmIncompleteExport = () => {
    if (rcpOnly) return true;
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
      setSmsPreview(true);
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
      {smsPreview && <SmsPreview data={form} patientNum={patientNum} recordedAt={recordedAt} onClose={() => setSmsPreview(false)} />}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

function getTransmissionHighlights(data) {
  data = maskAssessmentValues(data);
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

  // Douleur et EN maximale
  const highEva = (data.SAMPLER?.pqrst_list || [])
    .filter((p) => p.s !== '' && !Number.isNaN(Number(p.s)))
    .sort((a, b) => Number(b.s) - Number(a.s))[0];
  if (highEva) items.push(`${highEva.title || 'Douleur'} — EN ${highEva.s}/10`);

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
      {(data.RCP?.events || []).length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Compte rendu RCP">
          <h2 className="text-lg font-bold">RCP — Arrêt cardiaque</h2>
          <RcpSummary rcp={data.RCP} />
          <RcpHistory rcp={data.RCP} />
        </section>
      )}
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
                {PATIENT_CATEGORIES[ageContext(data).category]?.label || 'âge à préciser'}
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
      <ClinicalSummary data={data} />
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
  const [appMode, setAppMode] = useState(null);
  const [form, setForm] = useState(initialForm());
  const [patientNum, setPatientNum] = useState(1);
  const [currentRecordId, setCurrentRecordId] = useState(null);
  const [currentRecordTimestamp, setCurrentRecordTimestamp] = useState(null);
  const [saved, setSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState('');
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
  const rcpTapRef = useRef(null);
  const rcpEventsRef = useRef(form.RCP.events);
  rcpEventsRef.current = form.RCP.events;

  const frTimer = useCountdown(60);
  const fcTimer = useCountdown(60);
  const coolingMinutes = parseFloat(String(form.BRULURE.cooling_timer_min).replace(',', '.')) || 20;
  const coolingTimer = useCountdown(Math.max(1, Math.round(coolingMinutes * 60)));
  const mainRef = useRef(null);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [step, appMode]);

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

  // Chaque changement remplace le même brouillon : écriture immédiate pour la RCP,
  // différée pour le formulaire seul. Un bilan enregistré n'est plus conservé
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
    const persistDraft = async () => {
      try {
        const draft = {
          schemaVersion: DRAFT_SCHEMA_VERSION,
          updatedAt: Date.now(),
          patientNum,
          currentRecordId,
          currentRecordTimestamp,
          step,
          stepPage: STEPS[step],
          appMode,
          bilanStartedAt: bilanStartRef.current,
          form,
        };
        await storage.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        setAutosaveStatus('saved');
      } catch (error) {
        console.error('Erreur de sauvegarde automatique du brouillon', error);
        setAutosaveStatus('error');
      }
    };
    // Les événements RCP sont conservés sans attendre le délai du formulaire.
    if (form.RCP.events.length > 0) persistDraft();
    else autosaveTimerRef.current = setTimeout(persistDraft, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [form, patientNum, currentRecordId, currentRecordTimestamp, step, appMode, saved, draftChecked, draftCandidate]);

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
        o2_start_iso: new Date(now).toISOString(), o2_start_local: toLocalDateTime(new Date(now)),
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
        start_iso: f.B.o2_start_iso || (f.B.o2_started_at_ms ? new Date(f.B.o2_started_at_ms).toISOString() : null),
        end_iso: new Date(now).toISOString(),
        target: oxygenTarget(f), consign: f.B.clinical?.o2_consign, tolerance: f.B.clinical?.o2_tolerance,
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
          o2_start_iso: null, o2_start_local: '', o2_proposal: '',
          o2_start_time: '',
          o2_started_at_ms: null,
          o2_bottle_size: '5',
          o2_pressure: '',
          o2_debit: '',
          o2_debit_auto: false,
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
        f.A.trauma === 'oui' && 'traumatisme',
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
  }, [form.A.trauma, form.BRULURE.brulure]);

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
        : LEGACY_STEPS_V5[legacyStep]);
    const savedStepIndex = STEPS.indexOf(savedStepPage);
    setStep(savedStepIndex >= 0 ? savedStepIndex : 0);
    setAppMode(draftCandidate.appMode === 'rcp' ? 'rcp' : 'bilan');
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
    setAppMode(null);
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
      const nextPage = { ...f[page], [field]: typeof value === 'function' ? value(f[page]?.[field]) : value };
      if (page === 'A' && field === 'airway_free' && value !== 'non') {
        nextPage.liberation_effectuee = '';
      }
      const now = new Date().toISOString();
      let meta = { ...f.META, referenceAt: f.META?.referenceAt || now };
      if ((MEASUREMENT_FIELDS[page] || []).includes(field) || (PAGE_FIELDS[page] || []).includes(field)) {
        const key = `${page}.${field}`;
        meta = { ...meta, assessments: { ...meta.assessments, [key]: { ...meta.assessments?.[key], status: hasValue(nextPage[field]) ? 'valeur' : '', recordedAt: now, observedAt: null, observed_local: '' } } };
      }
      if (page === 'D' && field === 'glycemie_unit') nextPage.glycemie_unit_inferred = false;
      if (page === 'A' && field === 'airway_free') nextPage.obstruction = value; // compatibilité lecture ancienne
      if (page === 'TYPE' && field === 'categorie') nextPage.legacy_age_uncertain = false;
      let next = { ...f, [page]: nextPage, META: page === 'META' ? nextPage : meta };
      if (['X', 'E'].includes(page) && field.includes('garrot')) next = { ...next, LESIONS: { ...next.LESIONS, hemorrhages: legacyTourniquets(next, page) } };
      return next;
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
    setEditingReadingId(null);
    setSurveillanceDraft({ ...emptySurveillanceDraft(), spo2_mode: form.B.o2_active === 'oui' ? 'o2' : 'air',
      o2_interface: form.B.o2_active === 'oui' ? form.B.o2_interface : '',
      o2_debit: form.B.o2_active === 'oui' ? form.B.o2_debit : '' });
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
    setSurveillanceDraft((draft) => ({ ...draft, [field]: value, ...(field === 'glycemie_unit' ? { glycemie_unit_inferred: false } : {}) }));
    if (surveillanceError) setSurveillanceError('');
  }

  function addSurveillanceReading() {
    const draft = surveillanceDraft;
    const hasMeasurement = ['fr', 'fc', 'spo2', 'pa_sys', 'pa_dia', 'temperature', 'glycemie', 'conscience', 'eva', 'gcs_y', 'gcs_v', 'gcs_m'].some(
      (field) => hasValue(draft[field])
    ) || Object.values(draft.results || {}).some((e) => e.status && e.status !== 'valeur') || !!draft.evolution;
    if (!hasMeasurement) {
      setSurveillanceError('Renseigne au moins une constante avant d’ajouter le relevé.');
      return;
    }
    const observedAt = dateTimeISO(`${draft.date_local}T${draft.heure}`);
    const invalid =
      !observedAt || !isValidTime(draft.heure) ||
      !isNumberInRange(draft.fr, 0, Infinity) ||
      !isNumberInRange(draft.fc, 0, Infinity) ||
      !isNumberInRange(draft.spo2, 1, 100) ||
      !isNumberInRange(draft.pa_sys, 0, Infinity) ||
      !isNumberInRange(draft.pa_dia, 0, Infinity) ||
      (hasValue(draft.temperature) && !Number.isFinite(numberValue(draft.temperature))) ||
      (!!draft.glycemie && !['LO', 'HI'].includes(draft.results?.glycemie?.status) && !isPositiveNumber(draft.glycemie));
    const paSys = Number(String(draft.pa_sys).replace(',', '.'));
    const paDia = Number(String(draft.pa_dia).replace(',', '.'));
    const paIncoherent =
      !!draft.pa_sys && !!draft.pa_dia && Number.isFinite(paSys) && Number.isFinite(paDia) && paDia >= paSys;
    if (invalid) {
      setSurveillanceError('Corrige les saisies signalées avant d’ajouter le relevé.');
      return;
    }
    if (paIncoherent) draft.pa_warning = 'PA incohérente : diastolique supérieure ou égale à systolique, résultat à vérifier';
    const existingReadings = form.SURVEILLANCE?.releves || [];
    const duplicateHeure = existingReadings.some(
      (r) => r.observedAt === observedAt && r.id !== editingReadingId
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
            r.id === editingReadingId ? { ...draft, observedAt, legacy_time_unknown: false, updatedAt: new Date().toISOString(), id: editingReadingId, createdAt: r.createdAt } : r
          ),
        },
      }));
      setEditingReadingId(null);
    } else {
      const reading = { ...draft, observedAt, legacy_time_unknown: false, id: `surv_${Date.now()}`, createdAt: Date.now() }; 
      if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
      setForm((f) => ({
        ...f,
        SURVEILLANCE: {
          ...(f.SURVEILLANCE || {}),
          releves: [...(f.SURVEILLANCE?.releves || []), reading].sort((a, b) => a.observedAt && b.observedAt ? Date.parse(a.observedAt) - Date.parse(b.observedAt) : 0),
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
  function getAbnormalDirection(field, rawValue, context = {}) {
    return getAbnormalDirectionPure(form, field, rawValue, { ...context });
  }

  function isAbnormalField(field, rawValue, context = {}) {
    return getAbnormalDirection(field, rawValue, context) !== null;
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

  function commitRcpEvents(events) {
    const nextForm = { ...form, RCP: { ...form.RCP, events } };
    rcpEventsRef.current = events;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setForm(nextForm);
    setSaved(false);
    setSavedAt(null);
    setSaveError('');
    // Écriture synchrone au clic : une mise en arrière-plan immédiate ne doit pas
    // attendre un effet React ou le délai d'autosauvegarde du bilan.
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        schemaVersion: DRAFT_SCHEMA_VERSION,
        updatedAt: Date.now(),
        patientNum,
        currentRecordId,
        currentRecordTimestamp,
        step,
        stepPage: STEPS[step],
        appMode: 'rcp',
        bilanStartedAt: bilanStartRef.current,
        form: nextForm,
      }));
      setAutosaveStatus('saved');
    } catch (error) {
      console.error('Erreur de sauvegarde RCP', error);
      setAutosaveStatus('error');
    }
  }

  function recordRcpEvent(type, note = '') {
    if (!RCP_EVENT_LABELS[type] || !draftChecked || draftCandidate) return;
    const events = rcpEventsRef.current;
    if (['start', 'dsa'].includes(type) && events.some((event) => event.type === type && !event.cancelledAt)) return;
    const tapTime = performance.now();
    if (rcpTapRef.current?.type === type && tapTime - rcpTapRef.current.at < 700) return;
    rcpTapRef.current = { type, at: tapTime };
    const now = new Date();
    const timestamp = now.getTime();
    if (bilanStartRef.current === null) bilanStartRef.current = timestamp;
    commitRcpEvents([...events, {
      id: `rcp-${timestamp}-${events.length}`,
      type,
      timestamp,
      localTime: formatRcpTime(timestamp),
      localDate: now.toLocaleDateString('fr-FR'),
      timezoneOffset: now.getTimezoneOffset(),
      observedAt: now.toISOString(), note,
    }]);
  }

  function undoLastRcpEvent() {
    const event = [...rcpEventsRef.current].reverse().find((item) => !item.cancelledAt);
    if (!event || !window.confirm(`Annuler « ${RCP_EVENT_LABELS[event.type]} » à ${event.localTime || formatRcpTime(event.timestamp)} ? La trace restera dans l'historique.`)) return;
    rcpTapRef.current = null;
    commitRcpEvents(rcpEventsRef.current.map((item) => item.id === event.id ? { ...item, cancelledAt: Date.now() } : item));
  }

  async function saveBilan() {
    setSaveError('');
    const missingCount = appMode === 'rcp' ? 0 : computeMissingInfo(form).length;
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
      setSaveError('Enregistrement impossible sur cet appareil. Le bilan reste affiché ; réessayer ou exporter le compte rendu.');
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
    setSaveError('');
    frTimer.reset();
    fcTimer.reset();
    coolingTimer.reset();
    setStep(0);
    setAppMode(null);
    rcpTapRef.current = null;
    rcpEventsRef.current = [];
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
    const pediatricPatient = isPediatric(form);
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
            const active = ageContext(form).category === key;
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
          <FieldCard id="A_obstruction" label="Voies aériennes libres actuellement ?" filled={!!form.A.airway_free}>
            <ToggleGroup
              value={form.A.airway_free}
              onChange={(v) => updateField('A', 'airway_free', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard id="A_trauma" label="Victime traumatisée" filled={!!form.A.trauma}>
            <ToggleGroup
              value={form.A.trauma}
              onChange={(v) => {
                updateField('A', 'trauma', v);
                if (v !== 'oui') {
                  updateField('A', 'collier_pose', '');
                  updateField('C', 'blood_box', []);
                }
              }}
              options={OUI_NON}
            />
            <span className="text-xs text-neutral-600 italic mt-1.5 block">
              En cas de doute, appliquer le protocole de ton service et documenter le contexte.
            </span>
          </FieldCard>
          {form.A.trauma === 'oui' && (
            <FieldCard label="Pose collier" filled={!!form.A.collier_pose}>
              <ToggleGroup
                value={form.A.collier_pose}
                onChange={(v) => updateField('A', 'collier_pose', v)}
                options={OUI_NON}
              />
            </FieldCard>
          )}
          {form.A.airway_free === 'non' && (
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
              abnormal={isAbnormalField('spo2', form.B.spo2_air, { mode: 'air', rawField: 'spo2_air' })}
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
                    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
                    setForm((f) => {
                      const shouldUpdateDebit =
                        !f.B.o2_debit && !!O2_INTERFACE_DEFAULT_DEBIT[v];
                      return {
                        ...f,
                        B: {
                          ...f.B,
                          o2_interface: v,
                          ...(shouldUpdateDebit
                            ? { o2_proposal: O2_INTERFACE_DEFAULT_DEBIT[v], o2_debit_auto: false }
                            : { o2_proposal: '' }),
                        },
                      };
                    });
                    if (saved) setSaved(false);
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
                  abnormal={isAbnormalField('spo2', form.B.spo2_o2, { mode: 'o2', rawField: 'spo2_o2' })}
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
                  onChange={(v) => {
                    setForm((f) => ({ ...f, B: { ...f.B, o2_debit: v, o2_debit_auto: false, o2_proposal: '' } }));
                    if (bilanStartRef.current === null) bilanStartRef.current = Date.now();
                    if (saved) setSaved(false);
                  }}
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
                  abnormal={isAbnormalField('pa_sys', form.C.pa_gauche_sys, { rawField: 'pa_gauche_sys' })}
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
                  abnormal={isAbnormalField('pa_sys', form.C.pa_droite_sys, { rawField: 'pa_droite_sys' })}
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
          {form.A.trauma === 'oui' && (
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
          <button
            type="button"
            onClick={() => setStep(STEPS.indexOf('FAST'))}
            className="w-full py-3 rounded-md font-bold text-sm uppercase tracking-wide text-white"
            style={{ backgroundColor: '#DC2626' }}
          >
            Aller à FAST
          </button>
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
                  Constantes du bilan : repères selon l’âge et le contexte
                </span>
                <RefConstRow
                  label="Température"
                  value={form.E.temperature}
                  unit="°C"
                  isAbnormal={(v) => isAbnormalField('temperature', v)}
                />
                <RefConstRow
                  label="Fréquence respiratoire"
                  value={form.B.fr}
                  unit="/min"
                  isAbnormal={(v) => isAbnormalField('fr', v)}
                />
                <RefConstRow
                  label="SpO2"
                  value={form.B.spo2_air}
                  unit="%"
                  isAbnormal={(v) => isAbnormalField('spo2', v, { mode: 'air', rawField: 'spo2_air' })}
                />
                <RefConstRow
                  label="Fréquence cardiaque"
                  value={form.C.fc}
                  unit="/min"
                  isAbnormal={(v) => isAbnormalField('fc', v)}
                />
                <RefConstRow
                  label="Tension systolique"
                  value={form.C.pa_gauche_sys || form.C.pa_droite_sys}
                  unit="mmHg"
                  isAbnormal={(v) => isAbnormalField('pa_sys', v)}
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
                            updateField('BRULURE', 'zone_fractions', Object.fromEntries(zones.map((id) => [id, form.BRULURE.zone_fractions?.[id] ?? ''])));
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
                          Étendue évaluée : résultat et méthode à confirmer
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
                <span className="text-xs text-neutral-500">EN 0–10</span>
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
              Surveillance continue selon l’état clinique
            </div>
            <p className="text-sm text-neutral-300 leading-relaxed mt-1">
              Documente les nouvelles mesures et l’évolution clinique avant / pendant le transport et après les gestes. Les relevés précédents restent consultables.
            </p>
          </div>
          <button
            type="button"
            onClick={prefillSurveillanceDraft}
            className="self-start text-xs font-semibold uppercase tracking-wide px-3 py-2 rounded-md border border-neutral-700 text-neutral-200"
          >
            Nouveau relevé vide (mesures à refaire)
          </button>

          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex flex-col gap-4">
            <SurveillanceContextFields draft={surveillanceDraft} update={updateSurveillanceDraft} />
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
                <InputBox value={surveillanceDraft.fr} onChange={(v) => updateSurveillanceDraft('fr', v)} invalid={!isNumberInRange(surveillanceDraft.fr, 0, 300)} unit="/min" numeric />
              </div>
              <div>
                <span className="text-xs text-neutral-500">FC</span>
                <InputBox value={surveillanceDraft.fc} onChange={(v) => updateSurveillanceDraft('fc', v)} invalid={!isNumberInRange(surveillanceDraft.fc, 0, 500)} unit="/min" numeric />
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
              <div>
                <span className="text-xs text-neutral-500">Victime consciente</span>
                <ToggleGroup value={surveillanceDraft.conscience} onChange={(v) => updateSurveillanceDraft('conscience', v)} options={AVPU_OPTIONS} />
              </div>
              <div>
                <span className="text-xs text-neutral-500">EN</span>
                <ToggleGroup value={surveillanceDraft.eva} onChange={(v) => updateSurveillanceDraft('eva', v)} options={EVA_OPTIONS} />
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
              {appMode === 'rcp' ? 'Bilan de l’équipier · Journal RCP' : 'Bilan de l’équipier · Protocole ABCDE'}
            </div>
            <div className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              Bilan n°{patientNum}
              {form.TYPE.categorie && (
                <span className="text-sm font-normal text-neutral-500">
                  {' '}
                  · {PATIENT_CATEGORIES[ageContext(form).category]?.label || 'âge à préciser'}
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
        {saveError && <p role="alert" className="text-sm text-red-400">{saveError}</p>}
        {appMode && (
          <nav className="flex gap-2" aria-label="Mode de prise en charge">
            <button type="button" onClick={() => setAppMode('rcp')} aria-pressed={appMode === 'rcp'}
              className="flex-1 py-2 rounded-lg text-sm font-bold border"
              style={{ backgroundColor: appMode === 'rcp' ? ACCENT : '#171717', borderColor: appMode === 'rcp' ? ACCENT : '#404040' }}>RCP</button>
            <button type="button" onClick={() => setAppMode('bilan')} aria-pressed={appMode === 'bilan'}
              className="flex-1 py-2 rounded-lg text-sm font-bold border"
              style={{ backgroundColor: appMode === 'bilan' ? ACCENT : '#171717', borderColor: appMode === 'bilan' ? ACCENT : '#404040' }}>Bilan</button>
          </nav>
        )}
        {appMode === 'bilan' && <>
        <nav className="flex flex-wrap gap-2" aria-label="Accès rapide bilan"><button type="button" onClick={() => setStep(STEPS.indexOf('PRIMAIRE'))} className="border border-neutral-700 rounded px-2 py-1 text-xs">Primaire</button><button type="button" onClick={openFollowUp} className="border border-neutral-700 rounded px-2 py-1 text-xs">Réévaluer</button><button type="button" onClick={returnToRecap} className="border border-neutral-700 rounded px-2 py-1 text-xs">Transmission</button></nav>
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
            ? 'Surveillance continue selon l’état clinique'
            : `Étape ${step + 1}/${STEPS.indexOf('RECAP') + 1}`}{' '}
          ·{' '}
          <span className="text-neutral-100 font-semibold">
            {PAGE_TITLES[STEPS[step]] || STEPS[step]}
          </span>
        </div>
        </>}
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!appMode ? (
          <div className="w-full max-w-lg mx-auto flex flex-col gap-4 py-6">
            <h1 className="text-2xl font-bold text-center">Prise en charge</h1>
            <p className="text-sm text-neutral-400 text-center">Choisir le mode pour cette victime</p>
            <button type="button" onClick={() => setAppMode('rcp')} disabled={!draftChecked || loadingHistory}
              className="w-full rounded-xl p-6 text-left text-white disabled:opacity-50" style={{ backgroundColor: ACCENT, minHeight: 120 }}>
              <span className="block text-3xl font-bold">RCP</span>
              <span className="block text-sm mt-2">Arrêt cardiaque · Massage, DSA, chocs et cycles</span>
            </button>
            <button type="button" onClick={() => setAppMode('bilan')} disabled={!draftChecked || loadingHistory}
              className="w-full rounded-xl border border-neutral-600 bg-neutral-900 p-6 text-left disabled:opacity-50" style={{ minHeight: 120 }}>
              <span className="block text-3xl font-bold">Bilan</span>
              <span className="block text-sm text-neutral-300 mt-2">Ouvrir le bilan complet de l’équipier</span>
            </button>
          </div>
        ) : appMode === 'rcp' ? (
          <div className="w-full max-w-2xl mx-auto flex flex-col gap-4">
            <RcpPanel rcp={form.RCP} onRecord={recordRcpEvent} onUndo={undoLastRcpEvent} ready={draftChecked && !draftCandidate && !loadingHistory} />
            <ClinicalExtension data={form} page="RCP_CONTEXT" update={updateField} patientNum={patientNum} />
            {form.RCP.events.length > 0 && <>
              {saved ? (
                <p className="text-sm font-semibold" style={{ color: EMERALD }}>✓ Bilan n°{patientNum} enregistré à {savedAt}</p>
              ) : (
                <button type="button" onClick={saveBilan} className="w-full flex items-center justify-center gap-2 rounded-lg py-3 font-semibold text-white" style={{ backgroundColor: ACCENT }}>
                  <Save size={16} /> Enregistrer le compte rendu
                </button>
              )}
              <ExportButtons form={form} patientNum={patientNum} recordedAt={currentRecordTimestamp || bilanStartRef.current || Date.now()} rcpOnly />
              <button type="button" onClick={newBilan} className="w-full rounded-lg border border-neutral-700 py-3 text-sm text-neutral-300">Nouvelle victime</button>
            </>}
          </div>
        ) : <>
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
          <ClinicalExtension data={form} page={STEPS[step]} update={updateField} patientNum={patientNum} />
        </div>
        </>}
      </main>

      {appMode === 'bilan' && <footer
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
              Réévaluer selon l’état clinique, avant et pendant le transport ; sans intervalle universel imposé.
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
                : 'Ajouter une réévaluation'}
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
      </footer>}

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

// Journal documentaire RCP : les actions et les cycles sont saisis manuellement.
const RCP_EVENT_LABELS = {
  start: 'Début du massage cardiaque',
  dsa: 'Pose du DSA',
  shock: 'Choc délivré',
  cycle: 'Cycle effectué',
  witness: 'Début des gestes du témoin constaté',
  ventilation: 'Début de ventilation',
  electrodes: 'Électrodes posées',
  analysis: 'Analyse DSA',
  recommended: 'Choc recommandé',
  not_recommended: 'Choc non recommandé',
  interruption: 'Interruption (motif à renseigner)',
  resume: 'Reprise des compressions',
  rosc: 'RACS constaté',
  rearrest: 'Nouvel arrêt',
};

function normalizeRcpEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => event && Object.prototype.hasOwnProperty.call(RCP_EVENT_LABELS, event.type)
    && Number.isFinite(event.timestamp) && event.timestamp > 0);
}

function formatRcpTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function getRcpStats(rcp) {
  const events = normalizeRcpEvents(rcp?.events).filter((event) => !event.cancelledAt);
  return {
    events,
    start: events.find((event) => event.type === 'start'),
    dsa: events.find((event) => event.type === 'dsa'),
    cycles: events.filter((event) => event.type === 'cycle').length,
    shocks: events.filter((event) => event.type === 'shock').length,
  };
}

function rcpEventTime(event, withDate = false) {
  if (!event) return 'Non renseigné';
  const time = event.localTime || formatRcpTime(event.timestamp);
  return withDate ? `${event.localDate || new Date(event.timestamp).toLocaleDateString('fr-FR')} ${time}` : time;
}

function rcpElapsedLabel(event, start) {
  if (!start) return '';
  const delta = event.timestamp - start.timestamp;
  return `${delta < 0 ? '−' : '+'}${formatDuration(Math.abs(delta))}`;
}

function buildRcpLines(rcp, includeHistory = true) {
  const allEvents = normalizeRcpEvents(rcp?.events);
  if (allEvents.length === 0) return [];
  const stats = getRcpStats(rcp);
  const lines = [
    'RCP — ARRÊT CARDIAQUE',
    `  Début du massage : ${rcpEventTime(stats.start, true)}`,
    `  Pose du DSA : ${rcpEventTime(stats.dsa, true)}`,
    `  Cycles effectués : ${stats.cycles} | Chocs délivrés : ${stats.shocks}`,
  ];
  if (includeHistory) {
    lines.push('HISTORIQUE RCP — heures de l’appareil au moment du clic');
    let cycles = 0;
    let shocks = 0;
    allEvents.forEach((event) => {
      let label = RCP_EVENT_LABELS[event.type];
      if (!event.cancelledAt && event.type === 'cycle') label += ` n°${++cycles}`;
      if (!event.cancelledAt && event.type === 'shock') label += ` n°${++shocks}`;
      const cancelled = event.cancelledAt ? ` [ANNULÉ le ${new Date(event.cancelledAt).toLocaleString('fr-FR')}]` : '';
      const elapsed = rcpElapsedLabel(event, stats.start);
      lines.push(`  ${rcpEventTime(event, true)} — ${label}${elapsed ? ` (${elapsed})` : ''}${cancelled}${event.note ? ` ; ${event.note}` : ''}`);
    });
  }
  lines.push('');
  return lines;
}

function RcpClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = setInterval(refresh, 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2">
      <div>
        <div className="text-xs text-neutral-400">Heure du téléphone</div>
        <div className="text-xs text-neutral-400">{new Date(now).toLocaleDateString('fr-FR')}</div>
      </div>
      <time className="text-3xl font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>
        {formatRcpTime(now)}
      </time>
    </div>
  );
}

function RcpSummary({ rcp }) {
  const stats = getRcpStats(rcp);
  const timeCell = (label, event) => (
    <td className="w-1/2 px-2 py-3 align-top border-t border-neutral-700">
      <div className="text-xs font-semibold text-neutral-300 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'ui-monospace, monospace' }}>
        {event ? rcpEventTime(event) : '—'}
      </div>
      <div className="text-xs text-neutral-400 mt-1">{event ? (event.localDate || new Date(event.timestamp).toLocaleDateString('fr-FR')) : 'Non renseigné'}</div>
    </td>
  );
  return (
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: ACCENT, backgroundColor: '#1C1111' }}>
      <table className="w-full table-fixed text-center" aria-label="Résumé RCP">
        <caption className="text-left text-xs font-bold uppercase tracking-wide px-3 py-2 text-white" style={{ backgroundColor: ACCENT }}>
          Récapitulatif RCP
        </caption>
        <tbody>
          <tr>
            <td className="w-1/2 px-2 py-2">
              <div className="text-xs font-semibold text-neutral-200">Cycles effectués</div>
              <div data-testid="rcp-cycles" className="text-4xl font-bold tabular-nums mt-1">{stats.cycles}</div>
            </td>
            <td className="w-1/2 px-2 py-2">
              <div className="text-xs font-semibold text-neutral-200">Chocs délivrés</div>
              <div data-testid="rcp-shocks" className="text-4xl font-bold tabular-nums mt-1" style={{ color: AMBER }}>{stats.shocks}</div>
            </td>
          </tr>
          <tr>
            {timeCell('Début du massage', stats.start)}
            {timeCell('Pose du DSA', stats.dsa)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RcpHistory({ rcp }) {
  const events = normalizeRcpEvents(rcp?.events);
  const stats = getRcpStats(rcp);
  let cycleNumber = 0;
  let shockNumber = 0;
  const rows = events.map((event) => {
    let label = RCP_EVENT_LABELS[event.type];
    if (!event.cancelledAt && event.type === 'cycle') label += ` n°${++cycleNumber}`;
    if (!event.cancelledAt && event.type === 'shock') label += ` n°${++shockNumber}`;
    return { event, label };
  });
  return (
    <section aria-label="Historique des événements RCP" className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">Historique RCP · {stats.events.length} événement{stats.events.length > 1 ? 's' : ''}</h3>
      {events.length === 0 ? (
        <p className="text-sm text-neutral-400">Chaque appui enregistre l’action à l’heure du téléphone, à la seconde près.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map(({ event, label }) => (
            <li key={event.id} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
              <div className="flex justify-between gap-2 items-start">
                <span className={`text-sm font-semibold ${event.cancelledAt ? 'line-through text-neutral-500' : 'text-neutral-100'}`}>{label}</span>
                <time className="text-sm font-bold tabular-nums whitespace-nowrap" style={{ fontFamily: 'ui-monospace, monospace', color: event.cancelledAt ? '#a3a3a3' : '#fff' }}>{rcpEventTime(event)}</time>
              </div>
              <div className="flex justify-between gap-2 mt-1 text-xs text-neutral-400">
                <span>{event.localDate || new Date(event.timestamp).toLocaleDateString('fr-FR')}</span>
                <span>{rcpElapsedLabel(event, stats.start)}{stats.start ? ' / début massage' : ''}</span>
              </div>
              {event.note && <p className="text-xs text-neutral-300 mt-1 whitespace-pre-wrap">{event.note}</p>}
              {event.cancelledAt && <div className="text-xs mt-1" style={{ color: AMBER }}>Annulé · non comptabilisé</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RcpPanel({ rcp, onRecord, onUndo, ready }) {
  const [eventNote, setEventNote] = useState('');
  const stats = getRcpStats(rcp);
  const actions = [
    { type: 'start', label: 'Début du massage cardiaque', done: stats.start, color: ACCENT, text: '#fff' },
    { type: 'dsa', label: 'Pose du DSA', done: stats.dsa, color: '#164E63', text: '#fff' },
    { type: 'shock', label: 'Choc délivré', color: AMBER, text: '#171717' },
    { type: 'cycle', label: 'Cycle effectué', color: '#065F46', text: '#fff' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">RCP — Arrêt cardiaque</h1>
        <p className="text-xs text-neutral-400 mt-1">Horodatage des gestes effectués</p>
      </div>
      <RcpClock />
      <RcpSummary rcp={rcp} />
      <div className="grid grid-cols-2 gap-2" aria-label="Actions RCP">
        {actions.map(({ type, label, done, color, text }) => (
          <button key={type} type="button" onClick={() => onRecord(type)} disabled={!ready || !!done}
            className="rounded-xl px-3 py-3 text-base font-bold flex flex-col items-center justify-center gap-1 disabled:opacity-60 active:scale-95"
            style={{ backgroundColor: color, color: text, minHeight: 80, touchAction: 'manipulation' }}>
            <span>{label}</span>
            <span className="text-xs font-normal">{done ? `✓ ${rcpEventTime(done)}` : type === 'shock' || type === 'cycle' ? '+1 et heure du clic' : 'Enregistrer l’heure'}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-400">1 appui sur « Cycle effectué » = 1 cycle comptabilisé.</p>
      <label className="text-xs text-neutral-400">Précision pour le prochain événement (motif d’interruption, état au RACS…)</label>
      <input aria-label="Précision événement RCP" value={eventNote} onChange={(e) => setEventNote(e.target.value)} className="bg-neutral-950 p-2 rounded" />
      <div className="grid grid-cols-2 gap-2">{['witness', 'ventilation', 'electrodes', 'analysis', 'recommended', 'not_recommended', 'interruption', 'resume', 'rosc', 'rearrest'].map((type) => <button key={type} disabled={!ready} onClick={() => { onRecord(type, eventNote); setEventNote(''); }} className="border border-neutral-600 rounded p-3 text-xs">{RCP_EVENT_LABELS[type]}</button>)}</div>
      <p className="text-xs text-amber-300">Naissance : protocole spécifique et consigne confirmée ; aucun cycle ni choc n’est déduit automatiquement.</p>
      <RcpHistory rcp={rcp} />
      {stats.events.length > 0 && (
        <button type="button" onClick={onUndo} className="flex items-center justify-center gap-2 py-3 rounded-lg border border-neutral-700 text-sm text-neutral-300">
          <RotateCcw size={15} /> Annuler la dernière action
        </button>
      )}
    </div>
  );
}


function SurveillanceContextFields({ draft, update }) {
  const measured = ['fr', 'fc', 'spo2', 'pa_sys', 'pa_dia', 'temperature', 'glycemie'];
  return <div className="flex flex-col gap-2">
    <label className="text-xs">Date réelle du relevé</label><input aria-label="Date du relevé" type="date" value={draft.date_local || ''} onChange={(e) => update('date_local', e.target.value)} className="bg-neutral-950 p-2" />
    <label className="text-xs">Phase / circonstance</label><select aria-label="Phase de surveillance" value={draft.phase || ''} onChange={(e) => update('phase', e.target.value)} className="bg-neutral-950 p-2"><option value="">Choisir…</option>{['avant transport', 'pendant transport', 'après geste', 'à la transmission', 'aggravation', 'autre'].map((v) => <option key={v}>{v}</option>)}</select>
    <textarea aria-label="Évolution clinique" placeholder="Évolution clinique, signes, douleur, conscience, tolérance…" value={draft.evolution || ''} onChange={(e) => update('evolution', e.target.value)} className="bg-neutral-950 p-2" />
    {draft.spo2_mode === 'o2' && <><input aria-label="Interface O2 du relevé" placeholder="Interface O2 réellement utilisée" value={draft.o2_interface || ''} onChange={(e) => update('o2_interface', e.target.value)} className="bg-neutral-950 p-2" /><input aria-label="Débit O2 du relevé" placeholder="Débit réel (L/min)" value={draft.o2_debit || ''} onChange={(e) => update('o2_debit', e.target.value)} className="bg-neutral-950 p-2" /></>}
    <input aria-label="Site température du relevé" placeholder="Site de température" value={draft.temperature_site || ''} onChange={(e) => update('temperature_site', e.target.value)} className="bg-neutral-950 p-2" /><input aria-label="Méthode température du relevé" placeholder="Méthode de température" value={draft.temperature_method || ''} onChange={(e) => update('temperature_method', e.target.value)} className="bg-neutral-950 p-2" />
    <div className="flex gap-2">{[['gcs_y', 'Y', ['4', '3', '2', '1', 'NT']], ['gcs_v', 'V', ['5', '4', '3', '2', '1', 'NT']], ['gcs_m', 'M', ['6', '5', '4', '3', '2', '1', 'NT']]].map(([key, label, choices]) => <label key={key} className="text-xs">GCS {label}<select aria-label={`GCS suivi ${label}`} value={draft[key] || ''} onChange={(e) => update(key, e.target.value)} className="bg-neutral-950 p-2"><option value="">…</option>{choices.map((v) => <option key={v}>{v}</option>)}</select></label>)}</div>
    <details><summary className="text-xs text-neutral-400">Résultats non numériques / mesures impossibles</summary>{measured.map((key) => <div key={key} className="flex flex-col gap-1 mt-2"><label className="text-xs">{key}</label><select aria-label={`Résultat suivi — ${key}`} value={draft.results?.[key]?.status || ''} onChange={(e) => update('results', { ...draft.results, [key]: { ...draft.results?.[key], status: e.target.value } })} className="bg-neutral-950 p-2"><option value="">Valeur / non renseigné</option>{RESULT_OPTIONS.filter((o) => key === 'glycemie' || !['LO', 'HI'].includes(o.value)).filter((o) => ['fr', 'fc'].includes(key) || o.value !== 'absent').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select><input aria-label={`Motif suivi — ${key}`} placeholder="Motif / contexte" value={draft.results?.[key]?.reason || ''} onChange={(e) => update('results', { ...draft.results, [key]: { ...draft.results?.[key], reason: e.target.value } })} className="bg-neutral-950 p-2" /></div>)}</details>
  </div>;
}


function legacyTourniquets(data, changedPage = null) {
  let rows = [...(data.LESIONS?.hemorrhages || [])];
  for (const [page, pose, time] of [['X', 'garrot_pose', 'garrot_heure'], ['E', 'amputation_garrot', 'amputation_garrot_heure']]) {
    const id = `legacy-garrot-${page}`;
    if (data[page]?.[pose] !== 'oui') { if (changedPage === page) rows = rows.filter((row) => row.id !== id); continue; }
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0 && changedPage !== page) continue;
    const prior = index >= 0 ? rows[index] : {};
    const source = page === 'X' ? 'X' : 'amputation';
    const at = data[page]?.[time];
    const row = { ...prior, id,
      tourniquet_id: prior.tourniquet_id || { value: id, status: 'valeur' },
      origin: { value: source, status: 'valeur', source: 'champ historique' },
      technique: { value: 'garrot', status: 'valeur' },
      site: prior.site || { value: page === 'X' ? (data.X.hemorragie_sites || []).join(', ') : data.E.amputation_localisation || '', status: 'valeur' },
      at: prior.at?.value ? prior.at : { status: 'inconnu', reason: at ? `Heure isolée ${at}, date à confirmer` : 'Date et heure à renseigner', source: source },
    };
    if (index >= 0) rows[index] = row; else rows.push(row);
  }
  return rows;
}


function effectiveEntries(entries = {}) {
  return Object.fromEntries(Object.entries(entries || {}).map(([key, entry]) => [key, entry?.status && entry.status !== 'valeur' ? { ...entry, value: entry.status } : entry]));
}
function maskAssessmentValues(data) {
  let copy = { ...data };
  for (const [key, entry] of Object.entries(data.META?.assessments || {})) {
    if (!entry.status || entry.status === 'valeur') continue;
    const [page, field] = key.split('.');
    if (copy[page]) copy[page] = { ...copy[page], [field]: '' };
  }
  return copy;
}

// Fonctions pures exposées pour intégration et vérification du moteur de bilan.
export { RULESET, ageContext, referenceRange, pressureReference, oxygenTarget, selectedPa, gcsTotal, fractionalBurnArea, normalizeFormData, initialForm, getAbnormalDirectionPure, computeAlertSummary, computeMissingChecks, buildRecapLines, buildCompactSms, prepareSms, emptySurveillanceDraft, glycemieToGL, computeO2Autonomy, o2BottleThreshold };
