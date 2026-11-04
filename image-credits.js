#!/usr/bin/env node
'use strict';

/* ============================================================================
   CRÉDITS DANS LES FICHIERS PHOTO (métadonnées XMP / IPTC) — 04/11/2026
   ----------------------------------------------------------------------------
   Écrit dans chaque photo du site (JPEG d'origine + ses 3 variantes WebP) :
     - Créateur (dc:creator)          : Alexis Vassivière
     - Crédit (photoshop:Credit)      : Alexis Vassivière
     - Copyright (dc:rights)          : © Alexis Vassivière — Tous droits réservés
     - Contact du créateur (IPTC)     : site + e-mail
   Google Images lit ces champs (« Crédits de l'image » : créateur, crédit,
   copyright) ; ils restent aussi attachés au fichier s'il est copié ailleurs.

   SANS PERTE : l'image n'est pas réencodée. Le script ajoute seulement un
   bloc de métadonnées (segment APP1 pour un JPEG, bloc « XMP » pour un WebP)
   et garde la date de modification du fichier (sinon `npm run webp`
   croirait les JPEG plus récents que leurs WebP et les régénérerait tous).

   Photos concernées : celles du seed d'index.html (accueil + projets), avec
   leurs variantes -480/-960/-1600.webp. Idempotent : une photo qui a déjà ces
   crédits est sautée ; une photo qui a déjà d'AUTRES métadonnées XMP n'est
   pas touchée (avertissement).

   Pas de licence déclarée (champs « Web Statement of Rights » / « Licensor
   URL ») : ils feraient afficher « Sous licence » dans Google Images —
   décision à prendre par Alexis, voir HANDOFF.md.

   Usage : node image-credits.js   (lancé aussi par `npm run build`, donc à
   chaque déploiement Vercel : une nouvelle photo reçoit ses crédits toute
   seule). `node image-credits.js --check` : liste sans rien écrire.
   ============================================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CHECK_ONLY = process.argv.includes('--check');
const CREDIT = 'Alexis Vassivière';
const XMP_ID = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

const XMP_PACKET = Buffer.from(
`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    photoshop:Credit="${CREDIT}"
    xmpRights:Marked="True">
   <dc:creator><rdf:Seq><rdf:li>${CREDIT}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© ${CREDIT} — Tous droits réservés / All rights reserved</rdf:li></rdf:Alt></dc:rights>
   <Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource">
    <Iptc4xmpCore:CiUrlWork>https://www.alexisvassiviere.com/</Iptc4xmpCore:CiUrlWork>
    <Iptc4xmpCore:CiEmailWork>contact@alexisvassiviere.com</Iptc4xmpCore:CiEmailWork>
   </Iptc4xmpCore:CreatorContactInfo>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="r"?>`, 'utf8');

// Nos crédits sont-ils déjà dans ce bloc XMP ?
const isOurs = xmp => xmp.includes(Buffer.from(`photoshop:Credit="${CREDIT}"`, 'utf8'));

// ---------------------------------------------------------------- JPEG ----
// Renvoie { xmp: Buffer|null, insertAt } : bloc XMP existant éventuel, et
// position d'insertion (après l'APP0 JFIF s'il est en tête, sinon après SOI).
function scanJpeg(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('pas un JPEG');
  let off = 2, insertAt = 2, xmp = null, first = true;
  while (off + 4 <= buf.length && buf[off] === 0xFF) {
    const marker = buf[off + 1];
    if (marker === 0xDA || marker === 0xD9) break; // début des données image
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xE1 && buf.slice(off + 4, off + 4 + XMP_ID.length).equals(XMP_ID)) {
      xmp = buf.slice(off + 4 + XMP_ID.length, off + 2 + len);
    }
    if (first && marker === 0xE0) insertAt = off + 2 + len;
    first = false;
    off += 2 + len;
  }
  return { xmp, insertAt };
}
function addXmpJpeg(buf) {
  const { xmp, insertAt } = scanJpeg(buf);
  if (xmp) return { status: isOurs(xmp) ? 'déjà fait' : 'autre XMP' };
  const len = 2 + XMP_ID.length + XMP_PACKET.length;
  if (len > 0xFFFF) throw new Error('bloc XMP trop long');
  const head = Buffer.from([0xFF, 0xE1, len >> 8, len & 0xFF]);
  return { status: 'ajouté', out: Buffer.concat([buf.slice(0, insertAt), head, XMP_ID, XMP_PACKET, buf.slice(insertAt)]) };
}

// ---------------------------------------------------------------- WebP ----
function readChunks(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('pas un WebP');
  const chunks = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    chunks.push({ id, data: buf.slice(off + 8, off + 8 + size) });
    off += 8 + size + (size & 1);
  }
  return chunks;
}
function writeChunks(chunks) {
  const parts = [];
  for (const c of chunks) {
    const h = Buffer.alloc(8);
    h.write(c.id, 0, 'latin1');
    h.writeUInt32LE(c.data.length, 4);
    parts.push(h, c.data);
    if (c.data.length & 1) parts.push(Buffer.from([0]));
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
function u24(n) { return Buffer.from([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF]); }
function addXmpWebp(buf) {
  const chunks = readChunks(buf);
  const existing = chunks.find(c => c.id === 'XMP ');
  if (existing) return { status: isOurs(existing.data) ? 'déjà fait' : 'autre XMP' };
  const first = chunks[0];
  if (first.id === 'VP8X') {
    first.data = Buffer.from(first.data);
    first.data[0] |= 0x04; // drapeau « XMP présent »
  } else {
    // Format simple (VP8 avec perte / VP8L sans perte) : il faut un en-tête
    // étendu VP8X (drapeaux + taille du canevas) pour pouvoir ajouter du XMP.
    let w, h, flags = 0x04;
    if (first.id === 'VP8 ') {
      const d = first.data;
      if (d[3] !== 0x9D || d[4] !== 0x01 || d[5] !== 0x2A) throw new Error('VP8 : signature invalide');
      w = d.readUInt16LE(6) & 0x3FFF;
      h = d.readUInt16LE(8) & 0x3FFF;
    } else if (first.id === 'VP8L') {
      const d = first.data;
      if (d[0] !== 0x2F) throw new Error('VP8L : signature invalide');
      const v = d.readUInt32LE(1);
      w = (v & 0x3FFF) + 1;
      h = ((v >>> 14) & 0x3FFF) + 1;
      if ((v >>> 28) & 1) flags |= 0x10; // transparence
    } else {
      throw new Error(`WebP : premier bloc inattendu ${first.id}`);
    }
    const vp8x = Buffer.concat([Buffer.from([flags, 0, 0, 0]), u24(w - 1), u24(h - 1)]);
    chunks.unshift({ id: 'VP8X', data: vp8x });
  }
  chunks.push({ id: 'XMP ', data: XMP_PACKET });
  return { status: 'ajouté', out: writeChunks(chunks) };
}

// ------------------------------------------------- photos du site (seed) ----
function sitePhotoFiles() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = src.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('seed-data introuvable dans index.html');
  const seed = JSON.parse(m[1]);
  const srcs = [...(seed.photos || []), ...(seed.projects || []).flatMap(p => p.photos || [])]
    .map(p => p && p.src).filter(s => s && !/^(data:|idb:)/.test(s));
  const files = new Set();
  for (const s of srcs) {
    const rel = decodeURIComponent(s.replace(/^\//, ''));
    files.add(rel);
    const base = rel.replace(/\.jpe?g$/i, '');
    if (base !== rel) for (const w of [480, 960, 1600]) files.add(`${base}-${w}.webp`);
  }
  return [...files].filter(f => fs.existsSync(path.join(ROOT, f)));
}

const counts = {};
for (const rel of sitePhotoFiles()) {
  const abs = path.join(ROOT, rel);
  let res;
  try {
    const buf = fs.readFileSync(abs);
    res = /\.webp$/i.test(rel) ? addXmpWebp(buf) : /\.jpe?g$/i.test(rel) ? addXmpJpeg(buf) : { status: 'ignoré' };
  } catch (e) {
    res = { status: 'erreur' };
    console.warn(`⚠️  ${rel} : ${e.message}`);
  }
  if (res.status === 'autre XMP') console.warn(`⚠️  ${rel} : contient déjà d'autres métadonnées XMP, non modifié`);
  if (res.out && !CHECK_ONLY) {
    const st = fs.statSync(abs);
    fs.writeFileSync(abs, res.out);
    fs.utimesSync(abs, st.atime, st.mtime); // date de modification conservée
  }
  const key = res.out && CHECK_ONLY ? 'à ajouter' : res.status;
  counts[key] = (counts[key] || 0) + 1;
}
// Une photo en erreur est signalée mais ne bloque pas le build (ni le déploiement).
console.log('Crédits photo :', Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));
