<script setup lang="ts">
import type { CardView } from '@knowledge/shared';
import { date } from '../api';
defineProps<{ cards: CardView[]; empty?: string; similarity?: boolean }>();
</script>
<template>
  <div v-if="cards.length" class="card-grid">
    <RouterLink
      v-for="card in cards"
      :key="card.id"
      class="knowledge-card"
      :to="'/knowledge/' + card.id"
    >
      <div class="card-meta">
        <span class="source">{{ card.content.sourceId }}</span
        ><span class="score">{{ card.globalScore.toFixed(1) }}<small> / 10</small></span>
      </div>
      <h3>{{ card.title }}</h3>
      <p class="excerpt">{{ card.summary }}</p>
      <div class="tags">
        <span v-for="topic in card.topics.slice(0, 4)" :key="topic.id">{{ topic.name }}</span>
      </div>
      <div class="card-footer">
        <time>{{ date(card.content.capturedAt) }}</time
        ><span v-if="similarity && card.similarity !== undefined"
          >Similarité {{ (card.similarity * 100).toFixed(1) }} %</span
        ><span v-else>Ouvrir ↗</span>
      </div>
    </RouterLink>
  </div>
  <div v-else class="empty">
    {{ empty || 'Votre bibliothèque attend ses premières idées.' }}
    <RouterLink to="/inbox">Ajouter une ressource →</RouterLink>
  </div>
</template>
