// content.js
// Roda dentro das páginas do letterboxd.com.
// Usa as funções do logic.js (carregado antes): lerFilmes, lerInfoFilme,
// separarTitulo e calcularMatch.

(function () {
  const SEIS_HORAS = 6 * 60 * 60 * 1000;
  const MAX_PAGINAS = 150; // trava de segurança (72 filmes por página)
  const PAUSA_ENTRE_PAGINAS = 300; // ms, para não sobrecarregar o site

  // Quantos filmes aparecem em cada bloco do painel
  const MAX_AMARAM = 3;
  const MAX_DIVERGEM = 3;
  const MAX_SUGESTOES = 4;

  // Primeiro pedaço da URL que NÃO é perfil de usuário
  const RESERVADOS = new Set([
    "film", "films", "lists", "list", "members", "journal", "activity",
    "settings", "sign-in", "sign-up", "search", "reviews", "about", "pro",
    "patron", "apps", "api-beta", "welcome", "legal", "tag", "actor",
    "director", "writer", "studio", "genre", "year", "decade", "contact",
    "news", "crew", "cast", "producer", "country", "language", "story",
    "stories", "reset-password",
  ]);
  const SUBPAGINAS_DE_PERFIL = new Set([
    "films", "diary", "reviews", "watchlist", "lists", "likes", "following",
    "followers", "activity", "network", "tags", "stats",
  ]);

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Descobrir se estamos no perfil de alguém ----------
  function usuarioDaPagina() {
    const partes = location.pathname.split("/").filter(Boolean);
    if (partes.length === 0) return null;
    if (RESERVADOS.has(partes[0].toLowerCase())) return null;
    if (partes.length === 1 || SUBPAGINAS_DE_PERFIL.has(partes[1].toLowerCase())) {
      return partes[0].toLowerCase();
    }
    return null;
  }

  // ---------- Qual é o MEU usuário? (perguntamos só na primeira vez) ----------
  async function obterMeuUsuario(forcarTroca) {
    let { meuUsuario } = await chrome.storage.sync.get("meuUsuario");
    if (!meuUsuario || forcarTroca) {
      const resposta = prompt(
        "Qual é o seu usuário no Letterboxd?\n(o que aparece na URL do seu perfil: letterboxd.com/USUARIO)"
      );
      if (!resposta) return null;
      meuUsuario = resposta.trim().replace(/^@/, "").toLowerCase();
      await chrome.storage.sync.set({ meuUsuario });
    }
    return meuUsuario;
  }

  // ---------- Buscar todos os filmes de um usuário ----------
  async function buscarFilmes(usuario, aoProgresso) {
    const chaveCache = "cache:" + usuario;
    const guardado = (await chrome.storage.local.get(chaveCache))[chaveCache];
    if (guardado && Date.now() - guardado.quando < SEIS_HORAS) {
      return guardado.filmes;
    }

    const filmes = {};
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const url =
        "https://letterboxd.com/" + encodeURIComponent(usuario) + "/films/" +
        (pagina > 1 ? "page/" + pagina + "/" : "");
      const resp = await fetch(url);
      if (!resp.ok) {
        if (pagina === 1) throw new Error("Não encontrei o perfil @" + usuario + ".");
        break;
      }
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const novos = lerFilmes(doc).filter((f) => !(f.slug in filmes));
      if (novos.length === 0) break; // acabaram as páginas
      novos.forEach((f) => (filmes[f.slug] = { titulo: f.titulo, nota: f.nota }));
      aoProgresso(usuario, Object.keys(filmes).length);
      await esperar(PAUSA_ENTRE_PAGINAS);
    }

    if (Object.keys(filmes).length === 0) {
      throw new Error(
        "Não consegui ler filmes de @" + usuario + " (perfil privado, vazio ou o site mudou)."
      );
    }
    await chrome.storage.local.set({ [chaveCache]: { quando: Date.now(), filmes } });
    return filmes;
  }

  // ---------- Pôster e diretor de um filme (buscados só dos que aparecem na tela) ----------
  async function buscarInfoFilme(slug) {
    const chave = "info:" + slug;
    const guardado = (await chrome.storage.local.get(chave))[chave];
    if (guardado) return guardado;
    try {
      const resp = await fetch("https://letterboxd.com/film/" + encodeURIComponent(slug) + "/");
      if (!resp.ok) return {};
      const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
      const info = lerInfoFilme(doc);
      if (info.poster || info.diretor) {
        await chrome.storage.local.set({ [chave]: info });
      }
      return info;
    } catch (erro) {
      return {};
    }
  }

  // Busca as infos de vários filmes, 3 por vez, e avisa cada cartão quando chega
  async function carregarInfos(pedidos) {
    const fila = pedidos.slice();
    async function trabalhador() {
      while (fila.length > 0) {
        const pedido = fila.shift();
        pedido.aoCarregar(await buscarInfoFilme(pedido.slug));
        await esperar(150);
      }
    }
    await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  }

  // ---------- Pequenas ajudas para montar a tela ----------
  const NS_SVG = "http://www.w3.org/2000/svg";

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function svgEl(tag, atributos) {
    const e = document.createElementNS(NS_SVG, tag);
    for (const nome in atributos) e.setAttribute(nome, atributos[nome]);
    return e;
  }

  const urlDoFilme = (slug) => "https://letterboxd.com/film/" + slug + "/";
  const nota = (n) => n.toFixed(1) + "★"; // 4.5 -> "4.5★"
  const estrelas = (n) => "★".repeat(Math.floor(n)) + (n % 1 ? "½" : "");
  const inicial = (nome) => nome.replace(/^@/, "").charAt(0).toUpperCase() || "?";

  function sintonia(p) {
    if (p >= 80) return "Alta Sintonia";
    if (p >= 60) return "Boa Sintonia";
    if (p >= 40) return "Sintonia Média";
    return "Baixa Sintonia";
  }

  function linkDoFilme(classe, slug, texto) {
    const a = el("a", classe, texto);
    a.href = urlDoFilme(slug);
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  // ---------- Blocos do painel ----------
  function pessoa(nome, subtitulo) {
    const p = el("div", "lbm-pessoa");
    p.appendChild(el("div", "lbm-avatar", inicial(nome)));
    const textos = el("div", "lbm-pessoa-textos");
    textos.appendChild(el("div", "lbm-pessoa-nome", nome));
    textos.appendChild(el("div", "lbm-pessoa-sub", subtitulo));
    p.appendChild(textos);
    return p;
  }

  // O círculo da porcentagem (um anel que "enche" até o valor)
  function criarAnel(porcentagem) {
    const R = 52;
    const C = 2 * Math.PI * R; // comprimento da circunferência
    const caixa = el("div", "lbm-anel");

    const svg = svgEl("svg", { viewBox: "0 0 140 140" });
    svg.appendChild(svgEl("circle", { class: "lbm-anel-trilho", cx: 70, cy: 70, r: R }));
    const arco = svgEl("circle", {
      class: "lbm-anel-arco", cx: 70, cy: 70, r: R, transform: "rotate(-90 70 70)",
    });
    arco.style.strokeDasharray = "0 " + C;
    svg.appendChild(arco);

    // um coraçãozinho na ponta do arco
    if (porcentagem > 0) {
      const angulo = (-90 + porcentagem * 3.6) * (Math.PI / 180);
      const coracao = svgEl("text", {
        class: "lbm-anel-coracao",
        x: 70 + R * Math.cos(angulo),
        y: 70 + R * Math.sin(angulo),
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      coracao.textContent = "♥";
      svg.appendChild(coracao);
    }

    caixa.appendChild(svg);
    caixa.appendChild(el("div", "lbm-anel-numero", porcentagem + "%"));

    // anima o anel enchendo
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        arco.style.strokeDasharray = (C * porcentagem) / 100 + " " + C;
      })
    );
    return caixa;
  }

  function topoDeSecao(icone, titulo, direita) {
    const t = el("div", "lbm-secao-topo");
    t.appendChild(el("h3", null, icone + " " + titulo));
    t.appendChild(el("span", "lbm-secao-nota", direita));
    return t;
  }

  // Cartão com pôster, título, ano • diretor e uma ou mais linhas de nota
  function cartaoComPoster(f, linhas, pedidos) {
    const { nome, ano } = separarTitulo(f.titulo);
    const card = el("div", "lbm-cartao lbm-filmecard");

    const poster = linkDoFilme("lbm-poster", f.slug);
    poster.title = nome;
    card.appendChild(poster);

    const corpo = el("div", "lbm-corpo");
    corpo.appendChild(linkDoFilme("lbm-titulo", f.slug, nome));
    const sub = el("div", "lbm-sub", ano);
    corpo.appendChild(sub);
    linhas.forEach(([rotulo, valor]) => {
      const l = el("div", "lbm-nota-linha");
      l.appendChild(el("span", null, rotulo));
      l.appendChild(el("span", "lbm-estrelas", estrelas(valor)));
      corpo.appendChild(l);
    });
    card.appendChild(corpo);

    pedidos.push({
      slug: f.slug,
      aoCarregar: (info) => {
        if (info.poster && /^https:\/\//.test(info.poster)) {
          const img = el("img");
          img.src = info.poster;
          img.alt = "";
          poster.appendChild(img);
        }
        sub.textContent = [ano, info.diretor].filter(Boolean).join(" • ");
      },
    });
    return card;
  }

  // Cartão de divergência: título, diretor, "Delta ± X★" e as duas notas lado a lado
  function cartaoDiverge(f, alvo, pedidos) {
    const { nome, ano } = separarTitulo(f.titulo);
    const card = el("div", "lbm-cartao lbm-diverge");

    const topo = el("div", "lbm-diverge-topo");
    const textos = el("div", "lbm-diverge-textos");
    textos.appendChild(linkDoFilme("lbm-titulo", f.slug, nome + (ano ? " (" + ano + ")" : "")));
    const sub = el("div", "lbm-sub", "");
    textos.appendChild(sub);
    topo.appendChild(textos);
    topo.appendChild(el("span", "lbm-delta", "Delta ± " + f.diff.toFixed(1) + "★"));
    card.appendChild(topo);

    const caixas = el("div", "lbm-notaboxes");
    [["Você", f.minha], ["@" + alvo, f.dele]].forEach(([rotulo, valor]) => {
      const b = el("div", "lbm-notabox");
      b.appendChild(el("span", "lbm-notabox-rotulo", rotulo));
      b.appendChild(el("span", "lbm-notabox-valor", nota(valor)));
      caixas.appendChild(b);
    });
    card.appendChild(caixas);

    pedidos.push({ slug: f.slug, aoCarregar: (info) => (sub.textContent = info.diretor || "") });
    return card;
  }

  // ---------- Painel lateral ----------
  function fecharPainel() {
    const antigo = document.querySelector(".lbm-caixa");
    if (antigo) antigo.remove();
  }

  function abrirPainel() {
    fecharPainel();
    const caixa = el("aside", "lbm-caixa");

    const cabecalho = el("div", "lbm-cabecalho");
    const marca = el("div", "lbm-marca");
    marca.appendChild(el("span", null, "MATCH"));
    marca.appendChild(el("span", "lbm-ponto"));
    const fechar = el("button", "lbm-fechar", "✕");
    fechar.title = "Fechar (Esc)";
    fechar.onclick = fecharPainel;
    cabecalho.appendChild(marca);
    cabecalho.appendChild(fechar);
    caixa.appendChild(cabecalho);

    document.body.appendChild(caixa);
    void caixa.offsetWidth; // força o navegador a "ver" o painel fechado antes de abrir (animação)
    caixa.classList.add("lbm-aberta");
    return caixa;
  }

  // Tecla Esc fecha o painel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharPainel();
  });

  function limparConteudo(caixa) {
    caixa.querySelectorAll(".lbm-conteudo").forEach((n) => n.remove());
  }

  function mostrarMensagem(caixa, texto) {
    limparConteudo(caixa);
    const c = el("div", "lbm-conteudo");
    c.appendChild(el("p", "lbm-msg", texto));
    caixa.appendChild(c);
  }

  function mostrarResultado(caixa, eu, alvo, meus, deles, r) {
    limparConteudo(caixa);
    const c = el("div", "lbm-conteudo");
    const pedidos = []; // filmes que precisam de pôster/diretor

    // --- Quem × quem ---
    const pessoas = el("div", "lbm-cartao lbm-pessoas");
    pessoas.appendChild(pessoa("Você", Object.keys(meus).length + " filmes"));
    pessoas.appendChild(el("div", "lbm-troca", "⇄"));
    pessoas.appendChild(pessoa("@" + alvo, Object.keys(deles).length + " filmes"));
    c.appendChild(pessoas);

    // --- Índice de compatibilidade ---
    const indice = el("div", "lbm-cartao lbm-indice");
    indice.appendChild(el("div", "lbm-rotulo", "ÍNDICE DE COMPATIBILIDADE"));
    if (r.porcentagem == null) {
      indice.appendChild(el("p", "lbm-msg", "Vocês ainda não têm filmes avaliados em comum."));
    } else {
      indice.appendChild(criarAnel(r.porcentagem));
      indice.appendChild(el("div", "lbm-sintonia", sintonia(r.porcentagem)));
      indice.appendChild(el("div", "lbm-pequeno", r.totalEmComum + " filmes avaliados em comum"));
      if (!r.confiavel) {
        indice.appendChild(el("div", "lbm-aviso", "⚠ poucos filmes em comum para ter certeza"));
      }
    }
    c.appendChild(indice);

    // --- Vocês dois amaram ---
    if (r.porcentagem != null) {
      const amaram = r.amaram.slice(0, MAX_AMARAM);
      const secaoAmaram = el("section", "lbm-secao");
      secaoAmaram.appendChild(topoDeSecao("♡", "Vocês dois amaram", "Nota ≥ 4.0"));
      if (amaram.length === 0) secaoAmaram.appendChild(el("p", "lbm-vazio", "Nenhum filme que os dois deram 4★ ou mais."));
      amaram.forEach((f) =>
        secaoAmaram.appendChild(cartaoComPoster(f, [["Você", f.minha], ["@" + alvo, f.dele]], pedidos))
      );
      c.appendChild(secaoAmaram);

      // --- Onde vocês divergem ---
      const diverge = r.discordam.slice(0, MAX_DIVERGEM);
      const secaoDiverge = el("section", "lbm-secao");
      secaoDiverge.appendChild(topoDeSecao("⚔", "Onde vocês divergem", "Maior delta"));
      if (diverge.length === 0) secaoDiverge.appendChild(el("p", "lbm-vazio", "Nenhuma grande discordância."));
      diverge.forEach((f) => secaoDiverge.appendChild(cartaoDiverge(f, alvo, pedidos)));
      c.appendChild(secaoDiverge);
    }

    // --- Sugestões ---
    const sugestoes = r.sugestoes.slice(0, MAX_SUGESTOES);
    const secaoSug = el("section", "lbm-secao");
    secaoSug.appendChild(topoDeSecao("🍿", "Para você assistir", "curtidos por @" + alvo));
    if (sugestoes.length === 0) secaoSug.appendChild(el("p", "lbm-vazio", "Nada novo para sugerir por enquanto."));
    sugestoes.forEach((f) =>
      secaoSug.appendChild(cartaoComPoster(f, [["@" + alvo, f.nota]], pedidos))
    );
    c.appendChild(secaoSug);

    // --- Rodapé ---
    const trocar = el("button", "lbm-trocar", "trocar meu usuário (@" + eu + ")");
    trocar.onclick = async () => {
      await obterMeuUsuario(true);
      fecharPainel();
    };
    c.appendChild(trocar);

    caixa.appendChild(c);

    // Depois que a tela já está pronta, busca pôsteres e diretores aos poucos
    carregarInfos(pedidos);
  }

  // ---------- Fluxo principal ao clicar no botão ----------
  async function darMatch(alvo) {
    const eu = await obterMeuUsuario(false);
    if (!eu) return;
    if (eu === alvo) {
      alert("Esse é o seu próprio perfil! Abra o perfil de outra pessoa para dar match.");
      return;
    }

    const caixa = abrirPainel();
    mostrarMensagem(caixa, "Carregando filmes…");
    const aoProgresso = (usuario, n) =>
      mostrarMensagem(caixa, "Carregando filmes de @" + usuario + "… (" + n + ")");

    try {
      const meus = await buscarFilmes(eu, aoProgresso);
      const deles = await buscarFilmes(alvo, aoProgresso);
      mostrarResultado(caixa, eu, alvo, meus, deles, calcularMatch(meus, deles));
    } catch (erro) {
      mostrarMensagem(caixa, erro.message);
    }
  }

  // ---------- Botão flutuante no canto da tela ----------
  const alvo = usuarioDaPagina();
  if (alvo) {
    const botao = el("button", "lbm-botao", "🎬 Dar match");
    botao.onclick = () => darMatch(alvo);
    document.body.appendChild(botao);
  }
})();
