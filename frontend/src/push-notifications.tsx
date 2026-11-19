type PushDeliveryStatus = {eligible:number;sent:number;suppressed:number;failed:number;lastOutcome?:string;lastStatus?:number};
import {gsap} from 'gsap';
import { HttpError } from './api';
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
function usesPushKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options.applicationServerKey;
  return !!key && btoa(String.fromCharCode(...new Uint8Array(key)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '') === publicKey;
}
/** An unrecognized device must replace a surviving browser subscription, never claim it. */
export async function reconcilePushSubscription(
  manager: PushManager,
  publicKey: string,
  alreadyEnabled: boolean,
): Promise<PushSubscription> {
  const existing = await manager.getSubscription();
  if (existing) {
    if (alreadyEnabled && usesPushKey(existing, publicKey)) return existing;
    if (!(await existing.unsubscribe()))
      throw new Error('push-subscription-replacement-failed');
  }
  return manager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
}
type PushStatus = { enabled: boolean; publicKey: string; delivery?: PushDeliveryStatus };
type PushStep = 'permission' | 'status' | 'host' | 'registration' | 'enrollment' | 'worker' | 'subscription';

function problemCode(error: unknown) {
  const problem = error instanceof HttpError ? error.problem : undefined;
  return typeof problem === 'object' && problem !== null && 'code' in problem
    ? problem.code
    : undefined;
}

function pushFailure(error: unknown, step: PushStep): string {
  if (step === 'permission')
    return 'Could not check notification permission. Check this site’s browser settings and try again.';
  if (step === 'worker')
    return 'Deck’s notification service worker could not start. Reload Deck and try again.';
  if (step === 'subscription')
    return 'The browser’s push service could not update the subscription. Check your browser and network settings, then try again.';
  switch (problemCode(error)) {
    case 'device-required':
      if (step === 'enrollment')
        return 'Device access ended. Reauthorize this browser through Deck before enabling notifications.';
      return 'Deck needs device authorization for this browser. Select Enable notifications to try enrolling it.';
    case 'device-revoked':
      return 'Device access ended. Reauthorize this browser through Deck before enabling notifications.';
    case 'session_required':
      return 'Open Deck from the launcher or use an authorized pairing link, then refresh notification status.';
    case 'request-forbidden':
    case 'host_denied':
    case 'origin_denied':
    case 'fetch_site_denied':
      return 'Deck rejected notification access from this address. Open Deck using the launcher or your authorized pairing address.';
    case 'ownership':
      return 'The current Deck host cannot enroll this browser. Open Deck from the host that owns this device identity.';
    case 'device-store-unavailable':
      return 'Deck’s browser-device storage is unavailable. Check the Deck host, then try again.';
    case 'push-history-unavailable':
      return 'Deck could not take ownership of its original history. Check the history adoption error on the Deck host, then restart Deck and retry.';
    case 'push-unavailable':
      return 'This Deck host is missing notification configuration. Check how Deck was started, then retry.';
    case 'notification-storage-unavailable':
      return 'Deck’s notification storage is unavailable. Check the Deck host, then try again.';
    case 'push-provider-unsupported':
      return 'Deck does not support this browser’s push provider. Try notifications in another supported browser.';
    case 'push-subscription-invalid':
    case 'push-subscription-expired':
      return 'Deck rejected the browser’s subscription. Reload Deck and enable notifications again.';
    case 'push-subscription-limit':
      return 'This Deck host has reached its subscription limit. Disable notifications on an unused browser and try again.';
    case 'push-subscription-owned':
      return 'Deck rejected a subscription owned by another device. Use Disable notifications if offered, then enable notifications again.';
  }
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403)
      return 'Deck denied notification access. Reopen Deck with an authorized browser session and try again.';
    if (step === 'status')
      return `Deck could not check notification status (HTTP ${error.status}). Check the host and refresh status.`;
    if (step === 'registration')
      return `Deck could not register the browser’s subscription (HTTP ${error.status}). Check the host and try enabling notifications again.`;
    return `Deck could not read or update notification settings (HTTP ${error.status}). Check the host and try again.`;
  }
  if (error instanceof Error && error.message.startsWith('Connection lost.'))
    return 'Could not reach Deck to check or update notifications. Check your connection to Deck and try again.';
  return 'Deck returned an invalid notification response. Reload Deck and try again.';
}

async function pushStatus(api: Api): Promise<PushStatus> {
  const status = await api('/api/push');
  if (typeof status?.enabled !== 'boolean' || typeof status.publicKey !== 'string' || !status.publicKey)
    throw new Error('Invalid push status');
  return status;
}

