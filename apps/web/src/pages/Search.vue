<script setup lang="ts">
import { ref } from 'vue';
import type { CardView } from '@knowledge/shared';
import { api, filtersQuery } from '../api';
import Filters from '../components/Filters.vue';
import CardList from '../components/CardList.vue';
import { useFilters } from '../composables/filters';
const { values, query } = useFilters();
const q = ref('');
const mode = ref('hybrid');
const results = ref<CardView[]>([]);
const busy = ref(false);
const searched = ref(false);
const error = ref('');
async function search() {
  if (q.value.trim().length < 2) return;
  busy.value = true;
  error.value = '';
  try {
    results.value = await api<CardView[]>(
      '/search?' + filtersQuery({ ...query(), q: q.value, mode: mode.value }),
    );
    searched.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">RETROUVER</p>
      <h1>Une question, vos connaissances.</h1>
      <p class="muted">
        Explorez vos ressources par mots-clés ou par proximité de sens avec OpenAI.
      </p>
    </div>
  </header>
  <form class="search-form" @submit.prevent="search">
    <label class="sr-only" for="search">Votre recherche</label
    ><input
      id="search"
      v-model="q"
      required
      minlength="2"
      maxlength="1000"
      placeholder="Comment automatiser le reporting d’une université ?"
    /><label class="sr-only" for="mode">Mode</label
    ><select id="mode" v-model="mode">
      <option value="hybrid">Hybride</option>
      <option value="semantic">Similarité vectorielle</option>
      <option value="text">Texte</option></select
    ><button :disabled="busy">{{ busy ? 'Recherche…' : 'Rechercher' }}</button>
  </form>
  <Filters v-model="values" @apply="search" />
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <template v-else-if="searched"
    ><div class="section-heading">
      <h2>{{ results.length }} résultat(s)</h2>
      <small class="muted">La similarité ne mesure pas la véracité d’une source.</small>
    </div>
    <CardList
      :cards="results"
      :similarity="mode !== 'text'"
      empty="Aucune connaissance ne correspond à cette recherche."
  /></template>
  <div v-else class="empty">Posez une question à votre bibliothèque.</div>
</template>
