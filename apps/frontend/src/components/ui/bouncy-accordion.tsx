/*
 * Bouncy Accordion adapted from https://beui.dev/r/bouncy-accordion/raw
 * MIT License — Copyright (c) 2026 Saurabh Chauhan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { cliparrMotionTransitions } from "@/lib/motionPresets";
import { cn } from "@/lib/utilities";

interface BouncyAccordionItem {
  id: string;
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface BouncyAccordionProperties {
  items: readonly BouncyAccordionItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  collapsible?: boolean;
  className?: string;
}

const rowTransition = {
  type: "spring",
  duration: 0.55,
  bounce: 0.38,
} satisfies Transition;

const contentOpenTransition = {
  type: "spring",
  duration: 0.58,
  bounce: 0.32,
} satisfies Transition;

const contentCloseTransition = {
  type: "spring",
  duration: 0.46,
  bounce: 0.26,
} satisfies Transition;

const chevronTransition = {
  type: "spring",
  duration: 0.42,
  bounce: 0.28,
} satisfies Transition;

export function BouncyAccordion({
  items,
  value,
  defaultValue = null,
  onValueChange,
  collapsible = true,
  className,
}: BouncyAccordionProperties) {
  const reducedMotion = useReducedMotion();
  const baseId = useId();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeValue = value === undefined ? internalValue : value;
  const activeIndex = items.findIndex((item) => item.id === activeValue);

  function toggleItem(id: string) {
    if (activeValue === id && !collapsible) {
      return;
    }
    const nextValue = activeValue === id ? null : id;
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }

  return (
    <div className={cn("w-full min-w-0", className)}>
      {items.map((item, index) => {
        const open = item.id === activeValue;
        const contentTransition = open
          ? contentOpenTransition
          : contentCloseTransition;
        const previousIsOpen = activeIndex === index - 1;
        const startsGroup = open || index === 0 || previousIsOpen;
        const endsGroup =
          open || index === items.length - 1 || activeIndex === index + 1;
        const contentId = `${baseId}-${item.id}-content`;
        const triggerId = `${baseId}-${item.id}-trigger`;

        return (
          <motion.div
            key={item.id}
            layout={reducedMotion ? false : "position"}
            initial={false}
            transition={reducedMotion ? { duration: 0 } : rowTransition}
            data-state={open ? "open" : "closed"}
            className={cn(
              "border border-border bg-card text-card-foreground",
              startsGroup ? "rounded-t-md" : "border-t-0",
              endsGroup && "rounded-b-md",
              index > 0 && (open || previousIsOpen) && "mt-3",
              item.disabled && "opacity-60",
            )}
          >
            <button
              id={triggerId}
              type="button"
              disabled={item.disabled}
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => toggleItem(item.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {item.icon && (
                <span
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                >
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">{item.title}</span>
              <motion.span
                aria-hidden="true"
                initial={false}
                animate={{ rotate: open ? 180 : 0 }}
                transition={reducedMotion ? { duration: 0 } : chevronTransition}
                className="shrink-0 text-muted-foreground"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>
            <motion.div
              id={contentId}
              role="region"
              aria-labelledby={triggerId}
              aria-hidden={!open}
              inert={!open}
              initial={false}
              animate={{ height: open ? "auto" : 0 }}
              transition={reducedMotion ? { duration: 0 } : contentTransition}
              className="overflow-hidden"
            >
              <motion.div
                initial={false}
                animate={{ opacity: open ? 1 : 0 }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : cliparrMotionTransitions.fast
                }
                className="px-3 pb-3"
              >
                {item.description}
              </motion.div>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}
