const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const { image } = await request.json();
        if (!image) return errorRes('이미지 없음', 400);
        const base64 = image.replace(/^data:image\/\w+;base64,/, '');
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const id = Math.random().toString(36).slice(2, 8);
        await env.BUCKET.put(`img/${id}`, binary, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { uploadedAt: Date.now().toString() }
        });
        return jsonRes({ id });
      } catch (e) {
        return errorRes('업로드 실패: ' + e.message, 500);
      }
    }

    if (request.method === 'GET' && url.pathname.startsWith('/img/')) {
      const id = url.pathname.slice(5);
      const obj = await env.BUCKET.get(`img/${id}`);
      if (!obj) return errorRes('이미지 없음', 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=2592000',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        }
      });
    }

    return errorRes('Not found', 404);
  }
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
  });
}
function errorRes(msg, status) { return jsonRes({ error: msg }, status); }
