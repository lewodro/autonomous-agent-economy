export async function listChromeTargets(debugUrl, fetchImpl=fetch) {
  try {
    const response=await fetchImpl(`${debugUrl}/json`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const targets=await response.json();
    if(!Array.isArray(targets))throw new Error('unexpected target-list response');
    return targets;
  } catch(error) {
    const reason=error instanceof Error?error.message:'unknown connection error';
    throw new Error(`Chrome DevTools is unavailable at ${debugUrl}. Start the app and Chrome with --remote-debugging-port=9322, or set CHROME_DEBUG_URL. ${reason}`);
  }
}
