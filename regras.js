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
  [/\bOKAY\b/g, "OK"],
  [/(?<!\p{L})([Ff])udid(?=[oa]s?(?!\p{L}))/gu, "$1odid"]
];


/* Palavra inteira, aceitando acentos (o \b do JavaScript não entende "tá" ou "né"). */
const palavra = (lista, flags = "iu") => new RegExp("(?<!\\p{L})(" + lista + ")(?!\\p{L})", flags);


/* O parágrafo em inglês tem fala (e não só aspas de ênfase)? */
const temFala = en => /^\s*\*{0,3}["“]/.test(en) || /[,?!…]\*{0,3}["”]/.test(en);

/** Quantas vezes o parágrafo alterna entre fala (F) e narração (N). */
function trechosEN(en) {
  const seq = [];
  let dentro = false, atual = "";
  const fecha = () => {
    if (/\p{L}/u.test(atual)) { const t = dentro ? "F" : "N"; if (seq[seq.length - 1] !== t) seq.push(t); }
    atual = "";
  };
  for (const c of String(en)) {
    if (c === "“" || (c === '"' && !dentro)) { fecha(); dentro = true; }
    else if (c === "”" || (c === '"' && dentro)) { fecha(); dentro = false; }
    else atual += c;
  }
  fecha();
  return seq.length;
}

function trechosPT(pt) {
  const seq = [];
  const pos = t => { if (seq[seq.length - 1] !== t) seq.push(t); };
  String(pt).split("\n").forEach(linha => {
    const l = linha.trim().replace(/^\*+/, "");
    if (!/\p{L}/u.test(l)) return;
    if (!/^—/.test(l)) return pos("N");
    l.replace(/^—\s*/, "").split(/\s—\s/).forEach((parte, i) => {
      if (/\p{L}/u.test(parte)) pos(i % 2 === 0 ? "F" : "N");
    });
  });
  return seq.length;
}


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
  ["(?:umas|as|algumas|duas) milhares", "a few thousand times → \"milhares de vezes\" (milhar é masculino: \"uns milhares\")"],
  ["revirt\\p{L}*", "revirar se conjuga como virar → \"reviro\", \"revira\", \"revirou\" (\"revirto\" não existe)"],
  ["(?:respiração|fôlego) que (?:eu |ele |ela )?(?:nem )?(?:sabia|sabiam|percebi|percebeu)", "breath I didn't know I was holding → \"solto o ar que nem percebi que estava prendendo\""],
  ["pul\\p{L}* uma batida", "skip a beat → \"disparar\" ou \"falhar\" (\"meu coração disparou\")"],
  // Achados na análise de Untamed (MJ Hendrix)
  ["cabeça de cabelo", "a head of hair → \"o cabelo\", \"os cabelos pretos\" (\"procuro alguém de cabelo preto\")"],
  ["sorriso (?:\\p{L}+ )?se espalh\\p{L}*", "a smile spreads across her face → \"ela abre um sorriso\""],
  ["se instal\\p{L}* (?:no|em) (?:meu|seu|nosso)? ?(?:estômago|peito)", "a feeling settles in my stomach → \"sinto um aperto no estômago\", \"o estômago embrulha\""],
  ["não acho que (?:eu )?consig\\p{L}*", "I don't think I'll make it → \"acho que não consigo\", \"duvido que eu consiga\""],
  ["(?:leva|levou|levar) \\p{L}+ (?:\\p{L}+ )?para outro (?:patamar|nível)", "take X to the next level → reestruture com sentido (\"o prefeito leva a sério demais esse posto de dono da cidade\")"],
  ["de volta no", "be back at → \"de volta ao\", \"de volta à\""],
  ["(?:os|meus|seus) músculos (?:tensos )?se relax\\p{L}*", "my muscles relax → \"relaxo\", \"meu corpo relaxa\""],
  ["se dois de vocês", "if two of you → \"se vocês dois\""]
];
const RE_CALCOS = CALCOS.map(([p, s]) => [palavra(p), s]);


/* Expressões do ORIGINAL que costumam virar calco: [padrão no inglês, orientação].
 * O código procura no inglês ANTES de traduzir e manda a orientação só quando a
 * expressão aparece no trecho (não aumenta o pedido dos trechos que não têm). */
