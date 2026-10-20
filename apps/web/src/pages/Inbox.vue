<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { IngestInput, JobView } from '@knowledge/shared';
import { api, date } from '../api';
const mode = ref('url');
const url = ref('');
const text = ref('');
const title = ref('');
const author = ref('');
const publishedAt = ref('');
const transcript = ref('');
const source = ref<IngestInput['sourceType']>('manual');
const jobs = ref<JobView[]>([]);
const error = ref('');
const message = ref('');
const busy = ref(false);
let timer: ReturnType<typeof setInterval>;
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  try {
    jobs.value = await api<JobView[]>('/jobs');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading = false;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 2000);
});
onUnmounted(() => clearInterval(timer));
async function capture() {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const input: IngestInput = {};
    if (url.value.trim()) input.url = url.value.trim();
    if (mode.value === 'text') {
      input.text = text.value;
      input.sourceType = source.value;
    }
    if (title.value.trim()) input.title = title.value.trim();
    if (author.value.trim()) input.author = author.value.trim();
    if (publishedAt.value) input.publishedAt = new Date(publishedAt.value).toISOString();
    if (mode.value === 'url' && transcript.value.trim()) input.transcript = transcript.value.trim();
    await api('/jobs', { method: 'POST', body: JSON.stringify(input) });
    message.value = 'Ressource ajoutée à la file de traitement.';
    url.value = '';
    text.value = '';
    title.value = '';
    transcript.value = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function retry(id: string) {
  try {
    await api('/jobs/' + id + '/retry', { method: 'POST' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">CAPTURER</p>
      <h1>Inbox</h1>
      <p class="muted">
        Une URL, une transcription ou un texte. La provenance reste avec vos idées.
      </p>
    </div>
  </header>
  <div class="capture-layout">
    <form class="panel capture" @submit.prevent="capture">
      <div class="tabs" role="group" aria-label="Type de capture">
        <button type="button" :class="{ active: mode === 'url' }" @click="mode = 'url'">URL</button
        ><button type="button" :class="{ active: mode === 'text' }" @click="mode = 'text'">
          Texte manuel
        </button>
      </div>
      <label
        >{{ mode === 'url' ? 'URL de la ressource' : 'URL originale (facultatif)'
        }}<input
          v-model="url"
          type="url"
          :required="mode === 'url'"
          placeholder="https://…"
          maxlength="2048"
      /></label>
      <label
        >Titre (facultatif)<input
          v-model="title"
          maxlength="300"
          placeholder="Un titre pour retrouver cette idée"
      /></label>
      <label v-if="mode === 'text'"
        >Texte source<textarea
          v-model="text"
          required
          minlength="20"
          maxlength="100000"
          rows="7"
          placeholder="Collez votre texte, en conservant les citations et références utiles."
        />
      </label>
      <label v-if="mode === 'text'"
        >Plateforme d’origine<select v-model="source">
          <option value="manual">Texte manuel</option>
          <option value="web">Web</option>
          <option value="youtube">YouTube</option>
          <option value="reddit">Reddit</option>
          <option value="x">X / Twitter</option>
        </select></label
      >
      <details>
        <summary>Attribution et transcription</summary>
        <label>Auteur<input v-model="author" maxlength="300" /></label
        ><label>Date de publication<input v-model="publishedAt" type="date" /></label
        ><label v-if="mode === 'url'"
          >Transcription YouTube autorisée (facultatif)<textarea
            v-model="transcript"
            rows="5"
            maxlength="100000"
            placeholder="Les timestamps sont conservés. Sans transcription fournie, un accès OAuth autorisé aux sous-titres est nécessaire."
          />
        </label>
      </details>
      <button :disabled="busy">{{ busy ? 'Ajout en cours…' : 'Ajouter à mon Inbox' }}</button>
      <p v-if="message" class="success" role="status">{{ message }}</p>
    </form>
    <aside class="panel help">
      <span class="eyebrow">DE LA SOURCE À LA FICHE</span>
      <h2>Une capture, plusieurs usages.</h2>
      <ol>
        <li>Conserver le contenu original</li>
        <li>Extraire les idées essentielles</li>
        <li>Classer et créer une fiche</li>
        <li>Retrouver l’information par recherche</li>
      </ol>
      <p class="muted">
        Les pages protégées et les plateformes nécessitant une API ne sont pas contournées. Utilisez
        un import de texte autorisé.
      </p>
    </aside>
  </div>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <div class="section-heading">
    <h2>Traitements récents</h2>
    <span class="muted">Actualisation automatique</span>
  </div>
  <div v-if="!jobs.length" class="empty">
    Aucun traitement. Ajoutez votre première ressource ci-dessus.
  </div>
  <div v-for="job in jobs" :key="job.id" class="job panel">
    <div>
      <span :class="['status', job.status.toLowerCase()]">{{ job.status }}</span
      ><small>{{ date(job.createdAt) }} · tentative {{ job.attempts }}</small>
      <p v-if="job.errorMessage" class="error">{{ job.errorMessage }}</p>
      <code class="job-id">{{ job.id }}</code>
    </div>
    <RouterLink v-if="job.cardId" :to="'/knowledge/' + job.cardId">Voir la fiche →</RouterLink
    ><button v-if="job.status === 'FAILED'" class="secondary" @click="retry(job.id)">
      Relancer
    </button>
  </div>
</template>
