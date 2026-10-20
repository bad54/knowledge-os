<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Label } from '@knowledge/shared';
import { api } from '../api';
export interface FilterValues {
  source: string;
  topic: string;
  minScore: string;
  from: string;
  to: string;
}
const model = defineModel<FilterValues>({ required: true });
defineEmits<{ apply: [] }>();
const topics = ref<Label[]>([]);
onMounted(async () => {
  try {
    topics.value = await api<Label[]>('/topics');
  } catch {
    /* Parent page displays request errors. */
  }
});
</script>
<template>
  <div class="filters">
    <label
      >Source<select v-model="model.source">
        <option value="">Toutes</option>
        <option
          v-for="source in ['manual', 'web', 'youtube', 'reddit', 'x']"
          :key="source"
          :value="source"
        >
          {{ source }}
        </option>
      </select></label
    >
    <label
      >Topic<select v-model="model.topic">
        <option value="">Tous les topics</option>
        <option v-for="topic in topics" :key="topic.id" :value="topic.name">
          {{ topic.name }}
        </option>
      </select></label
    >
    <label
      >Score minimum<input
        v-model="model.minScore"
        type="number"
        min="0"
        max="10"
        step=".5"
        placeholder="0"
    /></label>
    <label>Capturé depuis<input v-model="model.from" type="date" /></label>
    <label>Jusqu’au<input v-model="model.to" type="date" /></label>
    <button class="secondary" @click="$emit('apply')">Appliquer</button>
  </div>
</template>
