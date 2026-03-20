import type { NotificationConfig, NotificationEvent, ToryoEvent, GlobalMetrics } from './types.js';

export interface NotificationProvider {
  send(title: string, body: string, priority?: 'low' | 'default' | 'high'): Promise<void>;
}

export function createNotifier(config?: NotificationConfig): NotificationProvider | null {
  if (!config || config.provider === 'none') return null;

  switch (config.provider) {
    case 'ntfy':
      return createNtfyProvider(config.target);
    case 'webhook':
      return createWebhookProvider(config.target);
    case 'slack':
      return createSlackProvider(config.target);
    case 'discord':
      return createDiscordProvider(config.target);
    default:
      return null;
  }
}

const NOTIFY_TIMEOUT = 10_000; // 10 second timeout for notification requests

function createNtfyProvider(topic: string): NotificationProvider {
  const url = topic.startsWith('http') ? topic : `https://ntfy.sh/${topic}`;

  return {
    async send(title, body, priority = 'default') {
      await fetch(url, {
        method: 'POST',
        headers: {
          Title: title,
          Priority: priority === 'high' ? '5' : priority === 'low' ? '2' : '3',
          Tags: 'robot',
        },
        body,
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT),
      });
    },
  };
}

function createWebhookProvider(url: string): NotificationProvider {
  return {
    async send(title, body, priority = 'default') {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, priority }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT),
      });
    },
  };
}

function createSlackProvider(webhookUrl: string): NotificationProvider {
  return {
    async send(title, body) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT),
      });
    },
  };
}

function createDiscordProvider(webhookUrl: string): NotificationProvider {
  return {
    async send(title, body) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `**${title}**\n${body}` }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT),
      });
    },
  };
}

/** Determine if a ToryoEvent should trigger a notification */
export function shouldNotify(event: ToryoEvent, events: NotificationEvent[]): boolean {
  switch (event.type) {
    case 'review:complete':
      if (event.review.score >= 9.0 && events.includes('breakthrough')) return true;
      if (event.review.score < 6.0 && events.includes('failure')) return true;
      return false;
    case 'cycle:complete':
      if (event.result.verdict === 'crash' && events.includes('crash')) return true;
      if (events.includes('cycle_complete')) return true;
      if (event.cycle % 5 === 0 && events.includes('status')) return true;
      return false;
    default:
      return false;
  }
}

/** Format a ToryoEvent into a notification message */
export function formatNotification(
  event: ToryoEvent,
  metrics?: GlobalMetrics,
): { title: string; body: string; priority: 'low' | 'default' | 'high' } {
  switch (event.type) {
    case 'review:complete':
      if (event.review.score >= 9.0) {
        return {
          title: `Breakthrough! Score ${event.review.score}/10`,
          body: `Cycle ${event.cycle} achieved an exceptional score.`,
          priority: 'high',
        };
      }
      return {
        title: `Low score: ${event.review.score}/10`,
        body: `Cycle ${event.cycle} scored below threshold.`,
        priority: 'default',
      };
    case 'cycle:complete':
      if (event.result.verdict === 'crash') {
        return {
          title: 'Infrastructure failure',
          body: `Cycle ${event.cycle}: ${event.result.task} crashed.`,
          priority: 'high',
        };
      }
      const stats = metrics
        ? ` | ${metrics.cyclesCompleted} cycles, ${(metrics.successRate * 100).toFixed(0)}% success`
        : '';
      return {
        title: `Cycle ${event.cycle}: ${event.result.verdict}`,
        body: `${event.result.task} — ${event.result.finalScore}/10${stats}`,
        priority: 'low',
      };
    default:
      return {
        title: 'Toryo event',
        body: JSON.stringify(event),
        priority: 'low',
      };
  }
}
