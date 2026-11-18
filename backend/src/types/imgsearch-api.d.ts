// backend/src/types/imgsearch-api.d.ts
declare module 'imgsearch-api' {
  export function imageSearch(
    query: string,
    options?: { n?: number; engines?: string[] }
  ): Promise<string[]>;
}