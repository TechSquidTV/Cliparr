/*
 * Bars animation adapted from https://github.com/starc007/ui-components
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
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utilities";

interface BarsLoaderProps {
  size?: number;
  label?: string;
  showLabel?: boolean;
  className?: string;
}

export function BarsLoader({
  size = 32,
  label = "Loading",
  showLabel = false,
  className,
}: BarsLoaderProps) {
  const reduceMotion = useReducedMotion();

  return (
    <span
      role="status"
      className={cn(
        "inline-flex flex-col items-center justify-center gap-2 text-center text-xs",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size, gap: size * 0.1 }}
      >
        {[0, 1, 2, 3].map((index) => (
          <motion.span
            key={`${index}-${Boolean(reduceMotion)}`}
            className="rounded-full bg-current"
            style={{ width: size * 0.16, height: size, originY: 1 }}
            animate={
              reduceMotion
                ? { opacity: [0.4, 1, 0.4] }
                : { scaleY: [0.3, 1, 0.3] }
            }
            transition={{
              duration: reduceMotion ? 1.4 : 1,
              ease: "easeInOut",
              repeat: Infinity,
              delay: index * 0.12,
            }}
          />
        ))}
      </span>
      <span className={showLabel ? "max-w-64 text-balance" : "sr-only"}>
        {label}
      </span>
    </span>
  );
}
