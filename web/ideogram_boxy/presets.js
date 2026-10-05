const box = (label, type, bbox, prompt, color, weight = 1, text = "") => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  label,
  type,
  bbox,
  prompt,
  text,
  negativePrompt: "",
  weight,
  color,
  locked: false,
  visible: true,
});

const preset = (dna, guides, overlays, boxes) => ({
  promptDNA: dna,
  guides,
  overlays,
  boxes,
});

export const ASPECTS = {
  "1:1": [1024, 1024],
  "2:3": [832, 1248],
  "3:2": [1248, 832],
  "9:16": [720, 1280],
  "16:9": [1280, 720],
};

export const PRESETS = {
  "Golden Ratio": preset(
    {
      high_level_hint: "A balanced composition organized around a golden-ratio focal point",
      aesthetics: "harmonious, refined, naturally balanced",
      lighting: "directional light supporting the primary focal point",
      medium: "high-detail editorial image",
      composition: "golden ratio placement, controlled negative space, visual flow",
    },
    { vertical: [0.382, 0.618], horizontal: [0.382, 0.618] },
    { goldenSpiral: true, ruleOfThirds: false },
    [
      box("Background", "background", [0.02, 0.02, 0.98, 0.98], "supportive environment with subtle depth", "#64748b", 0.55),
      box("Primary Subject", "object", [0.56, 0.18, 0.91, 0.76], "main subject at the golden-ratio focal point", "#22d3ee", 1.35),
      box("Supporting Element", "foreground", [0.08, 0.48, 0.46, 0.88], "secondary form directing the eye toward the subject", "#f59e0b", 0.75),
    ],
  ),
  "Rule of Thirds": preset(
    {
      high_level_hint: "A clear subject arranged on rule-of-thirds intersections",
      aesthetics: "clean, legible, balanced",
      lighting: "subject-led natural contrast",
      medium: "professional photography",
      composition: "rule of thirds, distinct focal hierarchy, breathing room",
    },
    { vertical: [1 / 3, 2 / 3], horizontal: [1 / 3, 2 / 3] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Environment", "background", [0.02, 0.02, 0.98, 0.98], "contextual scene with uncluttered negative space", "#64748b", 0.55),
      box("Hero", "object", [0.53, 0.16, 0.92, 0.78], "hero subject aligned to the upper-right intersection", "#38bdf8", 1.35),
      box("Counterweight", "foreground", [0.08, 0.60, 0.38, 0.90], "small visual counterweight", "#fb7185", 0.65),
    ],
  ),
  "Archviz Hero": preset(
    {
      high_level_hint: "Hero architectural visualization emphasizing form, approach, and material realism",
      aesthetics: "architectural photography, realistic materials, premium archviz",
      lighting: "natural light, soft atmospheric shadows, believable reflections",
      medium: "photorealistic architectural visualization",
      composition: "leading lines, strong facade hierarchy, human-scale foreground",
    },
    { vertical: [0.22, 0.62], horizontal: [0.66] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Sky and Context", "background", [0.01, 0.01, 0.99, 0.99], "site context, sky, landscape, realistic atmospheric depth", "#64748b", 0.65),
      box("Hero Architecture", "object", [0.16, 0.13, 0.86, 0.76], "signature building facade with realistic materials and crisp detail", "#22d3ee", 1.5),
      box("Approach", "foreground", [0, 0.65, 1, 1], "foreground path and leading lines toward the entrance", "#f59e0b", 0.9),
      box("Human Scale", "object", [0.69, 0.55, 0.78, 0.82], "one subtle human figure for scale", "#a78bfa", 0.5),
    ],
  ),
  "Cinematic Close-Up": preset(
    {
      high_level_hint: "An emotionally focused cinematic close-up",
      aesthetics: "cinematic, intimate, high production value",
      lighting: "dramatic lighting, shaped highlights, rich shadow detail",
      medium: "cinema still with shallow depth of field",
      composition: "strong subject focus, eye-line emphasis, restrained background",
    },
    { vertical: [0.5], horizontal: [0.36] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Defocused World", "background", [0.01, 0.01, 0.99, 0.99], "soft cinematic environment, creamy bokeh, subdued detail", "#64748b", 0.45),
      box("Face", "object", [0.18, 0.07, 0.82, 0.86], "expressive face in close-up, natural skin detail, sharp eyes", "#f472b6", 1.5),
      box("Eye Light", "atmosphere", [0.28, 0.26, 0.72, 0.43], "precise catchlights and shaped highlight across the eyes", "#fde047", 0.8),
      box("Foreground Falloff", "foreground", [0, 0.78, 1, 1], "soft lens falloff and cinematic foreground blur", "#38bdf8", 0.45),
    ],
  ),
  "Luxury Product": preset(
    {
      high_level_hint: "A premium product hero image for a luxury campaign",
      aesthetics: "premium branding, elegant, minimal, polished",
      lighting: "controlled studio lighting, sculpted highlights, soft reflections",
      medium: "high-end commercial photography",
      composition: "clean composition, centered product hierarchy, generous negative space",
    },
    { vertical: [0.5], horizontal: [0.18, 0.78] },
    { goldenSpiral: false, ruleOfThirds: false },
    [
      box("Studio Set", "background", [0.02, 0.02, 0.98, 0.98], "minimal premium set with tonal gradient and clean surface", "#64748b", 0.6),
      box("Hero Product", "product", [0.30, 0.22, 0.70, 0.77], "flawless luxury product, precise edges, premium material finish", "#fbbf24", 1.6),
      box("Brand Mark", "logo", [0.37, 0.08, 0.63, 0.16], "small refined brand mark", "#a78bfa", 0.8),
      box("Surface Reflection", "foreground", [0.22, 0.72, 0.78, 0.91], "subtle controlled reflection beneath product", "#22d3ee", 0.45),
    ],
  ),
  "Fashion Editorial": preset(
    {
      high_level_hint: "A directional fashion editorial layout with confident asymmetry",
      aesthetics: "high fashion, art-directed, sophisticated, contemporary",
      lighting: "editorial key light with sculptural shadow",
      medium: "fashion magazine photography",
      composition: "asymmetric model placement, typographic negative space, long visual lines",
    },
    { vertical: [0.58], horizontal: [0.18, 0.82] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Editorial Set", "background", [0.01, 0.01, 0.99, 0.99], "minimal art-directed set with tactile surfaces", "#64748b", 0.55),
      box("Model", "object", [0.09, 0.06, 0.60, 0.94], "full-length fashion model, expressive pose, garment detail", "#f472b6", 1.5),
      box("Headline", "text", [0.64, 0.16, 0.94, 0.48], "bold editorial typography with generous tracking", "#fbbf24", 1, "NEW FORM"),
      box("Accent", "foreground", [0.58, 0.69, 0.95, 0.91], "graphic prop or fabric gesture balancing the pose", "#22d3ee", 0.7),
    ],
  ),
  "Character Sheet": preset(
    {
      high_level_hint: "A production-ready character design sheet with one clear hero and supporting views",
      aesthetics: "coherent concept art, precise design language, readable details",
      lighting: "neutral studio illumination",
      medium: "professional character concept sheet",
      composition: "central hero view, aligned supporting studies, clean separation",
    },
    { vertical: [0.25, 0.5, 0.75], horizontal: [0.16, 0.82] },
    { goldenSpiral: false, ruleOfThirds: false },
    [
      box("Neutral Backdrop", "background", [0.01, 0.01, 0.99, 0.99], "clean neutral concept-sheet background", "#64748b", 0.4),
      box("Hero View", "object", [0.34, 0.08, 0.66, 0.84], "full-body primary character view with readable silhouette", "#22d3ee", 1.5),
      box("Turnaround", "object", [0.04, 0.18, 0.29, 0.78], "front and side turnaround studies", "#a78bfa", 0.9),
      box("Detail Studies", "object", [0.71, 0.18, 0.96, 0.66], "face, accessory, and material close-up studies", "#f59e0b", 0.9),
      box("Character Name", "text", [0.32, 0.87, 0.68, 0.96], "clean production title", "#f472b6", 0.65, "CHARACTER 01"),
    ],
  ),
  "Movie Poster": preset(
    {
      high_level_hint: "A theatrical movie poster with dramatic hierarchy and readable title space",
      aesthetics: "cinematic key art, epic, polished, emotionally charged",
      lighting: "dramatic rim light, atmospheric contrast, luminous focal accents",
      medium: "theatrical poster key art",
      composition: "dominant hero image, layered depth, title anchored in lower third",
    },
    { vertical: [0.5], horizontal: [0.68, 0.82] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("World", "background", [0.01, 0.01, 0.99, 0.99], "cinematic world, layered atmosphere, story-specific environment", "#64748b", 0.75),
      box("Hero Ensemble", "object", [0.15, 0.05, 0.85, 0.70], "dramatic hero portrait or ensemble with clear hierarchy", "#f472b6", 1.55),
      box("Title", "text", [0.13, 0.72, 0.87, 0.84], "large theatrical title treatment", "#fbbf24", 1.35, "FILM TITLE"),
      box("Billing Block", "text", [0.23, 0.87, 0.77, 0.96], "small centered billing block", "#a78bfa", 0.45, "COMING SOON"),
    ],
  ),
  "YouTube Thumbnail": preset(
    {
      high_level_hint: "A high-impact YouTube thumbnail legible at small size",
      aesthetics: "bold, energetic, clean, high contrast",
      lighting: "bright subject separation with crisp edge light",
      medium: "digital thumbnail artwork",
      composition: "large face or subject, short bold text, immediate visual contrast",
    },
    { vertical: [0.48], horizontal: [0.5] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Graphic Background", "background", [0.01, 0.01, 0.99, 0.99], "simple high-contrast graphic background with depth", "#64748b", 0.6),
      box("Main Subject", "object", [0.52, 0.07, 0.98, 0.94], "large expressive subject with clean cutout silhouette", "#f472b6", 1.5),
      box("Hook Text", "text", [0.04, 0.18, 0.49, 0.62], "very large bold text, maximum three to five words", "#fbbf24", 1.45, "BIG IDEA"),
      box("Accent Icon", "logo", [0.07, 0.69, 0.25, 0.89], "simple supporting icon or channel mark", "#22d3ee", 0.65),
    ],
  ),
  "Product Ad": preset(
    {
      high_level_hint: "A clear conversion-focused product advertisement",
      aesthetics: "modern commercial design, crisp, persuasive, brand-ready",
      lighting: "bright product lighting with controlled reflections",
      medium: "commercial advertising photography and graphic design",
      composition: "product-first hierarchy, readable benefit statement, clear brand zone",
    },
    { vertical: [0.42], horizontal: [0.18, 0.80] },
    { goldenSpiral: false, ruleOfThirds: true },
    [
      box("Campaign Background", "background", [0.01, 0.01, 0.99, 0.99], "brand-colored campaign environment with clean depth", "#64748b", 0.6),
      box("Product", "product", [0.46, 0.14, 0.94, 0.82], "clear hero product with accurate packaging and premium finish", "#22d3ee", 1.55),
      box("Benefit Headline", "text", [0.05, 0.19, 0.43, 0.51], "short persuasive headline in bold brand typography", "#fbbf24", 1.35, "DESIGNED TO PERFORM"),
      box("Brand Logo", "logo", [0.06, 0.07, 0.25, 0.15], "clean brand logo", "#a78bfa", 0.8),
      box("Callout", "text", [0.07, 0.66, 0.38, 0.81], "small supporting offer or feature callout", "#f472b6", 0.75, "NEW"),
    ],
  ),
};

export function clonePreset(name) {
  const source = PRESETS[name] || PRESETS["Golden Ratio"];
  return JSON.parse(JSON.stringify(source));
}

export function createDefaultState() {
  const selected = clonePreset("Golden Ratio");
  return {
    version: 1,
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    preset: "Golden Ratio",
    highLevelDescription: "",
    style: {
      aesthetics: "",
      lighting: "",
      medium: "",
      composition: "",
    },
    promptDNA: selected.promptDNA,
    guides: selected.guides,
    overlays: {
      ...selected.overlays,
      safeZone: false,
      safeZonePlatform: "generic",
    },
    snapToGuides: true,
    preserveHierarchy: true,
    boxes: selected.boxes,
  };
}
