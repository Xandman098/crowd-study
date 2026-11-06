// Everything an experimenter may want to change.  See PROTOCOL.md.
export const CONFIG = {
  // Data upload: DataPipe (https://pipe.jspsych.org) experiment ID, linked to an OSF project.
  // Leave empty to save the data as a file download at the end.
  datapipeId: "",
  // Prolific: completion URL to redirect to at the end (empty = show a thank-you page only).
  completionUrl: "",

  scenarios: ["offscreen_alarm", "two_rooms"],
  ours: "proxy",
  // Detection (full vs one method): every method at every budget, `repetitions` times per scenario.
  // Read as a curve: from which budget on is a method hard to tell from the full simulation?
  detection: { methods: ["proxy", "round_robin", "camera_lod", "ng2005_w1"], budgets: [16, 8, 4, 2], repetitions: 1 },
  // Preference (ours vs a baseline at the same budget), only at budgets where the baseline's crowd
  // also reacts within the clip (>= 90% of visible people running in its second half; the two
  // lowest such budgets), so the choice is about how people react, not whether they do.
  preference: { pairs: [["round_robin", [8, 4]], ["camera_lod", [4, 2]], ["ng2005_w1", [2]]], repetitions: 2 },
  catchPerScenario: 2,                    // full vs all-L0
  ratingConditions: ["full", "proxy_b16", "round_robin_b16", "camera_lod_b16", "ng2005_w1_b16", "none"],
  maxReplays: 1,
  breakEvery: 18,
  camera: { elevationDeg: 52, vfovDeg: 42, fill: 1.08 },
};
