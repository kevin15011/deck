import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { runDaemonCli } from "../../daemon-commands";
import { MenuList } from "../components/menu-list";

export async function stopDaemonForInstall(): Promise<void> {
  let message = "";
  const code = await runDaemonCli({ action: "stop", json: false }, {
    write: () => {}, writeErr: (text) => { message += text; },
  });
  if (code !== 0) throw new Error(message.trim() || "Daemon shutdown could not be confirmed.");
}

export function RunnerMutationDeferredScreen({ onRetry, onBack, stopDaemon = stopDaemonForInstall }: {
  onRetry: () => void; onBack: () => void; stopDaemon?: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  useInput((input, key) => {
    if (busy.current) return;
    if (key.escape) { onBack(); return; }
    if (key.upArrow || key.downArrow || input === "j" || input === "k") { setCursor(value => 1 - value); return; }
    if (!key.return && input !== "\r" && input !== "\n") return;
    if (cursor === 1) { onBack(); return; }
    if (!confirm) { setConfirm(true); return; }
    busy.current = true;
    setStopping(true);
    setError(undefined);
    void stopDaemon().then(onRetry).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Daemon shutdown could not be confirmed.");
    }).finally(() => { busy.current = false; setStopping(false); });
  });
  return <Box flexDirection="column">
    <Text bold color="yellow">Runner installation deferred</Text>
    <Text>Open Deck sessions block runner changes, even between turns. Daemon activity may also be unknown.</Text>
    <Text>No installation actions ran. Close sessions or stop the Deck daemon before retrying.</Text>
    {confirm ? <Text color="yellow">Stop the Deck daemon? All open Deck sessions will stop. Installation will retry automatically.</Text> : null}
    {error ? <Text color="red">{error}</Text> : null}
    {stopping ? <Text>Stopping Deck daemon…</Text> : <MenuList cursor={cursor} items={[
      { label: confirm ? "Confirm stop and retry" : "Stop Deck daemon and retry" }, { label: "Back" },
    ]} />}
  </Box>;
}
