import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { styles } from "@/config/theme";

/**
 * Qontinui-themed card components
 * Extends the base Card component with dark theme styling
 */

interface QontinuiCardProps extends React.ComponentProps<typeof Card> {
  /**
   * Whether the card is selected
   */
  selected?: boolean;
  /**
   * Whether the card should have hover effects
   */
  hoverable?: boolean;
}

export function QontinuiCard({
  selected = false,
  hoverable = true,
  className,
  ...props
}: QontinuiCardProps) {
  return (
    <Card
      className={cn(
        selected
          ? styles.cardSelected
          : hoverable
            ? styles.cardHover
            : styles.card,
        className
      )}
      {...props}
    />
  );
}

/**
 * Themed card header with white text
 */
export function QontinuiCardHeader({
  className,
  ...props
}: React.ComponentProps<typeof CardHeader>) {
  return (
    <CardHeader className={cn(styles.text.primary, className)} {...props} />
  );
}

/**
 * Themed card title with white text
 */
export function QontinuiCardTitle({
  className,
  ...props
}: React.ComponentProps<typeof CardTitle>) {
  return (
    <CardTitle className={cn(styles.text.primary, className)} {...props} />
  );
}

/**
 * Themed card description with secondary text color
 */
export function QontinuiCardDescription({
  className,
  ...props
}: React.ComponentProps<typeof CardDescription>) {
  return (
    <CardDescription
      className={cn(styles.text.secondary, className)}
      {...props}
    />
  );
}

/**
 * Themed card content
 */
export function QontinuiCardContent({
  className,
  ...props
}: React.ComponentProps<typeof CardContent>) {
  return (
    <CardContent className={cn(styles.text.secondary, className)} {...props} />
  );
}

/**
 * Themed card footer
 */
export function QontinuiCardFooter({
  className,
  ...props
}: React.ComponentProps<typeof CardFooter>) {
  return <CardFooter className={className} {...props} />;
}

/**
 * Themed card action
 */
export function QontinuiCardAction({
  className,
  ...props
}: React.ComponentProps<typeof CardAction>) {
  return <CardAction className={className} {...props} />;
}

/**
 * Example usage:
 *
 * <QontinuiCard selected={isSelected} hoverable>
 *   <QontinuiCardHeader>
 *     <QontinuiCardTitle>Card Title</QontinuiCardTitle>
 *     <QontinuiCardDescription>Card description</QontinuiCardDescription>
 *   </QontinuiCardHeader>
 *   <QontinuiCardContent>
 *     Card content goes here
 *   </QontinuiCardContent>
 *   <QontinuiCardFooter>
 *     Footer content
 *   </QontinuiCardFooter>
 * </QontinuiCard>
 */
