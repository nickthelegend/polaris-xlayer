import { Text as RNText, StyleProp, TextProps, TextStyle } from "react-native";

import { ink, palette, type } from "../theme";

type Variant = keyof typeof type;

type Props = TextProps & {
  variant?: Variant;
  /** Named tints, so a screen cannot invent a fourteenth shade of nearly-white. */
  tone?: "default" | "soft" | "label" | "faint" | "lime" | "accent" | "danger";
  style?: StyleProp<TextStyle>;
};

const tones = {
  default: palette.foreground,
  soft: ink.soft,
  label: ink.label,
  faint: ink.faint,
  lime: palette.primary,
  accent: palette.accent,
  danger: palette.destructive,
} as const;

export function Text({ variant = "body", tone = "default", style, ...rest }: Props) {
  return (
    <RNText
      style={[type[variant], { color: tones[tone] }, style]}
      {...rest}
    />
  );
}

/** The quiet uppercase label that names a figure. Always above it, never beside. */
export function Label({ style, ...rest }: Omit<Props, "variant" | "tone">) {
  return <Text variant="label" tone="label" style={style} {...rest} />;
}

export function Mono({ tone = "soft", style, ...rest }: Omit<Props, "variant">) {
  return <Text variant="mono" tone={tone} style={style} {...rest} />;
}