const EXPRESSOES_EN = [
  [/^\s*(?:#+\s*)?(?:then|now)\s*(?:\.{3}|…|:)?\s*$/i, "\"Then…\" / \"Now…\" sozinhos na linha marcam o TEMPO da cena (passado/flashback x presente): Then → \"Antes…\" (ou \"Naquela época…\"); Now → \"Agora…\". Nunca \"Então…\". Use a mesma forma em todo o livro"],
  [/\b[Ee]arth to \p{Lu}/u, "Earth to X → \"Terra chamando X\" ou \"Alô, X?\" (nunca \"Terra para X\")"],
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
  [/\broll(?:s|ed|ing)? (?:my|his|her|their|your|our) eyes\b/i, "roll my eyes → \"reviro os olhos\" (revirar: reviro, revira, revirou; \"revirto\" não existe)"],
  [/\b(?:hold|held|grab|get|got|open|pull)\w*\b[^.?!]{0,20}\b(?:her|his|my|your|their) (?:car |front |passenger )?(?:door|chair|seat)\b/i, "gesto de cortesia (hold/get her door, pull out her chair) → \"seguro a porta do carro para ela\", \"puxo a cadeira para ela\", nunca \"a porta dela\""],
  [/\bbreath (?:i|he|she|we|they|you) (?:didn['’]?t|did not) (?:know|realize)/i, "breath I didn't know I was holding → \"solto o ar que nem percebi que estava prendendo\" (nunca \"uma respiração\")"],
  [/\bskip(?:s|ped|ping)? a beat\b/i, "skip a beat → \"disparar\" ou \"falhar\""],
  [/\b(?:smile|grin) (?:tugs?|pulls?|tugged|pulled)\b/i, "a smile tugs at my lips → \"abro um meio sorriso\", \"um sorriso me escapa\""],
  [/\bfuck\.? my\.? life\b/i, "Fuck. My. Life. → \"Que. Merda. De. Vida.\" (mantém o palavrão e as pausas)"],
  [/\bhead of (?:\w+ )?hair\b/i, "a head of (dark) hair → \"o cabelo (escuro)\", nunca \"cabeça de cabelo\""],
  [/\b(?:smile|grin) spreads?\b/i, "a smile spreads across her face → \"ela abre um sorriso\", nunca \"o sorriso se espalha\""],
  [/\bto (?:a whole )?(?:new|the next|another) level\b/i, "take X to the next level → reestruture com o sentido real, nunca \"para outro patamar\""],
  [/\bi don['’]?t think i(?:['’]ll| will| can)\b/i, "I don't think I'll… → \"acho que não vou…\", \"duvido que…\" (nunca \"Não acho que\")"]
];


/* Camada Fantasia: vai junto das instruções quando a coluna "Estilo" da fila diz "fantasia".
 * Base: seção 11 da skill tradutor-en-pt-br. */
const CAMADA_FANTASIA = `

=== CAMADA FANTASIA E PARANORMAL (este livro é de fantasia: aplique em todo o trecho) ===
1. Termos sem tradução literal (raças, clãs, ordens, criaturas, feitiços, títulos, poderes, objetos mágicos): adapte de forma criativa e fluida, preservando sentido e tom, para que façam sentido à leitora brasileira e mantenham a imersão. Nome próprio de clã, raça, grupo, reino ou título criado pela autora mantém a identidade (não traduza nome próprio inventado).
2. "sift", "glamoured", "apparate" e verbos mágicos parecidos: use o termo que dá o melhor sentido na frase, mantendo o tom fantástico. Exemplos: sift → "deslizar", "filtrar-se"; glamoured → "encantado", "disfarçado por magia"; apparate → "teletransportar-se", "materializar-se".
3. Consistência é crítica: confira o glossário da obra antes de traduzir qualquer termo do universo. Se o termo já está lá, use exatamente a mesma solução. Se é novo, decida uma vez e registre em [G] (SEÇÃO | termo em inglês | tradução escolhida | nº do parágrafo | observação). Nunca alterne entre duas traduções do mesmo termo.
4. Registro: fantasia pede vocabulário um pouco mais elevado e imagético na narração (sem ficar empolado), e falas de nobres, criaturas antigas ou seres mágicos podem soar mais formais se o original soa assim. Personagem jovem ou moderno continua falando natural.
5. Títulos e tratamentos de corte: Lord/Lady → "lorde"/"lady"; Your Majesty → "Vossa Majestade"; Your Highness → "Vossa Alteza"; High Lord, High King e títulos inventados → adapte e mantenha fixo no glossário.
6. Criaturas com nome consagrado em português usam a forma consagrada: fae → "feérico(a)" ou "fae" (escolha uma e fixe), shifter → "metamorfo", werewolf → "lobisomem", witch → "bruxa", warlock → "bruxo", mate → "parceiro(a)" ou "companheiro(a)" (fixe), bond → "vínculo", wards → "proteções", glamour → "ilusão" ou "encanto".
7. Se um termo for realmente ambíguo e a escolha mudar a obra, registre em [G] com a observação, sem interromper o texto.
`;

/** Instruções completas para o estilo do livro (romance é o padrão; "fantasia" soma a camada). */
function instrucoesDoEstilo(instrucoes, estilo) {
  return /fantas|paranormal/i.test(String(estilo || "")) ? instrucoes + CAMADA_FANTASIA : instrucoes;
}


/* Refino editorial: segunda leitura de toda tradução, com o inglês ao lado.
 * Lista curta e certeira: são os erros que mais aparecem nas revisões da SB. */
const REFINO = `=== REFINO EDITORIAL ===
Você é a revisora final de uma editora brasileira exigente. Abaixo estão o original e a tradução de cada parágrafo. Releia cada par e corrija o que soar traduzido. Confira, parágrafo por parágrafo:
1. Sentido: nada mudou, faltou ou sobrou em relação ao inglês.
2. Tempo verbal: o mesmo do original. Ação em curso no presente contínuo ("She's paying") → "está pagando". Diálogo que retoma o verbo da fala anterior precisa casar com ela.
3. Calco: frase que segue a ordem e as palavras do inglês. Reescreva como uma autora brasileira escreveria ("a head of dark hair" → "o cabelo escuro"; "a smile spreads across his face" → "ele abre um sorriso"; "I don't think I'll make it" → "acho que não vou conseguir").
4. Expressões idiomáticas: equivalente natural em português, nunca a tradução palavra por palavra.
5. Possessivos e pronomes sobrando: corte "dele", "dela", "seu", "sua", "meu", "minha" e pronome sujeito quando o contexto já deixa claro ("Ele passa a mão no cabelo", não "Ele passa a mão dele no cabelo dele").
6. Palavrão, xingamento e cena explícita com o mesmo peso do original: nada suavizado nem cortado ("dodged that fucking bullet" → "escapou dessa, porra").
7. Ortografia e concordância (gênero de quem narra e de com quem se fala; "fodido", nunca "fudido").
8. Fala: a fala de um mesmo personagem num parágrafo nunca se divide em dois travessões seguidos; depois da narração, ela continua no mesmo bloco ("— Obrigado — murmuro. — Amo você.").
9. Fluidez: a frase lida em voz alta soa natural, sem repetição de palavra próxima (ex.: "cadeia" para prisão e "cadeia alimentar" na mesma frase).
Mantenha o que já está bom: só reescreva o parágrafo que tiver problema, sem acrescentar conteúdo nem mudar o estilo da autora.
Devolva SOMENTE os parágrafos que mudou, completos, no formato [número] texto. Mesma formatação (travessão, itálico com *, títulos com #). Se nenhum precisar de mudança, responda apenas: NENHUM.`;

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

  // Imagem no meio do texto do original (emoji, ícone): o Apps Script manda como [IMG1], [IMG2]…
  { nome: "imagem perdida", teste: (pt, en) => {
      const marcas = t => (String(t).match(/\[IMG\d+\]/g) || []).sort().join(" ");
      return marcas(en) !== marcas(pt);
    },
    instrucao: "Marcadores [IMG1], [IMG2]… são imagens do livro (emoji, ícone): copie cada um exatamente igual, no mesmo lugar da frase, sem traduzir, mover ou remover." },

  // Original alterna fala e narração mais vezes que a tradução: narração ficou colada na fala
  // ("— Obrigada, Gunner. Ela saiu correndo…") ou fala colada na narração ("Ele rosnou. — Case comigo.").
  { nome: "narração colada na fala", soCorrecao: true,
    teste: (pt, en) => temFala(en) && /—/.test(pt) && trechosPT(pt) < trechosEN(en),
    instrucao: "Toda troca entre fala e narração leva travessão: \"— Obrigada, Gunner. — Ela saiu correndo do banheiro.\" / \"— Fiquei furiosa — a voz dela falhou. — Quando voltou…\". Narração antes de uma fala fica numa linha e a fala começa outra linha com travessão." },

  // Fala de verdade no original: parágrafo que abre com aspas, ou aspas fechando depois de , ? ! …
  // (aspas de ênfase, título ou placa não contam).
  { nome: "fala sem travessão", teste: (pt, en) => temFala(en) && !/—/.test(pt),
    instrucao: "O original tem fala entre aspas: em português, fala vai com travessão no início da linha, nunca aspas nem discurso indireto (\"— Oi — ela diz.\"). Se o mesmo parágrafo tiver narração e fala, separe em blocos com o mesmo número: [7] Ela desligou. / [7] — Droga. " +
      "Mas a fala de UM personagem nunca se divide em dois travessões seguidos (parece que outra pessoa respondeu): continue no mesmo bloco depois da narração (\"— Wilder? — ela pergunta, sonolenta. — Você está bem?\")." }
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


/**
 * Fala do mesmo personagem quebrada em dois travessões seguidos, no mesmo §:
 * "— Wilder? — A voz dela vem do lado." + "— Você está bem?" vira um bloco só.
 * Se o bloco anterior termina na narração (nº ímpar de " — " internos), continua com " — ";
 * se termina dentro da fala, só tira o travessão do seguinte.
 */
function juntarFalaDividida(blocos) {
  const fala = t => /^\*{0,3}— /.test(t);
  return blocos.reduce((saida, b) => {
    const ant = saida[saida.length - 1];
    if (ant && ant.num === b.num && !ant.nivel && !b.nivel && fala(ant.texto) && fala(b.texto)) {
      const terminaNaNarracao = (ant.texto.match(/\s—\s/g) || []).length % 2 === 1;
      ant.texto += " " + (terminaNaNarracao ? b.texto : b.texto.replace(/^(\*{0,3})— /, "$1"));
      return saida;
    }
    saida.push({ ...b });
    return saida;
  }, []);
}


/** Aplica as autocorreções. Devolve os blocos corrigidos. */
function autocorrigir(blocos) {
  return juntarFalaDividida(blocos).map(b => {
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


module.exports = { REFINO, instrucoesDoEstilo, dicasDoTrecho, autocorrigir, checarRegras, lembreteFinal, conferirInstrucoes, textoEN, ajustarTitulos };
