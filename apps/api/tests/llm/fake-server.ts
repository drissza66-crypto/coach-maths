import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Faux serveur imitant les API Mistral/OpenAI, Gemini et Claude :
 * on teste le vrai code réseau des adaptateurs, sans clé ni internet.
 */
export type Scenario = 'ok' | '429' | '429-quota' | '401' | '500' | 'filter' | 'bad-json-once';

export interface Captured {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

export const STRUCTURED = { titre: 'Aire du rectangle', questions: ['Quelle est la longueur ?', 'Quelle est la largeur ?'] };
const WORDS = ['Quelle ', 'est ', 'la ', 'longueur ', '?'];

export class FakeLLMServer {
  scenario: Scenario = 'ok';
  requests: Captured[] = [];
  private server: Server;
  private badJsonServed = false;
  url = '';

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(scenario: Scenario = 'ok') {
    this.scenario = scenario;
    this.requests = [];
    this.badJsonServed = false;
  }

  get last() {
    return this.requests.at(-1)!;
  }

  private structuredText() {
    if (this.scenario === 'bad-json-once' && !this.badJsonServed) {
      this.badJsonServed = true;
      return 'Voici la fiche : {pas du json';
    }
    return JSON.stringify(STRUCTURED);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const path = req.url ?? '';
    this.requests.push({ path, headers: req.headers, body });

    const isClaude = path.startsWith('/v1/messages');
    const isGemini = path.includes(':generateContent') || path.includes(':streamGenerateContent');

    if (this.scenario === '401') return this.error(res, 401, isClaude ? 'authentication_error' : 'invalid key');
    if (this.scenario === '500') return this.error(res, isClaude ? 529 : 500, isClaude ? 'overloaded_error' : 'server');
    if (this.scenario === '429') return this.error(res, 429, isClaude ? 'rate_limit_error' : 'slow down', { 'retry-after': '3' });
    if (this.scenario === '429-quota') {
      return this.error(res, 429, 'You exceeded your current quota, please check your plan and billing details.');
    }

    if (isClaude) return this.claude(body, res);
    if (isGemini) return this.gemini(path, res);
    return this.openai(body, res);
  }

  private error(res: ServerResponse, status: number, type: string, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify({ type: 'error', error: { type, message: type } }));
  }

  private sse(res: ServerResponse, events: { event?: string; data: unknown }[]) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const e of events) {
      res.write(`${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`);
    }
    res.end();
  }

  private openai(body: Record<string, unknown>, res: ServerResponse) {
    const filtered = this.scenario === 'filter';
    if (body.stream) {
      return this.sse(res, [
        ...WORDS.map((w) => ({ data: { choices: [{ delta: { content: w }, finish_reason: null }] } })),
        { data: { choices: [{ delta: {}, finish_reason: filtered ? 'content_filter' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } } },
        { data: '[DONE]' },
      ]);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: this.structuredText() }, finish_reason: filtered ? 'content_filter' : 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 30 },
      }),
    );
  }

  private gemini(path: string, res: ServerResponse) {
    const finishReason = this.scenario === 'filter' ? 'SAFETY' : 'STOP';
    const usageMetadata = { promptTokenCount: 12, candidatesTokenCount: 5 };
    if (path.includes(':streamGenerateContent')) {
      return this.sse(
        res,
        WORDS.map((w, i) => ({
          data: {
            candidates: [{ content: { parts: [{ text: w }], role: 'model' }, ...(i === WORDS.length - 1 && { finishReason }) }],
            ...(i === WORDS.length - 1 && { usageMetadata }),
          },
        })),
      );
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: this.structuredText() }], role: 'model' }, finishReason }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30 },
      }),
    );
  }

  private claude(body: Record<string, unknown>, res: ServerResponse) {
    const model = String(body.model);
    const stopReason = this.scenario === 'filter' ? 'refusal' : 'end_turn';
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [] as unknown[],
      stop_reason: null as string | null,
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 0 },
    };
    if (body.stream) {
      return this.sse(res, [
        { event: 'message_start', data: { type: 'message_start', message } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        ...WORDS.map((w) => ({
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } },
        })),
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'message_delta',
          data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ...message,
        content: [{ type: 'text', text: this.structuredText() }],
        stop_reason: stopReason,
        usage: { input_tokens: 20, output_tokens: 30 },
      }),
    );
  }
}
