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


/* Calcos do inglês já encontrados na revisão: [padrão, forma natural].
 * Para acrescentar: copie uma linha e troque o padrão e a sugestão. */
const CALCOS = [
  ["bat\\p{L}* cinco|(?:para|receber|ganhar) um cinco", "high five → \"bater na mão\", \"toca aqui\""],
  ["descans\\p{L}* sobre os louros", "rest on one's laurels → \"dormir sobre os louros\""],
  ["mais vezes do que não", "more often than not → \"na maioria das vezes\""],
  ["(?:não|nem) (?:é|foi|era) como se", "it's not like → \"não é que\", \"nem foi um jogo importante\""],
  ["faz (?:\\p{L}+ )?(?:horas|dias|semanas|meses|anos|tempo) desde que", "it's been weeks since → \"faz semanas que não…\""],
  ["(?:eu )?(?:já )?mencionei (?:que )?\\p{L}+\\?", "did I mention…? → \"Já falei que ele é…?\""],
  ["fisicalidade", "physicality → \"o contato físico\", \"o corpo a corpo\""],
  ["terapia de conversa", "talk therapy → \"terapia\""],
  ["afeto parental", "parental affection → \"carinho de pai e mãe\""],
  ["do norte do estado", "upstate New York → \"do interior de Nova York\""],
  ["fazer (?:um )?nome para (?:nós|mim|si)(?: mesm\\p{L}+)?", "make a name for ourselves → \"fazer nome\""],
  ["mão que (?:me|lhe|nos|te) foi dada", "the hand I've been dealt → \"as cartas que a vida me deu\""],
  ["riso pelo nariz", "snort out a laugh → \"solta uma risada abafada\", \"bufa uma risada\""],
  ["volta da vitória", "victory lap of high fives → \"rodada de comemoração\""],
  ["(?:falo|fala|digo|diz|disse) sem expressão", "deadpan → \"digo, impassível\", \"sem mudar a cara\""],
  ["passos? (?:visíveis )?para longe", "take steps away → \"se afastam\", \"recuam\""],
  ["traseiro lento", "hurry his slow ass up → \"mexer essa bunda\", \"andar logo\""],
  ["(?:olhar|olhos) (?:de \\p{L}+ )?sobre mim", "eyes on me → \"Penny olhando para mim\""],
  ["ofensa cortante", "cutting insult → \"alfinetada\", \"insulto afiado\""],
  ["c[êe]ntimos?", "nickel/dime/cents → \"centavos\" (\"cêntimo\" é de Portugal); apelido próprio fica como no original"],
  ["reengast\\p{L}*", "reset (joia, pedra) → \"montar a pedra num engaste novo\", \"trocar o engaste\" (\"reengastar\" não existe)"],
  ["retrein\\p{L}*|sobrepens\\p{L}*|sobreanalis\\p{L}*", "prefixo do inglês colado no verbo (re-, over-) → \"treinar de novo\", \"pensar demais\", \"analisar demais\""],
  ["(?:umas|as|algumas|duas) milhares", "a few thousand times → \"milhares de vezes\" (milhar é masculino: \"uns milhares\")"]
];
const RE_CALCOS = CALCOS.map(([p, s]) => [palavra(p), s]);


/* Expressões do ORIGINAL que costumam virar calco: [padrão no inglês, orientação].
 * O código procura no inglês ANTES de traduzir e manda a orientação só quando a
 * expressão aparece no trecho (não aumenta o pedido dos trechos que não têm). */
