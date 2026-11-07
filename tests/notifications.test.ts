/**
 * tests/notifications.test.ts
 * Unit tests for Cross-Device Notification & WhatsApp Smart Draft Subsystem
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotificationSyncManager } from "../runtime/notificationSync";

describe("NotificationSyncManager", () => {
  it("ingests WhatsApp communication notifications and generates safe drafts", () => {
    const manager = new NotificationSyncManager();
    let draftEmitted = false;

    manager.onDraftReady((draft) => {
      draftEmitted = true;
      assert.equal(draft.isDraftOnly, true, "Must be safe draft only");
      assert.equal(draft.autoSend, false, "Must never auto-send");
      assert.equal(draft.requiresUserConfirmation, true);
      assert.ok(draft.suggestedText.length > 0);
    });

    const notif = manager.ingestNotification({
      appName: "WhatsApp",
      packageName: "com.whatsapp",
      title: "Zaid",
      body: "Bhai server deploy ho gaya kya?",
      category: "msg",
    });

    assert.ok(notif !== null);
    assert.equal(notif!.isCommunication, true);
    assert.equal(notif!.priority, "high");
    assert.ok(notif!.draft);
    assert.equal(draftEmitted, true);
    assert.ok(notif!.draft!.suggestedText.includes("testing") || notif!.draft!.suggestedText.includes("update"));
  });

  it("filters out noisy games and spam notifications", () => {
    const manager = new NotificationSyncManager();

    const gameNotif = manager.ingestNotification({
      appName: "Candy Crush Saga",
      packageName: "com.king.candycrushsaga",
      title: "Extra Lives Ready!",
      body: "Play now for unlimited rewards!",
    });
    assert.equal(gameNotif, null, "Game notifications must be filtered");

    const promoNotif = manager.ingestNotification({
      appName: "ShoppingApp",
      packageName: "com.deals.app",
      title: "Huge 50% discount sale today",
      body: "Don't miss out on promo codes!",
    });
    assert.equal(promoNotif, null, "Ad/sale notifications must be filtered");
  });

  it("deduplicates identical notifications", () => {
    const manager = new NotificationSyncManager();

    const first = manager.ingestNotification({
      appName: "WhatsApp",
      title: "Ali",
      body: "Hello",
    });
    const second = manager.ingestNotification({
      appName: "WhatsApp",
      title: "Ali",
      body: "Hello",
    });

    assert.ok(first !== null);
    assert.equal(second, null, "Duplicate notification must be suppressed");
  });

  it("emits proactive alerts for urgent messages", () => {
    const manager = new NotificationSyncManager();
    let alertReceived = false;

    manager.onProactiveAlert((alert) => {
      alertReceived = true;
      assert.ok(alert.spokenAnnouncement.includes("Zaid"));
      assert.equal(alert.hasDraft, true);
    });

    manager.ingestNotification({
      appName: "WhatsApp",
      title: "Zaid",
      body: "Bhai urgent check karo server down hai!",
    });

    assert.equal(alertReceived, true);
  });

  it("allows updating draft text and confirming manual send", () => {
    const manager = new NotificationSyncManager();

    const notif = manager.ingestNotification({
      appName: "WhatsApp",
      title: "Hamza",
      body: "Meeting kab hai?",
    });

    assert.ok(notif !== null);
    const updated = manager.updateDraftText(notif!.id, "Haan bhai 5 minute mein join kar raha hoon.");
    assert.ok(updated !== null);
    assert.equal(updated!.suggestedText, "Haan bhai 5 minute mein join kar raha hoon.");
    assert.equal(updated!.status, "edited");

    const confirmed = manager.confirmDraftSent(notif!.id);
    assert.equal(confirmed, true);
    assert.equal(notif!.draft!.status, "confirmed_sent");
  });

  it("manages active notifications list and dismissals", () => {
    const manager = new NotificationSyncManager();

    const notif1 = manager.ingestNotification({
      appName: "GitHub",
      title: "Repo Alert",
      body: "New Pull Request #42 opened.",
    });
    const notif2 = manager.ingestNotification({
      appName: "Slack",
      title: "Dev Team",
      body: "Morning sync at 10 AM.",
    });

    assert.equal(manager.getActiveNotifications().length, 2);

    manager.dismissNotification(notif1!.id);
    assert.equal(manager.getActiveNotifications().length, 1);
    assert.equal(manager.getActiveNotifications()[0].id, notif2!.id);

    manager.clearAll();
    assert.equal(manager.getActiveNotifications().length, 0);
  });
});

