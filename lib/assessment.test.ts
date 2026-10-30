import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/config/site";
import {
  ASSESSMENT_OPTIONS,
  ASSESSMENT_QUESTIONS,
  type AssessmentAnswers,
  type AssessmentQuestion,
} from "@/lib/contracts/assessment";
import {
  ASSESSMENT_RULES,
  MAX_RECOMMENDATIONS,
  MIN_RECOMMENDATIONS,
  MIN_THIRD_SCORE,
  rankModules,
  recommendModules,
  type AssessmentRecommendation,
} from "./assessment";

const COMBINATIONS = ASSESSMENT_QUESTIONS.reduce<Array<Partial<AssessmentAnswers>>>(
  (combos, question) => combos.flatMap((combo) => ASSESSMENT_OPTIONS[question].map((option) => ({ ...combo, [question]: option }))),
  [{}],
) as AssessmentAnswers[];

const base: AssessmentAnswers = {
  sector: "other",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
};

const modulesOf = (answers: AssessmentAnswers) => recommendModules(answers).map((item) => item.module);

const pointsOf = (question: AssessmentQuestion, option: string, module: string): number =>
  (ASSESSMENT_RULES[question] as unknown as Record<string, Partial<Record<string, number>>>)[option]?.[module] ?? 0;

const strongest = (item: AssessmentRecommendation) => Math.max(...item.basedOn.map((evidence) => evidence.points));

