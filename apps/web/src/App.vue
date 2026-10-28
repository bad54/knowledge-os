<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { DashboardView } from '@knowledge/shared';
import { accessRequired, api, apiToken, saveToken } from './api';
const route = useRoute();
const token = ref('');
const version = ref(0);
const provider = ref('');
const connection = ref(false);
const checking = ref(true);
const connecting = ref(false);
const connectionError = ref('');
watch(accessRequired, (required) => {
  if (required) connection.value = true;
});
async function refresh() {
  const requestToken = apiToken.value;
  try {
    const dashboard = await api<DashboardView>('/dashboard');
    if (requestToken !== apiToken.value) return false;
    provider.value = dashboard.provider;
    connectionError.value = '';
    return true;
  } catch (error) {
    if (requestToken !== apiToken.value) return false;
    provider.value = '';
    connection.value = true;
    connectionError.value = (error as Error).message;
    return false;
  } finally {
    checking.value = false;
  }
}
async function connect() {
  connecting.value = true;
  connectionError.value = '';
  saveToken(token.value);
  if (await refresh()) {
    token.value = '';
    connection.value = false;
    version.value++;
  }
  connecting.value = false;
}
function lock() {
  saveToken('');
  token.value = '';
  provider.value = '';
  connectionError.value = '';
  accessRequired.value = true;
  version.value++;
  connection.value = true;
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
        <RouterLink to="/x" active-class="selected">Corpus X</RouterLink>
        <RouterLink to="/watch" active-class="selected">Ma veille</RouterLink>
        <RouterLink to="/search" active-class="selected">Recherche</RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <p>Une idée utile mérite<br />d’être retrouvée.</p>
      </div>
    </aside>
    <main>
      <div class="topline">
        <span>Espace personnel</span>
        <div class="access-actions">
          <span class="pill">{{
            provider === 'openai'
              ? 'Analyse IA connectée'
              : provider === 'local'
                ? 'Analyse extractive'
                : 'Accès privé'
          }}</span>
          <button v-if="apiToken" class="secondary" @click="lock">Verrouiller</button>
          <button v-else class="secondary" @click="connection = !connection">Se connecter</button>
        </div>
      </div>
      <form
        v-if="connection"
        class="panel connection"
        aria-label="Connexion privée"
        @submit.prevent="connect"
      >
        <label
          >Clé d’accès privée<input
            v-model="token"
            type="password"
            autocomplete="off"
            placeholder="Votre clé personnelle" /></label
        ><button :disabled="connecting">
          {{ connecting ? 'Vérification…' : 'Ouvrir ma bibliothèque' }}
        </button>
        <p class="muted">
          Cette clé est confidentielle, comme un mot de passe. Elle ouvre l’accès à vos
          connaissances pour cette session du navigateur.
        </p>
        <p v-if="connectionError" class="error" role="alert">{{ connectionError }}</p>
      </form>
      <p v-if="provider === 'local'" class="notice">
        Analyse extractive sur le serveur : résumés extraits du texte, scores fixes à 5/10 et
        similarité lexicale. Aucun appel à OpenAI dans ce mode. Cela ne change pas le lieu de
        stockage de vos données.
      </p>
      <section v-if="accessRequired" class="panel private-lock" role="status">
        <h1>Votre bibliothèque est verrouillée</h1>
        <p>
          Vos fiches ne sont pas affichées sans une clé d’accès valide. Cela ne signifie pas que
          votre bibliothèque est vide.
        </p>
        <p class="muted">
          La clé est conservée uniquement pour votre session dans ce navigateur. Ne la partagez pas.
        </p>
      </section>
      <p v-else-if="checking" class="muted">Vérification de l’accès privé…</p>
      <RouterView v-else :key="route.path + version" />
    </main>
  </div>
</template>
