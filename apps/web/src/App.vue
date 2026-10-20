<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { DashboardView } from '@knowledge/shared';
import { api, apiToken, saveToken } from './api';
const route = useRoute();
const token = ref(apiToken.value);
const version = ref(0);
const provider = ref('');
const connection = ref(false);
async function refresh() {
  try {
    provider.value = (await api<DashboardView>('/dashboard')).provider;
  } catch {
    connection.value = true;
  }
}
function connect() {
  saveToken(token.value);
  version.value++;
  connection.value = false;
  void refresh();
}
onMounted(refresh);
</script>
<template>
  <div class="shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/"
        ><span class="brand-icon">K</span
        ><span>Knowledge OS<small>CAPTURER · COMPRENDRE · RELIER</small></span></RouterLink
      >
      <nav aria-label="Navigation principale">
        <RouterLink to="/" exact-active-class="selected">Vue d’ensemble</RouterLink>
        <RouterLink to="/inbox" active-class="selected">Inbox <span>＋</span></RouterLink>
        <RouterLink to="/knowledge" active-class="selected">Bibliothèque</RouterLink>
        <RouterLink to="/search" active-class="selected">Recherche</RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <p>Une idée utile mérite<br />d’être retrouvée.</p>
        <button class="quiet" @click="connection = !connection">Accès à l’API</button>
      </div>
    </aside>
    <main>
      <div class="topline">
        <span>Espace personnel</span
        ><span class="pill">{{
          provider === 'openai'
            ? 'Analyse IA connectée'
            : provider === 'local'
              ? 'Mode local'
              : 'Knowledge OS'
        }}</span>
      </div>
      <form v-if="connection" class="panel connection" @submit.prevent="connect">
        <label
          >Jeton d’accès API<input
            v-model="token"
            type="password"
            autocomplete="off"
            placeholder="Jeton configuré sur le serveur" /></label
        ><button>Enregistrer pour cette session</button>
        <p class="muted">Laissez vide pour une installation locale sans jeton.</p>
      </form>
      <p v-if="provider === 'local'" class="notice">
        Mode local : résumés extraits du texte, scores fixes à 5/10 et similarité lexicale.
        L’analyse IA et la recherche sémantique nécessitent la configuration OpenAI du serveur.
      </p>
      <RouterView :key="route.path + version" />
    </main>
  </div>
</template>
