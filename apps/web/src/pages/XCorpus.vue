<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import type { XOverview, XPostView, XAnswerView } from '@knowledge/shared';
import { api, date, filtersQuery } from '../api';
const overview = ref<XOverview>();
const posts = ref<XPostView[]>([]);
const cursor = ref<string | null>(null);
const error = ref('');
const message = ref('');
const busy = ref(false);
const asking = ref(false);
const importing = ref(false);
const question = ref('');
const mode = ref<'answer' | 'plan' | 'decision'>('answer');
const answer = ref<XAnswerView>();
const filters = reactive({ q: '', topic: '', sort: 'recent' });
const rule = reactive({
  name: '',
  query: '',
  topic: '',
  mode: 'recent',
  startTime: '',
  endTime: '',
  enabled: false,
  intervalMinutes: 120,
  maxPosts: 20,
  autoCards: true,
});
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
async function status() {
  const result = await api<XOverview>('/x');
  if (!disposed) overview.value = result;
}
async function refreshPending() {
  const pending = posts.value
    .filter(
      (p) =>
        !['COMPLETED', 'FAILED'].includes(p.indexStatus) ||
        (p.job && !['COMPLETED', 'FAILED'].includes(p.job.status)),
    )
    .slice(0, 100);
  if (!pending.length || disposed || importing.value || busy.value) return;
  const updates = await api<XPostView[]>('/x/status', {
    method: 'POST',
    body: JSON.stringify({ ids: pending.map((p) => p.id) }),
  });
  if (disposed) return;
  const byId = new Map(updates.map((p) => [p.id, p]));
  posts.value = posts.value.map((p) => byId.get(p.id) || p);
}
async function load(more = false) {
  const result = await api<{ items: XPostView[]; nextCursor: string | null }>(
    '/x/posts?' +
      filtersQuery({ ...filters, cursor: more ? cursor.value || undefined : undefined }),
  );
  if (disposed) return;
  posts.value = more ? [...posts.value, ...result.items] : result.items;
  cursor.value = result.nextCursor;
}
async function action(work: () => Promise<unknown>, success = '', refreshPosts = true) {
  error.value = '';
  busy.value = true;
  try {
    await work();
    if (success) message.value = success;
    await status();
    if (refreshPosts) await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function addRule() {
  await action(
    () =>
      api('/x/rules', {
        method: 'POST',
        body: JSON.stringify({
          ...rule,
          startTime:
            rule.mode === 'archive' && rule.startTime
              ? new Date(rule.startTime).toISOString()
              : undefined,
          endTime:
            rule.mode === 'archive' && rule.endTime
              ? new Date(rule.endTime).toISOString()
              : undefined,
        }),
      }),
    'Recherche enregistrée.',
  );
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  error.value = '';
  message.value = '';
  let added = 0,
    duplicates = 0,
    ignored = 0;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error('Maximum 10 Mo par fichier. Exportez par lots.');
    const value: unknown = JSON.parse(await file.text());
    const rows = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && 'posts' in value
        ? value.posts
        : null;
    if (!Array.isArray(rows) || !rows.length)
      throw new Error('Fichier attendu : tableau de publications ou objet avec un tableau posts.');
    let batch: unknown[] = [];
    async function send() {
      if (!batch.length) return;
      const result = await api<{ added: number; duplicates: number; ignored: number }>(
        '/x/import',
        { method: 'POST', body: JSON.stringify({ posts: batch, autoCards: true }) },
      );
      added += result.added;
      duplicates += result.duplicates;
      ignored += result.ignored;
      batch = [];
      message.value = `Import en cours : ${added} ajoutées, ${duplicates} déjà présentes, ${ignored} ignorées.`;
    }
    for (const row of rows) {
      if (new Blob([JSON.stringify({ posts: [row] })]).size > 350000) {
        ignored++;
        continue;
      }
      if (
        batch.length >= 100 ||
        new Blob([JSON.stringify({ posts: [...batch, row] })]).size > 350000
      )
        await send();
      batch.push(row);
    }
    await send();
    message.value = `Import terminé : ${added} ajoutées, ${duplicates} déjà présentes, ${ignored} ignorées. Indexation et fiches en arrière-plan.`;
  } catch (e) {
    error.value =
      (e as Error).message +
      ` Les lots déjà importés sont conservés (${added} ajouts). Vous pouvez relancer le fichier sans doublons.`;
  } finally {
    importing.value = false;
    input.value = '';
    try {
      await status();
      await load();
    } catch {
      /* Keep the import result visible. */
    }
  }
}
async function ask() {
  asking.value = true;
  error.value = '';
  answer.value = undefined;
  try {
    answer.value = await api<XAnswerView>('/x/ask', {
      method: 'POST',
      body: JSON.stringify({ question: question.value, mode: mode.value }),
    });
    await status();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    asking.value = false;
  }
}
async function openAnswer(id: string) {
  try {
    answer.value = await api<XAnswerView>('/x/answers/' + id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(async () => {
  await action(async () => {});
  timer = setInterval(() => {
    void status().catch(() => {});
    void refreshPending().catch(() => {});
  }, 5000);
});
onUnmounted(() => {
  disposed = true;
  clearInterval(timer);
});
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">SOURCES · SÉLECTION · RÉUTILISATION</p>
      <h1>Corpus X</h1>
      <p class="muted">
        Une bibliothèque de publications, au-delà des signets. Retrouvez les sources utiles pour vos
        questions.
      </p>
    </div>
    <button class="secondary" :disabled="busy" @click="action(async () => {})">Actualiser</button>
  </header>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="message" class="success" role="status">{{ message }}</p>
  <template v-if="overview">
    <div class="stats">
      <div>
        <small>PUBLICATIONS</small><strong>{{ overview.counts.posts }}</strong
        ><span>Sources conservées sans modification</span>
      </div>
      <div>
        <small>INDEXÉES</small><strong>{{ overview.counts.indexed }}</strong
        ><span>{{ overview.counts.failedIndex }} en échec</span>
      </div>
      <div>
        <small>LECTURES X RÉSERVÉES</small
        ><strong
          >{{ overview.limits.readsReservedToday }} / {{ overview.limits.readsPerDay }}</strong
        ><span>Plafond applicatif quotidien UTC</span>
      </div>
      <div>
        <small>FICHES SÉLECTIONNÉES</small
        ><strong
          >{{ overview.limits.cardsReservedToday }} / {{ overview.limits.autoCardsPerDay }}</strong
        ><RouterLink to="/inbox">Suivre les traitements</RouterLink>
      </div>
    </div>
    <p class="notice">
      {{
        overview.connection.xReady
          ? 'API X configurée : les collectes utilisent les droits et la facturation de votre compte X.'
          : 'API X non connectée. Importez vos captures V12 pour commencer sans accès développeur X.'
      }}
      {{
        overview.connection.aiReady
          ? 'Les questions et analyses envoient les textes sélectionnés à OpenAI.'
          : 'Mode extractif : recherche lexicale et extraits sourcés. Connectez OpenAI côté serveur pour les synthèses, plans et décisions IA.'
      }}
    </p>
    <section class="panel watch-form" aria-label="Import V12">
      <h2>Importer depuis l’extension V12</h2>
      <p class="muted">
        L’archive fournie contient le code de l’extension. Vos publications restent dans votre
        navigateur : exportez-les en JSON, puis choisissez ce fichier. Aucun jeton n’est demandé
        ici.
      </p>
      <p>
        <a href="/x-v12-export.zip" download>Télécharger le bouton d’export V12</a> ·
        <a href="/x-export/README.txt" target="_blank" rel="noopener">Installation</a>
      </p>
      <label
        >Fichier JSON de publications<input
          type="file"
          accept="application/json,.json"
          :disabled="importing"
          @change="importFile"
      /></label>
      <p class="muted">
        10 Mo maximum. Import par lots, doublons ignorés. Les signaux d’utilité sélectionnent
        automatiquement un nombre limité de fiches ; toutes les publications restent recherchables
        dans le corpus.
      </p>
    </section>
    <section class="panel">
      <h2>Interroger mon corpus</h2>
      <form class="watch-form" aria-label="Question au corpus" @submit.prevent="ask">
        <label
          >Votre question<textarea
            v-model="question"
            minlength="5"
            maxlength="1000"
            required
            rows="3"
            placeholder="Comment automatiser le reporting d’une université avec n8n ?"
          /></label
        ><label
          >Type de réponse<select v-model="mode">
            <option value="answer">Réponse sourcée / extraits</option>
            <option value="plan" :disabled="!overview.connection.aiReady">
              Plan d’action (IA)
            </option>
            <option value="decision" :disabled="!overview.connection.aiReady">
              Aide à la décision (IA)
            </option>
          </select></label
        ><button :disabled="asking || !overview.counts.posts">
          {{ asking ? 'Recherche des sources…' : 'Interroger le corpus' }}
        </button>
        <p v-if="!overview.counts.posts" class="muted">
          Importez des publications pour poser votre première question.
        </p>
      </form>
      <article v-if="answer" class="x-answer">
        <h3>{{ answer.question }}</h3>
        <p class="muted">{{ answer.model }} · {{ date(answer.createdAt) }}</p>
        <p v-for="warning in answer.warnings" :key="warning" class="notice">{{ warning }}</p>
        <section v-for="(section, i) in answer.sections" :key="i">
          <h3>
            {{ section.heading }}
            <small class="pill">{{
              section.kind === 'evidence' ? 'Issu des sources' : 'Recommandation générée'
            }}</small>
          </h3>
          <p class="prose">{{ section.text }}</p>
          <a
            v-for="citation in section.citations"
            :key="citation"
            class="x-citation"
            :href="'#source-' + answer.id + '-' + citation"
            >[B{{ citation }}]</a
          >
        </section>
        <h3>Pourquoi cette réponse ?</h3>
        <details
          v-for="source in answer.sources"
          :id="'source-' + answer.id + '-' + source.label"
          :key="source.label"
        >
          <summary>
            [B{{ source.label }}] Publication {{ source.postId }} · {{ date(source.publishedAt) }}
          </summary>
          <p class="muted">
            {{ source.origin }} ·
            {{
              source.coverage === 'post_and_quote'
                ? 'Publication et citation capturées'
                : 'Publication seule : fil et liens non lus'
            }}
            · Capture {{ date(source.capturedAt) }}
          </p>
          <p class="source-text">{{ source.text }}</p>
          <a :href="source.url" target="_blank" rel="noopener noreferrer">Ouvrir la source X</a>
        </details>
      </article>
      <details v-if="overview.answers.length">
        <summary>Réponses enregistrées</summary>
        <p v-for="item in overview.answers" :key="item.id">
          <button class="secondary x-history" @click="openAnswer(item.id)">
            {{ item.question }} · {{ date(item.createdAt) }}
          </button>
        </p>
      </details>
    </section>
    <section>
      <h2>Explorer les publications</h2>
      <form class="filters" @submit.prevent="action(() => load())">
        <label>Rechercher dans le corpus<input v-model="filters.q" maxlength="1000" /></label
        ><label
          >Sujet<select v-model="filters.topic">
            <option value="">Tous les sujets</option>
            <option v-for="topic in overview.topics" :key="topic">{{ topic }}</option>
          </select></label
        ><label
          >Tri<select v-model="filters.sort" :disabled="!!filters.q">
            <option value="recent">Captures récentes</option>
            <option value="oldest">Publications anciennes</option>
            <option value="useful">Signaux d’utilité</option>
            <option value="engagement">Popularité observée</option>
            <option value="momentum">Progression observée</option>
          </select></label
        ><button :disabled="busy">Rechercher</button>
      </form>
      <p class="muted">
        Les signaux d’utilité sont des règles lexicales, pas une note IA. La progression nécessite
        deux observations espacées. L’écart au corpus mesure une distance de texte, sans prouver une
        nouveauté. Une recherche affiche au maximum 50 résultats.
      </p>
      <div v-if="!posts.length" class="empty">
        {{
          overview.counts.posts
            ? 'Aucune publication ne correspond à ces filtres. Les métriques inconnues sont exclues du tri par popularité ou progression.'
            : 'Votre corpus X est prêt à recevoir ses premières publications.'
        }}
      </div>
      <article v-for="post in posts" :key="post.id" class="panel x-post">
        <div class="card-meta">
          <strong>{{ post.author }}</strong
          ><span class="pill">{{ post.origin === 'v12_import' ? 'Import V12' : 'API X' }}</span>
        </div>
        <p class="muted">
          Publication {{ date(post.publishedAt) }} · Capture {{ date(post.capturedAt) }} ·
          {{ post.indexStatus }}
        </p>
        <p class="prose">{{ post.text }}</p>
        <blockquote v-if="post.quotedText" class="source-text">{{ post.quotedText }}</blockquote>
        <div class="tags">
          <span v-for="topic in post.topics" :key="topic">{{ topic }}</span>
        </div>
        <p class="muted">
          Utilité : {{ post.utilitySignal }}/3 · Popularité : {{ post.engagement ?? 'inconnue' }} ·
          Progression/h : {{ post.momentum?.toFixed(1) ?? 'inconnue' }} · Écart au corpus :
          {{ post.novelty === null ? 'inconnu' : Math.round(post.novelty * 100) + ' %' }}
        </p>
        <p class="muted">
          {{
            post.coverage === 'post_and_quote'
              ? 'Publication et citation capturées.'
              : 'Publication seule.'
          }}
          Les liens externes et le fil complet ne sont pas inclus.
        </p>
        <div class="watch-actions">
          <a :href="post.url" target="_blank" rel="noopener noreferrer">Ouvrir sur X</a
          ><RouterLink v-if="post.job?.cardId" :to="'/knowledge/' + post.job.cardId"
            >Voir la fiche</RouterLink
          ><span v-else-if="post.job" class="pill">Fiche : {{ post.job.status }}</span
          ><button
            v-else
            class="secondary"
            :disabled="busy"
            @click="
              action(
                () => api('/x/posts/' + post.id + '/card', { method: 'POST' }),
                'Fiche envoyée au pipeline.',
              )
            "
          >
            Créer une fiche</button
          ><button
            v-if="post.indexStatus === 'FAILED'"
            class="secondary"
            @click="action(() => api('/x/posts/' + post.id + '/reindex', { method: 'POST' }))"
          >
            Relancer l’indexation
          </button>
        </div>
      </article>
      <button v-if="cursor" :disabled="busy" @click="action(() => load(true), '', false)">
        Charger la suite
      </button>
    </section>
    <details class="panel">
      <summary>Préparer les collectes officielles X</summary>
      <p class="muted">
        Ajoutez X_BEARER_TOKEN uniquement dans les variables du serveur. Aucun scraping ni
        contournement. La recherche récente et les archives dépendent des droits de votre compte.
        Une page par exécution ; les pages suivantes sont reprises aux exécutions suivantes.
      </p>
      <form class="watch-form" aria-label="Recherche X" @submit.prevent="addRule">
        <label>Nom de la recherche<input v-model="rule.name" required maxlength="120" /></label
        ><label
          >Requête X<input
            v-model="rule.query"
            required
            minlength="2"
            maxlength="512"
            placeholder="n8n (tutorial OR workflow) -is:retweet" /></label
        ><label>Sujet<input v-model="rule.topic" required maxlength="100" /></label
        ><label
          >Période<select v-model="rule.mode">
            <option value="recent">Récente</option>
            <option value="archive">Archives sur une période</option>
          </select></label
        ><template v-if="rule.mode === 'archive'"
          ><label>Début<input v-model="rule.startTime" type="datetime-local" required /></label
          ><label
            >Fin<input v-model="rule.endTime" type="datetime-local" required /></label></template
        ><label
          >Intervalle (minutes)<input
            v-model.number="rule.intervalMinutes"
            type="number"
            min="30"
            max="10080" /></label
        ><label
          >Publications par page<input
            v-model.number="rule.maxPosts"
            type="number"
            min="10"
            max="100" /></label
        ><label class="watch-checkbox"
          ><input v-model="rule.autoCards" type="checkbox" />Sélection automatique de fiches dans le
          plafond quotidien</label
        ><label class="watch-checkbox"
          ><input
            v-model="rule.enabled"
            type="checkbox"
            :disabled="!overview.connection.xReady"
          />Activer les collectes planifiées</label
        ><button :disabled="busy">Enregistrer la recherche</button>
      </form>
      <div v-for="item in overview.rules" :key="item.id" class="watch-run">
        <strong>{{ item.name }}</strong>
        <p>
          {{ item.query }} · {{ item.topic }} ·
          {{
            item.archiveComplete ? 'Archives parcourues' : item.enabled ? 'Planifiée' : 'En pause'
          }}
          {{ item.hasNextPage ? '· Suite disponible' : '' }}
        </p>
        <div class="watch-actions">
          <button
            class="secondary"
            :disabled="busy || !overview.connection.xReady || item.archiveComplete"
            @click="
              action(
                () => api('/x/rules/' + item.id + '/run', { method: 'POST' }),
                'Collecte mise en file.',
              )
            "
          >
            Collecter une page</button
          ><button
            class="secondary"
            :disabled="busy || !overview.connection.xReady || item.archiveComplete"
            @click="
              action(() =>
                api('/x/rules/' + item.id, {
                  method: 'PATCH',
                  body: JSON.stringify({ enabled: !item.enabled }),
                }),
              )
            "
          >
            {{ item.enabled ? 'Mettre en pause' : 'Activer' }}
          </button>
        </div>
      </div>
      <div v-for="run in overview.runs" :key="run.id" class="watch-run">
        <span class="pill">{{ run.status }}</span> {{ run.fetched }} reçues ·
        {{ run.added }} nouvelles · {{ date(run.createdAt) }}
        <p v-if="run.errorMessage" class="error">{{ run.errorMessage }}</p>
      </div>
    </details>
  </template>
</template>
