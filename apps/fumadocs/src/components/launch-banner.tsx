import { Banner } from "fumadocs-ui/components/banner";
import posthog from "posthog-js";
import type { MouseEvent } from "react";

// The X launch post for gradients.sh.
const LAUNCH_POST_URL = "__X_POST_URL__";

const promo = { project: "gradients-sh", placement: "banner" };

// Fumadocs owns the close button, so catch its click as it bubbles.
function onBannerClick(event: MouseEvent<HTMLDivElement>) {
  if (event.target instanceof Element && event.target.closest("button"))
    posthog.capture("cross_promo_dismissed", promo);
}

export function LaunchBanner() {
  return (
    <Banner
      id="gradients-sh-launch"
      height="2.5rem"
      onClick={onBannerClick}
      className="ps-3 pe-10 text-xs sm:text-sm"
    >
      <a
        href={LAUNCH_POST_URL}
        target="_blank"
        rel="noopener"
        className="truncate text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        onClick={() => posthog.capture("cross_promo_clicked", promo)}
      >
        <span className="hidden sm:inline">Hey, Leo here 👋 </span>I just launched{" "}
        <span className="font-semibold text-fd-foreground underline underline-offset-4">
          gradients.sh
        </span>
        <span className="hidden sm:inline">, animated gradient backgrounds for React</span>. Come
        check it out →
      </a>
    </Banner>
  );
}
