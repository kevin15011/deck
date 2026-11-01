import { drainNativeCapture } from '../capture-drain';

const path = process.env.DECK_TEST_FIFO_PATH;
const boundary = process.env.DECK_TEST_FIFO_BOUNDARY;
if (!path || !['timeout', 'cancel'].includes(boundary!)) throw new Error('Invalid FIFO probe arguments');
const controller = new AbortController();
// Cancellation must fire after receipt inspection starts, not before disposal.
const cancellation = boundary === 'cancel' ? setTimeout(() => controller.abort(), 40) : undefined;
try {
  const outcome = await drainNativeCapture(
    { path, nonce: 'fifo-probe', taskId: 'fifo-task' }, 'fifo-session', async () => {},
    controller.signal, boundary === 'timeout' ? 40 : 5000,
  );
  console.log(JSON.stringify(outcome));
} finally { clearTimeout(cancellation); }
