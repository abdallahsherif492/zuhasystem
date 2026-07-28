"use client";

import { WalkthroughProvider } from "@/components/walkthrough/walkthrough-provider";
import { WalkthroughButton } from "@/components/walkthrough/walkthrough-button";

export function WalkthroughWrapper({ children }: { children: React.ReactNode }) {
  return (
    <WalkthroughProvider>
      {children}
      <WalkthroughButton />
    </WalkthroughProvider>
  );
}
