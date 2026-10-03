// Local service authority is configured by the server, never by request headers.
export function authorizeRequest(req, port, publicOrigin = process.env.PUBLIC_ORIGIN) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  if (publicOrigin) {
    const configured = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || configured.origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an HTTP origin');
    hosts.add(configured.host);
    origins.add(configured.origin);
  }
  if (!hosts.has(req.headers.host)) return { status: 421, error: 'Unapproved request host' };
  if (req.headers.origin && !origins.has(req.headers.origin)) return { status: 403, error: 'Cross-origin requests are not allowed' };
  return null;
}
