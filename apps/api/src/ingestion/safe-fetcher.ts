import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import ipaddr from 'ipaddr.js';
import { ContentFetcher, PipelineError } from '@knowledge/domain';

export function validatePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PipelineError('INVALID_URL', 'URL invalide', false);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
  ) {
    throw new PipelineError(
      'INVALID_URL',
      'Seules les URL HTTP(S) publiques sur leurs ports standard sont acceptées',
      false,
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !host.includes(':'))
  ) {
    throw new PipelineError('UNSAFE_URL', 'Adresse privée refusée', false);
  }
  if (ipaddr.isValid(host) && !isPublicIp(host))
    throw new PipelineError('UNSAFE_URL', 'Adresse privée ou réservée refusée', false);
  return url;
}
export function isPublicIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function canonicalUrl(input: string): string {
  const url = validatePublicUrl(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export class SafeFetcher implements ContentFetcher {
  async fetch(input: string, headers: Record<string, string> = {}) {
    const deadline = Date.now() + 20000;
    let current = validatePublicUrl(input);
    let requestHeaders = { ...headers };
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (Date.now() >= deadline)
        throw new PipelineError('FETCH_TIMEOUT', 'Délai de téléchargement dépassé');
      const hostname = current.hostname.replace(/^\[|\]$/g, '');
      const addresses = await Promise.race([
        lookup(hostname, { all: true }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new PipelineError('DNS_TIMEOUT', 'Résolution DNS trop lente')),
            5000,
          );
          timer.unref();
        }),
      ]);
      if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
        throw new PipelineError(
          'UNSAFE_URL',
          'La résolution DNS contient une adresse non publique',
          false,
        );
      const pinned = addresses[0];
      const response = await new Promise<{
        status: number;
        location?: string;
        text: string;
        contentType: string;
      }>((resolve, reject) => {
        const transport = current.protocol === 'https:' ? https : http;
        const request = transport.request(
          current,
          {
            method: 'GET',
            headers: {
              'user-agent': 'KnowledgeOS/1.0 (personal knowledge capture)',
              accept: 'text/html,text/plain,application/json',
              ...requestHeaders,
            },
            lookup: (_host, options, callback) => {
              if (options.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
          (response) => {
            let size = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024)
                request.destroy(
                  new PipelineError('TOO_LARGE', 'Ressource supérieure à 2 Mo', false),
                );
              else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () =>
              resolve({
                status: response.statusCode || 0,
                location: response.headers.location,
                text: Buffer.concat(chunks).toString('utf8'),
                contentType: response.headers['content-type'] || '',
              }),
            );
          },
        );
        const timer = setTimeout(
          () =>
            request.destroy(new PipelineError('FETCH_TIMEOUT', 'Délai de téléchargement dépassé')),
          Math.max(1, deadline - Date.now()),
        );
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
        request.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        const next = validatePublicUrl(new URL(response.location, current).toString());
        if (next.origin !== current.origin) requestHeaders = {};
        current = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new PipelineError(
          'HTTP_' + response.status,
          'La source a répondu HTTP ' + response.status,
          response.status >= 500 || response.status === 429,
        );
      return { text: response.text, url: current.toString(), contentType: response.contentType };
    }
    throw new PipelineError('REDIRECT_LIMIT', 'Trop de redirections', false);
  }
}
