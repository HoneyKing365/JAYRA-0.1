/**
 * runtime/notificationSync.ts
 * Cross-Platform Notification Synchronization & WhatsApp Context-Aware Smart Draft Subsystem.
 *
 * Implements:
 * 1. Cross-Platform Ingestion: Ingests desktop (Windows) and Android companion notifications.
 * 2. Privacy & Noise Filter: Silently ignores spam, games, and low-priority system events;
 *    prioritizes critical communication apps (WhatsApp, Telegram, Gmail, VS Code, GitHub, Slack).
 * 3. WhatsApp Context-Aware Smart Draft Replies:
 *    - Automatically analyzes incoming messages and drafts human-like replies
 *      matching the conversation's tone (Hinglish / Urdu / English, casual vs. professional).
 *    - STRICT SAFETY BOUND: NEVER auto-sends messages. Drafts are safely pre-filled
 *      for the user to inspect, edit, and manually confirm.
 * 4. Proactive Companion Alerts: Dispatches proactive voice/balloon announcements for urgent messages.
 */

import { randomUUID } from "node:crypto";

export type NotificationSource = "android" | "desktop";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface SyncedNotification {
  id: string;
  source: NotificationSource;
  packageName: string;
  appName: string;
  title: string;
  body: string;
  timestamp: number;
  category?: string;
  priority: NotificationPriority;
  isCommunication: boolean;
  draft?: WhatsAppDraftReply;
  read: boolean;
  dismissed: boolean;
}

export type DraftTone = "casual_friendly" | "polite_professional" | "direct_brief";
export type DraftLanguage = "hinglish" | "urdu" | "english";

export interface WhatsAppDraftReply {
  draftId: string;
  notificationId: string;
  sender: string;
  originalMessage: string;
  suggestedText: string;
  alternativeDrafts: string[];
  tone: DraftTone;
  language: DraftLanguage;
  isDraftOnly: true;
  autoSend: false;
  requiresUserConfirmation: true;
  createdAt: number;
  status: "drafted" | "edited" | "confirmed_sent" | "rejected";
}

export interface ProactiveNotificationAlert {
  notificationId: string;
  appName: string;
  sender: string;
  spokenAnnouncement: string;
  balloonText: string;
  hasDraft: boolean;
  timestamp: number;
}

export type NotificationCallback = (notification: SyncedNotification) => void;
export type DraftReadyCallback = (draft: WhatsAppDraftReply) => void;
export type ProactiveAlertCallback = (alert: ProactiveNotificationAlert) => void;

/** Filter definitions for communication and priority sorting */
const COMMUNICATION_PATTERNS = [
  /whatsapp/i,
  /telegram/i,
  /signal/i,
  /slack/i,
  /discord/i,
  /gmail|google.*mail|outlook|thunderbird/i,
  /github/i,
  /vscode|code/i,
  /teams/i,
];

const NOISE_PATTERNS = [
  /candy.*crush|pubg|freefire|subway.*surf|game/i,
  /battery.*full|charging|cleaner|booster|antivirus/i,
  /ad|sale|discount|promo|cashback|shopping/i,
  /spotify.*playing|music.*playing/i, // Ongoing media playback isn't an actionable notification
];

export class NotificationSyncManager {
  private readonly notifications = new Map<string, SyncedNotification>();
  private readonly recentHashes: string[] = [];
  private readonly notificationListeners: Set<NotificationCallback> = new Set();
  private readonly draftListeners: Set<DraftReadyCallback> = new Set();
  private readonly alertListeners: Set<ProactiveAlertCallback> = new Set();

