import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
type Api = (path: string, init?: RequestInit) => Promise<any>;
// Shared with service-worker.js: this cache holds one opt-in boolean only.
const PREFERENCES_CACHE = 'deck-notification-preferences';
const preferencesURL = (origin: string) => new URL('/__deck_notification_preferences__', origin).href;
export async function readApprovalNotificationPreference(store?: CacheStorage, origin?: string): Promise<boolean> {
  try {
    const cache = await (store ?? caches).open(PREFERENCES_CACHE);
    return (await (await cache.match(preferencesURL(origin ?? location.origin)))?.json())?.approvalActions === true;
  } catch { return false; }
}
export async function writeApprovalNotificationPreference(enabled: boolean, store?: CacheStorage, origin?: string): Promise<void> {
  const cache = await (store ?? caches).open(PREFERENCES_CACHE);
  await cache.put(preferencesURL(origin ?? location.origin), new Response(JSON.stringify({approvalActions: enabled}), {headers:{'Content-Type':'application/json'}}));
}
export function pushSetupHint(): string | undefined {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !installed)
    return 'On iPhone or iPad, use Share → Add to Home Screen, then open Deck from that icon to enable notifications.';
  if (!window.isSecureContext)
    return 'Open Deck over HTTPS to enable notifications.';
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  )
    return 'This browser does not support Web Push. Try a current Chrome, Firefox or Safari.';
}
export function sessionFromURL(url: string): string {
  const id = new URL(url).searchParams.get('session') ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && !id.includes('..')
    ? id
    : '';
}
function keyBytes(key: string) {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
/** An unrecognized device must replace a surviving browser subscription, never claim it. */
export async function reconcilePushSubscription(
  manager: PushManager,
  publicKey: string,
  alreadyEnabled: boolean,
): Promise<PushSubscription> {
  const existing = await manager.getSubscription();
  if (existing) {
    const key = existing.options.applicationServerKey;
    const matches =
      key &&
      btoa(String.fromCharCode(...new Uint8Array(key)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '') === publicKey;
    if (alreadyEnabled && matches) return existing;
    if (!(await existing.unsubscribe()))
      throw new Error('push-subscription-replacement-failed');
  }
  return manager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
}
async function worker() {
  await navigator.serviceWorker.register('/service-worker.js', {
    scope: '/',
    updateViaCache: 'none',
  });
  return navigator.serviceWorker.ready;
}
/** Recheck after worker startup: navigation/blur may invalidate the original view. */
export async function notifySessionViewed(
  sessionId: string,
  isViewing: () => boolean,
  container: ServiceWorkerContainer = navigator.serviceWorker,
) {
  if (!sessionId || !isViewing()) return;
  try {
    const registration = await container.ready;
    if (isViewing()) registration.active?.postMessage({type:'deck.session-viewed', sessionId});
  } catch { /* Local notification cleanup never blocks presence or chat. */ }
}
/** Each tab owns its own lease; a background tab can never clear another tab's presence. */
export function usePushPresence(
  api: Api,
  enabled: boolean,
  sessionId: string,
  conversationVisible: boolean,
  seenSeq: number,
) {
  const tabId = useRef(crypto.randomUUID()),
    revision = useRef(0),
    sequence = useRef(seenSeq),
    acknowledge = useRef<(() => void) | undefined>(undefined);
  sequence.current = seenSeq;
  useEffect(() => {
    if (!enabled || pushSetupHint()) return;
    let active = true;
    const isViewing = () => active && conversationVisible && document.visibilityState === 'visible' && document.hasFocus();
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      void notifySessionViewed(sessionId, isViewing);
      void api('/api/push/presence', {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          tabId: tabId.current,
          revision: ++revision.current,
          seenSeq: sequence.current,
          sessionId:
            conversationVisible &&
            document.visibilityState === 'visible' &&
            document.hasFocus()
              ? sessionId || null
              : null,
        }),
      }).catch(() => {});
    };
    const release = () => {
      void api('/api/push/presence', {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          tabId: tabId.current,
          revision: ++revision.current,
          sessionId: null,
        }),
      }).catch(() => {});
    };
    acknowledge.current = () => {
      if (
        ackTimer ||
        !conversationVisible ||
        document.visibilityState !== 'visible'
      )
        return;
      ackTimer = setTimeout(() => {
        ackTimer = undefined;
        send();
      }, 100);
    };
    send();
    const timer = setInterval(send, 15000);
    document.addEventListener('visibilitychange', send);
    window.addEventListener('focus', send);
    window.addEventListener('blur', send);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', send);
    window.addEventListener('online', send);
    return () => {
      active = false;
      acknowledge.current = undefined;
      clearTimeout(ackTimer);
      window.removeEventListener('pageshow', send);
      window.removeEventListener('online', send);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', send);
      window.removeEventListener('focus', send);
      window.removeEventListener('blur', send);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [api, enabled, sessionId, conversationVisible]);
  useEffect(() => {
    acknowledge.current?.();
  }, [seenSeq]);
}
export function usePushNotifications(api: Api) {
  const hint = pushSetupHint();
  const [enabled, setEnabled] = useState(false),
    [registered, setRegistered] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!hint),
    [message, setMessage] = useState(''),
    [delivery, setDelivery] =
      useState<
        import('../../../packages/session-host/src/web-push').PushDeliveryStatus
      >(),
    [denied, setDenied] = useState(
      !hint && Notification.permission === 'denied',
    );
  const [needsReconnect,setNeedsReconnect]=useState(false);
  const [approvalActions,setApprovalActions]=useState(false);
  const refresh = async () => {
    if (hint) return;
    setApprovalActions(await readApprovalNotificationPreference());
    try {
      const [status, registration] = await Promise.all([
        api('/api/push'),
        worker(),
      ]);
      setDelivery(status.delivery);
      const subscription = await registration.pushManager.getSubscription();
      setNeedsReconnect((!!subscription && !status.enabled) || (status.enabled && (!subscription || Notification.permission !== 'granted')));
      if (status.enabled && Notification.permission !== 'granted')
        await api('/api/push', { method: 'DELETE' });
      setRegistered(status.enabled && Notification.permission === 'granted');
      setEnabled(
        status.enabled &&
          !!subscription &&
          Notification.permission === 'granted',
      );
      setDenied(Notification.permission === 'denied');
      setMessage(
        status.enabled && !subscription
          ? 'Reconnect notifications for this browser.'
          : '',
      );
    } catch {
      setNeedsReconnect(true);
      setMessage(
        'Notifications are unavailable. You can retry when Deck is connected.',
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [api]);
  async function enable() {
    // Permission is requested directly in the user's gesture, before any awaited setup.
    const permission = Notification.requestPermission();
    setBusy(true);
    setMessage('');
    let subscription: PushSubscription | null = null;
    try {
      const result = await permission;
      setDenied(result === 'denied');
      if (result !== 'granted') {
        setMessage(
          result === 'denied'
            ? 'Notifications are blocked. Allow them in this site’s browser settings, then retry.'
            : 'Permission was not granted. You can enable notifications later.',
        );
        return;
      }
      const [status, registration] = await Promise.all([
        api('/api/push'),
        worker(),
      ]);
      subscription = await reconcilePushSubscription(
        registration.pushManager,
        status.publicKey,
        status.enabled,
      );
      await api('/api/push', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      setRegistered(true);
      setEnabled(true);
      setNeedsReconnect(false);
      setMessage('Notifications are on for this browser.');
    } catch {
      await subscription?.unsubscribe().catch(() => {});
      setEnabled(false);
      setMessage(
        'Could not enable notifications. Check your connection and browser settings, then retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setMessage('');
    try {
      await api('/api/push', { method: 'DELETE' });
      setRegistered(false);
      setEnabled(false);
      setNeedsReconnect(false);
      const registration = await navigator.serviceWorker.getRegistration('/');
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      setMessage('Notifications are off for this browser.');
    } catch {
      setMessage(
        'Could not finish disabling notifications. Reconnect and retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeApprovalActions(value: boolean) {
    setBusy(true);
    const previous=approvalActions;
    setApprovalActions(value);
    try {
      await writeApprovalNotificationPreference(value);
      setApprovalActions(value);
      setMessage(value ? 'Approval actions are on for this browser where supported.' : 'Approval actions are off for this browser.');
    } catch {
      setApprovalActions(previous);
      setMessage('Could not save approval actions. Check browser storage settings and retry.');
    }
    finally { setBusy(false); }
  }
  return {hint,enabled,registered,busy,loading,message,delivery,denied,enable,disable,refresh,approvalActions,changeApprovalActions,attention:denied||needsReconnect};
}
export function NotificationsDialog({settings,onClose}:{settings:ReturnType<typeof usePushNotifications>;onClose:()=>void}) {
  const {hint,enabled,registered,busy,loading,message,delivery,denied,enable,disable,refresh,approvalActions,changeApprovalActions}=settings;
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{const node=dialog.current!;node.showModal();return()=>node.close();},[]);
  return <dialog ref={dialog} className="workspace-dialog notifications-dialog" aria-labelledby="notifications-title"
    onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}}
    onClick={event=>{if(event.target!==event.currentTarget)return;const b=event.currentTarget.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)onClose();}}>
      <div className="dialog-heading"><h2 id="notifications-title">Notifications</h2><button type="button" className="quiet" aria-label="Close notifications" onClick={onClose}>✕</button></div>
      <section className="notification-settings" aria-label="Browser notifications">
        <p>
          Get a private alert when the Lead is ready, a question or approval
          needs you, or work needs attention.
        </p>
        <p>
          Commands, paths, tool input and errors stay in Deck. Alerts use your
          browser’s push service, even when this tab is closed. Enabling keeps
          this browser signed in for 180 days.
        </p>
        {hint ? (
          <p role="status">{hint}</p>
        ) : (
          <>
            <p role="status">
              {loading
                ? 'Checking this browser…'
                : enabled
                  ? 'On for this browser'
                  : denied
                    ? 'Blocked in browser settings'
                    : 'Off for this browser'}
            </p>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void (enabled ? disable() : enable())}
            >
              {busy
                ? 'Saving…'
                : enabled
                  ? 'Disable notifications'
                  : 'Enable notifications'}
            </button>
            {registered && !enabled && (
              <button
                className="quiet"
                type="button"
                disabled={busy}
                onClick={() => void disable()}
              >
                Disable notifications
              </button>
            )}
            {denied && (
              <p>
                Allow notifications in this site’s browser settings, then retry.
              </p>
            )}
            <label className="approval-checkbox notification-approval-setting">
              <input type="checkbox" checked={approvalActions} disabled={busy || loading} aria-describedby="notification-approvals-help" onChange={event=>void changeApprovalActions(event.currentTarget.checked)}/>
              <span>Answer approvals from notifications</span>
            </label>
            <p id="notification-approvals-help">Allow once and Deny for normal-risk requests on supported Chromium browsers. Tool names appear in these alerts. Other requests open Deck.</p>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {!hint && (
          <div className="push-delivery">
            <p role="status">{pushDeliveryText(delivery)}</p>
            <button
              type="button"
              className="quiet"
              onClick={() => void refresh()}
            >
              Refresh delivery status
            </button>
          </div>
        )}
      </section>
      <div className="dialog-actions"><button type="button" onClick={onClose}>Done</button></div>
    </dialog>;
}

export function pushDeliveryText(
  status?: import('../../../packages/session-host/src/web-push').PushDeliveryStatus,
): string {
  if (!status?.eligible && status?.lastOutcome !== 'waiting-for-storage')
    return 'No eligible alerts recorded for this browser since the daemon started.';
  const last =
    status.lastOutcome === 'accepted'
      ? 'Push service accepted the last alert; device display is not confirmed.'
      : status.lastOutcome === 'viewed'
        ? 'Last alert was already received by your visible conversation.'
        : status.lastOutcome === 'waiting-for-storage'
          ? 'Notification storage is unavailable; pending attention will be checked again.'
        : status.lastOutcome === 'waiting-for-view'
          ? 'Waiting briefly for your visible conversation to receive the alert.'
          : status.lastOutcome === 'stale'
            ? 'Last alert no longer required attention before delivery.'
            : status.lastOutcome === 'rejected'
              ? `Push service rejected the last alert${status.lastStatus ? ` (HTTP ${status.lastStatus})` : ''}.`
              : status.lastOutcome === 'transport-error'
                ? 'Could not reach the push service for the last alert.'
                : status.lastOutcome === 'expired'
                  ? 'The last alert or browser authorization expired.'
                  : 'Last alert could not be delivered.';
  return `${last} Accepted: ${status.sent}; viewed: ${status.suppressed}; failed: ${status.failed}.`;
}
