/**
 * Regras SB conferidas por código — a "trava" da skill.
 *
 * Toda regra aqui é checada em TODO trecho, sem depender da IA lembrar.
 * O que quebrar uma regra volta para a IA corrigir (só aquele parágrafo).
 *
 * Para acrescentar uma regra: copie uma linha de REGRAS e troque
 * o nome, o padrão (regex) e a instrução.
 */

/* Marcas que precisam estar nas instruções enviadas à IA.
 * Se faltar alguma, o livro pausa: a skill ou o Doc de exemplos não chegou. */
const MARCAS_OBRIGATORIAS = [
  { marca: "PARTE 4", nome: "Doc \"Exemplos e erros SB\" (Parte 4 — preferências)" }
];
const TAMANHO_MINIMO_SKILL = 8000; // caracteres; abaixo disso a skill veio incompleta


/* Correções automáticas, seguras, feitas sem chamar a IA. */
const AUTOCORRECOES = [
  [/\bOkay\b/g, "Ok"],
  [/\bokay\b/g, "ok"],
  [/\bOKAY\b/g, "OK"]
];


/* Palavra inteira, aceitando acentos (o \b do JavaScript não entende "tá" ou "né"). */
const palavra = (lista, flags = "iu") => new RegExp("(?<!\\p{L})(" + lista + ")(?!\\p{L})", flags);


/* O parágrafo em inglês tem fala (e não só aspas de ênfase)? */
const temFala = en => /^\s*\*{0,3}["“]/.test(en) || /[,?!…]\*{0,3}["”]/.test(en);


/* Regras checadas em cada parágrafo traduzido. */
const REGRAS = [
  { nome: "registro coloquial", padrao: palavra("tô|tá|tava|tavam|tamo|né|vc|pra|pras|pro|pros|cê"),
    instrucao: "Nunca \"tô\", \"tá\", \"tava\", \"né\", \"pra\", \"pro\", \"vc\", nem em fala: use a forma completa (\"estou\", \"está\", \"para\"). \"tá bom\" → \"está bem\" ou \"certo\"." },

  { nome: "palavra fora do padrão editorial", padrao: palavra("trep\\p{L}*|paparic\\p{L}*|boyzinho\\p{L}*|vendeta\\p{L}*|chiliques?|danad[oa]s?|xoxota\\p{L}*|cu"),
    instrucao: "\"trepar\" → \"transar\"; \"paparico\" → \"mimo\"; \"boyzinho\" → \"rapaz\"; \"vendeta\" → \"vingança\"; \"chilique\" → \"escândalo\"; nunca \"danada\" (use \"porra\", \"caralho\"); nunca \"cu\" nem \"xoxota\" (ass → \"bunda\"; pussy → \"boceta\")." },

  { nome: "pronome \"te\" com locução", padrao: palavra("(estou|está|estava|estamos|vou|vai|vamos|posso|pode|podia|quero|queria|preciso|precisa)\\s+te\\s+\\p{L}+"),
    instrucao: "\"Estou te vendo\", \"posso te ajudar\" → \"Estou vendo você\", \"Posso ajudar você\"." },

  { nome: "termo em inglês", padrao: palavra("Doc|UK|US|USA", "u"),
    instrucao: "\"Doc\" (médica) → \"doutora\"; \"UK\" → \"Reino Unido\"; \"US\"/\"USA\" → \"Estados Unidos\"." },

  { nome: "travessão na narração", teste: pt => pt.split("\n").some(l => !/^\*{0,3}—/.test(l.trim()) && /\s—\s/.test(l)), // linha a linha: narração e fala podem vir em blocos separados
    instrucao: "Travessão só em diálogo. Na narração, troque por vírgula, ponto e vírgula, dois-pontos, reticências ou parênteses." },

  // Fala de verdade no original: parágrafo que abre com aspas, ou aspas fechando depois de , ? ! …
  // (aspas de ênfase, título ou placa não contam).
  { nome: "fala sem travessão", teste: (pt, en) => temFala(en) && !/—/.test(pt),
    instrucao: "O original tem fala entre aspas: em português, fala vai com travessão no início da linha, nunca aspas nem discurso indireto (\"— Oi — ela diz.\"). Se o mesmo parágrafo tiver narração e fala, separe em blocos com o mesmo número: [7] Ela desligou. / [7] — Droga." }
];


/** Texto completo de cada parágrafo traduzido (junta as linhas do mesmo número). */
function agruparPorNumero(blocos) {
  const mapa = new Map();
  blocos.forEach(b => mapa.set(b.num, (mapa.has(b.num) ? mapa.get(b.num) + "\n" : "") + b.texto));
  return mapa;
}

function textoEN(en, num) {
  const p = en[num - 1];
  return typeof p === "string" ? p : (p && (p.texto || p.text)) || "";
}


