/**
 * Tradutor SB — roda no GitHub Actions, sem depender do seu PC.
 *
 * Faz as chamadas à IA (OpenRouter) e usa a "ponte" do Apps Script
 * para ler e gravar no Google Docs. As regras, a fila, o glossário
 * e o Config continuam todos no Apps Script.
 *
 * Variáveis (Secrets do GitHub): PONTE_URL, PONTE_TOKEN, OPENROUTER_API_KEY.
 */

const regras = require("./regras.js");

const limpar = v => String(v || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");
const PONTE_URL = limpar(process.env.PONTE_URL);
const PONTE_TOKEN = limpar(process.env.PONTE_TOKEN);
const OPENROUTER_API_KEY = limpar(process.env.OPENROUTER_API_KEY);
const IA_URL = process.env.IA_URL || "https://openrouter.ai/api/v1/chat/completions";
const LIMITE_MS = Number(process.env.LIMITE_MINUTOS || 340) * 60 * 1000;
const INICIO = Date.now();

let gastoUS = 0;
let tokensEntrada = 0;
let tokensCache = 0;
let tokensSaida = 0;

const esperar = ms => new Promise(r => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
const log = texto => console.log("[" + hora() + "] " + texto);

function erro(tipo, mensagem) {
  return Object.assign(new Error(mensagem), { tipo });
}


/* ---------- Ponte com o Apps Script ---------- */

async function ponte(acao, dados = {}) {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      const r = await fetch(PONTE_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ token: PONTE_TOKEN, acao, ...dados }),
        redirect: "follow"
      });

      const texto = await r.text();
      let json;
      try {
        json = JSON.parse(texto);
      } catch {
        // Página de erro do Google: mostra só o texto legível (a mensagem do erro).
        const legivel = texto.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
        throw new Error("Resposta inesperada da ponte (HTTP " + r.status + "): " + legivel.slice(0, 400));
      }

      if (json.erro && json.tipo !== "OCUPADO") throw erro(json.tipo || "PONTE", json.erro);
      if (!json.erro) return json;

      log("Apps Script ocupado. Aguardando 1 min.");
    } catch (e) {
      if (e.tipo && e.tipo !== "OCUPADO" || tentativa === 4) throw e;
      log("Falha na ponte (" + e.message + "). Nova tentativa.");
    }
    await esperar(60000);
  }
  throw erro("PONTE", "A ponte não respondeu.");
}


/* ---------- IA (OpenRouter) ---------- */

async function chamarIA(config, instrucoes, mensagem, sessao) {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    let r;

    try {
      r = await fetch(IA_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "x-session-id": sessao
        },
        body: JSON.stringify({
          model: config.modelo,
          messages: [
            { role: "system", content: instrucoes },
            { role: "user", content: mensagem }
          ],
          max_tokens: Number(config.maxTokens) || 32000,
          reasoning: { effort: config.esforco || "low" },
          session_id: sessao, // mantém o mesmo provedor e aproveita o cache
          provider: { sort: "price" }, // mesmo modelo, no provedor mais barato (é mais lento)
          usage: { include: true }
        }),
        signal: AbortSignal.timeout(15 * 60 * 1000)
      });
    } catch (e) {
      log("IA sem resposta (" + e.message + "). Tentativa " + tentativa + ".");
      await esperar(20000 * tentativa);
      continue;
    }

    // A conexão pode cair no meio da resposta ("terminated"): tenta de novo aqui mesmo.
    let corpo;
    try {
      corpo = await r.text();
    } catch (e) {
      log("Conexão com a IA caiu no meio da resposta (" + e.message + "). Tentativa " + tentativa + ".");
      await esperar(20000 * tentativa);
      continue;
    }

    if (r.status === 200) {
      const json = JSON.parse(corpo);
      if (json.error) throw new Error("OpenRouter: " + JSON.stringify(json.error).slice(0, 300));

      const c = (json.choices || [])[0] || {};
      const texto = (c.message && c.message.content) || "";

      if (json.usage && json.usage.cost) gastoUS += json.usage.cost;
      if (json.usage) {
        tokensEntrada += json.usage.prompt_tokens || 0;
        tokensCache += (json.usage.prompt_tokens_details && json.usage.prompt_tokens_details.cached_tokens) || 0;
        tokensSaida += json.usage.completion_tokens || 0;
      }

      // Cortada por tamanho: devolve o que veio; quem chamou pede a continuação.
      if (c.finish_reason === "length") return { texto, cortado: true };
      if (c.finish_reason === "content_filter") throw erro("BLOQUEIO", "A IA recusou o trecho (filtro de conteúdo).");

      // Falha passageira do provedor: resposta vazia ou interrompida. Tenta de novo.
      if (!texto.trim() || c.finish_reason === "error") {
        log("IA devolveu resposta vazia (motivo: " + c.finish_reason + "). Tentativa " + tentativa + ".");
        await esperar(30000 * tentativa);
        continue;
      }

      return { texto, cortado: false };
    }

    if (r.status === 402) throw erro("COTA", "Créditos do OpenRouter esgotados.");
    if (r.status === 401) throw erro("COTA", "Chave do OpenRouter recusada. Confira o Secret OPENROUTER_API_KEY.");

    if (r.status === 429 || r.status >= 500) {
      log("IA ocupada (HTTP " + r.status + "). Tentativa " + tentativa + ".");
      await esperar(30000 * tentativa);
      continue;
    }

    throw new Error("IA HTTP " + r.status + ": " + corpo.slice(0, 500));
  }

  throw erro("INDISPONIVEL", "A IA não respondeu depois de 5 tentativas.");
}


