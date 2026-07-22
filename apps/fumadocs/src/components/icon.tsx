import {
  Add01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowRightIcon,
  BookOpen01Icon,
  Cancel01Icon,
  ClipboardIcon,
  Copy01Icon,
  ExternalLinkIcon,
  FileQuestionMarkIcon,
  HeartIcon,
  Home01Icon,
  Moon02Icon,
  PackageDeliveredIcon,
  RefreshIcon,
  Search01Icon,
  SecurityCheckIcon,
  Shield01Icon,
  ShieldQuestionMarkIcon,
  Sun03Icon,
  TerminalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

export type AppIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function icon(iconData: IconData) {
  return function AppIcon({ size = 16, strokeWidth = 1.8, ...props }: AppIconProps) {
    return <HugeiconsIcon icon={iconData} size={size} strokeWidth={strokeWidth} {...props} />;
  };
}

export const ArrowRight = icon(ArrowRightIcon);
export const ChevronLeft = icon(ArrowLeft01Icon);
export const ChevronRight = icon(ArrowRight01Icon);
export const ChevronDown = icon(ArrowDown01Icon);
export const Check = icon(Tick02Icon);
export const Copy = icon(Copy01Icon);
export const Clipboard = icon(ClipboardIcon);
export const Terminal = icon(TerminalIcon);
export const Moon = icon(Moon02Icon);
export const Sun = icon(Sun03Icon);
export const ExternalLink = icon(ExternalLinkIcon);
export const PackageCheck = icon(PackageDeliveredIcon);
export const ShieldCheck = icon(Shield01Icon);
export const VerifiedShield = icon(SecurityCheckIcon);
export const ShieldQuestion = icon(ShieldQuestionMarkIcon);
export const RefreshCw = icon(RefreshIcon);
export const X = icon(Cancel01Icon);
export const BookOpen = icon(BookOpen01Icon);
export const FileQuestion = icon(FileQuestionMarkIcon);
export const Heart = icon(HeartIcon);
export const Home = icon(Home01Icon);
export const Search = icon(Search01Icon);
export const TriangleAlert = icon(Alert02Icon);
export const Plus = icon(Add01Icon);