describe("Business Assessment rules", () => {
  it("defines a rule for every option of every question", () => {
    expect(COMBINATIONS).toHaveLength(ASSESSMENT_QUESTIONS.reduce((total, question) => total * ASSESSMENT_OPTIONS[question].length, 1));
    for (const question of ASSESSMENT_QUESTIONS) {
      expect(Object.keys(ASSESSMENT_RULES[question]).sort()).toEqual([...ASSESSMENT_OPTIONS[question]].sort());
    }
  });

  it("team size never adds points to Sales", () => {
    for (const option of ASSESSMENT_OPTIONS.teamSize) expect(pointsOf("teamSize", option, "sales")).toBe(0);
    expect(ASSESSMENT_RULES.teamSize.small).toEqual({});
  });

  it("every combination gives 2–3 distinct modules, and a third one only with enough evidence", () => {
    const violations = COMBINATIONS.filter((answers) => {
      const result = recommendModules(answers);
      const third = result[MIN_RECOMMENDATIONS];
      const valid =
        result.length >= MIN_RECOMMENDATIONS &&
        result.length <= MAX_RECOMMENDATIONS &&
        new Set(result.map((item) => item.module)).size === result.length &&
        result.every((item) => (MODULE_KEYS as readonly string[]).includes(item.module) && (item.module as string) !== "settings") &&
        (third === undefined || third.score >= MIN_THIRD_SCORE);
      return !valid;
    });
    expect(violations).toEqual([]);
  });

  it("every reason lists exactly the answers that added points to that module", () => {
    const violations = COMBINATIONS.filter((answers) =>
      recommendModules(answers).some((item) => {
        const contributing = ASSESSMENT_QUESTIONS.filter((question) => pointsOf(question, answers[question], item.module) > 0);
        return (
          item.score <= 0 ||
          item.basedOn.length !== contributing.length ||
          item.basedOn.some((evidence, index) => {
            const question = contributing[index];
            return (
              question === undefined ||
              evidence.question !== question ||
              evidence.option !== answers[question] ||
              evidence.points !== pointsOf(question, evidence.option, item.module)
            );
          }) ||
          item.basedOn.reduce((total, evidence) => total + evidence.points, 0) !== item.score
        );
      }),
    );
    expect(violations).toEqual([]);
  });

  it("explains a recommendation with its real answers and no others", () => {
    const answers: AssessmentAnswers = { sector: "realEstate", teamSize: "solo", channel: "referrals", crm: "spreadsheets", problem: "manualWork", goal: "automate" };
    const automation = recommendModules(answers).find((item) => item.module === "automation");
    expect(automation?.basedOn).toEqual([
      { question: "teamSize", option: "solo", points: 1 },
      { question: "crm", option: "spreadsheets", points: 1 },
      { question: "problem", option: "manualWork", points: 3 },
      { question: "goal", option: "automate", points: 2 },
    ]);
  });

  describe("Real estate", () => {
    it("always includes Properties, explained by the sector answer", () => {
      const violations = COMBINATIONS.filter((answers) => answers.sector === "realEstate").filter((answers) => {
        const properties = recommendModules(answers).find((item) => item.module === "properties");
        return properties?.basedOn.length !== 1 || properties.basedOn[0]?.question !== "sector";
      });
      expect(violations).toEqual([]);
    });

    it("keeps Properties even when three other modules score as much or more", () => {
      // Sales 8, Clients 4 and Marketing 3 would have left Properties (3) out.
      const answers: AssessmentAnswers = { sector: "realEstate", teamSize: "small", channel: "social", crm: "none", problem: "followUp", goal: "moreSales" };
      expect(modulesOf(answers)).toEqual(["sales", "clients", "properties"]);
    });

    it("never recommends Properties to other sectors", () => {
      const violations = COMBINATIONS.filter((answers) => answers.sector !== "realEstate").filter((answers) => modulesOf(answers).includes("properties"));
      expect(violations).toEqual([]);
    });
  });

  describe("Software / technology", () => {
    it("is a sector option that only recommends existing modules, backed by the sector answer", () => {
      expect(ASSESSMENT_OPTIONS.sector).toContain("software");
      const answers: AssessmentAnswers = { ...base, sector: "software", problem: "visibility", goal: "understandData" };
      const result = recommendModules(answers);
      expect(result[0]?.module).toBe("analytics");
      expect(result[0]?.basedOn.map((evidence) => evidence.question)).toEqual(["sector", "channel", "problem", "goal"]);
    });

    it("lets the problem drive the result instead of the sector", () => {
      expect(modulesOf({ ...base, sector: "software", problem: "cash", goal: "controlFinances" })[0]).toBe("finance");
      expect(modulesOf({ ...base, sector: "software", problem: "manualWork", goal: "automate" })[0]).toBe("automation");
    });
  });

  describe("Evidence strength", () => {
    it("hides a third module whose evidence is weak", () => {
      // Finance 5, Clients 2, Sales 1: Sales rests on a single one-point answer.
      const answers: AssessmentAnswers = { sector: "other", teamSize: "small", channel: "referrals", crm: "basicTool", problem: "cash", goal: "controlFinances" };
      expect(modulesOf(answers)).toEqual(["finance", "clients"]);
    });

    it("shows a third module when its evidence is strong enough", () => {
      // Clients 7, Sales 4 and Marketing 4.
      const answers: AssessmentAnswers = { sector: "marketingAgency", teamSize: "small", channel: "social", crm: "none", problem: "followUp", goal: "organizeClients" };
      const result = recommendModules(answers);
      expect(result.map((item) => item.module)).toEqual(["clients", "sales", "marketing"]);
      expect(result[2]?.score).toBeGreaterThanOrEqual(MIN_THIRD_SCORE);
    });
  });

  describe("Ties", () => {
    it("is deterministic: the same answers always give the same ranking", () => {
      for (const answers of COMBINATIONS.filter((_, index) => index % 97 === 0)) {
        expect(rankModules({ ...answers })).toEqual(rankModules({ ...answers }));
      }
    });

    it("prefers broader evidence, then the strongest single answer, before anything else", () => {
      const violations = COMBINATIONS.filter((answers) => {
        const ranked = rankModules(answers);
        return ranked.some((item, index) => {
          const next = ranked[index + 1];
          if (!next || item.score !== next.score) return false;
          return item.basedOn.length < next.basedOn.length || (item.basedOn.length === next.basedOn.length && strongest(item) < strongest(next));
        });
      });
      expect(violations).toEqual([]);
    });

    it("does not favor modules by their position in the menu when ties remain", () => {
      let ties = 0;
      let menuFirst = 0;
      for (const answers of COMBINATIONS) {
        const ranked = rankModules(answers).slice(0, MAX_RECOMMENDATIONS);
        ranked.slice(0, -1).forEach((item, index) => {
          const next = ranked[index + 1];
          if (!next || item.score !== next.score || item.basedOn.length !== next.basedOn.length || strongest(item) !== strongest(next)) return;
          ties += 1;
          if (MODULE_KEYS.indexOf(item.module) < MODULE_KEYS.indexOf(next.module)) menuFirst += 1;
        });
      }
      expect(ties).toBeGreaterThan(100);
      expect(menuFirst / ties).toBeGreaterThan(0.4);
      expect(menuFirst / ties).toBeLessThan(0.6);
    });
  });
});
