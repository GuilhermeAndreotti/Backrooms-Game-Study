/**
 * Procedural Lore Generator for the Backrooms.
 * Generates highly immersive, lore-heavy logs and warnings.
 */

const LOG_TYPES = [
  "RELATÓRIO DE RECONHECIMENTO",
  "DIÁRIO DE SOBREVIVÊNCIA",
  "ANOTAÇÃO APRESSADA",
  "AVISO DE PERIGO",
  "ARQUIVO DO M.E.G. (Grupo de Exploração Principal)",
  "REGISTRO CIENTÍFICO"
];

const AUTHORS = [
  "Explorador #1024",
  "Agente Carter (M.E.G. Scout)",
  "Um Alpinista Perdido",
  "Dra. Helena Vance",
  "Infiltrado #09",
  "O Cartógrafo do Nível 0",
  "Sobrevivente sem Nome",
  "Vítima do No-clip"
];

const SECTORS_OR_LEVELS = [
  "Nível 0 - As Zonas Amarelas",
  "Nível 1 - O Armazém Habitável",
  "Nível 2 - Encanamento de Vapor",
  "A Zona de Silêncio Red",
  "Os Limites do Abismo"
];

const INTROS = [
  "Se você está lendo isso, significa que a gravidade falhou para você exatamente onde falhou para mim. Não entre em pânico, o pânico é o primeiro sinal da transição.",
  "Escrevo isso às pressas sob o zumbido insuportável dessas lâmpadas fluorescentes. Elas parecem sugar a energia diretamente dos meus ossos.",
  "Encontrei uma fenda nas placas de gesso que não deveria estar ali. Ela emite um odor de carpete úmido e mofo antigo, mas o fluxo de ar é frio.",
  "Eles estão errados. O M.E.G. diz que o Nível 0 é seguro se você ignorar o barulho, mas eu juro que ouvi passos que não eram os meus no teto.",
  "Este lugar não tem fim. As paredes mudam de lugar quando você não está olhando. Eu marquei uma parede com giz vermelho; dez minutos depois, a marca tinha sumido."
];

const DETAILED_OBSERVATIONS = [
  "O carpete... por que ele está sempre úmido? Não há canos no teto, apenas fiação elétrica desencapada de alta voltagem. Eu analisei o líquido: é água sanitária misturada com algo orgânico, como suor antigo. Não toque com feridas abertas.",
  "O zumbido está na frequência de 110 hertz. Se você ouvir com atenção, há um padrão cíclico. Quase como se estivesse transmitindo dados estruturados ou coordenadas. Se a frequência mudar de tom repentinamente, esconda-se imediatamente.",
  "A Água de Amêndoas (Almond Water) flui por algumas tubulações enferrujadas. Ela tem um gosto levemente doce, como baunilha com amêndoas. Beba para clarear a mente, pois as paredes começam a sussurrar quando o seu cérebro tenta preencher o silêncio.",
  "Cuidado com os Smilers. Eles habitam as zonas totalmente escuras do Nível 1 e 2. Aqueles olhos brilhantes e dentes reluzentes não são amigáveis. Eles se alimentam do seu medo. Mantenha contato visual estável e recue lentamente. Nunca corra.",
  "Existe um fenômeno que chamamos de 'No-clipping'. Se você colidir com força contra uma parede que parece ter uma textura ligeiramente desalinhada ou que vibra sob luz direta, você atravessará para o Nível 1. É um salto de fé cego.",
  "Os Hounds são quadrúpedes perigosos formados por cabelos humanos e garras afiadas. Eles atacam se você parecer fraco ou se der as costas a eles. Se encontrar um, olhe-o diretamente nos olhos e rosne. Mostre que você é um predador também."
];

const WARNINGS_OR_INSIGHTS = [
  "AVISO CRÍTICO: Não confie no silêncio. No Nível 0, o silêncio absoluto significa que você entrou na área de influência de um 'Smiler' ou pior, a fiação local falhou e a escuridão total é iminente.",
  "INSIGHT MENTAL: Sua sanidade é a única barreira física entre o seu corpo e este lugar. Quando sua mente enfraquece, a arquitetura ao seu redor se deforma, e os monstros deixam de ser apenas alucinações auditivas.",
  "DICA DE SOBREVIVÊNCIA: Se a água no chão começar a borbulhar, mude de direção. Isso indica um superaquecimento das caldeiras do nível inferior, e o vapor pode derreter suas botas em segundos.",
  "REGISTRO DE ANOMALIA: A sala vermelha (Red Room) é um ralo de consciência. Qualquer explorador que passe mais de 5 minutos nela perde a habilidade de reconhecer rostos, esquecendo sua própria identidade em poucas horas.",
  "SEGREDO DOS NÍVEIS: Há rumores de uma 'Fita Cassete' que contém o som original de gravação deste universo. Quem a ouviu afirma que ela desativa temporariamente o comportamento hostil das entidades."
];

const OUTROS = [
  "Continue andando. Não pare para dormir a menos que esteja em um cubículo totalmente fechado e trancado. Que a sorte esteja com você.",
  "Se você ouvir sussurros vindo do carpete, ignore-os. São apenas ecos do seu próprio passado distorcidos pela acústica deste inferno amarelo.",
  "Ainda tenho uma garrafa de Água de Amêndoas. Vou guardá-la para o caso de começar a ver rostos nas lâmpadas de novo. Fique firme, explorador.",
  "Se encontrar o meu corpo, por favor, leve esta anotação com você. Minha família precisa saber que eu não sumi voluntariamente. Eu caí pela realidade.",
  "Lembre-se: o Nível 0 não é o fim. Há portões ocultos no Nível 1 que levam de volta a algo que se parece com o nosso mundo. Continue procurando."
];

export interface BackroomsLore {
  title: string;
  author: string;
  date: string;
  location: string;
  content: string;
}

export function generateProceduralLore(seed: number): BackroomsLore {
  // Simple seed-based random to ensure determinism or variety based on seed
  const rand = (s: number) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  let s = seed;
  const nextRand = () => {
    s += 45.729;
    return rand(s);
  };

  const getElement = <T>(arr: T[]): T => {
    const idx = Math.floor(nextRand() * arr.length);
    return arr[idx];
  };

  const type = getElement(LOG_TYPES);
  const author = getElement(AUTHORS);
  const location = getElement(SECTORS_OR_LEVELS);
  
  // Create a realistic date
  const year = 1990 + Math.floor(nextRand() * 37); // between 1990 and 2027
  const month = 1 + Math.floor(nextRand() * 12);
  const day = 1 + Math.floor(nextRand() * 28);
  const hour = Math.floor(nextRand() * 24);
  const min = Math.floor(nextRand() * 60);
  const dateStr = `${day.toString().padStart(2, "0")}/${month.toString().padStart(2, "0")}/${year} ${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;

  const title = `${type} #${Math.floor(nextRand() * 9000 + 1000)}`;

  // Assemble content
  const intro = getElement(INTROS);
  const observation = getElement(DETAILED_OBSERVATIONS);
  const warning = getElement(WARNINGS_OR_INSIGHTS);
  const outro = getElement(OUTROS);

  const content = `${intro}\n\n${observation}\n\n${warning}\n\n${outro}`;

  return {
    title,
    author,
    date: dateStr,
    location,
    content
  };
}