const EXPRESSOES_EN = [
  [/\bhigh[- ]?fives?\b/i, "high five → \"bater na mão\", \"toca aqui\" (nunca \"bater cinco\" nem \"um cinco\")"],
  [/\blaurels\b/i, "rest on one's laurels → \"dormir sobre os louros\""],
  [/\bmore often than not\b/i, "more often than not → \"na maioria das vezes\""],
  [/\bit['’]?s not like\b/i, "it's not like → negação direta (\"Não ganhamos…\", \"Não é que…\"), nunca \"Não é como se\""],
  [/\b(?:it['’]?s|it has|it had) been (?:\w+ )?(?:seconds|minutes|hours|days|weeks|months|years|ages|forever|a while|so long|too long|long) since\b/i, "it's been X since → \"Faz X que (não)…\", nunca \"desde que\""],
  [/\bdid i mention\b/i, "did I mention X? → \"Já falei que…?\""],
  [/\bphysicality\b/i, "physicality → \"o contato físico\", \"o corpo a corpo\" (\"fisicalidade\" não existe)"],
  [/\btalk therapy\b/i, "talk therapy → \"terapia\""],
  [/\bparental (?:affection|love)\b/i, "parental affection → \"carinho de pai e mãe\""],
  [/\bupstate\b/i, "upstate New York → \"interior de Nova York\""],
  [/\bmake (?:a|their|our|his|her|my) name for\b/i, "make a name for oneself → \"fazer nome\""],
  [/\bhand (?:i|he|she|we|they|you)(?:['’]ve| have| has| was| were)? (?:been )?dealt\b/i, "the hand I've been dealt → \"as cartas que a vida me deu\""],
  [/\bsnort(?:s|ed|ing)?\b[^.?!]{0,15}\blaugh/i, "snort a laugh → \"solta uma risada abafada\", \"bufa uma risada\""],
  [/\bdeadpan/i, "deadpan → \"impassível\", \"sem mudar a cara\""],
  [/\bsteps? away\b/i, "take steps away → \"se afastar\", \"recuar\""],
  [/\bass up\b/i, "hurry your ass up → \"mexer essa bunda\", \"andar logo\""],
  [/\beyes on (?:me|him|her)\b/i, "eyes on me → \"olhando para mim\", nunca \"olhar sobre mim\""],
  [/\bcutting (?:insult|remark|comment)/i, "cutting insult → \"alfinetada\", \"insulto afiado\""],
  [/\bvictory lap\b/i, "victory lap → \"rodada de comemoração\""],
  [/\baccident[- ]prone\b/i, "accident-prone → \"desastrado\""],
  [/\berrant thought\b/i, "errant thought → reestruture (\"Só de pensar nisso…\")"],
  [/\b(?:nickel|dime|cents?)\b/i, "moedas → \"centavos\" (nunca \"cêntimo\"); apelido com moeda fica como no original"],
  [/\bfantas(?:y|ies)\b/i, "fantasy → \"fantasia\" (não é fantasma)"],
  [/\bstrain\b/i, "strain no corpo de atleta → \"distensão\" (lesão), não \"esforço\""],
  [/\bshot on\b/i, "made a shot on [goleiro] → \"marcou um gol em\""],
  [/\bhighlight reel\b/i, "highlight reel → \"os melhores momentos\""],
  [/\bthousands?\b/i, "thousand(s) → \"milhares\" é masculino (\"uns milhares\", nunca \"umas milhares\")"],
  [/\bsick to (?:my|his|her|your) stomach\b/i, "sick to my stomach → \"o estômago embrulha\""],
  [/\bheart sank\b|\bbutterflies\b/i, "heart sank / butterflies → \"aperto no peito\" / \"frio na barriga\""],
  [/\b\w+ fucking \w+/i, "fucking no meio da frase → palavrão como interjeição entre vírgulas, no início ou no fim (\"Eu não ligo, porra.\")"],
  [/(?:^|[“"\s])hell[,!]/i, "Hell, … → \"Inferno\" ou \"Porra\" (nunca \"Caramba\": não suavizar)"],
  [/\bre-?set(?:s|ting)?\b/i, "reset: em joia/pedra → \"montar a pedra num engaste novo\", \"trocar o engaste\"; em aparelho → \"reiniciar\" (nunca \"reengastar\")"],
  [/\bre-?(?:train|do|think|read|write|watch|start|open|build|make|set|mount|polish)(?:s|ed|ing)?\b|\bover(?:think|analy[sz]e|react|share)\w*/i, "verbo com re-/over- → verbo português + \"de novo\" ou \"demais\"; nunca invente palavra com prefixo (\"reengastar\", \"retreinar\", \"sobrepensar\")"],
  [/\bfuck\.? my\.? life\b/i, "Fuck. My. Life. → \"Que. Merda. De. Vida.\" (mantém o palavrão e as pausas)"]
];

/** Orientações das expressões que aparecem neste trecho do original, com o número do parágrafo. */
function dicasDoTrecho(en) {
  const achadas = new Map();
  (en || []).forEach((_, i) => {
    const t = textoEN(en, i + 1);
    EXPRESSOES_EN.forEach(([re, dica]) => {
      if (re.test(t)) achadas.set(dica, (achadas.get(dica) || []).concat(i + 1));
    });
  });
  if (!achadas.size) return "";
  return "\n\n=== EXPRESSÕES DESTE TRECHO QUE COSTUMAM VIRAR CALCO ===\n" +
    [...achadas].map(([dica, nums]) => "- [" + nums.join("], [") + "] " + dica).join("\n");
}


/* Regras checadas em cada parágrafo traduzido. */
const REGRAS = [
  { nome: "calco do inglês", soCorrecao: true, // não vai no lembrete de todo pedido (custo)
    teste: pt => RE_CALCOS.some(([re]) => re.test(pt)),
    instrucao: pt => "Sem calco de expressão inglesa: escreva como um autor brasileiro escreveria. " +
      RE_CALCOS.filter(([re]) => re.test(pt)).map(([, s]) => s).join("; ") + "." },

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
    // Rede de segurança: nenhum "#" de markdown chega ao Doc como texto.
    if (/^[*_\s]*#{1,6}/.test(b.texto)) {
      const nivelIA = b.texto.replace(/^[*_\s]*/, "").match(/^#+/)[0].length;
      b = { ...b, nivel: b.nivel || Math.min(nivelIA, 4),
        texto: b.texto.replace(/^[*_\s]*#{1,6}\s*/, "").replace(/^[*_]+|[*_]+$/g, "").trim() };
    }

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
      violacoes.push({ num, regras: quebradas.map(r => r.nome),
        instrucoes: quebradas.map(r => typeof r.instrucao === "function" ? r.instrucao(pt) : r.instrucao) });
    }
  });

  return violacoes;
}


/** Lembrete curto que vai no FIM de todo pedido (a IA dá mais peso ao que lê por último). */
function lembreteFinal() {
  return "\n\n=== ANTES DE RESPONDER, CONFIRA (regras SB, sem exceção) ===\n" +
    "- Siga a skill inteira e o Doc de exemplos SB do começo ao fim do trecho, não só no início.\n" +
    "- Traduza TODOS os parágrafos, na ordem, sem resumir, cortar ou juntar.\n" +
    REGRAS.filter(r => !r.soCorrecao).map(r => "- " + r.instrucao).join("\n") + "\n" +
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


module.exports = { dicasDoTrecho, autocorrigir, checarRegras, lembreteFinal, conferirInstrucoes, textoEN, ajustarTitulos };
