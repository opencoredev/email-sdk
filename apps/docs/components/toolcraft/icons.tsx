/**
 * The icons the workflow viewer and its Toolcraft components draw, from the Hugeicons set the docs
 * already ship. Named after the lucide-react icons the original port used.
 */
import {
  Calendar03Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  FlashIcon,
  GitBranchIcon,
  HourglassIcon,
  Mail01Icon,
  Maximize01Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  Scissor01Icon,
  SourceCodeIcon,
  Tick02Icon,
  UnavailableIcon,
  WorkflowSquare03Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function icon(iconData: IconData) {
  return function ToolcraftIcon({ size = 16, strokeWidth = 1.8, ...props }: IconProps) {
    return <HugeiconsIcon icon={iconData} size={size} strokeWidth={strokeWidth} {...props} />;
  };
}

export const Ban = icon(UnavailableIcon);

export const Braces = icon(SourceCodeIcon);

export const CalendarClock = icon(Calendar03Icon);

export const Check = icon(Tick02Icon);

export const CircleCheck = icon(CheckmarkCircle02Icon);

export const CircleX = icon(CancelCircleIcon);

export const GitBranch = icon(GitBranchIcon);

export const Hourglass = icon(HourglassIcon);

export const Mail = icon(Mail01Icon);

export const Maximize = icon(Maximize01Icon);

export const Pause = icon(PauseIcon);

export const Play = icon(PlayIcon);

export const Scissors = icon(Scissor01Icon);

export const SkipBack = icon(PreviousIcon);

export const SkipForward = icon(NextIcon);

export const Workflow = icon(WorkflowSquare03Icon);

export const Zap = icon(FlashIcon);

export const ZoomIn = icon(ZoomInAreaIcon);

export const ZoomOut = icon(ZoomOutAreaIcon);
