/* ============================================================================
   GÉNÉRATION DES VARIANTES WEBP RESPONSIVE (audit 4.1)
   ----------------------------------------------------------------------------
   Pour chaque JPEG de images/ACCUEIL/ et images/embedded/, produit trois
   variantes WebP redimensionnées : <nom>-480.webp, <nom>-960.webp,
   <nom>-1600.webp (largeur max, jamais agrandi au-delà de l'original).

   Ces fichiers sont ensuite référencés via srcset par :
   - le rendu JS d'index.html (webpSrcset() / setImgSrc()) ;
   - la grille statique #pd-grid des pages détail (generate-pages.js).
   Le JPEG d'origine reste le fallback (src) — les photos ajoutées par
   Alexis en mode édition (data:/idb:, pas de variantes) ne sont pas
   concernées et continuent de s'afficher normalement.

   Usage : npm run webp   (ou node generate-webp.js)
   À relancer uniquement si de nouveaux JPEG sont ajoutés dans ces dossiers ;
   les variantes déjà à jour (plus récentes que leur source) sont sautées.
   Les .webp générés sont committés avec les JPEG — rien à faire au build
   Vercel (npm run build ne lance pas ce script).
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIRS = ['images/ACCUEIL', 'images/embedded'];
const WIDTHS = [480, 960, 1600];
const QUALITY = 80;

async function main() {
  let created = 0, skipped = 0, srcCount = 0;
  let inBytes = 0, outBytes = 0;

  for (const dir of DIRS) {
    const abs = path.join(__dirname, dir);
    if (!fs.existsSync(abs)) { console.warn(`Dossier absent, ignoré : ${dir}`); continue; }
    const jpegs = fs.readdirSync(abs).filter(f => /\.jpe?g$/i.test(f));

    for (const file of jpegs) {
      const srcPath = path.join(abs, file);
      const srcStat = fs.statSync(srcPath);
      srcCount++;
      inBytes += srcStat.size;
      const base = file.replace(/\.jpe?g$/i, '');

      for (const w of WIDTHS) {
        const outPath = path.join(abs, `${base}-${w}.webp`);
        if (fs.existsSync(outPath) && fs.statSync(outPath).mtimeMs > srcStat.mtimeMs) {
          skipped++;
          outBytes += fs.statSync(outPath).size;
          continue;
        }
        await sharp(srcPath)
          .rotate() // applique l'orientation EXIF avant de la perdre
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(outPath);
        created++;
        outBytes += fs.statSync(outPath).size;
      }
    }
  }

  const mo = b => (b / 1024 / 1024).toFixed(1) + ' Mo';
  console.log(`${srcCount} JPEG sources (${mo(inBytes)}) → ${created} variantes créées, ${skipped} déjà à jour.`);
  console.log(`Poids total des variantes WebP : ${mo(outBytes)}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
