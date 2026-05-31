export function handleHealthCheck(): Response {
  return new Response('ok', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
