#!/usr/bin/env node
'use strict';

/**
 * generate-pages.js
 * ------------------
 * Génère des pages HTML statiques pré-rendues pour le SEO / GEO
 * (Google + moteurs IA), à partir de index.html (source unique de
 * vérité : structure, styles, JS, données seed).
 *
 * Pages générées (Phase 1) :
 *   /en/index.html            (accueil EN)
 *   /projets/index.html       (liste des projets, FR)
 *   /en/projects/index.html   (liste des projets, EN)
 *   /contact/index.html       (contact, FR)
 *   /en/contact/index.html    (contact, EN)
 *
 * Pages générées (Phase 2 — pages détail projet) :
 *   /projets/<id>/index.html         (détail projet, FR)
 *   /en/projects/<id>/index.html     (détail projet, EN)
 *   ...pour chaque projet listé dans DETAIL_PROJECT_INDEXES (voir plus
 *   bas). <id> = state.projects[i].id (slug stable utilisé aussi par le
 *   routage interne #/project/<id>). Seuls les projets ayant un vrai
 *   titre EN (pas de placeholder "New project") sont inclus pour
 *   l'instant — voir HANDOFF.md.
 *
 * Chaque page est une copie complète de index.html (même CSS/JS/SPA),
 * avec :
 *  - <head> adapté (title, meta description, canonical, hreflang,
 *    OG/Twitter, JSON-LD avec un noeud WebPage/CollectionPage propre à
 *    la page),
 *  - <html lang="fr|en">,
 *  - la <section> pertinente visible (attribut "hidden" retiré) et les
 *    autres sections masquées,
 *  - le texte statique (data-i18n / data-i18n-html / data-key, titres
 *    de projets) traduit dans la langue de la page, pour que le
 *    contenu soit correct même sans exécution JS (crawlers IA).
 *
 * Le routage côté client (currentHash() dans index.html) détecte déjà
 * l'URL (/, /en/, /projets/, /en/projects/, /contact/, /en/contact/,
 * /projets/<id>/, /en/projects/<id>/) et affiche la bonne vue après
 * hydratation — ce script ne fait que pré-rendre le même résultat côté
 * serveur/build.
 *
 * Depuis le 04/11/2026, le script :
 *  - écrit aussi les photos de la grille d'accueil dans le HTML (/en/, et
 *    "/" = index.html pendant le build Vercel seulement, voir
 *    PRERENDER_ROOT en fin de fichier) ;
 *  - génère sitemap.xml (pages + hreflang + photos de chaque page) ;
 *  - (audit du 04/11/2026, 18 h) range les vues non affichées de chaque page
 *    dans des modèles <script type="text/html" data-view-tpl> (remises en
 *    place par installViews() dans index.html), ne précharge les photos de
 *    l'accueil que sur l'accueil, passe les pages projet en 2 colonnes sur
 *    mobile (tailles d'images), ajoute fil d'Ariane + ImageObject au JSON-LD
 *    et génère llms.txt.
 *
 * Usage : node generate-pages.js          (exécuté via le buildCommand Vercel)
 *         node generate-pages.js --root   (réécrit aussi index.html : à ne
 *                                          lancer que dans une COPIE du dossier)
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = __dirname;
const SRC_PATH = path.join(ROOT, 'index.html');
const SITE = 'https://www.alexisvassiviere.com';

// ---------------------------------------------------------------------
// Lecture du fichier source + des données seed (texts.fr/en, projects)
// ---------------------------------------------------------------------
// Une source déjà pré-rendue (ex. "/" récupérée en ligne par l'export du mode
// édition) peut contenir des vues rangées dans des modèles (voir
// viewTemplate()) : elles sont remises en place avant de générer, sinon elles
// seraient emballées deux fois.
const src = unwrapViewTemplates(fs.readFileSync(SRC_PATH, 'utf8'));

const seedMatch = src.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!seedMatch) throw new Error('seed-data introuvable dans index.html');
const SEED = JSON.parse(seedMatch[1]);

// ---------------------------------------------------------------------
// Configuration des pages à générer
// ---------------------------------------------------------------------
const PAGES = [
  {
    outPath: 'en/index.html',
    lang: 'en',
    section: 'home',
    canonical: `${SITE}/en/`,
    altCanonical: `${SITE}/`,
    xdefault: `${SITE}/`,
    title: 'Alexis Vassivière — Photographer & Art Director',
    description: "Alexis Vassivière — Photographer & Art Director. Over 15 years of experience. Sony Music, Burberry, RTBF, NRJ, Elle Belgique. Based between Brussels and Paris.",
    ogLocale: 'en_US',
    ogLocaleAlt: 'fr_FR',
  },
  {
    outPath: 'projets/index.html',
    lang: 'fr',
    section: 'project',
    canonical: `${SITE}/projets/`,
    altCanonical: `${SITE}/en/projects/`,
    xdefault: `${SITE}/projets/`,
    title: 'Projets — Alexis Vassivière | Photographe & Directeur Artistique',
    description: "Découvrez les projets et séries photo d'Alexis Vassivière : live & musique, portraits d'artistes, campagnes de marque, sport et événementiel. Basé entre Bruxelles et Paris.",
    ogLocale: 'fr_FR',
    ogLocaleAlt: 'en_US',
  },
  {
    outPath: 'en/projects/index.html',
    lang: 'en',
    section: 'project',
    canonical: `${SITE}/en/projects/`,
    altCanonical: `${SITE}/projets/`,
    xdefault: `${SITE}/projets/`,
    title: 'Projects — Alexis Vassivière | Photographer & Art Director',
    description: "Explore Alexis Vassivière's photography projects: live music, artist portraits, brand campaigns, sport and events. Based between Brussels and Paris, available worldwide.",
    ogLocale: 'en_US',
    ogLocaleAlt: 'fr_FR',
  },
  {
    outPath: 'contact/index.html',
    lang: 'fr',
    section: 'contact',
    canonical: `${SITE}/contact/`,
    altCanonical: `${SITE}/en/contact/`,
    xdefault: `${SITE}/contact/`,
    title: 'Contact — Alexis Vassivière | Photographe & Directeur Artistique',
    description: "Contactez Alexis Vassivière, photographe et directeur artistique basé entre Bruxelles et Paris, pour vos projets live, portrait, marque ou événementiel.",
    ogLocale: 'fr_FR',
    ogLocaleAlt: 'en_US',
  },
  {
    outPath: 'en/contact/index.html',
    lang: 'en',
    section: 'contact',
    canonical: `${SITE}/en/contact/`,
    altCanonical: `${SITE}/contact/`,
    xdefault: `${SITE}/contact/`,
    title: 'Contact — Alexis Vassivière | Photographer & Art Director',
    description: "Get in touch with Alexis Vassivière, photographer and art director based between Brussels and Paris, for live, portrait, brand or event projects.",
    ogLocale: 'en_US',
    ogLocaleAlt: 'fr_FR',
  },
];

// ---------------------------------------------------------------------
// Phase 2 — pages détail projet (/projets/<id>/, /en/projects/<id>/)
// ---------------------------------------------------------------------
// Index (dans SEED.projects) des projets ayant chacun leur propre page
// détail. Tous les projets du seed ont désormais un vrai titre FR/EN
// (les placeholders "Nouveau projet"/"New project" ont été corrigés),
// donc tous sont inclus automatiquement. Depuis le 04/11/2026 le sitemap
// est généré par ce script (fin de fichier) : rien à ajouter à la main.
const DETAIL_PROJECT_INDEXES = SEED.projects.map((_, i) => i);

// Chemin absolu d'une photo : le seed stocke des chemins relatifs
// ("images/..."), qui ne se résolvent pas depuis les sous-dossiers
// (/projets/<id>/images/... → 404). Même logique que normalizeSrc()
// côté client dans index.html.
function absSrc(src) {
  const s = String(src || '');
  return s.startsWith('/') ? s : '/' + s;
}

// Variantes WebP responsive (audit 4.1, générées par generate-webp.js —
// npm run webp) : srcset "-480/-960/-1600.webp" ajouté aux <img> statiques,
// seulement si les trois variantes existent sur disque. Les photos ajoutées
// via le CMS (data:) ou sans variantes gardent leur src JPEG seul — même
// logique que webpSrcset() côté client dans index.html.
const WEBP_WIDTHS = [480, 960, 1600];
function webpSrcset(src) {
  const s = absSrc(src);
  if (!/^\/images\/[^?#]+\.jpe?g$/i.test(s)) return '';
  const base = s.replace(/\.jpe?g$/i, '');
  const candidates = WEBP_WIDTHS.map(w => `${base}-${w}.webp`);
  const allOnDisk = candidates.every(rel =>
    fs.existsSync(path.join(ROOT, decodeURIComponent(rel.slice(1)))));
  if (!allOnDisk) return '';
  return candidates.map((c, i) => `${c} ${WEBP_WIDTHS[i]}w`).join(', ');
}
// Attribut sizes ≈ largeur d'une colonne de grille (même calcul que
// gridSizes() dans index.html : pleine largeur sur mobile ≤820px, sinon
// largeur de grille réglée par Alexis, divisée par le nombre de colonnes).
// mobileCols : nb de colonnes sur mobile s'il diffère (accueil).
function gridSizes(cols, widthPct, mobileCols) {
  const c = Math.max(1, parseInt(cols, 10) || 3);
  const m = Math.max(1, parseInt(mobileCols, 10) || c);
  const w = Math.min(100, Math.max(30, parseInt(widthPct, 10) || 100));
  return `(max-width:820px) ${Math.round(100 / m)}vw, ${Math.round(w / c)}vw`;
}
// Page projet : 2 colonnes sur mobile — même valeur que PD_MOBILE_COLS dans
// index.html (et --pd-grid-cols-mobile en CSS).
const PD_MOBILE_COLS = 2;
const PD_GRID_SIZES = gridSizes(SEED.pdGridCols, SEED.pdGridWidth, PD_MOBILE_COLS);
// Premières photos d'une page projet chargées tout de suite (comme
// buildProjectPhotoTile() : eager: idx < 6) ; les suivantes en lazy.
const PD_EAGER = 6;
// Grille d'accueil : 2 colonnes sur mobile — même valeur que
// HOME_MOBILE_COLS dans index.html (et --grid-cols-mobile en CSS).
const HOME_MOBILE_COLS = 2;
const HOME_GRID_SIZES = gridSizes(SEED.gridCols, SEED.gridWidth, HOME_MOBILE_COLS);
// Nombre de photos de l'accueil chargées tout de suite dans le HTML statique
// (les 3 préchargées dans le <head>) ; les suivantes en lazy. Le JS
// reconstruit de toute façon la grille au chargement (renderGrid()).
const HOME_EAGER = 3;

// Texte alternatif d'une photo (bilingue {fr,en} ou chaîne simple), dans la
// langue de la page — même logique que photoAlt() dans index.html.
function photoAltFor(photo, lang, fallback) {
  const a = photo && photo.alt;
  if (a && typeof a === 'string' && a.trim()) return a;
  if (a && typeof a === 'object') {
    const v = a[lang] || a.fr || a.en;
    if (v && v.trim()) return v;
  }
  return fallback || '';
}

// Photos de la grille d'accueil, écrites dans le HTML (avant le 04/11/2026,
// #grid était vide et rempli seulement par le JS : les robots IA et en
// partie Bing ne voyaient aucune photo ni aucun texte alt sur l'accueil).
// Ordre = ordre ordinateur (state.photos) ; sur mobile le JS réordonne
// (homeMobileOrder()). Même balisage que buildPhotoTile(), sans les outils
// d'édition (ajoutés par le JS).
function homeGridHtml(lang) {
  const fallback = lang === 'en' ? 'Photo by Alexis Vassivière' : 'Photo d\'Alexis Vassivière';
  return (SEED.photos || [])
    .filter(p => p && p.src && !/^(data:|idb:)/.test(p.src))
    .map((p, i) => {
      const alt = escapeHtml(photoAltFor(p, lang, fallback));
      const srcset = webpSrcset(p.src);
      const resp = srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(HOME_GRID_SIZES)}"` : '';
      const load = i < HOME_EAGER ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      return `<div class="tile" data-idx="${i}"><img alt="${alt}" ${load} decoding="async"${resp} src="${escapeHtml(absSrc(p.src))}" class="loaded"></div>`;
    }).join('');
}
// Galerie Projets : 4 colonnes sur 80% de largeur desktop, 2 sur mobile
// (CSS #project-grid).
const PROJECT_GRID_SIZES = '(max-width:820px) 50vw, 20vw';

// Adresse de la page correspondant à une route interne "#/..." (valeur de
// l'attribut data-nav des liens), dans la langue de la page générée. Même
// logique que routePath() dans index.html — ici tous les projets du seed
// ont leur page.
function routePath(h, lang) {
  const en = lang === 'en';
  const detail = h.match(/^#\/project\/(.+)$/);
  if (detail) return (en ? '/en/projects/' : '/projets/') + detail[1] + '/';
  if (h.startsWith('#/project')) return en ? '/en/projects/' : '/projets/';
  if (h.startsWith('#/contact')) return en ? '/en/contact/' : '/contact/';
  return en ? '/en/' : '/';
}

// Liens internes (logo, menu, « ← Projets », vignettes de projets) : href
// recalculé dans la langue de la page à partir de data-nav, pour que
// Google trouve directement les bonnes adresses dans le HTML.
function transformNavLinks(html, page) {
  return html.replace(/<a\b[^>]*\bdata-nav="([^"]*)"[^>]*>/g, (tag, nav) =>
    tag.replace(/\bhref="[^"]*"/, `href="${routePath(nav, page.lang)}"`));
}

// Nom du projet sur une seule ligne : un titre peut contenir un retour à
// la ligne voulu (ex. "Spotify\nDaniel Ek", affiché sur 2 lignes grâce à
// white-space:pre-line) — à aplatir pour <title>, meta, JSON-LD et alt.
function flatProjectName(proj, lang) {
  const name = (proj.title && (proj.title[lang] || proj.title.fr)) || '';
  return name.replace(/\s*\n\s*/g, ' ');
}