/** Aplica as autocorreções. Devolve os blocos corrigidos. */
function autocorrigir(blocos) {
  return blocos.map(b => {
    let t = b.texto;
    AUTOCORRECOES.forEach(([de, para]) => { t = t.replace(de, para); });
    return { ...b, texto: t };
  });
}


/* ---------- Títulos (Título 1 a 4 do Google Docs) ---------- */

const MAX_PALAVRAS_TITULO = 12; // parágrafo maior que isso no original nunca vira título

/** Nível de título do parágrafo no original (1 a 4), ou 0 se for texto comum. */
function nivelOriginal(en, num) {
  const p = en[num - 1];

  // Original marcado no próprio texto: "# Chapter 1", "## Jace".
  if (typeof p === "string") {
    const m = p.trim().match(/^(#{1,4})\s/);
    return m ? m[1].length : 0;
  }
  if (!p || typeof p !== "object") return 0;

  const v = p.nivel ?? p.heading ?? p.estilo ?? p.titulo ?? "";
  if (typeof v === "number") return v >= 1 && v <= 4 ? v : 0;

  const s = String(v).toUpperCase().replace(/[\s_]/g, "");
  if (s === "TITLE") return 1;
  if (s === "SUBTITLE") return 2;
  const m = s.match(/(?:HEADING|TITULO|TÍTULO)([1-6])/);
  return m ? Math.min(Number(m[1]), 4) : 0;
}

/**
 * Define o nível final de cada bloco:
 * - se o original tem título, usa o nível do original (a IA não muda);
 * - se não tem, aceita o "#" da IA só em parágrafo curto (título de verdade).
 */
function ajustarTitulos(blocos, en) {
  return blocos.map(b => {
    const original = nivelOriginal(en, b.num);
    if (original) return { ...b, nivel: original };

    const curto = textoEN(en, b.num).trim().split(/\s+/).length <= MAX_PALAVRAS_TITULO;
    return { ...b, nivel: curto ? (b.nivel || 0) : 0 };
  });
}


/** Lista de violações: [{ num, regras: [nome...], instrucoes: [...] }] */
function checarRegras(blocos, en) {
  const violacoes = [];

  agruparPorNumero(blocos).forEach((pt, num) => {
    const enTexto = textoEN(en, num);
    const quebradas = REGRAS.filter(r => r.teste ? r.teste(pt, enTexto) : r.padrao.test(pt));
    if (quebradas.length) {
      violacoes.push({ num, regras: quebradas.map(r => r.nome), instrucoes: quebradas.map(r => r.instrucao) });
    }
  });

  return violacoes;
}


/** Lembrete curto que vai no FIM de todo pedido (a IA dá mais peso ao que lê por último). */
function lembreteFinal() {
  return "\n\n=== ANTES DE RESPONDER, CONFIRA (regras SB, sem exceção) ===\n" +
    "- Siga a skill inteira e o Doc de exemplos SB do começo ao fim do trecho, não só no início.\n" +
    "- Traduza TODOS os parágrafos, na ordem, sem resumir, cortar ou juntar.\n" +
    REGRAS.map(r => "- " + r.instrucao).join("\n") + "\n" +
    "- Fala hesitante usa reticências, nunca travessão colado na palavra (\"Eu… e… não sei.\").\n" +
    "- Mesmo tempo verbal do original; palavrões e cenas explícitas com o mesmo peso, sem suavizar.\n" +
    "- TÍTULOS: comece a linha de todo título com # e um espaço, mesmo que o original não esteja formatado como título:\n" +
    "  # = parte, capítulo, prólogo, epílogo (\"[1] # Capítulo 1\");\n" +
    "  ## = título logo abaixo dele: nome do capítulo ou de quem narra (\"[2] ## Jace\");\n" +
    "  ### = subtítulo: lugar, data, tempo (\"[3] ### Dois anos antes\");\n" +
    "  #### = divisão menor dentro do capítulo.\n" +
    "  Texto comum, fala e epígrafe nunca levam #.";
}


/** Confere se a skill e o Doc de exemplos chegaram. Devolve o problema, ou "" se estiver tudo certo. */
function conferirInstrucoes(instrucoes, pedido) {
  const tudo = String(instrucoes || "") + "\n" + String(pedido || "");

  if (String(instrucoes || "").length < TAMANHO_MINIMO_SKILL) {
    return "A skill chegou incompleta à IA (" + String(instrucoes || "").length + " caracteres). Confira o Doc de regras no Config.";
  }

  const faltando = MARCAS_OBRIGATORIAS.filter(m => !tudo.toUpperCase().includes(m.marca.toUpperCase()));
  if (faltando.length) {
    return "Não chegou à IA: " + faltando.map(m => m.nome).join(", ") + ". Confira o ID_EXEMPLOS no Config.gs.";
  }

  return "";
}


module.exports = { autocorrigir, checarRegras, lembreteFinal, conferirInstrucoes, textoEN, ajustarTitulos };
