/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Simple lightweight client-side language detector using stopword patterns
export function detectLanguage(text: string): { lang: string; code: string; confidence: number } | null {
  if (!text || text.trim().length < 4) return null;

  const cleanText = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ");

  // Stopword lists for language detection
  const languages = [
    {
      name: "Spanish",
      code: "es",
      keywords: [
        "hola", "como", "estas", "gracias", "por", "favor", "amigo", "casa", "pero", "para", "con", "del", "los", 
        "las", "una", "este", "esta", "usted", "bueno", "bien", "tiempo", "hablar", "hacer", "quiero", "tengo", 
        "mañana", "noche", "todos", "todo", "bien", "donde", "quien", "porque", "cuando", "hijo", "hija", "madre", 
        "padre", "hermano", "hermana", "trabajo", "dinero", "mañana", "tarde", "hoy", "ayer", "siempre", "nunca",
        "verdad", "claro", "entonces", "despues"
      ]
    },
    {
      name: "French",
      code: "fr",
      keywords: [
        "bonjour", "comment", "merci", "s'il", "vous", "plait", "ami", "maison", "mais", "pour", "avec", "les", 
        "une", "cette", "bien", "temps", "faire", "veux", "demain", "nuit", "tout", "tous", "dans", "avec", "sous", 
        "sur", "gauche", "droite", "ici", "la", "pourquoi", "quand", "qui", "quoi", "pere", "mere", "frere", "soeur",
        "travail", "argent", "aujourd'hui", "hier", "toujours", "jamais"
      ]
    },
    {
      name: "German",
      code: "de",
      keywords: [
        "hallo", "wie", "danke", "bitte", "freund", "haus", "aber", "fuer", "mit", "des", "die", "ein", "eine", 
        "dies", "diese", "sie", "gut", "zeit", "machen", "will", "habe", "morgen", "nacht", "alles", "alle", "und", 
        "oder", "nicht", "nein", "ja", "vater", "mutter", "bruder", "schwester", "arbeit", "geld", "heute", "gestern", 
        "immer", "nie", "warum", "wann", "wer", "was"
      ]
    },
    {
      name: "Italian",
      code: "it",
      keywords: [
        "ciao", "come", "grazie", "per", "favore", "amico", "casa", "ma", "con", "del", "una", "questo", "questa", 
        "voi", "bene", "tempo", "fare", "voglio", "domani", "notte", "tutti", "tutto", "dentro", "fuori", "padre", 
        "madre", "fratello", "sorella", "lavoro", "soldi", "oggi", "ieri", "sempre", "mai", "perche", "quando", 
        "chi", "cosa", "buongiorno"
      ]
    },
    {
      name: "Portuguese",
      code: "pt",
      keywords: [
        "ola", "como", "esta", "obrigado", "por", "favor", "amigo", "casa", "mas", "para", "com", "dos", "das", 
        "uma", "este", "esta", "voce", "bem", "tempo", "fazer", "quero", "tenho", "amanha", "noite", "tudo", "todos", 
        "onde", "quem", "porque", "quando", "pai", "mae", "irmao", "irma", "trabalho", "dinheiro", "hoje", "ontem", 
        "sempre", "nunca", "verdade", "claro", "depois"
      ]
    }
  ];

  // Tokenize text
  const tokens = cleanText.split(/\s+/).filter(t => t.length > 1);
  if (tokens.length === 0) return null;

  let bestMatch: typeof languages[0] | null = null;
  let maxScore = 0;

  languages.forEach(lang => {
    let score = 0;
    tokens.forEach(token => {
      if (lang.keywords.includes(token)) {
        score++;
      }
    });
    if (score > maxScore) {
      maxScore = score;
      bestMatch = lang;
    }
  });

  // Calculate score confidence relative to length
  if (bestMatch && maxScore >= 1) {
    const confidence = maxScore / Math.min(tokens.length, 12);
    // Threshold to prevent false positives in mostly English/numerical texts
    if (confidence > 0.12 || maxScore >= 2) {
      return {
        lang: (bestMatch as any).name,
        code: (bestMatch as any).code,
        confidence: Math.min(1, confidence)
      };
    }
  }

  return null;
}

