import { handleApi } from './handler.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return new Response('adclover marketing report API. GET /api/health', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
