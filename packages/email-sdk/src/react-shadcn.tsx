import {
  createContext,
  useContext,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

export type ShadcnEmailTheme = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  radius: number;
  fontFamily: string;
};

export type ShadcnEmailThemeInput = Partial<ShadcnEmailTheme> & {
  mode?: "light" | "dark";
};

const lightTheme: ShadcnEmailTheme = {
  background: "#fafafa",
  foreground: "#18181b",
  card: "#ffffff",
  cardForeground: "#18181b",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  muted: "#f4f4f5",
  mutedForeground: "#71717a",
  border: "#e4e4e7",
  radius: 8,
  fontFamily: "Arial, Helvetica, sans-serif",
};

const darkTheme: ShadcnEmailTheme = {
  background: "#09090b",
  foreground: "#fafafa",
  card: "#18181b",
  cardForeground: "#fafafa",
  primary: "#fafafa",
  primaryForeground: "#18181b",
  muted: "#27272a",
  mutedForeground: "#a1a1aa",
  border: "#3f3f46",
  radius: 8,
  fontFamily: "Arial, Helvetica, sans-serif",
};

export function createShadcnEmailTheme(input: ShadcnEmailThemeInput = {}): ShadcnEmailTheme {
  const { mode = "light", ...overrides } = input;
  return {
    ...(mode === "dark" ? darkTheme : lightTheme),
    ...overrides,
  };
}

const ThemeContext = createContext<ShadcnEmailTheme>(lightTheme);

export type ShadcnEmailProps = ComponentPropsWithoutRef<"html"> & {
  children: ReactNode;
  preview?: string;
  theme?: "light" | "dark" | ShadcnEmailThemeInput;
  bodyStyle?: CSSProperties;
};

export function ShadcnEmail({
  children,
  preview,
  theme = "light",
  bodyStyle,
  ...props
}: ShadcnEmailProps) {
  const resolvedTheme = createShadcnEmailTheme(typeof theme === "string" ? { mode: theme } : theme);

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <html lang="en" {...props}>
        <head>
          <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
          <meta content="width=device-width" name="viewport" />
        </head>
        <body
          style={{
            backgroundColor: resolvedTheme.background,
            color: resolvedTheme.foreground,
            fontFamily: resolvedTheme.fontFamily,
            margin: 0,
            padding: "32px 16px",
            ...bodyStyle,
          }}
        >
          {preview ? (
            <div
              style={{
                display: "none",
                fontSize: "1px",
                lineHeight: "1px",
                maxHeight: 0,
                maxWidth: 0,
                opacity: 0,
                overflow: "hidden",
              }}
            >
              {preview}
            </div>
          ) : null}
          {children}
        </body>
      </html>
    </ThemeContext.Provider>
  );
}

export type EmailCardProps = ComponentPropsWithoutRef<"table">;

export function EmailCard({ children, style, ...props }: EmailCardProps) {
  const theme = useContext(ThemeContext);

  return (
    <table
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius,
        color: theme.cardForeground,
        margin: "0 auto",
        maxWidth: "600px",
        width: "100%",
        ...style,
      }}
      {...props}
    >
      <tbody>
        <tr>
          <td style={{ padding: "32px" }}>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}

export type EmailHeadingProps = ComponentPropsWithoutRef<"h1">;

export function EmailHeading({ style, ...props }: EmailHeadingProps) {
  const theme = useContext(ThemeContext);

  return (
    <h1
      style={{
        color: theme.cardForeground,
        fontSize: "28px",
        fontWeight: 700,
        letterSpacing: "-0.025em",
        lineHeight: "36px",
        margin: "0 0 16px",
        ...style,
      }}
      {...props}
    />
  );
}

export type EmailTextProps = ComponentPropsWithoutRef<"p"> & {
  muted?: boolean;
};

export function EmailText({ muted = false, style, ...props }: EmailTextProps) {
  const theme = useContext(ThemeContext);

  return (
    <p
      style={{
        color: muted ? theme.mutedForeground : theme.cardForeground,
        fontSize: "16px",
        lineHeight: "24px",
        margin: "0 0 20px",
        ...style,
      }}
      {...props}
    />
  );
}

export type EmailButtonProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
  variant?: "default" | "outline";
};

export function EmailButton({ variant = "default", style, ...props }: EmailButtonProps) {
  const theme = useContext(ThemeContext);
  const outline = variant === "outline";

  return (
    <a
      style={{
        backgroundColor: outline ? "transparent" : theme.primary,
        border: `1px solid ${outline ? theme.border : theme.primary}`,
        borderRadius: theme.radius,
        color: outline ? theme.cardForeground : theme.primaryForeground,
        display: "inline-block",
        fontSize: "14px",
        fontWeight: 600,
        lineHeight: "20px",
        padding: "10px 16px",
        textDecoration: "none",
        ...style,
      }}
      {...props}
    />
  );
}

export type EmailSeparatorProps = ComponentPropsWithoutRef<"hr">;

export function EmailSeparator({ style, ...props }: EmailSeparatorProps) {
  const theme = useContext(ThemeContext);

  return (
    <hr
      style={{
        border: 0,
        borderTop: `1px solid ${theme.border}`,
        margin: "24px 0",
        ...style,
      }}
      {...props}
    />
  );
}
