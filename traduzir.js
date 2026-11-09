/**
 * Tradutor SB — roda no GitHub Actions, sem depender do seu PC.
 *
 * Faz as chamadas à IA (OpenRouter) e usa a "ponte" do Apps Script
 * para ler e gravar no Google Docs. As regras, a fila, o glossário
 * e o Config continuam todos no Apps Script.
 *
 * Variáveis (Secrets do GitHub): PONTE_URL, PONTE_TOKEN, OPENROUTER_API_KEY.
 */

const { PONTE_URL, PONTE_TOKEN, OPENROUTER_API_KEY } = process.env;
const IA_URL = process.env.IA_URL || "https://openrouter.ai/api/v1/chat/completions";
const LIMITE_MS = Number(process.env.LIMITE_MINUTOS || 340) * 60 * 1000;
const INICIO = Date.now();

let gastoUS = 0;

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
        throw new Error("Resposta inesperada da ponte (HTTP " + r.status + "): " + texto.slice(0, 300));
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
          max_tokens: 32000,
          reasoning: { effort: config.esforco || "low" },
          session_id: sessao, // mantém o mesmo provedor e aproveita o cache
          usage: { include: true }
        }),
        signal: AbortSignal.timeout(15 * 60 * 1000)
      });
    } catch (e) {
      log("IA sem resposta (" + e.message + "). Tentativa " + tentativa + ".");
      await esperar(20000 * tentativa);
      continue;
    }

    const corpo = await r.text();

    if (r.status === 200) {
      const json = JSON.parse(corpo);
      if (json.error) throw new Error("OpenRouter: " + JSON.stringify(json.error).slice(0, 300));

      const c = (json.choices || [])[0] || {};
      const texto = (c.message && c.message.content) || "";

      if (json.usage && json.usage.cost) gastoUS += json.usage.cost;

      if (c.finish_reason === "length") throw erro("LONGO", "Resposta cortada por tamanho. Diminua PALAVRAS_POR_TRECHO.");
      if (!texto.trim()) throw erro("BLOQUEIO", "Resposta vazia da IA (motivo: " + c.finish_reason + ").");

      return texto;
    }

    if (r.status === 402) throw erro("COTA", "Créditos do OpenRouter esgotados.");

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