// Ollama API request functions
export async function testOllamaConnection(ollamaUrl: string): Promise<{ success: boolean; models?: string[]; error?: string }> {
  const url = ollamaUrl.endsWith('/') ? ollamaUrl.slice(0, -1) : ollamaUrl;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 sec timeout

    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const models = data.models ? data.models.map((m: any) => m.name) : [];
      return { success: true, models };
    } else {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection refused or timeout' };
  }
}

export async function translateWithOllama(
  text: string,
  ollamaUrl: string,
  modelName: string,
  sourceLangCode: string = 'Spanish'
): Promise<string> {
  const url = ollamaUrl.endsWith('/') ? ollamaUrl.slice(0, -1) : ollamaUrl;
  
  const prompt = `Translate the following text from ${sourceLangCode} to English. Respond with ONLY the direct English translation, with absolutely no introduction, preamble, explanations, surrounding quotes, or headers. Preserve the original meaning and tone, and return ONLY the translated string:

Text:
"${text}"`;

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 250
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    let translated = data.response ? data.response.trim() : '';
    
    // Clean outer quotes if any returned by LLM
    if (translated.startsWith('"') && translated.endsWith('"')) {
      translated = translated.slice(1, -1);
    } else if (translated.startsWith("'") && translated.endsWith("'")) {
      translated = translated.slice(1, -1);
    }
    
    return translated || text;
  } catch (err: any) {
    console.error('Ollama translation error:', err);
    throw err;
  }
}

export async function generateBriefWithOllama(
  exhibits: Array<{ id: string; timestamp: string; sender: string; recipient?: string; content: string; notes?: string; category: string }>,
  ollamaUrl: string,
  modelName: string,
  metadata: { caseId?: string; investigatorName?: string; suspectName?: string } = {}
): Promise<string> {
  const url = ollamaUrl.endsWith('/') ? ollamaUrl.slice(0, -1) : ollamaUrl;
  
  const exhibitsContext = exhibits.map((ex, idx) => {
    return `Exhibit #${idx + 1} (${ex.category}):
- Timestamp: ${ex.timestamp}
- Parties: ${ex.sender} ${ex.recipient ? `➜ ${ex.recipient}` : ''}
- Text Content: "${ex.content}"
- Investigator Annotations: "${ex.notes || 'None'}"`;
  }).join('\n\n');

  const prompt = `You are an expert digital forensic investigator and criminal intelligence analyst. Draft an elegant, professional, and detailed "Law Enforcement Case Briefing & Investigation Summary" based on the following selected evidence exhibits.

CASE CONTEXT DETAILS:
- Case ID: ${metadata.caseId || 'Unspecified Case'}
- Lead Examiner: ${metadata.investigatorName || 'Analyst'}
- Target Subject/Entity: ${metadata.suspectName || 'Target Subject'}

SELECTED EVIDENCE EXHIBITS:
${exhibitsContext || 'No exhibits selected.'}

Write an exhaustive intelligence brief with the following distinct sections:
1. EXECUTIVE SUMMARY: A highly polished high-level summary of the target's actions, timelines, and main investigative highlights.
2. TIMELINE ANALYSIS: Point out key moments, communication patterns, or pivotal events in the timeline.
3. POTENTIAL LEADS & DISCREPANCIES: Areas of interest, key people mentioned, or clear indicators/suspicious activity.
4. RECOMMENDED NEXT STEPS: Solid tactical suggestions for further warrants, physical surveillance, or subpoenas.

Formatting instructions: Use clean Markdown with headers, bold text, and bullet points. Do not mention that you are an AI. Make it sound like a top-tier forensic dossier ready for a prosecuting attorney or senior investigator.`;

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.4,
          num_predict: 1500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.response ? data.response.trim() : '';
  } catch (err: any) {
    console.error('Ollama briefing error:', err);
    throw err;
  }
}
