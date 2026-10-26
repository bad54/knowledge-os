import { expect, test } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Ajouter à mon Inbox' }).click();
  await expect(page.getByRole('status')).toContainText('Ressource ajoutée');
  await expect(page.locator('.job').first().getByText('COMPLETED', { exact: true })).toBeVisible();
  await page.locator('.job').first().getByRole('link', { name: 'Voir la fiche' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByText('Texte source original', { exact: true }).click();
  await expect(page.locator('.source-text').first()).toContainText(
    'provenance de chaque indicateur',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Réanalyser', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.locator('.job').first().getByText('COMPLETED', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Recherche', exact: true }).click();
  await page.getByLabel('Votre recherche').fill(title);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.locator('.knowledge-card').filter({ hasText: title })).toBeVisible();
});
test('web URL capture retains its source URL', async ({ page }) => {
  await page.goto('/inbox');
  await page
    .getByLabel('URL de la ressource', { exact: true })
    .fill('https://example.com/e2e-' + Date.now());
  await page.getByRole('button', { name: 'Ajouter à mon Inbox' }).click();
  await expect(page.locator('.job').first().getByText('COMPLETED', { exact: true })).toBeVisible();
  await page.locator('.job').first().getByRole('link', { name: 'Voir la fiche' }).click();
  await expect(
    page.getByRole('heading', { name: 'Article web de test', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la source originale' })).toHaveAttribute(
    'href',
    /https:\/\/example.com\/e2e-/,
  );
});
test('fetch errors are visible and can be retried', async ({ page }) => {
  await page.goto('/inbox');
  await page
    .getByLabel('URL de la ressource', { exact: true })
    .fill('https://example.com/forbidden');
  await page.getByRole('button', { name: 'Ajouter à mon Inbox' }).click();
  const job = page.locator('.job').first();
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