// Mention propre à la page du projet (proj.credit, ex. « pour HUG
// Production ») : à la suite du h1 et dans la meta description, mais pas dans
// la galerie Projets ni dans <title> — même règle que projectCredit() dans
// index.html. Les espaces insécables gardent la mention d'un bloc à l'affichage.
function projectCredit(proj, lang) {
  return (proj.credit && (proj.credit[lang] || proj.credit.fr)) || '';
}

// Titre <title> / og:title / twitter:title d'une page détail projet.
function projectPageTitle(proj, lang) {
  const name = flatProjectName(proj, lang);
  return lang === 'en'
    ? `${name} — Alexis Vassivière | Photographer & Art Director`
    : `${name} — Alexis Vassivière | Photographe & Directeur Artistique`;
}

// Meta description d'une page détail projet : nom + description du projet
// (proj.desc, sur une ligne) + signature — une description différente par
// page. Sans description, phrase générique construite sur le seul titre.
function projectPageDescription(proj, lang) {
  const credit = projectCredit(proj, lang).replace(/\u00a0/g, ' ');
  const name = flatProjectName(proj, lang) + (credit ? ' ' + credit : '');
  const desc = ((proj.desc && (proj.desc[lang] || proj.desc.fr)) || '')
    .replace(/\s*\n\s*/g, ' ').trim().replace(/\.$/, '');
  if (desc) {
    return lang === 'en'
      ? `${name}: ${desc}. Photos by Alexis Vassivière, photographer (Brussels, Paris).`
      : `${name} : ${desc}. Photos : Alexis Vassivière, photographe (Bruxelles, Paris).`;
  }
  return lang === 'en'
    ? `${name} — a photography project by Alexis Vassivière, photographer and art director based between Brussels and Paris.`
    : `${name} — projet photo par Alexis Vassivière, photographe et directeur artistique basé entre Bruxelles et Paris.`;
}

