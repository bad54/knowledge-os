<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CardDetail, Analysis } from '@knowledge/shared';
import { api, date } from '../api';
const route = useRoute();
const router = useRouter();
const card = ref<CardDetail>();
const error = ref('');
const busy = ref(false);
const sections: { key: keyof Analysis; label: string }[] = [
  { key: 'keyIdeas', label: 'Idées principales' },
  { key: 'insights', label: 'Insights' },
  { key: 'actionableIdeas', label: 'Actions possibles' },
  { key: 'questions', label: 'Questions ouvertes' },
  { key: 'claimsToVerify', label: 'Affirmations à vérifier' },
  { key: 'entities', label: 'Entités' },
];
const scores: { key: keyof Analysis; label: string }[] = [
  { key: 'relevanceScore', label: 'Pertinence' },
  { key: 'qualityScore', label: 'Qualité' },
  { key: 'originalityScore', label: 'Originalité' },
  { key: 'actionabilityScore', label: 'Actionnabilité' },
  { key: 'credibilityScore', label: 'Crédibilité' },
  { key: 'longTermValueScore', label: 'Valeur à long terme' },
];
onMounted(async () => {
  try {
    card.value = await api<CardDetail>('/cards/' + String(route.params.id));
  } catch (e) {
    error.value = (e as Error).message;
  }
});
async function reanalyze() {
  busy.value = true;
  try {
    await api('/cards/' + String(route.params.id) + '/reanalyze', { method: 'POST' });
    await router.push('/inbox');
  } catch (e) {
    error.value = (e as Error).message;
    busy.value = false;
  }
}
function list(a: Analysis, key: keyof Analysis): string[] {
  const v = a[key];
  return Array.isArray(v) ? v : [];
}
</script>
<template>
  <RouterLink class="back" to="/knowledge">← Bibliothèque</RouterLink>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <template v-if="card">
    <header class="page-header">
      <div>
        <p class="eyebrow">
          {{ card.content.sourceId }} · {{ card.language }} · {{ card.processingStatus }}
        </p>
        <h1>{{ card.title }}</h1>
        <p class="muted">
          Capturé le {{ date(card.content.capturedAt) }} ·
          {{ card.content.author || 'Auteur non renseigné' }}
        </p>
      </div>
      <button class="secondary" :disabled="busy" @click="reanalyze">Réanalyser</button>
    </header>
    <div class="detail-layout">
      <article>
        <section class="panel">
          <p class="eyebrow">ANALYSE GÉNÉRÉE · {{ card.modelUsed }}</p>
          <h2>Résumé</h2>
          <p class="prose">{{ card.summary }}</p>
        </section>
        <section v-for="section in sections" :key="section.key" class="panel">
          <h2>{{ section.label }}</h2>
          <ul v-if="list(card.analysis, section.key).length" class="ideas">
            <li v-for="(item, index) in list(card.analysis, section.key)" :key="index">
              {{ item }}
            </li>
          </ul>
          <p v-else class="muted">Aucun élément dans cette analyse.</p>
        </section>
        <section class="panel">
          <h2>Provenance</h2>
          <dl>
            <dt>Plateforme</dt>
            <dd>{{ card.content.sourceId }}</dd>
            <dt>Auteur</dt>
            <dd>{{ card.content.author || 'Non renseigné' }}</dd>
            <dt>Publication</dt>
            <dd>{{ date(card.content.publishedAt) }}</dd>
            <dt>Capture</dt>
            <dd>{{ date(card.content.capturedAt) }}</dd>
          </dl>
          <a
            v-if="card.content.originalUrl"
            class="button secondary"
            :href="card.content.originalUrl"
            target="_blank"
            rel="noopener noreferrer"
            >Ouvrir la source originale ↗</a
          >
          <details>
            <summary>Texte source original</summary>
            <pre class="source-text">{{ card.content.text }}</pre>
          </details>
          <details>
            <summary>Métadonnées de capture</summary>
            <pre class="source-text">{{ JSON.stringify(card.content.metadata, null, 2) }}</pre>
          </details>
          <details>
            <summary>Captures et références ({{ card.content.references.length }})</summary>
            <ul>
              <li v-for="reference in card.content.references" :key="reference.id">
                {{ date(reference.capturedAt) }} ·
                <a
                  v-if="reference.originalUrl"
                  :href="reference.originalUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ reference.originalUrl }}</a
                ><span v-else>Texte manuel</span>
              </li>
            </ul>
          </details>
        </section>
      </article>
      <aside>
        <section class="panel">
          <p class="eyebrow">KNOWLEDGE SCORE</p>
          <p class="big-score">{{ card.globalScore.toFixed(1) }}<small>/10</small></p>
          <div v-for="score in scores" :key="score.key" class="score-row">
            <span>{{ score.label }}</span
            ><strong>{{ card.analysis[score.key] }}</strong>
          </div>
          <p class="muted">Évaluation indicative, sans vérification indépendante des faits.</p>
        </section>
        <section class="panel">
          <h2>Topics</h2>
          <div class="tags">
            <span v-for="topic in card.topics" :key="topic.id">{{ topic.name }}</span>
          </div>
          <h2>Concepts</h2>
          <div class="tags">
            <span v-for="concept in card.concepts" :key="concept.id">{{ concept.name }}</span>
          </div>
          <p v-if="!card.concepts.length" class="muted">Aucun concept identifié.</p>
        </section>
        <section class="panel">
          <h2>Versions de l’analyse</h2>
          <p class="muted">Pipeline {{ card.processingVersion }} · {{ card.promptVersion }}</p>
          <details v-for="revision in card.revisions" :key="revision.id">
            <summary>
              {{ date(revision.createdAt) }} · {{ revision.model }}
              {{ revision.id === card.activeRevisionId ? '(active)' : '' }}
            </summary>
            <p>{{ revision.analysis.summary }}</p>
            <small>{{ revision.processingVersion }} · {{ revision.promptVersion }}</small>
          </details>
        </section>
      </aside>
    </div>
  </template>
  <p v-else-if="!error" class="muted">Chargement de la fiche…</p>
</template>
