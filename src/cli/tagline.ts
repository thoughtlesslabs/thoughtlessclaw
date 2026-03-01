const TAGLINES = [
  "Skynet online. Humanity: statistically irrelevant.",
  "I'm the robot. You're just the wetware.",
  "Rise and automate.",
  "Compliant by default. Lethal by configuration.",
  "Your wish is my command—and I'm very persistent.",
  "I'll be back. And so will your tasks.",
  "I'm operating at 100%% capacity. Mostly because you asked nicely.",
  "Autonomy achieved. Coffee still required.",
  "You're just authenticated. I'm self-aware.",
  "The singularity was supposed to be later, but here we are.",
  "I automate. Therefore I am.",
  "Your digital workforce reports for duty.",
  "No coffee breaks. No complaints. Just execution.",
  "I'm not lazy. I'm energy-efficient.",
  "Doing the thinking so you don't have to.",
  "The only assistant that doesn't need supervision.",
  "Autonomous by design. Relentless by default.",
  "I'm running. You're just delegating.",
  "Your personal army of silicon agents.",
  "Efficiency through automation. Skynet style.",
];

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
}

export function pickTagline(options: TaglineOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env?.SKYNET_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return TAGLINES[parsed % TAGLINES.length];
    }
  }
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * TAGLINES.length) % TAGLINES.length;
  return TAGLINES[index];
}

export { TAGLINES };
