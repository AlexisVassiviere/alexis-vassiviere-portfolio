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
 * Usage : node generate-pages.js   (exécuté via le buildCommand Vercel)
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = __dirname;
const SRC_PATH = path.join(ROOT, 'index.html');
const SITE = 'https://alexisvassiviere.com';

// ---------------------------------------------------------------------
// Lecture du fichier source + des données seed (texts.fr/en, projects)
// ---------------------------------------------------------------------
const src = fs.readFileSync(SRC_PATH, 'utf8');

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
    description: "Alexis Vassivière — Photographer & Art Director. 14 years of experience. Sony Music, Burberry, RTBF, NRJ, Elle Belgique. Based between Brussels and Paris.",
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
// détail. Pour l'instant : seulement les projets avec un vrai titre EN
// (pas de placeholder "New project"). Les projets 0 ("GAZO...") et 4
// ("Nouveau projet") sont volontairement exclus — voir HANDOFF.md ;
// il suffira de les ajouter à cette liste une fois leurs titres FR/EN
// corrigés.
const DETAIL_PROJECT_INDEXES = [1, 2, 3];

// Titre <title> / og:title / twitter:title d'une page détail projet.
function projectPageTitle(proj, lang) {
  const name = (proj.title && (proj.title[lang] || proj.title.fr)) || '';
  return lang === 'en'
    ? `${name} — Alexis Vassivière | Photographer & Art Director`
    : `${name} — Alexis Vassivière | Photographe & Directeur Artistique`;
}

// Meta description d'une page détail projet. Générée à partir du titre
// du projet (stable) plutôt que de proj.desc (texte libre, peut être
// modifié ou incohérent), pour rester correcte même si la description
// éditoriale change.
function projectPageDescription(proj, lang) {
  const name = (proj.title && (proj.title[lang] || proj.title.fr)) || '';
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
  const name = (proj.title && (proj.title[lang] || proj.title.fr)) || '';
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
    const proj = SEED.projects[page.projectIdx];
    node.image = (proj.photos || []).map(p => `${SITE}${p.src}`);
  }
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
      if (key === 'project') {
        $('.proj-title[data-project-idx]').each((i, el) => {
          const idx = parseInt($(el).attr('data-project-idx'), 10);
          const proj = SEED.projects[idx];
          const title = proj && proj.title && proj.title[page.lang];
          if (title) {
            $(el).text(title);
            $(el).closest('.proj-card').find('img').attr('alt', title);
          }
        });
      } else if (key === 'detail') {
        const proj = SEED.projects[page.projectIdx];
        $el.attr('data-idx', String(page.projectIdx));
        $('#pd-title').text((proj.title && proj.title[page.lang]) || '');
        $('#pd-desc').text((proj.desc && proj.desc[page.lang]) || '');
        const $grid = $('#pd-grid');
        $grid.empty();
        const photos = proj.photos || [];
        photos.forEach((p, i) => {
          const alt = escapeHtml(projectPhotoAlt(p, page.lang, proj, i, photos.length));
          const src = escapeHtml(p.src || '');
          $grid.append(`<div class="tile"><img alt="${alt}" loading="lazy" decoding="async" src="${src}"></div>`);
        });
      }
    } else {
      $el.attr('hidden', '');
    }
    const newFrag = $.root().html();
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

  const outPath = path.join(ROOT, page.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Généré ${page.outPath} (${html.length} octets)`);
}

console.log('Terminé.');
