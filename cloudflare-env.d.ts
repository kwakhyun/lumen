declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    PERPLEXITY_API_KEY?: string;
  }
}
