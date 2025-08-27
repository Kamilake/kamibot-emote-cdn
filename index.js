// src/index.js (Workers Modules)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let raw = url.pathname.slice(1);
    let id = raw.replace(/\.webp$/i, '');

    // 간단 검증(임의 프록시 방지)
    if (!/^\d{5,30}$/.test(id)) {
      return new Response(
        `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>카미봇의 컨텐츠 전송 네트워크</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
        }
        h1 { font-size: 50px; }
        p { font-size: 20px; }
    </style>
</head>
<body>
    <h1>카미봇의 컨텐츠 전송 네트워크</h1>
    <p>이 서버는 Discord에 여러가지 정보를 빠르게 전송하기 위해 만들어졌어요.</p>
    <p>이 페이지는 404 Not Found 오류가 발생할 때 볼 수 있는데, 접근할 수 없는 페이지에 접근하려고 시도했을 때 보여요.</p>
    <p>무언가 막아둔 건 아니지만.. 만약 이미지를 찾으러 오셨다면 이곳에는 저화질 복사본밖에 없으니 원래 Discord 페이지에서 이미지를 찾아보세요.</p>
</body>
</html>`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8'
          }
        }
      );
    }

    const exp = Number(url.searchParams.get('ex') || 0);
    const sig = url.searchParams.get('hm') || '';
    if (!exp || !sig) return new Response('Missing signature', { status: 401 });
    if (Math.floor(Date.now() / 1000) > exp) return new Response('Expired', { status: 401 });

    const payload = `${id}.${exp}`;
    console.log('env.SIGNING_KEY:' + env.SIGNING_KEY);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.SIGNING_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const provided = base64urlToBytes(sig);
    if (!timingSafeEqual(new Uint8Array(expected), provided)) {
      return new Response('Invalid signature', { status: 403 });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const origin = new URL(`https://cdn.discordapp.com/emojis/${id}.webp`);
    origin.searchParams.set('size', '1024');
    origin.searchParams.set('quality', 'lossless');
    origin.searchParams.set('animated', 'true');

    const upstream = await fetch(origin.toString(), {
      cf: {
        image: {
          width: 160,
          height: 160,
          fit: 'cover',
          quality: 85,
          format: 'auto',
          anim: true
        },
        cacheEverything: true,
        cacheTtl: 60 * 60 * 24 * 30 // 30일
      }
    });

    if (!upstream.ok) return new Response('Not found', { status: 404 });

    const out = new Response(upstream.body, upstream);
    out.headers.set('Cache-Control', 'public, max-age=2592000, immutable');
    out.headers.set('Vary', 'Accept'); // format:auto 사용 시 안전
    await cache.put(cacheKey, out.clone());
    return out;
  }
};

function base64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  return Uint8Array.from(atob(s + '='.repeat(pad)), c => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
