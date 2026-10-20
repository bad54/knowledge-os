<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { CardView } from '@knowledge/shared';
import { api, filtersQuery } from '../api';
import { useFilters } from '../composables/filters';
import Filters from '../components/Filters.vue';
import CardList from '../components/CardList.vue';
const { values, query } = useFilters();
const cards = ref<CardView[]>([]);
const page = ref(1);
const busy = ref(false);
const error = ref('');
async function load(reset = false) {
  if (reset) page.value = 1;
  busy.value = true;
  error.value = '';
  try {
    cards.value = await api<CardView[]>('/cards?' + filtersQuery({ ...query(), page: page.value }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load());
function move(delta: number) {
  page.value += delta;
  void load();
}
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">CONSERVER</p>
      <h1>Bibliothèque</h1>
      <p class="muted">Vos connaissances, structurées et reliées à leurs sources.</p>
    </div>
    <RouterLink class="button" to="/inbox">＋ Ajouter</RouterLink>
  </header>
  <Filters v-model="values" @apply="load(true)" />
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="busy" class="muted">Chargement…</p>
  <CardList v-else :cards="cards" empty="Aucune fiche ne correspond à ces filtres." />
  <div class="pagination">
    <button class="secondary" :disabled="page === 1 || busy" @click="move(-1)">Précédent</button
    ><span>Page {{ page }}</span
    ><button class="secondary" :disabled="cards.length < 24 || busy" @click="move(1)">
      Suivant
    </button>
  </div>
</template>