async function worker() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const start = async () => {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      return registration.active ? registration : navigator.serviceWorker.ready;
    };
    return await Promise.race([
      start(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Notification worker timed out')), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
        PushDeliveryStatus
      >(),
    [denied, setDenied] = useState(
      !hint && Notification.permission === 'denied',
    );
  const [approvalActions,setApprovalActions]=useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const operation = useRef(false);
  const refreshVersion = useRef(0);
  const refresh = async () => {
    if (hint || operation.current) return;
    const version = ++refreshVersion.current;
    const current = () => version === refreshVersion.current;
    const permission = Notification.permission;
    setDenied(permission === 'denied');
    let step: PushStep = 'status';
    try {
      const status = await pushStatus(api);
      if (!current()) return;
      setDelivery(status.delivery);
      setRegistered(status.enabled);
      let subscription: PushSubscription | null = null;
      if (status.enabled && permission === 'granted') {
        step = 'worker';
        const registration = await worker();
        step = 'subscription';
        subscription = await registration.pushManager.getSubscription();
      } else if (status.enabled) {
        await api('/api/push', { method: 'DELETE' });
      }
      if (!current()) return;
      setRegistered(status.enabled && permission === 'granted');
      const connected = !!subscription && usesPushKey(subscription, status.publicKey);
      setEnabled(connected);
      setStatusUnavailable(false);
      setMessage(status.enabled && permission === 'granted' && !connected
        ? 'Reconnect notifications for this browser.'
        : '');
    } catch (error) {
      if (!current()) return;
      setEnabled(false);
      setStatusUnavailable(true);
      if (step === 'status') setDelivery(undefined);
      setMessage(pushFailure(error, step));
    } finally {
      if (current()) setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    void readApprovalNotificationPreference().then(value => {
      if (active) setApprovalActions(value);
    });
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      refreshVersion.current++;
      window.removeEventListener('focus', focus);
    };
  }, [api]);
  function beginChange() {
    operation.current = true;
    refreshVersion.current++;
    setBusy(true);
    setMessage('');
  }
  function finishChange() {
    operation.current = false;
    setBusy(false);
  }
  async function enable() {
    if (operation.current) return;
    beginChange();
    let step: PushStep = 'permission';
    try {
      // Request permission in the click, before any awaited host or worker setup.
      const result = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      setDenied(result === 'denied');
      if (result !== 'granted') {
        setMessage(result === 'denied'
          ? 'Notifications are blocked. Allow them in this site’s browser settings, then retry.'
          : 'Permission was not granted. You can enable notifications later.');
        return;
      }
      step = 'status';
      let status: PushStatus;
      try {
        status = await pushStatus(api);
      } catch (error) {
        if (problemCode(error) !== 'device-required') throw error;
        // Launcher authentication and browser-device authorization are separate.
        step = 'enrollment';
        await api('/api/browser-device', {
          method: 'POST',
          body: JSON.stringify({ remember: true }),
        });
        step = 'status';
        status = await pushStatus(api);
      }
      setRegistered(status.enabled);
      setStatusUnavailable(false);
      step = 'worker';
      const registration = await worker();
      step = 'subscription';
      const subscription = await reconcilePushSubscription(
        registration.pushManager,
        status.publicKey,
        status.enabled,
      );
      step = 'registration';
      // Keep the browser subscription if the request outcome is unknown. A retry
      // reconciles it using the host's current registration state.
      await api('/api/push', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      setRegistered(true);
      setEnabled(true);
      setMessage('Notifications are on for this browser.');
    } catch (error) {
      if (step === 'status') setStatusUnavailable(true);
      setMessage(pushFailure(error, step));
    } finally {
      finishChange();
    }
  }
  async function disable() {
    if (operation.current) return;
    beginChange();
    let step: PushStep = 'host';
    try {
      await api('/api/push', { method: 'DELETE' });
      setRegistered(false);
      setEnabled(false);
      setStatusUnavailable(false);
      setDelivery(undefined);
      step = 'subscription';
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && !(await subscription.unsubscribe()))
        throw new Error('Browser unsubscribe failed');
      setMessage('Notifications are off for this browser.');
    } catch (error) {
      setMessage(pushFailure(error, step));
    } finally {
      finishChange();
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
  const statusLabel = loading ? 'Checking this browser…'
    : denied ? 'Blocked in browser settings'
    : statusUnavailable ? 'Status unavailable'
    : enabled ? 'On for this browser'
    : registered ? 'Reconnect needed'
    : 'Off for this browser';
  return {hint,enabled,registered,busy,loading,message,delivery,denied,statusLabel,enable,disable,refresh,approvalActions,changeApprovalActions};
}
export function NotificationsDialog({settings,onClose}:{settings:ReturnType<typeof usePushNotifications>;onClose:()=>void}) {
  const {hint,enabled,registered,busy,loading,message,delivery,denied,statusLabel,enable,disable,refresh,approvalActions,changeApprovalActions}=settings;
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{const node=dialog.current!;const previous=document.activeElement as HTMLElement|null;node.showModal();const media=matchMedia('(prefers-reduced-motion: reduce)');if(!media.matches)gsap.fromTo(node,{opacity:.5,y:6},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});const settle=()=>{if(media.matches){gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity,transform'});}};media.addEventListener('change',settle);return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);node.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
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
          this browser authorized for Deck for up to 180 days.
        </p>
        {hint ? (
          <p role="status">{hint}</p>
        ) : (
          <>
            <p role="status">
              {statusLabel}
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
            <p id="notification-approvals-help">Allow once and Deny apply to normal-risk tool requests on supported Chromium browsers. Native command and file approvals open Deck for review.</p>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {!hint && (
          <div className="push-delivery">
            <p role="status">{pushDeliveryText(delivery)}</p>
            <button
              type="button"
              className="quiet"
              disabled={busy}
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
  status?: PushDeliveryStatus,
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
