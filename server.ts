import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 60 * 1024 * 1024; // 60 MB
const FETCH_TIMEOUT_MS = 25000;
const MAX_REDIRECTS = 5;

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  let clean = ip.trim().toLowerCase();
  if (clean.startsWith('::ffff:')) {
    clean = clean.slice(7);
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::1' || clean === '::') return true;
    if (clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) return true;
    return false;
  }

  return true;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Solo se permiten enlaces HTTP o HTTPS.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Host local o interno no permitido.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Dirección IP privada no permitida.');
    }
    return parsed;
  }

  const records = await dns.lookup(hostname, { all: true });
  if (!records || records.length === 0) {
    throw new Error('No se pudo resolver el dominio del PDF.');
  }
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      throw new Error('El dominio resuelve a una IP privada no permitida.');
    }
  }
  return parsed;
}

function normalizeExternalPdfUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);

    // GitHub blob -> raw.githubusercontent.com
    if (u.hostname === 'github.com') {
      const match = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
      }
    }

    // Dropbox share -> dl.dropboxusercontent.com
    if (u.hostname === 'www.dropbox.com' || u.hostname === 'dropbox.com') {
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('dl');
      u.searchParams.set('raw', '1');
      return u.toString();
    }

    // Google Drive /file/d/{id}/view -> uc?export=download&id={id}
    if (u.hostname === 'drive.google.com') {
      const fileMatch = u.pathname.match(/^\/file\/d\/([^/]+)/);
      if (fileMatch) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileMatch[1])}`;
      }
      const idParam = u.searchParams.get('id');
      if (idParam && (u.pathname === '/open' || u.pathname === '/uc')) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(idParam)}`;
      }
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

async function fetchPdfFollowingSafeRedirects(initialUrl: string): Promise<globalThis.Response> {
  let currentUrl = normalizeExternalPdfUrl(initialUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafePublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let resp: globalThis.Response;
    try {
      resp = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'FlipbookOpenSourceViewer/1.0 (+https://github.com)',
          Accept: 'application/pdf,application/octet-stream,*/*;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) {
        throw new Error('Redirección sin destino válido.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return resp;
  }

  throw new Error('Demasiadas redirecciones al intentar descargar el PDF.');
}

async function readBoundedBuffer(resp: globalThis.Response): Promise<Buffer> {
  const declaredLen = Number(resp.headers.get('content-length') || 0);
  if (declaredLen > MAX_PDF_BYTES) {
    throw new Error('El archivo PDF supera el límite máximo permitido (60 MB).');
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > MAX_PDF_BYTES) {
      throw new Error('El archivo PDF supera el límite máximo permitido (60 MB).');
    }
    return Buffer.from(ab);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error('El archivo PDF supera el límite máximo permitido (60 MB).');
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks, total);
}

function isPdfMagicBytes(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  const head = buf.subarray(0, 1024).toString('latin1');
  return head.includes('%PDF-');
}

async function startServer() {
  const app = express();

  app.get('/api/pdf-proxy', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Falta el parámetro url.' });
      return;
    }

    try {
      let resp = await fetchPdfFollowingSafeRedirects(rawUrl);

      if (!resp.ok) {
        res.status(resp.status === 404 ? 404 : 502).json({
          error: `El servidor remoto devolvió el estado HTTP ${resp.status}.`,
        });
        return;
      }

      let buf = await readBoundedBuffer(resp);

      // Si Google Drive muestra página de confirmación HTML de descarga grande, seguir el enlace real
      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      if (!isPdfMagicBytes(buf) && contentType.includes('text/html') && rawUrl.includes('drive.google.com')) {
        const html = buf.toString('utf8');
        const confirmAction = html.match(/action="([^"]+drive\.usercontent\.google\.com[^"]+)"/i);
        const idMatch = html.match(/name="id"\s+value="([^"]+)"/i);
        const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/i);
        const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/i);

        if (confirmAction && idMatch) {
          const confirmUrl = new URL(confirmAction[1].replace(/&amp;/g, '&'));
          confirmUrl.searchParams.set('id', idMatch[1]);
          confirmUrl.searchParams.set('export', 'download');
          if (confirmMatch) confirmUrl.searchParams.set('confirm', confirmMatch[1]);
          if (uuidMatch) confirmUrl.searchParams.set('uuid', uuidMatch[1]);
          resp = await fetchPdfFollowingSafeRedirects(confirmUrl.toString());
          if (resp.ok) {
            buf = await readBoundedBuffer(resp);
          }
        }
      }

      if (!isPdfMagicBytes(buf)) {
        res.status(422).json({
          error:
            'El enlace proporcionado no devuelve un archivo PDF válido (posible página web o acceso privado que requiere inicio de sesión).',
        });
        return;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error descargando el PDF remoto.';
      res.status(400).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Flipbook server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
