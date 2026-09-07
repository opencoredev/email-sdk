import type { ThemeRegistration } from "shiki";

// Syntax colors mirror the landing page's code panel (Paper design):
// violet keywords, cyan identifiers, green strings, parchment punctuation.
const dark = {
  bg: "#131310",
  fg: "#eceae3",
  muted: "#8f8d85",
  keyword: "#c6a7f7",
  identifier: "#96ddf5",
  string: "#93d6a8",
  gold: "#c9a227",
};

const light = {
  bg: "#faf8f2",
  fg: "#14130f",
  muted: "#6b6960",
  keyword: "#6d3fb8",
  identifier: "#0b6f8f",
  string: "#2a7a45",
  gold: "#7f6410",
};

function buildTheme(name: string, type: "dark" | "light", c: typeof dark): ThemeRegistration {
  return {
    name,
    type,
    colors: {
      "editor.background": c.bg,
      "editor.foreground": c.fg,
    },
    settings: [
      { settings: { background: c.bg, foreground: c.fg } },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.muted, fontStyle: "italic" },
      },
      {
        scope: [
          "keyword",
          "storage.type",
          "storage.modifier",
          "keyword.control",
          "keyword.operator.new",
          "keyword.operator.expression",
          "keyword.other.important",
          "constant.language",
          "variable.language.this",
        ],
        settings: { foreground: c.keyword },
      },
      {
        scope: [
          "variable",
          "variable.other.readwrite",
          "variable.other.object",
          "variable.other.constant",
          "variable.parameter",
          "entity.name.function",
          "support.function",
          "support.class",
          "entity.name.type",
          "entity.name.class",
          "entity.other.attribute-name",
          "entity.name.tag",
          "meta.object-literal.key",
          "support.type.property-name",
          "support.type.property-name.json",
        ],
        settings: { foreground: c.identifier },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "string.template",
          "punctuation.definition.string",
          "constant.other.symbol",
          "constant.character",
        ],
        settings: { foreground: c.string },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean", "constant.language.null"],
        settings: { foreground: c.gold },
      },
      {
        scope: [
          "punctuation",
          "meta.brace",
          "keyword.operator",
          "keyword.operator.assignment",
          "keyword.operator.type",
          "punctuation.separator",
          "punctuation.terminator",
          "punctuation.accessor",
        ],
        settings: { foreground: c.fg },
      },
      {
        scope: ["markup.heading", "entity.name.section"],
        settings: { foreground: c.fg, fontStyle: "bold" },
      },
      {
        scope: ["markup.inserted"],
        settings: { foreground: c.string },
      },
      {
        scope: ["markup.deleted"],
        settings: { foreground: "#e08a8a" },
      },
    ],
  };
}

export const emailSdkDark = buildTheme("email-sdk-dark", "dark", dark);
export const emailSdkLight = buildTheme("email-sdk-light", "light", light);
