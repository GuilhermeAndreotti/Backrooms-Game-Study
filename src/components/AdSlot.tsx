import { useEffect, useRef } from "react";

type AdPlacement = "menu" | "pause";

const slots: Record<AdPlacement, string | undefined> = {
  menu: import.meta.env.VITE_ADSENSE_MENU_SLOT,
  pause: import.meta.env.VITE_ADSENSE_PAUSE_SLOT,
};

interface AdSlotProps {
  placement: AdPlacement;
  className?: string;
}

/** Renders an AdSense slot only when its publisher and placement IDs are configured. */
export function AdSlot({ placement, className = "" }: AdSlotProps) {
  const initialized = useRef(false);
  const client = import.meta.env.VITE_ADSENSE_CLIENT?.trim();
  const slot = slots[placement]?.trim();

  useEffect(() => {
    if (!client || !slot || initialized.current) return;
    initialized.current = true;

    if (!document.getElementById("adsense-script")) {
      const script = document.createElement("script");
      script.id = "adsense-script";
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blockers and unapproved sites must not interrupt the game UI.
    }
  }, [client, slot]);

  if (!client || !slot) return null;

  return (
    <aside className={`w-full max-w-[728px] ${className}`} aria-label="Publicidade">
      <ins
        className="adsbygoogle block min-h-[90px]"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
