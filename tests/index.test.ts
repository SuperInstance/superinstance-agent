import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to import the worker — since it uses Cloudflare types, we mock them
const worker = await import('../src/index');

// Mock VectorizeIndex type for TypeScript
declare global {
  interface VectorizeMatch {
    id: string;
    score: number;
    metadata?: Record<string, string>;
  }
  interface VectorizeMatches {
    matches?: VectorizeMatch[];
  }
  interface VectorizeIndex {
    query(vector: number[], options?: any): Promise<VectorizeMatches>;
  }
}

// Mock AI binding
function createMockAI(embedResponse?: number[], llmResponse?: string) {
  return {
    run: vi.fn().mockImplementation((model: string, params: any) => {
      if (model.includes('bge')) {
        return Promise.resolve({ data: [embedResponse || [0.1, 0.2, 0.3]] });
      }
      if (model.includes('llama')) {
        return Promise.resolve({ response: llmResponse || 'Mock answer' });
      }
      return Promise.resolve({});
    }),
  };
}

// Mock Vectorize index
function createMockIndex(matches?: VectorizeMatch[]) {
  return {
    query: vi.fn().mockResolvedValue({
      matches: matches || [
        { id: 'crate-1', score: 0.95, metadata: { name: 'networking', description: 'Networking crate' } },
        { id: 'crate-2', score: 0.87, metadata: { name: 'consensus', description: 'Consensus protocol' } },
      ],
    }),
  };
}

describe('SuperInstance SI-Agent', () => {
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = {
      AI: createMockAI(),
      CRATE_INDEX: createMockIndex(),
    };
  });

  describe('GET /health', () => {
    it('returns ok status with component checks', async () => {
      const request = new Request('https://test.example.com/health', {
        method: 'GET',
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.service).toBe('superinstance-agent');
      expect(data.components.ai_binding).toBe(true);
      expect(data.components.vectorize_binding).toBe(true);
    });
  });

  describe('POST /ask', () => {
    it('returns answer with citations', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'What handles networking?' }),
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.question).toBe('What handles networking?');
      expect(data.answer).toBe('Mock answer');
      expect(data.citations).toHaveLength(2);
      expect(data.citations[0].name).toBe('networking');
      expect(data.crates_searched).toBe(2);
    });

    it('returns 400 when question is missing', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('question');
    });
  });

  describe('POST /recommend', () => {
    it('returns recommendations for a task', async () => {
      const request = new Request('https://test.example.com/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'Build a distributed protocol' }),
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.task).toBe('Build a distributed protocol');
      expect(data.recommendation).toBe('Mock answer');
      expect(data.recommended_crates).toHaveLength(2);
      expect(data.total_candidates).toBe(2);
    });

    it('returns 400 when task is missing', async () => {
      const request = new Request('https://test.example.com/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('task');
    });
  });

  describe('OPTIONS (CORS)', () => {
    it('returns CORS headers for OPTIONS requests', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'OPTIONS',
      });
      const response = await worker.default.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Unknown routes', () => {
    it('returns 404 with endpoint list', async () => {
      const request = new Request('https://test.example.com/unknown', {
        method: 'GET',
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Not found');
      expect(data.endpoints).toHaveLength(3);
    });
  });

  describe('Error handling', () => {
    it('returns 500 when AI binding throws', async () => {
      mockEnv.AI = {
        run: vi.fn().mockRejectedValue(new Error('AI service down')),
      };

      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test' }),
      });
      const response = await worker.default.fetch(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
      expect(data.message).toContain('AI service down');
    });
  });

  describe('CORS headers on all responses', () => {
    it('includes CORS headers on /health', async () => {
      const request = new Request('https://test.example.com/health', {
        method: 'GET',
      });
      const response = await worker.default.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('includes CORS headers on /ask', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test' }),
      });
      const response = await worker.default.fetch(request, mockEnv);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('topK clamping', () => {
    it('clamps topK to maximum of 20', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test', topK: 100 }),
      });
      await worker.default.fetch(request, mockEnv);

      expect(mockEnv.CRATE_INDEX.query).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ topK: 20, returnMetadata: 'all' })
      );
    });

    it('uses default topK of 10 when not specified', async () => {
      const request = new Request('https://test.example.com/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test' }),
      });
      await worker.default.fetch(request, mockEnv);

      expect(mockEnv.CRATE_INDEX.query).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ topK: 10, returnMetadata: 'all' })
      );
    });
  });
});
