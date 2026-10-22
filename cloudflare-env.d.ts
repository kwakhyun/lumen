declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    PERPLEXITY_API_KEY?: string;
    LUMEN_AUTOMATION_SECRET?: string;
    LUMEN_OPERATOR_USER_ID?: string;
    LUMEN_PROVIDER_MODE?: string;
    GOOGLE_OAUTH_MODE?: string;
  }
}
