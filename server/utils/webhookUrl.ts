/** Mask credentials embedded in webhook URLs (Discord token path, basic auth, …). */
export function redactWebhookUrl(url: string): string {
  const maskedAuth = url.replace(/\/\/.*@/, '//***@');
  try {
    const u = new URL(maskedAuth);
    // Discord: /api/webhooks/{id}/{token}
    const m = u.pathname.match(/^(\/api\/webhooks\/[^/]+\/)(.+)$/i);
    if (m) {
      u.pathname = `${m[1]}***`;
      return u.toString();
    }
  } catch {
    /* keep maskedAuth */
  }
  return maskedAuth;
}
