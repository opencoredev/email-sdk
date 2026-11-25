import { defineComponents } from "blume";

import AdapterCapabilitySupport from "./components/mdx/AdapterCapabilitySupport.astro";
import AdapterFieldSupport from "./components/mdx/AdapterFieldSupport.astro";
import AdapterVerification from "./components/mdx/AdapterVerification.astro";
import CommunityPluginRegistry from "./components/mdx/CommunityPluginRegistry.astro";
import EmailExampleGallery from "./components/mdx/EmailExampleGallery.astro";
import ProviderBadge from "./components/mdx/ProviderBadge.astro";
import ProviderGrid from "./components/mdx/ProviderGrid.astro";
import SponsorSpotlight from "./components/mdx/SponsorSpotlight.astro";
import WorkflowViewer from "./components/mdx/WorkflowViewer.astro";

// Data-driven docs components. The static ones render to HTML at build time;
// AdapterPricing, PackageInstallTabs, and EmailExample are islands in
// islands/ because they filter, switch tabs, or toggle themes in the browser.
// WorkflowViewer builds its data at render time and hydrates a React child.
export default defineComponents({
  mdx: {
    AdapterCapabilitySupport,
    AdapterFieldSupport,
    AdapterVerification,
    CommunityPluginRegistry,
    EmailExampleGallery,
    ProviderBadge,
    ProviderGrid,
    SponsorSpotlight,
    WorkflowViewer,
  },
});
