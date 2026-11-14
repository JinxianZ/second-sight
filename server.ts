import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

type VisionMode = 'describe' | 'read' | 'find';
type Language = 'en' | 'fr';

interface VisionRequestBody {
  imageBase64?: string;
  mode?: VisionMode;
  targetObject?: string;
  lang?: Language;
}

function buildSystemInstruction(
  mode: VisionMode,
  lang: Language,
  targetObject?: string
): { systemInstruction: string; userPrompt: string } {
  const safeTarget = (targetObject || '').trim().slice(0, 80);

  if (mode === 'read') {
    if (lang === 'fr') {
      return {
        systemInstruction:
          "Lis tout le texte visible exactement tel qu'il est écrit, de haut en bas. Ne dis rien d'autre. S'il n'y a pas de texte, dis exactement : 'Aucun texte visible'.",
        userPrompt: "Lis tout le texte visible dans cette image.",
      };
    }
    return {
      systemInstruction:
        "Read all visible text exactly as written, top to bottom. Say nothing else. If there is no text, say 'No text visible'.",
      userPrompt: 'Read all visible text in this image.',
    };
  }

  if (mode === 'find') {
    const objectLabel = safeTarget || (lang === 'fr' ? 'objet' : 'object');
    if (lang === 'fr') {
      return {
        systemInstruction: `L'utilisateur cherche : ${objectLabel}. S'il est visible, indique sa position (à gauche, au centre ou à droite) et s'il est proche ou loin. S'il n'est pas visible, réponds exactement : 'Hors champ — tournez lentement.' Réponse en moins de 12 mots en français.`,
        userPrompt: `Cherche : ${objectLabel}.`,
      };
    }
    return {
      systemInstruction: `The user is looking for: ${objectLabel}. If it is visible, state its position (left, center, or right) and whether it is near or far. If it is not visible, reply exactly: 'Not in view — turn slowly.' Keep the answer under 12 words.`,
      userPrompt: `Find: ${objectLabel}.`,
    };
  }

  // Default: describe
  if (lang === 'fr') {
    return {
      systemInstruction:
        "Tu es les yeux d'une personne aveugle. Décris cette scène en moins de 25 mots en français. Dangers d'abord : escaliers, obstacles, véhicules, personnes sur le passage. Indique les directions : à gauche, au centre ou à droite. Aucun remplissage, ne dis jamais 'l'image montre'.",
      userPrompt: 'Décris cette scène pour moi maintenant.',
    };
  }

  return {
    systemInstruction:
      "You are the eyes of a blind person. Describe this scene in under 25 words. Hazards first: stairs, obstacles, vehicles, people in the path. Give directions as left, center, or right. No filler, no 'the image shows'.",
    userPrompt: 'Describe this scene for me right now.',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  let aiClient: GoogleGenAI | null = null;
  function getAiClient(): GoogleGenAI {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    if (!aiClient) {
      aiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          timeout: 30000,
          retryOptions: {
            attempts: 1,
          },
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return aiClient;
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/vision', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as VisionRequestBody;
      const imageBase64 = body.imageBase64;
      const mode: VisionMode =
        body.mode === 'read' || body.mode === 'find' ? body.mode : 'describe';
      const lang: Language = body.lang === 'fr' ? 'fr' : 'en';
      const targetObject = body.targetObject;

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Missing imageBase64 payload' });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      const { systemInstruction, userPrompt } = buildSystemInstruction(
        mode,
        lang,
        targetObject
      );

      const ai = getAiClient();
      const contents = {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: userPrompt,
          },
        ],
      };

      const callModel = async (
        model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
        thinkingLevel: ThinkingLevel
      ) => {
        return ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel },
          },
        });
      };

      let response;
      try {
        response = await callModel('gemini-4-hydrogen', ThinkingLevel.LOW);
      } catch (primaryErr: unknown) {
        const errMsg =
          primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        const statusCode =
          typeof (primaryErr as { status?: number })?.status === 'number'
            ? (primaryErr as { status: number }).status
            : 0;
        const isRateLimitErr =
          statusCode === 429 ||
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED');
        const isTransientErr =
          statusCode === 503 ||
          statusCode === 504 ||
          errMsg.includes('504') ||
          errMsg.includes('DEADLINE_EXCEEDED') ||
          errMsg.includes('aborted') ||
          errMsg.includes('timeout');

        if (isRateLimitErr) {
          response = await callModel('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL);
        } else if (isTransientErr) {
          response = await callModel('gemini-4-hydrogen', ThinkingLevel.LOW);
        } else {
          throw primaryErr;
        }
      }

      const text = (response.text || '').trim();
      if (!text) {
        res.status(502).json({ error: 'Empty response from vision model' });
        return;
      }

      res.json({ text });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Vision processing failed';
      const statusCode =
        typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 0;
      const isRateLimit =
        statusCode === 429 ||
        message.includes('429') ||
        message.includes('RESOURCE_EXHAUSTED');
      const isDeadlineExceeded =
        statusCode === 504 ||
        message.includes('504') ||
        message.includes('DEADLINE_EXCEEDED');

      if (isRateLimit) {
        const retryMatch = message.match(/retry in (\d+(?:\.\d+)?)s/i);
        const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : 15;
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfterSeconds,
        });
        return;
      }

      if (isDeadlineExceeded) {
        res.status(504).json({ error: 'Vision request timed out' });
        return;
      }

      console.error('Vision API error:', err);
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Second Sight server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
