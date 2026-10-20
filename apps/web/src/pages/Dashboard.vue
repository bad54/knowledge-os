<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { DashboardView } from '@knowledge/shared';
import { api } from '../api';
import CardList from '../components/CardList.vue';
const data = ref<DashboardView>();
const error = ref('');
onMounted(async () => {
  try {
    data.value = await api<DashboardView>('/dashboard');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">VOTRE MÉMOIRE AUGMENTÉE</p>
      <h1>De l’information à la connaissance.</h1>
      <p class="muted">Gardez les idées qui comptent. Retrouvez-les au bon moment.</p>
    </div>
    <RouterLink class="button" to="/inbox">＋ Ajouter une ressource</RouterLink>
  </header>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <template v-else-if="data">
    <div class="stats">
      <div>
        <small>RESSOURCES</small><strong>{{ data.total }}</strong
        ><span>dans votre bibliothèque</span>
      </div>
      <div>
        <small>CETTE SEMAINE</small><strong>{{ data.newResources }}</strong
        ><span>nouvelles captures</span>
      </div>
      <div>
        <small>EN COURS</small><strong>{{ data.processing }}</strong
        ><RouterLink to="/inbox">Voir l’Inbox ↗</RouterLink>
      </div>
      <div>
        <small>À REPRENDRE</small><strong>{{ data.failed }}</strong
        ><span>traitements en erreur</span>
      </div>
    </div>
    <div class="section-heading">
      <h2>Dernières connaissances</h2>
      <RouterLink to="/knowledge">Tout parcourir →</RouterLink>
    </div>
    <CardList :cards="data.latest" />
    <div class="section-heading">
      <h2>Les meilleurs scores</h2>
      <span class="muted">Les scores IA restent indicatifs</span>
    </div>
    <CardList :cards="data.best" />
    <section class="panel">
      <h2>Vos sources</h2>
      <div class="source-list">
        <div v-for="source in data.bySource" :key="source.sourceId">
          <span>{{ source.sourceId }}</span
          ><progress :value="source._count" :max="data.total" /><strong>{{ source._count }}</strong>
        </div>
        <p v-if="!data.bySource.length" class="muted">Aucune capture pour le moment.</p>
      </div>
    </section>
  </template>
  <p v-else class="muted">Chargement de votre espace…</p>
</template>
