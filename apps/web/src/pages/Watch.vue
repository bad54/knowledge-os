<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import type { WatchOverview, WatchSettingsInput } from '@knowledge/shared';
import { api, date } from '../api';
const data = ref<WatchOverview>();
const error = ref('');
const message = ref('');
const busy = ref(false);
const draft = reactive({
  topics: '',
  includeKeywords: '',
  excludeKeywords: '',
  languages: '',
  dailyLimit: 5,
  scheduleEnabled: false,
});
const source = reactive({ name: '', url: '' });
let timer: ReturnType<typeof setInterval>;
let loading = false;
let reloadRequested = false;
let lastLoad = 0;
let active = true;
const split = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
async function load(initial = false) {
  if (loading) {
    reloadRequested = true;
    return;
  }
  loading = true;
  try {
    const result = await api<WatchOverview>('/watch');
    if (!active) return;
    data.value = result;
    lastLoad = Date.now();
    if (initial)
      Object.assign(draft, {
        ...result.settings,
        topics: result.settings.topics.join(', '),
        includeKeywords: result.settings.includeKeywords.join(', '),
        excludeKeywords: result.settings.excludeKeywords.join(', '),
        languages: result.settings.languages.join(', '),
      });
  } catch (e) {
    if (active) error.value = (e as Error).message;
  } finally {
    loading = false;
    if (reloadRequested && active) {
      reloadRequested = false;
      void load();
    }
  }
}
async function action(work: () => Promise<unknown>, success: string) {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await work();
    message.value = success;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function save() {
  const settings: WatchSettingsInput = {
    topics: split(draft.topics),
    includeKeywords: split(draft.includeKeywords),
    excludeKeywords: split(draft.excludeKeywords),
    languages: split(draft.languages.toLowerCase()),
    dailyLimit: Number(draft.dailyLimit),
    scheduleEnabled: draft.scheduleEnabled,
  };
  void action(
    () => api('/watch/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    'Réglages enregistrés. Les propositions suivent vos nouveaux critères.',
  );
}
function addSource() {
  void action(async () => {
    await api('/watch/sources', { method: 'POST', body: JSON.stringify(source) });
    source.name = '';
    source.url = '';
  }, 'Flux enregistré. Lancez la veille pour récupérer ses publications.');
}
function toggle(id: string, enabled: boolean) {
  void action(
    () => api('/watch/sources/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    enabled ? 'Flux activé.' : 'Flux désactivé. Son historique est conservé.',
  );
}
function collect() {
  void action(
    () => api('/watch/runs', { method: 'POST' }),
    'Collecte lancée. Les propositions apparaîtront ici.',
  );
}
function decide(id: string, decision: string) {
  void action(
    () =>
      api('/watch/candidates/' + id + '/decision', {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    decision === 'KEEP'
      ? 'Ressource envoyée à l’Inbox. La fiche apparaîtra après traitement.'
      : 'Retour enregistré. La proposition est retirée de la sélection.',
  );
}
const runLabels: Record<string, string> = {
  CREATED: 'En attente',
  FETCHING: 'Collecte en cours',
  COMPLETED: 'Terminée',
  PARTIAL: 'Terminée avec des erreurs',
  FAILED: 'Échec',
};
const decisionLabels: Record<string, string> = {
  KEEP: 'Gardée',
  KNOWN: 'Déjà connu',
  OFF_TOPIC: 'Hors sujet',
  SKIP: 'Écartée',
};
onMounted(() => {
  void load(true);
  timer = setInterval(() => {
    const running = data.value?.runs.some((r) => ['CREATED', 'FETCHING'].includes(r.status));
    const processing = data.value?.recentDecisions.some(
      (c) => c.job && !['COMPLETED', 'FAILED'].includes(c.job.status),
    );
    if (
      running ||
      processing ||
      (data.value?.settings.scheduleEnabled && Date.now() - lastLoad > 30000)
    )
      void load();
  }, 2000);
});
onUnmounted(() => {
  active = false;
  clearInterval(timer);
});
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">DÉCOUVRIR</p>
      <h1>Ma veille</h1>
      <p class="muted">Vos sources, vos sujets, votre sélection.</p>
    </div>
    <button
      :disabled="
        busy ||
        !data?.sources.some((s) => s.enabled) ||
        data?.runs.some((r) => ['CREATED', 'FETCHING'].includes(r.status))
      "
      @click="collect"
    >
      Lancer ma veille
    </button>
  </header>
  <p class="notice">
    Pré-tri par mots-clés sur les titres et extraits RSS. Ce classement ne mesure pas la fiabilité
    des articles. Seul « Garder » déclenche la lecture de l’article et son traitement dans l’Inbox.
  </p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="message" class="success" role="status">{{ message }}</p>
  <p v-if="!data" class="muted">Chargement de votre veille…</p>
  <template v-else>
    <div class="watch-setup">
      <form class="panel watch-form" aria-label="Réglages de veille" @submit.prevent="save">
        <h2>Mes critères</h2>
        <label
          >Sujets (séparés par des virgules)<input
            v-model="draft.topics"
            maxlength="2000"
            placeholder="IA, n8n, reporting universitaire"
        /></label>
        <label
          >Mots-clés inclus<input
            v-model="draft.includeKeywords"
            maxlength="2000"
            placeholder="automatisation, Power BI"
        /></label>
        <p class="muted">
          Un sujet ou un mot-clé suffit. Sans critère, toutes les publications accessibles sont
          proposées.
        </p>
        <label
          >Mots-clés exclus<input
            v-model="draft.excludeKeywords"
            maxlength="2000"
            placeholder="crypto, offre d’emploi"
        /></label>
        <label
          >Langues (codes séparés par des virgules)<input
            v-model="draft.languages"
            maxlength="50"
            placeholder="fr, en — vide pour toutes"
        /></label>
        <p class="muted">
          La langue déclarée par le flux est utilisée. Une langue inconnue reste proposée avec une
          indication.
        </p>
        <label
          >Plafond de ressources gardées par jour (UTC)<input
            v-model.number="draft.dailyLimit"
            type="number"
            min="1"
            max="20"
            required
        /></label>
        <label class="watch-checkbox"
          ><input v-model="draft.scheduleEnabled" type="checkbox" /> Collecte automatique toutes les
          24 heures</label
        >
        <p class="muted">
          L’activation lance une première collecte, puis une toutes les 24 heures. Elle ne publie
          aucune fiche automatiquement.
        </p>
        <button :disabled="busy">Enregistrer mes critères</button>
        <p v-if="data.settings.nextRunAt" class="muted">
          Prochaine collecte : {{ new Date(data.settings.nextRunAt).toLocaleString('fr-FR') }}
        </p>
      </form>
      <section class="panel watch-form">
        <h2>Mes sources RSS / Atom</h2>
        <p class="muted">
          Jusqu’à dix flux actifs. Les dix premières entrées de chaque flux sont examinées par
          collecte. X et Reddit ne sont pas encore connectés.
        </p>
        <form class="watch-form" aria-label="Ajouter un flux" @submit.prevent="addSource">
          <label
            >Nom du flux<input
              v-model="source.name"
              required
              maxlength="150"
              placeholder="Mon blog spécialisé"
          /></label>
          <label
            >URL du flux RSS ou Atom<input
              v-model="source.url"
              required
              type="url"
              maxlength="2048"
              placeholder="https://exemple.fr/feed.xml"
          /></label>
          <button :disabled="busy">Ajouter le flux</button>
          <button
            type="button"
            class="secondary"
            @click="
              source.name = 'GitHub Blog';
              source.url = 'https://github.blog/feed/';
            "
          >
            Préremplir un exemple : GitHub Blog
          </button>
        </form>
        <div v-if="!data.sources.length" class="empty">
          Ajoutez votre premier flux, puis lancez la veille.
        </div>
        <article v-for="feed in data.sources" :key="feed.id" class="watch-source">
          <strong>{{ feed.name }}</strong
          ><small class="muted">{{ feed.url }}</small>
          <p v-if="feed.errorMessage" class="error">{{ feed.errorMessage }}</p>
          <small v-if="feed.lastSuccessAt" class="muted"
            >Dernière collecte réussie : {{ date(feed.lastSuccessAt) }}</small
          >
          <button class="secondary" :disabled="busy" @click="toggle(feed.id, !feed.enabled)">
            {{ feed.enabled ? 'Désactiver' : 'Activer' }}
          </button>
        </article>
      </section>
    </div>
    <div class="section-heading">
      <h2>Ma sélection</h2>
      <span class="muted"
        >{{ data.selectedToday }} / {{ data.settings.dailyLimit }} gardées aujourd’hui (UTC)</span
      >
    </div>
    <p class="muted">
      Jusqu’à 100 propositions, classées par correspondance avec vos critères actuels. « Déjà connu
      » et « Hors sujet » enregistrent votre retour ; ils ne modifient pas encore automatiquement
      vos critères.
    </p>
    <div v-if="!data.candidates.length" class="empty">
      Aucune proposition pour vos critères. Ajoutez des sources, lancez une collecte ou élargissez
      vos mots-clés.
    </div>
    <article v-for="candidate in data.candidates" :key="candidate.id" class="panel watch-candidate">
      <div class="watch-candidate-meta">
        <span class="pill">{{ candidate.source.name }}</span
        ><span class="muted">Correspondance : {{ candidate.selectionScore }} %</span>
      </div>
      <h3>
        <a :href="candidate.url" target="_blank" rel="noopener noreferrer">{{ candidate.title }}</a>
      </h3>
      <p>{{ candidate.excerpt.slice(0, 500) || 'Aucun extrait fourni par le flux.' }}</p>
      <p class="muted">
        {{ candidate.author || 'Auteur non indiqué' }} · {{ date(candidate.publishedAt) }} ·
        {{ candidate.language }}
      </p>
      <ul class="muted">
        <li v-for="reason in candidate.reasons" :key="reason">{{ reason }}</li>
      </ul>
      <div class="watch-actions">
        <button
          :disabled="busy || data.selectedToday >= data.settings.dailyLimit"
          @click="decide(candidate.id, 'KEEP')"
        >
          Garder
        </button>
        <button class="secondary" :disabled="busy" @click="decide(candidate.id, 'KNOWN')">
          Déjà connu
        </button>
        <button class="secondary" :disabled="busy" @click="decide(candidate.id, 'OFF_TOPIC')">
          Hors sujet
        </button>
      </div>
    </article>
    <section v-if="data.recentDecisions.length" class="panel watch-history">
      <h2>Décisions récentes</h2>
      <article v-for="candidate in data.recentDecisions" :key="candidate.id" class="watch-source">
        <strong>{{ candidate.title }}</strong
        ><span
          >{{ decisionLabels[candidate.decision || ''] }}
          <template v-if="candidate.job"> · {{ candidate.job.status }}</template></span
        >
        <RouterLink v-if="candidate.job?.cardId" :to="'/knowledge/' + candidate.job.cardId"
          >Voir la fiche</RouterLink
        >
        <RouterLink v-else-if="candidate.job" to="/inbox">Suivre dans l’Inbox</RouterLink>
      </article>
    </section>
    <section class="panel watch-history">
      <h2>Historique des collectes</h2>
      <p v-if="!data.runs.length" class="muted">Aucune collecte pour le moment.</p>
      <article v-for="run in data.runs" :key="run.id" class="watch-run">
        <strong>{{ runLabels[run.status] }}</strong
        ><span class="muted"
          >{{ date(run.createdAt) }} ·
          {{ run.trigger === 'scheduled' ? 'Automatique' : 'Manuelle' }}</span
        >
        <p>
          {{ run.scanned }} entrées examinées · {{ run.added }} nouvelles propositions ·
          {{ run.filtered }} filtrées ou déjà connues
        </p>
        <p v-if="run.errorMessage" class="error">{{ run.errorMessage }}</p>
        <p v-for="issue in run.issues" :key="issue.sourceId" class="error">
          {{ data.sources.find((s) => s.id === issue.sourceId)?.name || 'Source' }} :
          {{ issue.message }}
        </p>
      </article>
      <p class="muted">
        Après une erreur, vérifiez le flux et utilisez « Lancer ma veille ». Les propositions
        enregistrées restent disponibles.
      </p>
    </section>
  </template>
</template>