// Texte alternatif d'une photo de la série pour la grille statique
// #pd-grid. Réutilise l'alt existant (bilingue {fr,en} ou chaîne
// simple) s'il est renseigné, sinon retombe sur le titre du projet
// (+ position dans la série si elle compte plusieurs photos).
function projectPhotoAlt(photo, lang, proj, i, total) {
  const a = photo && photo.alt;
  if (a) {
    if (typeof a === 'string' && a.trim()) return a;
    if (typeof a === 'object') {
      const v = a[lang] || a.fr || a.en;
      if (v && v.trim()) return v;
    }
  }
  const name = flatProjectName(proj, lang);
  return total > 1 ? `${name} — ${i + 1}/${total}` : name;
}

for (const idx of DETAIL_PROJECT_INDEXES) {
  const proj = SEED.projects[idx];
  const slug = proj.id;
  const frPath = `projets/${slug}/`;
  const enPath = `en/projects/${slug}/`;

  PAGES.push({
    outPath: `${frPath}index.html`,
    lang: 'fr',
    section: 'project',
    kind: 'detail',
    projectIdx: idx,
    canonical: `${SITE}/${frPath}`,
    altCanonical: `${SITE}/${enPath}`,
    xdefault: `${SITE}/${frPath}`,
    title: projectPageTitle(proj, 'fr'),
    description: projectPageDescription(proj, 'fr'),
    ogLocale: 'fr_FR',
    ogLocaleAlt: 'en_US',
  });
  PAGES.push({
    outPath: `${enPath}index.html`,
    lang: 'en',
    section: 'project',
    kind: 'detail',
    projectIdx: idx,
    canonical: `${SITE}/${enPath}`,
    altCanonical: `${SITE}/${frPath}`,
    xdefault: `${SITE}/${frPath}`,
    title: projectPageTitle(proj, 'en'),
    description: projectPageDescription(proj, 'en'),
    ogLocale: 'en_US',
    ogLocaleAlt: 'fr_FR',
  });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Échappe une chaîne pour l'insérer dans du texte HTML ou un attribut
// entre guillemets doubles.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Extrait un élément <tag id="id" ...>...</tag> de premier niveau (pas
// de tag imbriqué de même nom à l'intérieur) et renvoie ses positions +
// son HTML complet.
function extractById(html, tag, id) {
  const openRe = new RegExp(`<${tag}[^>]*\\bid="${id}"[^>]*>`);
  const m = html.match(openRe);
  if (!m) throw new Error(`Balise ouvrante <${tag} id="${id}"> introuvable`);
  const start = m.index;
  const closeTag = `</${tag}>`;
  const closeIdx = html.indexOf(closeTag, start + m[0].length);
  if (closeIdx === -1) throw new Error(`Balise fermante ${closeTag} introuvable après #${id}`);
  const end = closeIdx + closeTag.length;
  return { start, end, text: html.slice(start, end) };
}

// Vue non affichée d'une page générée : rangée dans un modèle
// <script type="text/html" data-view-tpl="<id>">, remis en place au chargement
// par installViews() dans index.html (même principe que #edit-ui-tpl). Son
// texte (bio, clients, titres des autres vues) ne fait ainsi plus partie de la
// page pour Google et les robots IA, qui ne lisaient sinon presque que ça.
// Les commentaires HTML sont retirés (inutiles, et "<!--" dans un <script>
// change la façon dont le navigateur cherche la fin du bloc).
function viewTemplate(id, fragHtml) {
  const body = fragHtml.replace(/<!--[\s\S]*?-->/g, '');
  if (/<\/?script/i.test(body)) {
    throw new Error(`La vue #${id} contient une balise <script> : impossible de la ranger dans un modèle`);
  }
  return `<script type="text/html" data-view-tpl="${id}">${body}</script>`;
}
// Motif strict (nom de vue + <section> complète juste à l'intérieur) : un
// simple texte qui ressemblerait à la balise (commentaire du script…) ne doit
// jamais être pris pour un modèle.
function unwrapViewTemplates(html) {
  return html.replace(/<script type="text\/html" data-view-tpl="(view-[a-z-]+)">(<section id="\1"[\s\S]*?<\/section>)<\/script>/g, '$2');
}

// Traduit dans un fragment cheerio les éléments data-i18n / data-i18n-html
// / data-key vers texts[lang][key]. "contact.email" est volontairement
// exclu (valeur conservée telle quelle, identique FR/EN).
function translateFragment($, lang, SEED) {
  const T = SEED.texts[lang] || {};
  $('[data-i18n]').each((i, el) => {
    const key = $(el).attr('data-i18n');
    if (key === 'contact.email') return;
    if (T[key] != null) $(el).text(T[key]);
  });
  $('[data-i18n-html]').each((i, el) => {
    const key = $(el).attr('data-i18n-html');
    if (T[key] != null) $(el).html(T[key]);
  });
  $('[data-key]').each((i, el) => {
    const key = $(el).attr('data-key');
    if (key === 'contact.email') return;
    if (T[key] != null) $(el).html(T[key]);
  });
}

// Ajoute un noeud WebPage (ou CollectionPage pour une page détail projet,
// avec la liste des photos de la série) au JSON-LD (@graph) propre à la
// page générée.
function transformJsonLd(html, page, SEED) {
  const re = /(<script type="application\/ld\+json">\n)([\s\S]*?)(\n<\/script>)/;
  const m = html.match(re);
  if (!m) return html;
  const data = JSON.parse(m[2]);
  const node = {
    '@type': page.kind === 'detail' ? 'CollectionPage' : 'WebPage',
    '@id': `${page.canonical}#webpage`,
    url: page.canonical,
    name: page.title,
    description: page.description,
    inLanguage: page.lang,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': `${SITE}/#person` },
  };
  if (page.kind === 'detail') {
    // Photos de la série avec leur auteur et leurs crédits (Google Images
    // affiche le créateur et la mention de crédit). Pas de licence déclarée :
    // à décider par Alexis (voir HANDOFF, crédits du 04/11/2026).
    const proj = SEED.projects[page.projectIdx];
    const photos = (proj.photos || []).filter(p => p && p.src && !/^(data:|idb:)/.test(p.src));
    node.image = photos.map((p, i) => ({
      '@type': 'ImageObject',
      contentUrl: SITE + encodeURI(absSrc(p.src)),
      caption: projectPhotoAlt(p, page.lang, proj, i, photos.length),
      creator: { '@id': `${SITE}/#person` },
      creditText: 'Alexis Vassivière',
      copyrightNotice: '© Alexis Vassivière',
    }));
  }
  // Fil d'Ariane (Portfolio › Projets › <projet>, Portfolio › Contact) :
  // Google peut l'afficher à la place de l'adresse dans ses résultats.
  {
    const en = page.lang === 'en';
    const T = SEED.texts[page.lang] || {};
    const crumbs = [{ name: T['nav.work'] || 'Portfolio', item: `${SITE}${en ? '/en/' : '/'}` }];
    if (page.section === 'project') {
      crumbs.push({ name: T['nav.project'] || (en ? 'Projects' : 'Projets'), item: `${SITE}${en ? '/en/projects/' : '/projets/'}` });
      if (page.kind === 'detail') {
        crumbs.push({ name: flatProjectName(SEED.projects[page.projectIdx], page.lang), item: page.canonical });
      }
    } else if (page.section === 'contact') {
      crumbs.push({ name: T['nav.contact'] || 'Contact', item: page.canonical });
    }
    if (crumbs.length > 1) {
      node.breadcrumb = { '@id': `${page.canonical}#breadcrumb` };
      data['@graph'].push({
        '@type': 'BreadcrumbList',
        '@id': `${page.canonical}#breadcrumb`,
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })),
      });
    }
  }
  // Le noeud WebPage d'index.html décrit la page d'accueil "/" : on le
  // remplace (au lieu de le garder à côté), sinon chaque page générée
  // déclarerait deux pages différentes.
  data['@graph'] = data['@graph'].filter(n => n['@id'] !== `${SITE}/#webpage`);
  data['@graph'].push(node);
  const newJson = JSON.stringify(data, null, 2);
  return html.slice(0, m.index) + m[1] + newJson + m[3] + html.slice(m.index + m[0].length);
}

