import React from "react";
import { Text } from "ink";

const FRAMES = ["|", "/", "-", "\\"];

/** Mount only while work is pending; unmounting releases the animation timer. */
export function ActivityIndicator({ children, ...props }: React.ComponentProps<typeof Text>) {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), 100);
    return () => clearInterval(timer);
  }, []);
  return <Text {...props}>{FRAMES[frame]} {children}</Text>;
}