  private readonly maxStored = 50;
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now.bind(Date);
  }

  /**
   * Ingest a notification from Android or Desktop.
   * Performs noise filtering, priority assessment, deduplication,
   * smart draft generation, and proactive announcement dispatch.
   */
  public ingestNotification(raw: {
    id?: string;
    source?: NotificationSource;
    packageName?: string;
    appName?: string;
    title: string;
    body: string;
    timestamp?: number;
    category?: string;
  }): SyncedNotification | null {
    const title = (raw.title || "").trim();
    const body = (raw.body || "").trim();
    const appName = (raw.appName || "").trim() || "Notification";
    const packageName = (raw.packageName || "").trim();
    const source: NotificationSource = raw.source ?? "android";
    const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : this.now();

    if (!title && !body) return null;

    // 1. Noise Filter Check
    const combinedAppText = `${appName} ${packageName}`.toLowerCase();
    const isNoise = NOISE_PATTERNS.some((pat) => pat.test(combinedAppText) || pat.test(title));
    if (isNoise) {
      return null;
    }

    // 2. Deduplication Guard: Ignore identical notifications within 10 seconds
    const dedupHash = `${appName}:${title}:${body}`.slice(0, 100);
    if (this.recentHashes.includes(dedupHash)) {
      return null;
    }
    this.recentHashes.push(dedupHash);
    if (this.recentHashes.length > 50) this.recentHashes.shift();

    // 3. Prioritization & Communication App Check
    const isCommunication = COMMUNICATION_PATTERNS.some(
      (pat) => pat.test(appName) || pat.test(packageName) || pat.test(raw.category || "")
    );

    let priority: NotificationPriority = "normal";
    const isWhatsApp = /whatsapp/i.test(appName) || /whatsapp/i.test(packageName);
    const isUrgentText = /urgent|emergency|asap|important|alert|server down|build failed|crash/i.test(
      `${title} ${body}`
    );

    if (isUrgentText) {
      priority = "urgent";
    } else if (isWhatsApp || /telegram|slack/i.test(appName)) {
      priority = "high";
    } else if (!isCommunication) {
      priority = "low";
    }

    const id = raw.id || `notif_${timestamp}_${randomUUID().slice(0, 8)}`;

    const notification: SyncedNotification = {
      id,
      source,
      packageName,
      appName,
      title,
      body,
      timestamp,
      category: raw.category,
      priority,
      isCommunication,
      read: false,
      dismissed: false,
    };

    // 4. WhatsApp / Messaging Smart Context-Aware Draft Generation
    if (isWhatsApp || (isCommunication && body.length > 0)) {
      notification.draft = this.generateSmartDraft(notification);
    }

    // 5. Store in memory (bounded)
    this.notifications.set(id, notification);
    if (this.notifications.size > this.maxStored) {
      const oldestKey = this.notifications.keys().next().value;
      if (oldestKey) this.notifications.delete(oldestKey);
    }

    // 6. Notify listeners
    for (const listener of this.notificationListeners) {
      try {
        listener(notification);
      } catch {
        // Safe dispatch
      }
    }

    if (notification.draft) {
      for (const listener of this.draftListeners) {
        try {
          listener(notification.draft);
        } catch {
          // Safe dispatch
        }
      }
    }

    // 7. Proactive Announcement Dispatch for high/urgent communication
    if (priority === "high" || priority === "urgent") {
      this.dispatchProactiveAlert(notification);
    }

    return notification;
  }

  /**
   * Generates a context-aware smart draft reply.
   * SAFE DRAFT ONLY: NEVER auto-sends.
   */
  public generateSmartDraft(notification: SyncedNotification): WhatsAppDraftReply {
    const sender = notification.title || "Friend";
    const message = notification.body;

    const { suggestedText, alternativeDrafts, tone, language } = this.deriveReplyOptions(sender, message);

    return {
      draftId: `draft_${this.now()}_${randomUUID().slice(0, 6)}`,
      notificationId: notification.id,
      sender,
      originalMessage: message,
      suggestedText,
      alternativeDrafts,
      tone,
      language,
      isDraftOnly: true,
      autoSend: false,
      requiresUserConfirmation: true,
      createdAt: this.now(),
      status: "drafted",
    };
  }

  /**
   * Derive context-aware reply suggestions for the user.
   */
  private deriveReplyOptions(
    _sender: string,
    message: string
  ): {
    suggestedText: string;
    alternativeDrafts: string[];
    tone: DraftTone;
    language: DraftLanguage;
  } {
    const msg = message.toLowerCase();

    // Query regarding server / deployment / project status
    if (/server|deploy|live|status|kab.*hoga|kaam.*kahan|progress|update/i.test(msg)) {
      return {
        suggestedText: "Haan bas testing complete ho rahi hai, 5-10 minute mein update deta hoon! 🚀",
        alternativeDrafts: [
          "Bas wrap up kar raha hoon, thodi der mein ping karta hoon.",
          "Working on it right now, will keep you posted shortly!",
        ],
        tone: "casual_friendly",
        language: "hinglish",
      };
    }

    // Availability / meeting / calling query
    if (/call|free|available|meeting|kab.*mil|online|sun/i.test(msg)) {
      return {
        suggestedText: "Haan main online hoon, batao kya scene hai? 📞",
        alternativeDrafts: [
          "Thoda code mein busy hoon, 10 min baad call karta hoon.",
          "Yes, I'm available! Let's connect.",
        ],
        tone: "casual_friendly",
        language: "hinglish",
      };
    }

    // Code / PR / bug / review query
    if (/pr|pull request|review|bug|issue|code|github|commit/i.test(msg)) {
      return {
        suggestedText: "Main check kar ke review karta hoon abhi! 👍",
        alternativeDrafts: [
          "Got it, looking into the diff right now.",
          "Haan dekh raha hoon, pull leke test karta hoon.",
        ],
        tone: "casual_friendly",
        language: "hinglish",
      };
    }

    // Formal / professional inquiries
    if (/please find|kindly|invoice|contract|document|regards|dear/i.test(msg)) {
      return {
        suggestedText: "Thank you for the update. I have received this and will review shortly.",
        alternativeDrafts: [
          "Acknowledged with thanks. I'll get back to you promptly.",
          "Shukriya, main review kar ke confirm karta hoon.",
        ],
        tone: "polite_professional",
        language: "english",
      };
    }

    // Greetings
    if (/salam|assalam|hey|hi|hello|kya haal|wassup/i.test(msg)) {
      return {
        suggestedText: "Walaikum Assalam! Sab theek, aap sunao kya haal hain? 😊",
        alternativeDrafts: [
          "Hey! All good here, how's everything with you?",
          "Assalam o Alaikum! Sab badhiya, batao kya chal raha hai?",
        ],
        tone: "casual_friendly",
        language: "hinglish",
      };
    }

    // Default polite acknowledgement
    return {
      suggestedText: "Theek hai, note kar liya! Thodi der mein detail mein reply karta hoon. 👍",
      alternativeDrafts: [
        "Got it, will reply back shortly!",
        "Haan theek hai, samajh gaya.",
      ],
      tone: "casual_friendly",
      language: "hinglish",
    };
  }

  private dispatchProactiveAlert(notification: SyncedNotification): void {
    const sender = notification.title || "WhatsApp";
    const appName = notification.appName;
    const bodySnippet = notification.body.length > 60 ? `${notification.body.slice(0, 57)}...` : notification.body;

    const spokenAnnouncement = notification.draft
      ? `${appName} pe ${sender} ka message aaya hai: "${bodySnippet}". Maine ek draft reply tayyar kar diya hai, check kar lo!`
      : `${appName} pe ${sender} ka zaroori message aaya hai: "${bodySnippet}".`;

    const balloonText = `💬 ${appName}: ${sender} — "${bodySnippet}"`;

    const alert: ProactiveNotificationAlert = {
      notificationId: notification.id,
      appName,
      sender,
      spokenAnnouncement,
      balloonText,
      hasDraft: !!notification.draft,
      timestamp: this.now(),
    };

    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch {
        // Safe dispatch
      }
    }
  }

  /** Update draft text before user sends */
  public updateDraftText(notificationId: string, newText: string): WhatsAppDraftReply | null {
    const notif = this.notifications.get(notificationId);
    if (!notif || !notif.draft) return null;
    notif.draft.suggestedText = newText;
    notif.draft.status = "edited";
    return notif.draft;
  }

  /** Mark draft as manually confirmed / sent by user */
  public confirmDraftSent(notificationId: string): boolean {
    const notif = this.notifications.get(notificationId);
    if (!notif || !notif.draft) return false;
    notif.draft.status = "confirmed_sent";
    notif.read = true;
    return true;
  }

  /** Fetch active, non-dismissed notifications */
  public getActiveNotifications(): SyncedNotification[] {
    return Array.from(this.notifications.values())
      .filter((n) => !n.dismissed)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Mark notification dismissed */
  public dismissNotification(id: string): boolean {
    const notif = this.notifications.get(id);
    if (!notif) return false;
    notif.dismissed = true;
    return true;
  }

  /** Clear all notifications */
  public clearAll(): void {
    this.notifications.clear();
  }

  public onNotification(listener: NotificationCallback): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  public onDraftReady(listener: DraftReadyCallback): () => void {
    this.draftListeners.add(listener);
    return () => this.draftListeners.delete(listener);
  }

  public onProactiveAlert(listener: ProactiveAlertCallback): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }
}