// ---------------------------------------------------------------------
// Transformation du <head>
// ---------------------------------------------------------------------
function transformHead(html, page, SEED) {
  if (page.lang === 'en') {
    html = html.replace('<html lang="fr"', '<html lang="en"');
  }
  // Projet à nombre de colonnes propre (proj.cols, voir pdColsFor() dans
  // index.html) : --pd-grid-cols du style inline de <html> ajusté pour que
  // la grille statique s'affiche directement avec le bon nombre de colonnes.
  if (page.kind === 'detail') {
    const proj = SEED.projects[page.projectIdx];
    if (proj.cols != null) {
      html = html.replace(/(<html[^>]*--pd-grid-cols:\s*)\d+/, `$1${parseInt(proj.cols, 10)}`);
    }
  }

  const title = escapeHtml(page.title);
  const desc = escapeHtml(page.description);

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${desc}">`);
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${page.canonical}">`);

  const frHref = page.lang === 'fr' ? page.canonical : page.altCanonical;
  const enHref = page.lang === 'en' ? page.canonical : page.altCanonical;
  html = html.replace(/<link rel="alternate" hreflang="fr" href="[^"]*">/, `<link rel="alternate" hreflang="fr" href="${frHref}">`);
  html = html.replace(/<link rel="alternate" hreflang="en" href="[^"]*">/, `<link rel="alternate" hreflang="en" href="${enHref}">`);
  html = html.replace(/<link rel="alternate" hreflang="x-default" href="[^"]*">/, `<link rel="alternate" hreflang="x-default" href="${page.xdefault}">`);

  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`);
  html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${page.canonical}">`);
  html = html.replace(/<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${page.ogLocale}">`);
  html = html.replace(/<meta property="og:locale:alternate" content="[^"]*">/, `<meta property="og:locale:alternate" content="${page.ogLocaleAlt}">`);

  html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`);

  // Page détail projet : l'aperçu d'un lien partagé (WhatsApp, LinkedIn,
  // iMessage…) montre la couverture du projet plutôt que l'image du site.
  // Ses dimensions ne sont pas connues ici : og:image:width/height sont
  // retirés (facultatifs, l'aperçu les lit dans l'image).
  if (page.kind === 'detail') {
    const cover = (SEED.projects[page.projectIdx].photos || [])[0];
    if (cover && !/^(data:|idb:)/.test(cover.src)) {
      const coverUrl = escapeHtml(`${SITE}${absSrc(cover.src)}`);
      html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${coverUrl}">`);
      html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${coverUrl}">`);
      html = html.replace(/\n<meta property="og:image:(width|height)" content="[^"]*">/g, '');
    }
  }

  // Les 3 photos préchargées dans le <head> d'index.html sont celles de la
  // grille d'accueil : inutiles ailleurs (elles retardaient les photos de la
  // page projet ou de Contact). Retirées de toutes les pages sauf l'accueil.
  if (page.section !== 'home') {
    html = html.replace(/<link rel="preload" as="image" href="\/images\/ACCUEIL\/[^>]*>\n?/g, '');
  }

  html = transformJsonLd(html, page, SEED);
  return html;
}

