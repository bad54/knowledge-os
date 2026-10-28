import { expect, test, type Page } from '@playwright/test';
// Follow the job created by this submission, even while an older list is visible.
async function captureJob(page: Page) {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/jobs' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter à mon Inbox' }).click();
  const submitted = await response;
  expect(submitted.status()).toBe(202);
  const { id } = (await submitted.json()) as { id: string };
  return page.locator('.job').filter({ hasText: id });
}
test('V12 JSON import, automatic card, corpus search and cited extracts work on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/x');
  await expect(page.getByRole('heading', { name: 'Corpus X', exact: true })).toBeVisible();
  const data = {
    posts: [
      {
        post_id: '88888001',
        text: 'Guide n8n pour automatiser le reporting universitaire. Un exemple de workflow conserve la provenance de chaque indicateur.',
        author_name: 'Source E2E X',
        url: 'https://x.com/test/status/88888001',
        openaiKey: 'never-export-this',
      },
    ],
  };
  await page.getByLabel('Fichier JSON de publications').setInputFiles({
    name: 'v12.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByRole('status')).toContainText('Import terminé : 1 ajoutées');
  const post = page.locator('.x-post').filter({ hasText: 'Source E2E X' });
  await expect(post).toBeVisible();
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(post.getByRole('link', { name: 'Voir la fiche' })).toBeVisible({ timeout: 20000 });
  await expect(post).toContainText('COMPLETED', { timeout: 20000 });
  await page
    .getByLabel('Votre question', { exact: true })
    .fill('Comment automatiser le reporting universitaire avec n8n ?');
  await page.getByRole('button', { name: 'Interroger le corpus', exact: true }).click();
  await expect(page.locator('.x-answer')).toContainText('Aucune synthèse');
  await page.locator('.x-answer summary').filter({ hasText: '88888001' }).click();
  await expect(page.locator('.x-answer .source-text')).toContainText(
    'provenance de chaque indicateur',
  );
  await expect(page.locator('.x-answer')).not.toContainText('never-export-this');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('x-corpus-mobile.png'), fullPage: true });
  await page.reload();
  await expect(page.getByText('Réponses enregistrées', { exact: true })).toBeVisible();
  await page.getByLabel('Fichier JSON de publications').setInputFiles({
    name: 'v12.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByRole('status')).toContainText('0 ajoutées, 1 déjà présentes');
});
test('RSS watch settings, collection, approval and resulting card work on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/watch');
  await expect(page.getByRole('heading', { name: 'Ma veille', exact: true })).toBeVisible();
  const criteria = page.getByRole('form', { name: 'Réglages de veille' });
  await criteria.getByLabel('Sujets (séparés par des virgules)', { exact: true }).fill('n8n');
  await criteria.getByLabel('Langues (codes séparés par des virgules)', { exact: true }).fill('fr');
  await criteria.getByRole('button', { name: 'Enregistrer mes critères' }).click();
  await expect(page.getByRole('status')).toContainText('Réglages enregistrés');
  const source = page.getByRole('form', { name: 'Ajouter un flux' });
  await source.getByLabel('Nom du flux', { exact: true }).fill('Flux de veille E2E');
  await source
    .getByLabel('URL du flux RSS ou Atom', { exact: true })
    .fill('https://example.com/watch-feed');
  await source.getByRole('button', { name: 'Ajouter le flux', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Flux enregistré');
  await page.getByRole('button', { name: 'Lancer ma veille', exact: true }).click();
  const candidate = page.locator('.watch-candidate').filter({ hasText: 'Veille n8n et reporting' });
  await expect(candidate).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.watch-candidate')).toHaveCount(1);
  await expect(candidate).toContainText('fiabilité non évaluées');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await candidate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('watch-selection-mobile.png') });
  await candidate.getByRole('button', { name: 'Garder', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('envoyée à l’Inbox');
  await page.getByRole('link', { name: 'Voir la fiche', exact: true }).click({ timeout: 20000 });
  await expect(
    page.getByRole('heading', { name: 'Veille n8n et reporting', exact: true }),
  ).toBeVisible();
  await page.getByText('Texte source original', { exact: true }).click();
  await expect(page.locator('.source-text').first()).toContainText('contenu intégral');
  await page.goto('/watch');
  await expect(
    criteria.getByLabel('Sujets (séparés par des virgules)', { exact: true }),
  ).toHaveValue('n8n');
  await expect(page.locator('.watch-candidate')).toHaveCount(0);
});
test('private library requires a key and locking clears the displayed data', async ({
  page,
  request,
}) => {
  // The real API auth guard is covered by integration tests. This boundary exercises
  // the browser's handling of its 401 responses without production credentials.
  const key = 'browser-test-key';
  const title = 'Private library E2E ' + Date.now();
  const created = await request.post('http://127.0.0.1:3101/api/jobs', {
    data: {
      title,
      text: 'Conserver la provenance et protéger les connaissances personnelles. ' + title,
    },
  });
  expect(created.ok()).toBe(true);
  const job = (await created.json()) as { id: string };
  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:3101/api/jobs/' + job.id);
      return ((await response.json()) as { status: string }).status;
    })
    .toBe('COMPLETED');
  await page.route('**/api/**', async (route) => {
    if (route.request().headers().authorization === 'Bearer ' + key) await route.continue();
    else await route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/knowledge');
  const locked = page.getByRole('heading', { name: 'Votre bibliothèque est verrouillée' });
  await expect(locked).toBeVisible();
  await expect(page.locator('.knowledge-card')).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Connexion privée' });
  await form.getByLabel('Clé d’accès privée').fill('wrong-key');
  await form.getByRole('button', { name: 'Ouvrir ma bibliothèque' }).click();
  await expect(form.getByRole('alert')).toContainText('une clé valide');
  await expect(locked).toBeVisible();
  await form.getByLabel('Clé d’accès privée').fill(key);
  await form.getByRole('button', { name: 'Ouvrir ma bibliothèque' }).click();
  await expect(page.locator('.knowledge-card').filter({ hasText: title })).toBeVisible();
  await page.reload();
  await expect(page.locator('.knowledge-card').filter({ hasText: title })).toBeVisible();
  await page.getByRole('button', { name: 'Verrouiller', exact: true }).click();
  await expect(locked).toBeVisible();
  await expect(page.locator('.knowledge-card')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('knowledge-api-token'))).toBeNull();
  await page.reload();
  await expect(locked).toBeVisible();
});
test('manual capture, card, source provenance, search and reanalysis', async ({ page }) => {
  const title = 'Reporting E2E ' + Date.now();
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Texte manuel', exact: true }).click();
  await page.getByLabel('Titre (facultatif)').fill(title);
  await page
    .getByLabel('Texte source', { exact: true })
    .fill(
      'Automatiser le reporting universitaire avec n8n. Conserver des données fiables et la provenance de chaque indicateur. Réduire les opérations manuelles pour gagner du temps. ' +
        title,
    );
  const job = await captureJob(page);
  await expect(page.getByRole('status')).toContainText('Ressource ajoutée');
  await expect(job.getByText('COMPLETED', { exact: true })).toBeVisible();
  await job.getByRole('link', { name: 'Voir la fiche' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByText('Texte source original', { exact: true }).click();
  await expect(page.locator('.source-text').first()).toContainText(
    'provenance de chaque indicateur',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const reanalysisResponse = page.waitForResponse(
    (r) => r.url().endsWith('/reanalyze') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Réanalyser', exact: true }).click();
  const reanalysis = await reanalysisResponse;
  expect(reanalysis.status()).toBe(202);
  const { id } = (await reanalysis.json()) as { id: string };
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(
    page.locator('.job').filter({ hasText: id }).getByText('COMPLETED', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Recherche', exact: true }).click();
  await page.getByLabel('Votre recherche').fill(title);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.knowledge-card').filter({ hasText: title })).toBeVisible();
});
test('web URL capture retains its source URL', async ({ page }) => {
  // Keep a snapshot of the old list in flight while a new job is submitted.
  // This reproduces the CI race without relying on timing or arbitrary sleeps.
  let releaseSnapshot!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  let snapshotReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  let first = true;
  await page.route('**/api/jobs', async (route) => {
    if (route.request().method() === 'GET' && first) {
      first = false;
      const snapshot = await route.fetch();
      snapshotReady();
      await gate;
      await route.fulfill({ response: snapshot });
    } else await route.continue();
  });
  await page.goto('/inbox');
  await ready;
  const sourceUrl = 'https://example.com/e2e-' + Date.now();
  await page.getByLabel('URL de la ressource', { exact: true }).fill(sourceUrl);
  const job = await captureJob(page);
  releaseSnapshot();
  await expect(job.getByText('COMPLETED', { exact: true })).toBeVisible();
  await job.getByRole('link', { name: 'Voir la fiche' }).click();
  await expect(
    page.getByRole('heading', { name: 'Article web de test', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la source originale' })).toHaveAttribute(
    'href',
    sourceUrl,
  );
});
test('fetch errors are visible and can be retried', async ({ page }) => {
  await page.goto('/inbox');
  await page
    .getByLabel('URL de la ressource', { exact: true })
    .fill('https://example.com/forbidden');
  const job = await captureJob(page);
  await expect(job.getByText('FAILED', { exact: true })).toBeVisible();
  await expect(job).toContainText('HTTP 403');
  await job.getByRole('button', { name: 'Relancer' }).click();
  await expect(job.getByText('FAILED', { exact: true })).toBeVisible();
  await expect(job).toContainText('tentative 2');
});
test('mobile navigation and layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'De l’information à la connaissance.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Bibliothèque', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bibliothèque', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
