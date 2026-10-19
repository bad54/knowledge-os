import 'reflect-metadata';
import { loadConfig } from './config';
import { Database } from './infrastructure/database';
import { JobsRepository } from './processing/jobs.repository';
import { ContentRepository } from './processing/content.repository';
import { AdapterRegistry, ManualTextAdapter } from './ingestion/adapters';
import { LocalProvider } from './ai/providers';
import { Pipeline } from './processing/pipeline';
async function main() {
  loadConfig();
  const db = new Database();
  await db.$connect();
  const jobs = new JobsRepository(db);
  const pipeline = new Pipeline(
    jobs,
    new ContentRepository(db),
    new AdapterRegistry([new ManualTextAdapter()]),
    new LocalProvider(),
  );
  try {
    for (const [title, text] of [
      [
        'Reporting universitaire',
        'Exemple fictif : un reporting universitaire fiable commence par un dictionnaire des indicateurs. Les exports doivent conserver leurs dates de collecte et leurs sources. Un contrôle de qualité précède la publication.',
      ],
      [
        'Automatiser avec n8n',
        'Exemple fictif : n8n peut orchestrer une collecte quotidienne via un webhook. La logique de validation reste dans le backend. Chaque traitement conserve un statut, un identifiant et les erreurs nécessaires à une relance.',
      ],
      [
        'Conserver la provenance',
        'Exemple fictif : chaque idée analysée doit rester reliée au texte original. Les interprétations automatiques sont conservées séparément. Les versions des analyses permettent de comprendre les changements.',
      ],
    ]) {
      await jobs.create({ title, text });
      // Seed before starting the API, so only this local provider consumes these demo jobs.
      await pipeline.runOnce();
    }
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  process.stderr.write('Échec du seed. Vérifiez DATABASE_URL et les migrations.\n');
  process.exitCode = 1;
});