// ---------------------------------------------------------------------
// Transformation du <body> : header (nav/langue) + sections (visibilité
// + traduction de la section affichée par défaut)
// ---------------------------------------------------------------------
function transformBody(html, page, SEED) {
  // --- header : nav active + bouton de langue actif + traduction ---
  {
    const frag = extractById(html, 'header', 'header');
    const $ = cheerio.load(frag.text, null, false);
    translateFragment($, page.lang, SEED);
    $('.nav a[data-route]').removeClass('active');
    $(`.nav a[data-route="${page.section}"]`).addClass('active');
    $('.lang button').removeClass('on');
    $(`.lang button[data-lang="${page.lang}"]`).addClass('on');
    const newFrag = $.root().html();
    html = html.slice(0, frag.start) + newFrag + html.slice(frag.end);
  }

  // --- pied de page : traduit aussi (lien « Mentions légales » / « Legal notice ») ---
  {
    const frag = extractById(html, 'footer', 'site-footer');
    const $ = cheerio.load(frag.text, null, false);
    translateFragment($, page.lang, SEED);
    html = html.slice(0, frag.start) + $.root().html() + html.slice(frag.end);
  }

  // --- sections : visibilité + traduction de la section active ---
  // "detail" (#view-project-detail) n'est actif que pour les pages
  // détail projet (page.kind === 'detail') ; sinon la section active
  // est celle indiquée par page.section (home/project/contact).
  const sectionIds = { home: 'view-home', project: 'view-project', contact: 'view-contact', detail: 'view-project-detail' };
  const activeKey = page.kind === 'detail' ? 'detail' : page.section;
  for (const [key, id] of Object.entries(sectionIds)) {
    const frag = extractById(html, 'section', id);
    const $ = cheerio.load(frag.text, null, false);
    const $el = $(`#${id}`);
    if (key === activeKey) {
      $el.removeAttr('hidden');
      translateFragment($, page.lang, SEED);
      if (key === 'home') {
        $('#grid').empty().append(homeGridHtml(page.lang));
      } else if (key === 'project') {
        // Galerie Projets reconstruite depuis le seed (comme #pd-grid) : le
        // #project-grid statique d'index.html est un instantané du DOM pris
        // à l'export CMS, qui ne suit pas l'ajout ou le réordonnancement
        // des projets côté code. Même balisage que buildProjectTile().
        const $grid = $('#project-grid');
        $grid.empty();
        (SEED.projects || []).forEach((proj, i) => {
          const title = escapeHtml((proj.title && (proj.title[page.lang] || proj.title.fr)) || '');
          const alt = escapeHtml(flatProjectName(proj, page.lang));
          const cover = (proj.photos || [])[0];
          let img = '';
          if (cover) {
            const srcset = webpSrcset(cover.src);
            const resp = srcset
              ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(PROJECT_GRID_SIZES)}"`
              : '';
            img = `<img alt="${alt}" loading="lazy" decoding="async"${resp} src="${escapeHtml(absSrc(cover.src))}" class="loaded">`;
          }
          const route = `#/project/${encodeURIComponent(proj.id)}`;
          const link = `<a class="proj-link" data-nav="${escapeHtml(route)}" href="${escapeHtml(routePath(route, page.lang))}">${img}</a>`;
          $grid.append(`<div class="proj-card" data-idx="${i}"><div class="proj-title" data-project-field="title" data-project-idx="${i}">${title}</div><div class="tile">${link}</div></div>`);
        });
      } else if (key === 'detail') {
        const proj = SEED.projects[page.projectIdx];
        $el.attr('data-idx', String(page.projectIdx));
        $('#pd-title').text((proj.title && proj.title[page.lang]) || '');
        const credit = projectCredit(proj, page.lang);
        if (credit) $('#pd-title').append(`<span class="pd-credit" contenteditable="false">${escapeHtml(' ' + credit)}</span>`);
        $('#pd-desc').text((proj.desc && proj.desc[page.lang]) || '');
        // « Projet suivant » (même règle que renderProjectDetail() côté
        // client) : son href est posé ensuite par transformNavLinks().
        const next = SEED.projects[(page.projectIdx + 1) % SEED.projects.length];
        $('#pd-next').attr('data-nav', `#/project/${encodeURIComponent(next.id)}`);
        $('#pd-next-name').text(flatProjectName(next, page.lang));
        const $grid = $('#pd-grid');
        $grid.empty();
        const photos = proj.photos || [];
        const sizes = proj.cols != null ? gridSizes(proj.cols, SEED.pdGridWidth, PD_MOBILE_COLS) : PD_GRID_SIZES;
        photos.forEach((p, i) => {
          const alt = escapeHtml(projectPhotoAlt(p, page.lang, proj, i, photos.length));
          const src = escapeHtml(absSrc(p.src));
          const srcset = webpSrcset(p.src);
          const resp = srcset
            ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(sizes)}"`
            : '';
          const load = i < PD_EAGER ? 'eager' : 'lazy';
          $grid.append(`<div class="tile"><img alt="${alt}" loading="${load}" decoding="async"${resp} src="${src}"></div>`);
        });
      }
    } else {
      $el.attr('hidden', '');
      // Section masquée : grille vidée (une grille d'accueil déjà écrite dans
      // la source ne doit pas faire télécharger ses photos sur les autres pages).
      if (key === 'home') $('#grid').empty();
    }
    let newFrag = $.root().html();
    if (key !== activeKey) newFrag = viewTemplate(id, newFrag);
    html = html.slice(0, frag.start) + newFrag + html.slice(frag.end);
  }

  return html;
}

