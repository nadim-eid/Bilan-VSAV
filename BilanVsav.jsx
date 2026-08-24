import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play, Square, Save, RotateCcw, Check, History, X, Trash2, Flashlight, FlashlightOff, FileText, MessageSquare, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Torch } from '@capawesome/capacitor-torch';
import { Filesystem, Directory } from '@capacitor/filesystem';
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
    low: { title: 'SpO2 basse', message: 'Mettre la victime sous oxygène (O2) et réévaluer la SpO2.' },
  },
  fr: {
    low: { title: 'Fréquence respiratoire basse', message: 'Surveiller étroitement, être prêt à assister la ventilation.' },
    high: { title: 'Fréquence respiratoire élevée', message: 'Rechercher une détresse respiratoire, position demi-assise, alerter le 15.' },
  },
  fc: {
    low: { title: 'Fréquence cardiaque basse', message: 'Surveillance rapprochée, alerter le médecin régulateur (15).' },
    high: { title: 'Fréquence cardiaque élevée', message: 'Surveillance rapprochée, alerter le médecin régulateur (15).' },
  },
  pa_sys: {
    low: { title: 'Tension basse', message: "Position d'attente, jambes surélevées si pas de contre-indication, alerter le 15." },
    high: { title: 'Tension élevée', message: 'Position demi-assise, surveillance, alerter le 15 si signes associés.' },
  },
  temperature: {
    low: { title: 'Hypothermie', message: 'Réchauffer la victime (couverture, isolation du sol), retirer les vêtements mouillés.' },
    high: { title: 'Fièvre', message: 'Découvrir la victime, hydrater si consciente, surveiller la température.' },
  },
  glycemie: {
    low: { title: 'Hypoglycémie suspectée', message: 'Resucrage par voie orale si la victime est consciente et peut déglutir.' },
    high: { title: 'Hyperglycémie suspectée', message: 'Surveillance, alerter le médecin régulateur.' },
  },
};

// Conduites à tenir spécifiques selon le type de brûlure
const BURN_CAT_BY_TYPE = {
  thermique: {
    title: 'Brûlure thermique',
    message: "Refroidir immédiatement à l'eau tempérée (15-20 °C) pendant 15-20 min si moins de 2h, ne pas percer les phlyctènes, couvrir d'un pansement stérile, alerter le 15.",
  },
  electrique: {
    title: 'Brûlure électrique',
    message: "Ne pas toucher la victime avant coupure du courant, rechercher les points d'entrée et de sortie, surveiller (risque de trouble du rythme cardiaque), alerter le 15 systématiquement.",
  },
  chimique: {
    title: 'Brûlure chimique',
    message: "Retirer les vêtements contaminés, rincer abondamment à l'eau claire pendant au moins 20 min (sauf produit réagissant à l'eau), ne pas neutraliser le produit, alerter le 15.",
  },
  radiologique: {
    title: 'Brûlure radiologique',
    message: 'Éloigner la victime de la source si possible sans se mettre en danger, alerter le 15 et les services spécialisés, ne pas toucher sans protection adaptée.',
  },
};
const BURN_CAT_DEFAULT = {
  title: 'Brûlure',
  message: "Refroidir à l'eau tempérée (15-20 °C) pendant 15-20 min si moins de 2h, ne pas percer les phlyctènes, couvrir d'un pansement stérile, alerter le 15.",
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
];

