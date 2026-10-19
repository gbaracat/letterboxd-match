// logic.js
// Funções "puras": recebem dados e devolvem um resultado, sem mexer na tela.
// Separar assim facilita testar e mexer na conta do match depois.

// ---------------------------------------------------------------
// 1) LER OS FILMES DE UMA PÁGINA DO LETTERBOXD
// ---------------------------------------------------------------
// Recebe um "documento" (a página já convertida em HTML navegável)
// e devolve uma lista: [{ slug, titulo, nota }]
//   slug   = identificador do filme na URL (ex: "parasite-2019")
//   titulo = nome do filme (normalmente já com o ano: "Parasite (2019)")
//   nota   = de 0.5 a 5 (ou null se a pessoa assistiu mas não deu nota)
//
// ATENÇÃO: o Letterboxd pode mudar o HTML do site. Se a extensão parar de
// achar filmes, abra o DevTools (F12) numa página /usuario/films/ e confira
// os nomes das classes e atributos usados aqui.
function lerFilmes(doc) {
  const filmes = [];

  doc.querySelectorAll("li").forEach((li) => {
    // O pôster de cada filme carrega atributos "data-..." com as informações.
    const poster = li.querySelector(
      "[data-film-slug], [data-item-slug], [data-item-link], [data-target-link]"
    );
    if (!poster) return;

    const link =
      poster.dataset.itemLink ||
      poster.dataset.targetLink ||
      (li.querySelector('a[href*="/film/"]') || {}).href ||
      "";
    const slug =
      poster.dataset.filmSlug ||
      poster.dataset.itemSlug ||
      ((/\/film\/([^/?#]+)/.exec(link) || [])[1]);
    if (!slug) return;

    const imagem = li.querySelector("img");
    const titulo =
      poster.dataset.itemName ||
      poster.dataset.filmName ||
      (imagem && imagem.alt ? imagem.alt.replace(/^Poster for /i, "") : "") ||
      slug;

    filmes.push({ slug, titulo, nota: lerNota(li) });
  });

  return filmes;
}

// A nota aparece como uma classe tipo "rated-8" (8 = 4 estrelas, pois 1 = meia estrela).
function lerNota(li) {
  const candidatos = li.querySelectorAll('[class*="rated-"]');
  for (const el of candidatos) {
    const m = /\brated-(\d+)\b/.exec(el.getAttribute("class") || "");
    if (m) return Number(m[1]) / 2;
  }
  return null;
}

// ---------------------------------------------------------------
// 2) LER INFORMAÇÕES EXTRAS DA PÁGINA DE UM FILME (pôster e diretor)
// ---------------------------------------------------------------
function lerInfoFilme(doc) {
  const meta = (seletor) => {
    const m = doc.querySelector(seletor);
    return m ? (m.getAttribute("content") || "").trim() : "";
  };

  const poster = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');

  let diretor = "";
  if (/direct/i.test(meta('meta[name="twitter:label1"]'))) {
    diretor = meta('meta[name="twitter:data1"]');
  }
  if (!diretor) {
    const a = doc.querySelector('a[href^="/director/"]');
    if (a) diretor = a.textContent.trim();
  }
  return { poster, diretor };
}

// "Parasite (2019)" -> { nome: "Parasite", ano: "2019" }
function separarTitulo(titulo) {
  const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(titulo || "");
  return m ? { nome: m[1], ano: m[2] } : { nome: titulo || "", ano: "" };
}

// ---------------------------------------------------------------
// 3) CALCULAR O MATCH
// ---------------------------------------------------------------
// meus / deles = objetos no formato { slug: { titulo, nota } }
// (inclui filmes assistidos sem nota, para não sugerir o que você já viu)
function calcularMatch(meus, deles) {
  // Filmes que os dois assistiram E avaliaram
  const emComum = [];
  for (const slug in meus) {
    const minha = meus[slug].nota;
    const dele = deles[slug] ? deles[slug].nota : null;
    if (minha != null && dele != null) {
      emComum.push({
        slug,
        titulo: meus[slug].titulo,
        minha,
        dele,
        diff: Math.abs(minha - dele),
      });
    }
  }

  // Sugestões: filmes que a outra pessoa curtiu (4 estrelas ou mais)
  // e que você ainda não assistiu.
  const sugestoes = [];
  for (const slug in deles) {
    const nota = deles[slug].nota;
    if (nota != null && nota >= 4 && !(slug in meus)) {
      sugestoes.push({ slug, titulo: deles[slug].titulo, nota });
    }
  }
  sugestoes.sort((a, b) => b.nota - a.nota || a.titulo.localeCompare(b.titulo));

  if (emComum.length === 0) {
    return {
      porcentagem: null,
      totalEmComum: 0,
      confiavel: false,
      amaram: [],
      discordam: [],
      sugestoes: sugestoes.slice(0, 8),
    };
  }

  // A CONTA: média da diferença entre as notas (0 a 4.5 estrelas).
  //   diferença média 0   -> 100%
  //   diferença média 1   -> 50%
  //   diferença média 2+  -> 0%
  // Dá pra trocar o "2" por outro número para deixar a conta mais
  // rígida ou mais generosa.
  const somaDiff = emComum.reduce((total, f) => total + f.diff, 0);
  const mediaDiff = somaDiff / emComum.length;
  const porcentagem = Math.round(Math.max(0, 1 - mediaDiff / 2) * 100);

  // "Vocês dois amaram": os dois deram 4 estrelas ou mais (as maiores notas primeiro)
  const amaram = emComum
    .filter((f) => f.minha >= 4 && f.dele >= 4)
    .sort((a, b) => b.minha + b.dele - (a.minha + a.dele) || a.titulo.localeCompare(b.titulo))
    .slice(0, 5);

  // "Onde vocês divergem": notas com 1.5 estrela ou mais de diferença (maior diferença primeiro)
  const discordam = emComum
    .filter((f) => f.diff >= 1.5)
    .sort((a, b) => b.diff - a.diff || a.titulo.localeCompare(b.titulo))
    .slice(0, 5);

  return {
    porcentagem,
    totalEmComum: emComum.length,
    confiavel: emComum.length >= 10, // com poucos filmes em comum o número engana
    amaram,
    discordam,
    sugestoes: sugestoes.slice(0, 8),
  };
}

// Isso só serve para rodar testes no Node; no navegador é ignorado.
if (typeof module !== "undefined") {
  module.exports = { lerFilmes, lerNota, lerInfoFilme, separarTitulo, calcularMatch };
}