function lerResposta(texto) {
  const blocos = [];

  String(texto || "").replace(/^```.*$/gm, "").split(/\r?\n/).forEach(linha => {
    const l = linha.trim();
    if (!l || /^\[G\]/i.test(l)) return;

    const m = l.match(/^\[(\d+)\]\s*(.*)$/);
    if (m) {
      if (m[2].trim()) blocos.push({ num: Number(m[1]), texto: m[2].trim() });
    } else if (blocos.length) {
      blocos.push({ num: blocos[blocos.length - 1].num, texto: l });
    }
  });

  return blocos;
}


function lerGlossario(texto) {
  const itens = [];

  String(texto || "").split(/\r?\n/).forEach(linha => {
    const m = linha.trim().match(/^\[G\]\s*([^|]+)\|([^|]+)\|(.+)$/i);
    if (m) itens.push({ secao: m[1].trim(), termo: m[2].trim(), decisao: m[3].trim() });
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

  const pedir = async mensagem => {
    const resposta = await chamarIA(item.config, item.instrucoes, mensagem, sessao);
    glossario.push(...lerGlossario(resposta));
    return lerResposta(resposta);
  };

  const conferir = blocos => ponte("conferir", { en: item.en, blocos, nomes: item.nomes });

  let blocos = await pedir(item.pedido);
  let c = await conferir(blocos);
  let rodadas = 0;

  // 3B: alerta simples corrige uma vez; parágrafo faltando, até o limite do Config.
  while (
    (c.grave && rodadas < item.config.rodadas) ||
    (c.alertas && rodadas === 0)
  ) {
    rodadas++;

    const novos = await pedir(item.pedido +
      "\n\n=== SUA VERSÃO ATUAL ===\n" + versao(blocos) +
      "\n\n=== CHECAGEM MECÂNICA (3B) APONTOU ===\n" + c.textoConferencia +
      "\n\nConfira cada ponto com o original. Traduza o que faltou e insira no lugar certo; " +
      "corrija perda, acréscimo ou erro; mantenha o que, conferido, estiver correto. " +
      "Devolva o trecho COMPLETO, de [1] a [" + n + "].");

    const nova = await conferir(novos);
    if (!melhorOuIgual(nova, c)) break;

    blocos = novos;
    c = nova;
  }

  // 3C: uma reescrita de estilo, aceita só se não piorar a 3B.
  if (!c.grave && c.alertasEstilo) {
    const novos = await pedir(item.pedido +
      "\n\n=== SUA VERSÃO ATUAL ===\n" + versao(blocos) +
      "\n\n=== CHECAGEM DE ESTILO (3C) APONTOU ===\n" + c.textoEstilo +
      "\n\nReescreva só o que for vício de estilo (seções 6A e 6B), sem perder nem acrescentar conteúdo. " +
      "Devolva o trecho COMPLETO, de [1] a [" + n + "].");

    const nova = await conferir(novos);
    if (!nova.grave && nova.alertas <= c.alertas) {
      blocos = novos;
      c = nova;
    }
  }

  return { blocos, rodadas, glossario };
}


/* ---------- Motor ---------- */

async function main() {
  if (!PONTE_URL || !PONTE_TOKEN || !OPENROUTER_API_KEY) {
    throw new Error("Faltam os Secrets PONTE_URL, PONTE_TOKEN ou OPENROUTER_API_KEY.");
  }

  let errosSeguidos = 0;
  let trechos = 0;

  while (Date.now() - INICIO < LIMITE_MS) {
    let item;

    try {
      item = await ponte("proximo");
    } catch (e) {
      log("ERRO ao buscar o próximo trecho: " + e.message);
      if (++errosSeguidos >= 3) break;
      await esperar(120000);
      continue;
    }

    if (item.vazio) {
      log("Fila vazia: nenhum livro NA FILA ou EM ANDAMENTO.");
      break;
    }

    if (item.concluido) {
      log("LIVRO CONCLUÍDO: " + item.concluido);
      continue;
    }

    const custoAntes = gastoUS;
    log("Traduzindo: " + item.rotulo);

    try {
      const r = await traduzirTrecho(item);
      const g = await ponte("gravar", { originalId: item.originalId, pos: item.pos, ...r });

      (g.linhas || []).forEach(l => log(l));
      if (g.pausado) log("LIVRO PAUSADO: " + g.pausado);
      if (g.ignorado) log(g.ignorado);
      if (r.glossario.length) log("Glossário: " + r.glossario.length + " sugestão(ões) enviada(s).");

      log("Custo do trecho: US$ " + (gastoUS - custoAntes).toFixed(4) +
        " · total desta execução: US$ " + gastoUS.toFixed(4));

      trechos++;
      errosSeguidos = 0;

    } catch (e) {
      if (e.tipo === "COTA") {
        log("PARADO: " + e.message + " Recarregue os créditos; a próxima execução continua de onde parou.");
        break;
      }

      if (e.tipo === "LONGO" || e.tipo === "BLOQUEIO") {
        log("LIVRO PAUSADO: " + e.message);
        await ponte("pausar", { originalId: item.originalId, mensagem: e.message }).catch(() => {});
        continue;
      }

      log("ERRO: " + e.message);
      if (++errosSeguidos >= 3) {
        await ponte("pausar", { originalId: item.originalId, mensagem: "erro: " + e.message.slice(0, 120) }).catch(() => {});
        errosSeguidos = 0;
      }
      await esperar(60000);
    }
  }

  log("Fim desta execução: " + trechos + " trecho(s), US$ " + gastoUS.toFixed(4) + ".");
}


main().catch(e => {
  log("ERRO FATAL: " + e.message);
  process.exit(1);
});
