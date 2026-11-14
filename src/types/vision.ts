export type VisionMode = 'describe' | 'read' | 'find' | 'auto';

export type ApiVisionMode = 'describe' | 'read' | 'find';

export type AppStatus = 'idle' | 'thinking' | 'speaking';

export type Language = 'en' | 'fr';

export interface VisionResponse {
  text: string;
}
