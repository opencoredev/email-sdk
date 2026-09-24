import { Banner } from "fumadocs-ui/components/banner";
import posthog from "posthog-js";
import type { MouseEvent } from "react";

const SOCIAL_SDK_URL =
  "https://social-sdk.dev/?utm_source=email-sdk.dev&utm_medium=banner&utm_campaign=social-sdk-launch";

const promo = { project: "social-sdk", placement: "banner" };

// Fumadocs owns the close button, so catch its click as it bubbles.
function onBannerClick(event: MouseEvent<HTMLDivElement>) {
  if (event.target instanceof Element && event.target.closest("button"))
    posthog.capture("cross_promo_dismissed", promo);
}

export function LaunchBanner() {
  return (
    <Banner
      id="social-sdk-launch"
      height="2.5rem"
      onClick={onBannerClick}
      className="ps-3 pe-10 text-xs sm:text-sm"
    >
      <a
        href={SOCIAL_SDK_URL}
        target="_blank"
        rel="noopener"
        className="truncate text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        onClick={() => posthog.capture("cross_promo_clicked", promo)}
      >
        <span className="hidden sm:inline">Hey, Leo here 👋 </span>I just launched{" "}
        <span className="font-semibold text-fd-foreground underline underline-offset-4">
          Social SDK
        </span>
        <span className="hidden sm:inline">, my new open source project</span>. Come check it out →
      </a>
    </Banner>
  );
}