const NEURO_SIGNS = [
  { value: 'troubles_visuels', label: 'Troubles visuels' },
  { value: 'troubles_sensitifs', label: 'Troubles sensitifs' },
  { value: 'fourmillements', label: 'Fourmillements' },
  { value: 'trouble_equilibre', label: "Trouble de l'équilibre" },
  { value: 'convulsions', label: 'Convulsions' },
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

const optsToLabels = (opts) => Object.fromEntries(opts.map((o) => [o.value, o.label]));

const FIELD_LABELS = {
  commentaire: 'Commentaire',
  trauma: 'Victime traumatisée',
  obstruction: 'Liberté des voies aériennes',
  fr: 'Fréquence respiratoire',
  fr_signes: 'Signes associés',
  spo2: 'SpO2 (SAT)',
  spo2_mode: 'Mode SpO2',
  fc: 'Fréquence cardiaque',
  pa_gauche: 'Pression artérielle bras gauche',
  pa_droite: 'Pression artérielle bras droit',
  pouls_sym: 'Pouls symétrique',
  pouls_frappe: 'Pouls bien frappé',
  trc: 'TRC',
  signes: 'Signes associés',
  hemorragie: 'Hémorragie',
  hemorragie_sites: 'Localisation(s) hémorragie',
  pci: 'PCI',
  pc_repete: 'PC à répétition',
  pc_nombre: 'Nombre de fois',
  etat: 'État de conscience',
  orientation: 'Orientation temps-espace',
  neuro_signes: 'Signes associés',
  pupilles: 'Pupilles sym., taille normale, réactives',
  sens_mains: 'Sensibilité / motricité mains',
  sens_pieds: 'Sensibilité / motricité pieds',
  eva: 'Douleur (EVA)',
  douleur_loc: 'Localisation douleur',
  glycemie: 'Glycémie',
  temperature: 'Température',
  victime_env: 'Victime retrouvée au',
  brulure: 'Brûlure',
  brulure_degre: 'Degré',
  brulure_zones: 'Zones atteintes (règle des 9)',
  brulure_etendue: 'Étendue',
  brulure_loc: 'Localisation brûlure',
  brulure_type: 'Type de brûlure',
  lesion: 'Lésion cachée',
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
  X: ['trauma', 'hemorragie', 'hemorragie_sites'],
  A: ['obstruction'],
  B: ['fr', 'fr_signes', 'spo2', 'spo2_mode'],
  C: ['fc', 'pa_gauche', 'pa_droite', 'pouls_sym', 'pouls_frappe', 'trc', 'signes'],
  D: ['pci', 'pc_repete', 'pc_nombre', 'etat', 'orientation', 'neuro_signes', 'pupilles', 'sens_mains', 'sens_pieds', 'eva', 'douleur_loc', 'glycemie'],
  E: ['temperature', 'victime_env', 'lesion'],
  BRULURE: ['brulure', 'brulure_degre', 'brulure_type', 'brulure_zones', 'brulure_etendue', 'brulure_loc'],
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
  spo2: '%',
  glycemie: 'g/L',
  temperature: '°C',
  pa_gauche: 'mmHg',
  pa_droite: 'mmHg',
  eva: '/10',
  brulure_etendue: '% SC',
};

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
  spo2_mode: optsToLabels(SPO2_MODE),
  pouls_sym: optsToLabels(OUI_NON),
  pouls_frappe: optsToLabels(OUI_NON),
  trc: optsToLabels(TRC_OPTIONS),
  signes: optsToLabels(CIRC_SIGNS),
  hemorragie: optsToLabels(OUI_NON),
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
  const unit = UNITS[field];
  return unit ? `${value} ${unit}` : value;
}

