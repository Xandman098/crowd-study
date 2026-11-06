// Everything an experimenter may want to change.  See PROTOCOL.md.
export const CONFIG = {
  // Data upload: DataPipe (https://pipe.jspsych.org) experiment ID, linked to an OSF project.
  // Leave empty to save the data as a file download at the end (lab use).
  datapipeId: "",
  // Prolific: completion URL to redirect to at the end (empty = show a thank-you page only).
  completionUrl: "",

  scenarios: ["offscreen_alarm", "two_rooms"],
  budgets: [16, 8],                       // β = 1/16 and 1/8
  methods: ["proxy", "round_robin", "camera_lod", "ng2005_w1"],
  ours: "proxy",
  repetitions: 2,                         // each pair is shown with this many different seed draws
  ratingConditions: ["full", "proxy_b16", "round_robin_b16", "camera_lod_b16", "ng2005_w1_b16", "none"],
  maxReplays: 1,
  breakEvery: 20,
  camera: { elevationDeg: 52, vfovDeg: 42, fill: 1.08 },
};
