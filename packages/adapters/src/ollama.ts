import type { AgentAdapter, AdapterSendOptions, AdapterResponse } from 'toryo-core';

/**
 * Adapter for Ollama API (direct HTTP, no CLI dependency).
 * Connects to local Ollama instance for running local models.
 */
export class OllamaAdapter implements AgentAdapter {
  name = 'ollama';

  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async send(options: AdapterSendOptions): Promise<AdapterResponse> {
    const model = options.model ?? 'qwen3.5:27b';
    const fullPrompt = options.autonomyPrefix
      ? `${options.autonomyPrefix}\n\n${options.prompt}`
      : options.prompt;

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout * 1000);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: fullPrompt,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return {
          output: '',
          durationMs: Date.now() - start,
          infraFailure: true,
          error: `Ollama API error: ${response.status} ${response.statusText}`,
        };
      }

      const data = (await response.json()) as { response: string };

      return {
        output: data.response.trim(),
        durationMs: Date.now() - start,
        infraFailure: false,
      };
    } catch (error) {
      clearTimeout(timer);
      const err = error as Error;
      return {
        output: '',
        durationMs: Date.now() - start,
        infraFailure: true,
        error: err.name === 'AbortError' ? 'Timeout exceeded' : err.message,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
