// Fotos de cadastro (rosto) para exibição no painel e envio ao leitor facial.
// Guardadas em disco (não no JSON da pessoa), com validação de tipo e tamanho.
// LGPD: dado biométrico sensível — coletar com consentimento e permitir exclusão.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHOTO_DIR = process.env.PHOTO_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'photos');
export const MAX_BYTES = Number(process.env.PHOTO_MAX_BYTES || 400 * 1024);

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Aceita data URL ("data:image/jpeg;base64,...") ou base64 puro.
export function parsePhoto(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i.exec(raw);
  const mime = dataUrl ? dataUrl[1].toLowerCase() : 'image/jpeg';
  const b64 = (dataUrl ? dataUrl[2] : raw).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return { mime, buffer: Buffer.from(b64, 'base64') };
}

// Confere tamanho e assinatura do arquivo (não confia no mime declarado).
export function validatePhoto({ mime, buffer }) {
  if (!buffer || buffer.length === 0) return { ok: false, error: 'foto vazia' };
  if (buffer.length > MAX_BYTES) return { ok: false, error: `foto maior que ${Math.round(MAX_BYTES / 1024)} KB` };
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isWebp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  const real = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null;
  if (!real) return { ok: false, error: 'formato inválido (use JPEG, PNG ou WebP)' };
  return { ok: true, mime: real, ext: EXT_BY_MIME[real], bytes: buffer.length };
}

function safeId(id) {
  const raw = String(id || '');
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '');
  if (!clean || clean !== raw || clean.length > 64) throw new Error('id inválido');
  return clean;
}

export function savePhoto(id, buffer, ext) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const base = safeId(id);
  for (const e of Object.keys(MIME_BY_EXT)) {
    const old = path.join(PHOTO_DIR, `${base}.${e}`);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  fs.writeFileSync(path.join(PHOTO_DIR, `${base}.${ext}`), buffer);
  return `${base}.${ext}`;
}

export function readPhoto(id, ext) {
  if (!ext || !MIME_BY_EXT[ext]) return null;
  const file = path.join(PHOTO_DIR, `${safeId(id)}.${ext}`);
  if (!fs.existsSync(file)) return null;
  return { buffer: fs.readFileSync(file), mime: MIME_BY_EXT[ext] };
}

export function deletePhoto(id) {
  for (const e of Object.keys(MIME_BY_EXT)) {
    const file = path.join(PHOTO_DIR, `${safeId(id)}.${e}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

export function photoCount() {
  if (!fs.existsSync(PHOTO_DIR)) return 0;
  return fs.readdirSync(PHOTO_DIR).filter((f) => /\.(jpg|png|webp)$/i.test(f)).length;
}