/* ---------- Leitura da resposta (igual ao Trechos.gs) ---------- */

/**
 * Pontuação de diálogo no padrão SB:
 * - travessão de fala é sempre "—" (troca "–", "―", "−" e "-" usados no lugar dele);
 * - travessão colado em palavra vira reticências ("eu—e—não sei" → "eu… e… não sei").
 */
function corrigirPontuacao(texto) {
  let t = texto.replace(/^(\*{0,3})[–―−-]\s*/, "$1— ");

  // Dentro da fala (bloco que começa com travessão), o intercalado também vira "—".
  if (/^\*{0,3}— /.test(t)) t = t.replace(/\s[–―−-]\s/g, " — ");

  return t
    .replace(/(\p{L})[—–](?=\p{L})/gu, "$1… ")
    .replace(/(\p{L})[—–](?=$|[”"*?!.,])/gu, "$1…");
}


function lerResposta(texto) {
  const blocos = [];

  String(texto || "").replace(/^```.*$/gm, "").split(/\r?\n/).forEach(linha => {
    const l = linha.trim();
    if (!l || /^\[G\]/i.test(l)) return;

    const m = l.match(/^\[(\d+)\]\s*(.*)$/);
    if (m) {
      if (m[2].trim()) blocos.push({ num: Number(m[1]), texto: corrigirPontuacao(m[2].trim()) });
    } else if (blocos.length) {
      blocos.push({ num: blocos[blocos.length - 1].num, texto: corrigirPontuacao(l) });
    }
  });

  return blocos;
}


function lerGlossario(texto) {
  const itens = [];

  String(texto || "").split(/\r?\n/).forEach(linha => {
    // [G] SEÇÃO | inglês | decisão | nº do parágrafo | observação
    const m = linha.trim().match(/^\[G\]\s*(.+)$/i);
    if (!m) return;
    const c = m[1].split("|").map(x => x.trim());
    if (c.length < 3 || !c[1]) return;
    const num = (c[3] || "").match(/\d+/);
    itens.push({ secao: c[0], termo: c[1], decisao: c[2], num: num ? Number(num[0]) : 0, obs: c.slice(num ? 4 : 3).join(" | ") });
  });

  return itens;
}


/* ---------- Ciclo de um trecho (mesmas regras da skill) ---------- */

function melhorOuIgual(nova, atual) {
  if (nova.grave !== atual.grave) return !nova.grave;
  if (nova.falta !== atual.falta) return nova.falta < atual.falta;
  return nova.alertas <= atual.alertas;
}


async function traduzirTrecho(item) {
  const sessao = "sb-" + item.originalId;
  const glossario = [];
  const n = item.en.length;
  const versao = blocos => blocos.map(b => "[" + b.num + "] " + b.texto).join("\n");

  // Pede à IA e, se a resposta vier cortada por tamanho, continua de onde parou:
  // guarda só os parágrafos completos e pede o resto, sem cortar parágrafo no meio.
  const pedir = async (mensagem, de = 1, ate = n) => {
    const blocos = [];
    let inicio = de;
    let fim = ate;

    for (let parte = 1; parte <= 8; parte++) {
      const msg = inicio === de && fim === ate ? mensagem : mensagem +
        "\n\n=== CONTINUAÇÃO ===\nOs parágrafos de [" + de + "] a [" + (inicio - 1) + "] já foram recebidos. " +
        "Devolva SOMENTE de [" + inicio + "] a [" + fim + "], no mesmo formato, sem repetir os anteriores.";

      const r = await chamarIA(item.config, item.instrucoes, msg + regras.lembreteFinal(), sessao);
      glossario.push(...lerGlossario(r.texto));

      let novos = lerResposta(r.texto).filter(b => b.num >= inicio && b.num <= fim);

      // O último parágrafo de uma resposta cortada pode estar pela metade: descarta.
      if (r.cortado && novos.length) {
        const ultimo = novos[novos.length - 1].num;
        novos = novos.filter(b => b.num !== ultimo);
      }

      blocos.push(...novos);
      const recebidoAte = novos.length ? novos[novos.length - 1].num : inicio - 1;

      if (!r.cortado) {
        if (fim === ate) return blocos;
        inicio = Math.max(recebidoAte, fim) + 1; // terminou a metade pedida; segue para o resto
        fim = ate;
        continue;
      }

      if (recebidoAte >= inicio) {
        log("Resposta longa: recebido até [" + recebidoAte + "] de [" + ate + "]. Continuando de onde parou.");
        inicio = recebidoAte + 1;
      } else {
        // Nada completo veio: pede metade do que falta.
        if (fim <= inicio) throw erro("LONGO", "Um único parágrafo passou do limite de resposta da IA.");
        fim = inicio + Math.floor((fim - inicio) / 2);
        log("Resposta longa sem parágrafo completo. Pedindo de [" + inicio + "] a [" + fim + "].");
      }
    }

    throw erro("LONGO", "A resposta continuou cortada depois de 8 partes.");
  };

  const conferir = blocos => ponte("conferir", { en: item.en, blocos, nomes: item.nomes });

  // Troca só os parágrafos que voltaram; o resto fica como estava (a ordem dentro do mesmo § se mantém).
  const trocar = (atuais, corrigidos) => {
    const recebidos = new Set(corrigidos.map(b => b.num));
    return atuais.filter(b => !recebidos.has(b.num)).concat(corrigidos).sort((a, b) => a.num - b.num);
  };

  // Números de parágrafo citados num relatório da checagem ("§12" ou "[12]").
  const apontados = texto => {
    const nums = new Set();
    String(texto || "").replace(/(?:§|\[)\s*(\d+)/g, (_, k) => {
      k = Number(k);
      if (k >= 1 && k <= n) nums.add(k);
    });
    return [...nums].sort((a, b) => a - b);
  };

  // Correção: a IA recebe o mesmo contexto de antes (skill, pedido e versão atual inteira),
  // mas reescreve só os parágrafos apontados. Se o relatório não citar parágrafos,
  // ou citar mais da metade, pede o trecho completo, como antes.
  const revisar = async (atuais, titulo, relatorio, orientacao) => {
    const base = item.pedido +
      "\n\n=== SUA VERSÃO ATUAL ===\n" + versao(atuais) +
      "\n\n=== " + titulo + " APONTOU ===\n" + relatorio +
      "\n\n" + orientacao;
    const nums = apontados(relatorio);

    if (!nums.length || nums.length > n / 2) {
      return pedir(base + " Devolva o trecho COMPLETO, de [1] a [" + n + "].");
    }

    log(titulo + ": reescrevendo só §" + nums.join(", §") + ".");
    const quer = new Set(nums);
    const r = await chamarIA(item.config, item.instrucoes, base + regras.lembreteFinal() +
      "\n\n=== NESTA RESPOSTA ===\nDevolva SOMENTE os parágrafos " + nums.map(k => "[" + k + "]").join(", ") +
      ", completos, no formato [número] texto. Não repita os demais.", sessao);

    glossario.push(...lerGlossario(r.texto));
    return trocar(atuais, lerResposta(r.texto).filter(b => quer.has(b.num)));
  };

  let blocos = await pedir(item.pedido);
  let c = await conferir(blocos);
  let rodadas = 0;

  // 3B: alerta simples corrige uma vez; parágrafo faltando, até o limite do Config.
  while (
    (c.grave && rodadas < item.config.rodadas) ||
    (c.alertas && rodadas === 0)
  ) {
    rodadas++;

    const novos = await revisar(blocos, "CHECAGEM MECÂNICA (3B)", c.textoConferencia,
      "Confira cada ponto com o original. Traduza o que faltou e insira no lugar certo; " +
      "corrija perda, acréscimo ou erro; mantenha o que, conferido, estiver correto.");

    const nova = await conferir(novos);
    if (!melhorOuIgual(nova, c)) break;

    blocos = novos;
    c = nova;
  }

  // Parágrafo faltando: pede só os que faltaram (barato), até 3 vezes, e encaixa no lugar.
  const faltando = lista => {
    const tem = new Set(lista.map(b => b.num));
    const f = [];
    for (let k = 1; k <= n; k++) if (!tem.has(k)) f.push(k);
    return f;
  };

  for (let tentativa = 1; tentativa <= 3 && faltando(blocos).length; tentativa++) {
    const faltam = faltando(blocos);
    log("Faltaram " + faltam.length + " parágrafo(s): §" + faltam.join(", §") + ". Pedindo só esses (tentativa " + tentativa + ").");

    const pedido = "=== PARÁGRAFOS QUE FICARAM DE FORA ===\n" +
      "Traduza SOMENTE os parágrafos abaixo, completos, seguindo todas as regras. " +
      "Devolva cada um no formato [número] texto, com o mesmo número do original.\n\n" +
      faltam.map(k => "[" + k + "] " + regras.textoEN(item.en, k)).join("\n\n");

    const r = await chamarIA(item.config, item.instrucoes, pedido + regras.lembreteFinal(), sessao);
    const quer = new Set(faltam);
    const novos = lerResposta(r.texto).filter(b => quer.has(b.num));
    if (!novos.length) continue;

    blocos = blocos.concat(novos).sort((a, b) => a.num - b.num); // a ordem dentro do mesmo § se mantém
    c = await conferir(blocos);
  }

  if (faltando(blocos).length) {
    throw erro("FALTA", "Ainda faltam os parágrafos §" + faltando(blocos).join(", §") + " depois de 3 tentativas.");
  }

  // 3C: uma reescrita de estilo, aceita só se não piorar a 3B.
  if (!c.grave && c.alertasEstilo) {
    const novos = await revisar(blocos, "CHECAGEM DE ESTILO (3C)", c.textoEstilo,
      "Reescreva só o que for vício de estilo (seções 6A e 6B), sem perder nem acrescentar conteúdo.");

    const nova = await conferir(novos);
    if (!nova.grave && nova.alertas <= c.alertas) {
      blocos = novos;
      c = nova;
    }
  }

  // Trava das regras SB: confere por código e manda corrigir só os parágrafos que quebraram alguma regra.
  blocos = regras.autocorrigir(blocos);
  let violacoes = regras.checarRegras(blocos, item.en);

  for (let rodada = 1; violacoes.length && rodada <= 2; rodada++) {
    const nums = new Set(violacoes.map(v => v.num));
    const pedido = "=== CORREÇÃO DE REGRAS SB ===\n" +
      "Reescreva SOMENTE os parágrafos abaixo, corrigindo a regra indicada em cada um, sem perder nem acrescentar conteúdo. " +
      "Devolva cada um no formato [número] texto.\n\n" +
      violacoes.map(v =>
        "ORIGINAL [" + v.num + "] " + regras.textoEN(item.en, v.num) + "\n" +
        "SUA VERSÃO:\n" + versao(blocos.filter(b => b.num === v.num)) + "\n" +
        "CORRIJA: " + v.instrucoes.join(" ")
      ).join("\n\n");

    const r = await chamarIA(item.config, item.instrucoes, pedido, sessao);
    const corrigidos = regras.autocorrigir(lerResposta(r.texto).filter(b => nums.has(b.num)));
    const novos = trocar(blocos, corrigidos);

    const nova = await conferir(novos);
    const novasViolacoes = regras.checarRegras(novos, item.en);
    if (nova.grave || nova.falta > c.falta || novasViolacoes.length > violacoes.length) break;

    blocos = novos;
    c = nova;
    violacoes = novasViolacoes;
  }

  const pendentes = violacoes.map(v => "§" + v.num + " (" + v.regras.join(", ") + ")");
  const regrasPendentes = violacoes.map(v => ({ num: v.num, regras: v.regras }));
  return { blocos, rodadas, glossario, pendentes, regrasPendentes };
}


/* ---------- Motor ---------- */

const ESPERA_ERRO_MS = 10 * 60 * 1000;
const restante = () => LIMITE_MS - (Date.now() - INICIO);

/** Espera 10 minutos (ou o que faltar da execução) antes de tentar de novo. */
async function esperarETentar(motivo) {
  const ms = Math.min(ESPERA_ERRO_MS, Math.max(restante(), 0));
  log(motivo + " Tentando de novo em " + Math.round(ms / 60000) + " min.");
  await esperar(ms);
}

/** Avisa o GitHub para começar a próxima execução logo depois desta. */
function pedirContinuacao() {
  if (process.env.GITHUB_OUTPUT) require("fs").appendFileSync(process.env.GITHUB_OUTPUT, "continuar=true\n");
}


async function main() {
  if (!PONTE_URL || !PONTE_TOKEN || !OPENROUTER_API_KEY) {
    throw new Error("Faltam os Secrets PONTE_URL, PONTE_TOKEN ou OPENROUTER_API_KEY.");
  }

  let trechos = 0;
  let motivoFim = "";
  const refeitos = {};

  while (restante() > 0) {
    let item;

    try {
      item = await ponte("proximo");
    } catch (e) {
      await esperarETentar("ERRO ao buscar o próximo trecho: " + e.message + ".");
      continue;
    }

    if (item.vazio) {
      motivoFim = "Fila vazia: nenhum livro NA FILA ou EM ANDAMENTO. Confiro de novo na próxima hora.";
      break;
    }

    if (item.concluido) {
      log("LIVRO CONCLUÍDO: " + item.concluido);
      continue;
    }

    // Trava: a skill e o Doc de exemplos precisam chegar à IA. Se não chegarem, pausa o livro.
    const problema = regras.conferirInstrucoes(item.instrucoes, item.pedido);
    if (problema) {
      log("LIVRO PAUSADO: " + problema);
      await ponte("pausar", { originalId: item.originalId, mensagem: problema }).catch(() => {});
      continue;
    }

    const custoAntes = gastoUS;
    const entradaAntes = tokensEntrada;
    const cacheAntes = tokensCache;
    const saidaAntes = tokensSaida;
    log("Traduzindo: " + item.rotulo);

    try {
      const r = await traduzirTrecho(item);
      const { pendentes, ...dados } = r;
      const g = await ponte("gravar", { originalId: item.originalId, pos: item.pos, paragrafos: item.en.length, ...dados });

      (g.linhas || []).forEach(l => log(l));
      if (g.pausado) log("LIVRO PAUSADO: " + g.pausado);
      if (g.ignorado) log(g.ignorado);
      log("Regras SB: " + (pendentes.length ? pendentes.length + " pendente(s): " + pendentes.join("; ") : "todas cumpridas") + ".");
      if (r.glossario.length) log("Glossário: " + r.glossario.length + " sugestão(ões) enviada(s).");

      const entrada = tokensEntrada - entradaAntes;
      if (entrada) {
        log("Leitura da skill e do pedido: " + entrada + " tokens, " +
          Math.round(100 * (tokensCache - cacheAntes) / entrada) + "% com desconto de cache.");
      }

      log("Resposta da IA: " + (tokensSaida - saidaAntes) + " tokens.");

      log("Custo do trecho: US$ " + (gastoUS - custoAntes).toFixed(4) +
        " · total desta execução: US$ " + gastoUS.toFixed(4));

      trechos++;

    } catch (e) {
      // Créditos ou chave: não adianta insistir.
      if (e.tipo === "COTA") {
        motivoFim = "PARADO: " + e.message + " Recarregue; a próxima execução continua de onde parou.";
        break;
      }

      // Parágrafo faltando mesmo depois das tentativas: refaz o trecho inteiro mais uma vez antes de pausar.
      if (e.tipo === "FALTA") {
        const chave = item.originalId + ":" + JSON.stringify(item.pos);
        refeitos[chave] = (refeitos[chave] || 0) + 1;

        if (refeitos[chave] <= 1) {
          log(e.message + " Refazendo o trecho inteiro. Nada foi gravado.");
          continue;
        }

        log("LIVRO PAUSADO: " + e.message);
        await ponte("pausar", { originalId: item.originalId, mensagem: e.message }).catch(() => {});
        continue;
      }

      // Problema no conteúdo do trecho: repetir daria o mesmo resultado.
      if (e.tipo === "LONGO" || e.tipo === "BLOQUEIO") {
        log("LIVRO PAUSADO: " + e.message);
        await ponte("pausar", { originalId: item.originalId, mensagem: e.message }).catch(() => {});
        continue;
      }

      // Qualquer outra falha (IA fora do ar, Google, rede): espera e repete o mesmo trecho.
      await esperarETentar("ERRO: " + e.message + ". Nada foi gravado.");
    }
  }

  if (!motivoFim) {
    motivoFim = "Tempo da execução esgotado. A próxima começa em seguida.";
    pedirContinuacao();
  }

  log(motivoFim);
  log("Fim desta execução: " + trechos + " trecho(s), US$ " + gastoUS.toFixed(4) + ".");
}


main().catch(e => {
  log("ERRO FATAL: " + e.message);
  process.exit(1);
});
