import { defineMeta } from "blume";

export default defineMeta({
  title: "Error codes",
  icon: "circle-alert",
  pages: [
    "validation-error",
    "adapter-not-found",
    "adapter-error",
    "route-error",
    "all-recipients-failed",
    "middleware-error",
    "aborted",
  ],
});