const initialForm = () => ({
  TYPE: { categorie: '', commentaire: '' },
  X: { trauma: '', hemorragie: '', hemorragie_sites: [] },
  A: { obstruction: '' },
  B: { fr: '', fr_signes: [], spo2: '', spo2_mode: '' },
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
    eva: '',
    douleur_loc: '',
    glycemie: '',
  },
  E: { temperature: '', victime_env: '', lesion: '' },
  BRULURE: {
    brulure: '',
    brulure_degre: '',
    brulure_zones: [],
    brulure_etendue: '',
    brulure_loc: '',
    brulure_type: '',
  },
  FAST: { face: '', arm: '', speech: '', temps: '' },
  SAMPLER: {
    sampler_s: '',
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
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
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

function CatModal({ queue, onDismiss }) {
  if (queue.length === 0) return null;
  const current = queue[0];
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className="bg-neutral-950 border-2 rounded-2xl w-full sm:max-w-sm p-5"
        style={{ borderColor: AMBER }}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={20} style={{ color: AMBER }} />
          <h3 className="font-bold text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {current.title}
          </h3>
        </div>
        <p className="text-sm text-neutral-300 mb-4 leading-relaxed">{current.message}</p>
        <button
          onClick={onDismiss}
          className="w-full py-2.5 rounded-md font-semibold text-sm"
          style={{ backgroundColor: AMBER, color: '#1a1200' }}
        >
          Compris
        </button>
        {queue.length > 1 && (
          <p className="text-xs text-neutral-600 text-center mt-2">
            +{queue.length - 1} autre(s) alerte(s)
          </p>
        )}
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
  return data[page][field];
}

// Construit le contenu texte du bilan (réutilisé pour le PDF et le SMS)
function buildRecapLines(data) {
  const lines = [];
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
    lines.push(`${PAGE_TITLES[page] || page}`);
    if (rows.length === 0) {
      lines.push('  Bilan non effectué / non renseigné');
      lines.push('');
      return;
    }
    rows.forEach(({ f, v }) => lines.push(`  ${FIELD_LABELS[f]} : ${v}`));
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
    return { page, rows };
  });

  return (
    <div className="flex flex-col gap-5">
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
      {sections.map(({ page, rows }) => (
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
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-600 italic px-1">Bilan non effectué / non renseigné</p>
          ) : (
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
  const [catQueue, setCatQueue] = useState([]);
  const shownCatIds = useRef(new Set());
  const bilanStartRef = useRef(null);
  const [bilanDuration, setBilanDuration] = useState(null);

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

  // Vérifie l'ensemble des constats d'une page (B, C, D ou E) d'un coup, au moment
  // de passer à la suivante — plutôt que d'interrompre la saisie champ par champ.
  function checkPageOnNext(page) {
    if (page === 'B') {
      checkAndAlert('fr', form.B.fr);
      checkAndAlert('spo2', form.B.spo2);
      if (form.B.fr_signes.length > 0) {
        pushCat(
          'resp_signes',
          'Signes de détresse respiratoire',
          'Position demi-assise, oxygénothérapie si disponible, surveillance rapprochée, alerter le 15.'
        );
      }
    }
    if (page === 'C') {
      checkAndAlert('fc', form.C.fc);
      checkAndAlert('pa_sys', form.C.pa_gauche_sys);
      checkAndAlert('pa_sys', form.C.pa_droite_sys);
      if (form.C.pouls_sym === 'non') {
        pushCat(
          'pouls_asym',
          'Pouls asymétrique',
          "Suspicion d'atteinte vasculaire : ne pas mobiliser le membre concerné, alerter le 15."
        );
      }
      if (form.C.pouls_frappe === 'non') {
        pushCat(
          'pouls_faible',
          'Pouls mal frappé',
          'Signe de choc possible : position d\u2019attente (allongée, jambes surélevées sauf contre-indication), alerter le 15.'
        );
      }
      if (form.C.trc === '>2s') {
        pushCat(
          'trc_long',
          'TRC > 2 secondes',
          'Signe de choc : position d\u2019attente (allongée, jambes surélevées sauf contre-indication), couvrir, alerter le 15.'
        );
      }
      if (form.C.signes.length > 0) {
        pushCat(
          'choc_signes',
          'Signes de choc',
          'Position d\u2019attente (allongée, jambes surélevées sauf contre-indication), couvrir, alerter le 15.'
        );
      }
    }
    if (page === 'D') {
      const neuroDetresse =
        form.D.pci === 'oui' ||
        form.D.pc_repete === 'oui' ||
        (form.D.etat && form.D.etat !== 'A') ||
        form.D.orientation === 'non' ||
        form.D.neuro_signes.length > 0 ||
        form.D.pupilles === 'non' ||
        form.D.sens_mains === 'non' ||
        form.D.sens_pieds === 'non' ||
        (form.D.eva && parseInt(form.D.eva, 10) >= 7) ||
        isAbnormalField('glycemie', form.D.glycemie);
      if (neuroDetresse) {
        pushCat(
          'neuro_detresse',
          'Détresse neurologique détectée',
          'Position d\u2019attente : PLS si respiration spontanée et pas de trauma suspecté (sinon maintien tête). Ne pas laisser seul, surveillance neurologique rapprochée, alerter le 15.'
        );
      }
    }
    if (page === 'E') {
      checkAndAlert('temperature', form.E.temperature);
      if (form.E.victime_env === 'froid') {
        pushCat(
          'victime_froid',
          'Victime en ambiance froide',
          'Position d\u2019attente : réchauffement progressif, couverture, isolation du sol, retirer les vêtements mouillés.'
        );
      }
      if (form.E.lesion === 'oui') {
        pushCat(
          'lesion_cachee',
          'Lésion cachée détectée',
          'Réexaminer entièrement la victime, couvrir/protéger la zone, alerter le 15 si nécessaire.'
        );
      }
    }
    if (page === 'BRULURE') {
      if (form.BRULURE.brulure === 'oui') {
        const entry = BURN_CAT_BY_TYPE[form.BRULURE.brulure_type] || BURN_CAT_DEFAULT;
        pushCat('brulure', entry.title, entry.message);
      }
    }
  }

  function goNext() {
    if (['B', 'C', 'D', 'E', 'BRULURE'].includes(STEPS[step])) {
      checkPageOnNext(STEPS[step]);
    }
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
    setCatQueue([]);
    shownCatIds.current = new Set();
    bilanStartRef.current = null;
    setBilanDuration(null);
  }

  function pushCat(id, title, message) {
    if (shownCatIds.current.has(id)) return;
    shownCatIds.current.add(id);
    setCatQueue((q) => [...q, { id, title, message }]);
  }

  function dismissCat() {
    setCatQueue((q) => q.slice(1));
  }

  // Compare une valeur à la plage normale de la catégorie de victime sélectionnée.
  // Renvoie 'low', 'high', ou null si dans la norme / non évaluable.
  function getAbnormalDirection(field, rawValue) {
    const categorie = form.TYPE.categorie;
    if (!categorie || !rawValue) return null;
    const range = PATIENT_CATEGORIES[categorie]?.ranges[field];
    if (!range) return null;
    const num = parseFloat(String(rawValue).replace(',', '.'));
    if (isNaN(num)) return null;
    if (num < range[0]) return 'low';
    if (num > range[1]) return 'high';
    return null;
  }

  function isAbnormalField(field, rawValue) {
    return getAbnormalDirection(field, rawValue) !== null;
  }

  function checkAndAlert(field, rawValue) {
    const dir = getAbnormalDirection(field, rawValue);
    if (!dir) return;
    const entry = CAT_MESSAGES[field] && CAT_MESSAGES[field][dir];
    if (!entry) return;
    pushCat(`${field}_${dir}`, entry.title, entry.message);
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
                if (v === 'oui') {
                  pushCat(
                    'trauma',
                    'Victime traumatisée',
                    'Maintien de la tête (ne pas mobiliser le rachis), pose d\u2019un collier cervical si disponible. Position : allongée en rectitude, ne pas laisser la victime bouger, alerter le 15.'
                  );
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Hémorragie" filled={!!form.X.hemorragie}>
            <div className="flex flex-col gap-3 items-stretch">
              <ToggleGroup
                value={form.X.hemorragie}
                onChange={(v) => {
                  updateField('X', 'hemorragie', v);
                  if (v !== 'oui') updateField('X', 'hemorragie_sites', []);
                  if (v === 'oui') {
                    pushCat(
                      'hemorragie',
                      'Hémorragie',
                      'Compression manuelle directe sur la plaie (ou garrot si hémorragie massive incontrôlable). Position : allongée sur le dos, jambes légèrement surélevées si pas de contre-indication. Couvrir pour prévenir l\u2019hypothermie, oxygénothérapie si disponible, alerter le 15.'
                    );
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
            </div>
          </FieldCard>
        </>
      );
    if (s === 'A')
      return (
        <>
          <FieldCard label="Liberté des voies aériennes" filled={!!form.A.obstruction}>
            <ToggleGroup
              value={form.A.obstruction}
              onChange={(v) => {
                updateField('A', 'obstruction', v);
                if (v === 'non') {
                  pushCat(
                    'airway_obstruee',
                    'Voies aériennes obstruées',
                    'Désobstruction immédiate (claques dans le dos puis compressions abdominales si conscient ; LVA et recherche de corps étranger si inconscient).'
                  );
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
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
          <FieldCard label="Signes associés" filled={form.B.fr_signes.length > 0}>
            <MultiToggleGroup
              value={form.B.fr_signes}
              onChange={(v) => updateField('B', 'fr_signes', v)}
              options={BREATH_SIGNS}
            />
          </FieldCard>
          <FieldCard label="SpO2 (SAT)" filled={!!form.B.spo2}>
            <div className="flex flex-wrap items-center gap-3">
              <InputBox
                value={form.B.spo2}
                onChange={(v) => updateField('B', 'spo2', v)}
                abnormal={isAbnormalField('spo2', form.B.spo2)}
                unit="%"
                numeric
              />
              <ToggleGroup
                value={form.B.spo2_mode}
                onChange={(v) => updateField('B', 'spo2_mode', v)}
                options={SPO2_MODE}
              />
            </div>
          </FieldCard>
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
                  placeholder="120"
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
                  placeholder="80"
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
                  placeholder="120"
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
                  placeholder="80"
                  numeric
                  width="w-20"
                />
              </div>
            </div>
          </FieldCard>
          <FieldCard label="Pouls symétrique" filled={!!form.C.pouls_sym}>
            <ToggleGroup
              value={form.C.pouls_sym}
              onChange={(v) => updateField('C', 'pouls_sym', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Pouls bien frappé" filled={!!form.C.pouls_frappe}>
            <ToggleGroup
              value={form.C.pouls_frappe}
              onChange={(v) => updateField('C', 'pouls_frappe', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="TRC" filled={!!form.C.trc}>
            <ToggleGroup
              value={form.C.trc}
              onChange={(v) => updateField('C', 'trc', v)}
              options={TRC_OPTIONS}
            />
          </FieldCard>
          <FieldCard label="Signes associés" filled={form.C.signes.length > 0}>
            <MultiToggleGroup
              value={form.C.signes}
              onChange={(v) => updateField('C', 'signes', v)}
              options={CIRC_SIGNS}
            />
          </FieldCard>
        </>
      );
    if (s === 'D')
      return (
        <>
          <FieldCard label="PCI" filled={!!form.D.pci}>
            <ToggleGroup value={form.D.pci} onChange={(v) => updateField('D', 'pci', v)} options={OUI_NON} />
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
                  placeholder="ex. 2"
                  numeric
                />
              </div>
            </div>
          </FieldCard>
          <FieldCard label="État de conscience" filled={!!form.D.etat}>
            <ToggleGroup
              value={form.D.etat}
              onChange={(v) => updateField('D', 'etat', v)}
              options={AVPU_OPTIONS}
            />
          </FieldCard>
          <FieldCard label="Orientation temps-espace" filled={!!form.D.orientation}>
            <ToggleGroup
              value={form.D.orientation}
              onChange={(v) => updateField('D', 'orientation', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Signes associés" filled={form.D.neuro_signes.length > 0}>
            <MultiToggleGroup
              value={form.D.neuro_signes}
              onChange={(v) => updateField('D', 'neuro_signes', v)}
              options={NEURO_SIGNS}
            />
          </FieldCard>
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
          <FieldCard label="Sensibilité / motricité mains" filled={!!form.D.sens_mains}>
            <ToggleGroup
              value={form.D.sens_mains}
              onChange={(v) => updateField('D', 'sens_mains', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Sensibilité / motricité pieds" filled={!!form.D.sens_pieds}>
            <ToggleGroup
              value={form.D.sens_pieds}
              onChange={(v) => updateField('D', 'sens_pieds', v)}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Douleur (EVA)" filled={!!form.D.eva}>
            <ToggleGroup
              value={form.D.eva}
              onChange={(v) => updateField('D', 'eva', v)}
              options={EVA_OPTIONS}
            />
          </FieldCard>
          <FieldCard label="Localisation douleur" filled={!!form.D.douleur_loc}>
            <InputBox
              value={form.D.douleur_loc}
              onChange={(v) => updateField('D', 'douleur_loc', v)}
              placeholder="ex. abdomen, jambe droite…"
              width="w-48"
            />
          </FieldCard>
          <FieldCard label="Glycémie" filled={!!form.D.glycemie}>
            <InputBox
              value={form.D.glycemie}
              onChange={(v) => updateField('D', 'glycemie', v)}
              abnormal={isAbnormalField('glycemie', form.D.glycemie)}
              unit="g/L"
              numeric="decimal"
            />
          </FieldCard>
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
          <FieldCard label="Victime retrouvée au" filled={!!form.E.victime_env}>
            <ToggleGroup
              value={form.E.victime_env}
              onChange={(v) => updateField('E', 'victime_env', v)}
              options={ENV_OPTIONS}
            />
          </FieldCard>
          <FieldCard label="Lésion cachée" filled={!!form.E.lesion}>
            <ToggleGroup
              value={form.E.lesion}
              onChange={(v) => updateField('E', 'lesion', v)}
              options={OUI_NON}
            />
          </FieldCard>
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
              {form.BRULURE.brulure === 'oui' && (
                <div className="flex flex-col gap-4 pt-2 border-t border-neutral-800">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Degré</span>
                    <ToggleGroup
                      value={form.BRULURE.brulure_degre}
                      onChange={(v) => updateField('BRULURE', 'brulure_degre', v)}
                      options={BRULURE_DEGRE_OPTIONS}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Type</span>
                    <ToggleGroup
                      value={form.BRULURE.brulure_type}
                      onChange={(v) => updateField('BRULURE', 'brulure_type', v)}
                      options={BRULURE_TYPE_OPTIONS}
                    />
                  </div>
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
                      placeholder="ex. 15"
                      numeric
                    />
                    <span className="text-xs text-neutral-600 italic">
                      Règle de la paume : la paume de la victime (doigts compris) ≈ 1 % de sa
                      surface corporelle — pratique pour ajuster sur des brûlures dispersées ou
                      plus petites qu'une zone entière.
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Localisation</span>
                    <InputBox
                      value={form.BRULURE.brulure_loc}
                      onChange={(v) => updateField('BRULURE', 'brulure_loc', v)}
                      placeholder="ex. avant-bras droit"
                      width="w-48"
                    />
                  </div>
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
              onChange={(v) => {
                updateField('FAST', 'face', v);
                if (v === 'oui') {
                  pushCat(
                    'fast_positif',
                    'Signe FAST positif — suspicion AVC',
                    "Noter précisément l'heure d'apparition des signes, alerter le 15 en urgence, ne rien donner par voie orale."
                  );
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Arm (bras)" filled={!!form.FAST.arm}>
            <ToggleGroup
              value={form.FAST.arm}
              onChange={(v) => {
                updateField('FAST', 'arm', v);
                if (v === 'oui') {
                  pushCat(
                    'fast_positif',
                    'Signe FAST positif — suspicion AVC',
                    "Noter précisément l'heure d'apparition des signes, alerter le 15 en urgence, ne rien donner par voie orale."
                  );
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
          <FieldCard label="Speech (parole)" filled={!!form.FAST.speech}>
            <ToggleGroup
              value={form.FAST.speech}
              onChange={(v) => {
                updateField('FAST', 'speech', v);
                if (v === 'oui') {
                  pushCat(
                    'fast_positif',
                    'Signe FAST positif — suspicion AVC',
                    "Noter précisément l'heure d'apparition des signes, alerter le 15 en urgence, ne rien donner par voie orale."
                  );
                }
              }}
              options={OUI_NON}
            />
          </FieldCard>
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

      <CatModal queue={catQueue} onDismiss={dismissCat} />
    </div>
  );
}