// ---------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------
for (const page of PAGES) {
  let html = src;
  html = transformHead(html, page, SEED);
  html = transformBody(html, page, SEED);
  html = transformNavLinks(html, page);

  const outPath = path.join(ROOT, page.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Généré ${page.outPath} (${html.length} octets)`);
}

// ---------------------------------------------------------------------
// Accueil FR "/" (= index.html) avec ses photos écrites dans le HTML
// ---------------------------------------------------------------------
// index.html est la source : on ne la réécrit QUE pendant le build Vercel
// (variable VERCEL, posée par Vercel dans son environnement de build, sur
// une copie jetable du dépôt) ou si on le demande (node generate-pages.js
// --root, pour tester dans une copie du dossier). En local, `npm run build`
// laisse index.html intact. <head> inchangé (c'est déjà celui de l'accueil
// FR) ; seul le corps est pré-rendu, comme pour /en/.
const PRERENDER_ROOT = !!process.env.VERCEL || process.argv.includes('--root');
const ROOT_PAGE = { outPath: 'index.html', lang: 'fr', section: 'home', canonical: `${SITE}/` };
if (PRERENDER_ROOT) {
  let html = transformBody(src, ROOT_PAGE, SEED);
  html = transformNavLinks(html, ROOT_PAGE);
  fs.writeFileSync(SRC_PATH, html);
  console.log(`Pré-rendu index.html (accueil FR, ${html.length} octets)`);
}

// ---------------------------------------------------------------------
// sitemap.xml (généré à chaque build depuis le seed — ne plus l'éditer à
// la main) : toutes les pages + leurs variantes de langue (hreflang) + les
// photos affichées sur chaque page (<image:image>, pour Google Images).
// lastmod = date du seedStamp (change à chaque modification du contenu).
// ---------------------------------------------------------------------
{
  const stamp = String(SEED.seedStamp || '').match(/^\d{4}-\d{2}-\d{2}/);
  const lastmod = stamp ? stamp[0] : new Date().toISOString().slice(0, 10);
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const imgUrl = src => SITE + encodeURI(absSrc(src));
  const usable = list => (list || []).filter(p => p && p.src && !/^(data:|idb:)/.test(p.src));
  const homeImgs = usable(SEED.photos).map(p => imgUrl(p.src));
  const coverImgs = usable((SEED.projects || []).map(pr => (pr.photos || [])[0]));
  const entries = [];
  const add = (fr, en, changefreq, priority, images) => {
    for (const loc of [fr, en]) {
      entries.push({ loc, fr, en, changefreq, priority, images });
    }
  };
  add(`${SITE}/`, `${SITE}/en/`, 'monthly', '1.0', homeImgs);
  add(`${SITE}/projets/`, `${SITE}/en/projects/`, 'monthly', '0.9', coverImgs.map(p => imgUrl(p.src)));
  for (const idx of DETAIL_PROJECT_INDEXES) {
    const proj = SEED.projects[idx];
    add(`${SITE}/projets/${proj.id}/`, `${SITE}/en/projects/${proj.id}/`, 'yearly', '0.7',
      usable(proj.photos).map(p => imgUrl(p.src)));
  }
  add(`${SITE}/contact/`, `${SITE}/en/contact/`, 'yearly', '0.5', []);

  const body = entries.map(e => [
    '  <url>',
    `    <loc>${xmlEsc(e.loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${e.changefreq}</changefreq>`,
    `    <priority>${e.priority}</priority>`,
    `    <xhtml:link rel="alternate" hreflang="fr" href="${xmlEsc(e.fr)}" />`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${xmlEsc(e.en)}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(e.fr)}" />`,
    ...[...new Set(e.images)].map(u => `    <image:image><image:loc>${xmlEsc(u)}</image:loc></image:image>`),
    '  </url>',
  ].join('\n')).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sitemap — www.alexisvassiviere.com
  GÉNÉRÉ AUTOMATIQUEMENT par generate-pages.js à chaque build (npm run build,
  et sur Vercel à chaque déploiement) à partir du seed d'index.html : ne pas
  l'éditer à la main, les modifications seraient écrasées. Un nouveau projet
  du seed y apparaît tout seul (FR + EN), avec ses photos.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  const nImgs = entries.reduce((n, e) => n + new Set(e.images).size, 0);
  console.log(`Généré sitemap.xml (${entries.length} URL, ${nImgs} entrées image)`);
}

// ---------------------------------------------------------------------
// llms.txt (généré à chaque build depuis le seed) : résumé du site pour les
// assistants IA (ChatGPT, Claude, Perplexity…), format https://llmstxt.org —
// qui est Alexis, ses clients, ses pages et ses projets, en FR et en EN.
// ---------------------------------------------------------------------
{
  const plain = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const fr = SEED.texts.fr || {};
  const en = SEED.texts.en || {};
  const clients = (SEED.clients || []).map(plain).join(', ');
  const descOf = (proj, lang) => plain(proj.desc && (proj.desc[lang] || proj.desc.fr)).replace(/\.$/, '');
  const projLines = lang => (SEED.projects || []).map(proj => {
    const url = `${SITE}${lang === 'en' ? '/en/projects/' : '/projets/'}${proj.id}/`;
    const d = descOf(proj, lang);
    const credit = plain(projectCredit(proj, lang));
    return `- [${plain(flatProjectName(proj, lang))}${credit ? ' ' + credit : ''}](${url})${d ? (lang === 'en' ? ': ' : ' : ') + d + '.' : ''}`;
  }).join('\n');
  const txt = `# Alexis Vassivière

> ${plain(fr['hero.lede'])} Photographe et directeur artistique : concerts et tournées, portraits d'artistes, événementiel et corporate, campagnes de marque. Clients : ${clients}.

Site bilingue (français / anglais). Contact : ${SEED.email}. Toutes les photos : © Alexis Vassivière, tous droits réservés.

## Pages

- [Portfolio](${SITE}/) : sélection de photos (concert, portrait d'artiste, événementiel, sport, Japon)
- [Projets](${SITE}/projets/) : ${plain(fr['project.intro'])}
- [Contact](${SITE}/contact/) : présentation, e-mail et liste des clients

## Projets

${projLines('fr')}

## English

> ${plain(en['hero.lede'])} Photographer and art director: concerts and tours, artist portraits, events and corporate, brand campaigns.

- [Portfolio](${SITE}/en/): selected photographs
- [Projects](${SITE}/en/projects/): ${plain(en['project.intro'])}
- [Contact](${SITE}/en/contact/): about, e-mail and client list

### Projects

${projLines('en')}

## Optional

- [Instagram](${SEED.ig})
- [LinkedIn](${SEED.li})
`;
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), txt);
  console.log(`Généré llms.txt (${txt.length} caractères)`);
}

console.log('Terminé.');
