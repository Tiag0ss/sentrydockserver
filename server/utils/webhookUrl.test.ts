import { describe, expect, it } from 'vitest';
import { redactWebhookUrl } from './webhookUrl';

describe('redactWebhookUrl', () => {
  it('masks Discord webhook token in path', () => {
    const url = 'https://discord.com/api/webhooks/1234567890/super-secret-token-value';
    expect(redactWebhookUrl(url)).toBe('https://discord.com/api/webhooks/1234567890/***');
  });

  it('masks basic auth credentials', () => {
    expect(redactWebhookUrl('https://user:pass@hooks.example.com/path'))
      .toBe('https://***@hooks.example.com/path');
  });

  it('leaves plain urls unchanged', () => {
    expect(redactWebhookUrl('https://hooks.example.com/v1/notify'))
      .toBe('https://hooks.example.com/v1/notify');
  });
});
